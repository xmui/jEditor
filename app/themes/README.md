# Themes

jEditor as a native app of another time (Settings → Appearance; PLAN.md,
item 8). One app, one layout: a theme is stylesheets over it. `app/themes.js`
lists the themes, puts the chosen one on and draws its parts.

## A theme

An entry in `Themes.LIST` (`app/themes.js`):

- `skin`: `data-skin` on `<html>`. Every rule in its stylesheets is scoped to
  it, `:root[data-skin="xp"] …`, so nothing leaks into jEditor's own look.
- `layout: 'docked'`: `docked.css` lays the floating bars along the window's
  edges, as desktop apps were. Grid areas: title, menu, tools, addr, tasks,
  side, main, resize, strip, bot, status.
- `title`: the title bar's wording, `'windows'` ("Photo.jpg - jEditor") or
  `'mac'` (the name). The title bar (`#th-titlebar`: `.th-appicon`,
  `.th-title`, `.th-caps` with `.th-min`, `.th-max`, `.th-close`) and the
  menu bar (`#th-menubar`, `.th-menu` buttons) go in `#th-top`, along the
  top over everything. In the Windows app the title bar is the window's.
- `menus`: the menu bar's menus by name (`Themes.MENUS`).
- `variants`: each `{ id, name, mode: 'light' | 'dark', swatch, css }`; the
  stylesheets load in order, so a variant is the base plus one more.
- `settings`: its own options, `{ id, label, help, options, default }`,
  shown under the gallery and set on `<html>` as `data-ts-<id>`.
- A preview for the gallery: `<theme>/preview-<variant>.jpg`, 320 × 200.

Things a stylesheet can write in, kept up to date by `Themes.facts()`:
`#fb-crumbs[data-folder]`, `#fb-crumbs[data-items]`, `#folder-bar[data-info]`,
`#btn-clear-selection[data-total]`, `#selection-count[data-n]`, and each
grid tile's `data-name`.

## Bundled, and their licences

- Tahoma (`xp/fonts`): Wine's, LGPL 2.1.
- ChicagoFLF (`mac84/fonts`): public domain (Robin Casady).
- Icons in `xp/icons`: from the Tango icon library, public domain (folders
  recoloured); `crop.svg`, `grid.svg`, `autocrop16.svg`, `more16.svg`,
  `prev16.svg` and `next16.svg` drawn for jEditor.
- `snow/glyphs`, `snow/icons`, `mac84/px`, `mac84/icons`: drawn for jEditor
  (`design/themes/px.py` draws the one-bit ones).
