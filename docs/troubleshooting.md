# Troubleshooting

What to try when den-kit makes no sound, does not connect to ChatGPT, cannot start its project
tools, or cannot save or update. This page is for the macOS app; running den-kit from source
is covered in [development.md](development.md).

## No sound

den-kit starts its sound on the first click or key press. What it shows, and what to do:

- **Click anywhere to start** over the window: click anywhere, or press a key.
- **Sound paused**: click anywhere to resume.
- **No sound**, with the reason under it: click anywhere to try again.
- **Nothing to play** in the toolbar: connect a module to **Out**.
- **Error** in the toolbar: the patch does not compile, so den-kit keeps playing the last
  version that did. The reason shows at the top of the view, or on the module marked **!**
  when you hold the pointer over the mark. Fix the patch, or undo (`⌘Z`).
- **Sound is muted** at the top of the view: the patch kept making runaway or invalid audio,
  often from a feedback loop. Change the patch or undo, and the sound comes back. `⌘.` also
  turns it back on, and den-kit mutes it again if the patch still runs away.

An instrument sounds while you play it ([Basic workflow](usage.md#basic-workflow) says how).
An effect plays only what it hears. Choose that in **Input**, on the Plugin view or in the
inspector of the **Audio In** module: **Silence** plays nothing, and **Audio input (mic /
line)** uses your Mac's audio input. If den-kit says the audio input could not be opened,
check that den-kit is turned on under **System Settings** → **Privacy & Security** →
**Microphone**
([Apple's guide](https://support.apple.com/guide/mac-help/control-access-to-the-microphone-on-mac-mchla1b1e1fe/mac)),
or choose a test input.

den-kit plays through the output your Mac uses for sound, at your Mac's volume. It has no
output or volume setting of its own.

## ChatGPT does not connect

[The macOS app](usage.md#the-macos-app) says how ChatGPT sign-in works. The status at the top
of the AI panel (`⌘J`) shows the connection:

- **ChatGPT: sign in**: click it, or open **Settings** (`⌘,`), and choose **Sign in with
  ChatGPT**. Sign in on the page that opens in your browser; Settings then says **Signed in**.
  If sign-in does not finish, Settings says why: choose **Sign in with ChatGPT** again.
- **AI starting…**: wait a moment, then send the request again.
- **AI offline**, **AI disconnected** or **AI unavailable**: click the status to reconnect.
  For the last two, **Reconnect AI** in Settings does the same. If den-kit still does not
  connect, quit and reopen it.

When a request fails, the AI panel says why under the request, and what to do.

Requests count toward your ChatGPT plan's usage limits. Once half of the current usage window
is used, the status shows how much, such as **AI 72%**; hold the pointer over it to see when
the window resets. When the limit is reached, requests fail until it resets. **Manage usage**
in Settings opens your usage on ChatGPT, and you can keep playing and editing by hand
meanwhile.

## The project tools do not start

Code parts and the terminal in the **Project** tab run on the project tools, which use
BrowserPod. They start by themselves when a code part or the AI needs them, and the top of the
**Project** tab shows how they are doing:

- **Not started**: **Start project tools** starts them.
- **Preparing** or **Starting**: wait. The first start takes a few minutes, because den-kit
  installs the project's packages, and it needs an internet connection.
- **Needs attention** or **Unavailable**: do what the tab says next to the message.
  **Retry project tools** tries again; it does not change your work.

The rest of den-kit works without the project tools, and
[Custom code parts](usage.md#custom-code-parts) says how code parts show then. When the tab
says the project tools belong to the work that started them, see
[Known limitations](usage.md#known-limitations).

## den-kit cannot save

den-kit saves each change by itself ([Saving and backups](usage.md#saving-and-backups)). When
it cannot, it says **den-kit could not save your changes; export the work to keep it.** Export
the work right away with **Patch** → **Export**, and choose where to save the work file.
den-kit tries to save again with each change you make, and says so again each time it cannot.

## den-kit does not update

[The macOS app](usage.md#the-macos-app) says how updates download and install. **Settings** →
**Updates** shows how they are going:

- When it says to move den-kit to your Applications folder, den-kit runs from somewhere else,
  such as its disk image or the Downloads folder. Quit den-kit, open it again, and choose
  **Move to Applications** when it asks. If it cannot move itself, quit it, drag it into the
  Applications folder in Finder, and open it from there.
- When it says den-kit could not check for updates, or the update could not be downloaded,
  den-kit tries again later by itself. **Check for updates** tries now.
