# Fake Codex app-server

`fake-codex.ts` stands in for the pinned `codex` CLI 0.160.1 in every test (the
real service is never used in the cloud). It answers `--version`,
`login status`, `login` and `app-server`, checks every message den-kit sends
against the protocol, and plays the scripted turns in `scenarios.ts`.

## What the real 0.160.1 server does (offline probes, network blocked)

These were observed by running the pinned binary with an empty `CODEX_HOME`
and a dead proxy, so no model was ever called. The fake copies them.

- A request before `initialize` → `{"error":{"code":-32600,"message":"Not initialized"}}`.
  Every refusal uses code -32600; an unknown method → `Invalid request: unknown variant …`.
- First start with a fresh `CODEX_HOME` took ~5 s before the first reply; later ~0.1 s.
- Notifications carry an extra top-level `emittedAtMs`.
- Not signed in: `account/read` → `{account:null, requiresOpenaiAuth:true}`;
  `account/rateLimits/read` → error "codex account authentication required to read rate limits";
  `model/list` still works (bundled catalog; default `gpt-6.1-sol`, text+image, effort `low`).
- `thread/start` with den-kit's parameters (ephemeral, `environments: []`,
  read-only, approval `never`, `config` disabling web search and the
  apps/plugins/multi-agent/shell features, dynamic tools) is accepted with
  `instructionSources: []`. A bad config value is refused ("failed to load
  configuration"); an unknown config key only produces a `warning`.
  Tool names must match `^[a-zA-Z0-9_-]+$`.
- `turn/start` replies with the turn (inProgress), then `thread/status/changed`,
  `turn/started`, `item/started`/`item/completed` for the user message. Network
  failures arrive as `error` with `willRetry: true` ("Reconnecting... 2/5").
- `turn/start` on a thread whose turn is still running returns that same turn
  (the input steers it).
- `turn/steer`: no active turn → "no active turn to steer"; wrong
  `expectedTurnId` → "expected active turn id `x` but found `y`"; else `{turnId}`.
- `turn/interrupt` on the running turn → `{}`, then `thread/status/changed` idle
  and `turn/completed` with status `interrupted`. Interrupting a turn that has
  already ended got no reply for ~9.5 s and delayed the next request.
- `thread/unsubscribe` → `{status:"unsubscribed"}`. Closing stdin ends the process (exit 0).
- `codex --version` → `codex-cli 0.160.1`; `codex login status` → "Not logged in", exit 1.
- A `CODEX_HOME` that does not exist is an error ("CODEX_HOME points to …, but that path does not exist").
- `features list`: `default_mode_request_user_input` is off, so the model cannot
  ask questions through Codex in the default mode. den-kit never asks the user
  to choose either: if a question still comes, it is answered empty at once.

Tool calls, questions and approvals need a signed-in model, so they follow the
generated protocol types and the app-server documentation; `npm run doctor
-- --deep` records a real conversation on the Mac to check them.
