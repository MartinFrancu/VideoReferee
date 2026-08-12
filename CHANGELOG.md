# Changelog

One entry per chunk of work, marked with what kind it was:

- **R** — refactor: different structure, same behaviour
- **B** — bugfix: it now does what it was always supposed to
- **D** — development: it does more, less, or different

See `.claude/skills/chunks/SKILL.md` for the working agreement this follows.

## 0.0.16

- **B** — A loaded session no longer shows every camera as one whose QR was never
  scanned. Whether a camera had joined was saved to the file and then dropped on
  the way back in; it now survives, so a phone that died still reads "not
  responding" in a session opened on another laptop.

## 0.0.15

- **D** — Deciding a bookmark is a *Mark state…* button at the end of the control
  bar, opening a dialog of radios with OK. It opens on the decision that already
  stands, so changing red to blue shows red first, and Cancel or Escape leaves it
  as it was. Never disabled: a phone can die mid-bout and the referee still saw
  what happened.

## 0.0.14

- **D** — The operator screen is two tabs. *Cameras* holds the phones and the
  form that adds one; *Bookmarks* holds the list down the left — BOOKMARK at its
  top, *Mark N done* at its foot — with every angle of the chosen one filling
  the rest and the playback controls along the bottom edge. The angles now share
  the stage instead of sitting at their natural size, so two cameras fill it and
  six still fit. Saving and loading moved behind a *Session* button that says so.

## 0.0.13

- **D** — *Start bout* and *Stop* are gone, and the phase label beside them with
  them. They never did anything: cameras record from the moment they join, and
  no cut ever depended on the phase. The whole idea goes with the buttons — out
  of the wire protocol, the hub, `POST /api/bout`, the camera's log and the
  saved session. A file saved when the phase existed still opens; the field is
  read past.

## 0.0.12

- **B** — Three dependencies were carrying this project's version instead of
  their own: earlier version bumps replaced every `"version": "0.0.x"` in the
  lockfiles, not just ours. `stackback` and `typedarray` are back to the versions
  they were actually resolved from, and a test now checks all four manifests
  agree and no other package has been dragged along.

## 0.0.11

- **D** — Saving a session asks where to put it. Chrome and Edge open a real
  save-as dialog with `videoreferee-TIMESTAMP.json` filled in, which the operator
  can rename; the screen then reports the name they chose. Dismissing the dialog
  says nothing, because changing your mind is not a failure. Browsers without the
  dialog download as before.

## 0.0.10

- **B** — Saving a session downloads instead of failing. The file is fetched
  in-page and handed to the browser as a Blob, rather than followed as a link
  whose anchor the closing menu destroyed mid-download.

## 0.0.9

- **R** — Fold my five UI ideas into the backlog proper, marked *(mine)*, and add
  joining bookmarks that overlap. No behaviour change.

## 0.0.8

- **D** — A BOOKMARK button on the operator screen, so the person at the desk can
  mark what they just saw without asking someone holding a phone. Disabled, and
  refused by the hub, when no camera is filming.

## 0.0.7

- **R** — Record five UI improvements of my own picking in the backlog, each
  checked against the code. No behaviour change.

## 0.0.6

- **D** — `npm start` now checks everything before starting: operator
  dependencies, a certificate that covers this network, and a fresh build of the
  operator screen. `npm run start:hub` is the bare hub for iterating. Adds a
  README with step-by-step setup for an event and a troubleshooting table.

## 0.0.5

- **R** — Record thirteen items raised after a session with the tool, and audit
  the docs. No behaviour change.

## 0.0.4

- **D** — Loading a saved session says so when it came from a different build,
  naming both, on the operator screen and in the hub console. Silent when they
  match, and specific about a file written before versions were recorded.

## 0.0.3

- **D** — Show which build is running, everywhere it might be asked: the
  operator header, the camera's bar and the first line of its log, the hub's
  startup banner, every saved session, and an `X-VideoReferee-Version` header on
  every response. Read from `package.json` alone, so bumping the version stays
  one edit.

## 0.0.2

- **B** — Version bumps move the patch number, the third one, not the minor. The
  agreement said "the minor" meaning the last digit; it was read as the middle
  one and this chunk first appeared as 0.1.0. Nothing ever used that number, so
  it is folded into 0.0.2 rather than left as a gap.
- **D** — Adopt one-intention chunks: every change is a refactor, a bugfix or a
  development, never a mix, and each carries an `R:`/`B:`/`D:` commit, a version
  bump and an entry here.

## 0.0.1

The first version that worked at a bout, and everything up to the point this
changelog began. Recorded as one entry rather than reconstructed after the fact —
the commit history is the record for anything before here.

Multi-angle bookmarks reviewed side by side; the hub cutting every clip to one
shared instant; the operator screen with its review slider, frame stepping and
resolution colours; save, load and clear a session; settings in `config.json`.
