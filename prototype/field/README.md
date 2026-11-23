# Meeting a work outside den-kit (prototype)

A prototype for one question: where can a person who has never heard of den-kit meet a
work, want to touch it, and make their first sound with it? It puts the places such a
person already spends time in side by side, each showing the same work only the way
that place can:

- **A chat that plays the clip.** A link whose page names an mp4 clip (`og:video`)
  plays the clip inside the conversation in some chat apps.
- **A timeline that shows the picture.** Most timelines and work chats show only the
  page's picture (`og:image`) and name.
- **An article with the work in it.** A page that can embed another page shows the
  work's picture and one button; pressing it plays the work there.
- **A card at a venue.** A printed card with the work's picture and a QR code.
- **Today's link.** The page as den-kit exports it now, for comparison.

The frames of these places are mock-ups. Behind every link is the real player
([src/player/Player.vue](../../src/player/Player.vue)) with a work den-kit exported, and
the pictures and clips are recorded from that player.

## What is real and what is not

| Part                                                                | Real or mock-up                                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| The page each link opens                                            | Real: den-kit's player, in a playable build made by den-kit's export                             |
| What that page does first (name, first sound, voice, big keys, ...) | Real code in the player, on this branch                                                          |
| The picture (`card.png`) and the clip (`clip.mp4`)                  | Real recordings of the player playing each work's moment ([moments.json](moments.json))          |
| The tags a link preview reads                                       | Added by [serve.mjs](serve.mjs) when it serves the page; den-kit's export does not write them    |
| The chat, timeline, article and venue frames                        | Mock-ups; they show the work from the tags the real page carries, the way each kind of place can |

## Running it

From the repository root, with den-kit's dependencies installed and ffmpeg on the
`PATH`:

```sh
vp run build                                  # den-kit and its player (dist/player/)
vp run dev                                    # in another terminal: den-kit at 127.0.0.1:5180
node prototype/field/export-works.mjs         # the four works, as den-kit exports them
node prototype/field/make-media.mjs           # each work's picture and clip
node prototype/field/serve.mjs 7100           # the places: http://127.0.0.1:7100/
```

`export-works.mjs` and `make-media.mjs` drive Chromium through Playwright; set
`CHROMIUM_PATH` when Playwright's own browser is not installed. Everything they make
goes to `prototype/field/out/` (not committed).

On a computer, the page shows what each link opens in a phone-sized frame. To try it on
a phone, the page has to come over https: the player's sound (AudioWorklet) and the
microphone work only in a secure context. A tunnel to `serve.mjs` does it; the server
names itself in the tags by the address the request reached it at (`Host`, or
`X-Forwarded-Host` and `X-Forwarded-Proto`), so a chat that previews the tunnel's
address finds the picture and the clip.

## The player's pages

| Address              | What it is                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| `/w/<id>/`           | The work's page, as a link from a chat or timeline opens it                     |
| `/w/<id>/?embed`     | The same page for embedding: the picture and one button, which plays the moment |
| `/w/<id>/?touch`     | The page as a touch screen gets it, to look at on a computer                    |
| `/plain/<id>/?plain` | The page as den-kit exports it now: no tags, no moment, nothing the player adds |
