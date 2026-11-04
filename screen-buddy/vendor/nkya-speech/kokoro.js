// THE READER'S VOICE (2026-10-03) — Kokoro on Replicate. Founder's choice by ear: Heart (af_heart), George (bm_george).
// Measured on the bench: ~880 characters = 13–20 s of T4 compute = $0.003–0.005 (≈ $3.4–5.1 per million characters).
// Kokoro takes ~500 characters per call, so callers send a turn in pieces; this speaks ONE piece.
// The model: alphanumericuser/kokoro-82m (jaaari/kokoro-82m lacks af_heart). Version pinned so a model update can't change the voice.
// Server-only: needs REPLICATE_API_TOKEN.

export const VOICE_USD_PER_SECOND = 0.000225;   // Replicate T4, $/second of compute (their pricing page, 2026-10-03) — the page's cost line is priced from this
export const KOKORO_VERSION = process.env.KOKORO_VERSION || '89b6fa84e4fa2dd6bd3a96be3e1f12827a3516c9fda8fddbac7a0be131c9a6f5';   // pinned 2026-10-03 (read from the Replicate API, not typed)
// Two copies of Kokoro on Replicate (measured 2026-10-03): the POPULAR copy (jaaari, 100M+ runs) stays warm — ~1 s a piece — but has
// no Heart; the copy WITH Heart (alphanumericuser) sleeps when idle — 114 s on a cold call, ~5 s warm. Founder: "let's just try both
// and see how slow it is in reality" (no keep-awake pinging). So each voice names its own copy.
const POPULAR = 'f559560eb822dc509045f3921a1921234918b91739db4bf3daab2169b71c7a13';   // jaaari/kokoro-82m (read from the Replicate API)
const SPEED = 0.95;   // .625 CADENCE (founder 2026-10-03): a touch under full speed; the pauses are the page's (silence between pieces), not the model's
export const VOICES = {
  af_heart: { label: 'Heart', version: () => KOKORO_VERSION, input: (text, speed) => ({ text, voice: 'af_heart', speed: speed || 1, language_code: 'a' }) },
  bm_george: { label: 'George', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'bm_george', speed: speed || SPEED }) },
  af_bella: { label: 'Bella', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_bella', speed: speed || SPEED }) },   // 2026-10-03, the founder: 'Bella as the American girl option' (the warm copy's own default voice; grade A)
  bf_emma: { label: 'Emma', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'bf_emma', speed: speed || SPEED }) },
  am_michael: { label: 'Michael', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'am_michael', speed: speed || SPEED }) }, // 2026-10-03, the founder's picks among the American men (C+)
  am_puck: { label: 'Puck', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'am_puck', speed: speed || SPEED }) },      // 2026-10-03, the founder: 'can we try Emma instead?' — British, warm copy
  af_nicole: { label: 'Nicole', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_nicole', speed: speed || SPEED }) }, // .705 grade B-, the warm copy
  af_aoede: { label: 'Aoede', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_aoede', speed: speed || SPEED }) }, // .705 grade C+, the warm copy
  af_kore: { label: 'Kore', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_kore', speed: speed || SPEED }) }, // .705 grade C+, the warm copy
  af_sarah: { label: 'Sarah', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_sarah', speed: speed || SPEED }) }, // .705 grade C+, the warm copy
  am_fenrir: { label: 'Fenrir', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'am_fenrir', speed: speed || SPEED }) }, // .705 grade C+, the warm copy
  af_alloy: { label: 'Alloy', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_alloy', speed: speed || SPEED }) }, // .705 grade C, the warm copy
  af_nova: { label: 'Nova', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'af_nova', speed: speed || SPEED }) }, // .705 grade C, the warm copy
  bf_isabella: { label: 'Isabella', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'bf_isabella', speed: speed || SPEED }) }, // .705 grade C, the warm copy
  bm_fable: { label: 'Fable', version: () => POPULAR, input: (text, speed) => ({ text, voice: 'bm_fable', speed: speed || SPEED }) }, // .705 grade C, the warm copy
};
export const MAX_PIECE = 520;   // characters per call (Kokoro's window is ~510 tokens)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


/** Speak one piece. Returns { url, secs } or throws. Retries Replicate's new-account throttle (429). */
export async function speakPiece(text, voice = 'bm_george', { deadlineMs = 45000, speed } = {}) { // .698 speed: the listener's readback speed (0.7–1.5), the page's control
  const started = Date.now();
  const token = process.env.REPLICATE_API_TOKEN; if (!token) throw new Error('voice is not configured (no REPLICATE_API_TOKEN)');
  const v = VOICES[voice] ? voice : 'bm_george'; const ver = VOICES[v].version(); if (!ver) throw new Error('no Kokoro version');
  const input = VOICES[v].input(String(text).slice(0, MAX_PIECE), speed);
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch('https://api.replicate.com/v1/predictions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: `wait=${Math.max(1, Math.min(55, Math.floor((deadlineMs - (Date.now() - started)) / 1000)))}` }, body: JSON.stringify({ version: ver, input }) });
    if (r.status === 429) { await sleep(Math.min(15000, Number(r.headers.get('retry-after') || 3) * 1000)); continue; }
    let p = await r.json(); if (!p?.urls) throw new Error(`replicate ${r.status}: ${JSON.stringify(p).slice(0, 160)}`);
    while (!['succeeded', 'failed', 'canceled'].includes(p.status)) {
      if (Date.now() - started > deadlineMs) { const e = new Error(`${VOICES[v].label} is waking up (a cold start takes about two minutes) — try again shortly, or switch to George`); e.waking = true; throw e; }
      await sleep(800); p = await (await fetch(p.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json();
    }
    if (p.status !== 'succeeded') throw new Error(`kokoro ${p.status}: ${String(p.error || '').slice(0, 120)}`);
    return { url: Array.isArray(p.output) ? p.output[0] : p.output, secs: p.metrics?.predict_time || 0 };
  }
  throw new Error('voice throttled — try again in a moment');
}

/** Clean a piece of reading text for the ear: no markdown, no house glyphs, dashes as pauses. */
// .662 RESPELLINGS — words this model says wrong, written the way it says them right. Every entry PROVEN by generating the clip in both
// narrator voices and transcribing it back (scripts/_respell_probe.mjs): "Honing" was heard as "hunting"; "Hoaning" is heard as "Honing" in both.
export const RESPELL = { Honing: 'Hoaning', honing: 'hoaning', Naming: 'Nayming', naming: 'nayming' }; // .698 "naming" was heard as "nomming" (Bella) / "Namming" (George); "nayming" transcribes as "naming" in both (scripts/voice_respell_probe.mjs, 2026-10-05)
// .696 (founder 2026-10-05): "lives" the verb ("where your sense of direction lives") was said as the noun ("their lives"). The noun is kept where a
// possessive, a determiner, a number or "of" stands before it; every other "lives" is the verb and is respelled "livz" (the short i). The
// spelling is the model's letter-to-sound guess, not proven by transcription — a homograph transcribes the same either way; clips on the shelf for the ear.
const NOUN_BEFORE = /(?:\b(?:their|your|our|my|his|her|its|whose|the|these|those|many|few|several|two|three|four|five|all|both|other|different|separate|past|whole|entire|daily|real|own|human|everyday|people|of|and|or|in)|'s)\s+$/i;
const respell = (t) => t.replace(/\b(Honing|honing|Naming|naming)\b/g, (w) => RESPELL[w] || w)
  .replace(/\b(L|l)ives\b/g, (w, L, offset, whole) => (NOUN_BEFORE.test(whole.slice(0, offset)) ? w : `${L}ivz`));
export function forTheEar(s) {
  // .625 CADENCE: the Reader writes for the eye — dashes, fragments, ellipses, colons. Kokoro gives those almost nothing, so the
  // text is rewritten for the ear before it is spoken: a dash that ends a thought becomes a full stop, one inside a thought a comma;
  // an ellipsis is a full stop; a semicolon is a full stop; a colon is a comma; brackets are commas. Nothing on the page changes.
  return respell(String(s || ''))
    .replace(/[*_#`>]+/g, '').replace(/[◈◇◎↩⚡•]/g, '')
    // .643: ALL CAPS is shouted by the model (founder: "it says the medicine very loudly"). A run of capitalised words — a heading, a label —
    // comes down to sentence case before it is spoken; a two-letter capital like AI or OK is left alone.
    .replace(/\b[A-Z][A-Z'’]{2,}(?:\s+[A-Z][A-Z'’]+)*\b/g, (run, offset, whole) => { const before = whole.slice(0, offset).replace(/\s+$/, ''); const startsSentence = !before || /[.!?\n]$/.test(before); return startsSentence ? run.charAt(0) + run.slice(1).toLowerCase() : run.toLowerCase(); })
    .replace(/\s*(\.\.\.|…)\s*/g, '. ')
    .replace(/\s*[—–]\s*(?=[A-Z])/g, '. ')      // a dash before a capital ends the thought
    .replace(/\s*[—–]\s*/g, ', ')                // any other dash is a breath
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s*:\s+/g, ', ')
    .replace(/\s*\(\s*/g, ', ').replace(/\s*\)\s*([.,!?])?/g, (m, p) => (p ? p + ' ' : ', '))
    .replace(/,\s*([.!?])/g, '$1').replace(/([.!?])\s*,/g, '$1').replace(/,\s*,+/g, ',').replace(/\.\s*\.+/g, '.')
    .replace(/\s+/g, ' ').replace(/^[,.\s]+/, '').trim();
}
