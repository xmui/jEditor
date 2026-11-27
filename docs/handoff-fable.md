# Handoff: the 2.0 visual refinement

For the agent leading jEditor's 2.0 visual refinement (Fable). Written by the
Wrangler on 2026-11-12. Read `CLAUDE.md`, `PLAN.md` and
`.claude/agents/theming.md` first. Those hold the product rules and the
owner's taste; this page says where things stand and what's already decided.

## The job

Refine jEditor into a more cohesive, polished, intentionally designed app.
**This is refinement, not reinvention.** It covers:

- the overall visual identity;
- type and hierarchy;
- colours and design tokens;
- spacing and layout consistency;
- the sidebar and navigation;
- photo browsing (the grid and the viewer);
- Adjust's editing flow and Paint's interface;
- buttons, dialogs, menus and inputs;
- icons;
- motion and interaction feedback;
- responsive behaviour where it makes sense.

How to work:

1. Look over the app as it is (`npm start`, or the latest Windows beta) and
   learn its design language before proposing anything.
2. Ask the owner only questions whose answer changes the design.
3. Bring a **short design proposal**, with mockups, as the owner prefers:
   real app screenshots with mockup CSS, in an Artifact. Then **wait for
   the owner's OK** before building.
4. Build it on your own `claude/...` branches from `beta`, with PRs into
   `beta`, then do visual QA in the light and dark appearances, on Windows
   and the Mac.

Rules that stay: never too much on screen; extra controls go in menus and
right-click menus; the desktop apps (Windows, Mac, Linux) come first; the web
is lighter and needn't match.

## Already decided: build these as approved

### The docked sidebar (A2): a fixed requirement

Approved by the owner on 2026-11-09. **Build it as designed; don't
substitute or reinterpret it.** Design and mockups: the *Docked Sidebar
Takes* Artifact, https://claude.ai/artifact/HpMTiv1RSpjyHoji6f2Us5 (its
"Chosen" and "Latest" sections). It's also recorded in `PLAN.md`.

- **A2:** docked against the window's left edge, full height, a quiet tint
  (vibrancy on the Mac), small grey headings, compact 28 px rows with small
  grey icons.
- **Photo counts and Recents:** small grey counts at the right of each row;
  Recents lists the last projects (the open one is the heading, not in the
  list), then Show all….
- **The project picker with search (S1):** the project's name at the top is
  a picker (⌄). It opens with the cursor in "Find a project" and Recents
  first, then All projects…, New project… and Open a folder….
- **Free space on the drives (D2):** a thin bar with "free" under each
  drive's name, red under a tenth left, and the full figure in the tooltip.
- **The small Photos · Adjust · Paint switch**, with no tray behind it.
- **Right-click Rename… in place**, on the heading and on projects in
  Recents and the picker. Recents follow the renamed project, and the
  "Renamed" message has Undo.

**Most of it is already built**, on the branch `claude/docked-sidebar`
(commit 5932028, from `beta` at 93d953e; no PR). Done there:

- the docked layout and the mode switch;
- S1, Recents and D2;
- Rename in place, with Recents following and Undo;
- the sidebar staying beside the photo in the viewer;
- the tour's stops and the guide section.

Left to do:

- **2 web UI tests fail:** the narrow-window pills at 480 px with the
  sidebar open, and the huge folder's windowed grid, off by a pixel or two;
- the Mac suite hasn't been run;
- the changelog line and the PR.

Start from that branch (merge `beta` into it first) rather than from scratch.

### Find anything (Ctrl+K)

`app/palette.js`. Keep its dialog presentation and how it works. It stays in
jEditor's own dialog look, and the refined dialogs should carry it along.

### The style tour

`app/tour.js` and the F1 guide `app/guide.js`. The tour should end up showing
the refined design language: colours, type, spacing, buttons, dialogs,
navigation and the new sidebar, with its stops updated for the sidebar.

### Themes: come back after the refinement

The owner paused the themes (Windows XP Royale, Snow Leopard, 1984). They're
under Settings → Experimental, off by default (#166). **Once the refinement
is done, they come back, dressed to match the refined look.** Until then,
build and check in jEditor's own look only; just make sure nothing breaks
with the experiment turned on. Theme files: `app/themes.js`, `app/themes/`,
`design/themes/` and `docs/themes-checklist.md`; the audit's latest checklist
is on the branch `claude/themes-checklist`.

### Not part of this phase

**Paint on phones and tablets** (PLAN.md):

- touch-sized controls;
- pinch to zoom and two-finger pan;
- palm-safe painting;
- a compact tool bar;
- layers and colours in a sheet.

It's a separate project, with its own mockups first. Don't let it grow this
phase.

## The engine work happening alongside

The 2.0 engine update (the owner's "Figma plan") goes on at the same time:

- **Plans:** #167 (the fast engine) and #165 (moving the Mac and Linux
  apps to Tauri; waits for the engine's numbers).
- **The engine:** written in Rust and runs natively in the desktop apps,
  on the GPU through wgpu. The web keeps today's code.
- **Phase 1** (#168): the Windows app's grid JPEG thumbnails come from the
  engine (feature `engine`), with HEIC, RAW previews and the viewer next.
  Then Export, Save edits and Detail at full size, then Adjust without its
  2560 px cap, then Paint.

**What it means for the interface:**

- The page's own markup, CSS and layout don't change. The engine only
  changes where pixels come from (thumbnails and previews over the app's
  `jimg://` scheme), with today's JavaScript as the fallback, so the
  refinement works the same with the engine on or off.
- The plan notes that the grid's resize jank and the back-to-grid stutter
  are the page's own layout work (DOM, long tasks), not the engine's.
  They're worth fixing as part of the grid's refinement.
- Avoid editing `app/develop.js`, `app/export.js` and the grid's thumbnail
  code (`app/script.js`) while the engine's PRs are open. If you need to,
  say so to the Wrangler first, so the two don't collide.

Where the engine lives, and how it's built and tested: `docs/developing.md`
→ Engine (added in #168).

## Where the interface lives

| What | Files |
|---|---|
| Shared look, tokens, layout | `app/style.css`, `app/index.html` |
| Sidebar | `app/places.js` |
| Modes and the switch | `app/modes.js` |
| Home page, Open a folder card | `app/script.js`, `app/open-card.js` |
| Find anything | `app/palette.js` |
| Tour and guide | `app/tour.js`, `app/guide.js` |
| Adjust, Paint | `app/adjust.js`, `app/develop.js`, `app/paint-editor.js` |
| Glass, motion | `app/liquid.js`, `app/motion.js` |
| Mac top bar | `--top-safe`, `--lights-w` (#163), `mac/` |

`docs/using-jeditor.md` ends with a code map.

## Builds and tests

- **Tests:** `npm test` (parity, themes, bridge, native, UI, edit), plus
  `xvfb-run -a npm run test:mac` for the Mac and Linux app.
- **Builds:** each PR builds and tests Windows. Add the `build:mac` label
  when the Mac needs checking (the sidebar does: traffic lights, vibrancy).
- **Mergeable:** `beta` passed CI after #166, which put themes under
  Experimental.
- **Cloud containers:** in some, the browser suites crash partway through
  (Chrome 153 there). If that happens, use CI as the reference.

## Who's who

- **The Wrangler** coordinates and merges into `beta`; send PR links there.
- **The fast engine chat** owns `engine/` and the engine PRs.
- **The Photos, Adjust and Paint agents** own their modes. A refinement PR
  that touches a mode says so.
- **No release or version bump without the owner's word.** 2.0.0 is
  released only after both the engine work and the refinement are done.
