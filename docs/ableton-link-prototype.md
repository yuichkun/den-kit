# Standalone Ableton Link prototype

This branch provides a local macOS trial for making sounds against a loop in
Cubase 16 or Ableton Live. Use shared tempo for delays, synchronized phase for
modulation, and beat pulses for rhythmic patches. Start/Stop Sync is optional so
you can stop a patch to edit it while the DAW keeps playing.

## Build and open

Use the Node.js and Vite+ versions in [Development](development.md#run-from-source),
Xcode Command Line Tools (`xcode-select --install`), and **CMake 3.24 or later**
(`brew install cmake` if using Homebrew). From your den-kit checkout:

```sh
git fetch origin
git switch --track origin/prototype/standalone-ableton-link
vp install --frozen-lockfile
vp run desktop:link:package
vp run desktop:link:run
```

If the branch already exists locally, switch to it and use `git pull --ff-only`
instead of creating it again. The first build downloads checksum-pinned Ableton
Link and Asio sources from GitHub and compiles the helper for your Mac. No
separate helper install, service, or recursive submodule checkout is needed.

The unsigned app is `release-link/mac-arm64/den-kit-link-prototype.app` on Apple
silicon, or `release-link/mac/den-kit-link-prototype.app` on Intel. It uses
`~/Library/Application Support/den-kit-link-prototype/` and local port `5257`.
It neither moves itself into Applications nor checks for updates. Normal builds
and releases use their own staging tree and do not bundle Link.

The Link trial needs no ChatGPT sign-in or BrowserPod key. Patching, playing,
saving, and Link work without them. AI and project tools retain their normal
requirements; an existing `.env` BrowserPod key is included if supplied. To bring
an existing work into the trial, export a `.denkit` file from the regular app and
import it into the prototype.

## Connect and listen

1. Open the prototype, choose a work, and click the start overlay to enable audio.
2. Enable Link in the DAW. In Live, enable Link under **Link, Tempo & MIDI** and
   turn on its Link button. Cubase 16 supports Link; use its Link controls.
3. Click **Link** in den-kit. Allow macOS **Local Network** access when prompted.
   A peer count confirms discovery. Joining adopts the session tempo without
   starting playback or replacing the DAW's tempo with a work's saved value.
4. Start a DAW loop or metronome. Enable **Click** in den-kit and press **Play**.
   Playback leaves at least 150 ms to prepare audio. With peers connected, it
   starts at the next four-beat boundary after that; **Next bar…** indicates the
   queued start. **Cancel start** cancels it.
5. Edit BPM in either app to check shared tempo. Turn Click off when making music.

Link and **Start/Stop Sync** start off each time the app opens. Leave Start/Stop
Sync off to play and stop den-kit independently. To share future play/stop actions,
enable it in den-kit and in the DAW. Enabling the option does not start an already
running peer's transport locally. Stopping this transport affects only its clock
and click; keyboard instruments and other unrelated patch signals keep playing.

**Waiting for peers** means Link is enabled but discovery has found no other app.
Enable Link at both ends, use the same local network, and check **System Settings →
Privacy & Security → Local Network** and the firewall. Guest Wi-Fi and VPNs can
prevent multicast discovery. See [Ableton's Link troubleshooting](https://help.ableton.com/hc/en-us/articles/209073069-Link-Troubleshooting).

## Use the clock in a patch

Choose **Add Transport** in the Link strip, or find **Transport** in the palette.
The connection is an ordinary patch edit and can be undone. Its outputs are:

| Output    | Use                                                                         |
| --------- | --------------------------------------------------------------------------- |
| `tempo`   | Shared BPM. Connect to a Stereo Delay's `bpm` input and turn its `sync` on. |
| `beat`    | A 0–1 ramp across one beat, for phase-based modulation.                     |
| `bar`     | A 0–1 ramp across the four-beat cycle.                                      |
| `pulse`   | One sample high at each beat, for retriggering a rhythm.                    |
| `playing` | A gate high during transport playback.                                      |

For a repeating envelope, connect `playing` to ADSR `gate` and `pulse` to
`retrigger`, set sustain to zero, and use the envelope to control a VCA. Edit the
attack and decay while the DAW loop plays. Existing free-running LFOs and saved
tempo knobs are not automatically connected: the patch shows where sync is used.

The tempo remains available while stopped; phase, pulse, and playing outputs are
zero. Without a host clock, including a standalone exported web player, Transport
outputs 120 BPM and zero for its other signals. Link state is not saved in the work.

## What to check with the DAWs

Run these first with Live alone, then Cubase alone, then both together. Use a
comfortable listening level and a short repeating loop.

| Action                                                       | Expected result                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Join a session at 97 BPM; open another work                  | Session stays at 97 BPM; den-kit does not start itself.                 |
| Change BPM at either end, including during playback          | All peers converge; click and patched modulation follow.                |
| Play at different points in a measure                        | Start lands on a four-beat boundary; a queued start can be canceled.    |
| Start/Stop Sync off; stop den-kit                            | DAW keeps playing; the keyboard still works.                            |
| Start/Stop Sync on at both ends; play and stop at either end | New transport actions propagate.                                        |
| Disable Link, quit a peer, then reconnect                    | No crash or unexpected remote stop; peers rediscover each other.        |
| Edit/recompile a patch; suspend/resume audio                 | Transport resumes against the current beat without a stuck gate.        |
| Record DAW and den-kit clicks through the same audio path    | Check onset alignment and drift over several minutes and tempo changes. |

Record the DAW versions, Mac, output device, buffer size, and measured onset
difference when reporting a result. The display is not an audio timing test.
The [SDK test plan](https://github.com/Ableton/link/blob/Link-4.1.1/TEST-PLAN.md)
uses less than 3 ms as its audio-alignment target; local unit/native tests do not
establish that this Web Audio prototype meets it with a particular device or DAW.

## Scope and implementation

This trial synchronizes tempo, beat phase, and optional transport actions. Its
four-beat cycle is a Link quantum, not the DAW's time signature, bar number,
loop locator, or song position. It does not route audio or MIDI between apps.
Use your usual audio routing when recording den-kit into the DAW.

The native helper owns one Link peer and exchanges validated commands with the
desktop main process over stdio. The host maps native timestamps to the page's
monotonic clock; the audio engine maps those to Web Audio output timestamps and
generates the clock per sample in an AudioWorklet. A stale clock stops rhythmic
outputs. Code parts receive no native Link or IPC access.

Local and received starts reserve a fixed 150 ms preparation interval. Received
starts near a boundary may wait for the following cycle. This lead is not adapted
to the output device: high-latency outputs such as Bluetooth may miss the first
beat. Use a wired device for alignment testing. A separate `transportTimeUs` run
identity keeps tempo edits and other peers' Play actions from restarting an active
local sequence.

The dedicated build pins [Ableton Link 4.1.1](https://github.com/Ableton/link/releases/tag/Link-4.1.1)
and its Asio dependency in [CMakeLists.txt](../desktop/link/CMakeLists.txt).
Link is offered under GPLv2 or later, or a separate proprietary license; it is
not covered by den-kit's MIT/Apache license. The helper's copied dependency
notices are in the app's `Contents/Resources/licenses/ableton-link/`. Keep this
trial separate from production distribution; any distribution of a Link-enabled
build must satisfy the applicable Link license.

`vp run test:link:native` builds the helper and checks its local behavior. For the
two-peer network test, close music apps first, then run
`KIT_LINK_NETWORK_TEST=1 vp run test:link:native`: it changes the shared session's
tempo and transport. The separate [prototype CI](../.github/workflows/link-prototype.yml)
runs that test on isolated runners and checks unsigned macOS packaging without
publishing. Cubase/Live interoperability and recorded audio alignment require the
manual checks above.
