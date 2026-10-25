# Nova AI

A small AI chat app built with HTML, CSS, browser JavaScript, and Node.js. The browser sends messages to the local server; the server calls Google's Gemini API so your API key is never included in browser code.

## Setup

1. Create a Gemini API key in <https://aistudio.google.com/apikey>. Use Google's free tier and do not enable billing if you want to avoid API charges. Do not share or commit the key.
2. Copy `.env.example` to `.env`.
3. Open `.env` and replace the example values with your Gemini API key and a long, private app password. Do not share or commit this file.
4. Install [Node.js 20.12 or newer](https://nodejs.org/).
5. In this folder, run:

   ```powershell
   npm start
   ```

6. Open <http://127.0.0.1:3000> in your browser.

The server listens on your own computer only by default. Set a different port with the `PORT` environment variable if needed.

## Deploy to Render

This project includes a `render.yaml` Blueprint for deploying the Node.js server and static chat UI together. The public site requires sign-in so visitors cannot use your Gemini API key through the chat endpoint.

1. Push this project to the GitHub repository.
2. In Render, create a new **Blueprint** and select that repository.
3. When prompted, set `GEMINI_API_KEY` to your Gemini API key and set `APP_PASSWORD` to a strong, unique password. These are Render secrets; do not put real values in `render.yaml` or GitHub.
4. Deploy the Blueprint and open the Render URL. Sign in using your `APP_PASSWORD`.

Render supplies the port automatically. The app binds to `0.0.0.0` in the hosted environment and uses a signed, HTTP-only session cookie for sign-in.

Nova AI uses Google's `gemini-2.5-flash` model on Gemini API's free tier. Free access has quotas and rate limits; it is not unlimited. The server does not select a paid model or retry with a paid tier. If the free quota is reached, wait for it to reset. Google states that data sent under the free tier may be used to improve its products; review the [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [terms](https://ai.google.dev/gemini-api/terms) before using the app.
