# Settings

`config.json`, at the root of the repository. Edit it and restart the hub.

Settings are grouped by what you are thinking about when you change one. Every
value is a whole number of milliseconds. Leave any of them out — a whole section,
even — and the defaults are used, so a file with one setting in it is valid:

```json
{ "bookmark": { "preRollMs": 4000 } }
```

The hub prints its settings at startup, so what a running hub is actually using
is always visible — never inferred from the file.

## Where they take effect

The hub reads the file. The phone and the operator screen ask the hub for the
settings over `/api/config` rather than carrying their own copies, so there is
one place to change a value and nothing to keep in step.

The phone reads them once, before it starts recording — the buffer size has to
be right from the first chunk. **A phone already filming keeps the old settings
until its page is reloaded.**

## `bookmark` — what a bookmark captures

| Setting | Default | What it does |
|---|---|---|
| `preRollMs` | 1500 | How much footage before the bookmarked instant a clip carries. Probably too short — 4000–5000 is likelier to be what a referee wants. Raising it means raising `camera.ringWindowMs` too. |
| `postRollMs` | 1000 | How much footage after the instant. |
| `postRollWaitMs` | 1500 | How long a phone waits after a bookmark before uploading, so the post-roll has actually been recorded. Must be at least `postRollMs`. |
| `askAgainEveryMs` | 5000 | How often the hub asks a camera again for footage it has not sent, for as long as that footage could still be in the phone's ring. Lower chases harder and risks asking a slow phone for a copy of an upload already in flight; the phone refuses to send the same bookmark twice at once, so the cost is a wasted message rather than wasted bandwidth. |

## `camera` — what a phone does while filming

| Setting | Default | What it does |
|---|---|---|
| `ringWindowMs` | 25000 | How much footage a phone keeps. The ceiling for the whole `bookmark` section. Costs memory on the phone. |
| `warmUpMs` | 20000 | Footage a camera must hold before BOOKMARK unlocks. See below. |

## `review` — how the review screen moves

| Setting | Default | What it does |
|---|---|---|
| `frameMs` | 33 | One frame, for stepping. 33 is 30 fps; use 40 for 25 fps or 50 for 20 fps. Clips are not frame-rate tagged, so this is told rather than measured. |
| `holdRepeatMs` | 200 | Holding a frame button steps again this often. Lower is a faster walk. |
| `holdDelayMs` | 400 | How long a frame button must be held before it starts repeating. Keeps an ordinary click to one frame. |

## `network` — how the hub and the phones keep in touch

| Setting | Default | What it does |
|---|---|---|
| `pingIntervalMs` | 1000 | How often the hub pings each camera. Also the heartbeat, so raising it makes a dead camera take longer to notice. |
| `staleAfterMs` | 3000 | Silence longer than this and a camera is no longer shown as live. |

## Settings that constrain each other

Three combinations are checked at startup. All of them are reported and none of
them stop the hub — a tournament is a bad time to debug a config file.

**`warmUpMs` must fit inside `ringWindowMs`.** A ring holding 25 s never reports
25 s; `heldMs` measures oldest to newest arrival, so it tops out a chunk short.
A warm-up target at or above the window is therefore never reached, and every
camera would sit at "getting ready" with BOOKMARK disabled for the whole bout.
This one is **corrected** rather than reported, because the failure looks like a
broken tool rather than a bad number.

**`preRollMs + postRollMs` should fit inside `ringWindowMs`**, or clips are
quietly short at one end. Reported, not corrected.

**`askAgainEveryMs` only matters below `ringWindowMs - preRollMs`.** That is how
long a camera can still answer a bookmark — 23.5 s with the defaults — and the
hub stops asking at that point whatever this is set to. An interval longer than
that window means each camera is asked exactly once, which is the behaviour this
setting exists to replace.

**`postRollWaitMs` should be at least `postRollMs`**, or the phone uploads
before it has recorded the footage after the bookmark. Reported, not corrected.

A setting that is not a number, is zero or negative, or is not recognised at all
is reported and replaced by its default. The unrecognised case matters most: a
typo like `preRollMS` is otherwise completely silent — the value you thought you
changed simply keeps its old one.

A setting put in the wrong section is named along with where it belongs:

```
config: "preRollMs" belongs in "bookmark", not "review" — ignored where it is.
```

## What is not here yet

`warmUpMs` is a stand-in. Readiness ought to come from the estimates themselves
— the clock and media-origin uncertainties falling below what review needs —
rather than from buffered footage as a proxy. The number is chosen so that both
estimates have gathered their full sample window by the time it elapses, but
that is a coincidence of timing rather than a measurement. See `docs/BACKLOG.md`.
