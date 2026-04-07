const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("scriboAPI", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveSettings: (payload) => ipcRenderer.invoke("settings:update", payload),
  getDictationState: () => ipcRenderer.invoke("dictation:get-state"),
  getMicrophonePermissionStatus: () => ipcRenderer.invoke("permissions:get-microphone-status"),
  requestMicrophonePermission: () => ipcRenderer.invoke("permissions:request-microphone"),
  openSystemSettings: () => ipcRenderer.invoke("permissions:open-system-settings"),
  rememberTarget: () => ipcRenderer.invoke("app:remember-target"),
  showWindow: () => ipcRenderer.invoke("window:show"),
  hideWindow: () => ipcRenderer.invoke("window:hide"),
  processAudio: (payload) => ipcRenderer.invoke("dictation:process", payload),
  copyText: (text) => ipcRenderer.invoke("text:copy", text),
  insertText: (text) => ipcRenderer.invoke("text:insert", text),
  sendDictationState: (payload) => ipcRenderer.send("dictation:state", payload),
  sendPillCommand: (payload) => ipcRenderer.send("pill:command", payload),
  onDictationState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("dictation:state", listener);
    return () => ipcRenderer.removeListener("dictation:state", listener);
  },
  onPillCommand: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("pill:command", listener);
    return () => ipcRenderer.removeListener("pill:command", listener);
  },
  onPushToTalkStart: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("push-to-talk:start", listener);
    return () => ipcRenderer.removeListener("push-to-talk:start", listener);
  },
  onPushToTalkStop: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("push-to-talk:stop", listener);
    return () => ipcRenderer.removeListener("push-to-talk:stop", listener);
  },
  onPushToTalkError: (handler) => {
    const listener = (_event, message) => handler(message);
    ipcRenderer.on("push-to-talk:error", listener);
    return () => ipcRenderer.removeListener("push-to-talk:error", listener);
  },
  onShortcutToggleRecording: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("shortcut:toggle-recording", listener);
    return () => ipcRenderer.removeListener("shortcut:toggle-recording", listener);
  },
  onInsertSuccess: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("shortcut:insert-success", listener);
    return () => ipcRenderer.removeListener("shortcut:insert-success", listener);
  },
  onInsertError: (handler) => {
    const listener = (_event, message) => handler(message);
    ipcRenderer.on("shortcut:insert-error", listener);
    return () => ipcRenderer.removeListener("shortcut:insert-error", listener);
  },
});
