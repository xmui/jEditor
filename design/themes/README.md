# Theme prototypes

Stylesheets laid over the real jEditor to try themes before the theme system
is built (see PLAN.md, item 8). Nothing here is loaded by the app.

## Try one

    mkdir -p photos && for id in 10 15 17 28 29 37 42 54 57 64 76 82 91 102 110 129 137 152 164 177; do curl -sSL -o photos/p$id.jpg https://picsum.photos/id/$id/1600/1067; done
    VIEWS=grid WAIT=3500 node shot.js out/royale xp-royale

`shot.js <out> <theme folder>` opens the app with 20 photos, loads the theme
and writes `<out>-grid.png` and `<out>-photo.png` (VIEWS picks which). A
theme folder has `theme.css`, an optional `setup.js` and `theme.json`
(`layout`, `base`: the folders it builds on, and its own `settings`).
`?thumbs=grey` style options go in `Q`, e.g. `Q='?thumbs=colour'` for 1984.

## What's chosen

- `docked.css`, `parts.js`: the shared docked layout, our own title bar and menu bar.
- XP: `xp-luna` (Luna parts) + `xp-office` (Office 2003 layout) + `xp-royale`,
  then `xp-noir` or `xp-red` for the other finishes. `xp` holds the icons and fonts.
- Snow Leopard: `snow` (Finder and iTunes) and `snow-aperture` (dark).
- 1984: `mac84` (the Finder take), with its Thumbnails setting.
- Studio grey: `studio`, to be redone.

## Licences of what's bundled

- Tahoma (`xp/fonts`): Wine's, LGPL 2.1.
- ChicagoFLF (`mac84/fonts`): public domain (Robin Casady).
- Icons in `xp/icons`: Tango icon library, public domain (folders recoloured);
  `crop.svg`, `grid.svg`, `autocrop16.svg`, `more16.svg` drawn for jEditor.
- `snow/glyphs`, `snow/lights`, `mac84/px`, `mac84/icons`: drawn for jEditor.
