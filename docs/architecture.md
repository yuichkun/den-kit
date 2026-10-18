# Architecture

The editor uses Vue and TypeScript, den DSP blocks, and unworklet audio processing.

## Source directories

| Path | What it holds |
| --- | --- |
| `src/core/` | The work document (patch and plugin screen), typed edit operations, undo history, validation, code generation, persistence |
| `src/editor/` | The editor UI in Vue: patch view, plugin editor, inspectors, AI panel |
| `src/plugin/` | Plugin screen rendering, screen checks, code-part hosting |
| `src/widgets/` | Plugin controls as Web Components |
| `src/ai/` | AI requests and the `kit_*` tools the AI works with |
| `src/pod/` | The BrowserPod workspace |
| `src/desktop/` | The page's side of the desktop app: the API the Electron shell gives the page, sign-in and update status text, and shell requests with a timeout |
| `src/engine/`, `src/compile/` | Audio engine and compilation |
| `src/blocks/`, `src/showcase/` | den block descriptors and the example works |
| `bridge/` | Local bridge to the Codex app-server |
| `desktop/` | Electron shell |
| `build/` | Icons and entitlements for packaging the macOS app |
| `public/` | Static files served with the editor, including the showcase assets |
| `pod-template/` | Web project template for code parts, with its own `AGENTS.md` for the in-app AI |
| `test/` | Unit, integration and e2e tests, with stand-ins for Codex and the pod |
| `scripts/` | Development, desktop packaging and release scripts |

Most source modules start with a comment that explains their role and their rules.
