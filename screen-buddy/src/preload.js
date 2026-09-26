const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, payload) => fn(payload));

contextBridge.exposeInMainWorld("buddy", {
  getSettings: () => ipcRenderer.invoke("buddy:get-settings"),
  setSettings: (patch) => ipcRenderer.invoke("buddy:set-settings", patch),
  send: (message) => ipcRenderer.invoke("buddy:send", message),
  checkNow: () => ipcRenderer.invoke("buddy:check-now"),
  openFolder: () => ipcRenderer.invoke("buddy:open-folder"),
  openFile: (file) => ipcRenderer.invoke("buddy:open-file", file),
  collapse: (collapsed) => ipcRenderer.send("buddy:collapse", collapsed),
  hide: () => ipcRenderer.send("buddy:hide"),
  zoom: (step) => ipcRenderer.invoke("buddy:zoom", step),
  quit: () => ipcRenderer.send("buddy:quit"),
  onReply: on("buddy:reply"),
  onStatus: on("buddy:status"),
  onError: on("buddy:error"),
  onThinking: on("buddy:thinking"),
  onSettings: on("buddy:settings"),
  onFocusInput: on("buddy:focus-input"),
});
