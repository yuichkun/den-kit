# Pass it on (prototype)

A prototype on its own branch, not part of den-kit: someone shares an instrument
they made, the people who get it change it as much as they like and pass it on
with their own words, and the author hears what comes back.

## Try it

1. Run den-kit from source ([docs/development.md](../../docs/development.md)).
2. Open `http://127.0.0.1:5180/prototype/remix/`.
3. Share an instrument as its author, or open the example passage, and follow the
   links. Open each link in a new tab to be the next person.

## What it does

| Where                     | What a person does                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start                     | Shares an example instrument as its author: a name, a few words, and whether people may change the inside.                                              |
| A passage (`#p=` link)    | Hears every version so far, then makes it theirs: moves the controls, shakes the settings, records a phrase, or changes the inside in den-kit's editor. |
| Pass it on                | Writes their words (with buttons to thank the people before them) under a credit line the page adds, makes a link, and sends it to the author too.      |
| den-kit's editor          | Opened with `?remix`: changes anything, and goes back with the changes as den-kit's operations on the version they got.                                 |
| Authors' inbox (`#inbox`) | Hears what came back and who it came through, chooses whether people may change the inside, and takes versions off the list people see.                 |

## Real, and stand-ins

- Real: den-kit's own sound, screen and editor play and change every version. A
  person's changes travel as den-kit's operations, and each version is rebuilt from
  them and read as den-kit reads a work file (a version that does not read cleanly
  is refused).
- Stand-ins: the link holds the whole passage, so nothing goes to a server. The
  inbox and the author's choices are kept in this browser's localStorage, so a link
  opened in another browser plays and passes on but does not reach the inbox. The
  names are made up.

Tests: [test/unit/prototype/remix.test.ts](../../test/unit/prototype/remix.test.ts)
and [test/e2e/prototype-remix.test.ts](../../test/e2e/prototype-remix.test.ts).
