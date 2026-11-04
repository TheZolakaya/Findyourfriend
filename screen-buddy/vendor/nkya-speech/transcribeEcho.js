// .759 (2026-10-13): Whisper, given a punctuation hint as its `prompt`, ECHOES THE HINT when the clip holds no speech
// (the founder's desktop mic recorded silence; the question box filled with "A question, spoken plainly." three times).
// This strips any sentence of the transcript that is the hint, or a sentence of the hint, and says whether it had to.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/** @returns {{ text: string, echoed: boolean }} the transcript with the hint's sentences removed; echoed = something was removed */
export function stripPromptEcho(text, prompt) {
  const hint = new Set([norm(prompt), ...sentences(prompt).map(norm)].filter(Boolean));
  const parts = sentences(text);
  const kept = parts.filter((p) => !hint.has(norm(p)));
  return { text: kept.join(' ').trim(), echoed: kept.length < parts.length };
}
