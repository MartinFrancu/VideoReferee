# VideoReferee — feasibility spike

Throwaway code, not the real app. It exists to answer one question before we
build anything real in Angular:

> Can a phone's mobile browser reliably record video for a whole bout, keep a
> local rolling buffer, and burst-upload just the bookmarked slice to a local
> server — well enough for a referee to review synced angles in seconds?

## How it works

- Each phone opens `camera.html`. It records continuously into a **local
  rolling buffer** (last ~20s), uploading nothing by default.
- Tapping BOOKMARK (on any phone) tells the server "a bookmark happened at
  time T". The server broadcasts that to **every** connected phone.
- Every phone — not just the one that tapped — then uploads its own buffered
  slice covering `T - 1.5s` to `T + 1s`, so the referee can see all angles,
  even from cameras that didn't tap anything.
- Sync is timestamp-only for this spike (a lightweight NTP-style clock-offset
  estimate per phone) — no audio cross-correlation yet.
- The referee opens `referee.html` on the laptop, sees bookmarks arrive live,
  and clicking one shows all received angles side by side, each already
  seeked to the bookmarked instant, with a shared scrubber that moves all
  angles together relative to that instant.

### How a clip is actually cut (the part that is easy to get wrong)

`MediaRecorder`'s `dataavailable` chunks are **arbitrary byte slices of one
continuous stream**, not self-contained pieces of video. A chunk boundary can
land anywhere — we measured one that split the 4-byte EBML magic number across
two chunks. So you cannot build a playable clip by concatenating a subset of
chunks, no matter which header bytes you staple onto the front.

What you *can* cut on is the WebM structure underneath, which is what
`public/webm.js` does:

- Reassemble the chunk stream and split it into the **init segment**
  (everything before the first Cluster) plus **whole Clusters** (~300ms each).
- Keep a rolling window of clusters; a clip is `init segment + selected
  clusters`.
- **Rebase cluster timecodes.** They are absolute (ms since recording start),
  so a clip cut at 90s whose first cluster still says `90000` makes players
  treat it as a 90-second clip with nothing at the front.
- **Snap the start back to a keyframe.** Video only decodes from a keyframe,
  and Chrome emits one roughly every 3.4s — so clips carry a few seconds of
  lead-in before the requested window. That is why each clip reports where the
  bookmark falls inside it (`clipStart`), and why the referee page seeks rather
  than just pressing play.

Because the lead-in differs per camera, that per-clip `clipStart` is also what
makes the angles line up with each other on the referee page.

## Prerequisites

- Node.js installed on the laptop (check with `node --version` — anything
  reasonably recent, e.g. 18+, is fine).
- The laptop and every phone connected to the **exact same Wi-Fi network**.
  A few things that silently break this:
  - Some home/office/guest Wi-Fi networks enable "client isolation" or "AP
    isolation" — every device gets internet but devices can't see each
    other. If phones can't reach the laptop at all (page just spins/fails to
    load), this is the first thing to suspect. A phone hotspot you create
    yourself, with the laptop and other phones joining it, sidesteps this.
  - Corporate/enterprise Wi-Fi very often blocks this too.
- Camera access (`getUserMedia`) and Wake Lock only work in a "secure
  context" — plain `http://192.168.x.x` will silently fail to get camera
  permission (no error dialog, it just won't work). That's why the setup
  below serves everything over `https://` with a self-signed certificate,
  and why every device has to click through one "this site isn't trusted"
  warning the first time.

## Setup (do this once)

Open a terminal on the laptop:

```
cd spike/server
npm install
npm run gen-cert   # creates a throwaway self-signed TLS cert in server/certs/
npm start
```

(`gen-cert` is a plain Node script, so this works the same on Windows,
macOS, and Linux — no `openssl` or `bash` required.)

You should see output like:

```
VideoReferee spike server listening on https://0.0.0.0:3000
Open https://<this-machine-local-ip>:3000/camera.html on each phone (same Wi-Fi).
Open https://<this-machine-local-ip>:3000/referee.html on the laptop.
```

Leave this terminal window open — the server stops if you close it or hit
Ctrl+C. Note: the very first time it starts, macOS/Windows may pop up a
firewall prompt like **"Do you want the application node to accept incoming
network connections?"** — you must click **Allow**, or phones will never be
able to reach it.

**Find your laptop's local IP address** (the `<this-machine-local-ip>` part —
the server doesn't know this itself, so you have to look it up):

- **macOS**: System Settings → Wi-Fi → click the connected network's ⓘ /
  Details → look for "IP Address" (something like `192.168.1.23`). Or in
  Terminal: `ipconfig getifaddr en0`.
- **Windows**: open Command Prompt, run `ipconfig`, look under your Wi-Fi
  adapter for "IPv4 Address".
- **Linux**: `hostname -I` or `ip addr show` and look for the address on your
  Wi-Fi interface (usually starts with `192.168.` or `10.`).

Write that address down — e.g. if it's `192.168.1.23`, your URLs for the rest
of this guide are `https://192.168.1.23:3000/referee.html` and
`https://192.168.1.23:3000/camera.html`.

## Running a test session — step by step

**1. Laptop — open the referee page**

- Open a browser tab to `https://<laptop-ip>:3000/referee.html`.
- You'll get a warning like "Your connection is not private" / "This
  connection is not secure" — this is expected, it's the self-signed cert.
  Click **Advanced** (Chrome) or the equivalent, then **Proceed to
  `<ip>` (unsafe)** / **visit this website**. You only do this once per
  browser.
- You should see an empty page: a "Bookmarks" sidebar (empty) and "Select a
  bookmark to review its angles" in the main area. Leave this tab open —
  bookmarks will appear here live.

**2. Each phone — open the camera page**

On the iPhone (Safari):

- Go to `https://<laptop-ip>:3000/camera.html`.
- Safari will show **"This Connection Is Not Private"**. Tap **Show Details**,
  then tap **visit this website**, then confirm **Visit Website** in the
  popup. (This confirmation flow is iOS Safari–specific and easy to fumble —
  if the page still won't load, you likely missed one of these two taps.)
- Safari will then ask to **Allow camera access** and **Allow microphone
  access** — allow both. If you accidentally deny either, the page will show
  a "Camera error" alert; you'd need to reset permission for the site in
  Safari settings (Settings app → Safari → Advanced/Website Data, or the
  "aA" menu → Website Settings) and reload.
- A prompt (native iOS dialog) will ask for a **camera name** — type
  something like `north` or `east`. This is stored on the phone so you won't
  be asked again on reload.
- You should now see: a live camera preview, a status pill that should turn
  green and say "connected", and a small scrolling log underneath. Check the
  log for two specific lines:
  - `wake lock acquired` — good sign. If instead you see `wake lock failed:
    ...`, note the exact message; that's directly relevant to whether
    screen-lock will kill recording.
  - `recording started` and a `using mimeType: ...` line — note what codec
    it picked, useful if playback looks odd later.

Repeat for each additional phone, giving each a distinct camera name.

**3. Create a bookmark**

- On any one phone, tap the big red **BOOKMARK** button.
- Watch that phone's log for `uploaded clip (...)`.
- Watch the *other* phone(s)' logs too — they should also show an upload line
  within about a second, even though they didn't tap anything. That's the
  "broadcast to everyone" behavior working.
- On the laptop's referee tab, the new bookmark should appear in the sidebar
  list within a couple seconds, showing how many clips have arrived. Click it
  — you should see a video tile per camera, already playing, looping.

If you see a bookmark appear but clip count stays at 0, or a tile never
shows up for one camera, that phone's upload failed or its buffer didn't
have footage covering the window — check that phone's on-screen log.

**4. Stopping / resetting**

- Ctrl+C in the server terminal stops everything.
- Bookmarks and clips are only kept in memory + `server/clips/` on disk —
  restarting the server clears the bookmark list (old clip files stay on
  disk until you delete `server/clips/` yourself).
- If port 3000 is already in use on a restart, either stop the old process
  or run with a different port: `PORT=3001 npm start`.

## Troubleshooting: phone gets a spinning "loading" that never finishes

This is different from the cert-warning screen — it means the connection
attempt isn't even reaching the server (a bad cert would still show a warning
page; this is silence). Almost always one of these, in order of likelihood:

1. **Windows Firewall is blocking inbound connections to Node.** This is the
   most common cause. The first time `npm start` runs, Windows should prompt
   "Windows Defender Firewall has blocked some features of Node.js" — if you
   clicked **Cancel** (or it appeared minimized and got missed), every
   connection from another device will hang exactly like this, while the
   laptop itself can still reach the server fine (loopback/self-traffic
   isn't firewalled the same way) — which lines up with the one time it
   worked. Fix it directly, in an **admin PowerShell**:
   ```
   New-NetFirewallRule -DisplayName "VideoReferee spike" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
   Then try the phone again.
2. **Wrong IP address.** The server now prints the exact URLs to use on
   startup (`npm start` output) instead of making you look it up — if your
   laptop has a VPN active or multiple network adapters, `ipconfig` can
   easily surface the wrong one. Re-run `npm start` and copy the address it
   prints exactly.
3. **Network profile set to Public.** If Windows treats your Wi-Fi as a
   "Public" network, some firewall defaults are stricter. The rule above
   applies to all profiles regardless, so it should cover this too — but if
   still stuck, check Settings → Network & Internet → Wi-Fi → (your network)
   → Network profile type, and switch it to Private if appropriate for where
   you are.
4. **Client isolation on the Wi-Fi network** (see Prerequisites above) — if
   1–3 don't fix it, try a phone hotspot with the laptop joined to it
   instead, to rule the network itself out.

## Troubleshooting: "Safari could not open the page because the network connection was lost" (right after accepting the cert warning)

This is a different failure mode from the spinner above — the connection
*did* reach the server, but iOS Safari killed it. This happens when the
self-signed certificate has no **Subject Alternative Name (SAN)** — a
CommonName alone isn't enough for iOS; it lets you click through the initial
warning but then refuses the connection outright. `gen-cert.js` now bakes in
a SAN covering `localhost` and every local IPv4 address it can detect on the
machine, so a freshly generated cert should work. If you generated your cert
before this fix (or changed Wi-Fi networks since, so your IP isn't in the
cert anymore), regenerate it:

```
cd spike/server
npm run gen-cert
npm start
```

Then reload the page on the phone — you'll get the "not private" warning
again since it's technically a new certificate, click through it once more.

## Troubleshooting: referee page shows a grey box, or every bookmark looks like the same early moment

Both symptoms had the same root cause, now fixed: clips were being assembled
by concatenating raw `MediaRecorder` chunks, which are arbitrary byte slices
rather than self-contained video (see "How a clip is actually cut" above). An
earlier attempt pinned the recorder's first chunk and prepended it to every
clip — that first chunk contains the opening moment of the recording, so every
bookmark decoded that same opening fraction of a second and then hit
unparseable bytes and stopped. Hence "every bookmark shows the first video",
even though the filenames, byte sizes, and timestamps were all genuinely
different.

The server log is the quickest check. Each upload prints:

```
clip received: bookmark=... camera=north bytes=406103 bookmarkOffsetInClip=4.21s header=1a45dfa3 (looks like valid WebM)
```

- `header=1a45dfa3 (looks like valid WebM)` — the clip starts with a real EBML
  header. Anything else means the init segment isn't being prepended.
- `bookmarkOffsetInClip` — where the bookmarked instant sits inside the clip.
  It should be roughly the keyframe lead-in (a few seconds), and it is the
  position the referee page seeks to.

The camera page's own log also reports what it built, e.g.
`uploaded clip 476KB — 19 clusters, recording time 80775-85844ms (keyframe
lead-in 2710ms)`. If that says `no usable footage`, the bookmark window had
already rolled out of the 20s buffer.

If a tile still fails, the video element reports decode errors in the tile's
label and in the referee page's browser console rather than failing silently.

## Troubleshooting: camera page says "UNSUPPORTED CONTAINER"

The clip builder understands WebM only. If a browser's `MediaRecorder` hands
back fragmented MP4 instead (Safari does this), the page says so loudly and
stops producing clips rather than uploading files that cannot decode. Slicing
fMP4 needs different surgery — whole `moof`/`mdat` fragments with
`baseMediaDecodeTime` rewritten — which is not implemented. **This is the main
untested risk on iPhone**; check the `using mimeType:` line in the camera
page's log first thing when testing on iOS.

## Verifying without phones

`spike/test/` drives real headless Chromium instances against the running
server, replacing the camera with a canvas that renders a clock driven by a
shared epoch — so every fake camera shows the same time at the same real
instant regardless of when it started recording. The clock is also drawn as a
binary bar that `ffmpeg` reads back out of the decoded clip, so the harness
asserts rather than asking you to eyeball a screenshot.

```
cd spike/server && npm start     # in one terminal

cd spike/test
npm install
npx playwright install chromium  # once, downloads the browser it drives
npm test
```

`npm test` runs two cameras staggered 9s apart and taps one bookmark on the
first; `npm run test:single` runs one camera with bookmarks at 8s, 45s and 85s
(the case that used to fail). Both check that each clip, seeked to its reported
bookmark offset, shows the moment the bookmark was actually tapped — and that
the angles agree with each other. A run ends in `PASS` or `FAIL`, and drops a
screenshot of the referee page in `spike/test/referee.png`.

Typical healthy output:

```
  ok   north: clip shows 40.15s at its bookmark offset 2.21s (drift -101ms)
  ok   east: clip shows 40.10s at its bookmark offset 3.06s (drift -151ms)
  ok   cross-camera spread: 50ms across 2 angles
```

The consistent ~100ms negative drift is tap-to-broadcast latency plus frame
quantisation, not error accumulation. Note this exercises the pipeline, not
the phones — it says nothing about Wake Lock, screen lock, or iOS.

## Test protocol — what we're actually checking

- [ ] **Continuous recording**: leave a phone recording for 3–5 minutes
      (typical bout length). Does the camera preview / recording ever
      silently die?
- [ ] **Screen lock**: lock the phone's screen mid-recording. Does Wake Lock
      keep it alive, or does recording stop?
- [ ] **App switch**: switch to another app and back mid-recording. Does the
      stream survive?
- [ ] **Weak/dropped Wi-Fi**: step out of range briefly, come back. Do
      buffered bookmarks still upload once reconnected, or are they lost
      silently?
- [ ] **Cross-camera sync**: with two phones running, tap bookmark and check
      whether the two clips actually show the "same moment" using nothing but
      the timestamp-offset sync — good enough for refereeing, or noticeably
      off? (Headless, on one machine, this measures ~50ms between angles;
      real phones on Wi-Fi will be worse, since each phone's clock offset is
      estimated over the network.)
- [ ] **iOS specifics** (this is the known risk area): test on the iPhone
      13 mini first — **which mimeType it picks** (if it is MP4 rather than
      WebM, clip building will refuse outright — see the UNSUPPORTED CONTAINER
      note above), whether Wake Lock is honored, whether screen-lock kills the
      stream despite it.

## Success / failure read-out

- **Success** → recording survives a full bout, Wake Lock prevents
  screen-lock kills, bookmarked clips arrive reliably, and timestamp sync
  looks close enough. We proceed to build the real Angular MVP on this same
  architecture (local buffer + broadcast-triggered burst upload).
- **Failure** → if screen-lock/backgrounding reliably kills the stream
  despite Wake Lock, that's the signal to wrap the camera page in Capacitor
  before building further, rather than fighting the browser.

## Explicitly out of scope here

No Angular, no styling polish, no auth, no database (clips are just files on
disk), no bout/session management, no multi-bout support, no export, no
audio-based sync. This code is meant to be thrown away once it's answered the
question above.
