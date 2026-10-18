# Development

## Run from source

Use **Node.js 24**, a current version of **Chrome**, a **ChatGPT account** for AI
requests, and a **BrowserPod API key** for the required workspace. Dependencies
are installed from npm; you do not need a separate checkout or build of den.

```sh
git clone https://github.com/yuichkun/den-kit.git
cd den-kit
npm ci
```

For source development, create a key in the
[BrowserPod console](https://console.browserpod.io/) and put it in `.env`:

```dotenv
BROWSERPOD_API_KEY=your_browserpod_key
```

The repository includes the Codex CLI used by den-kit. Sign in with your ChatGPT
account, check the environment, and start the editor:

```sh
npm run codex:login
npm run doctor
npm run dev
```

Open [http://127.0.0.1:5180/](http://127.0.0.1:5180/). Complete both ChatGPT
authentication and BrowserPod configuration for the normal den-kit workflow.
[Using den-kit](usage.md) covers audio setup and the basic workflow.

### AI configuration

Authentication is stored in `.codex-home`, separate from your normal Codex
configuration and excluded from Git. AI requests use the signed-in account's
ChatGPT allowance. Direct patch and interface editing is available alongside
the required AI workflow.

Development settings in a local `.env` file:

| Variable | Purpose |
| --- | --- |
| `KIT_CODEX_MODEL` | Override the default Codex model. |
| `KIT_CODEX_EFFORT` | Set a reasoning effort supported by the selected model. |
| `KIT_PORT` | Editor port; defaults to `5180`. |
| `KIT_BRIDGE_PORT` | Local AI bridge port; defaults to `5181`. |

### Project workspace

Code parts and the Project workspace use
[BrowserPod](https://browserpod.io/), which runs a Linux environment in the
browser. Source development uses the key configured above.

Restart `npm run dev`. The Project tab shows startup progress and provides a
terminal, source editor, and checks. First startup includes package installation
and requires network access. BrowserPod supplies the AI's project environment
and remains part of the required setup.

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
When using `desktop:run`, keep the terminal open until you quit the app. The
command waits for the app so temporary proxies supplied by npm wrappers remain
available for its network connections.
The app includes the renderer and native Codex CLI, so running the bundle does
not require Node.js or a development server.

The build bundles the BrowserPod key, and it can be extracted from the app. Builders
must supply a key they are authorized to distribute.

The local packaging command creates an **unsigned, unnotarized** app for your
Mac's architecture. The packaging scripts build macOS apps only. Signed and notarized
releases for Apple silicon and Intel are published to
[GitHub Releases](https://github.com/yuichkun/den-kit/releases) from reviewed
release pull requests; see [RELEASE.md](../RELEASE.md).

### Reset the app's data

To test a fresh installation, quit den-kit and run `npm run desktop:clean`.
This permanently deletes `~/Library/Application Support/den-kit/`, including
ChatGPT sign-in, the autosaved work, conversations, imported assets, project
disks and installed dependencies, settings, and caches. Export any work you want
to keep first. The command refuses to delete data while den-kit is running.
Use `npm run desktop:clean -- --dry-run` to print the target without deleting it.
The app bundle, exported files, and repository `.env` are preserved.

## Checks and tests

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
