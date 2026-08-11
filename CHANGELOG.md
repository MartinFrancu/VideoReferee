# Changelog

One entry per chunk of work, marked with what kind it was:

- **R** — refactor: different structure, same behaviour
- **B** — bugfix: it now does what it was always supposed to
- **D** — development: it does more, less, or different

See `.claude/skills/chunks/SKILL.md` for the working agreement this follows.

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
