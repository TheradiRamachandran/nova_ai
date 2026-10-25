# Nova AI

A small AI chat app built with HTML, CSS, browser JavaScript, and Node.js. The browser sends messages to the local server; the server calls Mistral or Groq so your API key is never included in browser code.

## Setup

1. Create a Mistral API key at <https://console.mistral.ai/api-keys/> or a Groq API key at <https://console.groq.com/keys>. Do not share or commit it.
2. Copy `.env.example` to `.env`.
3. Open `.env` and set either `MISTRAL_API_KEY` or `GROQ_API_KEY`, plus a long, private app password. If both provider keys are set, Mistral is used. Do not share or commit this file.
4. Install [Node.js 20.12 or newer](https://nodejs.org/).
5. In this folder, install dependencies and start the app:

   ```powershell
   npm install
   npm start
   ```

6. Open <http://127.0.0.1:3000> in your browser.

The server listens on your own computer only by default. Set a different port with the `PORT` environment variable if needed.

## PDF workspace

Sign in, then choose **PDF workspace** to open a PDF (up to 30 MB and 300 pages). The workspace can extract selectable text for questions and AI-generated edits, add text/highlights/drawings, replace a selected area with a white overlay and new text, rotate/reorder/delete pages, merge another PDF, and download the result.

PDF files are processed in your browser and are not uploaded to the app server. If you ask Nova about a document, up to 36,000 characters of its extracted text are sent to the server and then to your configured AI provider. Scanned documents without selectable text are not OCR'd. Replacing an area is a visual overlay; it does not securely erase the original text or images beneath it. Keep the original file if you need the source unchanged.

## Deploy to Render

This project includes a `render.yaml` Blueprint for deploying the Node.js server and static chat UI together. The public site requires sign-in so visitors cannot use your AI provider key through the chat endpoint.

1. Push this project to the GitHub repository.
2. In Render, create a new **Blueprint** and select that repository.
3. When prompted, set either `MISTRAL_API_KEY` or `GROQ_API_KEY` and set `APP_PASSWORD` to a strong, unique password. These are Render secrets; do not put real values in `render.yaml` or GitHub. If both provider keys are set, Mistral is used.
4. Deploy the Blueprint and open the Render URL. Sign in using your `APP_PASSWORD`.

Render supplies the port automatically. The app binds to `0.0.0.0` in the hosted environment and uses a signed, HTTP-only session cookie for sign-in.

Nova AI uses Mistral's OpenAI-compatible chat completions API with `mistral-small-latest` when `MISTRAL_API_KEY` is set, or Groq's API with `openai/gpt-oss-20b` when only `GROQ_API_KEY` is set. Check your provider's current pricing and usage limits before use. If chat is rate-limited, wait and retry. This app does not automatically retry rate-limited requests.
