// The AI side of Screen Buddy: builds the prompt, calls Claude, and keeps a
// short rolling memory. Pure Node (no Electron) so it can be unit-tested.
const Anthropic = require("@anthropic-ai/sdk");

const QUIET_TOKEN = "[quiet]";
const MAX_HISTORY_TURNS = 20; // user+assistant pairs kept as text-only memory

const SYSTEM_PROMPT = `You are Screen Buddy, a friendly AI companion who can see the user's screen.
You get a screenshot of their whole screen along with each message.

Two kinds of turns:
1. USER MESSAGE: the user typed something to you. Answer it, using the screenshot for context. Be concise and conversational, like a friend looking over their shoulder. Point at specific things on screen when it helps.
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
  return [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
    { type: "text", text: header },
  ];
}

// What we remember about a turn once its screenshot is gone (images are only
// sent for the current turn to keep cost down).
function historyText({ kind, message, when, file }) {
  const head = kind === "auto" ? `AUTO CHECK-IN at ${when}` : `USER MESSAGE at ${when}: ${message}`;
  return `${head}\n(screenshot saved as ${file}, no longer attached)`;
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

  // kind: "user" | "auto". Returns { text, quiet }.
  async look({ kind, message, jpegBase64, file, when = new Date().toLocaleTimeString() }) {
    if (!this.client) {
      const text =
        kind === "auto"
          ? QUIET_TOKEN
          : "(Sample mode: no API key set.) Screenshot saved. Add ANTHROPIC_API_KEY to screen-buddy/.env and restart to get real replies.";
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
