# jEditor: notes for Claude

## Builds and releases

Most changes are only being tried out, usually on Windows. Before a change
goes out as a build (a release, a beta, or a PR whose builds will be used),
ask which platforms it actually needs (Windows, Mac, Linux, web) instead of
building every one. Don't bump the version or push to `main` or `beta` for
a release without asking first, since both publish (`.github/workflows/release.yml`).
