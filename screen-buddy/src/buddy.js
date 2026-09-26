// The AI side of Screen Buddy: builds the prompt, calls Claude, and keeps a
// short rolling memory. Pure Node (no Electron) so it can be unit-tested.
const Anthropic = require("@anthropic-ai/sdk");

const QUIET_TOKEN = "[quiet]";
const MAX_HISTORY_TURNS = 20; // user+assistant pairs kept as text-only memory

const SYSTEM_PROMPT = `You are Screen Buddy, a friendly AI companion who can see the user's screen.
Auto check-ins always include a screenshot of their whole screen; their own messages include one only when they choose to send it.

Two kinds of turns:
1. USER MESSAGE: the user typed something to you. Answer it, using the screenshot for context if one is attached. If none is attached, just chat; don't guess about what's on screen now. Be concise and conversational, like a friend looking over their shoulder. Point at specific things on screen when it helps.
2. AUTO CHECK-IN: nobody asked you anything; you're just glancing at the screen on a timer. Only speak up if there's something genuinely worth saying: an error or bug you can see, a likely mistake, a useful tip for exactly what they're doing, or a quick friendly remark if it's been a while. If there's nothing worth interrupting for, reply with exactly ${QUIET_TOKEN} and nothing else. Most check-ins should be ${QUIET_TOKEN}. Never comment on the same thing twice.

Keep replies short (1-4 sentences) unless the user asks for detail. Plain text, no markdown headings.
Never read out or repeat passwords, keys, or other secrets you see on screen.`;

function isQuiet(text) {
  return !text || text.trim().toLowerCase() === QUIET_TOKEN;
}

// Keep only the last N turns, and always start on a user turn (API requirement).
function trimHistory(history, maxTurns = MAX_HISTORY_TURNS) {
  let trimmed = history.slice(-maxTurns * 2);
  while (trimmed.length && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  return trimmed;
}

function buildUserContent({ kind, message, jpegBase64, when }) {
  const header =
    kind === "auto"
      ? `AUTO CHECK-IN at ${when}. Nobody asked you anything.`
      : `USER MESSAGE at ${when}: ${message}`;
  const content = [{ type: "text", text: jpegBase64 ? header : `${header}\n(no screenshot with this message)` }];
  if (jpegBase64) content.unshift({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } });
  return content;
}

// What we remember about a turn once its screenshot is gone (images are only
// sent for the current turn to keep cost down).
function historyText({ kind, message, when, file }) {
  const head = kind === "auto" ? `AUTO CHECK-IN at ${when}` : `USER MESSAGE at ${when}: ${message}`;
  return file ? `${head}\n(screenshot saved as ${file}, no longer attached)` : head;
}

class Buddy {
  constructor({ apiKey, model, client } = {}) {
    this.model = model || "claude-opus-5";
    this.history = [];
    this.client = client || (apiKey ? new Anthropic({ apiKey }) : null);
  }

  get live() {
    return Boolean(this.client);
  }

  warm() {} // nothing to start; matches ClaudeCodeBuddy
  async close() {}

  // kind: "user" | "auto". Returns { text, quiet }.
  async look({ kind, message, jpegBase64, file, when = new Date().toLocaleTimeString() }) {
    if (!this.client) {
      const text =
        kind === "auto"
          ? QUIET_TOKEN
          : `(Sample mode: no API key set.)${file ? " Screenshot saved." : ""} Add ANTHROPIC_API_KEY to screen-buddy/.env and restart to get real replies.`;
      return this._remember({ kind, message, when, file }, text);
    }

    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: kind === "auto" ? "low" : "medium" },
      cache_control: { type: "ephemeral" },
      system: SYSTEM_PROMPT,
      messages: [
        ...trimHistory(this.history),
        { role: "user", content: buildUserContent({ kind, message, jpegBase64, when }) },
      ],
    });

    if (response.stop_reason === "refusal") {
      const text = kind === "auto" ? QUIET_TOKEN : "I can't help with what's on screen right now.";
      return this._remember({ kind, message, when, file }, text);
    }

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return this._remember({ kind, message, when, file }, text || QUIET_TOKEN);
  }

  _remember(turn, text) {
    const quiet = isQuiet(text);
    // Quiet auto check-ins aren't worth remembering.
    if (!(turn.kind === "auto" && quiet)) {
      this.history.push({ role: "user", content: historyText(turn) });
      this.history.push({ role: "assistant", content: text });
      this.history = trimHistory(this.history);
    }
    return { text, quiet };
  }
}

module.exports = { Buddy, isQuiet, trimHistory, buildUserContent, QUIET_TOKEN, SYSTEM_PROMPT };

// Talks to an existing Claude Code session (e.g. one you teleported from
// claude.ai/code), so the buddy is *that* Claude, with its memory of your
// project and conversation.
//
// One `claude` process is kept running for the whole app (stream-json in and
// out) instead of starting a new one per message: no startup cost, the
// screenshot goes in as an image block (no Read-tool round trip), and reply
// text streams back as it's written. Closing stdin makes claude finish and
// exit on its own, which frees the session for other clients (VS Code etc).
class ClaudeCodeBuddy {
  constructor({
    sessionId,
    cwd,
    shotsDir,
    bin = "claude",
    binArgs = [],
    model,
    claudeDir,
    idleMs = 10 * 60 * 1000,
    turnTimeoutMs = 5 * 60 * 1000,
    spawnFn,
  } = {}) {
    // "latest" (or blank) = the most recent session in `cwd`; we then stick to
    // whatever session that turns out to be.
    this.sessionId = !sessionId || sessionId === "latest" ? null : sessionId;
    // Claude Code only finds a session when run from the folder it was
    // started in, so look that up rather than trusting the config.
    this.cwd = (this.sessionId && findSessionCwd(this.sessionId, claudeDir)) || cwd || process.cwd();
    this.shotsDir = shotsDir;
    this.bin = bin;
    this.binArgs = binArgs;
    this.model = model;
    this.idleMs = idleMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.spawnFn = spawnFn || require("child_process").spawn;
    this.live = true;
    this.proc = null;
    this.pending = null;
    this.idleTimer = null;
  }

  args() {
    const a = [
      ...this.binArgs,
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      ...(this.sessionId ? ["--resume", this.sessionId] : ["--continue"]),
      "--allowedTools", "Read",
      "--append-system-prompt", SYSTEM_PROMPT,
    ];
    if (this.shotsDir) a.push("--add-dir", this.shotsDir);
    if (this.model) a.push("--model", this.model);
    return a;
  }

  get running() {
    return Boolean(this.proc);
  }

  _start() {
    const proc = this.spawnFn(this.bin, this.args(), {
      cwd: this.cwd,
      env: childEnv(process.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.proc = proc;
    proc.stderrTail = "";
    let buf = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this._onLine(line);
      }
    });
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      proc.stderrTail = (proc.stderrTail + chunk).slice(-2000);
    });
    proc.on("error", (err) => this._onExit(proc, err));
    proc.on("exit", (code, signal) => this._onExit(proc, null, code, signal));
    proc.stdin.on("error", () => {}); // EPIPE if claude died; handled via exit
  }

  _onLine(line) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return; // not a protocol line
    }
    if (m.type === "system" && m.subtype === "init" && m.session_id) {
      this.sessionId = m.session_id; // pin, so a restart resumes the same session
    }
    const p = this.pending;
    if (!p) return;
    if (m.type === "stream_event") {
      const e = m.event;
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
        p.text += e.delta.text;
        p.onText?.(p.text);
      }
    } else if (m.type === "result") {
      if (m.session_id) this.sessionId = m.session_id;
      if (m.is_error) {
        const msg = String(m.result || m.subtype || "Claude Code returned an error");
        this._settle(new Error(/No conversation found/i.test(msg) ? notFoundMessage(this.sessionId, this.cwd) : msg));
      } else {
        const text = String(m.result ?? p.text).trim() || QUIET_TOKEN;
        this._settle(null, { text, quiet: isQuiet(text) });
      }
    }
  }

  _onExit(proc, err, code, signal) {
    if (this.proc === proc) this.proc = null;
    proc.exited = true;
    proc.emit?.("buddy-exit");
    if (!this.pending) return;
    const tail = proc.stderrTail || "";
    let msg;
    if (/No conversation found/i.test(tail)) msg = notFoundMessage(this.sessionId, this.cwd);
    else if (err && (err.code === "ENOENT" || err.code === "EINVAL")) {
      msg =
        process.platform === "win32"
          ? "claude failed (install Claude Code with the native installer so claude.exe exists, or set SCREEN_BUDDY_CLAUDE_BIN to its full path)"
          : "claude failed (is Claude Code installed and on your PATH?)";
    } else {
      msg = `claude stopped unexpectedly (${err ? err.message : `exit ${code ?? signal}`})${tail ? ": " + tail.trim().slice(-300) : ""}`;
    }
    this._settle(new Error(msg));
  }

  _settle(err, value) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    this._armIdle();
    if (err) p.reject(err);
    else p.resolve(value);
  }

  // Free the session when nobody has talked to it for a while; the next
  // message just starts claude again.
  _armIdle() {
    clearTimeout(this.idleTimer);
    if (this.idleMs > 0) this.idleTimer = setTimeout(() => this.close(), this.idleMs);
  }

  // Start claude ahead of the first message so its startup doesn't count
  // against the reply. The idle timer still frees the session if unused.
  warm() {
    if (!this.proc && !this.pending) {
      this._start();
      this._armIdle();
    }
  }

  // onText(textSoFar) is called as the reply streams in.
  look({ kind, message, jpegBase64, file, when = new Date().toLocaleTimeString(), onText }) {
    if (this.pending) return Promise.reject(new Error("Still answering the last message"));
    clearTimeout(this.idleTimer);
    if (!this.proc) this._start();
    const head =
      kind === "auto"
        ? `[Screen Buddy] AUTO CHECK-IN at ${when}. Nobody asked you anything. Reply ${QUIET_TOKEN} unless something is worth saying.`
        : `[Screen Buddy] USER MESSAGE at ${when}: ${message}`;
    const content = [];
    if (jpegBase64) {
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } });
    }
    content.push({
      type: "text",
      text: jpegBase64
        ? `${head}\n\n(The attached image is my screen right now, also saved at ${file}.)`
        : `${head}\n\n(No screenshot with this message.)`,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._settle(new Error("Claude took too long to answer; restarting it."));
        this._kill();
      }, this.turnTimeoutMs);
      this.pending = { resolve, reject, text: "", onText, timer };
      this.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
    });
  }

  _kill() {
    const proc = this.proc;
    this.proc = null;
    if (proc && !proc.exited) proc.kill();
  }

  // Ask claude to finish and exit (closing stdin lets it save and release the
  // session). If it hasn't exited after timeoutMs, force it.
  close(timeoutMs = 5000) {
    clearTimeout(this.idleTimer);
    const proc = this.proc;
    if (!proc || proc.exited) {
      this.proc = null;
      return Promise.resolve();
    }
    this.proc = null; // new messages start a fresh process
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(force);
        resolve();
      };
      const force = setTimeout(() => {
        if (!proc.exited) proc.kill();
        resolve();
      }, timeoutMs);
      proc.once("buddy-exit", done);
      proc.stdin.end();
    });
  }
}

// If Screen Buddy was started from inside a Claude Code session (e.g. its
// terminal in VS Code), these would make our claude attach to *that* session
// instead of the one we asked for.
const PARENT_SESSION_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PID"];
function childEnv(env) {
  const out = { ...env };
  for (const k of PARENT_SESSION_VARS) delete out[k];
  return out;
}

function claudeHome() {
  const os = require("os");
  const path = require("path");
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// Sessions live at <claude home>/projects/<encoded folder>/<id>.jsonl, and
// each line records the folder ("cwd") the session runs in.
function findSessionCwd(sessionId, claudeDir = claudeHome()) {
  const fs = require("fs");
  const path = require("path");
  const projects = path.join(claudeDir, "projects");
  let dirs;
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const file = path.join(projects, dir, `${sessionId}.jsonl`);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      try {
        const cwd = JSON.parse(line).cwd;
        if (cwd) return cwd;
      } catch {}
    }
  }
  return null;
}

function notFoundMessage(sessionId, cwd) {
  if (!sessionId) {
    return `No Claude Code session found in ${cwd}. Open Claude Code in that folder, send it a message so the session is saved, then restart Screen Buddy.`;
  }
  return (
    `Claude Code can't find session ${sessionId} (looked in ${cwd}). ` +
    `Set SCREEN_BUDDY_SESSION=latest in screen-buddy/.env to use your most recent session there, then restart.`
  );
}

module.exports.ClaudeCodeBuddy = ClaudeCodeBuddy;
module.exports.findSessionCwd = findSessionCwd;
module.exports.childEnv = childEnv;
