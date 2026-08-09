---
name: tdd
description: The TDD working agreement for this repo — red/green/refactor discipline, the test list protocol, batch size, and when to stop and ask. Use whenever writing or changing code in src/, and whenever adding or reordering tests. Follows tdd.mooc.fi.
---

# TDD in this repo

Sits inside the chunk scheme — see the `chunks` skill for which of R/B/D a piece
of work is, and what tests are expected to do in each. This file is the loop
used within one.

Based on [tdd.mooc.fi](https://tdd.mooc.fi/). The rules there are written for a
human who feels friction. An agent does not feel friction, so this file adds the
checkpoints that make the friction visible anyway.

## The three laws

1. Do not write production code unless required by a failing test.
2. Do not write more of a test than is required to fail.
3. Do not write more production code than is sufficient to pass the one failing test.

## The loop, with the checkpoints that matter

For each item taken from `docs/TESTLIST.md`:

1. **Write one test.** Name it as a sentence about behaviour, not about the
   implementation. The bar: *if all production code vanished, could someone
   rebuild it from the test names alone?*
2. **Run it and read the failure.** Predict how it will fail first, then check the
   prediction. **Paste the failure output into the conversation.** This is not
   ceremony — it is the only thing separating a real test from one that asserts
   nothing, and asserting nothing is the single most common way an agent's test
   suite goes green while the code is broken.
3. **Make it pass, minimally.** Hardcoding is allowed and often correct. Let the
   next test force the generalisation (triangulation).
4. **Refactor** while green — remove duplication, improve names. Never change
   behaviour and structure in the same step.
5. **Commit.** One test-plus-implementation per commit where practical, so the
   history reads as the sequence of decisions.

## Batch size

Work in batches of **three to five tests**, then report. Not one — that makes the
human a bottleneck on trivia. Not a whole feature — that loses the design
feedback, which is the entire point.

**Exception: the first batch against any new module is one or two tests.** The
shape of a new interface is the expensive thing to get wrong, and it is cheapest
to correct before there are five tests pinning it in place.

## Stop and ask when

- A **public interface** would change, or a new module would appear. Design
  decisions belong to the human.
- A test needs **disproportionate setup** — more than ~10 lines, or more than one
  test double. Report it as a design smell rather than absorbing it. *This
  replaces the annoyance a human would have felt.* Say what was awkward and what
  the design might want instead; do not silently write the awkward test.
- A test would be **deleted or weakened** to get to green.
- The `## Now` section of the test list runs dry.
- More than a few minutes of thrashing: prefer `git reset --hard` and smaller
  steps over pushing through.

## The test list

`docs/TESTLIST.md` is the working artifact, and it lives in the repo rather than in
a conversation because conversations end and sessions lose context.

- `## Now` — ordered, the next handful. The human sets this order.
- `## Later` — unordered, everything noticed along the way. Add freely; noticing a
  case mid-loop and writing it down is how the list stays honest.
- `## Done` — append-only.
- `## Design smells` — the reports from the rule above, so they accumulate visibly
  instead of being mentioned once and forgotten.

Update the list in the same commit as the work.

## What good tests look like here

- **Sensitive to behaviour, insensitive to structure.** A test that breaks when a
  function is renamed but not when the answer changes is a liability.
- **One thing per test. One failing test per bug.**
- **No sleeps.** Poll or await an event. A sleep is either flaky or slow, usually
  both.
- **Only fake what we own.** Do not mock `MediaRecorder`, the filesystem, or a
  socket — put our own seam in front of it and fake that.
- **Time is a parameter, never a global.** Nothing in `src/core/` calls
  `Date.now()` or `performance.now()`; the caller passes the instant in. This is
  what makes the alignment logic deterministic.

## Levels, and where to spend effort

Most of the value lives in the first level:

- **Unit — `src/core/`.** Pure functions, no IO. Container parsing, keyframe
  detection, timestamp rebasing, clock-offset maths, bout state. Fast, deterministic,
  fixture-driven. This is where TDD actually runs.
- **Integration — `src/hub/`.** Real hub, fake cameras that replay committed
  fixture recordings. No browser needed. This is possible *because* phones are dumb
  (see INV-2, INV-3 in `docs/architecture.md`) — protect that property.
- **End-to-end — Playwright.** Real browsers, fake camera streams. **Cap at ~10
  total.** They are the only tests that can catch "the wire is wrong", and they are
  too slow and flaky to carry the suite.

## Fixtures

Committed recordings under `fixtures/`. Generate new ones with
`tools/make-alignment-fixtures.mjs`, which burns a shared-epoch clock into the
video as digits and as a machine-readable binary bar — so a test can assert
*which instant* a decoded frame shows, not merely that decoding worked.

Keep fixtures small (a few seconds), and record what each one is for in a
`fixtures/README.md` — an unexplained binary blob is worse than no fixture.

## The failure modes this file exists to prevent

Three things go wrong when an agent runs this loop unsupervised. If a batch feels
smooth, suspect one of these:

1. **Skipping red.** Writing test and implementation together, then running once.
   The test may assert nothing and nobody would know. Mitigated by step 2.
2. **Over-implementing.** Writing the general solution because it is obvious,
   which discards the design pressure that makes the next test easy to write.
   Mitigated by law 3 and small batches.
3. **Absorbing pain.** Cheerfully writing 40 lines of setup instead of treating
   that as the design telling us something. Mitigated by the stop-and-ask rule.
