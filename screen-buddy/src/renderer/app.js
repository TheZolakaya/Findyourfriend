const $ = (id) => document.getElementById(id);
const log = $("log");
const input = $("input");

let settings = {};
let collapsed = false;
let thinking = false;

function time(iso) {
  return new Date(iso || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function addMessage({ who, text, kind, file, at }) {
  const el = document.createElement("div");
  el.className = `msg ${who}${kind === "auto" ? " auto" : ""}`;
  el.textContent = text;

  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = (kind === "auto" ? "noticed on its own · " : "") + time(at);
  if (file) {
    meta.append(" · ");
    const link = document.createElement("button");
    link.textContent = "screenshot";
    link.onclick = () => window.buddy.openFile(file);
    meta.append(link);
  }
  el.append(meta);

  log.append(el);
  log.scrollTop = log.scrollHeight;
}

function addStatus(text, cls = "status") {
  // Collapse consecutive status lines into one.
  const last = log.lastElementChild;
  if (cls === "status" && last?.classList.contains("status")) last.remove();
  const el = document.createElement("div");
  el.className = cls === "status" ? "status" : `msg ${cls}`;
  el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
}

function applyTextScale(scale) {
  if (scale) document.documentElement.style.setProperty("--text-scale", scale);
}

async function textSize(step) {
  applyTextScale(await window.buddy.textSize(step));
}

function renderSettings() {
  applyTextScale(settings.textScale);
  $("opacity").value = String(Math.round((settings.opacity ?? 1) * 100));
  $("interval").value = String(settings.intervalMin);
  $("shotWidth").value = String(settings.shotWidth);
  renderVoice();
  $("pause").textContent = settings.paused ? "▶" : "⏸";
  $("pause").title = settings.paused ? "Resume auto check-ins" : "Pause auto check-ins";
  renderDot();
  $("footer").textContent =
    `${settings.backendLabel} · ${settings.hotkey} to show/hide · saves to ${settings.shotsDir}`;
}

// ---- voice ----------------------------------------------------------------

const voice = window.ScreenBuddyVoice;

function renderVoice() {
  const v = voice.status();
  const mic = $("mic");
  mic.className = "icon " + (!settings.voiceIn || !settings.canHear ? "off" : v.hearing ? "hearing" : "on");
  mic.title = !settings.canHear
    ? "Voice needs GROQ_API_KEY in screen-buddy/.env"
    : settings.voiceIn
      ? 'Listening for "Hey Buddy" (click to stop listening)'
      : 'Voice off (click to listen for "Hey Buddy")';
  const sp = $("speak");
  sp.className = "icon " + (!settings.voiceOut ? "off" : v.speaking ? "talking" : "on");
  sp.title = settings.voiceOut
    ? `Speaking replies${settings.hasKokoro ? " as George" : " (built-in voice: no REPLICATE_API_TOKEN)"}. Esc stops; click to mute.`
    : "Replies are silent (click to speak them)";
}

// Start or stop the mic to match the setting.
async function syncMic() {
  const want = Boolean(settings.voiceIn && settings.canHear);
  if (want === voice.status().listening) return;
  try {
    if (want) await voice.start();
    else await voice.stop();
  } catch (err) {
    addStatus(`Couldn't use the microphone: ${err.message}`, "err");
    settings = { ...settings, ...(await window.buddy.setSettings({ voiceIn: false })) };
    renderSettings();
  }
}

$("mic").addEventListener("click", async () => {
  if (!settings.canHear) return addStatus("Voice needs GROQ_API_KEY in screen-buddy/.env, then restart.", "err");
  settings = { ...settings, ...(await window.buddy.setSettings({ voiceIn: !settings.voiceIn })) };
  renderSettings();
  await syncMic();
  addStatus(settings.voiceIn ? 'Listening. Say "Hey Buddy…", or "Buddy, look…" to send your screen.' : "Stopped listening.");
});
$("speak").addEventListener("click", async () => {
  settings = { ...settings, ...(await window.buddy.setSettings({ voiceOut: !settings.voiceOut })) };
  if (!settings.voiceOut) voice.stopSpeaking();
  renderSettings();
});
// Esc cuts the buddy off mid-sentence (same as saying "Buddy, stop").
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && voice.status().speaking) {
    window.buddy.voiceStop();
    voice.stopSpeaking();
  }
});
voice.onChange(() => renderVoice());
window.buddy.onHeard(({ text, withShot }) => addMessage({ who: "me", text: "🎙 " + (withShot ? "📸 " : "") + text }));

function renderDot() {
  const dot = $("dot");
  dot.className = "dot" + (thinking ? " thinking" : settings.paused || !settings.intervalMin ? " paused" : "");
  dot.title = thinking ? "Looking…" : settings.paused ? "Paused" : "Watching";
}

// withShot: also capture the screen and send it along (📸 / Ctrl+Enter).
async function sendMessage(withShot) {
  const text = input.value.trim();
  if (!text && !withShot) return; // nothing to send
  if (thinking) return addStatus("Still thinking about the last one…");
  input.value = "";
  addMessage({ who: "me", text: (withShot ? "📸 " : "") + (text || "(what do you think?)") });
  await window.buddy.send(text, withShot);
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(false);
});
$("shotBtn").addEventListener("click", () => sendMessage(true));
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage(e.ctrlKey || e.metaKey);
  }
});
input.addEventListener("focus", () => ($("badge").hidden = true));

$("interval").addEventListener("change", async (e) => {
  settings = { ...settings, ...(await window.buddy.setSettings({ intervalMin: Number(e.target.value) })) };
  renderSettings();
});
$("shotWidth").addEventListener("change", async (e) => {
  settings = { ...settings, ...(await window.buddy.setSettings({ shotWidth: Number(e.target.value) })) };
  renderSettings();
});
$("pause").addEventListener("click", async () => {
  settings = { ...settings, ...(await window.buddy.setSettings({ paused: !settings.paused })) };
  renderSettings();
  addStatus(settings.paused ? "Paused. I won't look until you message me." : "Watching again.");
});
$("checkNow").addEventListener("click", () => window.buddy.checkNow());
$("folder").addEventListener("click", () => window.buddy.openFolder());
$("hide").addEventListener("click", () => window.buddy.hide());
$("smaller").addEventListener("click", () => textSize(-1));
$("bigger").addEventListener("click", () => textSize(1));
$("opacity").addEventListener("input", (e) => window.buddy.setOpacity(Number(e.target.value) / 100));
$("winSmaller").addEventListener("click", () => window.buddy.resize(-1));
$("winBigger").addEventListener("click", () => window.buddy.resize(1));
// Ctrl +/-/0 = text size; Ctrl+Shift +/- = window size.
document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  // e.code is the physical key, so Shift doesn't turn "=" into "+".
  const step = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1, Digit0: 0, Numpad0: 0 }[e.code];
  if (step === undefined) return;
  e.preventDefault();
  if (e.shiftKey) window.buddy.resize(step);
  else textSize(step);
});
$("collapse").addEventListener("click", () => {
  collapsed = !collapsed;
  document.body.classList.toggle("collapsed", collapsed);
  window.buddy.collapse(collapsed);
});

// The reply bubble that fills in while Claude is still writing.
let liveEl = null;
function clearLive() {
  liveEl?.remove();
  liveEl = null;
}
window.buddy.onDelta(({ text }) => {
  if (!liveEl) {
    liveEl = document.createElement("div");
    liveEl.className = "msg them live";
    log.append(liveEl);
  }
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  liveEl.textContent = text;
  if (atBottom) log.scrollTop = log.scrollHeight;
});

window.buddy.onReply((r) => {
  clearLive();
  addMessage({ who: "them", ...r });
  if (r.kind === "auto" && (collapsed || !document.hasFocus())) $("badge").hidden = false;
});
window.buddy.onStatus((s) => addStatus(s.text));
window.buddy.onError((e) => {
  clearLive();
  addStatus(e.text, "err");
});
window.buddy.onThinking((t) => {
  thinking = t;
  if (!t) clearLive();
  $("sendBtn").disabled = t;
  $("shotBtn").disabled = t;
  renderDot();
});
window.buddy.onSettings((s) => {
  settings = s;
  renderSettings();
});
window.buddy.onFocusInput(() => input.focus());

(async () => {
  settings = await window.buddy.getSettings();
  renderSettings();
  await syncMic();
  addStatus(
    settings.live
      ? "Hey! I'll glance at your screen now and then and only speak up if something's worth it. Message me any time."
      : "Running in sample mode. Add your API key to screen-buddy/.env for real replies.",
  );
  input.focus();
})();
