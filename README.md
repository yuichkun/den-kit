# den-kit

den-kit is a visual editor for building and playing instruments and effects from
[den](https://www.npmjs.com/package/@denaudio/den) DSP blocks. Connect a patch,
design its interface, and play it with your keyboard or MIDI controller. You can
work manually or ask ChatGPT to edit the sound and interface.

The project is an experimental prototype. It runs in Chrome or as a locally
built macOS app. The Plugin view is an instrument's interface inside den-kit;
exporting a standalone DAW plugin is not supported.

## Features

- Patch oscillators, filters, envelopes, effects, and custom code into a live
  audio graph.
- Build interfaces with knobs, sliders, XY pads, text, pictures, and custom
  drawing components.
- Reuse parts, stack multiple copies, and start from the included instrument
  and effect examples.
- Ask ChatGPT to edit a patch, build an interface, or work from sketches and
  reference pictures. Changes can be undone while you continue playing.
- Create web-based code parts in a BrowserPod workspace with TypeScript, npm,
  and live previews.
- Save locally and export or import works as JSON files.

## Run from source

Use **Node.js 24** and a current version of **Chrome**. Dependencies are installed
from npm; you do not need a separate checkout or build of den.

```sh
git clone https://github.com/yuichkun/den-kit.git
cd den-kit
npm ci
KIT_CODEX=off npm run dev
```

Open [http://127.0.0.1:5180/](http://127.0.0.1:5180/). This starts the editor
without AI. Manual patching, playing, interface editing, saving, and the example
works do not require sign-in or a service key.

Audio requires **48 kHz**. On macOS, set the output device to 48 kHz in Audio
MIDI Setup if necessary. Click the start overlay to enable audio and MIDI.

### Enable ChatGPT

The repository includes the Codex CLI used by den-kit. Sign in with your ChatGPT
account, then start the editor without `KIT_CODEX=off`:

```sh
npm run codex:login
npm run doctor
npm run dev
```

Authentication is stored in `.codex-home`, separate from your normal Codex
configuration and excluded from Git. AI requests use the signed-in account's
ChatGPT allowance. Manual editing remains available without AI.

Optional settings in a local `.env` file:

| Variable | Purpose |
| --- | --- |
| `KIT_CODEX_MODEL` | Override the default Codex model. |
| `KIT_CODEX_EFFORT` | Set a reasoning effort supported by the selected model. |
| `KIT_CODEX=off` | Disable AI. |
| `KIT_PORT` | Editor port; defaults to `5180`. |
| `KIT_BRIDGE_PORT` | Local AI bridge port; defaults to `5181`. |

### Enable the web workspace

Code parts and the Project workspace use
[BrowserPod](https://browserpod.io/), which runs a Linux environment in the
browser. For browser development, create a key in the
[BrowserPod console](https://console.browserpod.io/) and add it to `.env`:

```dotenv
BROWSERPOD_API_KEY=your_browserpod_key
```

Restart `npm run dev`. The Project tab shows startup progress and provides a
terminal, source editor, and checks. First startup includes package installation
and requires network access. Ordinary patching and ChatGPT graph edits do not
require this workspace.

Keep `.env` and credentials out of version control. The development server
passes the BrowserPod key to the local page; a regular `npm run build` excludes
it from the web renderer.

## Build the macOS app

On macOS, install dependencies and set `BROWSERPOD_API_KEY` in `.env` or the
build environment, then run:

```sh
npm run desktop:package
npm run desktop:run
```

The bundle is written to `release/mac-arm64/den-kit.app` on Apple silicon or
`release/mac/den-kit.app` on Intel Macs. You can also open it from Finder.
The app includes the renderer and native Codex CLI, so running the bundle does
not require Node.js or a development server.

Use **Settings** (`⌘,`) in the app to sign in to ChatGPT and choose a model and
reasoning effort. BrowserPod is configured by the build: app users do not enter
a separate key. Builders must supply a key they are authorized to distribute;
it is bundled in the app and can be extracted from it.

The local packaging command creates an **unsigned, unnotarized** app. Automatic
updates and Windows app packaging are not available. The desktop app uses text
input for AI requests.

## Basic workflow

1. Choose an example on the start screen, or open a new work.
2. In **Patch**, add modules from the palette or press `Tab` to search. Drag an
   output to an input to connect them. Turn unconnected input knobs to change
   the sound without recompiling.
3. Play with the on-screen keyboard, a MIDI controller, or the labeled computer
   keys. `Z` and `X` change octaves; `⌘.` stops all notes.
4. Switch to **Plugin**, enter Edit mode, and arrange controls and decorations.
   Use “→ Plugin” in the patch inspector to expose an input as a control.
5. With AI enabled, type a request such as “add reverb” or “make a bass with a
   neon interface.” Selection attachments and sketches provide context.

You can keep playing and editing while AI works. `Esc` stops a request; applied
changes remain available to undo. One AI request normally forms one undo step;
manual edits during that request keep their own undo steps.

### Common shortcuts

These shortcuts apply outside text inputs. The table uses macOS key names.

| Shortcut | Action |
| --- | --- |
| `Enter` / `⌘K` | Focus the AI input. |
| `⌥⌘E` | Switch between Patch and Plugin. |
| `⌘E` | Switch the Plugin view between Play and Edit. |
| `⇧⌘F` | Toggle the full-screen Plugin view. |
| `⌘Z` / `⇧⌘Z` | Undo / redo. |
| `⌘A` | Select all. |
| Arrow keys / `Shift` + arrow keys | Move the selection / use larger steps. |
| `⌘C` / `⌘V` / `⌘D` | Copy / paste / duplicate. |
| `Delete` | Delete the selection. |
| `⌘G` / `⇧⌘G` in Patch | Create / unpack a part. |
| `⇧Space` in Plugin Edit mode | Add a control, decoration, or code part. |
| `P` | Sketch over the current view for an AI request. |
| `⌘J` | Show or hide the AI panel. |

### Saving and backups

Works and assets autosave locally. Use the **Patch** menu to export a
`.denkit.json` file or import an existing work. Export files for portable backups;
browser storage is tied to the browser profile and local origin.

The macOS app stores its data in
`~/Library/Application Support/den-kit/`. Its local server uses port `5247`;
if another process occupies that port, close it before opening den-kit.

### Custom code parts

The Project workspace contains a web project for each work. A code part exports
`part({ props, mount })` from `src/parts/<name>.ts` and runs in a frame inside
the Plugin view. It can read audio and controls, respond to control changes,
and update the sound through the workspace's `kit` API.

See the [code-part guide](pod-template/AGENTS.md) and
[API definitions](pod-template/src/kit/index.ts) for examples and interfaces.
The workspace provides `npm run check`, `npm run lint`, and `npm run build`.

## Limitations

- Audio runs at 48 kHz; other sample rates are not supported.
- The browser target is current Chrome. BrowserPod needs recent WebAssembly
  features, and only one den-kit tab can own its workspace at a time.
- Native npm binaries do not run inside BrowserPod; use browser-compatible or
  WebAssembly packages for code parts.
- Works can be exported as editable JSON, but not as standalone DAW plugins or
  self-contained web instruments. `npm run build` builds the den-kit renderer,
  not a distributable instrument.

## Development and contributing

The editor uses Vue and TypeScript, den DSP blocks, and unworklet audio
processing. `src/core` contains the work document and graph operations;
`src/editor` contains the interface; `src/ai` and `bridge` handle AI requests;
`src/pod` connects the web workspace; and `desktop` contains the Electron shell.

```sh
npm run check
npm run build
npx playwright install chromium
npm test
```

Run suites separately with `npm run test:unit`, `npm run test:integration`, and
`npm run test:e2e`. Browser tests need Chromium; `CHROMIUM_PATH` can select an
existing installation. Automated regression tests use model and pod substitutes
rather than paid AI or BrowserPod services. Pod tests execute local commands
and may download npm dependencies.

After building the macOS bundle, `npm run desktop:check` verifies it with an
isolated profile. `npm run desktop:check -- --real` additionally uses local
ChatGPT authentication and real BrowserPod resources, consuming service usage.

Bug reports and pull requests are welcome. Include reproduction steps and the
relevant browser or app version, keep changes focused, and run the checks that
cover your change. Do not include credentials or private logs in reports.

## License

den-kit is available under either the [MIT License](LICENSE-MIT) or
[Apache License 2.0](LICENSE-APACHE), at your option. Third-party packages and
services have their own terms. Attribution for bundled showcase assets is in
[SOURCES.md](public/showcase/SOURCES.md).
The [repository history](docs/migration.md) describes the source extraction and
preserved commit history.
