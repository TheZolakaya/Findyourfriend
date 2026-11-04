// Cuts a reply into pieces for Kokoro (at most MAX characters each, the
// Reader's 520), at sentence ends, while the reply is still being written.
// The first piece goes out as soon as one sentence is complete, so the voice
// starts early; later pieces wait for MIN characters so there are fewer calls.

const SENTENCE_END = /[.!?…](?:["')\]]+)?(?=\s|$)|\n+/g;

// Split one over-long stretch at the last comma or space before the limit.
function hardSplit(text, max) {
  const out = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    if (cut < max * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    else cut += 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Pack sentences into pieces of at most max characters.
function pack(text, max) {
  const sentences = [];
  let last = 0;
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index + m[0].length;
    sentences.push(text.slice(last, end));
    last = end;
  }
  if (last < text.length) sentences.push(text.slice(last));

  const pieces = [];
  let cur = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > max) {
      if (cur) pieces.push(cur);
      cur = "";
      pieces.push(...hardSplit(s, max));
    } else if (!cur) cur = s;
    else if (cur.length + 1 + s.length <= max) cur += " " + s;
    else {
      pieces.push(cur);
      cur = s;
    }
  }
  if (cur) pieces.push(cur);
  return pieces;
}

class SpeechChunker {
  constructor({ max = 520, min = 160 } = {}) {
    this.max = max;
    this.min = min;
    this.spoken = ""; // the start of the reply already handed out
    this.sent = 0; // pieces handed out
    this.text = "";
  }

  // text: the whole reply so far. Returns pieces ready to speak now.
  update(text) {
    const t = String(text || "");
    if (!t.startsWith(this.spoken)) return []; // rewritten under us; finish() decides
    this.text = t;
    const pending = t.slice(this.spoken.length);
    // Only complete sentences are spoken before the reply is finished.
    let end = -1;
    // A full stop at the very end may not be one yet ("version 3." + "5").
    for (const m of pending.matchAll(SENTENCE_END)) {
      if (m.index + m[0].length < pending.length) end = m.index + m[0].length;
    }
    if (end <= 0) return [];
    const ready = pending.slice(0, end);
    if (this.sent > 0 && ready.trim().length < this.min) return [];
    this.spoken += ready;
    const pieces = pack(ready, this.max);
    this.sent += pieces.length;
    return pieces;
  }

  // final: the finished reply. Returns whatever hasn't been spoken yet. If the
  // finished reply doesn't continue what was already spoken (the backend
  // rewrote it), nothing more is said rather than repeating or garbling.
  finish(final) {
    const text = String(final ?? this.text);
    if (!text.startsWith(this.spoken)) return [];
    const pieces = pack(text.slice(this.spoken.length), this.max);
    this.spoken = text;
    this.sent += pieces.length;
    return pieces;
  }
}

module.exports = { SpeechChunker, pack };
