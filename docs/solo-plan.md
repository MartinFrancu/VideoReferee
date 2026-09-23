# VideoReferee Solo — plan

A second, much smaller tool: **one referee, one phone, no setup**. Parallel to
the main version, not a replacement for it.

Nothing here is built. This records the shape of the thing, the one question
that decides whether it is possible, and the order in which to find out.

---

## What it is

A phone, propped up or held, is always recording the last half-minute and
nothing else. The referee sees something, taps one big button, and those thirty
seconds are there to scrub, step through and watch slowly. They look, they
decide in their own head, they tap back to live.

The whole product claim is the setup:

| | Main version | Solo |
|---|---|---|
| Before the event | `npm install`, a laptop, a certificate | — |
| At the event | One Wi-Fi all devices share | — |
| Per phone | Accept a certificate warning, scan a QR, wait 20 s to warm up | Open a link, allow the camera |
| Running | A terminal window that must stay open | — |

Opened once, it is added to the home screen and from then on opens like an app
and runs with no signal at all.

**Nothing is stored and nothing is uploaded.** The answer to "keep the footage?"
was review-and-discard, which turns out to be a feature rather than a
limitation: this films people, often children, at a public event, and a tool
that provably keeps nothing is one nobody has to have a conversation about. It
should say so on the screen.

## What it is not

Everything hard about the main version comes from reconciling several devices,
and none of it applies here:

- **No hub, no server, no network.** After the page has loaded, the phone is
  alone. INV-2/INV-3 — the phone reports, the hub concludes — has nothing to
  say when there is only one of them.
- **Three time domains become one.** No clock offset, no media origin, no
  min-of-N bias, no uncertainty, no manual trim. A bookmark is a position in the
  one recording that exists. INV-4 still holds; it is just trivially true.
- **No cutting to a shared instant,** because there is nothing to share it with.
  The most intricate code in the repo — the EBML cluster work in
  `src/core/media` — has no job here.
- **No camera management, no QR, no save, no load, no debug dump.**

The current P0 and P1 backlog is entirely about trusting numbers that this
version does not compute.

## The one question that decides everything

> On an iPhone, can a page get at the **recent past** while still recording —
> and can that past then be stepped **one frame at a time**?

Everything else is a small matter of layout.

It is a real question and not a formality, for two reasons.

**The trick the main version uses does not transfer.** The phone page today
keeps a ring of WebM clusters, which works because WebM clusters can be
concatenated behind one init segment and the result is a valid file. Safari does
not record WebM. Whatever it hands back has different rules, and it may hand
back nothing usable until recording stops.

**Keyframe spacing is not ours to choose.** `MediaRecorder` has no control over
it. Seeking lands on what the decoder can decode, so if Safari's encoder places
keyframes half a second apart, "step one frame" becomes "lurch to the next
keyframe" — and the product is watching a knife touch frame by frame. That would
not be a rough edge; it would be the thing not working.

## Tech stack

**Plain HTML, CSS and JavaScript. No framework, no build step** — the same shape
as `web/camera/` already has. The reason is not taste: a service worker caching
a fixed list of files is a page of code, the offline story is then genuinely
solved, and there is no build to forget to run. The Angular operator screen
exists because it manages a lot of state; this screen has three.

**Served as static files over HTTPS**, which `getUserMedia` requires anyway.
GitHub Pages off this branch costs nothing and deletes the entire certificate
problem — the single worst part of setting the main version up.

**A service worker and a web app manifest.** `display: standalone` so Add to
Home Screen gives an icon and no browser chrome; the cache so a venue with no
internet is not a problem.

**Wake Lock**, or the screen sleeps mid-bout. **`playsinline`**, or iOS takes
the video fullscreen and the layout is gone. **No storage API at all** — nothing
is kept, so there is no quota, no cleanup, and nothing to explain.

**Testing** the same way as the rest of the repo: pure functions — what the ring
holds, frame arithmetic, what a buffer covers — as ES modules under the existing
vitest, and the device glue verified by hand on the actual phone, because no
test runner can tell us what Safari's encoder does.

## Getting at the past: five candidates, cheapest first

Take the **leftmost one that survives the spike**. Do not build a lower one
because it is more elegant.

**1. Two staggered recorders.** Two `MediaRecorder`s on the same stream, started
fifteen seconds apart, each stopped and restarted every thirty. On BOOKMARK,
stop the older one: it hands back a complete, valid file covering the last
15–30 seconds. No container surgery anywhere — every blob is a whole file the
browser wrote and will play without argument. *Ruled out if* Safari refuses two
recorders on one stream, or restarting visibly drops frames.

**2. One recorder, stopped on the bookmark.** Stop, review the blob, start
again. Filming pauses during the review — which in single-player is free,
because the referee is looking at the phone rather than at the fight. This is
the fallback that cannot fail. *Its flaw:* a bookmark shortly after a restart
has almost no history behind it.

**3. The browser's own buffer.** Feed the recorder's chunks into a
`SourceBuffer` and let the media element be the ring: going back thirty seconds
is then just moving `currentTime`, and evicting old video is the browser's
problem, not ours. Elegant if it works. *Risk:* on iPhone this arrived only as
`ManagedMediaSource` and it is particular about what it accepts.

**4. A ring of encoded chunks (WebCodecs).** Encode with `VideoEncoder`, keep
the last thirty seconds of `EncodedVideoChunk`s in memory, decode on demand. No
container involved at any point. Crucially it is the **only** option that lets
us ask for a keyframe when we want one — the difference between stepping frames
and guessing. *Cost:* the most code by some way.

**5. Surgery on whatever Safari emits.** The same spirit as the EBML work in
`src/core/media`, applied to fragmented MP4. Last resort. That work took longer
than anything else in this repo, and doing it again on a less documented format
is not a plan, it is a consequence.

## The spikes

Nothing is decided before Spike 0 exists, and nothing is built before Spike 2
passes.

**Spike 0 — the capability probe.** One HTML file, opened on Martin's actual
iPhone, that prints what the device can do and lets him record ten seconds and
try stepping through it. It answers, on that phone: the Safari version; which
MIME types record; whether two recorders coexist on one stream; whether
`ManagedMediaSource` and `VideoEncoder` exist and what they accept; whether
`requestVideoFrameCallback` and Wake Lock exist; and how coarsely a recorded
blob seeks. *Deliverable:* a screenshot sent back. Hosting it on Pages also
proves the distribution story on day one, which is half the product claim.

**Spike 1 — the ring.** Whichever rung of the ladder survived. One button; press
it and the last twenty seconds play. Nothing else on the screen.

**Spike 2 — the stepping.** Scrub, ±1 frame, slow motion, on Spike 1's buffer.
*Deliverable:* Martin can see the moment of a touch on his own phone, frame by
frame. **This is the go/no-go for the whole idea** — everything before it is
plumbing and everything after it is layout.

**Spike 3 — the afternoon.** Run it for an hour. Heat, battery, memory, and what
happens on a phone call, a notification, a lock and an app switch. *Deliverable:*
numbers, and a list of what breaks.

## Risks, in the order they are likely to bite

- **Coarse stepping.** The one that kills the product, which is why Spike 2 is
  early. The escape is rung 4, where keyframes are ours to place.
- **iOS stops the camera** on backgrounding, a call, sometimes a notification.
  The page must notice and say *tap to resume* rather than sit there looking
  live while recording nothing. A tool that silently stops filming is worse than
  no tool.
- **Heat and battery** over an afternoon of continuous encoding.
- **One phone is one angle,** and often a shaky one. The main version exists
  because one angle is frequently not enough. Solo is not a cheaper version of
  it; it is the tool for the case where setting four phones up was never going
  to happen.

## What v0 is

Live view. One button. A review overlay with scrub, frame step and slow motion.
Back to live. No list, no colours, no saving, no settings screen.

The main version has a bookmark list and decision colours because it manages a
queue that builds up while footage arrives. Here nothing arrives and nothing
queues — you look, and you are done. If keeping a few turns out to be wanted, it
is a strip of the last handful held in memory and dropped oldest-first, not a
storage feature.

## How it relates to the main version

A separate app under `web/solo/`, sharing the repo and nothing else — not one
line of `src/core`, all of which exists to reconcile several devices.

There is one place they might meet later: the camera page in the main version
could gain the same local replay, so a phone could answer *show me that again*
without involving the hub at all. Worth remembering, not worth designing for.

## Open decisions

- **The name.** "Solo" is a working title.
- **One bookmark or a few?** Recommended: start with one, add a strip only if
  using it says otherwise.
- **Thirty seconds** — from experience, or a guess? It is the one number that
  costs memory on every rung of the ladder.
- **Audio?** A touch has a sound worth hearing. It also doubles the encoder's
  work and adds a permission prompt. Recommended: off for v0, easy to add.
- **Versioning.** This branch deliberately does not bump the shared version or
  add a `CHANGELOG` entry. That number describes the running hub — it is shown
  in its header, sent on every response and written into saved sessions — and
  this branch does not change it. Two branches claiming the same version with
  different contents is worse than one branch not claiming it. When `web/solo/`
  has code, it should carry its own version and its own changelog.
