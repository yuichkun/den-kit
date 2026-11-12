# Changelog

Each release pull request adds a dated version section here (`## X.Y.Z — YYYY-MM-DD`);
[RELEASE.md](RELEASE.md#prepare-a-release) says where its entries come from.

## 0.2.1 — 2026-11-12

- **Help** → **Licenses** shows den-kit's license and the licenses of the software it
  includes.
- Code in a codebox can no longer reach the network while the sound is built. Codeboxes
  that only make sound compile and play as before.
- den-kit runs on Electron 44.11.1. Its built-in Chromium and Node.js block the
  compromised eMudhra intermediate certificates, and it has the latest Chromium security
  fixes.

## 0.2.0 — 2026-11-11

A rebuilt den-kit with a new look. Works and My parts from 0.1 are not carried over, and
work files exported from 0.1 cannot be imported.

- den-kit opens in Tile Light. **Settings** → **Theme** offers Tile, Screen and Plate, each
  light or dark, and keeps the choice for the next start. Each work's plugin screen keeps
  its own look.
- Cables show what they carry: solid for audio, dashed for control, dotted for gate.
- The ready-made controls follow one set of rules. A knob takes 200 px of drag for its
  whole range wherever you grab it, the wheel and the arrow keys move a knob or a slider by
  1% of its range, Home and End go to the ends, and a double-click returns it to its
  default. A slider never jumps to the pointer. Every ready-made control works from the
  keyboard.
- A Sampler module plays an audio file from the work's assets, and a codebox reads assets
  with `import { audio, bytes } from '@den-kit/assets'`. A part saved to My parts carries
  its sounds.
- Each work has one AI conversation, which goes on after a restart. The AI splits a large
  request between sub-agents that work at once, and one ⌘Z takes back the whole request.
  It can read a pasted URL and import a file from a URL as an asset.
- A code part reaches nothing outside its work unless you allow it in **Network and
  devices for code parts** in the Project tab, which also allows the microphone, camera
  and MIDI for that work on this computer. A code part can import the work's assets and
  use the same behaviors as the ready-made controls.
- Each work has its own project disk. Commands in the project have no network; den-kit
  installs the packages in `package.json`.
- An exported work file also carries the work's playable build, a web page that plays the
  work without den-kit.
- Reopening den-kit opens the work as it was, with its project's installed packages.
- The asset panel credits den-kit's own showcase pictures as MIT OR Apache-2.0.

## 0.1.2 — 2026-10-17

- No changes to the app itself. This version comes from an updated release
  process that retries notarization when the connection to Apple drops.

## 0.1.1 — 2026-10-17

- The AI panel header shows "AI" once instead of twice.

## 0.1.0 — 2026-10-17

The first preview of the den-kit macOS app.

- Signed and notarized packages for Apple silicon and Intel Macs running macOS 13
  or later, published on GitHub Releases.
- In-app updates: den-kit downloads a new version in the background and installs
  it the next time you quit, or right away when you choose **Restart now** in
  Settings. Your work is saved first, and den-kit never restarts on its own.
- den-kit offers to move itself into the Applications folder, where updates can
  be installed.
- The interface is in English, including the menus and dialogs that macOS
  provides.
