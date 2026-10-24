# Development

## Run from source

Use **Node.js 24.11 or a later 24 release**, the [Vite+](https://viteplus.dev/guide/)
command `vp`, a **ChatGPT account** for AI requests, and a **BrowserPod API key** for
the required workspace. Dependencies are installed from npm; you do not need a
separate checkout or build of den.

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

### Project workspace

Code parts and the Project workspace use
[BrowserPod](https://browserpod.io/), which runs a Linux environment in the
browser. Source development uses the key configured above.

The Project tab shows startup progress and provides a terminal, source editor,
and checks. First startup includes package installation and requires network
access. BrowserPod also supplies the AI's project environment.

Code parts load from each work's own address on the AI bridge's port
(`http://<work id>.localhost:5181`), which passes their requests through to the
project's dev server and sets the same response rules as the desktop app. A
browser cannot apply the desktop app's window rules (the proxy that refuses
connections, WebRTC without UDP, no DNS prefetching) or add its secret header, so
the development server's sandbox answers any local request. The page keeps the
contents of the work's files, so this sandbox serves only the dev server's pages:
code parts show only while the project runs.

Keep `.env` and credentials out of version control. The development server
passes the BrowserPod key to the local page; a regular `vp run build` excludes
it from the web renderer.

## Build the macOS app

On macOS, install dependencies and set `BROWSERPOD_API_KEY` in `.env` or the
build environment, then run:

```sh
vp run desktop:package
vp run desktop:run
```

The bundle is written to `release/mac-arm64/den-kit.app` on Apple silicon or
`release/mac/den-kit.app` on Intel Macs. You can also open it from Finder.
`vp run desktop:run` waits until you quit the app.
The app includes the renderer and native Codex CLI, so running the bundle does
not require Node.js or a development server.

The build bundles the BrowserPod key, and it can be extracted from the app. Builders
must supply a key they are authorized to distribute.

The local packaging command creates an **unsigned, unnotarized** app for your
Mac's architecture. The packaging scripts build macOS apps only. Signed releases follow
[RELEASE.md](../RELEASE.md).

### Reset the app's data

To test a fresh installation, quit den-kit and run `vp run desktop:clean`.
This permanently deletes `~/Library/Application Support/den-kit/`, including
ChatGPT sign-in, the autosaved work, conversations, imported assets, project
disks and installed dependencies, settings, and caches. Export any work you want
to keep first. The command refuses to delete data while den-kit is running.
Use `vp run desktop:clean --dry-run` to print the target without deleting it.
The app bundle, exported files, and repository `.env` are preserved.

## Checks and tests

```sh
vp check
vp run typecheck
vp run build
vp exec playwright install chromium
vp run test
```

`vp check` checks formatting and lint; `vp check --fix` fixes what it can.
`vp run typecheck` checks types with vue-tsc, and `vp run build` runs it first.
`vp run build` also builds the player, the page of a playable build, into
`dist/player/`: exported work files carry it, also from `vp run dev`, and the e2e
tests need it.
Run suites separately with `vp run test:unit`, `vp run test:integration`, and
`vp run test:e2e`. `vp run test:desktop` checks the works' sandbox in Electron
(what a code part can reach, its frame, WebRTC, DNS prefetching and devices); CI
runs it on macOS. Browser tests need Chromium; `CHROMIUM_PATH` can select an
existing installation. Automated regression tests use model and pod substitutes
rather than paid AI or BrowserPod services. Pod tests execute local commands
and may download npm dependencies.

After building the macOS bundle, `vp run desktop:check` verifies it with an
isolated profile. `vp run desktop:check --real` additionally uses local
ChatGPT authentication and real BrowserPod resources, consuming service usage.
