// Turns a transcript into a command. Only speech that starts with the wake
// word does anything; everything else is ignored (and never logged).
//
//   "Hey Buddy, what's the boss weak to?"  -> message, text only
//   "Buddy, look. Where's the exit?"       -> message, with a screenshot
//   "Buddy, stop."                         -> stop talking
//   "Hey Buddy."                           -> wake only: the next thing said is the message

const SEP = "[\\s,.!?:;\\-–—]";
// Optional filler, optional greeting, then the name. Whisper writes the name a
// few ways ("Buddy", "buddy", "Budy"); "bud" alone is accepted too.
const WAKE = new RegExp(
  `^\\s*(?:(?:um+|uh+|oh|so)${SEP}+)?(?:(?:hey|hi|hello|okay|ok|yo)${SEP}+)?bud(?:dy|die|y)?\\b${SEP}*`,
  "i",
);
const LOOK = new RegExp(`^look\\b${SEP}*`, "i");
const STOP = new RegExp(
  `^(?:ok(?:ay)?${SEP}+)?(?:stop|quiet|be quiet|shut up|hush|enough|that's enough|cancel)(?:\\s+(?:talking|it|now|please))?${SEP}*$`,
  "i",
);

function tidy(s) {
  const t = String(s || "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

// Text after a wake word (or said during the listening window): look / stop / message.
function parseRest(rest) {
  const r = String(rest || "").trim();
  if (STOP.test(r)) return { kind: "stop" };
  const look = r.match(LOOK);
  if (look) return { kind: "message", withShot: true, text: tidy(r.slice(look[0].length)) };
  return { kind: "message", withShot: false, text: tidy(r) };
}

/**
 * @param {string} transcript
 * @param {{ listening?: boolean }} opts listening: the wake word was just said
 *   on its own, so this utterance is the message even without it.
 * @returns {{kind:"none"} | {kind:"stop"} | {kind:"wake"} |
 *           {kind:"message", withShot:boolean, text:string}}
 */
function parseUtterance(transcript, { listening = false } = {}) {
  const t = String(transcript || "").trim();
  if (!t) return { kind: "none" };
  const m = t.match(WAKE);
  if (!m) return listening ? parseRest(t) : { kind: "none" };
  const rest = t.slice(m[0].length);
  if (!rest.trim()) return { kind: "wake" };
  return parseRest(rest);
}

module.exports = { parseUtterance };
