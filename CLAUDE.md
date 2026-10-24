# jEditor: notes for Claude

## What jEditor is

**Three apps in one, and easy to use.**

1. A simple, handy photo viewer and editor, like Preview on the Mac (Photos mode: look, rotate, crop, flag, rename, move on).
2. A photo editor like Lightroom (Adjust mode).
3. A Photoshop/Paint app (Paint mode).

**The rule above all others:** it must be intuitive, with never too much on the screen. Each mode shows only what it needs. Extra controls go in menus and right-click menus, not on toolbars. A new feature has to fit without adding clutter; when in doubt, show less. Make mockups and let the owner choose before big layout changes.

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
`photos`, `adjust`, `paint`, `theming` (the look, themes and UI/UX),
`bugs` and `wrangler` (who's doing what; builds nothing). When the owner
says "be the Photos agent" (or names any of them), read that file and
work as it says. With no role given, work as usual.

- Each agent stays in its own files (listed in its file). Files every
  mode shares (`app/index.html`, `app/style.css`, `app/host.js`,
  `app/edits.js`, `app/history.js`, `src/`, `mac/`) are fine to change,
  but check the open PRs first and keep the change small.
- Work on your own `claude/...` branch, started from `beta`, with a PR
  into `beta`. Before starting, look at the open PRs. If one already
  changes the files you need, say so to the owner rather than racing it.
- When a feature touches another mode, ask the owner
  first, and say in the PR which mode it touches.
- A change to what's on screen (a new panel, toolbar, button or layout)
  gets the theming agent's check (`.claude/agents/theming.md`) before
  its PR is done. Small fixes don't.
