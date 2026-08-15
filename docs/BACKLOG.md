# Backlog

Everything deliberately set aside, in the order I would do it. Each entry says
what it is and why it waited, so a future session can pick it up without
re-deriving the reasoning.

Ordering is a recommendation, not a plan. The tiers are what matters more than
the order inside them. Items marked **needs use** are questions that only get
easier once the tool has been used more.

**Status: v0.0.1 works.** Two angles, bookmarked and reviewed side by side, at a
real bout. Three observations from that run drive most of P0:

1. The clips were misaligned once, on the first bookmark, and never again.
2. A duplicated frame near the bookmark on one camera, on every bookmark checked.
   *Demoted to P1 after more use: real, but it does not affect a decision.*
3. The UI is confusing.

---

## P0 — before anything else

### ~~Capture and replay a bookmark~~ — done (0.0.20)

Every upload the hub tries to answer leaves a record in `captures/`: both
estimates and every sample behind them, each cluster's timecode and whether a
clip could begin there, the settings in force, and the outcome — a cut with its
three time domains, or the refusal and its reason. The raw upload is kept beside
it for the most recent `capture.keepUploads`.

`npm run replay -- captures/<file>.json` prints all of it and, when the upload is
still there, re-runs the decision through the same code the hub runs, comparing
against what was decided at the time. A misaligned clip from a venue is now a
case that re-runs in milliseconds with no phone, no browser and no Wi-Fi, and a
difference between builds is reported rather than discovered.

**Not done: the view state.** The user asked for what the review screen did —
which tile was lead, what each `seekTo` asked for, what `currentTime` each video
actually landed on. The suspicion is the seeking as much as the arithmetic, and
none of that is captured, because it happens in the browser rather than on the
hub. That is its own chunk, and the operator screen has nowhere to write to.

### Why the first bookmark is the suspicious one

A concrete hypothesis for observation 1, worth testing before touching anything.

**Both clock estimators are minimum-of-N estimators, and a minimum of N samples
is biased high when N is small.**

- `estimateClock` uses the *fastest* round trip out of at most 20 samples,
  gathered one per second. In the first few seconds, N is tiny.
- `estimateMediaOrigin` uses the *smallest* arrival lag across the chunks in the
  run. A short ring means few chunks means a worse minimum.

Both improve monotonically as samples accumulate. That alone would be harmless
if the bias were shared — but it is not. Each camera draws its own luck, and a
camera that joined later has had fewer samples, so **the two angles are biased by
different amounts.** The difference is the misalignment, and it shrinks as both
estimates converge.

That predicts exactly the reported symptom: wrong on the first bookmark, right
afterwards, and not reproducible once the hub has been running a while.

It also corrects something this file previously got wrong. The entry below on the
residual ~100 ms bias called it "the same on every camera, so the angles still
agree" — that holds in the steady state, which is where it was measured, and not
at all in the first seconds.

Cheapest possible check: the uncertainty figures for that bookmark. **The tool
already computes them and nothing looks at them** (see *Surface the uncertainty*
below). If the hypothesis is right, the bad bookmark had a large `uncertaintyMs`
on at least one camera and the good ones did not — which is also the fix: refuse
or flag a bookmark taken before the estimates have settled.

### ~~Surface the uncertainty~~ — done (0.0.24)

Both figures were computed on every bookmark and consumed by nothing. An angle
now carries `uncertaintyMs` — the two compounded, fixed at the moment of the cut
— and the tile says so in amber past `review.trustedWithinMs`.

**Refusing was offered and declined**, in keeping with every other decision here:
the referee is never blocked, only told. What is not done is the warm-up, which
still measures readiness in buffered seconds as a proxy for the estimates having
settled (see above). Now that the figure is recorded, readiness could be the real
measurement instead — that is the natural next step, and it wants a real event's
numbers first.

**First numbers, for whoever tunes the threshold:** a fake camera on localhost,
with nothing else running, produced 180 ms — 1 ms of clock and the rest media
origin. If real phones are anything like that, 100 ms will flag everything and
the threshold should move; the point of shipping it is finding out.

### ~~The camera warm-up, made visible~~ — done

The phone covers its preview with a progress bar and a countdown until the ring
holds `WARM_UP_MS` (20 s), keeps BOOKMARK disabled until then, and the hub shows
the same camera amber with "warming up — ready in Ns". The natural operator move
— add cameras, immediately bookmark — is now refused rather than silently
producing the worst clip.

What is still a stand-in: readiness is measured by buffered footage alone. The
number is chosen so the clock estimate has also gathered its full 20 samples by
then, but that is a coincidence of timing, not a measurement. Once the
derivation work lands, "ready" should come from the estimates themselves — the
uncertainty falling below what review needs — rather than from a proxy.

### ~~Stop the review screen lying about what it is showing~~ — done

A tile that is not showing the instant that was asked for is now covered by a
black veil naming the reason: "release the slider to bring this angle here"
while another tile is being dragged, "no footage this far" past a clip's end,
"still arriving…" before it lands. The lead is never covered.

The point was never tidiness. All three cases previously showed a real frame,
from the right camera, at the wrong moment, with nothing on screen saying so —
so two angles that merely disagreed about *when* looked like two angles that
disagreed about *what happened*. That is the exact confusion being hunted.

### ~~Remove start/end bout~~ — done

*(user request, raised three times)*

It did nothing: the camera page only logged the phase, recording ran
continuously from join, and no cut depended on it. A control that implies state
it does not have is worse than no control. Gone from the header along with the
phase label beside it, and out of the wire protocol, the hub and the saved
state — a file that still carries `boutPhase` opens fine, the field is ignored.
If point-counting ever arrives it can come back.

The header now has room for a screen name (see *Split the operator screen*
below).

### ~~Saving a session fails in the browser~~ — done (0.0.10)

*(user report: "download state has 'connection error'", on a basic hub at
`https://192.168.1.3:3000/api/state`)*

Diagnosed by the user's own second report: typing the address into a fresh tab
downloaded fine. That cleared the certificate and the hub, and left the anchor.
Save was an `<a href="/api/state" download>` inside the menu, and the click that
started the download also closed the menu — so `@if (menuOpen())` destroyed the
anchor mid-download. The session is now fetched in-page and handed over as a
Blob, like every other request this screen makes.

### ~~A loaded session forgets which cameras had ever joined~~ — done (0.0.16)

Every camera from a file read "waiting for its QR to be scanned", even one that
was filming when the file was saved. The field was written to the file, read
back by `parseSavedState`, and then dropped by `loadState`, which handed
`CameraRegistry.restore` only `{ id, name }`.

`restore` now takes it, and a restored camera carries it separately from
`lastSeenAt` — nothing loaded is live, but a phone that died and a QR that was
never scanned stay different problems, which is half of why a session gets
opened at all.

### ~~A lost upload was lost forever~~ — done (0.0.17)

*(user report: "the clip never arrived", with two saved sessions)*

Both files showed the same thing: cameras live and holding 24 s of footage,
bookmarks with an angle each, every angle `pending`, no clips. Reproduced by
dropping one POST to `/api/clips` in flight — the phone logs "could not reach
the hub", the hub never asks again, and the bookmark stays pending while the
footage sits in the ring for another twenty seconds and then rolls out.

The hub now chases: every heartbeat is a chance to re-ask for anything that
camera has not sent, rate-limited to `bookmark.askAgainEveryMs` and stopped once
`ringWindowMs - preRollMs` has passed. That covers a lost message, a failed
upload, a page that stopped running while the screen was locked, and a socket
that blinked — all of which land in the same place.

**It is not proven to be what happened to the user.** A saved state cannot say
whether an upload was never sent, failed in flight, or was refused by the hub —
see the next item, which is the fix for that.

### ~~An angle that is pending does not say why~~ — done (0.0.18)

The two saved sessions could not answer the only question worth asking.
`status: 'pending'` was all a file carried, and it meant any of: the camera never
got the message, the upload never started, the upload failed in transit, or the
hub refused it and said so only on a console nobody kept.

`Angle` now carries an optional `note`, written by whichever side knows — the
phone for an upload it could not make, the hub for one it refused and for the
moment it stops expecting one. It shows on the tile in place of "still
arriving…" and it survives into the file.

The user chose the note **without** a third `status`, so "never coming" is said
in words rather than in the type: the note is prefixed "never arrived — " when
the hub gives up. If a machine ever needs to branch on that rather than a person
read it, that is when the status is worth revisiting.

---

## P1 — trust in the numbers

**Audit the session↔media time transfer end to end.** The user reports the math
looked dubious and did not have time to dig. It deserves a proper walk with the
dump as evidence rather than a defence. The chain is short —
`clock.ts` → `media-origin.ts` → `session-time.ts` → `alignment.ts` — and every
step is already a pure function, so it can be gone through one number at a time
against a real captured bookmark.

**A better sync method than the fastest-round-trip estimate.** A hub heartbeat
every second or so, feeding a rolling estimate. `estimateClock` already takes
samples and returns an offset, so this changes *how samples are gathered*, not
the interface. Related to the min-of-N bias above: a rolling estimate with a
warm-up requirement addresses both.

**A residual ~100 ms shared bias in the media origin.** The origin is inferred
from the smallest delay ever observed, and no chunk arrives with zero delay, so
the estimate lands late and every clip shifts early. Measured at 80–100 ms *in
the steady state*, where it is shared across cameras and therefore cancels for
review. Correctable only by calibrating a typical encode latency, which is
guesswork. Lives in one module.

**Stale estimates.** An offset older than N seconds describes a network that no
longer exists and should be treated as stale rather than trusted.

**A camera that reconnects** keeps its identity but its recording anchor resets.

**~~Pre-roll and post-roll as configuration~~ — done.** Along with eight other
timings, in `config.json`; see `docs/config.md`. The question it was really
about is still open and now cheap to answer: 1.5 s of pre-roll is probably too
short, and 4–5 s is likelier to be what a referee wants. That needs
`ringWindowMs` raised with it, which costs memory on the phone. **Needs use** —
try 4000 at the next bout and see.

**The duplicated frame near the bookmark.** *(user report, then user judgement:
"it does not seem to be an actual problem")* Seen on one camera, on every
bookmark checked at the first bout, and demoted from P0 on the strength of using
the tool since — it does not affect a decision. Kept because it is still a real
clue about the cut. Suspects, in order: the keyframe snap-back emitting a cluster
that overlaps the next one; the rebased timecodes putting two frames on the same
instant; a truncated final cluster. Cheap to chase now rather than hard — a
capture holds the raw bytes, so this is a unit test whenever somebody wants it.

**A cut clip decodes with no missing-reference errors.** Verified by hand in
batch 3, never automated. Needs a decoder, so it belongs at the integration level.

---

## P2 — the tool a referee can actually drive

Mostly the user's UI list, with a few of my own marked *(mine)*. Grouped because
they share a surface and are best done in one pass.

**~~The operator cannot mark anything~~ — done.** *(mine)* A BOOKMARK button in
the header calls the same path a phone does, recording "the desk" as who
triggered it, and refused — in the button and in the hub — when nothing is
filming.

**Resolving does not move you on.** *(mine)* After deciding a bookmark you are
left looking at the one you just finished, and must find the next undecided one
yourself. Since the loop is *review the marked passage, then sweep*, resolving
should advance to the next undecided bookmark — turning the list into a queue you
work through rather than one you navigate. Never advance onto something still
gathering, and stop rather than wrap at the end.

**The scrubber does not show where the bookmark is.** *(mine)* It is a bare range
input from `minRelativeMs` to `maxRelativeMs`; zero — the instant somebody
actually tapped — is unmarked. Drag away and the only route back is watching the
readout for `+0.00s`. A tick at zero, and a shaded band per clip showing how far
each reaches, would put the thing being reviewed inside the control used to
review it.

**The sweep cannot be undone.** *(mine)* "Mark 8 done" is one click, bulk and
irreversible. Everything else destructive here either asks first (clearing
bookmarks) or is trivially reversible (resolving one). This is neither. An undo
on the notice that already appears — "Marked 8 done · undo" — costs one
remembered list of ids and removes the only action that can quietly lose work.

**Review has no keyboard.** *(mine)* The only key handling anywhere is Enter and
Space on the two frame buttons, and only while focused. Under time pressure a
referee should not be hunting mouse targets: space to play and pause, a key per
resolution, Escape to leave the bookmark. Arrow keys for stepping are requested
separately above; this is the rest of the same idea.

**Join bookmarks that overlap.** *(user request)* Two taps a second apart, or a
tap from the desk and one from a phone at nearly the same instant, are almost
always the same incident seen twice — and reviewing it twice wastes the time the
tool exists to save. Distinct from *Grouping bookmarks that mark the same
moment* below, which is about presenting them together: this is about deciding
they are one, with one set of clips and one decision.

The judgement is what makes it interesting. Overlapping *when*, by some window —
but two taps a second apart are deliberately two bookmarks today, because they
often mark different fighters, and joining those would lose a decision. So
joining probably wants to be offered rather than automatic, and probably only
while both are still undecided. Worth doing after resolutions have been used in
anger, when it is clear how often two really are one. **Needs use.**

**~~Split the operator screen~~ — done.** *(user request, then specified in
detail)* Two tabs rather than three screens: *Cameras* for the phones and adding
one, *Bookmarks* for the list and the incident it points at — the third view is
the stage inside the second, which is where it is wanted. BOOKMARK sits at the
top of the list and nowhere else, by the user's own call: marking from the
cameras tab costs a tab switch, which is worth watching at the next event.

**The operator screen has nowhere to put a test.** Every other part of this
repo is tested; the Angular side is verified by driving a real browser at a real
hub, script by script, and none of those scripts are kept. `tsconfig.spec.json`
is scaffolded for vitest but nothing configures a DOM or a TestBed, so a
component's logic — which radio is preselected, what a cancel leaves behind —
can only be checked by hand. Not urgent while the screens are small, and worth
doing before they are not. Infrastructure, so its own chunk either way.

**Revisit an old bout — as a feature rather than as debugging.** *(user
request, splitting this off deliberately)* Saving and loading a session grew out
of troubleshooting, and the debug dump has now taken that job over: it goes out
only, in one zip, to a fixed folder. What is left under *Session → Save session
to a file* is the beginnings of something else — opening a bout from last
weekend and looking through it again — and it has never been designed as that.

Questions it would have to answer, none of them settled: does loading merge with
a live session or replace it (it replaces, and closes every camera); should a
bout be named and listed rather than being a file the operator has to keep track
of; should the hub keep them itself, so the answer to "where did it go" is never
"wherever the browser put it". Worth doing when someone actually wants to look
at last weekend, and not before. **Needs use.**

**Drop a camera.** *(user request)* Adding one now has its own tab; dropping
still does not exist, so a dead phone stays on the list and keeps being asked for
clips it will never send.

**~~Find the save controls~~ — done.** *(user request: "where are the saving
buttons?")* The `⋯` is now a *Session* button that says what it holds. It stays
in the top bar rather than moving to the cameras tab: saving is something you do
when something has gone wrong, which is not tied to either screen.

**~~Arrow keys to step frames~~ — done (0.0.23).** *(user request)* Left back,
right forward, tap for one frame and hold for a walk, at the same timings as the
buttons. The buttons stayed rather than being replaced: the user's own words for
them were "the button we have somewhere", which is an argument for keeping the
visible one and adding the fast one, not for swapping.

**Hide a view that cannot reach the current instant.** *(user request, while
stepping by frame)* Today it is veiled with "no footage this far". The request
is to hide it outright. Worth checking whether the veil is appearing at all
during frame stepping, since the report suggests it is not.

**~~A save-as dialog with a prefilled name~~ — done.** *(user request)*
Chrome and Edge open a real dialog with `videoreferee-TIMESTAMP.json` filled in
and the chosen name reported back; elsewhere it downloads as before. It did
indeed come with the save failure — the same chunk pair fetched the session
in-page, which is what made the download work at all.

**Identify which camera is which.** Asked as a question: *is there a way to
identify a camera for the user?* Nothing today ties a name in the list to a phone
on a tripod. Cheapest honest answers: show the live thumbnail on the hub, or
flash something on the phone screen when its card is clicked. The second is
better in a hall — it works when the camera is across the room and the operator
is looking at the phone, not the screen.

**Kick a camera, and re-show its QR.** A camera added by mistake or a phone
swapped mid-tournament stays on the list forever, and there is no way to get the
join QR back once the dialog is closed.

**Delete a single bookmark.** Clearing them all is done (session menu → *Clear
all bookmarks*, behind a confirmation). Removing one at a time is not, and is the
likelier need once bookmarks get names.

**What the colours mean.** A bookmark can now be resolved red, blue, purple or
done, and nothing anywhere attaches meaning to those — they are colours, stored
as colours. Presumably red and blue are the two fighters and purple is a double,
but that was never said, and guessing would bake a rule in. Naming them is a
change of label, not of shape, so it can wait for use. **Needs use.**

**Name a bookmark.** The user likes this. Cheap: `Bookmark` already has room.

**Zoom on a paused video.** A referee wants to look closely at a hand. Only
meaningful once paused, which is the normal review state anyway.

**Clamp the review scrubber to what each clip actually holds.** Now partly done —
the slider spans what at least one angle holds. What remains is per-angle
behaviour, which is the dim/black item in P0.

**Falling back to a keyframe inside the window.** When no keyframe precedes the
requested start, `cutClip` returns nothing. Showing the last fraction of a second
may beat showing a blank tile. **Needs use.**

**Adding a camera mid-bout.** The user is unsure whether it should even be
visible. Nothing in the model forbids it (INV-5); this is purely a question of
whether showing the control invites a mistake. **Needs use.**

---

## P3 — surviving a real venue

**Collect the cameras' logs into one dump.** *(user request)* The natural
extension of P0's capture: the hub asks every phone for its recent log and
aggregates them into a single file next to the hub-side dump. Worth doing once
the hub-side capture exists and its shape is known — building both at once risks
designing the aggregation before knowing what is worth aggregating.

**Upload queue with retry and resume.** A phone that loses Wi-Fi mid-bout must
still deliver its clip. The difference between a demo and something that survives
a tournament.

**Health beyond alive/dead.** Battery, thermal state, storage headroom, ring
occupancy, upload backlog. "Is camera 3 about to die" has to be answerable at a
glance.

**Wake Lock and screen-lock hardening.** Held on one phone. If backgrounding
kills the stream on other devices, that is the signal to wrap the camera page in
Capacitor rather than fight the browser.

**A certificate that survives changing networks.** Accepting the warning is
filed by the phone against the address it visited, so a new venue means every
phone accepts again. The hub now says so at startup rather than letting it
surprise you, but removing the warning outright needs either a local CA
installed on each phone — more one-time fiddling than the warning it replaces —
or a real certificate for a domain, which needs a domain and a hostname that
resolves to the laptop's LAN address. Worth revisiting only if the tool goes
beyond a known set of phones.

**Docs that still describe the plan rather than the tool.** `docs/build-plan.md`
lays out milestones M1–M3 that have all been walked, and `docs/TESTLIST.md` has
an empty `Now` section — both read as forward-looking documents describing work
that is finished. Their value now is historical (the lessons and design-smell
sections in TESTLIST are worth keeping either way). `docs/architecture.md`
predates bookmark resolution and `config.json`, and `docs/review-screen.md`
predates the veil, hold-to-step and the resolution chips. None of it is wrong
about intent; all of it is behind on fact.

**A walkthrough that runs on Windows.** The hub is developed on Linux and run at
the tournament on Windows, and the first thing that gap produced was a hub that
died on its first page load (see TESTLIST). Unit tests now reach Windows by
injecting the path flavour, but no end-to-end walkthrough has ever run there.

**A bout access token.** Nothing stops a phone on the same Wi-Fi from injecting
bookmarks.

**Saving a bout to disk — done, as far as it goes.** The session menu saves
cameras, bookmarks and the clips inline into one JSON file, loads one back, and
clears the bookmarks behind a confirmation (`src/core/state.ts`,
`/api/state`, `/api/reset`).

What it deliberately does *not* carry is the derivation — the sync samples, the
media-origin samples and both uncertainties. Those are computed at ingest and
discarded, so a saved file shows what the hub concluded but not how, and cannot
replay a cut. That is still the P0 capture work; the state file is the obvious
place to put it when it exists, and the format number is there to bump.

Two smaller gaps: a loaded camera is listed as never-joined, so the card reads
"waiting for its QR to be scanned" when it means "this camera was somewhere
else"; and the file is read whole into memory on both sides, which is fine for a
bout and would not be for an afternoon.

---

## P4 — container handling, when the format changes

Nothing here is wrong today. Each is a way the current parser could be wrong on
hardware we have not used.

**Fragmented MP4, for iOS Safari.** The clip builder is WebM-only. If an iPhone
reports a non-WebM mimeType the camera page must say so loudly rather than upload
clips that cannot decode. Developable offline from a single fixture recorded on
the phone. **Still unanswered: what an iPhone actually reports.**

**Non-default `TimecodeScale`.** We assume one tick is one millisecond, true for
Chrome's default. A recorder that disagrees produces clips wrong by a constant
factor.

**A truncated final cluster** is emitted rather than dropped. Harmless so far —
the last cluster of a clip is the tail of the window — but a run ending
mid-cluster carries a partial one. A suspect for the duplicated frame.

**A first chunk of one byte.** Observed in the spike: Chrome split the EBML magic
number across two chunks. The parser handles it by accident rather than by test.

---

## P5 — beyond the tool

**Pulling full recordings off the phones after a bout.** Decision 2(c): each
phone writes the whole bout locally, only snippets go over the wire live, full
files collected afterwards. Keeping this open costs one extra sink on the ring.

**Two screens.** The operator sits at a table, the referee is in the ring. One
browser tab today; the seam is there when it is needed.

**Grouping bookmarks that mark the same moment.** Two taps a second apart make
two bookmarks by decision, because they often mark different fighters. Presenting
them together is a separate concern. **Needs use.**

**Scoring, and a tournament layer above bouts.** Out of scope by decision — paper
works for scoring, synchronised video is what does not exist otherwise. Kept open
by two cheap things only: stable IDs and an open `meta` field on `Bookmark` and
`Bout`. Auto-reporting to hemaratings.com would attach there.
