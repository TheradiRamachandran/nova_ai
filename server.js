const http = require("node:http");
const { createHmac, createHash, timingSafeEqual } = require("node:crypto");
const { existsSync } = require("node:fs");
const { readFile, stat } = require("node:fs/promises");
const path = require("node:path");

if (existsSync(path.join(__dirname, ".env"))) {
  process.loadEnvFile(path.join(__dirname, ".env"));
}

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_COOKIE = "nova_session";
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map();
const PUBLIC_DIR = path.join(__dirname, "public");
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function safeEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sessionSignature(expiresAt, password) {
  return createHmac("sha256", password).update(String(expiresAt)).digest("base64url");
}

function hasValidSession(request, password) {
  const cookies = request.headers.cookie || "";
  const cookie = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return false;

  const [expiresAt, signature] = cookie.slice(SESSION_COOKIE.length + 1).split(".");
  const expiry = Number(expiresAt);
  if (!Number.isSafeInteger(expiry) || expiry <= Date.now() || !signature) return false;
  return safeEqual(signature, sessionSignature(expiry, password));
}

function setSessionCookie(response, request, password) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const signature = sessionSignature(expiresAt, password);
  const secure = request.headers["x-forwarded-proto"] === "https" || request.socket.encrypted;
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${expiresAt}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_MS / 1000}${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(response, request) {
  const secure = request.headers["x-forwarded-proto"] === "https" || request.socket.encrypted;
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

function isLoginRateLimited(request) {
  const now = Date.now();
  const address = request.socket.remoteAddress || "unknown";
  let attempt = loginAttempts.get(address);
  if (!attempt || attempt.resetAt <= now) {
    attempt = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(address, attempt);
  }
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) return true;
  attempt.count += 1;

  if (loginAttempts.size > 1000) {
    for (const [key, value] of loginAttempts) {
      if (value.resetAt <= now) loginAttempts.delete(key);
    }
  }
  return false;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error("Request is too large."));
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

async function handleChat(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST for chat requests." });
  }

  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && !hasValidSession(request, appPassword)) {
    return sendJson(response, 401, { error: "Please sign in to use Nova AI." });
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      error: "Mistral is not configured. Add MISTRAL_API_KEY to your .env file and restart the app.",
    });
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    if (!response.headersSent && !response.destroyed) {
      sendJson(response, error.message === "Request is too large." ? 413 : 400, {
        error: error.message,
      });
    }
    return;
  }

  const messages = payload && payload.messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 20 ||
    messages.some(
      (message) =>
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        message.content.trim().length === 0 ||
        message.content.length > 6000,
    )
  ) {
    return sendJson(response, 400, {
      error: "Send between 1 and 20 user/assistant messages, each up to 6,000 characters.",
    });
  }

  try {
    const upstream = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        messages,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      if (upstream.status === 429) {
        const retryAfter = upstream.headers.get("retry-after");
        let retryAfterSeconds;
        if (retryAfter && /^\d+$/.test(retryAfter)) {
          retryAfterSeconds = Number(retryAfter);
        } else if (retryAfter) {
          const retryAt = Date.parse(retryAfter);
          if (Number.isFinite(retryAt)) {
            retryAfterSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
          }
        }

        const error =
          "Mistral is rate-limiting Nova AI. Wait a little and try again. If this keeps happening, check your Mistral account usage, credits, and rate limits.";
        if (retryAfterSeconds !== undefined) {
          response.setHeader("Retry-After", String(retryAfterSeconds));
        }
        console.error("Mistral API rate limit reached.");
        return sendJson(response, 429, { error, retryAfterSeconds });
      }

      const detail =
        result?.error?.message ??
        result?.message ??
        result?.detail;
      const message =
        typeof detail === "string"
          ? `Mistral API returned HTTP ${upstream.status}: ${detail}`
          : `Mistral API returned HTTP ${upstream.status}. Check the API key, account access, and usage limits.`;
      console.error(message);
      return sendJson(response, 502, { error: message });
    }

    const reply = result.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return sendJson(response, 502, { error: "Mistral returned an empty response." });
    }

    return sendJson(response, 200, { reply });
  } catch (error) {
    console.error("Mistral request failed:", error.message);
    return sendJson(response, 502, {
      error: "Could not reach Mistral. Check your connection and try again.",
    });
  }
}

async function handleSession(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return sendJson(response, 405, { error: "Use GET for session status." });
  }
  const password = process.env.APP_PASSWORD;
  return sendJson(response, 200, {
    required: Boolean(password),
    authenticated: password ? hasValidSession(request, password) : true,
  });
}

async function handleLogin(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST to sign in." });
  }
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    return sendJson(response, 404, { error: "Sign-in is not enabled on this server." });
  }
  if (isLoginRateLimited(request)) {
    return sendJson(response, 429, { error: "Too many sign-in attempts. Please wait and try again." });
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, error.message === "Request is too large." ? 413 : 400, {
      error: error.message,
    });
  }

  if (
    !payload ||
    typeof payload.password !== "string" ||
    payload.password.length > 1024 ||
    !safeEqual(payload.password, appPassword)
  ) {
    return sendJson(response, 401, { error: "That password is not correct." });
  }

  setSessionCookie(response, request, appPassword);
  return sendJson(response, 200, { authenticated: true });
}

function handleLogout(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Use POST to sign out." });
  }
  clearSessionCookie(response, request);
  return sendJson(response, 200, { authenticated: false });
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.writeHead(405);
    return response.end("Method not allowed");
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    return response.end("Bad request");
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403);
    return response.end("Forbidden");
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404);
      return response.end("Not found");
    }
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    });
    return response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      response.writeHead(404);
      return response.end("Not found");
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${HOST}`).pathname;
  try {
    if (pathname === "/api/session") {
      await handleSession(request, response);
    } else if (pathname === "/api/login") {
      await handleLogin(request, response);
    } else if (pathname === "/api/logout") {
      handleLogout(request, response);
    } else if (pathname === "/api/chat") {
      await handleChat(request, response);
    } else {
      await serveStatic(request, response, pathname);
    }
  } catch (error) {
    console.error("Request failed:", error.message);
    if (!response.headersSent) {
      sendJson(response, 500, { error: "An unexpected server error occurred." });
    } else {
      response.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mistral chat is running at http://${HOST}:${PORT}`);
});
