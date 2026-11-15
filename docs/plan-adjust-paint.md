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
| **1. The 2.0 look and the quick wins** | The panel in the 2.0 look (below). Restoring scans, part 1: **Restore fade** (one click), **Backlight**, **Red-eye**. Clipping warnings. | The screen in the 2.0 look (below): grouped tools, menus, jEditor's own colour picker. Selections: feather, invert, grow and shrink, select all. Image: flip, rotate, image size, canvas size, crop. |
| **2. Restoring and retouching** | Restoring scans, part 2: **descreen**, **scratch and crease removal**. Clarity, texture, dehaze. | **Spot heal, heal and clone brushes** (sharing Adjust's heal maths). Dodge, burn, sponge; blur, sharpen, smudge brushes. A history panel. |
| **3. Shape and layers** | Straighten by drawing a line; perspective and keystone (auto, vertical, horizontal); lens fixes. | **Layer masks**, clipping masks, **editable text**, groups and locks, merge and flatten. Free transform with perspective and skew. |
| **4. Colour and filters** | Masks by colour and brightness; add, subtract and intersect masks. B&W mix, point colour, `.cube` LUTs. | Adjustment layers. Filters: Gaussian and motion blur, unsharp mask, noise, median, high pass. More shapes (arrow, polygon, rounded rectangle); text alignment and outlines. |
| **5. Workflow** | Snapshots and virtual copies, split before/after, Lightroom preset import, output sharpening, colour profiles. | Brush presets, smoothing, symmetry, pressure for opacity. Rulers, guides, snapping. Layered TIFF/PSD export. |
| **Later** | AI subject and sky masks (if a model can ship), full RAW editing. | Remove an object (content-aware), liquify, lens blur, warp, a pen tool, recorded actions. |

Phase 1 is about a week of work per mode; the others about two weeks each.

## (c) How each mode lines up with 2.0

**Glass, as in Photos** (the owner, 2026-11-15: "it needs glass to be
cohesive"). In Photos the viewer's controls float over the photo as glass
pills. Adjust and Paint do the same: their bars, tools, panel and film strip
float as glass cards over the photo's space, with the photo fitted between
them and a dark, blurred copy of it behind. Only the sidebar stays docked on
its tint. The other 2.0 rules stay: one of each control (the same slider,
switch, heading and button everywhere), the photo itself is never dressed or
covered, menus stay solid so they're easy to read, and **extras go in
menus, not on bars.**

This changes one of the 2.0 rules ("docked is solid" covered Adjust's and
Paint's panels, and Fable's #174 put them on the sidebar's tint), so Fable
and `.claude/agents/theming.md` need the owner's go on it (decision 1).

**Adjust** (mockup, first board)

- **The bar** becomes two glass pills over the top of the photo: the file
  name (with 5 / 12, as in Photos), and **Before** with a **⋯ menu**.
  Reset, Copy, Paste, Sync, Presets, Snapshots and Show clipping go in that
  menu, each with its key.
- **The panel** is a glass card on the right: the histogram at the top, then **four tools as icons**:
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
- The zoom (Fit, 100%) and the film strip float as glass at the bottom,
  the same as Paint's zoom and Photos' strip.

**Paint** (mockup, second board)

- **The bar** is a glass pill over the top: the file name, then four quiet menus, **Image, Layer,
  Select, Filter**, then Undo and Redo. Every new command in this plan
  lands in one of those menus, so the bar never grows.
- **Tool options** are a smaller glass pill under it, using the 2.0
  slider, showing only the chosen tool's options.
- **The tools** are a glass strip down the left, and go from twenty
  buttons to **nine**: tools of a kind share a
  slot (Select: rectangle, ellipse, lasso, wand; Brush: brush, pencil,
  spray; Fill: fill, gradient; Shapes: line, rectangle, ellipse), with a
  small corner mark; hold or right-click for the others. Hand stays on
  Space. Heal joins in phase 2.
- **The panel** is a glass card on the right, like Adjust's.
- **Colour**: jEditor's own picker in the panel (shade square, hue bar,
  hex) instead of the system's colour window, which looks different on
  each platform; recent colours under it.
- **Layers**: blend and opacity above the list; the row of six small
  buttons goes; New layer, Add an image and Delete stay at the foot, and
  the rest is the **Layer menu**, also on a right-click on a layer
  (mockup, third board).

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
| AI subject and sky masks | A model too big to download in a browser |
| Full RAW editing | Engine-only decoding |
| Layered PSD export | Possible on the web, but large files; desktop first |

**Timing with the engine:** Adjust without its 2560 px cap, and Paint, are
the engine's last steps. Phases 1 and 2 don't need the engine at all.
Phases 3 onward should start after the engine's Adjust step, so the heavy
parts are written once, in the engine.

**Files:** `app/develop.js` is shared with the engine's open PRs. Phase 1
touches it only for Restore fade, Backlight and Red-eye; the Adjust agent
checks with the Wrangler before starting.

## (e) Decisions for the owner

1. **Glass in Adjust and Paint** (your note): bars, tools, panel and strip
   float as glass over a blurred copy of the photo, as in the mockup. This
   overrides the 2.0 rule that docked panels are solid, so Fable would
   change #174 to match. OK? And should menus stay solid (easier to read),
   or be glass too?
2. **Adjust's panel:** four tool icons at the top (Edit, Restore, Heal,
   Masks) as in the mockup, or keep today's tabs?
3. **Adjust's bar:** only Before on it, the rest in the ⋯ menu?
4. **Paint's menus:** four menus on the bar (Image, Layer, Select, Filter)
   as in the mockup, or one ⋯ menu with them inside?
5. **Paint's tools:** nine grouped slots, or keep all twenty showing?
6. **Colour picker:** jEditor's own in the panel, or keep the system's?
7. **Healing in two places:** Adjust's Heal stays non-destructive (for
   scans); Paint gets brushes that paint on a layer. Both, sharing the
   maths?
8. **Order:** both modes in each beta as planned, or Adjust first (the
   orders need the restore tools)?
9. **Desktop-only list** above: OK, or anything you want on the web too?
10. **AI masks:** worth a 30–80 MB download in the desktop apps, or leave
   them out?

## Who does what

- **Adjust agent:** the Adjust column. **Paint agent:** the Paint column.
- **Fable** (the 2.0 look) reviews each phase 1 screen before it merges;
  no theming work while themes are paused.
- **The engine chat:** told before phase 3 starts.
