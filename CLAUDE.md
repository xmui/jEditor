# jEditor: notes for Claude

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
