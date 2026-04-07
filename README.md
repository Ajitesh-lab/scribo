# Scribo

Scribo is a macOS dictation app with two surfaces:

- a main workspace for settings and status
- a small floating pill that stays on screen while you dictate

The current build captures microphone audio, sends it to Groq for speech-to-text, refines the transcript into cleaner writing, and pastes the result back into the previously active macOS app.

## Highlights

- Floating bottom-center dictation pill
- Automatic paste-back into the last active app
- User-supplied Groq API key saved locally in app settings
- Professional and casual refinement modes
- Custom Dictionary Beta for names, brands, and repeated special terms
- Global Ctrl push-to-talk helper on macOS

## Requirements

- macOS
- Apple Silicon for the packaged build currently produced here
- A Groq API key entered in the app settings

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Then open the main window, enter your own Groq API key, and save settings.

## Downloading From GitHub

If someone just wants the app and not the source code:

1. Open the repo on GitHub.
2. Click `Releases` on the right side of the page.
3. Open the latest release.
4. Download `Scribo.dmg`.
5. Open the DMG on a Mac and drag `Scribo.app` into `Applications`.

Direct release page:

`https://github.com/Ajitesh-lab/scribo/releases`

## Permissions

Scribo needs these macOS permissions to work properly:

- Microphone
- Accessibility
- Input Monitoring for global Ctrl push-to-talk

If paste-back or global hold-to-talk does not work, check `System Settings > Privacy & Security`.

## Settings

### Groq API Key

Scribo does not ship with a bundled Groq API key. The app only uses the key entered through the settings UI, and that key is saved locally on the machine.

### Tone

- Professional: tighter punctuation and more polished cleanup
- Casual: lighter cleanup that stays more conversational

### Custom Dictionary Beta

The Custom Dictionary is optional and toggleable. When enabled, Scribo uses saved words and phrases as spelling hints during both transcription and cleanup.

Use it for:

- names
- company terms
- product names
- unusual acronyms
- repeated domain-specific vocabulary

## Packaging

Build the macOS app bundle:

```bash
npm run package:mac
```

Build the DMG:

```bash
npm run package:dmg
```

The generated DMG is written to:

`dist/Scribo.dmg`

## Distribution Notes

- The app is currently unsigned, so macOS Gatekeeper may warn on first launch.
- The DMG is too large for standard git history on GitHub, so it should be distributed as a GitHub Release asset rather than committed into the repository.

## Project Structure

- `src/main.js`: Electron main process and window management
- `src/renderer/`: workspace UI, pill UI, and renderer logic
- `src/services/dictation.js`: Groq transcription and refinement pipeline
- `native/control_listener.swift`: macOS helper for global Ctrl detection
- `scripts/`: packaging and helper build scripts

Took 1 day didn't code anything by myslf :)
