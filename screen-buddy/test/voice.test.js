const test = require("node:test");
const assert = require("node:assert");
const { parseUtterance } = require("../src/voice/wake");
const { SpeechChunker, pack } = require("../src/voice/chunker");
const { Vad, encodeWav } = require("../src/renderer/vad");
const { transcribe, Speaker, loadVendor, HINT } = require("../src/voice/speech");

// ---- wake words ---------------------------------------------------------

test("wake word: text, screenshot, stop, bare wake, and everything else ignored", () => {
  const cases = [
    ["Hey Buddy, what's the boss weak to?", { kind: "message", withShot: false, text: "What's the boss weak to?" }],
    ["Hey, Buddy. Where do I go next?", { kind: "message", withShot: false, text: "Where do I go next?" }],
    ["Buddy, look. Where's the exit?", { kind: "message", withShot: true, text: "Where's the exit?" }],
    ["Hey buddy look, is that a chest?", { kind: "message", withShot: true, text: "Is that a chest?" }],
    ["Buddy, look.", { kind: "message", withShot: true, text: "" }],
    ["Buddy, stop.", { kind: "stop" }],
    ["Buddy stop talking", { kind: "stop" }],
    ["Okay buddy, quiet!", { kind: "stop" }],
    ["Hey Buddy.", { kind: "wake" }],
    ["Um, hey buddy, how much health does he have?", { kind: "message", withShot: false, text: "How much health does he have?" }],
    ["Bud, what's this item?", { kind: "message", withShot: false, text: "What's this item?" }],
  ];
  for (const [said, want] of cases) assert.deepStrictEqual(parseUtterance(said), want, said);

  for (const said of [
    "Where's the exit?", // no wake word
    "My buddy said to go left.", // name not at the start
    "I need to budget my potions.",
    "That's a Buddhist temple.",
    "Somebody stop him!",
    "",
  ]) {
    assert.deepStrictEqual(parseUtterance(said), { kind: "none" }, said);
  }
  // "stop" inside a real question is a question, not a command
  assert.deepStrictEqual(parseUtterance("Buddy, how do I stop the bleeding?").kind, "message");
});

test("after a bare wake word, the next utterance is the message", () => {
  assert.deepStrictEqual(parseUtterance("Where's the merchant?", { listening: true }), {
    kind: "message",
    withShot: false,
    text: "Where's the merchant?",
  });
  assert.deepStrictEqual(parseUtterance("Look, what is that?", { listening: true }).withShot, true);
  assert.deepStrictEqual(parseUtterance("Where's the merchant?"), { kind: "none" });
});

// ---- cutting replies into pieces -----------------------------------------

test("pack keeps pieces under the limit and splits only at sentence ends when it can", () => {
  const text = "One two three. Four five six! Seven eight nine? Ten.";
  assert.deepStrictEqual(pack(text, 30), ["One two three. Four five six!", "Seven eight nine? Ten."]);
  const long = "word ".repeat(300).trim() + ".";
  const pieces = pack(long, 520);
  assert.ok(pieces.every((p) => p.length <= 520));
  assert.strictEqual(pieces.join(" "), long);
});

test("chunker speaks the first sentence early, waits on half-written ones, and never repeats", () => {
  const c = new SpeechChunker({ max: 520, min: 40 });
  assert.deepStrictEqual(c.update("Go left"), []);
  assert.deepStrictEqual(c.update("Go left at the"), []);
  assert.deepStrictEqual(c.update("Go left at the gate. Then"), ["Go left at the gate."]);
  // a full stop at the very end may be a decimal ("version 3." + "5")
  assert.deepStrictEqual(c.update("Go left at the gate. Then use version 3."), []);
  assert.deepStrictEqual(c.update("Go left at the gate. Then use version 3.5 of"), []);
  // later pieces wait for a decent amount of text
  assert.deepStrictEqual(c.update("Go left at the gate. Then use version 3.5 of the map. It"), []);
  const final = "Go left at the gate. Then use version 3.5 of the map. It shows the hidden path near the river.";
  assert.deepStrictEqual(c.finish(final), ["Then use version 3.5 of the map. It shows the hidden path near the river."]);
  assert.deepStrictEqual(c.finish(final), []);
});

test("chunker says nothing more if the finished reply was rewritten", () => {
  const c = new SpeechChunker({ min: 1 });
  assert.deepStrictEqual(c.update("First thought. More"), ["First thought."]);
  assert.deepStrictEqual(c.finish("A completely different answer."), []);
});

// ---- speech detection -----------------------------------------------------

const frame = (level) => new Float32Array(320).fill(level);

test("vad: ignores quiet and short blips, catches speech with pre-roll, ends after a pause", () => {
  const v = new Vad();
  for (let i = 0; i < 50; i++) assert.strictEqual(v.push(frame(0.002)), null); // room noise
  // a 60 ms click is not speech
  for (let i = 0; i < 3; i++) assert.strictEqual(v.push(frame(0.2)), null);
  for (let i = 0; i < 50; i++) v.push(frame(0.002));

  const events = [];
  for (let i = 0; i < 50; i++) events.push(v.push(frame(0.2))); // 1 s of speech
  for (let i = 0; i < 45; i++) events.push(v.push(frame(0.002))); // 900 ms pause
  const got = events.filter(Boolean);
  assert.deepStrictEqual(got.map((e) => e.type), ["start", "end"]);
  const secs = got[1].samples.length / 16000;
  assert.ok(secs > 1.3 && secs < 2.5, `utterance length ${secs}s includes pre-roll and the pause`);
});

test("vad: a short burst that never reaches the minimum length is dropped", () => {
  const v = new Vad({ minSpeechMs: 400 });
  for (let i = 0; i < 20; i++) v.push(frame(0.002));
  const events = [];
  for (let i = 0; i < 8; i++) events.push(v.push(frame(0.2))); // 160 ms
  for (let i = 0; i < 45; i++) events.push(v.push(frame(0.002)));
  assert.deepStrictEqual(events.filter(Boolean).map((e) => e.type), ["start", "drop"]);
});

test("vad: long talking is cut at the maximum", () => {
  const v = new Vad({ maxSpeechMs: 2000 });
  const events = [];
  for (let i = 0; i < 150; i++) events.push(v.push(frame(0.2)));
  assert.deepStrictEqual(events.filter(Boolean).map((e) => e.type), ["start", "end", "start"]);
});

test("encodeWav writes a valid 16 kHz mono 16-bit WAV", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000);
  const b = Buffer.from(wav);
  assert.strictEqual(b.toString("ascii", 0, 4), "RIFF");
  assert.strictEqual(b.toString("ascii", 8, 12), "WAVE");
  assert.strictEqual(b.readUInt16LE(22), 1);
  assert.strictEqual(b.readUInt32LE(24), 16000);
  assert.strictEqual(b.readUInt32LE(40), 8);
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => b.readInt16LE(44 + i * 2)), [0, 32767, -32768, 16383]);
});

// ---- transcription (Groq) -----------------------------------------------

function fakeGroq(reply, seen) {
  return async (url, init) => {
    seen.url = url;
    seen.auth = init.headers.Authorization;
    seen.fields = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `<file ${v.name}>`]));
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  };
}
const wav = encodeWav(new Float32Array(1600), 16000);

test("transcribe sends the Reader's exact request to Groq and returns the text", async () => {
  const seen = {};
  const r = await transcribe(wav, {
    key: "gsk_test",
    fetchFn: fakeGroq({ text: " Hey Buddy, where am I? ", duration: 1.4, segments: [{ no_speech_prob: 0.01 }] }, seen),
  });
  assert.deepStrictEqual(r, { text: "Hey Buddy, where am I?", secs: 1.4, heard: true });
  assert.strictEqual(seen.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.strictEqual(seen.auth, "Bearer gsk_test");
  assert.deepStrictEqual(seen.fields, {
    file: "<file speech.wav>",
    model: "whisper-large-v3-turbo",
    response_format: "verbose_json",
    temperature: "0",
    prompt: HINT,
  });
});

test("transcribe drops Whisper's echoed hint and probable non-speech", async () => {
  const echo = await transcribe(wav, { key: "k", fetchFn: fakeGroq({ text: HINT, duration: 1 }, {}) });
  assert.strictEqual(echo.heard, false);
  const noise = await transcribe(wav, {
    key: "k",
    fetchFn: fakeGroq({ text: "Hey Buddy.", duration: 1, segments: [{ no_speech_prob: 0.9 }] }, {}),
  });
  assert.strictEqual(noise.heard, false);
  // the hint stripped from beside real speech
  const mixed = await transcribe(wav, { key: "k", fetchFn: fakeGroq({ text: `A question, spoken plainly. Hey Buddy, hi.`, duration: 1 }, {}) });
  assert.strictEqual(mixed.text, "Hey Buddy, hi.");
});

test("transcribe refuses without a key and surfaces Groq errors", async () => {
  await assert.rejects(transcribe(wav, { key: "" }), /GROQ_API_KEY/);
  const fail = async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 });
  await assert.rejects(transcribe(wav, { key: "bad", fetchFn: fail }), /Invalid API Key/);
});

// ---- the vendor Kokoro module, unchanged ------------------------------------

test("vendor kokoro speaks George on the warm copy at 0.95 and cleans text for the ear", async () => {
  const k = await loadVendor();
  assert.strictEqual(k.MAX_PIECE, 520);
  // the Reader's own production cleanup: shouting comes down, dashes and semicolons become pauses
  assert.strictEqual(k.forTheEar("THE BOSS — he's weak to fire; dodge left."), "The boss, he's weak to fire. dodge left.");
  assert.strictEqual(k.forTheEar("**Go** to the *gate*."), "Go to the gate.");
  const real = globalThis.fetch;
  const saved = process.env.REPLICATE_API_TOKEN;
  process.env.REPLICATE_API_TOKEN = "r8_test";
  const seen = {};
  globalThis.fetch = async (url, init) => {
    seen.url = url;
    seen.auth = init.headers.Authorization;
    seen.body = JSON.parse(init.body);
    return new Response(JSON.stringify({ status: "succeeded", urls: { get: "x" }, output: "https://replicate.delivery/a.wav", metrics: { predict_time: 0.8 } }));
  };
  try {
    const r = await k.speakPiece("Hello.", "bm_george");
    assert.deepStrictEqual(r, { url: "https://replicate.delivery/a.wav", secs: 0.8 });
    assert.strictEqual(seen.url, "https://api.replicate.com/v1/predictions");
    assert.strictEqual(seen.auth, "Bearer r8_test");
    assert.deepStrictEqual(seen.body, {
      version: "f559560eb822dc509045f3921a1921234918b91739db4bf3daab2169b71c7a13",
      input: { text: "Hello.", voice: "bm_george", speed: 0.95 },
    });
  } finally {
    globalThis.fetch = real;
    if (saved === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = saved;
  }
});

// ---- the speaker --------------------------------------------------------

function fakeVendor(log) {
  return async () => ({
    forTheEar: (t) => t.toUpperCase() === t ? t.toLowerCase() : t,
    speakPiece: async (text, voice) => {
      log.push(["speak", text, voice]);
      await new Promise((r) => setTimeout(r, 5));
      return { url: `https://replicate.delivery/${log.length}.wav` };
    },
  });
}
const audioFetch = async (url) => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } });

test("speaker generates pieces in order and hands each clip to the window", async () => {
  const log = [];
  const sent = [];
  const sp = new Speaker({ send: (ch, p) => sent.push([ch, p]), token: "r8", fetchFn: audioFetch, vendor: fakeVendor(log) });
  sp.say("First.");
  sp.say("Second.");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepStrictEqual(log.map((l) => l[1]), ["First.", "Second."]);
  assert.ok(log.every((l) => l[2] === "bm_george"));
  const plays = sent.filter(([ch]) => ch === "voice:play").map(([, p]) => p);
  assert.deepStrictEqual(plays.map((p) => p.seq), [0, 1]);
  assert.deepStrictEqual([...plays[0].audio], [1, 2, 3]);
  assert.strictEqual(plays[0].mime, "audio/wav");
  assert.deepStrictEqual(sent[0][0], "voice:tts-busy");
  assert.deepStrictEqual(sent.at(-1)[0], "voice:tts-idle");
});

test("speaker stop drops queued pieces and discards one already in flight", async () => {
  const log = [];
  const sent = [];
  const sp = new Speaker({ send: (ch, p) => sent.push([ch, p]), token: "r8", fetchFn: audioFetch, vendor: fakeVendor(log) });
  sp.say("One.");
  sp.say("Two.");
  sp.say("Three.");
  await new Promise((r) => setTimeout(r, 1)); // "One." is being generated
  sp.stop();
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(sent.filter(([ch]) => ch === "voice:play").length, 0);
  assert.ok(sent.some(([ch]) => ch === "voice:stop"));
  assert.strictEqual(sent.at(-1)[0], "voice:tts-idle");
  // and it keeps working afterwards
  sp.say("Four.");
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(sent.filter(([ch]) => ch === "voice:play").length, 1);
});

test("speaker falls back to the built-in voice without a token or when Kokoro fails", async () => {
  const sent = [];
  const noToken = new Speaker({ send: (ch, p) => sent.push([ch, p]), token: "", vendor: fakeVendor([]) });
  noToken.say("Hi there.");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepStrictEqual(sent.find(([ch]) => ch === "voice:play")[1], { seq: 0, text: "Hi there." });

  const sent2 = [];
  const broken = new Speaker({
    send: (ch, p) => sent2.push([ch, p]),
    token: "r8",
    vendor: async () => ({ forTheEar: (t) => t, speakPiece: async () => { throw new Error("replicate 500"); } }),
  });
  broken.say("Still talking.");
  broken.say("Again.");
  await new Promise((r) => setTimeout(r, 10));
  const plays = sent2.filter(([ch]) => ch === "voice:play").map(([, p]) => p.text);
  assert.deepStrictEqual(plays, ["Still talking.", "Again."]);
  // the problem is reported once, not per sentence
  assert.strictEqual(sent2.filter(([ch]) => ch === "buddy:status").length, 1);
});
