# den-kit

den-kit is an app for making instruments and effects. You build the sound by patching
[den](https://www.npmjs.com/package/@denaudio/den) DSP blocks, build the screen that
plays it, and play it with your keyboard or a MIDI controller. You make it together with
an AI that works on the same patch and the same screen, and anything it changes can be
undone.

den-kit gives you good starting points: den blocks that sound good as they are, and
ready-made UI components that are easy to use and look right together. When those are
not enough, write your own DSP in codebox, or your own screen in code, with libraries
such as three.js, in a BrowserPod workspace.

den-kit runs on its own as a desktop app. It is also meant to work inside Suara Portal,
the DAW plugin of [Suara](https://suara.audio) where people find and play instruments
and effects, so that you can make an instrument while you hear it in your DAW and share
it there.

## Get den-kit

Signed builds for macOS (Apple silicon and Intel) are on
[GitHub Releases](https://github.com/yuichkun/den-kit/releases).

## Documentation

- [Using den-kit](docs/usage.md): the macOS app, the basic workflow, shortcuts, saving,
  code parts and known limitations
- [Development](docs/development.md): running from source, building the macOS app,
  checks and tests
- [Architecture](docs/architecture.md): how den-kit is structured

Bug reports and suggestions are welcome as GitHub issues. Include reproduction steps and
the relevant browser or app version, and do not include credentials or private logs.
This repository does not accept pull requests from outside the maintainers.

## License

Copyright © 2026 Escentier, LLC. den-kit is available under either the
[MIT License](LICENSE-MIT) or [Apache License 2.0](LICENSE-APACHE), at your
option. Third-party packages and services have their own terms. Attribution
for bundled showcase assets is in [SOURCES.md](public/showcase/SOURCES.md).
