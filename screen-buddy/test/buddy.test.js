const test = require("node:test");
const assert = require("node:assert");
const { Buddy, isQuiet, trimHistory, QUIET_TOKEN } = require("../src/buddy");
const { toGray, frameDiff } = require("../src/frames");

function fakeClient(replyText, capture = []) {
  return {
    beta: {
      messages: {
        create: async (params) => {
          capture.push(params);
          return { stop_reason: "end_turn", content: [{ type: "text", text: replyText }] };
        },
      },
    },
  };
}

const shot = { jpegBase64: "AAAA", file: "/tmp/shot.png", when: "10:00" };

test("isQuiet recognizes the quiet token loosely", () => {
  assert.ok(isQuiet("[quiet]"));
  assert.ok(isQuiet("  [QUIET]\n"));
  assert.ok(isQuiet(""));
  assert.ok(!isQuiet("You have a typo on line 3"));
});

test("trimHistory keeps the tail and starts on a user turn", () => {
  const h = [];
  for (let i = 0; i < 30; i++) h.push({ role: "user", content: `u${i}` }, { role: "assistant", content: `a${i}` });
  const t = trimHistory(h, 5);
  assert.strictEqual(t.length, 10);
  assert.strictEqual(t[0].role, "user");
  assert.strictEqual(t[0].content, "u25");
  assert.strictEqual(trimHistory([{ role: "assistant", content: "x" }]).length, 0);
});

test("user message sends image + message, and remembers text only", async () => {
  const calls = [];
  const b = new Buddy({ client: fakeClient("Looks like a missing semicolon.", calls) });
  const r = await b.look({ kind: "user", message: "why won't this build?", ...shot });
  assert.strictEqual(r.quiet, false);
  const last = calls[0].messages.at(-1);
  assert.strictEqual(last.content[0].type, "image");
  assert.match(last.content[1].text, /why won't this build\?/);
  assert.strictEqual(b.history.length, 2);
  assert.strictEqual(typeof b.history[0].content, "string"); // no image kept in memory
});

test("quiet auto check-ins are not stored in history", async () => {
  const b = new Buddy({ client: fakeClient(QUIET_TOKEN) });
  const r = await b.look({ kind: "auto", ...shot });
  assert.strictEqual(r.quiet, true);
  assert.strictEqual(b.history.length, 0);
});

test("second call includes prior turn as history", async () => {
  const calls = [];
  const b = new Buddy({ client: fakeClient("sure", calls) });
  await b.look({ kind: "user", message: "one", ...shot });
  await b.look({ kind: "user", message: "two", ...shot });
  assert.strictEqual(calls[1].messages.length, 3);
  const images = calls[1].messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === "image");
  assert.strictEqual(images.length, 1); // only the current screenshot is sent
});

test("refusal on auto check-in stays quiet", async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } };
  const b = new Buddy({ client });
  assert.strictEqual((await b.look({ kind: "auto", ...shot })).quiet, true);
});

test("sample mode (no key) replies without calling the API", async () => {
  const b = new Buddy({});
  assert.strictEqual(b.live, false);
  const r = await b.look({ kind: "user", message: "hi", ...shot });
  assert.match(r.text, /Sample mode/);
  assert.strictEqual((await b.look({ kind: "auto", ...shot })).quiet, true);
});

test("frameDiff detects change", () => {
  const a = toGray(Buffer.alloc(64 * 4, 100));
  const same = toGray(Buffer.alloc(64 * 4, 100));
  const diff = toGray(Buffer.alloc(64 * 4, 200));
  assert.strictEqual(frameDiff(a, same), 0);
  assert.ok(frameDiff(a, diff) > 50);
  assert.strictEqual(frameDiff(a, null), 255);
});

const { ClaudeCodeBuddy } = require("../src/buddy");



const { findSessionCwd } = require("../src/buddy");
const fs = require("fs");
const os = require("os");
const path = require("path");

test("findSessionCwd locates the folder a session was started in", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-home-"));
  const dir = path.join(home, "projects", "C--Users-chris-Findyourfriend");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "abc-123.jsonl"),
    ['{"type":"summary"}', JSON.stringify({ type: "user", cwd: "C:\\Users\\chris\\Findyourfriend" })].join("\n"),
  );
  assert.strictEqual(findSessionCwd("abc-123", home), "C:\\Users\\chris\\Findyourfriend");
  assert.strictEqual(findSessionCwd("missing", home), null);
  assert.strictEqual(findSessionCwd("abc-123", path.join(home, "nope")), null);

  const b = new ClaudeCodeBuddy({ sessionId: "abc-123", cwd: "/wrong/place", claudeDir: home, });
  assert.strictEqual(b.cwd, "C:\\Users\\chris\\Findyourfriend");
});


// --- persistent Claude Code process (stream-json) ---

const FAKE = path.join(__dirname, "fake-claude.js");
function fakeBuddy(opts = {}, env = {}) {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fake-")), "log.jsonl");
  const { spawn } = require("child_process");
  const b = new ClaudeCodeBuddy({
    sessionId: "sess-1",
    bin: process.execPath,
    binArgs: [FAKE],
    idleMs: 0,
    spawnFn: (bin, args, o) => spawn(bin, args, { ...o, env: { ...o.env, FAKE_LOG: logFile, ...env } }),
    ...opts,
  });
  const events = () =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { b, events };
}
const shotArgs = { jpegBase64: "AAAA", file: "/shots/a.png", when: "10:00" };

test("keeps one claude running across messages, sends the image inline, streams text", async () => {
  const { b, events } = fakeBuddy();
  const seen = [];
  const r1 = await b.look({ kind: "user", message: "what's this?", ...shotArgs, onText: (t) => seen.push(t) });
  assert.deepStrictEqual(r1, { text: "Hello there", quiet: false });
  assert.deepStrictEqual(seen, ["Hello", "Hello ther", "Hello there"]);
  const r2 = await b.look({ kind: "auto", ...shotArgs });
  assert.strictEqual(r2.quiet, true);
  await b.close();

  const ev = events();
  const starts = ev.filter((e) => e.event === "start");
  assert.strictEqual(starts.length, 1, "only one claude process");
  const a = starts[0].args;
  assert.ok(a.includes("stream-json") && a.includes("--include-partial-messages"));
  assert.strictEqual(a[a.indexOf("--resume") + 1], "sess-1");
  const msgs = ev.filter((e) => e.event === "message");
  assert.deepStrictEqual(msgs[0].types, ["image", "text"]);
  assert.match(msgs[0].text, /what's this\?/);
  assert.ok(ev.some((e) => e.event === "stdin-end"), "closed by ending stdin");
});

test("close() lets claude exit on its own and frees the process", async () => {
  const { b, events } = fakeBuddy();
  await b.look({ kind: "user", message: "hi", ...shotArgs });
  assert.ok(b.running);
  await b.close();
  assert.ok(!b.running);
  assert.ok(events().some((e) => e.event === "stdin-end"));
  await b.close(); // second close is harmless
});

test("close() force-stops a claude that won't exit", async () => {
  const { b } = fakeBuddy({}, { FAKE_IGNORE_EOF: "1" });
  await b.look({ kind: "user", message: "hi", ...shotArgs });
  const t = Date.now();
  await b.close(300);
  assert.ok(Date.now() - t < 2000);
  assert.ok(!b.running);
});

test("a crash mid-reply is reported and the next message restarts claude", async () => {
  const { b, events } = fakeBuddy();
  await assert.rejects(b.look({ kind: "user", message: "crash please", ...shotArgs }), /stopped unexpectedly/);
  const r = await b.look({ kind: "user", message: "hi again", ...shotArgs });
  assert.strictEqual(r.text, "Hello there");
  await b.close();
  assert.strictEqual(events().filter((e) => e.event === "start").length, 2);
});

test("unknown session gives a helpful error", async () => {
  const { b } = fakeBuddy({}, { FAKE_NOT_FOUND: "1" });
  await assert.rejects(b.look({ kind: "user", message: "hi", ...shotArgs }), /can't find session sess-1/);
});

test("'latest' uses --continue, then pins the session it gets", async () => {
  const { b, events } = fakeBuddy({ sessionId: "latest" });
  await b.look({ kind: "user", message: "hi", ...shotArgs });
  assert.strictEqual(b.sessionId, "sess-from-continue");
  await b.close();
  await b.look({ kind: "user", message: "again", ...shotArgs });
  await b.close();
  const starts = events().filter((e) => e.event === "start");
  assert.ok(starts[0].args.includes("--continue"));
  assert.strictEqual(starts[1].args[starts[1].args.indexOf("--resume") + 1], "sess-from-continue");
});

test("idle timeout shuts claude down to free the session", async () => {
  const { b, events } = fakeBuddy({ idleMs: 150 });
  await b.look({ kind: "user", message: "hi", ...shotArgs });
  assert.ok(b.running);
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(!b.running);
  assert.ok(events().some((e) => e.event === "stdin-end"));
});

test("a second message while one is in flight is refused, not interleaved", async () => {
  const { b } = fakeBuddy();
  const first = b.look({ kind: "user", message: "one", ...shotArgs });
  await assert.rejects(b.look({ kind: "user", message: "two", ...shotArgs }), /Still answering/);
  await first;
  await b.close();
});

test("child claude doesn't inherit a parent Claude Code session", () => {
  const { childEnv } = require("../src/buddy");
  const env = childEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "parent", CLAUDE_CONFIG_DIR: "/c" });
  assert.deepStrictEqual(env, { PATH: "/bin", CLAUDE_CONFIG_DIR: "/c" });
});

test("warm() starts claude before the first message, and it gets reused", async () => {
  const { b, events } = fakeBuddy();
  b.warm();
  assert.ok(b.running);
  await b.look({ kind: "user", message: "hi", ...shotArgs });
  await b.close();
  assert.strictEqual(events().filter((e) => e.event === "start").length, 1);
});
