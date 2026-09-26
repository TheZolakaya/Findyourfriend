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
  shell,
} = require("electron");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { Buddy, ClaudeCodeBuddy } = require("./buddy");
const { toGray, frameDiff } = require("./frames");

const SHOTS_DIR = process.env.SCREEN_BUDDY_DIR || path.join(app.getPath("home"), "ScreenBuddy");
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const LOG_FILE = path.join(SHOTS_DIR, "log.jsonl");
const HOTKEY = "CommandOrControl+Shift+Space";
const CHANGE_THRESHOLD = 2; // mean gray-level diff below this = "screen didn't change"
const MAX_SEND_WIDTH = 1568; // long edge we send to the model

const DEFAULTS = { intervalMin: 5, paused: false, textScale: 1.25, winW: 360, winH: 520, opacity: 1 };
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
    })
  : new Buddy({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.SCREEN_BUDDY_MODEL,
    });
const backendLabel = useClaudeCode
  ? `Claude Code session ${buddy.sessionId ? buddy.sessionId.slice(0, 8) + "…" : "(latest)"}`
  : buddy.live
    ? "Live"
    : "Sample mode (no API key)";

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
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) },
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

// kind: "user" (you sent a message) | "auto" (timer check-in)
async function checkIn(kind, message = "") {
  if (busy) {
    if (kind === "user") send("buddy:status", { text: "Still thinking about the last one…" });
    return;
  }
  busy = true;
  send("buddy:thinking", true);
  try {
    const image = await captureScreen();

    const tiny = toGray(image.resize({ width: 64, height: 36 }).toBitmap());
    const changed = frameDiff(tiny, lastFrame) >= CHANGE_THRESHOLD;
    lastFrame = tiny;
    if (kind === "auto" && !changed) return; // nothing new to look at

    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    const when = new Date();
    const file = path.join(SHOTS_DIR, `${stamp(when)}_${kind}.png`);
    fs.writeFileSync(file, image.toPNG());

    const small = image.getSize().width > MAX_SEND_WIDTH ? image.resize({ width: MAX_SEND_WIDTH }) : image;
    const jpegBase64 = small.toJPEG(80).toString("base64");

    const { text, quiet } = await buddy.look({
      kind,
      message,
      jpegBase64,
      file,
      when: when.toLocaleTimeString(),
    });
    appendLog({ at: when.toISOString(), kind, file, message: message || null, reply: text, quiet });

    if (quiet) {
      send("buddy:status", { text: `Checked in at ${when.toLocaleTimeString()}, all good.` });
      return;
    }
    send("buddy:reply", { text, kind, file, at: when.toISOString() });
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
  send("buddy:settings", { ...settings, live: buddy.live, backendLabel, shotsDir: SHOTS_DIR, hotkey: HOTKEY });
}

ipcMain.handle("buddy:get-settings", () => ({
  ...settings,
  live: buddy.live,
  backendLabel,
  shotsDir: SHOTS_DIR,
  hotkey: HOTKEY,
}));
ipcMain.handle("buddy:set-settings", (_e, patch) => {
  settings = { ...settings, ...patch };
  settings.intervalMin = Math.max(0, Number(settings.intervalMin) || 0);
  saveSettings();
  schedule();
  return settings;
});
ipcMain.handle("buddy:send", (_e, message) => checkIn("user", String(message || "").trim() || "What do you think?"));
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

app.whenReady().then(() => {
  createWindow();
  schedule();
  globalShortcut.register(HOTKEY, () => {
    if (win?.isVisible() && win.isFocused()) win.hide();
    else showWindow();
  });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
