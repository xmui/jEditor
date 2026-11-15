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
| **1. The 2.0 look and the quick wins** | The panel in the 2.0 look (below). Restoring scans, part 1: **Restore fade** (one click), **Backlight**, **Red-eye**. Clipping warnings. | The screen in the 2.0 look (below): grouped tools, the ⋯ menu, saved colours. Selections: feather, invert, grow and shrink, select all. Image: flip, rotate, image size, canvas size, crop. |
| **2. Restoring and retouching** | Restoring scans, part 2: **descreen**, **scratch and crease removal**. Clarity, texture, dehaze. | **Spot heal, heal and clone brushes** (sharing Adjust's heal maths). Dodge, burn, sponge; blur, sharpen, smudge brushes. A history panel. |
| **3. Shape and layers** | Straighten by drawing a line; perspective and keystone (auto, vertical, horizontal); lens fixes. | **Layer masks**, clipping masks, **editable text**, groups and locks, merge and flatten. Free transform with perspective and skew. |
| **4. Colour and filters** | Masks by colour and brightness; add, subtract and intersect masks. B&W mix, point colour, `.cube` LUTs. | Adjustment layers. Filters: Gaussian and motion blur, unsharp mask, noise, median, high pass. More shapes (arrow, polygon, rounded rectangle); text alignment and outlines. |
| **5. Workflow** | Snapshots and virtual copies, split before/after, Lightroom preset import, output sharpening, colour profiles. | Brush presets, smoothing, symmetry, pressure for opacity. Rulers, guides, snapping. Layered TIFF/PSD export. |
| **Later** | AI subject and sky masks (if a model can ship), full RAW editing. | Remove an object (content-aware), liquify, lens blur, warp, a pen tool, recorded actions. |

Phase 1 is about a week of work per mode; the others about two weeks each.

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
- **The panel** (Adjust's and Paint's) is a glass card in the same glass,
  10 px corners (`--r-lg`, a card), under the top row at the right. A
  panel of sliders can't be a pill.
- **The film strip** is the viewer's own: black (`--strip-bg`), docked at
  the bottom, 80 px.
- **Menus are solid**, as the grid's and viewer's right-click menu is
  (`#context-menu`, `.ctx-fly` in the 2.0 look: `--bg-surface`, 28 px rows,
  10 px corners, keys at the right, a row with its own menu beside it).
  Popovers and messages (Info, More options, toasts) are glass, as in
  Photos.
- **The photo** lies on the solid surround, as in the viewer: no blurred
  copy behind it (that was the mockup's, not the app's).
- Only the sidebar is docked on its tint. One of each control (the slider,
  switch, heading, button), and **extras go in menus, not on bars.**

This changes one 2.0 rule ("docked is solid" covered Adjust's and Paint's
panels, and Fable's #174 put them on the sidebar's tint). The owner said yes
on 2026-11-15, so #174's `--chrome` rule for `.adj-panel`, `.paint-panel`,
`.paint-options` and `.paint-tools` gives way to the glass, and
`.claude/agents/theming.md` gets the new line when phase 1 is built.

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
| `--shadow-2` (pills, cards), `--shadow-3` (popovers) | its shadow | `data-glass` |
| `--lg-bend` | Liquid's bend (`liquid.js`) | Liquid only |

The panel, the tools and the options join the list of parts in
`style.css` that take the halo (`:is(.toolbar, .file-info, …)`) and
Liquid's bend (`:root.liquid-bends :is(…)`), so they behave as the pills do.

### Modes that flow into each other

Going Photos → Adjust → Paint and back should feel like one window with
another panel, not three screens (the owner, 2026-11-15: "i want the modes
to flow into each other better"). The rules:

1. **What's shared stays put.** The sidebar, its mode switch, the file
   pill (name, 5 / 12, sort), the film strip and the pill at the top right
   are the same elements in every mode and never move. The top-right pill
   keeps its place and changes its buttons: Info, view, refresh, crop and ⋯
   in Photos; Before and ⋯ in Adjust; Undo, Redo and ⋯ in Paint. The
   bottom pill does the same: ‹ rotate › in Photos, ‹ Fit 100% › in Adjust
   and Paint.
2. **The photo is one element.** It never reloads, blanks or flashes. Its
   middle stays at the same height; when a panel comes in it glides
   sideways and shrinks only as much as it must, in the same 280 ms as the
   panel. The panel never covers the photo you're editing.
3. **Panels come and go once.** Photos → Adjust: the panel slides in 16 px
   from the right and fades. Adjust → Paint: the panel stays where it is
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
6. **The sidebar folds away in every mode** (the owner, 2026-11-15): the
   button at the left of the file pill, or Ctrl+B. It slides out to the
   left in 280 ms and the photo, strip and pills glide into the room;
   nothing jumps. Folded, a chip in the file pill names the mode, with a
   menu to switch (today's `.mode-chip`). Whether the sidebar becomes glass
   like the panel is the owner's call (asked 2026-11-15).
7. **Leaving keeps your place.** The same photo, zoom and strip position in
   every mode; edits made in Adjust show in Paint and in the strip.

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
- **The panel** is the glass card on the right: the histogram at the top, then **four tools as icons**:
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
- **The panel** is the same glass card as Adjust's, in the same place: going from Adjust to Paint only its contents change.
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
   Glass and Glass tint. (Owner.)
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
