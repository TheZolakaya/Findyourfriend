# nkya-speech — the Nirmanakaya Reader's speech stack, copied for Screen Buddy (2026-11-03, by True)

Four files, copied as they run in production at nirmanakaya.com (0.99.796). Nothing here contains a key. Both keys are already in the founder's Vercel project under these exact names; put the same two in screen-buddy/.env:

- `GROQ_API_KEY` — voice to text (Groq-hosted Whisper, model `whisper-large-v3-turbo`, $0.04 per hour of audio, price fetched 2026-10-03).
- `REPLICATE_API_TOKEN` — text to voice (Kokoro 82M on Replicate; two pinned model versions, see kokoro.js; ~$0.000225 per second of T4 compute).

## The files
- `transcribe.route.js` — a Next.js route: POST multipart `{ audio }` → `{ text, secs }`. The useful parts for a desktop app: the model name, the 8 MB cap, the punctuation HINT passed as Whisper's `prompt`, and the call to `https://api.groq.com/openai/v1/audio/transcriptions` (OpenAI-compatible; `file`, `model`, `prompt`, `response_format`). Drop the Next `Response` wrapper and call Groq directly.
- `transcribeEcho.js` — `stripPromptEcho(text, prompt)`: Whisper echoes the hint back on silence; this removes any sentence of the transcript that is the hint. Use it on every transcript. On-device voice-activity detection in front of it will make this fire less, but keep it.
- `kokoro.js` — `speakPiece(text, voice, { speed })` → `{ url, secs }` via `https://api.replicate.com/v1/predictions` with `Prefer: wait`. Contains: the two model versions (the popular copy stays warm, ~1 s; the copy with Heart sleeps, ~2 min cold), the six voices and their default speeds (George at 0.95), `MAX_PIECE = 520` characters per call, the RESPELLINGS table (words the model says wrong, proven by transcribing clips back: e.g. "Honing" → "Hoaning"), and the ALL-CAPS de-shouting. `forTheEar(text)` prepares a text for speech. Server-side only (the token).
- `voice.route.js` — the thin Next.js route around `speakPiece`, including the `{ warm: true }` call used when the person taps Ask, so the first real sentence doesn't pay a cold start. Copy the warm-up idea; the route itself isn't needed on a desktop.

## Notes from the Reader's own experience
- Send a reply in pieces of ≤ 520 characters and start playing the first while the rest generates; silence between pieces is the page's pause, not the model's.
- George (`bm_george`) on the popular copy is the warm, reliable narrator; Heart (`af_heart`) sounds best but lives on the sleepy copy.
- Stop listening while the voice plays (the Reader does), or the mic hears George.
- The browser's built-in `speechSynthesis` (components/book/ReadAloud.js in the Reader) is the free fallback: no key, robotic, instant.
