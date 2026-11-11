# Development

## Run from source

Use **Node.js 24.11 or a later 24 release**, the [Vite+](https://viteplus.dev/guide/)
command `vp`, a **ChatGPT account** for AI requests, and a **BrowserPod API key** for
the required workspace. Dependencies are installed from npm; you do not need a
separate checkout or build of den. Use `vp` instead of npm, pnpm, yarn and npx in this
repository: `vp install`, `vp run <script>`, `vp exec <tool>`. CI installs with `npm ci`
only to get `vp` itself.

```sh
git clone https://github.com/yuichkun/den-kit.git
cd den-kit
vp install --frozen-lockfile
```

For source development, create a key in the
[BrowserPod console](https://console.browserpod.io/) and put it in `.env`:

```dotenv
BROWSERPOD_API_KEY=your_browserpod_key
```

The repository includes the Codex CLI used by den-kit. Sign in with your ChatGPT
account, check the environment, and start the editor:

```sh
vp run codex:login
vp run doctor
vp run dev
```

Open [http://127.0.0.1:5180/](http://127.0.0.1:5180/). Complete both ChatGPT
authentication and BrowserPod configuration for the normal den-kit workflow.
[Using den-kit](usage.md) covers the supported browser and the basic workflow.

The development host keeps works in the browser's storage, and starts the project tools,
which use BrowserPod, the first time it opens in a browser. To try a change without the AI and the project
tools, run `KIT_CODEX=off BROWSERPOD_API_KEY= vp run dev` and open it in a browser profile
of its own. AI agents try changes this way unless the change needs the AI or the project
tools.

### AI configuration

Authentication is stored in `.codex-home`, separate from your normal Codex
configuration and excluded from Git. Direct patch and interface editing is
available alongside the required AI workflow.

Development settings in a local `.env` file:

| Variable           | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `KIT_CODEX_MODEL`  | Override the default Codex model.                       |
| `KIT_CODEX_EFFORT` | Set a reasoning effort supported by the selected model. |
| `KIT_PORT`         | Editor port; defaults to `5180`.                        |
| `KIT_BRIDGE_PORT`  | Local AI bridge port; defaults to `5181`.               |
| `KIT_CODEX`        | `off` runs without the AI.                              |
| `KIT_CODEX_HOME`   | Use another Codex home, such as `~/.codex`.             |
| `KIT_CODEX_BIN`    | Run another Codex binary than the pinned one.           |

### Project workspace

Code parts and the Project workspace use
[BrowserPod](https://browserpod.io/), which runs a Linux environment in the
browser. Source development uses the key configured above.

The Project tab shows startup progress and provides a terminal, source editor,
and checks. First startup includes package installation and requires network
access. BrowserPod also supplies the AI's project environment.

Code parts load from each work's own address on the AI bridge's port
(`http://<work id>.localhost:5181`), and show only while the project runs; the
header of `dev/sandbox.ts` says why.

Keep `.env` and credentials out of version control. The development server
passes the BrowserPod key to the local page; a regular `vp run build` excludes
it from the web renderer.

## Build the macOS app

On macOS, install dependencies and set `BROWSERPOD_API_KEY` in `.env` or the
build environment, then run:

```sh
vp run desktop:package
```

The bundle is written to `release/mac-arm64/den-kit.app` on Apple silicon or
`release/mac/den-kit.app` on Intel Macs. The app includes the renderer and native
Codex CLI, so running the bundle does not require Node.js or a development server.

`vp run desktop:run` opens it with your own den-kit data, in
`~/Library/Application Support/den-kit/`, and waits until you quit the app. To try a
build as a fresh installation instead, give the app a data folder and a free port of
its own, as `vp run desktop:check` does:

```sh
KIT_DESKTOP_USER_DATA="$(mktemp -d)" KIT_DESKTOP_CHECK_PORT=5299 release/mac-arm64/den-kit.app/Contents/MacOS/den-kit
```

The app then keeps everything in that folder, and neither offers to move itself into
Applications nor looks for updates. AI agents try the app only this way: they never
open, change or delete a person's own den-kit data, and never replace an installed
den-kit.

The build bundles the BrowserPod key, and it can be extracted from the app. Builders
must supply a key they are authorized to distribute.

The local packaging command creates an **unsigned, unnotarized** app for your
Mac's architecture. The packaging scripts build macOS apps only. Signed releases follow
[RELEASE.md](../RELEASE.md).
`vp run desktop:icons` renders the app icon from the logo again.

### Reset the app's data

To start your own den-kit over, quit it and run `vp run desktop:clean`.
This permanently deletes `~/Library/Application Support/den-kit/`, including
ChatGPT sign-in, the autosaved work, conversations, imported assets, project
disks and installed dependencies, settings, and caches. Export any work you want
to keep first. The command refuses to delete data while den-kit is running.
Use `vp run desktop:clean --dry-run` to print the target without deleting it.
The app bundle, exported files, and repository `.env` are preserved.

## Storybook

[Storybook](https://storybook.js.org/docs) shows the plugin's ready-made controls
(`src/screen/widgets`) on their own, in each skin and each base theme, and tries
den-kit's control behaviors on them. It also shows the main parts of den-kit's own
screens (`src/editor`) in each of den-kit's themes:

```sh
vp run storybook
```

Open [http://localhost:6006/](http://localhost:6006/) and pick the base theme (Theme)
or den-kit's theme (den-kit theme) in the toolbar. Storybook's own test runner (**Run
tests** in the sidebar, and the agent tools' `test run`) tries the stories in graphite
and Tile Light. `vp run test:stories` runs every story in Chromium, a control's once in
each base theme and those of den-kit's screens once in each of den-kit's themes: its
`play` function and an accessibility check, which fails the test unless the story
file sets `a11y: { test: 'todo' }`. `vp run storybook:build` builds a static Storybook
into `dist/storybook/`.

Every push publishes the built Storybook to [Chromatic](https://www.chromatic.com/docs/)
([.github/workflows/chromatic.yml](../.github/workflows/chromatic.yml)), with a snapshot
of each control's story in each base theme and of each story of den-kit's screens in
each of den-kit's themes. On a pull request, Chromatic's UI Review shows each changed
story beside the base branch's, to comment on and approve, and reports to the pull
request as the UI Review and UI Tests checks. The workflow needs the
`CHROMATIC_PROJECT_TOKEN` secret.

A control's stories are in `<control>.stories.ts` beside it. A part of den-kit's screens
has its stories in `<Component>.stories.ts` beside it, tagged `editor`, and
[story-frame.ts](../src/editor/story-frame.ts) gives them a work that makes no sound. A
story file imports what it shows (the control's class, the component) with a plain
`import`, not `import type`: Storybook finds the stories of a changed file through the
imports of story files.

Storybook's tools for AI agents run from the command line. Its help writes
`npx storybook`; use `vp exec storybook`:

```sh
vp exec storybook skills stories
vp exec storybook tools --help
```

`stories preview` and `review create` need a running Storybook; the other tools run
without one. `review create` gathers the stories a change affects on a review page
of the running Storybook. While Storybook runs, it also serves the story tools as an
MCP server at `http://localhost:6006/mcp`.

## Checks and tests

```sh
vp check
vp run typecheck
vp run build
vp exec playwright install chromium
vp run test
vp run test:stories
```

`vp check` checks formatting and lint; `vp check --fix` fixes what it can.
`vp run typecheck` checks types with vue-tsc, and `vp run build` runs it first.
`vp run build` also builds the player, the page of a playable build, into
`dist/player/`: exported work files carry it, also from `vp run dev`, and the e2e
tests need it.
Run suites separately with `vp run test:unit`, `vp run test:integration`, and
`vp run test:e2e`. Unit tests (`test/unit`, a folder per module) cover a module's own
logic, integration tests run modules together in Node (compiling blocks, the AI bridge,
the pod, the desktop app's server), and e2e tests drive the editor in Chromium. Run one
file with `vp test run <file>`, or `node --test <file>` for an e2e file. `vp run test:stories` runs the controls' stories
([Storybook](#storybook)). `vp run test:desktop` checks the works' sandbox in Electron
(what a code part can reach, its frame, WebRTC, DNS prefetching and devices); CI
runs it on macOS. Browser tests need Chromium; `CHROMIUM_PATH` can select an
existing installation. Automated regression tests use model and pod substitutes
rather than paid AI or BrowserPod services. Pod tests execute local commands
and may download npm dependencies.

After building the macOS bundle, `vp run desktop:check` verifies it with an
isolated profile. `vp run desktop:check --real` additionally uses local
ChatGPT authentication and real BrowserPod resources, consuming service usage.
