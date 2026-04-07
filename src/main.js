const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  screen,
  session,
  shell,
  systemPreferences,
} = require("electron");
const dotenv = require("dotenv");

const { processDictation } = require("./services/dictation");
const {
  activateApplication,
  getFrontmostApplication,
  pasteClipboardIntoFrontmostApp,
} = require("./services/macos");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const DEFAULT_SHORTCUT = process.env.SCRIBO_SHORTCUT || "CommandOrControl+Shift+Space";
const DEFAULT_INSERT_SHORTCUT = process.env.SCRIBO_INSERT_SHORTCUT || "CommandOrControl+Shift+Enter";
const DEFAULT_TONE = "professional";

let mainWindow = null;
let pillWindow = null;
let isQuitting = false;
let lastExternalApp = null;
let latestTranscript = "";
let latestCleanText = "";
let controlListenerProcess = null;
let controlListenerBuffer = "";
let controlListenerErrorBuffer = "";
let isGlobalControlPressed = false;
let userSettings = {
  groqApiKey: "",
  tone: DEFAULT_TONE,
  customDictionaryEnabled: false,
  customDictionary: [],
};
let latestDictationState = {
  phase: "idle",
  recording: false,
  busy: false,
  transcript: "",
  cleanedText: "",
  hasDraft: false,
  message: "",
};

function normalizeTone(value) {
  return String(value || "").trim().toLowerCase() === "casual" ? "casual" : DEFAULT_TONE;
}

function normalizeCustomDictionary(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || "").split(/\r?\n/);

  const seen = new Set();
  const normalized = [];

  for (const entry of entries) {
    const term = String(entry || "").trim();
    if (!term) continue;

    const collapsed = term.replace(/\s+/g, " ").slice(0, 80);
    const key = collapsed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(collapsed);
    if (normalized.length >= 64) break;
  }

  return normalized;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadUserSettings() {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      return { ...userSettings };
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};

    return {
      groqApiKey: String(parsed.groqApiKey || "").trim(),
      tone: normalizeTone(parsed.tone),
      customDictionaryEnabled: normalizeBoolean(parsed.customDictionaryEnabled, false),
      customDictionary: normalizeCustomDictionary(parsed.customDictionary),
    };
  } catch (error) {
    console.warn(`[settings] Failed to load settings: ${error.message}`);
    return { ...userSettings };
  }
}

function persistUserSettings(nextSettings = userSettings) {
  const filePath = getSettingsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
}

function updateUserSettings(patch = {}) {
  userSettings = {
    ...userSettings,
    ...(Object.prototype.hasOwnProperty.call(patch, "groqApiKey")
      ? { groqApiKey: String(patch.groqApiKey || "").trim() }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "tone")
      ? { tone: normalizeTone(patch.tone) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "customDictionaryEnabled")
      ? { customDictionaryEnabled: normalizeBoolean(patch.customDictionaryEnabled, false) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, "customDictionary")
      ? { customDictionary: normalizeCustomDictionary(patch.customDictionary) }
      : {}),
  };

  persistUserSettings(userSettings);
  return { ...userSettings };
}

function getEffectiveGroqApiKey() {
  return String(userSettings.groqApiKey || "").trim();
}

function getRendererConfig() {
  return {
    apiKey: userSettings.groqApiKey,
    hasGroqKey: Boolean(getEffectiveGroqApiKey()),
    tone: userSettings.tone,
    customDictionaryEnabled: userSettings.customDictionaryEnabled,
    customDictionary: [...userSettings.customDictionary],
    hasGlobalPushToTalk: hasGlobalPushToTalkSupport(),
    microphonePermission: getMicrophonePermissionStatus(),
    pushToTalkKey: "Ctrl",
    recordingShortcut: DEFAULT_SHORTCUT,
    insertShortcut: DEFAULT_INSERT_SHORTCUT,
    platform: process.platform,
  };
}

function getPillWindowSize(dictationState = latestDictationState) {
  const isRecording = dictationState.phase === "recording";

  if (isRecording) {
    return { width: 140, height: 60 };
  }

  return { width: 60, height: 60 };
}

function positionPillWindow(size = getPillWindowSize(), preserveCenter = false) {
  if (!pillWindow) return;

  let targetX;
  let targetY;

  if (preserveCenter) {
    const [currentX, currentY] = pillWindow.getPosition();
    const [currentWidth, currentHeight] = pillWindow.getSize();
    const centerX = currentX + currentWidth / 2;
    targetX = Math.round(centerX - size.width / 2);
    targetY = currentY + (currentHeight - size.height);
  } else {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    targetX = Math.round(x + (width - size.width) / 2);
    targetY = Math.round(y + height - size.height - 28);
  }

  pillWindow.setBounds({
    x: targetX,
    y: targetY,
    width: size.width,
    height: size.height,
  }, false);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberFrontmostAppSoon(delay = 120) {
  setTimeout(() => {
    void rememberFrontmostApp().catch(() => {});
  }, delay);
}

async function rememberFrontmostApp() {
  const targetApp = await getFrontmostApplication();
  if (!targetApp) return;

  const currentBundleId = app.getBundleId?.() || null;
  if (targetApp.bundleId && currentBundleId && targetApp.bundleId === currentBundleId) {
    return;
  }

  if (targetApp.name === app.getName()) {
    return;
  }

  lastExternalApp = targetApp;
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}

function showPillWindowInactive() {
  if (!pillWindow) return;
  if (pillWindow.isVisible()) return;
  pillWindow.showInactive();
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

function broadcastToWindows(channel, ...args) {
  mainWindow?.webContents.send(channel, ...args);
  pillWindow?.webContents.send(channel, ...args);
}

function formatInsertError(error) {
  const message = String(error?.message || error || "").trim();

  if (/not authorized|not permitted|assistive access|system events got an error/i.test(message)) {
    return "Paste failed because macOS Accessibility access is missing. Enable Scribo in System Settings > Privacy & Security > Accessibility, then try again.";
  }

  if (/application isn.?t running|can.?t get application process|no such process/i.test(message)) {
    return "Paste failed because the target app is no longer available. Focus the app you want and dictate again.";
  }

  return "Paste failed. The draft is still in Scribo.";
}

function getControlListenerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "control-listener");
  }

  return path.join(__dirname, "..", "build", "bin", "control-listener");
}

function hasExecutableControlListener() {
  const listenerPath = getControlListenerPath();

  try {
    fs.accessSync(listenerPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasGlobalPushToTalkSupport() {
  return process.platform === "darwin" && hasExecutableControlListener();
}

function handleControlListenerError(message) {
  if (!mainWindow || !message) return;

  if (message.includes("INPUT_MONITORING_REQUIRED")) {
    broadcastToWindows(
      "push-to-talk:error",
      "Global Ctrl push-to-talk needs macOS Input Monitoring. Enable Scribo in System Settings > Privacy & Security > Input Monitoring.",
    );
    return;
  }

  if (message.includes("ACCESSIBILITY_REQUIRED")) {
    broadcastToWindows(
      "push-to-talk:error",
      "Global Ctrl push-to-talk needs macOS Accessibility access. Enable Scribo in System Settings > Privacy & Security > Accessibility.",
    );
    return;
  }

  if (message.includes("SPAWN_FAILED")) {
    broadcastToWindows(
      "push-to-talk:error",
      "Global Ctrl push-to-talk could not start. Rebuild the helper and reopen Scribo.",
    );
    return;
  }

  if (message.includes("EVENT_TAP_CREATE_FAILED") || message.includes("RUN_LOOP_SOURCE_FAILED")) {
    broadcastToWindows(
      "push-to-talk:error",
      "Global Ctrl push-to-talk could not initialize its macOS event tap.",
    );
    return;
  }

  broadcastToWindows(
    "push-to-talk:error",
    "Global Ctrl push-to-talk is unavailable right now.",
  );
}

function flushControlListenerBuffer() {
  const trailingLine = controlListenerBuffer.trim();
  if (trailingLine) {
    handleControlListenerLine(trailingLine);
  }
  controlListenerBuffer = "";
}

function flushControlListenerErrorBuffer() {
  const trailingLine = controlListenerErrorBuffer.trim();
  if (trailingLine) {
    handleControlListenerError(trailingLine);
  }
  controlListenerErrorBuffer = "";
}

function handleControlListenerLine(line) {
  const normalized = String(line || "").trim();
  if (!normalized || !mainWindow) return;

  if (normalized === "READY") {
    return;
  }

  if (normalized === "DOWN") {
    if (isGlobalControlPressed) return;
    isGlobalControlPressed = true;
    void (async () => {
      await rememberFrontmostApp().catch(() => {});
      showPillWindowInactive();
      mainWindow.webContents.send("push-to-talk:start");
    })();
    return;
  }

  if (normalized === "UP") {
    if (!isGlobalControlPressed) return;
    isGlobalControlPressed = false;
    mainWindow.webContents.send("push-to-talk:stop");
  }
}

function startControlListener() {
  if (process.platform !== "darwin" || controlListenerProcess) return;

  const listenerPath = getControlListenerPath();
  if (!hasExecutableControlListener()) {
    console.warn(`[push-to-talk] Global control listener is missing or not executable at ${listenerPath}`);
    return;
  }

  controlListenerBuffer = "";
  controlListenerErrorBuffer = "";
  controlListenerProcess = spawn(listenerPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  controlListenerProcess.on("error", (error) => {
    console.warn(`[push-to-talk] Failed to start global control listener: ${error.message}`);
    handleControlListenerError("ERROR:SPAWN_FAILED");
    controlListenerProcess = null;
    isGlobalControlPressed = false;
  });

  controlListenerProcess.stdout.on("data", (chunk) => {
    controlListenerBuffer += chunk.toString();

    let newlineIndex = controlListenerBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = controlListenerBuffer.slice(0, newlineIndex);
      controlListenerBuffer = controlListenerBuffer.slice(newlineIndex + 1);
      handleControlListenerLine(line);
      newlineIndex = controlListenerBuffer.indexOf("\n");
    }
  });

  controlListenerProcess.stderr.on("data", (chunk) => {
    controlListenerErrorBuffer += chunk.toString();

    let newlineIndex = controlListenerErrorBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = controlListenerErrorBuffer.slice(0, newlineIndex);
      controlListenerErrorBuffer = controlListenerErrorBuffer.slice(newlineIndex + 1);
      handleControlListenerError(line);
      newlineIndex = controlListenerErrorBuffer.indexOf("\n");
    }
  });

  controlListenerProcess.on("exit", (code, signal) => {
    flushControlListenerBuffer();
    flushControlListenerErrorBuffer();

    if (!isQuitting && code !== 0 && signal !== "SIGTERM") {
      console.warn(
        `[push-to-talk] Global control listener exited with code ${code} and signal ${signal || "none"}`,
      );
    }

    controlListenerProcess = null;
    isGlobalControlPressed = false;
  });
}

function isLocalAudioPermissionRequest(webContents, details = {}) {
  const knownUrl = [
    details.requestingUrl,
    details.securityOrigin,
    webContents?.getURL?.(),
  ].find(Boolean);

  return String(knownUrl || "").startsWith("file://");
}

function configureMediaPermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (permission !== "media") return false;

    const wantsAudio =
      details.mediaType === "audio" ||
      details.mediaTypes?.includes?.("audio");

    return wantsAudio && isLocalAudioPermissionRequest(webContents, details);
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }

    const wantsAudio =
      details.mediaType === "audio" ||
      details.mediaTypes?.includes?.("audio");

    callback(wantsAudio && isLocalAudioPermissionRequest(webContents, details));
  });
}

function getMicrophonePermissionStatus() {
  if (process.platform !== "darwin") {
    return "granted";
  }

  return systemPreferences.getMediaAccessStatus("microphone");
}

async function requestMicrophonePermission() {
  if (process.platform !== "darwin") {
    return { status: "granted", prompted: false };
  }

  const current = getMicrophonePermissionStatus();
  if (current === "granted" || current === "denied" || current === "restricted") {
    return { status: current, prompted: false };
  }

  const granted = await systemPreferences.askForMediaAccess("microphone");
  return {
    status: granted ? "granted" : getMicrophonePermissionStatus(),
    prompted: true,
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    title: "Scribo",
    show: false,
    backgroundColor: "#081122",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "main.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.center();
    mainWindow.show();
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("blur", () => {
    rememberFrontmostAppSoon();
  });
}

function createPillWindow() {
  pillWindow = new BrowserWindow({
    width: 60,
    height: 60,
    title: "Scribo Pill",
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    fullscreenable: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  pillWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  pillWindow.once("ready-to-show", () => {
    positionPillWindow(getPillWindowSize(), false);
    pillWindow.showInactive();
  });

  pillWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    pillWindow.hide();
  });

  pillWindow.on("blur", () => {
    rememberFrontmostAppSoon();
  });
}

async function insertIntoTargetApp(text) {
  const finalText = String(text || "").trim();
  if (!finalText) {
    throw new Error("No text available to insert yet.");
  }

  if (process.platform !== "darwin") {
    clipboard.writeText(finalText);
    return {
      ok: true,
      targetApp: null,
      strategy: "clipboard-only",
    };
  }

  try {
    let targetApp = lastExternalApp;
    const mainWasVisible = mainWindow?.isVisible() || false;

    if (mainWasVisible) {
      hideWindow();
    }

    if (mainWasVisible) {
      await wait(140);
    }

    if (!targetApp) {
      targetApp = await getFrontmostApplication();
    }

    if (targetApp) {
      await activateApplication(targetApp);
      await wait(120);
      lastExternalApp = targetApp;
    }

    const pasteResult = await pasteClipboardIntoFrontmostApp(finalText);

    latestCleanText = finalText;
    return {
      ok: true,
      targetApp: targetApp?.name || null,
      strategy: pasteResult.strategy,
    };
  } catch (error) {
    showWindow();
    throw new Error(formatInsertError(error));
  }
}

function registerGlobalShortcuts() {
  const toggleRegistered = globalShortcut.register(DEFAULT_SHORTCUT, async () => {
    await rememberFrontmostApp();
    showWindow();
    mainWindow?.webContents.send("shortcut:toggle-recording");
  });

  if (!toggleRegistered) {
    console.warn(`[shortcut] Could not register ${DEFAULT_SHORTCUT}`);
  }

  const insertRegistered = globalShortcut.register(DEFAULT_INSERT_SHORTCUT, async () => {
    const text = latestCleanText || latestTranscript;
    if (!text) return;

    try {
      await insertIntoTargetApp(text);
      mainWindow?.webContents.send("shortcut:insert-success");
    } catch (error) {
      mainWindow?.webContents.send("shortcut:insert-error", error.message);
    }
  });

  if (!insertRegistered) {
    console.warn(`[shortcut] Could not register ${DEFAULT_INSERT_SHORTCUT}`);
  }
}

function registerIpcHandlers() {
  ipcMain.handle("config:get", async () => getRendererConfig());

  ipcMain.handle("settings:update", async (_event, payload = {}) => {
    const settings = updateUserSettings({
      ...(Object.prototype.hasOwnProperty.call(payload, "apiKey")
        ? { groqApiKey: payload.apiKey }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "tone")
        ? { tone: payload.tone }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "customDictionaryEnabled")
        ? { customDictionaryEnabled: payload.customDictionaryEnabled }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, "customDictionary")
        ? { customDictionary: payload.customDictionary }
        : {}),
    });

    return {
      ok: true,
      config: getRendererConfig(),
      settings,
    };
  });

  ipcMain.handle("permissions:get-microphone-status", async () => ({
    status: getMicrophonePermissionStatus(),
  }));

  ipcMain.handle("permissions:request-microphone", async () => requestMicrophonePermission());

  ipcMain.handle("permissions:open-system-settings", async () => {
    if (process.platform !== "darwin") {
      return { ok: false };
    }

    const opened = await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
    return { ok: !opened };
  });

  ipcMain.handle("window:show", async () => {
    showWindow();
    return { ok: true };
  });

  ipcMain.handle("window:hide", async () => {
    hideWindow();
    return { ok: true };
  });

  ipcMain.handle("app:remember-target", async () => {
    await rememberFrontmostApp();
    return { ok: true, targetApp: lastExternalApp?.name || null };
  });

  ipcMain.handle("dictation:get-state", async () => latestDictationState);

  ipcMain.on("dictation:state", (_event, payload) => {
    latestDictationState = {
      ...latestDictationState,
      ...payload,
    };

    positionPillWindow(getPillWindowSize(latestDictationState), true);
    pillWindow?.webContents.send("dictation:state", latestDictationState);
  });

  ipcMain.on("pill:command", (_event, payload = {}) => {
    if (payload.action === "show-main") {
      showWindow();
      return;
    }

    mainWindow?.webContents.send("pill:command", payload);
  });

  ipcMain.handle("dictation:process", async (_event, payload) => {
    const result = await processDictation(payload, {
      apiKey: getEffectiveGroqApiKey(),
      tone: userSettings.tone,
      customDictionaryEnabled: userSettings.customDictionaryEnabled,
      customDictionary: userSettings.customDictionary,
    });
    latestTranscript = result.transcript || "";
    latestCleanText = result.cleanedText || result.transcript || "";
    return result;
  });

  ipcMain.handle("text:copy", async (_event, text) => {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  });

  ipcMain.handle("text:insert", async (_event, text) => insertIntoTargetApp(text));
}

app.whenReady()
  .then(async () => {
    userSettings = loadUserSettings();
    configureMediaPermissions();
    registerIpcHandlers();
    createMainWindow();
    createPillWindow();
    registerGlobalShortcuts();
    startControlListener();
    await rememberFrontmostApp();
  })
  .catch((error) => {
    console.error("[boot] Scribo failed to start", error);
    app.quit();
  });

app.on("activate", () => {
  showWindow();
  pillWindow?.showInactive();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  controlListenerProcess?.kill();
  pillWindow?.destroy();
  globalShortcut.unregisterAll();
});
