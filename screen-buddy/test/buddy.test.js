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

test("ClaudeCodeBuddy resumes the given session and points at the screenshot", async () => {
  let call;
  const b = new ClaudeCodeBuddy({
    sessionId: "sess-123",
    shotsDir: "/shots",
    run: async (bin, args, cwd) => {
      call = { bin, args, cwd };
      return JSON.stringify({ type: "result", result: "I see a failing test.", session_id: "sess-123" });
    },
  });
  const r = await b.look({ kind: "user", message: "what's wrong?", file: "/shots/a.png", when: "10:00" });
  assert.deepStrictEqual(r, { text: "I see a failing test.", quiet: false });
  assert.strictEqual(call.bin, "claude");
  const a = call.args;
  assert.strictEqual(a[a.indexOf("--resume") + 1], "sess-123");
  assert.strictEqual(a[a.indexOf("--allowedTools") + 1], "Read");
  assert.strictEqual(a[a.indexOf("--add-dir") + 1], "/shots");
  const prompt = a[a.indexOf("-p") + 1];
  assert.match(prompt, /what's wrong\?/);
  assert.match(prompt, /\/shots\/a\.png/);
});

test("ClaudeCodeBuddy: quiet, errors, and session follow", async () => {
  const b = new ClaudeCodeBuddy({
    sessionId: "old",
    run: async () => JSON.stringify({ result: "[quiet]", session_id: "new" }),
  });
  assert.strictEqual((await b.look({ kind: "auto", file: "x.png" })).quiet, true);
  assert.strictEqual(b.sessionId, "new");

  const bad = new ClaudeCodeBuddy({ sessionId: "s", run: async () => JSON.stringify({ is_error: true, result: "No conversation found" }) });
  await assert.rejects(bad.look({ kind: "user", message: "hi", file: "x.png" }), /No conversation found/);
  assert.throws(() => new ClaudeCodeBuddy({}), /SCREEN_BUDDY_SESSION/);
});

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

  const b = new ClaudeCodeBuddy({ sessionId: "abc-123", cwd: "/wrong/place", claudeDir: home, run: async () => "{}" });
  assert.strictEqual(b.cwd, "C:\\Users\\chris\\Findyourfriend");
});
