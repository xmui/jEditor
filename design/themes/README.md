# Theme prototypes

The themes jEditor ships are in `app/themes/` (`app/themes.js` lists them):
Windows XP Royale (Royale, Royale Noir, Royale Red), Snow Leopard (Finder,
Aperture) and the 1984 Macintosh. This folder is the workbench for ones not
chosen yet: stylesheets laid over the real jEditor, screenshotted, before
they go into the app. Nothing here is loaded by the app.

## Try one

    mkdir -p photos && for id in 10 15 17 28 29 37 42 54 57 64 76 82 91 102 110 129 137 152 164 177; do curl -sSL -o photos/p$id.jpg https://picsum.photos/id/$id/1600/1067; done
    VIEWS=grid WAIT=3500 node shot.js out/studio studio

`shot.js <out> <theme folder>` opens the app with 20 photos, loads the theme
and writes `<out>-grid.png` and `<out>-photo.png` (VIEWS picks which). A
theme folder has `theme.css`, an optional `setup.js` and `theme.json`
(`layout`, `base`: the folders it builds on, and its own `settings`).
`docked.css` and `parts.js` stand in for the app's docked layout, title bar
and menu bar.

- `studio`: Studio grey, neither take chosen yet (PLAN.md, item 8).
- `px.py`: draws 1984's one-bit icons into `app/themes/mac84/px/`.

## Check a theme

    node design/themes/audit.js                   every theme, every screen
    node design/themes/audit.js xp/royale paint   one theme, one screen

Opens every screen of the real app in every theme, at 1280×800 and
1024×640, and writes `docs/themes-checklist.md`: each part, and what's off
screen, under the title bar, without an icon, cut off or in the wrong font.
`SHOTS=dir` keeps a screenshot of each. The icons: `px.py` (1984, one bit),
`px_xp.py` (XP, colour), `glyphs.py` (Snow Leopard).
