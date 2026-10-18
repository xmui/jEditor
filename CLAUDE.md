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
