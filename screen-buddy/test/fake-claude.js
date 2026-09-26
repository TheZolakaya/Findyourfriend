// Stand-in for `claude -p --input-format stream-json --output-format stream-json`.
// Behaviour is steered by env vars so tests can exercise edge cases.
const fs = require("fs");
const args = process.argv.slice(2);
const log = (o) => process.env.FAKE_LOG && fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ pid: process.pid, ...o }) + "\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

log({ event: "start", args });
if (process.env.FAKE_NOT_FOUND) {
  process.stderr.write("No conversation found with session ID: x\n");
  process.exit(1);
}
const r = args.indexOf("--resume");
const sid = r >= 0 ? args[r + 1] : "sess-from-continue";
out({ type: "system", subtype: "init", session_id: sid });

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    const content = msg.message.content;
    const text = content.find((c) => c.type === "text").text;
    log({ event: "message", types: content.map((c) => c.type), text });
    if (text.includes("crash")) process.exit(3);
    const reply = text.includes("AUTO CHECK-IN") ? "[quiet]" : "Hello there";
    const pieces = reply.match(/.{1,5}/g);
    const ms = Number(process.env.FAKE_CHUNK_MS) || 0;
    const emit = (k) => {
      if (k < pieces.length) {
        out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: pieces[k] } } });
        return ms ? setTimeout(() => emit(k + 1), ms) : emit(k + 1);
      }
      out({ type: "result", subtype: "success", is_error: false, result: reply, session_id: sid });
    };
    emit(0);
  }
});
process.stdin.on("end", () => {
  log({ event: "stdin-end" });
  if (process.env.FAKE_IGNORE_EOF) return setInterval(() => {}, 1000); // hang
  process.exit(0);
});
