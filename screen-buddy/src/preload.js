const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, payload) => fn(payload));

contextBridge.exposeInMainWorld("buddy", {
  getSettings: () => ipcRenderer.invoke("buddy:get-settings"),
  setSettings: (patch) => ipcRenderer.invoke("buddy:set-settings", patch),
  send: (message, withShot) => ipcRenderer.invoke("buddy:send", message, withShot),
  checkNow: () => ipcRenderer.invoke("buddy:check-now"),
  openFolder: () => ipcRenderer.invoke("buddy:open-folder"),
  openFile: (file) => ipcRenderer.invoke("buddy:open-file", file),
  collapse: (collapsed) => ipcRenderer.send("buddy:collapse", collapsed),
  hide: () => ipcRenderer.send("buddy:hide"),
  textSize: (step) => ipcRenderer.invoke("buddy:text-size", step),
  resize: (step) => ipcRenderer.send("buddy:resize", step),
  setOpacity: (value) => ipcRenderer.invoke("buddy:opacity", value),
  quit: () => ipcRenderer.send("buddy:quit"),
  voiceUtterance: (wav, meta) => ipcRenderer.send("voice:utterance", wav, meta),
  voiceStop: () => ipcRenderer.send("voice:stop-request"),
  // Only the voice channels can be listened to this way.
  onVoice: (channel, fn) => {
    if (["voice:play", "voice:stop", "voice:tts-busy", "voice:tts-idle"].includes(channel)) on(channel)(fn);
  },
  onHeard: on("buddy:heard"),
  onReply: on("buddy:reply"),
  onDelta: on("buddy:delta"),
  onStatus: on("buddy:status"),
  onError: on("buddy:error"),
  onThinking: on("buddy:thinking"),
  onSettings: on("buddy:settings"),
  onFocusInput: on("buddy:focus-input"),
});
