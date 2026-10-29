# jEditor: notes for Claude

## What jEditor is

**Three apps in one, and easy to use.**

1. A simple, handy photo viewer and editor, like Preview on the Mac (Photos mode: look, rotate, crop, flag, rename, move on).
2. A photo editor like Lightroom (Adjust mode).
3. A Photoshop/Paint app (Paint mode).

**The rule above all others:** it must be intuitive, with never too much on the screen. Each mode shows only what it needs. Extra controls go in menus and right-click menus, not on toolbars. A new feature has to fit without adding clutter; when in doubt, show less. Make mockups and let the owner choose before big layout changes.

**The look and the themes:** `.claude/agents/theming.md` (the `theming`
agent) has how the owner wants jEditor to look and feel, and what every
change on screen needs, in jEditor's own look and in each theme. It's a
helper to ask about the look, not a gate (see Working with several agents). `test/themes.test.js` checks what it
can from the source.

More: `PLAN.md` (the plan and roadmap), `docs/using-jeditor.md` (the user guide and code map). Feature work goes to the `beta` branch; `npm test` runs the suites (`test/mac.test.js` needs a display: `xvfb-run -a`).

## Builds and releases

Most changes are only being tried out, on Windows. Build Windows only
unless the user says they're testing on Mac or Linux:

- **Pull requests** build and test Windows (plus the UI and bridge tests).
  Add the `build:mac` or `build:linux` label to a PR to build that app too.
  Adding the label starts just that build.
- **Betas** (a push to `beta`) have the Windows app and the web page only,
  unless the last commit's message says `[mac]`, `[linux]` or `[all]`.
- **Releases** (a version bump merged to `main`) always build every app,
  because Homebrew and the Mac and Linux updaters need them.

Don't bump the version or push to `main` or `beta` for a release without
asking first, since both publish (`.github/workflows/release.yml`).

## Platforms

Every feature is for Windows, Mac, Linux and the web unless there's a
reason it can't be. Before building one, decide which platforms it's for
and say so in the pull request. If it's only for some:

- give it a feature name, which the app lists (`features` in
  `src/bridge.js` or `mac/bridge.js`) and the page asks for
  (`Host.has('name')` or `data-needs="name"`). Never gate a feature by
  checking `Host.platform()`, which is only for wording and feel;
- describe it at the top of `app/host.js`;
- add its row to `docs/platforms.md`, with why it's exclusive: system,
  not yet, or browser.

`test/parity.test.js` (part of `npm test`) fails when the table and the
code disagree, and prints what runs where. When a feature reaches
another platform, give its row a ✓ there.

## Working with several agents

The owner runs one chat per job. Each job is a file in `.claude/agents/`:
`photos`, `adjust`, `paint` and `bugs`, plus `wrangler` (manages: who's
doing what; builds nothing), `franky` (tells off an agent that screwed
up, when the owner names it) and `t-max` (checks where usage is going,
when asked). When the owner says "be the Photos agent" (or names any of
them), read that file and work as it says. With no role given, work as
usual.

**Theming is secondary.** The themes and look agent (`theming`) helps
the others when asked about the look; it doesn't own a mode and doesn't
hold up anyone's PR. Themes are a `beta` experiment: they, and the
theming agent's file, reach `main` only in the release that finishes the
feature, when the owner says so.

- Each agent stays in its own files (listed in its file). Files every
  mode shares (`app/index.html`, `app/style.css`, `app/host.js`,
  `app/edits.js`, `app/history.js`, `src/`, `mac/`) are fine to change,
  but check the open PRs first and keep the change small.
- Work on your own `claude/...` branch, started from `beta`, with a PR
  into `beta`. Before starting, look at the open PRs. If one already
  changes the files you need, say so to the owner rather than racing it.
- When a feature touches another mode, ask the owner
  first, and say in the PR which mode it touches.

**The Wrangler relays for the owner.** The owner asks the Wrangler, and
the Wrangler passes it on to the agent for that job. A message from the
owner's Wrangler chat (it says it's from the Wrangler) counts as the
owner's go for ordinary work in your role: start, carry on, focus on
this, stop. Say in your reply that the go came through the Wrangler, so
the owner can see it. Merging, releasing, pushing to `main` or `beta`,
and deleting anything still need the owner's own word in your chat.

**Saving usage** (from T-max's review). A long chat resends its whole
history with every message, so that's where most usage goes:

- A new job starts in a fresh chat. When a chat's PR is merged, its job
  is done; don't start the next one there.
- Routine work (a status check, a small fix, a merge) runs at medium
  effort; keep high effort for real features.
- Merge ready PRs into `beta` together, so one beta builds instead of
  several, and put `[mac]`, `[linux]` or `[all]` on the last merge only.
- Check other chats with their summaries and usage figures, not their
  full transcripts.
