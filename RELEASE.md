# Releasing den-kit

den-kit follows the release-PR model of [den](https://github.com/yuichkun/den/blob/main/RELEASE.md)
and [unworklet](https://github.com/yuichkun/unworklet/blob/main/RELEASE.md): you prepare and review a
release pull request, and merging it builds, signs, notarizes and publishes the macOS app to GitHub
Releases. Ordinary pull requests and merges never publish anything.

## Prepare a release

1. Start from current `main` on a branch named `release/vX.Y.Z` in this repository (not a fork).
   Use plain version numbers; prereleases and `0.0.0` are not release targets. Versions before
   `1.0.0` are previews.
2. Run `npm run release:version -- X.Y.Z`. This updates `package.json` and `package-lock.json` only.
   It does not create a tag, commit, push or publish.
3. In `CHANGELOG.md`, move the relevant entries from **Unreleased** into `## X.Y.Z — YYYY-MM-DD`.
4. Open the pull request with the title `vX.Y.Z — <headline>`. Its description becomes the public
   release notes.
5. Wait for all checks, including **desktop-package**, which builds unsigned packages for both
   architectures. Bring the branch up to date with `main` and review again if it changes. Merge only
   when the release is ready to publish.

## What the Release workflow does

The workflow runs on every push to `main`. It asks GitHub which pull request the pushed merge commit
belongs to, and continues only for a merged `release/v*` pull request from this repository. Other
pushes finish without doing anything.

It runs on the push rather than on the pull request event because, for pull request events, GitHub
checks the `release` environment's branch rule against the pull request's merge ref instead of
`main`. On the push, only workflow code that is already on `main` can use the signing secrets. den and
unworklet publish without such secrets, so they run on the pull request event.

1. **validate** finds the release pull request, then checks that the merge commit's tree equals the
   reviewed pull request head, that the commit belongs to `main`, that the versions and changelog
   match the branch, that an existing tag points to the same commit, and that no newer release exists.
2. **verify** runs the complete CI workflow, including unsigned packaging, on that exact commit with
   read-only permissions.
3. **build** runs on macOS in the `release` environment. It builds den-kit for Apple silicon and
   Intel, signs every executable with the Developer ID Application certificate and the hardened
   runtime, notarizes the apps with `notarytool` and staples their tickets, and verifies them with
   `codesign`, `stapler` and `spctl`. electron-builder runs `scripts/notarize.ts` after signing each
   app; its own notarization is turned off because it gives up on the first dropped connection while
   stapling. This is the only job that can read the signing, notarization and BrowserPod secrets, and
   it cannot write to the repository.
4. **publish** runs without any of those secrets. It rechecks the source and tags, tags the checked
   commit, creates a draft release, attaches the `.dmg`, `.zip`, `.blockmap` and `latest-mac.yml`
   files, and then publishes the release as the latest one.

The publish job reads the pull request's title and description through the GitHub API. They become the
release title and notes as data, never as shell code.

## How the app updates

- The app reads `latest-mac.yml` from the latest published release. Each Mac downloads the `.zip` for
  its own architecture.
- Prereleases and older versions are never installed.

What people see when an update arrives is in [docs/usage.md](docs/usage.md#the-macos-app).

## One-time maintainer setup

None of this is needed to open or test pull requests.

1. **Signing certificate.** In Keychain Access, export the **Developer ID Application** certificate
   with its private key as a `.p12` file protected by a password. Then run
   `base64 -i DeveloperID.p12 | pbcopy` to copy it for the secret below. Delete the exported file
   afterwards.
2. **Notarization.** In App Store Connect, under Users and Access → Integrations, create a team API
   key with the Developer role. Download the `.p8` file once and note its Key ID and the Issuer ID.
   An Apple ID with an app-specific password also works; see the optional secrets below.
3. **BrowserPod key.** Use a BrowserPod key reserved for the distributed app, not a development key;
   [docs/development.md](docs/development.md#build-the-macos-app) explains why. To replace it,
   publish a new version with the new key, then revoke the old one once people have updated.
4. **GitHub environment.** Under Settings → Environments, create `release`, allow deployments only
   from `main` (the Release workflow runs on pushes to `main`), and add these secrets:

   | Secret | Value |
   | --- | --- |
   | `CSC_LINK` | The base64 text of the `.p12` file |
   | `CSC_KEY_PASSWORD` | The `.p12` password |
   | `APPLE_API_KEY_P8` | The full contents of the `.p8` file |
   | `APPLE_API_KEY_ID` | The API key's Key ID |
   | `APPLE_API_ISSUER` | The Issuer ID |
   | `BROWSERPOD_API_KEY` | The BrowserPod key for the distributed app |

   To notarize with an Apple ID instead of an API key, set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
   and `APPLE_TEAM_ID`, and leave the three `APPLE_API_*` secrets empty.
5. **Repository settings.** Enable immutable releases, and allow only collaborators to create pull
   requests (Settings → General → Features). Protect `main` with pull requests and the `verify` and
   `desktop-package` checks, and make sure tag rules allow the workflow to create `v*` tags. A
   maintainer reviews every release pull request before merging it. The ruleset requires no
   approvals, because GitHub does not let authors approve their own pull requests. Who merges is
   set in [AGENTS.md](AGENTS.md#pull-requests), not by the ruleset.
   Do not require branches to be up to date before merging. The CI on `main` catches changes
   that break each other, and the Release workflow refuses to publish unless the merge matches the
   reviewed release pull request, so only release pull requests need updating first (step 5 of
   "Prepare a release"). No personal access token is needed.

## Building and checking locally

- `npm run desktop:dist` builds the `.dmg` and `.zip` packages for both architectures. It signs them
  when a Developer ID Application identity is in your keychain and never publishes. It notarizes and
  staples the signed apps when `APPLE_API_KEY` (the path of the `.p8` file), `APPLE_API_KEY_ID` and
  `APPLE_API_ISSUER` are set, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, or
  `APPLE_KEYCHAIN_PROFILE` with a profile saved by `xcrun notarytool store-credentials`. Without
  them, or for apps that are not signed with a Developer ID, it skips notarization.
- `npm run desktop:check-artifacts -- release [--signed | --notarized]` checks the output: both
  architectures, the update feed, the bundled Codex CLI, and optionally the signature and
  notarization.
- `npm run desktop:check-update` proves the update path end to end. After `npm run desktop:build`, it
  builds the current version and the next two patch versions for this Mac, installs the oldest into a
  temporary folder and serves the others from `127.0.0.1`. It checks that den-kit installs the first
  update when it quits normally without reopening, installs the second through **Restart now**, and
  keeps the work. It needs a Developer ID Application identity in your keychain, because macOS
  installs only signed updates. It never touches published releases or your own den-kit data. Quit
  den-kit first: the check uses the same updater caches in `~/Library/Caches` as an installed den-kit,
  and removes the ones it created.

## Failure and retry

Merge release pull requests one at a time. Runs are serialized without canceling an active release.

Fix the cause of a failure and rerun the failed Release workflow. It keeps a tag only if it points at
the same commit, completes an unfinished draft by replacing all of its files, and leaves a complete
published release unchanged. A published release cannot be changed, so a release that was published
with a problem needs a new version.

Stapling a ticket and `stapler validate` both fetch the ticket from Apple's ticket service. When the
connection drops (stapler exits with code 68 or reports an `NSURLErrorDomain` error), the **build**
job tries again after 15, 30 and 60 seconds. Each failed attempt prints everything stapler reported.
If the last attempt fails too, rerun the failed jobs once Apple is reachable.

If **validate** reports that no pull request is linked to the merge commit yet, rerun it. GitHub links
a merge commit to its pull request shortly after the push.

If the reviewed tree differs from the merge, nothing is published: prepare a fresh release pull
request from current `main` and review it again.
