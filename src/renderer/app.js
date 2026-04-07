const dom = {
  statusText: document.getElementById("statusText"),
  statusPill: document.getElementById("statusPill"),
  liveIndicator: document.getElementById("liveIndicator"),
  liveText: document.getElementById("liveText"),
  recordTimer: document.getElementById("recordTimer"),
  recordSource: document.getElementById("recordSource"),
  messageText: document.getElementById("messageText"),
  recordButton: document.getElementById("recordButton"),
  rawOutput: document.getElementById("rawOutput"),
  cleanOutput: document.getElementById("cleanOutput"),
  copyButton: document.getElementById("copyButton"),
  clearButton: document.getElementById("clearButton"),
  insertButton: document.getElementById("insertButton"),
  pushToTalkKey: document.getElementById("pushToTalkKey"),
  recordShortcut: document.getElementById("recordShortcut"),
  insertShortcut: document.getElementById("insertShortcut"),
  recordHint: document.getElementById("recordHint"),
  settingsForm: document.getElementById("settingsForm"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  apiKeyHint: document.getElementById("apiKeyHint"),
  toggleApiKeyButton: document.getElementById("toggleApiKeyButton"),
  customDictionaryField: document.getElementById("customDictionaryField"),
  customDictionaryPanel: document.getElementById("customDictionaryPanel"),
  customDictionaryToggle: document.getElementById("customDictionaryToggle"),
  customDictionaryToggleText: document.getElementById("customDictionaryToggleText"),
  customDictionaryInput: document.getElementById("customDictionaryInput"),
  customDictionaryHint: document.getElementById("customDictionaryHint"),
  toneOptions: Array.from(document.querySelectorAll(".tone-toggle__option")),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  settingsStatus: document.getElementById("settingsStatus"),
};

const state = {
  config: null,
  mediaRecorder: null,
  stream: null,
  chunks: [],
  recording: false,
  starting: false,
  busy: false,
  transcript: "",
  cleanedText: "",
  pointerHeld: false,
  ctrlHeld: false,
  wantsRecording: false,
  phase: "idle",
  activeInputSource: "Button",
  recordingStartedAt: 0,
  timerId: null,
  selectedTone: "professional",
  customDictionaryEnabled: false,
  savingSettings: false,
};

function setStatus(text, pillText, busy = false) {
  dom.statusText.textContent = text;
  dom.statusPill.textContent = pillText;
  dom.statusPill.classList.toggle("is-busy", busy);
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function compactText(text, maxLength = 112) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function quotePreview(text) {
  const compact = compactText(text);
  return compact ? `"${compact}"` : "";
}

function normalizeTone(value) {
  return String(value || "").trim().toLowerCase() === "casual" ? "casual" : "professional";
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

function getLivePreview() {
  const draftPreview = quotePreview(state.cleanedText || state.transcript);
  const messagePreview = compactText(dom.messageText.textContent || "", 120);

  if (state.phase === "recording") {
    return draftPreview || "Listening for dictated speech...";
  }

  if (state.phase === "starting") {
    return "Preparing microphone access and audio capture...";
  }

  if (state.phase === "processing") {
    return draftPreview || "Refining your dictated text with Groq...";
  }

  if (state.phase === "ready") {
    return draftPreview || "Refined dictation is ready.";
  }

  if (state.phase === "error") {
    return messagePreview || "Something needs attention before dictation can continue.";
  }

  return draftPreview || "Hold Ctrl or press the mic to start dictating.";
}

function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function syncLiveIndicator() {
  const hasDraft = Boolean((state.cleanedText || state.transcript).trim());
  dom.liveIndicator.dataset.state = state.phase;
  dom.liveIndicator.dataset.hasDraft = String(hasDraft);
  dom.liveText.textContent = getLivePreview();

  if (state.phase === "recording") {
    dom.recordSource.textContent = `via ${state.activeInputSource}`;
    dom.recordTimer.textContent = formatDuration(Date.now() - state.recordingStartedAt);
    return;
  }

  if (state.phase === "starting") {
    dom.recordSource.textContent = "Mic check";
    dom.recordTimer.textContent = "00:00";
    return;
  }

  if (state.phase === "processing") {
    dom.recordSource.textContent = "Groq";
    dom.recordTimer.textContent = "Refine";
    return;
  }

  if (state.phase === "ready") {
    dom.recordSource.textContent = "Draft";
    dom.recordTimer.textContent = "Ready";
    return;
  }

  if (state.phase === "error") {
    dom.recordSource.textContent = "Action";
    dom.recordTimer.textContent = "Check";
    return;
  }

  dom.recordSource.textContent = hasDraft ? "Draft" : "Standby";
  dom.recordTimer.textContent = hasDraft ? "Ready" : "00:00";
}

function getSharedState() {
  return {
    phase: state.phase,
    recording: state.recording,
    starting: state.starting,
    busy: state.busy,
    transcript: state.transcript,
    cleanedText: state.cleanedText,
    hasDraft: Boolean(getCurrentDraftText()),
    message: String(dom.messageText.textContent || ""),
  };
}

function publishState() {
  window.scriboAPI.sendDictationState(getSharedState());
}

function setPhase(phase) {
  state.phase = phase;

  if (phase === "recording") {
    state.recordingStartedAt = Date.now();
    stopTimer();
    state.timerId = setInterval(() => {
      dom.recordTimer.textContent = formatDuration(Date.now() - state.recordingStartedAt);
    }, 200);
  } else {
    stopTimer();
    if (phase !== "processing") {
      state.recordingStartedAt = 0;
    }
  }

  syncLiveIndicator();
}

function normalizeMicStatus(status) {
  const value = String(status || "").toLowerCase();
  if (!value) return "unknown";
  return value;
}

async function ensureMicrophonePermission() {
  const initial = await window.scriboAPI.getMicrophonePermissionStatus();
  const initialStatus = normalizeMicStatus(initial.status);

  if (initialStatus === "granted") {
    return { ok: true, status: initialStatus };
  }

  if (initialStatus === "not-determined") {
    setPhase("starting");
    setStatus("Waiting for permission...", "Mic", true);
    setMessage("Approve the macOS microphone prompt for Scribo.");

    const request = await window.scriboAPI.requestMicrophonePermission();
    const requestedStatus = normalizeMicStatus(request.status);

    if (requestedStatus === "granted") {
      return { ok: true, status: requestedStatus };
    }

    return { ok: false, status: requestedStatus };
  }

  return { ok: false, status: initialStatus };
}

function setMessage(text, isError = false) {
  dom.messageText.textContent = text;
  dom.messageText.style.color = isError ? "var(--danger)" : "var(--muted)";
  syncLiveIndicator();
  publishState();
}

function setSettingsStatus(text, isError = false) {
  dom.settingsStatus.textContent = text;
  dom.settingsStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function syncToneToggle() {
  for (const option of dom.toneOptions) {
    const isActive = option.dataset.tone === state.selectedTone;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-pressed", String(isActive));
  }
}

function syncSettingsControls() {
  dom.apiKeyInput.disabled = state.savingSettings;
  dom.customDictionaryToggle.disabled = state.savingSettings;
  dom.customDictionaryInput.disabled = state.savingSettings || !state.customDictionaryEnabled;
  dom.saveSettingsButton.disabled = state.savingSettings;
  dom.toggleApiKeyButton.disabled = state.savingSettings;

  for (const option of dom.toneOptions) {
    option.disabled = state.savingSettings;
  }
}

function syncCustomDictionarySection() {
  dom.customDictionaryToggle.checked = state.customDictionaryEnabled;
  dom.customDictionaryToggleText.textContent = state.customDictionaryEnabled ? "On" : "Off";
  dom.customDictionaryPanel.hidden = !state.customDictionaryEnabled;
  dom.customDictionaryField.dataset.enabled = String(state.customDictionaryEnabled);
  syncSettingsControls();
}

function applyConfig(config = {}) {
  state.config = config;
  state.selectedTone = normalizeTone(config.tone);
  state.customDictionaryEnabled = Boolean(config.customDictionaryEnabled);

  dom.pushToTalkKey.textContent = config.hasGlobalPushToTalk ? config.pushToTalkKey : "Button";
  dom.recordShortcut.textContent = config.recordingShortcut;
  dom.insertShortcut.textContent = config.insertShortcut;
  dom.apiKeyInput.value = String(config.apiKey || "");
  dom.customDictionaryInput.value = normalizeCustomDictionary(config.customDictionary).join("\n");

  if (config.apiKey) {
    dom.apiKeyHint.textContent = "Saved locally on this Mac. Scribo will use this key for transcription and cleanup.";
  } else {
    dom.apiKeyHint.textContent = "Saved locally on this Mac. Add a Groq API key to enable real transcription and cleanup.";
  }

  const dictionaryCount = normalizeCustomDictionary(config.customDictionary).length;
  dom.customDictionaryHint.textContent = !state.customDictionaryEnabled
    ? "Custom Dictionary Beta is off."
    : dictionaryCount
      ? `${dictionaryCount} custom ${dictionaryCount === 1 ? "term is" : "terms are"} saved. Scribo uses them as spelling hints during transcription and cleanup.`
      : "Add one word or phrase per line. Scribo will use them as spelling hints during transcription and cleanup.";

  syncToneToggle();
  syncCustomDictionarySection();
}

function finishReadyState(message) {
  setPhase("idle");
  setStatus("Ready", "Ready", false);
  setMessage(message);
}

function recoverAfterInsertFailure(message) {
  finishReadyState(
    `${String(message || "Paste failed.").trim()} The refined dictation is still in Scribo. Ready for the next dictation.`,
  );
}

function syncOutputs() {
  dom.rawOutput.value = state.transcript;
  dom.cleanOutput.value = state.cleanedText;
  syncLiveIndicator();
  publishState();
}

function syncControls() {
  dom.recordButton.classList.toggle("is-recording", state.recording);
  dom.recordButton.disabled = state.busy || state.starting;
  dom.insertButton.disabled = !state.cleanedText && !state.transcript;
  dom.copyButton.disabled = !state.cleanedText && !state.transcript;
  dom.recordButton.setAttribute("aria-label", state.recording ? "Stop dictation" : "Start dictation");
  dom.recordButton.querySelector(".record-button__label").textContent =
    state.recording ? "Release To Stop" : "Hold To Talk";
  dom.recordHint.textContent =
    state.recording
      ? "Release Ctrl or the button when you are done."
      : state.config?.hasGlobalPushToTalk
        ? "Hold the button or press and hold Ctrl from any app."
        : "Hold the button to talk.";
  publishState();
}

function getCurrentDraftText() {
  return (dom.cleanOutput.value || dom.rawOutput.value || "").trim();
}

function pickMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  for (const candidate of candidates) {
    if (window.MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      const [, base64 = ""] = dataUrl.split(",", 2);
      resolve(base64);
    });

    reader.addEventListener("error", () => {
      reject(reader.error || new Error("Could not read the recording."));
    });

    reader.readAsDataURL(blob);
  });
}

function stopStreamTracks() {
  for (const track of state.stream?.getTracks?.() || []) {
    track.stop();
  }
  state.stream = null;
}

async function startRecording() {
  if (state.busy || state.recording || state.starting) return;

  state.starting = true;
  setPhase("starting");
  syncControls();

  let permission;
  try {
    permission = await ensureMicrophonePermission();
  } catch (error) {
    state.starting = false;
    setPhase("error");
    syncControls();
    setStatus("Permission failed", "Error", true);
    setMessage(`Could not check microphone permission: ${error.message}`, true);
    return;
  }

  if (!permission.ok) {
    state.starting = false;
    setPhase("error");
    syncControls();
    setStatus("Microphone blocked", "Error", true);

    if (permission.status === "denied" || permission.status === "restricted") {
      setMessage(
        "Microphone access is blocked by macOS. Enable Scribo in System Settings > Privacy & Security > Microphone, then reopen the app.",
        true,
      );
      await window.scriboAPI.openSystemSettings().catch(() => {});
      return;
    }

    setMessage("Microphone permission was not granted.", true);
    return;
  }

  try {
    await window.scriboAPI.rememberTarget();

    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    state.starting = false;
    setPhase("error");
    syncControls();
    setStatus("Microphone blocked", "Error", true);
    setMessage(`Microphone access failed: ${error.message}`, true);
    return;
  }

  state.chunks = [];

  const mimeType = pickMimeType();
  state.mediaRecorder = mimeType
    ? new MediaRecorder(state.stream, { mimeType })
    : new MediaRecorder(state.stream);
  const recorder = state.mediaRecorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      state.chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", async () => {
    const blob = new Blob(state.chunks, {
      type: recorder.mimeType || mimeType || "audio/webm",
    });

    stopStreamTracks();
    state.mediaRecorder = null;
    state.recording = false;
    state.starting = false;

    if (blob.size === 0) {
      state.busy = false;
      setPhase("idle");
      syncControls();
      setStatus("Idle", "Ready", false);
      setMessage("Recording was too short. Hold Ctrl or the button a little longer.");
      return;
    }

    state.busy = true;
    setPhase("processing");
    syncControls();
    setStatus("Transcribing and cleaning up...", "Working", true);
    setMessage("Processing the recording through the dictation pipeline.");

    try {
      const audioBase64 = await blobToBase64(blob);
      const result = await window.scriboAPI.processAudio({
        audioBase64,
        mimeType: blob.type || "audio/webm",
      });

      state.transcript = result.transcript || "";
      state.cleanedText = result.cleanedText || result.transcript || "";
      syncOutputs();

      if (result.warning) {
        setMessage(result.warning);
        setPhase("ready");
        setStatus("Draft ready", "Ready", false);
      } else {
        setMessage("Draft is ready. Sending it back to your app.");
        await insertText({ auto: true });
      }
    } catch (error) {
      setPhase("error");
      setMessage(error.message, true);
      setStatus("Processing failed", "Error", true);
    } finally {
      state.busy = false;
      syncControls();
    }
  });

  recorder.start(250);
  state.starting = false;
  state.recording = true;
  setPhase("recording");
  syncControls();
  setStatus("Listening...", "Recording", true);
  setMessage("Speak naturally and release when you are done.");

  if (!state.wantsRecording) {
    stopRecording();
  }
}

function stopRecording() {
  const recorder = state.mediaRecorder;
  if (!state.recording || !recorder || recorder.state !== "recording") return;
  recorder.stop();
}

function beginPushToTalk(source) {
  if (source === "pointer") state.pointerHeld = true;
  if (source === "pill") state.pointerHeld = true;
  if (source === "ctrl") state.ctrlHeld = true;

  state.activeInputSource =
    source === "ctrl"
      ? "Ctrl"
      : source === "pill"
        ? "Pill"
        : "Button";
  state.wantsRecording = state.pointerHeld || state.ctrlHeld;
  if (state.wantsRecording) {
    startRecording();
  }
}

function endPushToTalk(source) {
  if (source === "pointer") state.pointerHeld = false;
  if (source === "ctrl") state.ctrlHeld = false;
  if (source === "pill") state.pointerHeld = false;

  state.wantsRecording = state.pointerHeld || state.ctrlHeld;
  if (!state.wantsRecording && state.recording) {
    stopRecording();
  }
}

async function toggleRecording() {
  if (state.busy) return;
  state.pointerHeld = false;
  state.ctrlHeld = false;
  state.wantsRecording = false;
  state.activeInputSource = "Shortcut";

  if (state.recording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function insertText({ auto = false } = {}) {
  const text = getCurrentDraftText();
  if (!text) return;

  state.cleanedText = dom.cleanOutput.value.trim();
  state.transcript = dom.rawOutput.value.trim();
  state.busy = true;
  syncControls();

  setPhase("processing");
  setStatus(auto ? "Returning text to your app..." : "Sending text back...", "Insert", true);

  try {
    const result = await window.scriboAPI.insertText(text);
    const target = result.targetApp ? ` into ${result.targetApp}` : "";
    finishReadyState(auto ? `Pasted${target}. Ready for the next dictation.` : `Inserted${target}. Ready for the next dictation.`);
  } catch (error) {
    recoverAfterInsertFailure(error.message);
  } finally {
    state.busy = false;
    syncControls();
  }
}

async function copyText() {
  const text = getCurrentDraftText();
  if (!text) return;

  await window.scriboAPI.copyText(text);
  setMessage("Copied to the clipboard.");
}

async function saveSettings(event) {
  event?.preventDefault?.();

  state.savingSettings = true;
  syncSettingsControls();
  setSettingsStatus("Saving settings...");

  try {
    const response = await window.scriboAPI.saveSettings({
      apiKey: dom.apiKeyInput.value,
      tone: state.selectedTone,
      customDictionaryEnabled: state.customDictionaryEnabled,
      customDictionary: dom.customDictionaryInput.value,
    });

    applyConfig(response.config || {});
    dom.apiKeyInput.value = String(response.config?.apiKey || "");
    setSettingsStatus("Settings saved.");

    if (response.config?.hasGroqKey) {
      setMessage(`Groq is configured. ${state.selectedTone === "casual" ? "Casual" : "Professional"} tone is active.`);
    } else {
      setMessage("Add a Groq API key in settings to enable real dictation. Scribo will stay in demo mode until then.");
    }
  } catch (error) {
    setSettingsStatus(error.message || "Could not save settings.", true);
  } finally {
    state.savingSettings = false;
    syncSettingsControls();
  }
}

function clearDrafts() {
  state.transcript = "";
  state.cleanedText = "";
  dom.rawOutput.value = "";
  dom.cleanOutput.value = "";
  setPhase("idle");
  setStatus("Idle", "Ready", false);
  setMessage("Capture a fresh dictation whenever you are ready.");
  syncControls();
}

function isEditableTarget(target) {
  if (!target) return false;

  const tagName = target.tagName?.toLowerCase();
  return Boolean(
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select",
  );
}

async function init() {
  applyConfig(await window.scriboAPI.getConfig());

  dom.recordButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dom.recordButton.setPointerCapture?.(event.pointerId);
    beginPushToTalk("pointer");
  });
  dom.recordButton.addEventListener("pointerup", () => endPushToTalk("pointer"));
  dom.recordButton.addEventListener("pointercancel", () => endPushToTalk("pointer"));
  dom.recordButton.addEventListener("lostpointercapture", () => endPushToTalk("pointer"));
  dom.insertButton.addEventListener("click", insertText);
  dom.copyButton.addEventListener("click", copyText);
  dom.clearButton.addEventListener("click", clearDrafts);
  dom.settingsForm.addEventListener("submit", saveSettings);
  dom.toggleApiKeyButton.addEventListener("click", () => {
    const isHidden = dom.apiKeyInput.type === "password";
    dom.apiKeyInput.type = isHidden ? "text" : "password";
    dom.toggleApiKeyButton.textContent = isHidden ? "Hide" : "Show";
    dom.toggleApiKeyButton.setAttribute("aria-label", isHidden ? "Hide API key" : "Show API key");
  });
  dom.customDictionaryToggle.addEventListener("change", async () => {
    state.customDictionaryEnabled = dom.customDictionaryToggle.checked;
    syncCustomDictionarySection();
    await saveSettings();
  });

  for (const option of dom.toneOptions) {
    option.addEventListener("click", async () => {
      const nextTone = normalizeTone(option.dataset.tone);
      if (nextTone === state.selectedTone) return;
      state.selectedTone = nextTone;
      syncToneToggle();
      await saveSettings();
    });
  }

  dom.cleanOutput.addEventListener("input", () => {
    state.cleanedText = dom.cleanOutput.value;
    syncControls();
  });

  dom.rawOutput.addEventListener("input", () => {
    state.transcript = dom.rawOutput.value;
    syncControls();
  });

  window.scriboAPI.onPillCommand(async (command = {}) => {
    switch (command.action) {
      case "hold-start":
        beginPushToTalk("pill");
        break;
      case "hold-end":
        endPushToTalk("pill");
        break;
      case "copy":
        await copyText();
        break;
      case "insert":
        await insertText();
        break;
      case "clear":
        clearDrafts();
        break;
      default:
        break;
    }
  });

  window.scriboAPI.onShortcutToggleRecording(() => {
    toggleRecording();
  });

  window.scriboAPI.onInsertSuccess(() => {
    finishReadyState("Inserted with the keyboard shortcut. Ready for the next dictation.");
  });

  window.scriboAPI.onInsertError((message) => {
    recoverAfterInsertFailure(message);
  });

  window.scriboAPI.onPushToTalkStart(() => {
    beginPushToTalk("ctrl");
  });

  window.scriboAPI.onPushToTalkStop(() => {
    endPushToTalk("ctrl");
  });

  window.scriboAPI.onPushToTalkError((message) => {
    finishReadyState(message);
  });

  window.addEventListener("blur", () => {
    endPushToTalk("pointer");
  });

  setPhase("idle");
  setStatus("Idle", "Ready", false);
  if (normalizeMicStatus(state.config.microphonePermission) === "denied") {
    setPhase("error");
    setStatus("Microphone blocked", "Error", true);
    setMessage(
      "macOS is currently blocking Scribo's microphone access. Re-enable it in System Settings > Privacy & Security > Microphone.",
      true,
    );
  } else {
    setMessage(
      state.config.hasGroqKey
        ? `Ready for real dictation. ${state.selectedTone === "casual" ? "Casual" : "Professional"} tone is active.`
        : "Groq API key is missing. Scribo will run in demo mode until you add it in settings.",
    );
  }
  setSettingsStatus(
    state.config.apiKey
      ? "Using your saved Groq API key."
      : "No API key saved yet.",
  );
  syncControls();
  publishState();
}

init().catch((error) => {
  setPhase("error");
  setMessage(error.message, true);
  setStatus("Boot failed", "Error", true);
});
