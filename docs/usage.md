# Using den-kit

den-kit runs as the macOS app or in a current version of Chrome. The Plugin view is an
instrument's interface inside den-kit.

Click the start overlay to enable audio and MIDI.

**Settings** → **Theme** changes how den-kit looks: three looks, each light or dark. Each
work's plugin screen keeps its own look.

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
request, including the work of any sub-agents it starts, normally forms one undo step;
manual edits during that request keep their own undo steps. Each work has one
conversation: when you open the work again, the next request goes on from it. Loading a
starter over the work starts a new conversation.

## Common shortcuts

These shortcuts apply outside text inputs. The table uses macOS key names.

| Shortcut                          | Action                                        |
| --------------------------------- | --------------------------------------------- |
| `Enter` / `⌘K`                    | Focus the AI input.                           |
| `⌥⌘E`                             | Switch between Patch and Plugin.              |
| `⌘E`                              | Switch the Plugin view between Play and Edit. |
| `⇧⌘F`                             | Toggle the full-screen Plugin view.           |
| `⌘Z` / `⇧⌘Z` or `⌘Y`              | Undo / redo.                                  |
| `⌥⌘N`                             | Open the start screen for a new work.         |
| `⌥⌘K` in Plugin Edit mode         | Look the plugin over (✓ Check).               |
| `⌘A`                              | Select all.                                   |
| Arrow keys / `Shift` + arrow keys | Move the selection / use larger steps.        |
| `⌘C` / `⌘V` / `⌘D`                | Copy / paste / duplicate.                     |
| `Delete`                          | Delete the selection.                         |
| `⌘G` / `⇧⌘G` in Patch             | Create / unpack a part.                       |
| `⇧Space` in Plugin Edit mode      | Add a control, decoration, or code part.      |
| `P` in Patch or Plugin            | Sketch over the view for an AI request.       |
| `⌘J`                              | Show or hide the AI panel.                    |

## Sounds from files

Add an audio file as an asset, then add a **Sampler** module and choose the file under
**Files** in the inspector. The Sampler plays the file each time its gate opens (in a
voice, on each note), or loops it while the gate is open. Choosing another file does not
recompile. A codebox reads assets with `import { audio, bytes } from '@den-kit/assets'`,
naming each file by its path written out, such as `audio('assets/kick.wav')`.

## Saving and backups

Works and assets autosave locally. Use the **Patch** menu to export a work file
(`.denkit`) or import one. A work file carries the work and the contents of its
files, so it opens on another computer; use it for backups. It also carries the
work's playable build when den-kit can make one. A file may hold at most 100 MB
(a text file 1 MB), and a work at most 2,000 files and 500 MB together.

The macOS app stores its data in
`~/Library/Application Support/den-kit/`. Its local server uses port `5247`;
if another process occupies that port, close it before opening den-kit.

## Playing a work outside den-kit

A work file is a ZIP archive. Its `build/` folder is the playable build: a web page that
plays the work without den-kit, with its plugin screen, sound and assets. Put the folder on
a static web server and open its `index.html`. Click the page to start the sound, then play
with the computer keys, a MIDI controller or the controls. Moving a control changes only
that page, never the work.

Code parts run from another origin than the page, so that a part cannot reach the page.
Serve `build/parts/` from a second origin, such as another host name or port, and add its
address to the page's address: `index.html?parts=https://parts.example.com/`. den-kit builds
the code parts when it exports the work; when the project tools cannot run, or the project
changes while den-kit builds them, the work file has no code parts and den-kit says so.

## Custom code parts

A code part is part of the plugin screen written in code, in the web project that the
Project workspace keeps for each work. The [code-part guide](../pod-template/AGENTS.md)
and the [API definitions](../pod-template/src/kit/index.ts) describe how to write one.

A code part runs in a frame at the work's own address. It reaches nothing else unless
you allow it: a work lists the addresses its code parts need, each with a reason (the
AI can add to the list), and **Network and devices for code parts** in the Project tab
allows them, and the microphone, camera and MIDI, for that work on this computer. What
you allow is not saved in the work, so a work you receive asks again. A code part makes
no sound until you click it. While the project tools are not running, the macOS app shows
code parts as den-kit last built them, when the work was exported or imported, if their
files have not changed since.

## Known limitations

- BrowserPod needs recent WebAssembly features.
- A work opens in one den-kit window at a time. Each work has its own project
  disk, and a window's project tools are for the work they started with: to use
  them with another work, reopen den-kit with that work open.
- The project tools reach the internet only while den-kit installs the packages
  in `package.json`; commands in the project have no network. While den-kit
  installs, everything running in the project stops, and the code parts' preview
  comes back after.
- A code part loads scripts only from its work's own address, but what it fetches
  from an address you allowed it can still run as WebAssembly or in a worker of its
  own.
- Canvas drawing code runs in a Worker with APIs such as `fetch` disabled, but
  dynamic `import()` still loads code from the network: in the macOS app only
  from BrowserPod's hosts and the addresses allowed for the work, in a browser
  from anywhere.
- The Sampler and a codebox's `audio()` use the first 65,536 samples of a file (about
  1.4 seconds), and the Sampler plays them in mono. `bytes()` reads the first 64 KB.
- Works do not export as DAW plugins.
