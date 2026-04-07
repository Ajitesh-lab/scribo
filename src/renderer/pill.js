const dom = {
  liveIndicator: document.getElementById("liveIndicator"),
  statusText: document.getElementById("statusText"),
};

const state = {
  phase: "idle",
  busy: false,
};

function applyState(payload = {}) {
  state.phase = String(payload.phase || "idle");
  state.busy = Boolean(payload.busy);

  dom.liveIndicator.dataset.state = state.phase;
  dom.statusText.textContent = state.phase === "recording" ? "Recording" : "";
}

async function init() {
  const latestState = await window.scriboAPI.getDictationState().catch(() => null);
  applyState(latestState || {});

  window.scriboAPI.onDictationState((payload) => {
    applyState(payload);
  });
}

init().catch(() => {
  applyState({ phase: "error", busy: false });
});
