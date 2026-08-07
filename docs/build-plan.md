# Build plan

The spike answered "is this possible". These milestones answer "is this a tool".
Each one ends with something runnable.

## Absent modules, not trivial ones

Twenty-four stub modules would be twenty-four claims about where behaviour lives,
all of them currently false, in a codebase with three real behaviours. So: build
the vertical slice through the fewest modules that can carry it.

The exception is **seams we have already paid to learn about**. An interface with
exactly one implementation and ten lines behind it is cheap; retrofitting a seam
through call sites is not. Concretely, that means the container adapter and the
metadata store get an interface from day one, and everything else appears when it
earns it.

A module earns its own file when it has either **a test of its own** or **two
callers**. Under TDD this resolves itself — the moment we want to test something in
isolation is the moment it wants to be a module.

## Repo layout

One package. No workspace tooling until something demands it.

```
src/
  core/        # pure logic, zero IO — where TDD lives
    media/     # container: parse, keyframes, cut, rebase
    timeline/  # clock offsets, media time -> session time
  hub/         # Node: http, ws, fs. Thin wiring around core.
web/
  camera/      # phone page — vanilla, no framework, deliberately dumb
  operator/    # operator screen — an Angular app, its own npm project
fixtures/      # committed recordings
tools/         # cert generation, fixture recording
```

**Two frontends, two answers.** The operator screen is an Angular app: it grows
bout control, a bookmark list and synchronised playback, and that is what a
framework is for. The camera page stays vanilla and buildless — it is under two
hundred lines, it ships to a phone that must not fail mid-bout, and its whole job
is to hold bytes and answer pings. A build step there would buy nothing and cost
a failure mode.

The Angular app keeps its own `package.json` and `node_modules` so its toolchain
never argues with the root project's. `npm run build:operator` installs and
builds it; the hub serves whatever `dist/browser` contains, and says so plainly
if it has not been built.

Angular's own agent skills are vendored under `.claude/skills/angular-developer`
and `angular-new-app`, from <https://github.com/angular/skills>. They are real
files rather than the symlinks the installer creates, because symlinks in a git
checkout need extra configuration on Windows. To update them, re-run
`npx skills add https://github.com/angular/skills` and move `.agents/skills/*`
into `.claude/skills/`.

Two conventions come from that skill and are worth keeping: forms use
**Signal Forms** (`@angular/forms/signals`), not reactive or template-driven
forms, and HTTP goes through `HttpClient` rather than bare `fetch`.

`src/core/` may not import anything from `src/hub/`, `web/`, `fs`, or `ws`, and may
not read a clock. That single rule is what keeps the suite fast and deterministic.

## M1 — the alignment core, offline

**No server, no phone, no browser.** Port the spike's WebM work into `src/core/`
under test, against fixtures we can already generate.

Deliverable: `npm test` green over the core, plus a small CLI that takes two fixture
recordings and a bookmark instant and writes two aligned clips you can open and
compare.

Why first: it is the only part we already know is subtle, it is where every future
bug will be expensive, and it needs nothing we do not already have. The spike's
`full.webm` and the binary-clock harness are enough to start today.

The money test — the one that encodes the product's whole claim:

> *two recordings with different start anchors produce clips whose bookmark offsets
> refer to the same instant*

Fixture-driven, deterministic, no phones.

## M2 — the tool

Your flow, end to end, on two real phones.

1. `npm start` on the laptop.
2. Start screen: add a camera, name it after the person holding it ("mike", not
   "north" — they move). Cameras are enrolled for the session, not per bout.
3. Adding a camera shows a QR; scanning it opens the camera page already named and
   joined.
4. Start bout.
5. Cameras heartbeat so the start screen shows they are alive.
6. Bookmark on any phone.
7. Every phone uploads its ring buffer; the hub aligns and cuts (M1's core).
8. Clicking a bookmark shows the angles side by side under one slider, anchored on
   the bookmark instant.
9. Loop.

What exists at the end of M2: `Bout` (start/pause/stop), `Bookmark`, `Camera`
registry with heartbeat, enrollment with QR, clip ingest, clip index, the review
screen. What deliberately does not: upload retry, health beyond alive/dead, export,
config UI, auth.

Layout is built to look good at two cameras. Nothing in the model knows the number
(INV-5).

## M3 — operability

The difference between "works at my table" and "works at a tournament": upload
queue with retry and resume, real health (battery, thermal, buffer depth, sync
quality), bout state persisted to JSON so a bout can be paused and revisited,
pre-roll and post-roll as configuration rather than constants.

## Later, in rough order of likely need

- fMP4 container adapter — needed the moment an iPhone reports a non-WebM mimeType.
  Solvable offline once we have one fixture recorded on that phone.
- Pulling full recordings off phones after a bout (decision 2c).
- A tournament layer above bouts, and external reporting.

## Carried over from the spike

- The referee scrubber offers a fixed −5&nbsp;s but clips only reliably contain the
  requested pre-roll. Clamp the scrubber to what each clip actually holds.
- Pre-roll is currently 1.5&nbsp;s; 4–5&nbsp;s is probably closer to what a referee
  wants, which implies a ~30&nbsp;s ring buffer.
