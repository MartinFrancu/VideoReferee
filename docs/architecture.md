# VideoReferee — architecture

Full component map, diagrams and rationale:
[architecture artifact](https://claude.ai/code/artifact/c6a19f5e-b710-46a7-918f-339027a812e9)
(needs the repo owner's login). This file holds the parts that must not drift:
the invariants and the decisions we've closed.

## Invariants

**INV-1 — The phone owns pixels; the hub owns everything else.**
A phone holds bytes and reports numbers. It never decides what a bookmark means,
when it happened in shared time, or which frames answer it.

**INV-2 — Phones report observations, never conclusions.**
A phone sends raw facts — a monotonic timestamp, a byte range, the anchor at which
its recorder started. It never sends a derived quantity such as a clock offset or
an aligned window. Every value that could be *wrong* is computed on the hub, where
it can be inspected in a debugger and covered by a unit test.

**INV-3 — Nothing that can run on the hub runs on the phone.**
Container parsing, keyframe detection, timestamp rebasing and alignment are hub
concerns. The only thing that must happen on the phone is holding recent bytes,
because that is where the bytes are.

**INV-4 — A bookmark is an instant, not a clip.**
Clips are evidence that may arrive late, partially, or never. A bookmark with two
of four angles renders, and says so.

**INV-5 — The number of cameras is never fixed.**
Zero, one, or seven; joining mid-bout, leaving mid-bout, rejoining after a reload.
No layout, message, or data structure may assume a count. The MVP builds a layout
that looks good at two — but nothing in the model knows that.

**INV-6 — Every timestamp crossing the wire is either raw-monotonic or session time.**
Device wall-clock never leaves the device. Media time never leaves the hub's
media layer.

**INV-7 — Uploads are idempotent and replayable.**
Keyed by `(bookmarkId, cameraId)`, so a retry after a reconnect is free and a
duplicate is harmless.

## The consequence of INV-2: the phone is dumb

The spike parses WebM on the phone — finds clusters, detects keyframes, rebases
timecodes. All of that moves to the hub. Verified against a real recording: given
a pinned 64&nbsp;KB prefix of the stream and an arbitrary contiguous byte run from
the middle of it, the hub can locate the init segment in the prefix and the first
complete cluster inside the run, with no cooperation from the phone.

So the phone's entire job becomes:

- pin the first ~64&nbsp;KB of the recorder's output forever (contains the init
  segment; no parsing needed to know that)
- keep a rolling ring of raw `dataavailable` chunks, evicting the oldest
- record `recordingStartedAt` from `performance.now()` — monotonic, so immune to
  clock steps
- on a bookmark, upload `[prefix][ring]` plus that anchor
- answer sync pings with `performance.now()`

The hub does the rest. This is roughly fifty lines of phone code with no format
knowledge in it.

**Why this matters more than it looks.** The hard, bug-prone code becomes a pure
function — bytes plus numbers in, clip plus session time out — running in Node.
It can be unit-tested against fixture recordings with no browser, no camera, and
no phone. A fake camera in an integration test becomes "replay a fixture file",
which means the whole hub can be tested without Playwright. Debugging moves off
the device that cannot be debugged.

It also means the iOS fMP4 problem is solvable offline: record one fixture on the
iPhone, commit it, and develop the MP4 adapter against it on the laptop.

**The cost** is bandwidth: the phone over-sends and the hub cuts precisely. A 20&nbsp;s
ring at ~2&nbsp;Mbps is ~5&nbsp;MB per camera per bookmark. On a LAN with two cameras
that is well under a second, and the referee is walking to the screen anyway. If it
ever hurts, the phone can trim the ring to a rough window at chunk granularity —
still without parsing anything.

## Decisions closed

| # | Question | Decision |
|---|----------|----------|
| 1 | Cameras keep recording while the bout is paused? | Yes — keep the setup rolling; pauses should be brief. |
| 2 | What "save the whole thing" means | (a) saveable bout state now, so a bout can be paused and revisited. (c) pulling full recordings off the phones later, eventually. |
| 3 | Operator and referee the same person? | Usually not — operator at a table, referee in the ring watching a screen. Not designed for yet; keep the seam. |
| 4 | Scoring / PointCounter | Out of scope. Paper works for scoring; synchronised video is the thing that doesn't exist otherwise. |
| 5 | Two taps within a second | Two bookmarks, not one — they often mark different fighters' hits seen from different angles. Presenting them together is a later concern. |
| 6 | Must a bout survive the laptop dying? | No. Losing one bout is acceptable; this is a review tool, not a system of record. |

### What decisions 4 and 6 do *not* license

Decision 4 is "don't build scoring", not "make scoring impossible later". Two cheap
things keep the door open, and both are free if done now:

- `Bookmark` and `Bout` carry stable IDs and an open `meta` field.
- Bouts are records, not "whatever the server happens to be running" — so a
  tournament layer and external reporting (hemaratings.com) have something to
  attach to.

Decision 6 rules out crash-durability, not persistence. Decision 2(a) — pause a
bout and come back to it — still needs bout state to survive a restart. Writing a
JSON file per bout on change satisfies both, costs almost nothing, and is not a
database.
