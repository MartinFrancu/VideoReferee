---
name: chunks
description: How work is divided in this repo — every change is exactly one refactor, bugfix or development chunk, never a mix, with an R:/B:/D: commit, a version bump and a changelog entry. Use before starting any change, when deciding what belongs in the current change, and when writing the commit.
---

# One chunk, one intention

Every change to this repo is **exactly one** of three things. Not two, not a
main thing with a bit of another mixed in.

| | What it is | The program afterwards |
|---|---|---|
| **R** | **Refactor** — different structure, same behaviour. Data structures, algorithms, naming, where code lives. | Does exactly what it did before. |
| **B** | **Bugfix** — we meant to build A and unknowingly built B, which looks almost like A. This is B → A. | Does what it was always supposed to do. |
| **D** | **Development** — a decision that the program should do more, less, or different. | Does something new, or stops doing something. |

The test to apply, in order:

1. **Would a user notice any difference?** No → **R**.
2. **Is the difference "it now does what we already intended"?** → **B**.
3. **Is the difference "we decided it should do something else"?** → **D**.

## Never mix

A bugfix with a little refactor in it, or a feature that tidies as it goes, is
two chunks pretending to be one. Split them and do them back to back — either
order, whichever is easier. Two commits, two version bumps, two changelog lines.

This is the rule that matters most, because mixing is what makes a change
impossible to review, to revert, or to remember afterwards.

## Say the type before starting, and hold the line

Before touching anything, say which of the three this is and what it covers.
Then **anything discovered along the way that belongs to a different type does
not go in.** It goes to `docs/BACKLOG.md`, or it becomes the next chunk, and it
is mentioned when reporting back.

That includes improvements that are obviously right. A tempting cleanup noticed
during a bugfix is still a refactor, and it still waits its turn.

If the type is not obvious from the request, **ask**. One question costs less
than a chunk of the wrong shape.

## What the tests do in each

- **R** — tests do not change. They are the evidence the behaviour did not.
  Adjusting a call site for a rename or a signature is fine; changing what a
  test asserts means this was not a refactor.
- **B** — write a test that fails for the reason the bug exists. Then fix it.
  The new test failing first is what proves the bug was real and understood.
- **D** — the usual see-saw: a test, then the code for it, sometimes a small
  refactor to make the next step easy. Ends with new tests and new code. See the
  `tdd` skill for the loop itself.

## Every chunk carries its own paperwork

1. **One commit**, subject starting `R: `, `B: ` or `D: `.
2. **Bump the minor version** in `package.json`, `package-lock.json`,
   `web/operator/package.json` and `web/operator/package-lock.json`.
3. **One entry in `CHANGELOG.md`**, under the new version, marked with the same
   letter.

## Edge cases, held lightly

The division is abstract and reality is not. Do not spend long agonising —
pick the honest answer and move on.

- **Docs, comments, tests alone.** No behaviour either way. Usually rides along
  with the chunk it describes. Standalone, treat as **R** — the program does
  exactly what it did.
- **Process and tooling** (this file, a script, CI). Not really any of the
  three. Label by what it does to the repo's behaviour; a working agreement like
  this one is **D**, because it changes what happens next.
- **Deleting something unused.** **R** if genuinely nothing observes it; **D**
  if a user could have reached it.
- **A behaviour nobody specified either way.** If you have to argue about
  whether it was intended, it is **D**. `B` is for cases where the intent is not
  in doubt.
- **Fixing a bug that was only introduced in this same session.** Still **B**,
  still its own commit. The history is for reading later, not for looking tidy.

## Why this exists

Two problems, both real, both from the early push for something that worked at
all: loose ends nobody is tracking, and changes that quietly do more than was
asked. One intention per chunk fixes both — there is nothing extra to lose track
of, and "more than expected" becomes visible as a chunk that does not match its
own label.
