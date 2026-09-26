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
