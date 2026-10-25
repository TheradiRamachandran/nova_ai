# Nova AI

A small AI chat app built with HTML, CSS, browser JavaScript, and Node.js. The browser sends messages to the local server; the server calls Groq's API so your API key is never included in browser code.

## Setup

1. Create a Groq API key at <https://console.groq.com/keys>. Do not share or commit it.
2. Copy `.env.example` to `.env`.
3. Open `.env` and replace the example values with your Groq API key and a long, private app password. Do not share or commit this file.
4. Install [Node.js 20.12 or newer](https://nodejs.org/).
5. In this folder, run:

   ```powershell
   npm start
   ```

6. Open <http://127.0.0.1:3000> in your browser.

The server listens on your own computer only by default. Set a different port with the `PORT` environment variable if needed.

## Deploy to Render

This project includes a `render.yaml` Blueprint for deploying the Node.js server and static chat UI together. The public site requires sign-in so visitors cannot use your Groq API key through the chat endpoint.

1. Push this project to the GitHub repository.
2. In Render, create a new **Blueprint** and select that repository.
3. When prompted, set `GROQ_API_KEY` to your Groq API key and set `APP_PASSWORD` to a strong, unique password. These are Render secrets; do not put real values in `render.yaml` or GitHub.
4. Deploy the Blueprint and open the Render URL. Sign in using your `APP_PASSWORD`.

Render supplies the port automatically. The app binds to `0.0.0.0` in the hosted environment and uses a signed, HTTP-only session cookie for sign-in.

Nova AI uses Groq's OpenAI-compatible chat completions API with the `openai/gpt-oss-20b` model. Groq currently lists this model with token-based pricing; check the [model page](https://console.groq.com/docs/model/openai/gpt-oss-20b) and your account's usage limits before using it. If chat is rate-limited, wait and retry. This app does not automatically retry rate-limited requests.
