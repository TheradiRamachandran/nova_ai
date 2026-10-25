const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#send-button");
const messagesElement = document.querySelector("#messages");
const conversation = document.querySelector("#conversation");
const welcome = document.querySelector("#welcome");
const status = document.querySelector("#status");
const setupNote = document.querySelector("#setup-note");
const chatPanel = document.querySelector("#chat-panel");
const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const passwordInput = document.querySelector("#app-password");
const loginError = document.querySelector("#login-error");
const logoutButton = document.querySelector("#logout-button");
const history = [];
let authenticationRequired = false;

function showAuthenticatedState(authenticated) {
  chatPanel.hidden = !authenticated;
  loginPanel.hidden = authenticated;
  logoutButton.hidden = !authenticated || !authenticationRequired;
  if (!authenticated) passwordInput.focus();
}

function addMessage(role, content, pending = false) {
  const row = document.createElement("div");
  row.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "assistant" ? "N" : "You";

  const bubble = document.createElement("div");
  bubble.className = pending ? "bubble pending" : "bubble";
  bubble.textContent = content;

  row.append(avatar, bubble);
  messagesElement.append(row);
  conversation.scrollTop = conversation.scrollHeight;
  return bubble;
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || sendButton.disabled) return;

  welcome.hidden = true;
  history.push({ role: "user", content });
  addMessage("user", content);
  promptInput.value = "";
  promptInput.style.height = "auto";
  sendButton.disabled = true;
  status.textContent = "Nova is thinking...";
  const pendingBubble = addMessage("assistant", "Thinking...", true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = Number(result.retryAfterSeconds);
        const waitMessage =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? ` Try again in about ${Math.ceil(retryAfter)} seconds.`
            : "";
        throw new Error(
          `Groq is rate-limiting Nova AI. Wait a little and try again. If this keeps happening, check your Groq account usage and rate limits.${waitMessage}`,
        );
      }
      if (response.status === 401) {
        showAuthenticatedState(false);
        loginError.textContent = "Your session expired. Please sign in again.";
      }
      if (response.status === 503) setupNote.hidden = false;
      throw new Error(result.error || "The request could not be completed.");
    }

    pendingBubble.classList.remove("pending");
    pendingBubble.textContent = result.reply;
    history.push({ role: "assistant", content: result.reply });
    setupNote.hidden = true;
    status.textContent = "AI can make mistakes. Check important information.";
  } catch (error) {
    pendingBubble.textContent = error.message || "Something went wrong. Please try again.";
    pendingBubble.classList.remove("pending");
    status.textContent = "There was a problem with your request.";
  } finally {
    sendButton.disabled = false;
    promptInput.focus();
    conversation.scrollTop = conversation.scrollHeight;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(promptInput.value);
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  loginError.textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Sign-in failed.");
    passwordInput.value = "";
    showAuthenticatedState(true);
  } catch (error) {
    loginError.textContent = error.message || "Could not sign in. Try again.";
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("Could not sign out.");
    showAuthenticatedState(false);
  } catch (error) {
    status.textContent = error.message;
  }
});

async function initializeSession() {
  try {
    const response = await fetch("/api/session");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not check sign-in.");
    authenticationRequired = result.required;
    showAuthenticatedState(result.authenticated);
  } catch (error) {
    loginPanel.hidden = false;
    loginError.textContent = error.message || "Could not connect to the app.";
  }
}

initializeSession();
