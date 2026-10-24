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
  top over everything. In the Windows, Mac and Linux apps the title bar is
  the window's (on a Mac the traffic lights hide and macOS 26's toolbar comes
  off; on Linux the window opens again without its frame).
- `menus`: the menu bar's menus by name (`Themes.MENUS`). In the Mac app
  they're in the Mac's menu bar too; `systemMenus` names a theme's menus
  for there when it has none in the window (Snow Leopard).
- `variants`: each `{ id, name, mode: 'light' | 'dark', swatch, css }`; the
  stylesheets load in order, so a variant is the base plus one more.
- `settings`: its own options, `{ id, label, help, options, default }`,
  shown under the gallery and set on `<html>` as `data-ts-<id>`.
- A preview for the gallery: `<theme>/preview-<variant>.jpg`, 320 × 200.

Things a stylesheet can write in, kept up to date by `Themes.facts()`:
`#fb-crumbs[data-folder]`, `#fb-crumbs[data-items]`, `#folder-bar[data-info]`,
`#btn-clear-selection[data-total]`, `#selection-count[data-n]`, and each
grid tile's `data-name`.

## Every part of the app

A theme dresses all of jEditor, not only the photos: the dialogs and
Settings, Crop, Adjust and Paint, the scan window, the menus and notes.
Each theme keeps three kinds of file: its look for the main window
(`luna.css` + `office.css`, `finder.css`), `controls.css` (buttons, fields,
check boxes, sliders, dialogs, Settings, the small panels, the start page,
the scan window) and `modes.css` (Crop, Adjust, Paint, Duplicates).

`docs/themes-checklist.md` lists every part in every theme, what's done
and what's wrong. `node design/themes/audit.js` writes it: run it after
changing a theme, and tick what it can't check by hand.

## Bundled, and their licences

- Tahoma (`xp/fonts`): Wine's, LGPL 2.1.
- ChicagoFLF (`mac84/fonts`): public domain (Robin Casady).
- Icons in `xp/icons`: from the Tango icon library, public domain (folders
  recoloured); `crop.svg`, `grid.svg`, `autocrop16.svg`, `more16.svg`,
  `prev16.svg`, `next16.svg` and the PNGs for the other toolbar buttons
  (`design/themes/px_xp.py`) drawn for jEditor. `xp/tools`: Paint's tools,
  drawn for jEditor (`px_xp.py`).
- `snow/glyphs`, `snow/icons`, `mac84/px`, `mac84/icons`, `mac84/tools`:
  drawn for jEditor (`design/themes/px.py` draws the one-bit ones,
  `glyphs.py` the newer Snow Leopard glyphs).
