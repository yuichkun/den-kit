# den-kit prototype migration (GEN-654)

2026-10-10. This migration makes the patching and editor experience available for Toshi to try and evaluate before the work on the production version begins.

## Preserved content

- Source: `kit/` in `yuichkun/den`, branch `claude/awesome-darwin-csz4kc`, commit `d9db3a4ffe3b89279512f4750e2f8cec3b41250c`.
- `git subtree split --prefix=kit` extracted 47 commits into the den-kit root. Authors, author dates, messages, and changes were preserved. Commit IDs changed because paths and parent history changed. The [complete commit mapping](migration-history.json) records the original and migrated IDs.
- The tree immediately after migration exactly matched the source `kit/` tree. Changes to make the repository independent were committed separately.
- `.env`, `.codex-home`, and `.logs` were excluded from both the working copy and history. All 878 unique blobs in the migrated history were scanned for common authentication key and private key patterns, with no matches. Deleted commits from the former U2 work were not restored.
- MIT OR Apache-2.0. The repository includes the same license texts as den. Showcase asset attribution is in `public/showcase/SOURCES.md`.

## Changes for repository independence

- Added pinned dependencies on `@denaudio/den@0.1.0`, `@unworklet/core@0.4.1`, and `@unworklet/offline@0.4.1`. Playwright is also pinned in this repository instead of being borrowed from den.
- Removed aliases to the den source from Vite and TypeScript. The block catalog and test registry use the installed den package's public exports. Worklet and codebox types also come from this repository's dependencies.
- The doctor checks the installed npm version of den and verifies that den and den-kit resolve the same unworklet package.
- Updated startup, diagnostics, sign-in, and Jev evaluation instructions to use this repository's commands and paths. Updated related test expectations for those instructions. The work document format was preserved.
- Preoptimized all npm den exports in Vite to prevent a page reload after the initial load. BrowserPod commands run from `/` before reading its HOME. Test child process failures propagate correctly. Tests account for selection key and sed differences between macOS and Linux.
- Applied a minimal fix to an existing bug found during reproduction: consecutive arrow-key node movements are grouped into one Undo operation even within 1.5 seconds of startup.
- Key states pressed during loading are resent after the node starts, so the first key that starts audio is not lost.
- Added `.gitignore`, a Node 24 requirement, licenses, the commit mapping, reproduction instructions, and CI.

## Getting started

The [README](../README.md) describes building and running the Electron app and developing in a browser. A clone of den is not required. Sign in to ChatGPT through the Electron app's settings. The operator's BrowserPod key is bundled at build time; users do not need to configure a BrowserPod key.

## Migration verification record (2026-10-10, GEN-654)

- `npm run build` and `npm test` passed on macOS with Node 24.21.0. All 1,030 tests passed: 669 unit tests, 272 integration tests, and 89 browser tests.
- Integration tests include sample-by-sample agreement with the npm den package for five examples: bass, percussion, pad, chorus, and rhythmic delay.
- A fresh GitHub clone at `/private/tmp/den-kit-reproduction` passed a normal `npm ci`, build, and doctor check. Browser checks confirmed 48 kHz playback, patch export and reload, and switching between Patch and Plugin without an adjacent den checkout. No browser exceptions occurred.
- Another agent performed a read-only review of tree equality, authors and dates, secret exclusion, independent dependencies, and the diff, with no findings that blocked migration.
- The [complete independence diff and CI](https://github.com/yuichkun/den-kit/pull/1) are available in PR #1. CI also performs a fresh install, build, and complete test run on Ubuntu.

These automated tests mocked Jev, models, and BrowserPod. Protocol checks against the actual Codex binary ran offline and without authentication. Those checks do not replace authenticated external-service verification or approval of the audio. Audio remains CANDIDATE; the den four-voice runtime's NOT_CLEARED status was not lifted.

## Follow-up work

[GEN-657](https://linear.app/escentier/issue/GEN-657) covers a substantial rebuild for the production version. Yuichi Yogo owns the foundation, overall experience design, and engineering. Toshi then addresses usability problems from a creator's perspective. Detailed ownership boundaries have not been fixed.

The source branch is to be deleted after its contents are preserved on this repository's main branch and reproduction is verified. Evidence of completed deletion is recorded in [GEN-654](https://linear.app/escentier/issue/GEN-654). Untracked files and personal settings in the local source checkout are not deleted.
