const { clipboard } = require("electron");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function quoteAppleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function runAppleScript(script) {
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return String(stdout || "").trim();
}

async function getFrontmostApplication() {
  if (process.platform !== "darwin") return null;

  try {
    const raw = await runAppleScript(
      'tell application "System Events" to tell first application process whose frontmost is true to return name & linefeed & bundle identifier',
    );

    const [name = "", bundleId = ""] = raw.split("\n");
    const trimmedName = name.trim();
    const trimmedBundleId = bundleId.trim();

    if (!trimmedName) return null;

    return {
      name: trimmedName,
      bundleId: trimmedBundleId || null,
    };
  } catch {
    return null;
  }
}

async function activateApplication(target) {
  if (process.platform !== "darwin") return;
  if (!target) return;

  const name = typeof target === "string" ? target : target.name;
  const bundleId = typeof target === "string" ? null : target.bundleId;

  if (bundleId) {
    await runAppleScript(`tell application id ${quoteAppleScriptString(bundleId)} to activate`);
    return;
  }

  if (!name) return;
  await runAppleScript(`tell application ${quoteAppleScriptString(name)} to activate`);
}

async function pasteClipboardIntoFrontmostApp(text) {
  if (process.platform !== "darwin") {
    clipboard.writeText(String(text || ""));
    return { ok: true, strategy: "clipboard-only" };
  }

  const finalText = String(text || "");
  const previousClipboard = clipboard.readText();
  clipboard.writeText(finalText);

  try {
    await runAppleScript(
      'tell application "System Events" to keystroke "v" using command down',
    );
  } finally {
    setTimeout(() => {
      if (clipboard.readText() === finalText) {
        clipboard.writeText(previousClipboard);
      }
    }, 350);
  }

  return { ok: true, strategy: "activate-and-paste" };
}

module.exports = {
  activateApplication,
  getFrontmostApplication,
  pasteClipboardIntoFrontmostApp,
};
