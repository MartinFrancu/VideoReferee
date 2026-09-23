# VideoReferee Solo — plan

A second, much smaller tool: **one referee, one phone, no laptop, no setup**.
Parallel to the main version, not a replacement for it.

---

## What it is

The referee films the bout on a phone. When they see something worth a second
look they hit one big button and **keep filming** — up to five times in a bout.
When the main referee stops the fight, they hit stop, and the marks are there to
flick between: each one showing the second or so before it and the second after,
steppable a frame at a time.

Then it is thrown away and the next bout starts.

The whole product claim is the setup:

| | Main version | Solo |
|---|---|---|
| Before the event | `npm install`, a laptop, a certificate | — |
| At the event | One Wi-Fi all devices share | — |
| Per phone | Accept a certificate warning, scan a QR, wait 20 s to warm up | Open a link, allow the camera |
| Running | A terminal window that must stay open | — |

**There is no laptop in the finished version.** A laptop serving the page is
acceptable while spiking and nothing more: the point of this tool is a referee
who can start using it in the thirty seconds before a bout.

**Nothing is stored and nothing is uploaded.** Review-and-discard turns out to
be a feature rather than a limitation: this films people, often children, at a
public event, and a tool that provably keeps nothing is one nobody has to have a
conversation about. It should say so on the screen.

## What it is not

Everything hard about the main version comes from reconciling several devices,
and none of it applies:

- **No hub, no server, no network** once the page has loaded.
- **Three time domains become one.** No clock offset, no media origin, no
  min-of-N bias, no uncertainty, no manual trim. A mark is a position in the one
  recording that exists. INV-4 still holds; it is just trivially true.
- **No cutting to a shared instant.** The EBML cluster work in `src/core/media`
  — the most intricate code in the repo — has no job here.
- **No camera management, no QR to join, no save, no load, no debug dump.**

The current P0 and P1 backlog is entirely about trusting numbers this version
never computes.

## The thing that turned out to be easy

The first draft of this plan assumed a rolling thirty-second buffer, because it
assumed marking and reviewing happened together. They do not: the referee marks
during the fight and reviews after it is stopped. **Filming and reviewing never
overlap.**

That removes the hard problem entirely. One `MediaRecorder` runs for the whole
bout; stopping it hands back a complete, valid file the browser wrote itself;
each mark is a millisecond offset into that file. There is no container surgery,
no second recorder, no MediaSource, no WebCodecs — and switching between marks
is instant, because it is one recording already loaded and a switch is a seek.

An earlier version of this document listed five increasingly desperate ways to
read the recent past while still writing to it. None of them is needed. It is
recorded here only so the idea is not had again.

## The thing that is still unknown

> Can that recording be stepped **one frame at a time** on an iPhone?

`MediaRecorder` gives no control over keyframe spacing. Seeking lands on what
the decoder can decode, so if Safari's encoder places keyframes half a second
apart, "step one frame" becomes "lurch to the next keyframe" — and the entire
point is watching a touch frame by frame. That would not be a rough edge; it
would be the thing not working.

So the spike measures it, on the actual phone, and says so in words. If it comes
back coarse, the answer is WebCodecs, where keyframes are ours to place, and
that is a much bigger piece of work to be decided on evidence.

A second, smaller unknown: there is a lag between asking for a recording and the
first frame being encoded, and nothing reports it. A mark timed by the page's
clock may therefore sit slightly off the moment. The spike records **two**
timings for every mark — the page clock and the camera's own frame clock — and
lets them be compared on the review screen.

## Tech stack

**Plain HTML, CSS and JavaScript. No framework, no build step** — the same shape
as `web/camera/`. Not taste: a service worker over a fixed list of files is a
page of code, which makes the offline story genuinely solved, and there is no
build to forget to run.

**Static files over HTTPS**, which `getUserMedia` requires anyway. That deletes
the certificate problem — the worst part of setting the main version up — and
makes deployment "push, and every phone has the new version".

**A service worker and a web app manifest** so Add to Home Screen gives an icon
and no browser chrome, and so a venue with no internet is not a problem.

**Wake Lock**, or the screen sleeps mid-bout. **`playsinline`**, or iOS takes
the video fullscreen. **No storage API at all** — nothing is kept, so there is
no quota, no cleanup, and nothing to explain.

**Testing** as the rest of the repo does it: pure functions under vitest
(`windows.js` is the whole of the arithmetic), and the device behaviour verified
by hand, because no test runner can tell us what Safari's encoder does.

## Getting it onto somebody else's phone

The requirement is handing it to another referee's phone in the time between two
bouts, with no laptop and no app store.

**A Share button showing a QR of the app's own URL.** They point their camera at
your screen, the page opens, Add to Home Screen, done — about fifteen seconds.

The one honest dependency: **each phone needs internet once, ever.** Their own
mobile data is plenty; the app is tens of kilobytes. After that first load the
service worker means it never needs a network again.

Opening the file directly — AirDrop, Files — does not work: iOS will not give
camera access to a page opened from the filesystem, because it is not a secure
context. That route is closed, and it is worth writing down so it is not
re-investigated.

**Hosting is the one open decision.** GitHub Pages is free for a public repo and
needs a paid plan for a private one; Cloudflare Pages and Netlify are free
either way. To be settled once the spike has answered the frame-stepping
question — there is no point arranging distribution for an app that cannot do
its job.

## Where it is now

**The spike is built**, at `web/solo/`, and is described in
[solo-spike.md](solo-spike.md) — what it does, how to run it, and what to look
for. It is served by the hub at `/solo/` purely so it can be got onto a phone
today.

Next, in order:

1. **Run the spike on the phone** and read the verdict line. This is the go/no-go.
2. If stepping works: **manifest, icon and service worker**, then hosting, then
   the Share-a-QR button. The laptop drops out at that point.
3. If stepping is coarse: **a WebCodecs spike** before anything else is built.
4. **An hour-long soak** — heat, battery, memory, and what a phone call does.

## Risks, in the order they are likely to bite

- **Coarse stepping.** The one that kills the approach, which is why it is
  measured first and in words.
- **iOS stops the camera** on backgrounding, a call, sometimes a notification.
  The page must notice and say so; a tool that silently stops filming is worse
  than no tool. The spike handles the track ending, and that needs testing for
  real.
- **A whole bout in memory.** Minutes of video at a phone's bitrate. Fine for a
  bout, unknown for a very long one, and there is no plan yet for what happens
  when a phone says no.
- **Heat and battery** over an afternoon.
- **One phone is one angle,** and often a shaky one. The main version exists
  because one angle is frequently not enough. Solo is not a cheaper version of
  it; it is the tool for the case where setting four phones up was never going
  to happen.

## Open decisions

- **The name.** "Solo" is a working title.
- **How long before and after a mark.** The spike makes both adjustable on
  screen so the right numbers can be found by trying them rather than guessed.
- **Audio?** A touch has a sound worth hearing, but it adds a permission prompt
  and work for the encoder. Off in the spike.
- **Where it is hosted.** See above.
- **Versioning.** This branch does not bump the shared version or add a
  `CHANGELOG` entry: that number describes the running hub, which this branch
  does not change. Solo carries its own version, shown in its diagnostics panel.
