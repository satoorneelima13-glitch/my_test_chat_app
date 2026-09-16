# Gemini Chat App

A Next.js chat application built on the Gemini API (`@google/genai`), with per-request model settings, streaming, and client/server-validated generation configuration.

## Features

- **Model selection** — choose the Gemini model used for a request.
- **Streaming responses** — assistant replies stream token-by-token over NDJSON; can be toggled on/off.
- **Generation settings** — optional, per-request controls, each left unset by default (falling back to the model's own default) unless given a value:
  - `temperature` (0.0–2.0)
  - `topP` (0.0–1.0)
  - `topK` (positive integer)
  - `maxOutputTokens` (1–65536)
  - `frequencyPenalty` (-2.0–2.0)
  - `presencePenalty` (-2.0–2.0)
  - `stopSequences` (up to 5 non-empty strings)
  - `seed` (integer)
- **Explanatory tooltips** — each setting has an inline tooltip describing what it does and its valid range.
- **Client/server validation** — the settings form does client-side sanity checks before sending; the API route independently re-validates everything (see `app/lib/generationSettings.ts` and `app/lib/settingsForm.ts`) and rejects invalid input with a 400 and the offending field.
- **Cancellation with partial-response preservation** — stopping a request mid-stream aborts both the client fetch and the upstream Gemini call, while keeping whatever text has already streamed in.
- **Sanitized error handling** — upstream Gemini errors are never forwarded raw:
  - `503` (model temporarily overloaded) → fixed, user-facing message, same status.
  - `400` (model rejected a setting) → fixed, actionable message, same status.
  - anything else → generic `500`.

## Setup

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Copy `.env.local.example` to `.env.local` and set:
   ```bash
   GOOGLE_GENAI_API_KEY=your_api_key_here
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server at [http://localhost:3000](http://localhost:3000) |
| `npx tsc --noEmit` | Type-check the project |
| `npm run test:unit` | Run unit tests (`playwright.unit.config.ts`) |
| `npm run test:ui` | Run UI tests (`playwright.config.ts`) |

Last verified: 28 unit tests passed, 29 UI tests passed, TypeScript clean.

## Limitations

Not every optional setting is accepted by every Gemini model — support varies by model, and an unsupported setting surfaces as a sanitized 400 from the API at request time rather than being blocked client-side.
