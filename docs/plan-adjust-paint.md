# Plan: Adjust and Paint, fully featured and in line with 2.0

Asked for by the owner, through the Wrangler, on 2026-11-14 (Denver time).
A plan only: nothing is built yet. It turns `PLAN.md` item 7 (the pro
update) into betas you can try one at a time, and lines both modes up with
the 2.0 look (item 16, `.claude/agents/theming.md`).

Mockup of both modes after phase 1:
https://claude.ai/artifact/5DimbgKC9HGTgrjkxLLac6

## Where they stand today

**Adjust** already has a lot: light, colour, levels, curves, mixer, grading
wheels, film looks, detail, effects, masks (brush, gradient, sky, subject),
heal and clone, Find dust, Pick grey, RAW previews, Sync and Auto sync.

**Paint** has layers with blend modes, brushes, selections, fill and
gradient, shapes, text, and images brought in as layers.

What's missing is less about the number of sliders and more about the
handful of things people reach for in Lightroom and Photoshop and don't
find, plus a screen that doesn't yet feel like the rest of 2.0.

## (a) The gaps, most missed first

**Adjust**

1. **One-click restore for faded prints.** The orders need it most. Auto
   colour helps, but there's no single "bring it back" button.
2. **Clarity, texture and dehaze.** Lightroom users reach for these on
   almost every photo.
3. **Straighten and perspective.** Drawing a line to level a horizon, and
   fixing leaning buildings or a print scanned at an angle.
4. **Red-eye and backlight fix.** Common on old prints and flash photos.
5. **Scratches, creases and the dot pattern of printed photos (descreen).**
   Find dust handles specks, not lines or screens.
6. **Masks by colour or brightness, and combining masks.** Today a mask is
   a shape or a brush; you can't say "just the blues" or "the dark parts".
7. **Snapshots and history.** No way to keep two versions of an edit or
   step back to one from earlier.
8. **Clipping warnings and a split before/after.** Small, but expected.
9. **Lens fixes** (distortion, colour fringes, dark corners).
10. **Black-and-white mix, point colour, `.cube` LUTs, Lightroom presets.**
11. **Colour profiles** (keeping wide-gamut colour).

**Paint**

1. **A healing brush and clone stamp, and remove an object.** The first
   thing people do in Photoshop with a photo.
2. **Selections you can refine:** feather, invert, grow and shrink, select
   all, and a selection you can move or transform.
3. **Flip, rotate, image and canvas size, crop.** Basic, and missing.
4. **Text that stays editable.** Today text is pixels once it's placed.
5. **Layer masks.** Hiding part of a layer without erasing it.
6. **Free transform** (scale, rotate, skew, perspective) of a layer.
7. **Filters:** blur, sharpen, noise, high pass.
8. **Adjustment layers** (levels, curves, hue/saturation, black and white).
9. **A history panel.**
10. **Dodge, burn, blur and smudge brushes.**
11. **Brush presets, smoothing, symmetry; pen pressure for opacity.**
12. **Layered PSD or TIFF export; groups and locks; layer effects.**

## (b) The phases

Each phase is one beta. Adjust and Paint go side by side, so each beta
gives both modes something.

| Phase | Adjust | Paint |
|---|---|---|
| **1. The 2.0 look and the quick wins** | The panel in the 2.0 look (below). Restoring scans, part 1: **Restore colour** (auto, with a strength; below), **Backlight**, **Red-eye**. Clipping warnings. In Photos: **Restore colour** on one photo or a batch (below). | The screen in the 2.0 look (below): grouped tools, the ⋯ menu, saved colours. Selections: feather, invert, grow and shrink, select all. Image: flip, rotate, image size, canvas size, crop. |
| **2. Restoring and retouching** | Restoring scans, part 2: **colour restoration in full** (fade types, the neutral picker; below), **descreen**, **scratch and crease removal**. Clarity, texture, dehaze. | **Spot heal, heal and clone brushes** (sharing Adjust's heal maths). Dodge, burn, sponge; blur, sharpen, smudge brushes. **More brushes, part 1:** pencil, ink, marker, airbrush, soft and hard round, eraser variants; smoothing; pressure for opacity. A history panel. **Canvas size and a crop that extends the canvas** (moved from phase 1, the owner, 2026-11-15): Paint's layers made bigger than the photo, and Export and the layer record taught a canvas bigger than the photo, so what's painted outside it is kept and written. |
| **3. Shape and layers** | Straighten by drawing a line; perspective and keystone (auto, vertical, horizontal); lens fixes. | **Layer masks**, clipping masks, **editable text**, groups and locks, merge and flatten. **Free transform** (scale, rotate, skew, distort, perspective) of a layer, a selection or text, text staying editable where it can, and re-editable afterwards (the original kept, as a smart layer). |
| **4. Colour and filters** | Masks by colour and brightness; add, subtract and intersect masks. B&W mix, point colour, `.cube` LUTs. | Adjustment layers. Filters: Gaussian and motion blur, unsharp mask, noise, median, high pass. More shapes (arrow, polygon, rounded rectangle); text alignment and outlines. |
| **5. Workflow** | Snapshots and virtual copies, split before/after, Lightroom preset import, output sharpening, colour profiles. | **More brushes, part 2:** charcoal, watercolour, texture, smudge and mixer brushes; tilt; brush presets. Symmetry. **Warp** with a mesh, on layers, selections and text. Rulers, guides, snapping. Layered TIFF/PSD export. |
| **Later** | AI subject and sky masks (if a model can ship), full RAW editing. | Remove an object (content-aware), lens blur, puppet warp, a pen tool, recorded actions. (Liquify moves to phase 5: the owner's pick, below.) |

Phase 1 is about a week of work per mode; the others about two weeks each.

### Colour restoration (the owner, 2026-11-15)

"More expansive color restoration (also needs easy way to do in photos
mode) for faded prints or color cast slides like expired red ones." One
edit, kept non-destructively in Adjust's settings for the photo, so it
can be changed or taken off later wherever it was made.

**Phase 1: the one click and the basic auto**

- **In Photos:** **Restore colour** on a photo's right-click menu and on
  the selection bar (under its ⋯ if the bar has no room). It works on one
  photo or a whole selection, with one Undo (Ctrl+Z) for the batch, and a
  message with **Adjust it…**, which opens the photo in Adjust's Restore
  tool. Each photo is analysed for itself.
- **In Adjust, Restore tool:** **Restore colour** with **Auto** and a
  **Strength** slider (0 to 100, starting at 100). Auto is per-channel
  levels with a stretch: each of red, green and blue is set from its own
  darkest and brightest (a small clip at each end), which undoes most dye
  fade, then a cast removal that pulls the midtones' average to neutral.
  Before (the bar's button) compares as for any edit.
- In `app/develop.js` this is one new stage with its own few numbers (the
  levels and the cast), worked out once when Auto is pressed and stored;
  drawing it is cheap, so the engine chat's work there isn't disturbed.

**Phase 2: in full**

- **Fade types**, each a starting point for Auto: faded print; red or
  magenta slide (expired Ektachrome, Kodachrome); cyan or blue cast;
  yellowed print. Auto picks one from the histogram and says which; you
  can choose another.
- **Neutral picker:** click something that should be grey (as Pick grey,
  `W`, does for white balance) to set the cast from it.
- Per-channel fine-tuning (the black and white points of each channel)
  under the group's disclosure.

**Phase 2, how it's built and measured (the owner, via the Wrangler,
2026-11-15).** In small PRs into beta, in this order:

1. *Done:* the test kit (`test/restore-kit`): self-made scenes faded in
   density, the way dye layers fade (per-layer loss, a little cross-layer
   coupling, after Ando et al. 1997; stains; uneven fade to the edges),
   scored by ΔE2000 against the clean scene. `npm test` fails if a case
   gets worse.
2. *Done:* the auto in density (Kodak's density-difference idea): each
   dye's density range, from the paper's white to the darkest shadow, is
   brought up to the strongest one's, the whites to the cleanest one (a
   stain comes off), and all stretched together to a print's black when
   every dye has faded. No grey-world, so a field of grass stays green.
   Edits made with phase 1's auto keep it.
3. *Done:* the fade types and Auto's pick (from each dye's range and
   white; the kit checks the pick), **Keep the colours** (what Auto does
   when it finds no fade), and **Pick grey** in the Restore tool. Measured
   on the kit and left out: gray-edge in Auto (worse: 3.0 → 3.6 at a 15%
   blend; matching the dyes' ranges finds neutral better), per-type
   settings (every kind of fade does best with all three dyes stretched),
   and extra saturation in the faded dye (the colour already comes back;
   what's left is mostly lightness).
4. Uneven fade (an optional low-frequency fix), and one roll-wide
   correction with per-photo tweaks in Photos' one click.
5. Later: an optional AI recolour, as a desktop download.

### Adjust: film looks you dial in, and your own (the owner, 2026-11-15)

"For the film looks I want to be able to create your own, and it's also a
series of sliders to dial it in with all the necessary adjustments." All of
it stays non-destructive, as the rest of Adjust.

- **Phase 1:** the Look group's picker and its **Amount** slider (as the
  mockup draws it).
- **Phase 2, dialable looks:** picking a look opens its sliders under the
  picker, so a look is never fixed: Amount; Contrast (its tone curve);
  Fade (lifted blacks); Shadow tint and Highlight tint; Saturation and
  Vibrance; Colour response (a small mixer: each hue's shift, saturation
  and brightness); Grain (amount, size, roughness); Halation; Vignette;
  Warmth. Changing one shows the look as modified, with Reset to go back.
- **Phase 2, your own looks:** **Save as a look…** keeps the current
  settings under a name, with a thumbnail made from the photo; your looks
  sit beside the built-in ones (under their own heading). Rename,
  duplicate and delete them from the look's right-click menu.
- **Phase 5:** looks exported and imported as a file, beside Lightroom
  preset import.

### Paint: the owner's picks (2026-11-15)

"Let's start with all those everyday features you listed plus recolor,
vector and pixel layers, non-destructive everything, liquify, and I want
some brushes to be inspired by MS Paint and Mario Paint." Each lands as
early as it sensibly can. Keys are written here as on Windows; on a Mac
the app shows them through `Host.keys` (⌘J, ⌥-click and so on).

| Phase | What |
|---|---|
| **1** (with the screen in the 2.0 look) | **Alt** for the colour picker, with a loupe round the pointer. **Alt + right-drag** sizes the brush (sideways) and sets its hardness (up and down), with the circle shown live. **Copy merged** and **paste in place**; **pasting a screenshot** makes a new layer. Layer keys: **Ctrl+J** duplicate, **Ctrl+E** merge down, **Alt-click** an eye to show that layer alone, **Ctrl-click** a thumbnail to select its pixels. **Lock transparency**. **Fill** with a tolerance and **gap closing** (a line drawing with small gaps still fills one area). **Crop that extends the canvas** when dragged past its edge. |
| **2** (retouching) | **QuickShape**: hold at the end of a stroke and it snaps to a clean line, circle, rectangle or arc, then adjusts while still held. **Two-finger tap** undoes, **three-finger tap** redoes (touch screens and trackpads that report them), and the **history panel** can be scrubbed. **Recolor**: swap one colour for another everywhere, keeping its shading (a hue and saturation shift on the pixels near that colour, with a tolerance). **Retro brushes, part 1** (below). |
| **3** (shape and layers) | **Vector layers** beside pixel layers in one document: shapes and paths stay sharp and editable, and can be turned into pixels. **Non-destructive transforms** (the smart layers already in phase 3). **Snapping** to layer edges and the canvas's centre and edges. **Rotating the view** (hold R and drag; R tapped twice puts it straight), the picture itself untouched. |
| **4** (colour and filters) | **Non-destructive filters and adjustments**: filters on a layer stay editable and can be switched off or removed, as adjustment layers are. **Retro brushes, part 2** (below). A **reference window**: a small floating picture to paint from, kept with the document, that can be zoomed and moved. |
| **5** (workflow) | **Liquify** (push, twirl, pucker, bloat, and restore), desktop only on the GPU engine as (d) says. Guides to snap to. |

**Retro brushes: a set of our own** (inspired by MS Paint and Mario Paint;
inspiration only). Grouped as one **Retro** set in the brush menu. Every
picture, stamp, icon and sound is drawn or made for jEditor; nothing is
copied from either app.

- *Part 1 (phase 2):* a chunky **pixel pencil** (hard square pixels at
  any zoom, no smoothing); a **spray can** that scatters dots as it's held;
  a **stamp brush** with our own stamps (shapes, stars, little drawings),
  each click a stamp.
- *Part 2 (phase 4):* the classic **oval, rectangle and polygon** tools
  with fill styles (outline, filled, both); and a playful **undo** that
  gives a short wipe or puff, off with Settings → Animations and with
  reduced motion, as any motion is.

## (c) How each mode lines up with 2.0

**Glass pills that match the grid and the viewer** (the owner, 2026-11-15:
"it needs glass to be cohesive", "yes but we need pills", "to match grid
and photos"). Adjust and Paint use Photos' own parts, not copies:

- **Pills:** `.toolbar` with `.tb-btn` inside (`app/style.css` §4, "Every
  pill that floats over the photo or grid shares this recipe"): 40 px high
  (`--ctl-lg` in the 2.0 look, 44 on a touch screen), fully round, 32 px
  round buttons, the halo behind the words (`--glass-halo`).
- **Where:** 20 px from the window's edges (`--gutter`), the second row
  8 px under the first (`--top-row` + `--sp-2`, as Info and Undo history
  drop down), the controls at the bottom centre over the photo.
- **The panel** (Adjust's and Paint's) is **docked** to the window's right
  edge, full height, and made like the left sidebar: the same tint
  (`--chrome`, which is `--sidebar-bg`), a hairline on its inner edge
  (`--chrome-line`), square corners, no shadow, no blur. It has no button
  of its own: Tab hides and shows it, and it can be dragged away and back
  (below).
- **The film strip** is the viewer's own: black (`--strip-bg`), docked at
  the bottom, 80 px.
- **Menus are solid**, as the grid's and viewer's right-click menu is
  (`#context-menu`, `.ctx-fly` in the 2.0 look: `--bg-surface`, 28 px rows,
  10 px corners, keys at the right, a row with its own menu beside it).
  Popovers and messages (Info, More options, toasts) are glass, as in
  Photos.
- **The photo** lies on the solid surround, as in the viewer: no blurred
  copy behind it (that was the mockup's, not the app's).
- Docked parts (the sidebar and the panel) are solid on that tint; only
  what floats over the photo is glass. One of each control (the slider,
  switch, heading, button), and **extras go in menus, not on bars.**

**Why the panel is docked and solid** (the owner, 2026-11-15: the right
panels "should be more in line with the left sidebar docked and look like
it materially"). This brings back the 2.0 rule *docked is solid, floating
is glass*: the two sidebars frame the photo as the same material, and glass
is kept for the small things that float over it (the pills, popovers and
messages). It also means a panel full of sliders sits on a steady
background instead of whatever photo is under it, which is easier to read
and to judge colour beside. #174 already puts `.adj-panel` and
`.paint-panel` on `--chrome`, so that rule stays; what changes is that they
dock full height at the right edge and fold away. Paint's tools and options
(`.paint-tools`, `.paint-options`) float as pills, so they move from
`--chrome` to the glass.

**Glass follows Settings.** Adjust and Paint add no glass of their own.
Every glass part takes the same tokens as Photos' pills, so Settings → Glass
(Crystal, Liquid, Clear, Opaque, Lens) and Glass tint change all three
modes at once, and Reduce transparency or Increase contrast make them solid:

| Token (`app/tokens.css`) | What it does | Set by |
|---|---|---|
| `--glass-bg` | the glass itself, with `--glass-tint` washed over it | `data-glass`, `data-tint` |
| `--glass-filter` | the blur behind it | `data-glass` |
| `--glass-border`, `--glass-rim` | its edge and the light along it | `data-glass` |
| `--glass-halo` | the halo behind words on clear glass | `data-glass` |
| `--shadow-2` (pills), `--shadow-3` (popovers) | its shadow | `data-glass` |
| `--lg-bend` | Liquid's bend (`liquid.js`) | Liquid only |

Paint's tools and options join the list of parts in
`style.css` that take the halo (`:is(.toolbar, .file-info, …)`) and
Liquid's bend (`:root.liquid-bends :is(…)`), so they behave as the pills do.

### Modes that flow into each other

Going Photos → Adjust → Paint and back should feel like one window with
another panel, not three screens (the owner, 2026-11-15: "i want the modes
to flow into each other better"). The rules:

1. **What's shared stays put.** The sidebar, its mode switch, the file
   pill (name, 5 / 12, sort), the film strip and the pill at the top right
   are the same elements in every mode. The top-right pill keeps its row
   and changes its buttons; when the panel docks it glides left with the
   panel's edge, in the same 280 ms, so it never sits over the panel: Info, view, refresh, crop and ⋯
   in Photos; Before and ⋯ in Adjust; Undo, Redo and ⋯ in Paint. The
   bottom pill does the same: ‹ rotate › in Photos, ‹ Fit 100% › in Adjust
   and Paint.
2. **The photo is one element.** It never reloads, blanks or flashes. Its
   middle stays at the same height; when a panel comes in it glides
   sideways and shrinks only as much as it must, in the same 280 ms as the
   panel. The panel never covers the photo you're editing.
3. **Panels come and go once.** Photos → Adjust: the docked panel slides
   in from the right edge, and the photo, strip and pill glide aside.
   Folding it (Tab) slides it back out and they glide into the room. Adjust → Paint: the panel stays where it is
   and only its contents cross-fade; Paint's tools and options slide in
   8 px from the left and from above.
4. **Three speeds** (the 2.0 motion block): 120 ms for pointing and
   pressing (a colour fade; what's pressed gives a little with
   `--ease-press`, #187); 180 ms for what appears (menus, popovers and
   messages fade in from 98%, never overshooting); 280 ms, calm
   (`--ease-out`), for changes of place: panels, pills and the photo. The
   mode switch's pill glides with `--ease-press`, since you pressed it.
5. **Reduced motion, or Settings → Animations off:** nothing slides; a
   plain fade or nothing.
6. **The top of the sidebar is one row that stays put** (option A, the
   owner's pick "for now", 2026-11-15; it can change once they've tried
   it; the other four are on the mockup's last board). The row holds Photos ·
   Adjust · Paint as icons, leaning left, and the sidebar button with Find
   anything to its right, leaning right (the owner, 2026-11-15). The
   sidebar folds away in every mode (the button, Ctrl+B, or dragged past its
   edge): it slides out in 280 ms, the photo, strip and pills glide into
   the room, and the row stays exactly where it was as one glass pill
   (the owner, 2026-11-15: "go with a folded but with accent on selected
   mode"), so nothing you reach for moves. The sidebar button stays plain, never
   highlighted, open or folded (the owner). The mode you're in has its icon in
   the accent colour (`--accent-text`) on the soft chosen pill, open and
   folded. It stays Photos' own docked sidebar, solid
   on its tint, in every mode (the owner: "look like the sidebar on the
   left / the main one"); only what floats is glass. Today the button sits
   elsewhere, and Fable's #197 (drag to hide) leaves it there, so **phase 1
   moves it into this row**, and the mode chip that stands in for the switch
   while the sidebar is folded is retired: the row itself stays.
7. **Both docked parts resize** (the owner, 2026-11-15: "and resizable"):
   drag the inner edge of the sidebar or the panel; double-click it for its
   own width again, as today's `.side-grip` does. The sidebar runs from
   180 to 360 px (never more than 40% of the window), the panel from 260 to
   440 px (always leaving 360 px for the photo). Each mode keeps its own
   widths, saved with the other settings: Adjust can have a wide panel and
   Paint a narrow one. **Dragged past its edge it hides** (the sidebar below
   120 px, the panel below 180 px): a thin line stays at the window's edge,
   brighter under the pointer, and dragging from that line brings it back
   out at the width you drag to (a click brings it back at its last
   width). Changing mode, a sidebar of another width glides to
   it in 280 ms; while you drag, nothing animates, so the edge follows the
   pointer.
8. **Find anything (Ctrl+K, `palette.js`) sits with the modes** (the owner,
   2026-11-15): its magnifier ends the row above, open or folded, and opens
   the same Find anything dialog in every mode.
9. **Leaving keeps your place.** The same photo, zoom and strip position in
   every mode; edits made in Adjust show in Paint and in the strip.

### The craft: jEditor's look, organised like Photomator

The owner (2026-11-15): more pro, "if anything we can be inspired by most
is photomator", "but jeditor style!". So the controls, type and colours stay
jEditor's own (`tokens.css`, the 2.0 rules in `theming.md`), and Photomator
sets how the panel is organised:

- **The histogram first**, drawn from the photo's own red, green and blue,
  with the clipping corners, and under it what the photo is (size, depth,
  colour space) in caption grey with lined-up figures.
- **Groups, not boxes.** Light, Color, Look, Curve, Color mixer, Color
  grading, Detail, Effects, each a heading row: a crisp disclosure arrow,
  the name (small, grey, semibold, sentence case), **Auto** where it means
  something, and a small switch that turns the whole group off for a moment
  to compare. Hairlines between groups; no cards inside the panel. Light,
  Color and Look start open; the panel remembers what you opened.
- **The one slider, in rows of 24 px** on the 4/8 px grid: the label in a
  fixed column, the thin track with the white knob, a tick at the middle of
  a slider that goes both ways, and the value in a lined-up column that can
  be typed into. Double-click a row to reset it; right-click a heading to
  reset the group.
- **Type:** 11 px for headings and captions, 12 px for labels and values,
  13 px on the pills; three weights; figures tabular.
- **One icon set:** one stroke (1.5) everywhere, 20 px on the pills and
  16 px in panels and menus, drawn as one family (Paint's tools redrawn to
  match).
- **Colour:** neutral greys; the accent only for what's chosen, the switches
  that are on, focus and the one main button.
- **Restraint:** no decorative icons in empty states, no extra rules or
  plates, no "coming soon" rows; one quiet line says what phase 2 adds.

### Later

- **Sidebars that fly out, like Zen's** (the owner, 2026-11-15): a hidden
  sidebar or panel slides out over the photo when the pointer reaches its
  edge, works as usual while it's out, and slides away again when the
  pointer leaves. Not in phase 1.
- **Paint, towards Photoshop** (the owner, 2026-11-15: "more essential stuff
  first but definitely want better transform and warp to layers selections
  and text. want more brushes for sure"). The essentials stay first, as the
  phases have them. Transform comes in phase 3 and Warp in phase 5, both on
  layers, selections and text and re-editable; puppet warp is later. The
  brush set comes in two parts (phases 2 and 5), with smoothing and pressure
  brought forward to phase 2. **For the owner to pick, later:** Select
  Subject, content-aware fill, layer styles, Quick Mask, Select and Mask,
  select by colour range, recorded actions (clipping masks and groups are
  already in phase 3; symmetry in phase 5).
- **Paint needs another design pass** (the owner, 2026-11-15: "paint still
  needs a work in the future"): this plan settles Paint's frame, its tools
  pill, options and panel; a later pass looks at Paint on its own, against
  Pixelmator and Photoshop, before phase 3.

### Polish: what every part needs before it merges

- **States:** rest, hover (`--tb-hover`), pressed (`--tb-pressed`, gives a
  little), on or chosen (a soft accent for a tool, as a chosen row), and
  can't be used (40%, with a tooltip saying why: "A picture keeps at least
  one layer"). Mockup, the States board.
- **Empty states** say what goes there and give the one way to start: "No
  masks yet", "Nothing healed yet", "No snapshots yet", "No photos match".
- **Small windows:** checked at 1440 × 900, 1280 × 800 and 1024 × 700 (and
  800 × 600 when built). As room runs out the photo shrinks first, then
  Paint's tool options go into a ⋯ on their pill; words stay whole.
- **Every control works** in the mockup, so what's built can be checked
  against it.

**Adjust** (mockup, first board: choose Adjust in the sidebar)

- **The bar** is Photos' two pills: the file pill (name, 5 / 12, sort)
  and, at the right, **Before** with a **⋯ menu**.
  Reset, Copy, Paste, Sync, Presets, Snapshots and Show clipping go in that
  menu, each with its key.
- **The panel** is docked at the right, like the sidebar: the histogram at the top, then **four tools as icons**:
  Edit, Restore, Heal, Masks. This replaces today's Edit / Retouch / Masks
  tabs, where Retouch and Masks each hold a single folded section.
- **Edit** shows Quick fixes (Auto, Restore fade, Backlight), Look (a
  one-line picker, not a wall of film thumbnails), White balance, Light and
  Presence open; Curve, Color mixer, Color grading, Detail and Effects
  folded below, one open at a time.
- **Restore** is new: the scan tools in one place (fade, red-eye, descreen,
  scratches, Find dust).
- Headings small and grey, in sentence case; the 2.0 slider; one Reset per
  section in its right-click menu rather than a button on every section.
- Checkboxes (Show mask, Invert, Show spots) become the 2.0 switch.
- The zoom (Fit, 100%) is the viewer's bottom pill, and the film strip
  is the viewer's, the same in all three modes.

**Paint** (mockup, first board: choose Paint)

- **The bar** is one pill over the top: the file name, Undo and Redo, and
  a **⋯ menu** holding **Image, Layer, Select and Filter** (decision 4).
  Every new command in this plan lands in one of those, so the bar never
  grows.
- **Tool options** are a second pill under it, using the 2.0
  slider, showing only the chosen tool's options.
- **The tools** are an upright pill down the left (round buttons, as in
  Photos), and go from twenty
  buttons to **nine**: tools of a kind share a
  slot (Select: rectangle, ellipse, lasso, wand; Brush: brush, pencil,
  spray; Fill: fill, gradient; Shapes: line, rectangle, ellipse), with a
  small corner mark; hold or right-click for the others. Hand stays on
  Space. Heal joins in phase 2.
- **The panel** is the same docked panel as Adjust's, in the same place: going from Adjust to Paint only its contents change.
- **Colour** (decision 6): the brush and background squares, a
  **Choose a colour…** button that opens the system's colour picker, and
  a row of **saved colours** under it, with a + to save the brush colour.
  Saved colours stay between sessions.
- **Layers**: blend and opacity above the list; the row of six small
  buttons goes; New layer, Add an image and Delete stay at the foot, and
  the rest is the **Layer menu**, also on a right-click on a layer
  (mockup: right-click a layer, or the Menus board).

## (d) Desktop only, and the web

The fast engine (Rust on the GPU, #167) runs only in the desktop apps; the
web keeps today's code. Following `CLAUDE.md`: the desktop apps get every
feature, the web gets what runs well in a browser.

**On every platform, web too:** everything in phases 1 to 5 that today's
code can do at screen size. That's most of it: the look, the menus, the
restore tools, red-eye, clarity, selections, flip and size, masks, editable
text, adjustment layers, most filters.

**Desktop only** (each gets a feature name in `src/bridge.js` and
`mac/bridge.js`, a row in `docs/platforms.md`, marked "not yet" for the
web unless it's truly too heavy):

| Feature | Why |
|---|---|
| Descreen and scratch removal at full size | Heavy maths on a 24 MP scan; the web gets a preview-size version |
| Liquify, lens blur, remove an object | Need the GPU engine to stay live |
| AI subject and sky masks | A model too big to download in a browser; an optional download in the desktop apps, off until asked for |
| Full RAW editing | Engine-only decoding |
| Layered PSD export | Possible on the web, but large files; desktop first |

**Timing with the engine:** Adjust without its 2560 px cap, and Paint, are
the engine's last steps. Phases 1 and 2 don't need the engine at all.
Phases 3 onward should start after the engine's Adjust step, so the heavy
parts are written once, in the engine.

**Files:** the look and the flow live in `app/style.css` (the 2.0 Adjust
and Paint block, next to #174's) and in `app/index.html`, both shared, so
each phase 1 PR keeps that change small and says so. `app/develop.js` is shared with the engine's open PRs. Phase 1
touches it only for Restore fade, Backlight and Red-eye; the Adjust agent
checks with the Wrangler before starting.

## (e) Decisions

The owner answered on 2026-11-15. Where they said "idk", the plan picked,
following "show less"; those are marked **plan's pick**, and the owner can
change any of them after trying the beta.

1. **Glass:** glass pills, matching the grid and viewer exactly, and
   menus doing what theirs do, which is solid. Glass follows Settings →
   Glass and Glass tint. The panels are docked and solid like the left
   sidebar (2026-11-15). (Owner.)
2. **Adjust's panel:** four tool icons at the top (Edit, Restore, Heal,
   Masks), replacing today's tabs. **Plan's pick:** one row of icons is
   less than tabs that each hide a single section.
3. **Adjust's bar:** only Before on it; the rest in the ⋯ menu. **Plan's
   pick.**
4. **Paint's menus:** one ⋯ menu on the bar, holding Image, Layer, Select
   and Filter, the same as Adjust's ⋯. **Plan's pick:** one button instead
   of four words, and the same shape in both modes. The Layer menu still
   opens on a right-click on a layer.
5. **Paint's tools:** nine grouped slots. (Owner.)
6. **Colour:** the system's colour picker, plus a row of saved colours in
   jEditor, with a + to save the brush colour. (Owner.)
7. **Healing in both modes, sharing the maths:** yes. (Owner.)
8. **Order:** both modes in each beta, as in (b), with Adjust's restore
   tools first within phase 1. **Plan's pick:** one beta builds instead of
   two, and the orders still get Restore fade in the first one.
9. **Desktop-only list:** yes, as in (d). (Owner.)
10. **AI masks:** an optional download in the desktop apps, off until the
    user asks for it. (Owner.)

## Who does what

- **Adjust agent:** the Adjust column. **Paint agent:** the Paint column.
- **Fable** (the 2.0 look) reviews each phase 1 screen before it merges;
  no theming work while themes are paused.
- **The engine chat:** told before phase 3 starts.
