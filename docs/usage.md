# Using den-kit

den-kit runs as the macOS app or in a current version of Chrome. The Plugin view is an
instrument's interface inside den-kit.

Click the start overlay to enable audio and MIDI.

## The macOS app

Use **Settings** (`⌘,`) in the app to sign in to ChatGPT and choose a model and
reasoning effort. ChatGPT sign-in is required for AI requests, which use the signed-in
account's ChatGPT plan. BrowserPod is required and configured by the build: app users do
not enter a separate key.

The desktop app uses text input for AI requests. Its interface is in English, and it
bundles only English localizations, so menus and dialogs provided by macOS and Chromium
also appear in English.

Installed from a release, den-kit downloads new versions in the background and installs
them the next time you quit, or when you choose **Restart now** in Settings. Your work is
saved first. The app never restarts on its own and does not offer **Restart now** during
an AI request. Updates install only when den-kit is in the Applications folder; anywhere
else, the app offers to move itself there.

## Basic workflow

1. Choose an example on the start screen, or open a new work.
2. In **Patch**, add modules from the palette or press `Tab` to search. Drag an
   output to an input to connect them. Turn unconnected input knobs to change
   the sound without recompiling.
3. Play with the on-screen keyboard, a MIDI controller, or the labeled computer
   keys. `Z` and `X` change octaves; `⌘.` stops all notes.
4. Switch to **Plugin**, enter Edit mode, and arrange controls and decorations.
   Use “→ Plugin” in the patch inspector to expose an input as a control.
5. Type an AI request such as “add reverb” or “make a bass with a
   neon interface.” Selection attachments and sketches provide context.

Every natural-language request goes through the LLM. You can keep playing and editing
while AI works. `Esc` stops a request; applied changes remain available to undo. One AI
request normally forms one undo step; manual edits during that request keep their own
undo steps.

## Common shortcuts

These shortcuts apply outside text inputs. The table uses macOS key names.

| Shortcut                          | Action                                        |
| --------------------------------- | --------------------------------------------- |
| `Enter` / `⌘K`                    | Focus the AI input.                           |
| `⌥⌘E`                             | Switch between Patch and Plugin.              |
| `⌘E`                              | Switch the Plugin view between Play and Edit. |
| `⇧⌘F`                             | Toggle the full-screen Plugin view.           |
| `⌘Z` / `⇧⌘Z`                      | Undo / redo.                                  |
| `⌘A`                              | Select all.                                   |
| Arrow keys / `Shift` + arrow keys | Move the selection / use larger steps.        |
| `⌘C` / `⌘V` / `⌘D`                | Copy / paste / duplicate.                     |
| `Delete`                          | Delete the selection.                         |
| `⌘G` / `⇧⌘G` in Patch             | Create / unpack a part.                       |
| `⇧Space` in Plugin Edit mode      | Add a control, decoration, or code part.      |
| `P` in Patch or Plugin            | Sketch over the view for an AI request.       |
| `⌘J`                              | Show or hide the AI panel.                    |

## Saving and backups

Works and assets autosave locally. Use the **Patch** menu to export a work file
(`.denkit`) or import one. A work file carries the work and the contents of its
files, so it opens on another computer; use it for backups. A file may hold at
most 100 MB and a work's files 500 MB together.

The macOS app stores its data in
`~/Library/Application Support/den-kit/`. Its local server uses port `5247`;
if another process occupies that port, close it before opening den-kit.

## Custom code parts

A code part is part of the plugin screen written in code, in the web project that the
Project workspace keeps for each work. The [code-part guide](../pod-template/AGENTS.md)
and the [API definitions](../pod-template/src/kit/index.ts) describe how to write one.

## Known limitations

- BrowserPod needs recent WebAssembly features, and only one den-kit tab can own
  its workspace at a time.
- Canvas drawing code runs in a Worker with APIs such as `fetch` disabled, but
  dynamic `import()` can still load and execute remote JavaScript. Imported
  works and AI-generated Canvas code can therefore make network requests.
- Works export as work files, but not as standalone DAW plugins or
  self-contained web instruments. `vp run build` builds the den-kit renderer,
  not a distributable instrument.
