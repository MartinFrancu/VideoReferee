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
  and clicking one shows all received angles side by side.

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
      off?
- [ ] **iOS specifics** (this is the known risk area): test on the iPhone
      13 mini first — mimeType picked, whether Wake Lock is honored, whether
      screen-lock kills the stream despite it.

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
