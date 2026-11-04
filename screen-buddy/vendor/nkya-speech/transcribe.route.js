// VOICE TO TEXT (2026-10-03). POST multipart { audio } → { text, secs }. The browser records (MediaRecorder works the same everywhere,
// which is the point — the founder: "we need a system that's going to work regardless of browser"); the clip goes to Groq's
// Whisper large v3 turbo ($0.04 per hour of audio, fetched 2026-10-03). Admin-only while benched. Needs GROQ_API_KEY.
import { requireUser } from '../../../lib/requireUser.js'; // .637: every signed-in reader (was admins only while benched)
import { stripPromptEcho } from '../../../lib/transcribeEcho.js'; // .759: a silent clip makes Whisper echo the hint below

export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const MODEL = 'whisper-large-v3-turbo';
const USD_PER_HOUR = 0.04;   // Groq's list price for this model, read from console.groq.com/docs/speech-to-text on 2026-10-03
const HINT = 'A question, spoken plainly. Punctuated, with capitals and full stops.'; // the punctuation nudge; on silence Whisper returns THIS (2026-10-13, the founder's desktop)

export async function POST(request) {
  const denied = await requireUser(request);
  if (denied) return denied;
  const key = process.env.GROQ_API_KEY;
  if (!key) return Response.json({ error: 'voice to text is not configured (no GROQ_API_KEY)' }, { status: 503 });
  let audio = null;
  try { const form = await request.formData(); audio = form.get('audio'); } catch {}
  if (!audio || typeof audio.arrayBuffer !== 'function') return Response.json({ error: 'no audio' }, { status: 400 });
  if (audio.size > 8 * 1024 * 1024) return Response.json({ error: 'that recording is too long' }, { status: 413 });
  const out = new FormData();
  out.append('file', audio, audio.name || 'speech.webm');
  out.append('model', MODEL);
  out.append('response_format', 'verbose_json');
  out.append('temperature', '0');
  // a punctuated prompt nudges Whisper to punctuate the transcript (it otherwise tends to return a run-on)
  out.append('prompt', HINT);
  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: out });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return Response.json({ error: j?.error?.message || `transcription failed (${r.status})` }, { status: 502 });
    const secs = Number(j.duration) || 0;
    const usd = (secs / 3600) * USD_PER_HOUR;
    // .759: nothing heard — the transcript is the hint echoed (or empty); the page tells the person to check the microphone
    const { text, echoed } = stripPromptEcho(String(j.text || '').trim(), HINT);
    const segs = Array.isArray(j.segments) ? j.segments : [];
    const noSpeech = segs.length ? segs.reduce((a, g) => a + (Number(g.no_speech_prob) || 0), 0) / segs.length : 0;
    if (!text) return Response.json({ text: '', secs, usd, heard: false, reason: echoed ? 'echo' : 'silence', noSpeech });
    if (echoed) console.log(`[transcribe] the hint echoed beside speech (${secs.toFixed(1)}s, no_speech ${noSpeech.toFixed(2)}) — stripped`);
    return Response.json({ text, secs, usd, heard: true });
  } catch (e) {
    return Response.json({ error: String(e?.message || e).slice(0, 200) }, { status: 502 });
  }
}
