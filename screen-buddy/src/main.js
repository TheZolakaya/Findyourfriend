const path = require("path");
const fs = require("fs");
const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Notification,
  screen,
  session,
  shell,
} = require("electron");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { Buddy, ClaudeCodeBuddy } = require("./buddy");
const { toGray, frameDiff, captureSize, normalizeShotWidth, DEFAULT_SHOT_WIDTH } = require("./frames");
const { transcribe, Speaker } = require("./voice/speech");
const { parseUtterance } = require("./voice/wake");
const { SpeechChunker } = require("./voice/chunker");

const SHOTS_DIR = process.env.SCREEN_BUDDY_DIR || path.join(app.getPath("home"), "ScreenBuddy");
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const LOG_FILE = path.join(SHOTS_DIR, "log.jsonl");
const HOTKEY = "CommandOrControl+Shift+Space";
const CHANGE_THRESHOLD = 2; // mean gray-level diff below this = "screen didn't change"

const DEFAULTS = { intervalMin: 5, paused: false, textScale: 1.25, winW: 360, winH: 520, opacity: 1, shotWidth: DEFAULT_SHOT_WIDTH, voiceIn: false, voiceOut: false };
const OPACITY_MIN = 0.3; // never let the panel vanish completely
const BAR_H = 44;
const TEXT_MIN = 0.8;
const TEXT_MAX = 2.5;
const WIN_MIN_W = 280;
const WIN_MIN_H = 240;
let collapsed = false;
let expandedHeight = 0;

let win;
let timer;
let busy = false;
let lastFrame = null;
let settings = loadSettings();
const useClaudeCode = process.env.SCREEN_BUDDY_BACKEND === "claude-code";
const buddy = useClaudeCode
  ? new ClaudeCodeBuddy({
      sessionId: process.env.SCREEN_BUDDY_SESSION,
      cwd: process.env.SCREEN_BUDDY_PROJECT_DIR,
      shotsDir: SHOTS_DIR,
      bin: process.env.SCREEN_BUDDY_CLAUDE_BIN,
      model: process.env.SCREEN_BUDDY_CLAUDE_MODEL,
      idleMs: minutesEnv("SCREEN_BUDDY_IDLE_MIN", 10) * 60 * 1000,
    })
  : new Buddy({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.SCREEN_BUDDY_MODEL,
    });
const speaker = new Speaker({ send, voice: process.env.SCREEN_BUDDY_VOICE || "bm_george" });
const LISTEN_WINDOW_MS = 8000; // after a bare "Hey Buddy", the next thing said is the message
let listenUntil = 0;
const backendLabel = useClaudeCode
  ? `Claude Code session ${buddy.sessionId ? buddy.sessionId.slice(0, 8) + "…" : "(latest)"}`
  : buddy.live
    ? "Live"
    : "Sample mode (no API key)";

function minutesEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== "" ? n : fallback;
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(settings.winW, workArea.width - 32);
  const height = Math.min(settings.winH, workArea.height - 32);
  win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + workArea.height - height - 16,
    minWidth: 260,
    minHeight: BAR_H,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Float above everything, including full-screen apps.
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep our own window out of the screenshots (macOS / Windows).
  win.setContentProtection(true);
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Chat text size only; the window stays put. step: +1, -1, or 0 to reset.
function setTextScale(step) {
  const next = step === 0 ? DEFAULTS.textScale : settings.textScale + step * 0.1;
  settings.textScale = Math.round(Math.min(TEXT_MAX, Math.max(TEXT_MIN, next)) * 100) / 100;
  saveSettings();
  return settings.textScale;
}

// Whole-panel see-through level, 0.3 (faint) to 1 (solid).
function setOpacity(value) {
  settings.opacity = Math.round(Math.min(1, Math.max(OPACITY_MIN, Number(value) || 1)) * 100) / 100;
  win?.setOpacity(settings.opacity);
  saveSettings();
  return settings.opacity;
}

// Window size only. step: +1 (10% bigger), -1 (10% smaller), or 0 to reset.
// Windows can't edge-resize a frameless transparent window, hence buttons.
function resizeWindow(step) {
  if (!win || collapsed) return;
  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const f = step > 0 ? 1.1 : 1 / 1.1;
  const newW = Math.round(Math.min(workArea.width, Math.max(WIN_MIN_W, step === 0 ? DEFAULTS.winW : w * f)));
  const newH = Math.round(Math.min(workArea.height, Math.max(WIN_MIN_H, step === 0 ? DEFAULTS.winH : h * f)));
  // Keep the bottom-right corner where it is, but stay on screen.
  const newX = Math.max(workArea.x, Math.min(x + w - newW, workArea.x + workArea.width - newW));
  const newY = Math.max(workArea.y, Math.min(y + h - newH, workArea.y + workArea.height - newH));
  win.setBounds({ x: newX, y: newY, width: newW, height: newH }, true);
  settings.winW = newW;
  settings.winH = newH;
  saveSettings();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function captureScreen() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;

  // Content protection doesn't exist on Linux, so briefly hide instead.
  const hideForCapture = process.platform === "linux" && win?.isVisible();
  if (hideForCapture) {
    win.hide();
    await new Promise((r) => setTimeout(r, 150));
  }
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      // Capture straight at the chosen detail level (e.g. 1280 wide) rather
      // than full 4K: less to save, and less of the buddy's context per image.
      thumbnailSize: captureSize(Math.round(width * scale), Math.round(height * scale), settings.shotWidth),
    });
  } finally {
    if (hideForCapture) win.showInactive();
  }
  const source = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(
      "Couldn't capture the screen. On macOS, allow Screen Recording for this app in System Settings > Privacy & Security.",
    );
  }
  return source.thumbnail;
}

function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function appendLog(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

// kind: "user" (you sent a message) | "auto" (timer check-in).
// withShot: whether to capture and attach the screen (always for "auto").
async function checkIn(kind, message = "", { withShot = true } = {}) {
  if (busy) {
    if (kind === "user") send("buddy:status", { text: "Still thinking about the last one…" });
    return;
  }
  busy = true;
  send("buddy:thinking", true);
  // A new question cuts off whatever the buddy was still saying.
  if (kind === "user") speaker.stop();
  const chunker = settings.voiceOut ? new SpeechChunker() : null;
  const speakAll = (pieces) => pieces.forEach((p) => speaker.say(p));
  try {
    const when = new Date();
    let file = null;
    let jpegBase64 = null;
    if (kind === "auto" || withShot) {
      const image = await captureScreen();

      const tiny = toGray(image.resize({ width: 64, height: 36 }).toBitmap());
      const changed = frameDiff(tiny, lastFrame) >= CHANGE_THRESHOLD;
      lastFrame = tiny;
      if (kind === "auto" && !changed) return; // nothing new to look at

      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      file = path.join(SHOTS_DIR, `${stamp(when)}_${kind}.png`);
      fs.writeFileSync(file, image.toPNG());
      jpegBase64 = image.toJPEG(80).toString("base64");
    }

    const { text, quiet } = await buddy.look({
      kind,
      message,
      jpegBase64,
      file,
      when: when.toLocaleTimeString(),
      // Stream your answers into the panel as they're written. Check-ins
      // don't stream: most of them end up quiet.
      // The voice starts on the first finished sentence.
      onText:
        kind === "user"
          ? (t) => {
              send("buddy:delta", { text: t });
              if (chunker) speakAll(chunker.update(t));
            }
          : undefined,
    });
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    appendLog({ at: when.toISOString(), kind, file, message: message || null, reply: text, quiet });

    if (quiet) {
      send("buddy:status", { text: `Checked in at ${when.toLocaleTimeString()}, all good.` });
      return;
    }
    send("buddy:reply", { text, kind, file, at: when.toISOString() });
    if (chunker) speakAll(chunker.finish(text));
    if (kind === "auto") alertUser(text);
  } catch (err) {
    console.error(err);
    send("buddy:error", { text: err.message || String(err) });
  } finally {
    busy = false;
    send("buddy:thinking", false);
  }
}

// Buddy spoke up without being asked: get the user's attention.
function alertUser(text) {
  if (Notification.isSupported()) {
    const n = new Notification({ title: "Screen Buddy", body: text.slice(0, 200), silent: false });
    n.on("click", () => showWindow());
    n.show();
  }
  if (win && !win.isFocused()) win.flashFrame(true);
}

function showWindow() {
  if (!win) return;
  win.showInactive();
  win.focus();
  send("buddy:focus-input");
}

function schedule() {
  clearInterval(timer);
  timer = null;
  if (!settings.paused && settings.intervalMin > 0) {
    timer = setInterval(() => checkIn("auto"), settings.intervalMin * 60 * 1000);
  }
  send("buddy:settings", settingsView());
}

function settingsView() {
  return {
    ...settings,
    live: buddy.live,
    backendLabel,
    shotsDir: SHOTS_DIR,
    hotkey: HOTKEY,
    canHear: Boolean(process.env.GROQ_API_KEY),
    hasKokoro: speaker.usesKokoro,
  };
}

// ---- voice ------------------------------------------------------------------

let lastVoiceError = 0;
function voiceError(err) {
  // One message per 30 s at most, so a dead network doesn't flood the chat.
  if (Date.now() - lastVoiceError < 30000) return;
  lastVoiceError = Date.now();
  send("buddy:error", { text: err.message || String(err) });
}

// One utterance from the window's speech detector (a WAV). Speech that isn't
// addressed to the buddy is dropped here and never logged.
async function onUtterance(audio, { duringSpeech = false } = {}) {
  if (!settings.voiceIn) return;
  let heard;
  try {
    heard = await transcribe(audio);
  } catch (err) {
    return voiceError(err);
  }
  if (!heard.heard) return;
  const listening = !duringSpeech && Date.now() < listenUntil;
  const cmd = parseUtterance(heard.text, { listening });
  // While the buddy talks (and just after), the mic may be hearing the buddy:
  // only "Buddy, stop" counts.
  if (duringSpeech && cmd.kind !== "stop") return;

  if (cmd.kind === "stop") {
    speaker.stop();
    send("buddy:status", { text: "Okay, stopped." });
  } else if (cmd.kind === "wake") {
    listenUntil = Date.now() + LISTEN_WINDOW_MS;
    send("buddy:status", { text: "Listening…" });
  } else if (cmd.kind === "message") {
    listenUntil = 0;
    if (busy) return send("buddy:status", { text: "Still thinking about the last one…" });
    const text = cmd.text || (cmd.withShot ? "What do you think?" : "");
    if (!text) return;
    send("buddy:heard", { text, withShot: cmd.withShot });
    checkIn("user", text, { withShot: cmd.withShot });
  }
}

ipcMain.handle("buddy:get-settings", () => settingsView());
ipcMain.handle("buddy:set-settings", (_e, patch) => {
  const wasVoiceOut = settings.voiceOut;
  settings = { ...settings, ...patch };
  settings.voiceIn = Boolean(settings.voiceIn);
  settings.voiceOut = Boolean(settings.voiceOut);
  if (!settings.voiceOut) speaker.stop();
  else if (!wasVoiceOut) speaker.warm();
  settings.intervalMin = Math.max(0, Number(settings.intervalMin) || 0);
  settings.shotWidth = normalizeShotWidth(settings.shotWidth);
  saveSettings();
  schedule();
  return settingsView();
});
ipcMain.on("voice:utterance", (_e, audio, meta) => onUtterance(audio, meta));
ipcMain.on("voice:stop-request", () => speaker.stop());
ipcMain.handle("buddy:send", (_e, message, withShot) =>
  checkIn("user", String(message || "").trim() || (withShot ? "What do you think?" : "Hey"), { withShot: Boolean(withShot) }),
);
ipcMain.handle("buddy:check-now", () => {
  lastFrame = null; // force a real look
  return checkIn("auto");
});
ipcMain.handle("buddy:open-folder", () => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  return shell.openPath(SHOTS_DIR);
});
ipcMain.handle("buddy:open-file", (_e, file) => {
  // Only open files we wrote.
  if (path.resolve(file).startsWith(path.resolve(SHOTS_DIR) + path.sep)) return shell.openPath(file);
});
ipcMain.handle("buddy:text-size", (_e, step) => setTextScale(step));
ipcMain.on("buddy:resize", (_e, step) => resizeWindow(step));
ipcMain.handle("buddy:opacity", (_e, value) => setOpacity(value));
ipcMain.on("buddy:collapse", (_e, isCollapsed) => {
  if (!win) return;
  const [w, h] = win.getSize();
  collapsed = isCollapsed;
  if (collapsed) expandedHeight = h;
  win.setSize(w, collapsed ? BAR_H : expandedHeight || settings.winH, true);
});
ipcMain.on("buddy:hide", () => win?.hide());
ipcMain.on("buddy:quit", () => app.quit());

// Windows needs an app ID for desktop notifications to show.
if (process.platform === "win32") app.setAppUserModelId("com.screenbuddy.app");

// The window may use the microphone (for voice) and nothing else: no camera,
// no other permissions. Screen capture goes through desktopCapturer instead.
function lockPermissions() {
  const audioOnly = (types) => Array.isArray(types) && types.length > 0 && types.every((t) => t === "audio");
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission === "media" && audioOnly(details.mediaTypes));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
    return permission === "media" && details?.mediaType !== "video";
  });
}

app.whenReady().then(() => {
  lockPermissions();
  createWindow();
  if (settings.voiceOut) speaker.warm();
  schedule();
  buddy.warm();
  globalShortcut.register(HOTKEY, () => {
    if (win?.isVisible() && win.isFocused()) win.hide();
    else showWindow();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());

// Shut claude down properly before exiting, so the session is released
// (e.g. for VS Code) instead of being left to a killed process.
let shutdownDone = false;
app.on("before-quit", (e) => {
  if (shutdownDone) return;
  e.preventDefault();
  clearInterval(timer);
  speaker.stop();
  send("buddy:status", { text: "Closing Claude…" });
  buddy
    .close()
    .catch(() => {})
    .finally(() => {
      shutdownDone = true;
      app.quit();
    });
});
// Ctrl+C in the terminal that ran `npm start`.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => app.quit());
