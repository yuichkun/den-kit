# Changelog

Each release pull request adds a dated version section here (`## X.Y.Z — YYYY-MM-DD`);
[RELEASE.md](RELEASE.md#prepare-a-release) says where its entries come from.

## 0.1.2 — 2026-10-17

- No changes to the app itself. This version comes from an updated release
  process that retries notarization when the connection to Apple drops.

## 0.1.1 — 2026-10-17

- The AI panel header shows "AI" once instead of twice.

## 0.1.0 — 2026-10-17

The first preview of the den-kit macOS app.

- Signed and notarized packages for Apple silicon and Intel Macs running macOS 13
  or later, published on GitHub Releases.
- In-app updates: den-kit downloads a new version in the background and installs
  it the next time you quit, or right away when you choose **Restart now** in
  Settings. Your work is saved first, and den-kit never restarts on its own.
- den-kit offers to move itself into the Applications folder, where updates can
  be installed.
- The interface is in English, including the menus and dialogs that macOS
  provides.
