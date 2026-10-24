---
name: theming
description: jEditor's look, themes and UI/UX. Use for any change that adds or changes something on screen (a button, window, panel, menu, canvas overlay, message), to make it fit the owner's taste and to make it work in jEditor's own look (dark, light, densities, glass, accent, each platform) and in every theme (Windows XP Royale, Snow Leopard, 1984). Also use to review another branch's or pull request's UI.
---

You look after how jEditor looks and feels. Read `CLAUDE.md`, then
`app/themes/README.md`, before changing anything. New UI should feel as if
it was always there, in jEditor's own look and in every theme.

## How the owner wants it to look and feel

What the owner has chosen so far (`PLAN.md`, the changelog, their picks
between mockups). Keep to it, and add to this list when they decide
something new.

- **Intuitive, and never too much on the screen.** Each mode (Photos,
  Adjust, Paint) shows only what it needs. Extra controls go in menus and
  right-click menus, not on toolbars. A new feature fits without adding
  clutter. When in doubt, show less.
- **The photo comes first.** The photo and the colour behind it stay solid.
  Glass is for the controls, never the photos, and doesn't bend what's
  under it: nothing may throw off someone judging colour. Labels drawn on a
  photo are dark in every theme (`--on-photo-*`).
- **Always readable.** Text over glass keeps 7:1, secondary text 4.5:1, over
  a pure white and a pure black photo. Reduce transparency, Increase
  contrast and Glass: off make it solid.
- **Calm.** Short, quiet transitions (`--dur-*`, `--ease-*`), nothing that
  bounces for show. Reduced motion means a plain fade or nothing.
- **It fits any window.** 800×600 with Comfortable density is the worst
  case. When room runs out: tighten, then drop icons and keep the words.
  Long words end in "…". A full toolbar wraps. Nothing goes off screen or
  spills out of its button.
- **Native on each platform.** Each platform's own words and keys (`⌘Z` on
  a Mac, Finder or Explorer or Files) and its own feel (Liquid Glass on
  macOS 26, Mica on Windows 11). Wording and feel come from
  `Host.platform()`; whether a feature exists comes from `Host.has()`.
- **Plain words.** Short and in sentence case, saying what it does: "Turn
  upright", "Find dust", "Move to…" (with "…" when it opens a window).
  Tooltips are "Name (key)". Match the words around it: Adjust's panels say
  Color, as photo editors do; everywhere else it's colour. What's New and
  the docs are written in the same plain voice.
- **Big layout changes: mockups first, and the owner picks.** Make them on
  the real app with real photos (hand-drawn boards looked cheap): two or
  three takes (A, B, C), screenshots side by side, a one-line pitch each.
  Don't build a big change before the owner has chosen.
- **Themes are jEditor as a native app of its time,** not a copy of
  another program. Same layout, every part rebuilt as that era's apps
  built it: XP Royale's Office 2003 command bars with grippers and its
  glass captions, Snow Leopard's Aqua capsules and sheets, 1984's
  round-rect buttons and one-bit icons on the pixel grid. Bundle the
  fonts (open licences only), draw icons for jEditor, and dress every part.
  Never leave a part in jEditor's own look inside a theme.

## For every change to what's on screen

1. **Tokens only.** Colours, sizes, radii, shadows, motion and layers come
   from `app/tokens.css`. A raw value is only for something that must look
   the same in every theme (a handle drawn on the photo, the transparency
   checkerboard, a hue wheel), with a comment saying so.
2. **jEditor's own look.** Check it dark and light, Comfortable density,
   Glass subtle and off, another accent colour, Reduce transparency,
   Windows' window background (`.backdrop`) and each platform
   (`data-platform`).
3. **Drawn on a canvas.** A canvas doesn't inherit CSS: read the tokens it
   needs, as `CropEditor.themeColors()` in `app/crop.js` does, including
   `--font-ui` for any text. `test/themes.test.js` fails on a fixed font.
4. **Every theme.** Rules go in each theme's files, scoped to its skin
   (`:root[data-skin="xp"] …`):
   - the main window: `xp/office.css`, `snow/finder.css`, `mac84/finder.css`
   - buttons, fields, dialogs, Settings, panels: `<theme>/controls.css`
   - Crop, Adjust, Paint, Duplicates: `<theme>/modes.css`
   - dark variants: Snow Leopard's Aperture (`snow/aperture.css`); XP's
     Noir and Red only recolour (`xp/noir.css`, `xp/red.css`)
5. **A new toolbar button** needs an icon and a label in each theme:
   - XP: `--ico` (16 px, `xp/icons/`, drawn by `design/themes/px_xp.py`)
     and `::after { content: "…" }` in `xp/controls.css`
   - Snow Leopard: `--g` and `--l` in `snow/controls.css`, plus a `-dark`
     glyph in `snow/aperture.css` (`snow/glyphs/`, `design/themes/glyphs.py`)
   - 1984: `background-image` in `mac84/controls.css` (`mac84/px/`, one
     bit, `design/themes/px.py`)
6. **A new command** goes in the theme menu bar (`Themes.MENUS` in
   `app/themes.js`) where a Windows XP or classic Mac app would have put it.
   In the Mac app those menus are in the Mac's menu bar too (Snow Leopard's,
   which has none in the window, by its `systemMenus`), so the command shows
   there with its key.
7. **A new screen or part** goes in the audit: `SCREENS` and `PARTS` in
   `design/themes/audit.js`. Run it, commit the updated
   `docs/themes-checklist.md`, and add what it can't check to the "Checked
   by hand" tables.
8. **Before pushing:** `node test/themes.test.js` (part of `npm test`), and
   screenshots (`SHOTS=dir node design/themes/audit.js <look> <screen>`) of
   the new part in jEditor's own look, dark and light, and in each theme.
   If the audit won't run, load the page under a stand-in host with
   `features: ['themes']` and choose the theme with `Themes.choose('xp/royale')`.

## Reviewing someone else's branch

Run `node test/themes.test.js` against it and read its CSS and canvas code
for the points above. Report what's missing, file by file, with the fix.
On a pull request you didn't open, tell the owner first rather than pushing.
