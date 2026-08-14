# VideoReferee

Several phones film a bout from different angles. Anyone taps **BOOKMARK** when
they see something worth a second look. The hub cuts every camera's footage to
that same instant, and the referee reviews the angles side by side.

Everything runs on one laptop on the venue's Wi-Fi. Nothing goes to the internet.

---

# Running it at an event

## What you need

- **A laptop.** Windows, Mac or Linux. This is the hub.
- **Node 20 or newer.** Check with `node --version`. If that command is not
  found, install it from [nodejs.org](https://nodejs.org/) and reopen the
  terminal.
- **The phones**, one per angle, each with a working camera.
- **One Wi-Fi network** that the laptop and every phone are on. It does not
  need internet — only the laptop and the phones talking to each other. Guest
  networks that isolate devices from each other will **not** work.

## Once per laptop

Open a terminal in the project folder and run:

```
npm install
```

Needs internet. Takes a minute. You never do this again unless you move to a
different laptop.

## Every time you run an event

**One command:**

```
npm start
```

It checks everything before starting, and says what it is doing:

1. Installs the operator screen's dependencies, if they are missing.
2. Makes a certificate, if there is none or if it does not cover this network.
3. Builds the operator screen, so what you see matches the code you have.
4. Starts the hub.

When it is ready it prints something like:

```
  VideoReferee 0.0.13

  Operator  https://192.168.1.3:3000/
```

**Leave that terminal window open for the whole event.** Closing it stops
everything.

## Setting up the cameras

1. **On the laptop**, open the address it printed — the `https://192.168.1.3:3000/`
   one, not `localhost`.
   - Your browser will warn that the connection is not private. This is
     expected: the certificate is one the laptop made for itself. Click
     **Advanced → Proceed**. Once per browser.
2. **Add a camera** on the **Cameras** tab. Name it after **the person holding
   it** — "mike", not "north". Mid-bout you will be looking for a person, not a
   compass point.
3. A **QR code** appears. Scan it with that phone.
4. **On the phone:**
   - Accept the same certificate warning. Once per phone.
   - Allow camera and microphone access when asked.
   - The preview shows **"Getting ready…"** with a countdown. The phone needs
     about 20 seconds of footage buffered before it can answer a bookmark
     properly, so **BOOKMARK stays greyed out until it is ready.** This is
     normal. Wait for it.
5. **Prop the phone up** where it can see the fighters, and leave the page open.
   Do not let the screen lock, do not switch apps.
6. Repeat for each angle. The laptop shows each camera going amber
   ("warming up") then green.

## During the bout

Work on the **Bookmarks** tab. The list is down the left; whichever one you pick
fills the rest of the screen.

- **Anyone taps BOOKMARK** on any phone when they see something — or the
  **BOOKMARK** button at the top of the list, if you are at the laptop. *Every*
  camera answers, not just the one that noticed.
- Each bookmark appears in the list with a coloured dot:
  - **yellow, pulsing** — still collecting footage
  - **white** — every clip is in, waiting for you to look
  - **red / blue / purple / grey** — you decided
- **Click a bookmark** to review it. Drag the slider, step frame by frame, or
  play all angles together — the controls are along the bottom.
- **Mark state…** at the end of that bar records what you decided. It is never
  disabled: if a phone has died, decide anyway.
- When you have dealt with a passage of fighting, press **"Mark N done"** at the
  foot of the list to clear the rest, and carry on.

## When something is wrong

| What you see | What it means | What to do |
|---|---|---|
| A phone cannot open the QR link at all | It is on a different network, or the network isolates devices | Put it on the same Wi-Fi. Try a phone hotspot from the laptop if the venue's Wi-Fi refuses. |
| "Your connection is not private" again, on a phone that worked before | The laptop's address changed, usually a different Wi-Fi | Accept it again. `npm start` will already have made a matching certificate. |
| The laptop page works but no phone can join | You opened the hub at `localhost` — but the QR then points each phone at *itself* | Open the `https://192.168.<something>:3000/` address instead. |
| BOOKMARK is greyed out | The phone has not buffered enough footage yet | Wait for the countdown. |
| A camera shows "not responding" | The phone's screen locked, or it left the Wi-Fi | Wake it and reopen the page. |
| An angle stays dark with a line of text on it | That clip did not arrive, and the text says why — the hub keeps asking for about 20 seconds before giving up | If it says the phone could not send it, check that phone is awake and on the Wi-Fi. The wording travels in the saved session, so it is worth saving one. |
| The screen looks older than the code you pulled | The operator screen was not rebuilt | Use `npm start`, not `npm run start:hub`. |
| Anything odd you want looked at | — | **Session menu → Save session to a file**, before touching anything else. That file contains the clips and every number behind them. |
| A clip that came out wrong — misaligned, starting in the wrong place | — | The hub kept what it cut it from, in `captures/`. Send the newest pair of files from there along with the session. |

## When the Wi-Fi changes

Stop the hub (Ctrl-C), run `npm start` again. It notices the new address and
makes a certificate for it. Every phone will ask you to accept it once more, and
the QR codes from before are stale — add the cameras again.

---

# Working on it

## Commands

| Command | What it does |
|---|---|
| `npm start` | The checked path above. Use this at an event. |
| `npm run start:hub` | The hub alone — no checks, no rebuild. For iterating on hub code. |
| `npm test` | The unit tests. Fast, no browser. |
| `npm run test:watch` | The same, on every save. |
| `npm run typecheck` | TypeScript, no emit. |
| `npm run build:operator` | Install and build the operator screen by hand. |
| `npm run gen-cert` | Make a certificate by hand. |
| `npm run replay -- captures/<file>.json` | Re-run a bookmark the hub already answered, from what it answered with. |

## The one thing that will confuse you

The operator screen is a **separate Angular project** under `web/operator`, and
its built output is not in git. `npm run start:hub` serves whatever was last
built — so if you change something under `web/operator/src` and use
`start:hub`, **you will not see your change**. Either use `npm start` or run
`npm run build:operator` yourself.

The camera page (`web/camera/`) has no build step and is always current.

## Settings

`config.json` at the root, grouped by what you are changing — see
[docs/config.md](docs/config.md). Restart the hub after editing, and **reload
the camera pages**: a phone reads its settings once, before it starts recording.

## Where things are

```
src/core/      pure logic, no IO — clip cutting, clock offsets, bookmarks
               this is where the tests live
src/hub/       the HTTPS server: moves bytes, holds state
captures/      what each clip was cut from, newest uploads kept (gitignored)
web/camera/    the phone page — plain JS, no build
web/operator/  the operator screen — Angular, separate npm project
tools/         start, certificate generation, fixture recording
docs/          architecture, settings, backlog, the test list
```

The rule that keeps it testable: **the phone reports observations, the hub draws
every conclusion.** See [docs/architecture.md](docs/architecture.md).

## How work is divided

Every change is exactly one refactor, bugfix or development — never a mix — with
an `R:`/`B:`/`D:` commit, a patch version bump and a line in
[CHANGELOG.md](CHANGELOG.md). See `.claude/skills/chunks/SKILL.md`.

Known issues and everything deliberately deferred:
[docs/BACKLOG.md](docs/BACKLOG.md).
