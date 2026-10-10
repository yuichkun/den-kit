# den-kit (PoC, GEN-648)

A prototype environment for patching den blocks like Bitwig Grid, where the graph itself becomes a plugin's sound and interface.

- CP1 (patching without AI), CP2b (the LLM path for AI requests: Codex and listening tools), and U1 (workspace redesign: a right-hand AI panel, AI that does not ask you to choose, keyboard controls, Plugin view and full screen, and the start screen) are available through the steps in this README.
- U3 (building plugin interfaces): appearance (colors, fonts, backgrounds, component skins, CSS), decorations (text, shapes, pictures, SVG, lamps), custom drawing components (canvas), assets such as pictures, Figma-like editing, and 10 showcase patches. See "Building a plugin interface (U3)" below.
- U6 (an open environment for AI): each work has a web UI project in a browser-hosted Linux environment (BrowserPod). AI uses bash, npm, TypeScript, ESLint, and git directly to build "code parts" that run on the plugin interface and read and change its controls. See "An open environment for AI (pod, U6)" below.
- U5 (larger and repetitive work): patch navigation (marquee selection, two-finger pan, pinch zoom), continuing AI conversations and attaching selections, parts (define once and reuse), stacking (×N: run N copies of a module or part), My parts (save parts for other patches), and faces (put a part's interface on the plugin, including screen-only parts). The showcase includes Rainfall (a raindrop part ×16) and Supersaw (a sawtooth part ×7), built with these features. See "Parts (U5)", "Stacking (×N)", "My parts", and "Faces (part interfaces)" below.

## Getting started (Mac)

Use Node.js 24 and run these commands at the root of this den-kit repository. There is no need to clone or build den itself. The published `@denaudio/den@0.1.0` and unworklet 0.4.1 packages are installed from npm.

```sh
npm ci              # Dependencies, including den, unworklet, and the pinned Codex CLI
npm run codex:login  # Once: sign in to Codex with ChatGPT for the LLM (see "The LLM path")
npm run doctor       # Check the environment; failures include instructions for fixing them
npm run dev          # Open http://127.0.0.1:5180/ in Chrome
```

Patching, playing, interface editing, the showcase, saving, and loading work without AI authentication or external service keys. To try the app without starting AI, use `KIT_CODEX=off npm run dev`. Browser development requires Codex sign-in and a development BrowserPod key. Users of the distributed app sign in with ChatGPT and use the operator's bundled BrowserPod key. Do not share authentication credentials with others.

This repository separates the prototype from den while preserving its history. Rebuilding it for a formal release is a separate phase. See the [migration record](docs/migration.md).

- Audio runs at 48 kHz. If your output device is set to 44.1 kHz, change it to 48 kHz in Audio MIDI Setup. The interface shows a warning when the sample rate is not 48 kHz.
- On the first visit, the start screen asks "What do you want to make?" Type a request and press Enter, or use the arrow keys to select a showcase patch and press Enter. `Tab` moves to the Look column, where you can apply another work's appearance before starting. Selecting a patch also starts audio.
- On later visits, the previous patch opens with a full-screen "Click anywhere to start" overlay. Click anywhere or press a key to start audio and MIDI input; browser rules prevent playback just from opening a page. If audio cannot start (for example, at a sample rate other than 48 kHz), the same overlay explains why.
- Play by clicking the keyboard at the bottom, using its labeled computer keys (A W S E D F T G Y H U J K; Z / X change octaves), or using a MIDI keyboard. `⌘.` stops all notes.

## macOS app (GEN-664)

After `npm ci`, developers can run `npm run desktop:package` to create a production build of `den-kit.app`. The output is `release/mac-arm64/den-kit.app` on Apple silicon and `release/mac/den-kit.app` on Intel Macs. Launch it with `npm run desktop:run` or from Finder. App users do not need to install Node, Codex, or a development server.

- The app and executable are named **den-kit**, the bundle ID is **com.escentier.den-kit**, and the initial version is **0.1.0**. The icon is the eight-square logo in the editor's upper-left corner. Use `npm run desktop:icons` to regenerate PNG/ICNS files from the SVG.
- ChatGPT sign-in, the model, reasoning effort, and conversation copying for delegated work are available in **Settings** (`⌘,`). Sign-in uses the default browser, and credentials are stored in a dedicated den-kit location. The terminal setup below is for browser development.
- Users do not enter a BrowserPod key. The operator supplies `BROWSERPOD_API_KEY` through `.env` or an environment variable at build time. `scripts/build-desktop.ts` bundles it in `Resources/operator.json`; on startup, the main process passes it to the app's renderer to start BrowserPod. The build fails if the key is missing. The CI planned in GEN-665 will supply it to the same build through GitHub Actions Secrets. Because the operator key is used on the client, it cannot be an unextractable secret. The operator manages usage restrictions and monitoring. Jev and lexicon-based instant operations are excluded; every request goes through ChatGPT's LLM path.
- Data is stored in `~/Library/Application Support/den-kit/`. Works, assets, and the pod's persistent disk use this location and a fixed local origin (`http://127.0.0.1:5247`). Settings are stored in `settings.json`, and authentication in `codex/`. Replacing the app does not replace this folder. If the port is occupied, startup fails instead of switching origins.
- The app bundles the production renderer, local AI bridge, and pinned Codex version. The renderer has no direct Node/IPC access, and code-part iframes receive no app APIs. Screen capture is limited to den-kit's own window.
- **The formal release will not provide voice input for AI.** The Electron app uses text input. Speech recognition code remains in the browser prototype but is excluded from formal-release requirements.
- The macOS arm64 0.1.0 app built in [PR #2](https://github.com/yuichkun/den-kit/pull/2) on 2026-10-10 is unsigned and unnotarized, for local verification. Signing, notarization, GitHub Releases, and automatic updates belong to **GEN-665**. Public release and Yuichi's acceptance of the deliverable are separate from implementation and verification.

`npm run desktop:check` tests a production-equivalent `.app` with an empty, dedicated profile: native sign-in start/cancel, settings persistence, screen capture, saving, and restarting. `npm run desktop:check -- --real` temporarily copies the development `.codex-home/auth.json` into that profile and also tests a small ChatGPT edit and undo, all nine real BrowserPod checks, code-part rendering and iframe isolation, and pod disk and installed-package persistence after restart. Add `--ai-pod` to test AI writing an actual part, passing type checking, lint, and build, placing it on the interface, and operating a control through its button. These checks consume ChatGPT usage and BrowserPod resources. The authentication copy is deleted on exit; credentials are never included in the distribution. Images are not sent by default. Only an explicit `--real --image /absolute/path/approved.png` sends a separately authorized test image (a screen showing 200 on a part's button) to ChatGPT and verifies that it can read the number from the image alone without changing the work.

## The LLM path (CP2b)

**Setup (once)**
1. Run `npm run codex:login`. ChatGPT sign-in opens in the browser.
   - Authentication is stored in den-kit's dedicated `.codex-home` (excluded from git). Your usual `~/.codex` settings, MCP, and AGENTS.md are kept separate.
   - To use your usual Codex settings, put `KIT_CODEX_HOME=~/.codex` in `.env`.
2. Run `npm run doctor -- --deep` to check the Codex version, sign-in, isolation (instruction files are not read), and one real round trip.
   - The round trip invokes a ping tool once and uses a small amount of your ChatGPT allowance.
   - It then checks the capabilities needed for members, sketches, and screen sharing (U8), taking about two minutes in total: two concurrent requests, continuing after a tool call that waits 75 seconds, images sent with a request and added during work, conversation copying (fork), and token counts.
   - With Codex 0.160.1, only conversation copying (fork) produces a WARN because den-kit conversations cannot be forked. den-kit uses a summary instead, so no action is needed.
   - All exchanges are logged in `.logs/codex-deep-*.jsonl`. Share this file when troubleshooting.
3. Start `npm run dev`. A green `● LLM` in the upper-right corner means the setup is ready. Signing in while `dev` is running is detected automatically.

**Usage**
- Type a request in the right-hand AI panel and press Enter. `Enter` or `⌘K` focuses the input from anywhere. Short adjustments such as "brighter" or "longer release", code creation, wiring changes, and explanations all use the same LLM path.
- There is no instant interpretation through Jev or a lexicon. If the LLM is unavailable, the app explains why and leaves the work unchanged. Manual patching, playing, and saving remain available.
- Each request row shows the current activity (reading the patch, editing, listening), the changes applied, elapsed time, and the LLM's reply.
- LLM changes are applied to the live patch one step at a time. You can watch and hear the work being made.
  - Each step is first validated and compiled on a copy. Only successful steps reach the live patch. Failed steps make no changes; errors, including module names or codebox line numbers, are returned to the LLM for correction.
  - The LLM can listen when needed, receiving measurements such as loudness, brightness, attack, and stereo width, plus a spectrogram image.
- One `⌘Z` undoes a whole request. If you make a manual edit during it, the AI changes before and after your edit become two separate undo steps.
- You can keep playing and editing while waiting. Your changes retain their own authorship.
- Sending another LLM request during work adds it to the running request.
- `Esc` (or Stop on the request row) stops the LLM. Changes already applied remain and can be undone with `⌘Z`. Undoing LLM changes during work or loading another patch also stops it.
- The LLM does not ask you questions. It uses the most likely interpretation of an ambiguous request and states that interpretation in one line. Rephrase if it guessed wrong.
- The conversation continues, so follow-ups such as "a little more" make sense. Loading another patch starts a new conversation.
- The `LLM` indicator above the AI panel:
  - `LLM: sign in`: sign-in is required (hover for instructions).
  - `LLM ✕`: an error occurred. Click to restart Codex.
  - `LLM 72%`: shown when usage exceeds 50% of the allowance.
- Settings (`.env`):
  - `KIT_CODEX_MODEL`: the model; defaults to Codex's default model.
  - `KIT_CODEX_EFFORT`: reasoning depth (`low` / `medium` / `high`, etc.); defaults to the model's default.
  - `KIT_CODEX=off`: disables the LLM.

**Safety and isolation**
- Codex runs locally through the pinned CLI 0.160.1 using your ChatGPT subscription allowance.
  - This is local use. Offering it as a product requires a separate Sign in with ChatGPT integration.
- The LLM can use only den-kit tools (`kit_*`).
  - Shell, files, web search, app integrations, plugins, and subagents are disabled.
  - All requests for approval are rejected.
- The working directory is a temporary folder outside the repository. den-kit's AGENTS.md is not read.
- Tools run in the browser. The bridge listens only on 127.0.0.1.
- Logs:
  - `.logs/codex-*.jsonl`: startup, request outcomes, and rejected requests.
  - `.logs/trace-*.jsonl`: rows with `kind: llm`.

## The workspace

**Patch**: drag or click modules in the top palette to place them. Double-click the canvas or press Tab to open search.
- Drag an empty area for marquee selection, with no modifier key. On a trackpad, pan with two fingers and pinch to zoom. With a mouse, use the wheel to pan, `⌘` + wheel to zoom, or middle-button drag to pan.
- Drag from an output dot (right) to an input ring (left) to connect a cable.
- Input colors show the signal type.
  | Color | Signal |
  |---|---|
  | Red | Audio |
  | Orange | Pitch/frequency |
  | Green | Time/envelope |
  | Cyan | LFO output |
  | Blue | Other values |
  | Yellow | Gate |
- Unconnected inputs are knobs (AudioParams). Turning them does not recompile audio.
- Large knobs on a module's surface are its common controls. Other values appear in the left inspector. Press "+N" to show all inputs.
- The ↺ / ⎍ / ↑ symbols beside inputs are precords. While unconnected, they automatically follow the note gate, new notes, and panic.
- Modules between **Voice In** and **Voice Mix** are duplicated per voice, indicated by the stacked icon in their upper-left corner.
- Feedback connections must pass through **History** (a one-sample delay).
- **Codebox** accepts code using the unworklet core API. Errors appear on the relevant lines.
- Code displays and editors (generated code in the Code tab, Codebox, canvas code, Project files, and SVG/CSS in the inspector) use syntax highlighting (highlight.js; colors only, no LSP).

**Plugin**: shows only the plugin interface, as it would appear in a DAW.
- The interface scales to fit the window, filling unused space with its background.
- `⇧⌘F` (or Full screen) fills the screen with only the plugin interface. `Esc` returns. Computer-keyboard playing still works in full screen.
- `⌥⌘E` switches between Patch and Plugin. `⌘E` switches between Play and Edit, following the same idea as Max.
- In Edit mode, click to select (`Shift` adds to the selection), drag to move, and use corner handles to resize. Arrow keys nudge (`Shift` for larger steps). `⌘A` selects all, `Delete` removes from the interface, and `⌘C` / `⌘V` / `⌘D` copy, paste, and duplicate.
- In Patch view, "→ Plugin" in the left inspector puts an input on the interface as a knob. Four themes are available.

**Code**: displays the generated unworklet processor read-only, highlighting the selected module's lines.

**AI panel**: occupies a full-height column on the right, without covering the patch or plugin interface.
- `⌘J` hides or shows it. Drag its left edge to resize it. In narrow windows, it automatically shrinks to about a third of the window width.
- Selected modules, parts, cables, and interface elements appear as attachments above the input. Say "about this..." to have the AI edit the attachments; it creates something new only when asked. Remove an attachment with ×, or press `Backspace` with an empty input to remove the last one.
- Each patch has one LLM conversation. Every turn includes what happened since the previous turn: requests and outcomes, manual changes, and undo. Conversations survive page reloads. Follow-ups such as "a little more" or "undo that" are interpreted by the LLM using that context, without a keyword parser or immediate edit path.

**Keyboard shortcuts** (outside text inputs)
| Key | Action |
|---|---|
| `Enter` / `⌘K` | Focus the AI input |
| `Space` (hold) | Speak a request (browser prototype only) |
| `Esc` | Stop the LLM, leave the input, or clear the selection |
| `⌘Z` / `⇧⌘Z` | Undo/redo |
| `⌘A` | Select all |
| Arrow keys (`Shift` for larger steps) | Move the selection |
| `⌘C` / `⌘V` / `⌘D` / `Delete` | Copy/paste/duplicate/delete |
| `⌘G` / `⇧⌘G` | Make selected modules into a part/unpack a part |
| `Enter` (with a part selected) / double-click / `Esc` | Enter/leave a part |
| `⇧1` / `⇧0` / `⌘=` / `⌘-` | Fit the patch/actual size/zoom in/zoom out |
| `Tab` | Search modules |
| `⌥⌘E` / `⌘E` / `⇧⌘F` | Patch ⇄ Plugin / Play ⇄ Edit / full screen |
| `⌘J` | Hide/show the AI panel |
| `⌥⌘N` | New patch (start screen) |

**Other controls**
- `⌘Z` / `⇧⌘Z` undo and redo (there are no buttons). One knob gesture or one AI request is one undo step.
- **Patch ▾** in the upper-left corner opens a new patch (start screen) and exports/imports `.denkit.json` files. Autosaves stay in the browser.
- Selecting a module shows all its settings in the left panel. For effect patches, select **Audio In** to switch the audition input (chords, drums, noise).
- Patch-wide problems and the safety mute for runaway audio appear in a banner above the canvas. Changing the patch or undoing with `⌘Z` automatically clears the mute.

## Building a plugin interface (U3)

Open Plugin with `⌥⌘E` and switch to Edit with `⌘E`. All editing can be completed with either mouse or keyboard.

**Placing elements**: `⇧Space` opens the add menu. Type to filter names, then press `Enter` to place an element in the center of the interface.
- Decorations: Text, Value readout (a control's value as text), Rectangle, Ellipse, Line, Picture (an image asset), SVG drawing, Lamp (LED), Canvas (code).
- Controls: Knob, Slider, Switch, Button, XY pad, Keyboard, Pads, Scope, Meter (a corresponding node is created in the patch, ready to connect to any input).
- Drop an image file onto the interface to add it as an asset and place it as a picture.

**Selecting and moving**
| Key/gesture | Action |
|---|---|
| Click (`Shift` adds), or drag from empty space for marquee selection | Select |
| `Tab` / `⇧Tab` | Select next/previous |
| Arrow keys (`Shift` for 10 px) | Move by 1 px |
| `⌥` + arrow keys (`Shift` for 10 px) | Resize by 1 px |
| Eight handles (`Shift` preserves aspect ratio) | Resize |
| `Enter` | Edit text (`⌘Enter` confirms, `Esc` cancels); open code for a canvas |
| `⌥A` / `⌥D` / `⌥W` / `⌥S` / `⌥H` / `⌥V` | Align left/right/top/bottom/horizontal center/vertical center |
| `⌃⌥H` / `⌃⌥V` | Distribute evenly horizontally/vertically |
| `⌘G` / `⇧⌘G` | Group/ungroup (`⌥`-click selects inside a group) |
| `⌘]` / `⌘[` / `⌥⌘]` / `⌥⌘[` | Bring forward/send backward/bring to front/send to back (also works with the corresponding bracket keys on a JIS keyboard) |
| `⇧⌘L` / `⇧⌘H` | Lock/hide (repeat to reverse) |
| `⌘C` / `⌘V` / `⌘D` / `Delete` | Copy/paste/duplicate/delete (preserving cables between copied elements, fully selected groups, and lamps/readouts referring to copied controls) |
| `⌘Z` / `⇧⌘Z` | Undo/redo (one drag or a sequence of arrow presses is one step) |

**Appearance (right inspector)**
- With nothing selected, it shows the plugin's overall appearance:
  - Base theme and colors (bg, fg, accent, track, knob, pointer, muted, glow).
  - Fonts (all 15 bundled typefaces use the OFL; standard Mac fonts are also available).
  - Backgrounds (layer colors, gradients, and images).
  - Default skins by component type.
  - CSS (scoped to this plugin; only `url(asset:ID)` asset URLs are allowed).
- Selecting a component shows its skin and parameters, box styling (fill, border, corner radius, shadow), text appearance, and component-specific colors.
- Skins:
  - Knob: classic, ring, cap (scale, numbers, chickenhead), dot, image (rotates your image).
  - Slider: bar, fader, image.
  - Switch: button, footswitch, switch, image.
  - XY: pad, glow (a glowing dot and trail).
  - Keyboard: piano, pads.
  - Scope: line, phosphor.
  - Meter: bar, needle (VU), led.
- The asset panel lists images and fonts. Images can be used "On the plugin", as a "Background", or as a "Reference" (an underlay visible only during editing). Source and license information is preserved in exported files.

**Canvas (code)**: a custom drawing component, renamed from "custom parts" in U4 and earlier. Older files remain readable. Code runs on a canvas in a separate thread (Worker), without network access.
- Write `export default function draw(ctx, f) { … }` (or `{ setup, draw }`). It runs every frame.
- Available through `f`:
  - Dimensions and time: `w`, `h`, `t`, `dt`.
  - Audio: `level`, `peak`, `wave` (waveform), `spectrum` (64 bands, 0–1).
  - Control values: `value(id)`, `norm(id)` (0–1), `xy(id)`, `on(id)`.
  - Other data: appearance colors such as `color('accent')`, `props`, and `state` (a container retained across frames).
- Exceptions appear inside the component with line numbers. A frame taking more than 1.5 seconds (such as an infinite loop) stops the component. The rest of the app keeps running in either case.

**Showcase**: the 12 works on the start screen are ordinary patches built entirely with den-kit operations. There is no special code for individual works.
- Open one and edit its patch, interface, and code directly.
- `Look` applies another work's appearance, replacing colors, fonts, backgrounds, and skins while preserving sound and layout.
- All images are CC0, public domain, or created for den-kit. Sources are listed in [`public/showcase/SOURCES.md`](public/showcase/SOURCES.md).

| # | Work | Brief |
|---|---|---|
| 1 | Acid Line | Acid bass. Fluorescent green on black, with large cutoff and resonance controls |
| 2 | Afterglow | A slowly moving, spacious pad. Sunset colors, XY for brightness × motion |
| 3 | Lullaby Box | Metallic bells like a music box. Wood and brass |
| 4 | Bop Box | Percussion for children to play. Eight large colorful pads, with a hand-drawn reference |
| 5 | Reel Echo | A 1970s tape echo. Needle VU meter and spinning reels |
| 6 | Ember Fuzz | Guitar fuzz. Footswitch and LED, with a hand-drawn reference |
| 7 | Side B | Cassette-style lo-fi. Codebox bit reduction, wow, hiss, handwritten labels |
| 8 | Nebula | Space-like ambience. Stars and particles that move with sound |
| 9 | Duck Delay | Delay that ducks while playing. Instrument-panel styling and a meter for ducking amount |
| 10 | Neon Sweep | XY filter. Neon with a glowing finger trail |
| 11 | Rainfall | Rain against a window. One raindrop part ×16, with intensity, drop pitch, splash, and wind controls (U5) |
| 12 | Supersaw | A sawtooth part ×7 with small offsets. Detune and width (U5) |

**Safety rules**: prevent patch files and AI edits from injecting content into the page.
- All colors, numbers, and asset references are validated before rendering.
- CSS is scoped to the plugin after removing `@import` and non-asset `url()` references.
- SVG renders as `<img>`, so scripts do not run.
- Network APIs such as `fetch` are removed from canvas Workers.
- Remaining gap: dynamic `import()` inside Workers is not blocked. A CSP to block it will be added during productization.

## AI also builds interfaces (U4)

**AI appearance changes**: type an appearance request in the prompt. Every request uses the LLM path, and each request's changes can be undone with one `⌘Z`.
- Examples: "make the accent red", "make the text larger", "use a handwritten font", "round the corners", "darken the interface", "dark mode", or "give it a neon look" (apply a showcase appearance).
- For "darker" or "brighter", specify "interface", "appearance", or "colors" when you mean the interface rather than the sound. The LLM also receives the current view and editing context.
- New sounds created with requests such as "make a bass" receive an initial interface (name, main controls, keyboard).
- Sound adjustments such as "brighter" use the plugin's control when that control drives the relevant value, so its knob moves too.
- After an interface-changing request, if you are viewing the patch, the AI panel offers "Show the plugin ⌥⌘E".

**The LLM builds the interface**: requests such as "build an interface" or "make it look like a tape machine" go through the same LLM path.
- The LLM follows this sequence:
  1. Read the interface (kit_get_plugin).
  2. Consult the UI reference (kit_ui_reference: colors and fonts, skins, decoration types, canvas, bundled pictures, showcase looks, layout advice).
  3. Edit (kit_apply_ops). `addControl` places a knob connected to a module input.
  4. Look (kit_look).
  5. Fix any issues found, then look again.
- Interface-only edits do not recompile audio.
- **Design brief**: at the top of the inspector with nothing selected. The LLM writes the brief first and follows it in later requests. You can edit it yourself.
- **Manual changes**: the LLM is told about components and colors you have changed manually since opening the patch, and leaves them alone unless asked.
- **Reference pictures**: the LLM can view photos and sketches added as assets, including underlays (kit_view_picture). Main colors are also provided numerically.

**Interface checks** (`⌥⌘K` while editing with `⌘E`, or ✓ Check): the same checks used by the LLM. The plugin is rendered offscreen to check:
- Layout:
  - Elements outside the interface or clipped at its edges.
  - Overlapping controls or controls hidden under opaque elements.
- Text:
  - Overflowing text, cramped labels, text overlapping controls, and text that is too small.
  - Contrast against the actual pixels behind the text, including text shadows and neon glow.
    - Below 3:1: "hard to read".
    - Below 4.5:1 (3:1 for large text): "low contrast".
- Components and assets:
  - Unconnected controls or controls without labels.
  - Missing images or canvas errors.

Red markers indicate issues to fix; yellow markers indicate items to check. Click an item to select its component. None of the 12 showcase works has red items.

**Pointer interaction with a canvas**: add `pointer` as in `export default { draw, pointer(e, f) { … } }` to receive pointer events while playing.
- `e.type` is one of `down`, `move`, `up`, `wheel`, `double`, or `leave`.
  - Position: `e.x`, `e.y` (canvas coordinates).
  - Movement: `e.dx`, `e.dy`.
- Change control values with `f.set(id, value)` and `f.setNorm(id, 0–1)`.
  - Values are clamped to range; logarithmic controls use logarithmic scaling.
  - One drag or a continuous wheel gesture is one `⌘Z` step.
- `f.range(id)` (range and unit), `f.pointer` (position and pressed state), and `f.cursor('grab')` are also available.
- The controlled component does not have to be placed on the plugin. A canvas can replace a knob's appearance.
- In Edit mode, canvases can be selected and moved like other decorations.

## Parts (U5)

Parts let you define a process once and reuse it in many places with different values. They serve the role of Max subpatches or abstractions through a single mechanism: one definition, with each placement being an instance.

**Creating a part**: select an area in Patch view and press `⌘G`.
- Cables crossing the selection boundary become part inputs and outputs. Cables from the same source share one input.
- Unconnected main knobs (large knobs on module surfaces) become parameters. The sound does not change by even one sample, as verified by tests.
- Controls (ui.*), Voice In, Out, and Audio In remain outside the part. Controls connect to part inputs or parameters.
- The initial name describes the contents (for example, Oscillator + Lowpass + VCA). Rename it and describe its purpose in the left inspector; AI reads this too.
- "A part (start small)" on the start screen begins inside an empty part. A request entered there targets that part.

**Entering a part**: select it and press `Enter`, or double-click. Breadcrumbs appear above (Patch › Tone › Inner). `Esc` leaves when nothing is selected.
- Editing inside affects every instance in the patch.
- ◆ beside an internal knob identifies a part parameter. It shows the value for the instance you entered; turning it changes only that instance's value, without recompilation.
- Click ◇ in the inspector to expose a knob as a part parameter, with separate values per instance. Click ◆ to hide it again.
- Parameters can have custom ranges and units. Edit the minimum, maximum, and unit below a parameter in the part inspector (↺ restores the internal knob's range). For example, change a Multiply control's ±1 million range to "0–1 st". Instance knobs, faces, and AI requests such as "raise it a little" use this range. It cannot exceed the internal knob's range.
- Inputs and outputs appear inside as "Part input" and "Part output". Add them from the palette to add part ports.
- "Hear alone" auditions just that part; press again to return to the whole patch.

**Reusing a part**: place another instance from "Parts" in the palette. Parameter values are independent per instance.
- "Own copy" makes that instance a separate part; internal edits no longer affect other instances.
- `⇧⌘G` (Unpack) restores ordinary modules. With only one instance, the original modules are restored directly.
- Parts can contain other parts, but cannot contain themselves.
- Deleting the last instance also deletes the definition (`⌘Z` restores it).

**AI and parts**
- Requests such as "make this a part", "unpack", and "detach" use the LLM path and target the selection.
- Inside a part, requests target that part. "Brighter", for example, changes parameters of the instance you entered. Outside, the AI changes exposed part parameters rather than internal knobs.
- The LLM can create parts, reuse them, edit their contents, and expose parameters. Its instructions recommend "make something small, listen, then turn it into a reusable part if it works". Requests from inside a part identify both the definition and the instance to the LLM.

**Saving**: the file format is version 3. Part definitions are saved with the patch. Version 1 and 2 files remain readable.

## Stacking (×N)

To repeat something many times (raindrops, seven supersaw oscillators, layered voices), assign a count to a module or part instead of placing many nodes, following the idea of Max's mc or SuperCollider's multichannel expansion.

**Setting the count**: select a module or part and use "Copies" in the inspector to choose ×2, ×4, ×8… or enter a number (maximum 128).
- The box gains a "×8" label and stacked shadows. Its outgoing cables become thicker with "×8" at the source: eight signals in one cable.
- den modules, math, codebox, History, and parts can be stacked. Voice In, Voice Mix, Out, Audio In, controls, and Splay remain single.
- Stacked noise and random modules use a different seed for each copy, rather than playing the same sound N times.

**Connection rules**
- Thick cable → stack with the same count: copy 1 connects to copy 1, copy 2 to copy 2.
- Thin cable → stack: the same signal goes to every copy.
- Thick cable → single input: signals are summed and multiplied by 1/√N, with Σ shown at the input. Gates use "any on"; Voice Mix's done input uses "all finished".
- Thick cable → stack with a different count: copy k reads copy (k mod N), with a warning.
- **Splay** (Math in the palette): spreads a thick cable across stereo, from the first copy at far left to the last at far right, using equal-power panning and 1/√N compensation. A width of 0 centers everything.
- **Copy number**: inside a part, outputs the copy index (0…N−1), total count, position (−1…+1), and a deterministic random value per copy. Use it to vary pitch or pan across a part ×N.

**Variation**: with two or more copies, the inspector shows a section for each knob.
- range (even spacing within ±amount of the base value), random (random within ±amount; ⟳ rerolls), harmonic (base × 1, 2, 3…), each own (individual values). Amounts use octaves for frequency knobs and the knob's unit otherwise.
- The bar chart below shows each copy's value. Drag over bars to draw individual values, switching to each own. One `⌘Z` undoes the gesture.
- Changing the base value (the box's knob), variation amount, type, seed, or bar values while playing does not recompile. Changing which knobs vary or changing the copy count does.
- For connected inputs, including plugin and face knobs, variation offsets the cable's value. Logarithmic controls such as frequency or time use multiplication (±amount in octaves); others use addition. A face knob can therefore move the whole stack while preserving differences between copies. The variation section shows "· cable".

**Cost**: the 400-node-per-patch limit has been replaced by a limit based on expanded cost.
- Each box shows its estimated CPU cost (a fraction of one core) in the lower-right corner. Totals above 25% also appear in the top bar, and above 60% produce a yellow warning.
- Estimates use measurements from Node 24 in the cloud, measuring each module without compilation. Comparisons against actual measurements for the showcase, starters, and stacks (×1–×48) mostly fall within ±25%; substantial codeboxes are underestimated. Mac browsers are usually faster, so the estimates are conservative there.
- Expanded programs above about 1500 kB cannot be built, or cannot run in time. Compilation stops with an explanation and the heaviest boxes identified. The previous sound keeps playing.
- Measurements show per-copy cost growing slightly with program size (about 1.3× at 500 kB), then sharply above about 750 kB (about 4× at 1000 kB, because the whole program becomes one function). Rainfall's raindrop part used about 35% of one core at ×16, 90% at ×32, and 310% at ×48. Tens of small parts are practical; hundreds of drops at realistic rain density are too expensive. Those should be implemented as a den block.

**AI and stacking**
- Requests such as "stack 8", "16 copies", "more copies", "unstack", "spread them out", "detune it", "less spread", and "no spread" use the LLM path and target the selection. "Make this a part and stack 8" creates a part before stacking it.
- The LLM can use setCount and setSpread. Its instructions recommend counts rather than repeated placements, checking the estimated load and keeping it at or below 60% (kit_get_patch includes stacking, variation, and load).

## My parts

Save a part to place it from the palette in any patch, like reusable external objects in Max. Parts are stored in this browser and immediately appear in other tabs.

**Saving**: select a part (or enter it), then choose "Save to My parts" in the inspector. It appears with ★ under "My parts" in the palette.
- Saved parts show "★ From My parts: Name v1". After internal edits, pressing again becomes "Save as v2" and saves a new version, retaining up to 10 versions. No new version is created if nothing changed.

**Placing**: click or drag from "My parts" in the palette. Parts also appear in search (`Tab`).
- Placing a part adds its definition and any nested part definitions to this patch. The work owns the version's contents, so deleting it from My parts does not silence the work.
- Placing an unchanged version again adds another instance of the same definition.
- IDs that conflict with the patch's IDs are reassigned automatically.

**Updating to a new version**: when a new version is saved at the source, selecting that part in another patch shows "v2 is in My parts: adds the knob “Rate” …", previewing added or removed knobs and ports.
- "Update to v2" replaces the contents. Existing parameter values are preserved for retained knobs; cables to removed ports are disconnected. One `⌘Z` undoes the update.
- If the part has local edits, "changed here since" warns that updating will replace them.

**Files**: "Export…" in My parts exports everything to one `.denkit-parts.json` file; "Import…" reads it. New versions are appended, and identical contents are not duplicated. Invalid files or unreadable versions are skipped with an explanation. × on a tile removes it from My parts without affecting works that use it.

**AI and My parts**: kit_list_blocks gives the LLM the My parts list, including inputs, knobs, and outputs; `placeMyPart` lets it place them. Its instructions recommend using a suitable saved part instead of rebuilding it.

## Faces (part interfaces)

A part can have its own interface, or face: controls for its parameters plus decorations (text, shapes, pictures, lamps), serving the role of Max's bpatcher.

**Putting a face on the plugin**: select a part instance in Patch view, then choose "Put face on plugin" below "Face: …" in the inspector.
- The face is placed as controls and decorations linked to that instance, grouped as `<instance>Face`.
- Controls work while playing without recompilation. Ranges, units, and values come from the part's parameters, including custom ranges. Logarithmic time or frequency controls whose ranges begin at 0 instead start at values such as 1 ms or 20 Hz.
- Shapes, pictures, and canvases are layered below controls; text and lamps above them.
- Press again ("Update face on plugin") to replace the face in place without duplication. One `⌘Z` removes the placement.
- Parts without a custom face use a default: the name above parameter knobs, wrapping after six knobs. "Default face" resets a custom face.
- Faces cannot be placed for nested instances because their controls must live in the main patch. The interface explains this.

**Redesigning a face**: in Plugin Edit mode, move, remove, or add controls and decorations to the placed face, select them, then choose "Save as Part's face" in the inspector.
- Decorations and selected controls linked to that instance's parameters become the face. If two controls target the same parameter, only one is used.
- Text referring to controls excluded from the face keeps only its words (for example, "DRIVE {value} dB" → "DRIVE dB"). Value-only readouts and lamps for those controls are omitted, with an explanation.
- Saving immediately updates other instances whose faces are on the plugin. The whole change is one `⌘Z` step.
- Faces are saved with the patch. Invalid faces in a file fall back to the default with an explanation. Faces do not affect audio or the code-generation hash.

**Screen-only parts**: select only decorations on the plugin (a logo, nameplate, screw illustrations, etc.) to reveal "Make a screen part" in the inspector.
- It creates an empty part with a face made from the selected decorations. The name comes from the first text element ("NEBULA" → Nebula). The sound is unchanged.
- Save it to My parts, and placing it in another patch immediately puts its face on the plugin. Placement inside another part does not.
- Pictures and fonts travel with the face. They render directly in the same browser. My parts' "Export…" includes the image and font data, so they also render after import in a browser on another Mac.
- Images used by a face cannot be deleted from assets (the message names the face, such as "Used by Tone's face"). Missing bundled images are restored automatically. Unavailable images are omitted, with a notice, when placing the face.

**AI and faces**: the LLM designs faces through `updatePart`'s `face` field and places them per instance with `putFace`, including placing a newly created face in the same call. `makeScreenPart` turns decorations into screen-only parts. Its instructions recommend placing a face rather than adding knobs individually when making a part playable on the plugin. kit_get_patch includes each part's face details: custom/default, control and decoration counts, and dimensions.

## An open environment for AI (pod, U6)

A prototype that gives den-kit's AI a freely usable environment, similar to Claude Code. Each work has a web UI project (Vite + TypeScript, ESLint, git) in a Linux environment (BrowserPod) running inside the browser tab. AI uses bash, file reads and writes, npm, tsc, eslint, and git directly, and its "code parts" run on the plugin interface. No server or files on your Mac are used.

**Browser development setup (once)**

These steps are for development with `npm run dev`. Electron builds bundle the operator's BrowserPod key in `operator.json`; users do not enter a key.

1. Create a key at console.browserpod.io and add `BROWSERPOD_API_KEY=…` to `.env` (excluded from git).
   - For browser development, the development server (`npm run dev`) passes this key to the page. It is excluded from the web output of `npm run build`. Electron's `desktop:build` and `desktop:package` bundle it. It is never sent to Codex.
2. Restart `npm run dev`. The terminal shows `Pod → BrowserPod, key …`.
3. Open Chrome and start audio. On the first visit in this browser, the pod starts automatically, taking 1.5–2.5 minutes including package installation. The Project tab shows progress.
4. Press "Check the pod" in the Project tab to run timed checks of each stage (see "Pod checks" below).

**Project tab** (to the right of Patch, Plugin, Code)
- Top: pod status (off → booting → syncing → installing → starting → ready) and stage timings (boot, file writes, npm install, development server). "Start the pod" starts it; "Check the pod" runs checks.
- Left: interface project files. A work without its own project shows the template; the first change makes it part of the work. Select and edit a file, then `⌘S` to save it into the work (one `⌘Z` undoes it). `src/kit/controls.ts` is generated by den-kit from the patch and is read-only.
- Center: the file editor uses syntax highlighting by file type (TypeScript, JavaScript, JSON, CSS, HTML/SVG, Markdown, shell). Colors only, without completion or LSP error reporting.
- Right: pod check results.
- Bottom: the pod terminal lists commands from you, AI, and den-kit with output, exit code, and duration. Enter any command, such as `npm run check`, `git log`, or `npm install three`. Files changed by commands are saved into the work as your own edit, undoable with `⌘Z`.

**Code parts** (a plugin interface component type)
- Each `src/parts/<name>.ts` in the interface project defines a part using `part({ props, interactive, mount(root, kit) })`.
  - `kit` reads patch controls (`kit.value('knob1')`, `kit.norm`), audio (`kit.audio.level`, `wave`, `spectrum`), and appearance colors (CSS variables `--dk-*`).
  - `kit.set` and `kit.setNorm` change controls. One drag is one `⌘Z` step.
  - See the template's `AGENTS.md` and `src/kit/index.ts` for details.
- The plugin loads the part's page in an iframe from the pod's Vite development server. File changes appear within seconds through Vite live reload; if they do not arrive, den-kit reloads the part.
- In Edit mode, `⇧Space` → "Code part (web)" places a waveform-drawing part. Its declared settings, such as color, appear in the inspector. "Open its file" opens its source in the Project tab.
- `⌘Z` and computer-keyboard notes still reach den-kit after clicking a part; keys not consumed by the part are forwarded.
- Errors appear below the part's frame, and AI can read them through `kit_look` and `kit_get_plugin`.

**AI (LLM) and the pod**
- AI tools include `kit_bash` (runs bash in the project folder, returning output and exit code), `kit_read_file`, and `kit_write_file`.
- Instructions specify:
  - Shell and files are in the pod.
  - Write code parts when den-kit's built-in components are insufficient.
  - Read `AGENTS.md` first.
  - Pass `npm run check` and `npm run lint`, then inspect with `kit_look`.
- AI file changes are saved into the work as part of the request; the whole request is one `⌘Z` step. Each request is committed in the pod's git repository (`den-kit AI: …`).
- Try requests in Plugin view such as "make a spinning tape-reel component whose speed follows the cutoff knob" or "use three.js for an audio-reactive 3D sphere in the background".

**Pod checks** (measuring the experience)
- Each stage is timed without changing the work:
  1. Pod startup (boot, project writes, npm install, development server).
  2. bash, git, Node, npm.
  3. TypeScript (`npm run check`).
  4. ESLint (`npm run lint`).
  5. npm install of one package (without saving).
  6. Build (`npm run build`).
  7. git.
  8. Loading a code part.
  9. Time for an edit to reach the part.
- "Copy" copies results as text. They are also recorded in bridge logs (`.logs`).

**Things to know**
- The work (patch file) contains only project source. node_modules, dist, and .git exist only in the pod. The pod disk persists in this browser's IndexedDB.
- The production release uses BrowserPod Pro, paid for by the operator. App users use the bundled operator key instead of supplying their own.
- Distributing finished works as static files from `npm run build` does not require BrowserPod; this is intended for Portal. The PoC does not yet support that export.
- npm packages with native binaries do not run in the pod. The template substitutes WebAssembly versions of esbuild and rollup. Pod networking is limited to allowed destinations such as npm and GitHub.
- Use current Chrome: BrowserPod requires WebAssembly resizable memory and `Atomics.waitAsync`; older browsers show "Update Chrome". Keep only one den-kit tab open. BrowserPod runs in only one tab, and other tabs explain why they cannot start it.

**Verification with real BrowserPod** (3.4.0, Chrome 155, 2026-10-08)
- Startup:
  - First use in this browser: 1.5–2.5 minutes to Ready (boot 5–7 seconds, writes and git 4 seconds, npm install 70–110 seconds depending on the connection, Vite 6 seconds).
  - Later visits, with the disk retained in the browser: about 10–14 seconds; page reloads take 8–12 seconds.
- AI code-part creation (read AGENTS.md → write files with bash → `npm run check` and `npm run lint` → place → `kit_look`): about 18 seconds on the pod side, using mock Codex.
- Loading a code part from the portal takes about one second, as does propagating a file edit. Control ↔ part synchronization, clicking the part, and `⌘Z` (including pod files) were also verified.
- Pod checks: all nine stages passed in 24–31 seconds total (TypeScript 4 seconds, ESLint 6 seconds, npm install 4 seconds, build 6 seconds, rendering 1 second, edit propagation 2 seconds).
- three.js: `npm install three` took 23 seconds; tsc and ESLint passed, and the part rendered. The first render took about 14 seconds for dependency conversion.
- A second tab, tab reloads, and closing a tab before starting in another tab were also verified.

**BrowserPod SDK 3.4.0 limitations and den-kit workarounds**
- Node 22.15 in the pod does not correctly execute class async-generator methods, preventing ESLint 10 from traversing directories ("No files matching the pattern"). The template's `npm run lint` enumerates files before passing them to ESLint. This is also documented in AGENTS.md.
- Pod file watching misses folders created after the development server starts. den-kit creates `src/parts` before startup. The template's vite.config.ts discovers new folders every second and adds watchers (`KIT_WATCH_NEW_FOLDERS`).
- Pod file timestamps have one-second precision. Writing the same file twice in one second may not trigger a second live reload. den-kit reloads the part a few seconds later if needed.
- `run()` does not return an ordinary Promise, and terminal output arrives through a resizable ArrayBuffer. den-kit's adapter handles both.
- Automated tests do not use real BrowserPod. The substitute (`test/fakes/pod`) reproduces the quirks that can be modeled, including non-Promise return values and resizable output buffers.

## AI delegation, shared view, and rough sketches (U8)

**Members (AI delegation)**
- For larger requests, the LLM lead delegates some work to other AI members (up to three) running concurrently. The lead decides whether to split the request; small requests stay with the lead. Lead and members use the same model.
- Codex's own subagent feature is not used. den-kit creates separate conversations and manages their tools and scopes.
- Lead tools:
  - `kit_delegate`: starts a member with a brief (name, goal, reason, scope, completion conditions, notes, context level).
  - `kit_wait`: waits for member reports, up to 60 seconds at a time.
  - `kit_tell`: adds instructions to a working member, including sketch-mark numbers.
  - `kit_stop_member`: stops a member.
  - Members report through `kit_finish`: summary, chosen names, requirements, and issues.
- Scope:
  - Audio (the whole patch or specified parts/modules), interface (the whole interface or specified elements/region), or Project (pod).
  - den-kit rejects out-of-scope changes at the operation layer (`src/ai/scope.ts`).
  - Controls and their wiring are shared interfaces; everyone preserves their names.
- Member context: den-kit adds the following to the lead's brief:
  - Your request, recent conversation, and attachments.
  - Sketches in that scope, the current view, and the design brief.
  - The scope's state and shared interfaces.
  - Context level is brief/full/bare. full copies the lead's conversation, or uses a den-kit summary when Codex cannot fork it. bare includes only the brief.
- One `⌘Z` undoes a request's changes, including member changes.
- The AI panel shows a lane for each member under the request: color, scope, elapsed time, tokens, and × to stop. Member changes briefly glow in that color on the patch and plugin.
- Settings (⚙):
  - Members: the AI decides (default) / off (one AI, for comparison).
  - Members are told: the lead decides (default) / brief / full / bare (for comparison).
- Logs: each request records time to first edit, total time, concurrency, and token counts (including per-member counts) in `.logs/trace-*.jsonl`.
- full members begin with a conversation summary prepared by den-kit.
  - Codex conversation copying (`thread/fork`) is unavailable in Codex 0.160.1 because den-kit conversations are ephemeral and have no stored rollout to copy (2026-10-08, Mac `doctor --deep`: "no rollout found").
  - `KIT_CODEX_FORK=1` is for testing future versions. Leave it off for this version; failed forks fall back to summaries.

**Shared view (AI knows what you see)**
- Each request includes a one-line description of your view: Patch or Plugin, zoom, visible modules, selection, held notes, and whether you are inside a part. "This" and "here" refer to that context.
- The eye button in the AI panel shares this tab's screen with AI.
  - The browser asks for sharing permission. den-kit accepts only its own tab.
  - While sharing, AI uses `kit_look` (as "seen") to view the same image you see.
  - Without sharing, the plugin is conveyed through a rendered image and the patch through text.
- A desktop integration such as Electron provides `window.denKitShell.capturePage(rect)`, returning a data URL for an image of the page region. It provides the same view without a screen-sharing prompt (`src/editor/screen-share.ts`).

**Rough sketches**
- Press `P` (or ✎ in the AI panel) to draw over the patch or plugin.
  - Tools: pen, marker, rectangle, arrow, sticky note, text, eraser. Four colors.
  - `Esc` or Done puts the pen down, leaving marks in place.
  - While drawing, `⌘Z` removes the last mark rather than undoing a patch edit.
  - A stylus can draw on empty space (plugin background or patch canvas) without selecting a tool. Over controls or modules, it behaves normally. The first stroke produces a one-time notice. Disable it with "stylus draws" in the sketch toolbar; the choice persists in the browser.
- Marks are excluded from the work and undo history. They are sent with the next AI request.
  - The prompt shows "✎ 2 marks on the plugin" above it. × clears them.
  - Pressing Enter with no text can also send them.
- AI receives:
  - Numbered descriptions of marks: enclosed or touched elements, arrow endpoints, sticky-note text, positions, and sizes. den-kit derives these from their locations on the interface.
  - Images: for Plugin, a rendered image with numbered marks; for Patch, your shared screen if sharing is enabled, otherwise a diagram of labeled module boxes.
- An enclosing mark (a circle or box) targets the enclosed elements like a selection. Requests such as "brighter" are sent with the marks through the LLM path. Sending marks during LLM work adds them to the running request.
- Sent marks fade during AI work and disappear when it finishes. 📌 keeps them. If a request changed nothing, the marks remain for the next request.
- Members receive sketches within their scope: plugin sketches go to interface members, patch sketches to audio members.
- "Lay under" converts the plugin sketch into an underlay (reference image). Place components over it in Edit mode.

**Trying it (Mac)**
- "Make an acid bass with a neon interface": the lead delegates audio and interface work, and their concurrent progress appears in the member lanes.
- To compare, set Members to off in ⚙ and send the same request; compare time to first change and token counts.
- In Plugin, `P` → circle a knob → add a sticky note in empty space saying "waveform here" → `Enter`.
- Share the screen with the eye button, then ask "improve the colors of what I'm looking at".

## How it works

- **Patch format**: a patch is a JSON document. Every change uses typed operations with authorship (`src/core/ops.ts`) and can be reversed exactly. Humans and AI use the same operations.
- **Code generation** (`src/core/codegen.ts`): a patch becomes readable TypeScript using the unworklet core API (one `defineProcessor`). A Worker compiles it and replaces the AudioWorklet with about a 30 ms crossfade. Held notes are retriggered in the new sound.
- **unworklet 0.4.1 caveat**: version 0.4.1 expands expression DAGs. Signals read twice or more, and inputs to den blocks, are therefore written to temporary slots once per sample before being read.
- **den equivalence**: the five starters (bass, percussion, pad, chorus, rhythmic delay) use only combinations of modules. Offline rendering matches den's `createInstrument` and `delayFx` sample for sample (`test/integration/equivalence.test.ts`). Audio status is CANDIDATE.
- **Safety stage**: limiter → clipper. NaN and runaway audio are detected and reported inside the processor, which mutes and resets its state.
- **Pod** (`src/pod`): den-kit communicates only through a defined interface (`host.ts`: command execution, files, portals).
  - Commands run as script files and print an exit-code marker at the end for parsing, because the BrowserPod API does not return exit codes.
  - The work document is authoritative; the pod is a workspace. Undo and loading write back to the pod, and command completion reads files back from it.

## Tests

```sh
npx playwright install chromium  # Once: install the e2e browser
npm test          # unit (vitest) → integration (real compilation, offline rendering, bridge) → e2e (Playwright + Chromium)
```

Unit, integration, and browser regression tests do not use real models.
- Mock Codex in `test/fakes/codex` responds like the pinned CLI, validates every message den-kit sends, and invokes tools according to scripted scenarios.
  - It matches behavior verified against the real app-server without a network (`test/fakes/codex/README.md`).
  - Scenarios cover crashes, malformed lines, exhausted usage, missing sign-in, approval requests, questions, steering, and interruption.
- Pod tests do not use real BrowserPod; real checks are manual (see "Verification with real BrowserPod" above).
  - `test/fakes/pod/fake-pod.ts` (test-only) exposes this machine's bash, git, Node, and npm through the same interface as BrowserPod. In e2e tests, AI writes code parts in this pod using real npm install, Vite, tsc, ESLint, and git.
  - `test/fakes/pod/mock-browserpod.ts` reproduces the BrowserPod API (3.4.0 type definitions) using local processes and files. Undocumented behavior uses stricter interpretations (env replaces the environment, output may split within a character, etc.), exercising den-kit's actual BrowserPod adapter.
- `test/integration/codex-real-offline.test.ts` starts the pinned real Codex binary without network access or sign-in, verifying that den-kit's parameters are accepted unchanged. It does not call a model.

E2e tests require Chromium. Install it with `npx playwright install chromium`, or set `CHROMIUM_PATH`.
