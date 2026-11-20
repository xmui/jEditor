// Paint (B, or the brush button): painting over a photo, in layers, as a
// tool like Crop. paint.js keeps the layers with the photo's edit; this is
// the screen.
//
//   Move (V): drag the layer, or what's selected, and its handles to scale
//     and turn it; Enter puts it down
//   Select: rectangle (M), ellipse, lasso (L), magic wand (W, by colour);
//     Shift adds to the selection, Alt takes away; Ctrl+A all, Ctrl+D none
//   Brush (B), pencil (N), spray, eraser (E): size, hardness, opacity, flow.
//     Retro, in the brush slot's menu: the pixel pencil (square pixels on a
//     grid the brush's size), the spray can (hard dots as it's held) and
//     the stamp (our own little pictures, one a click)
//     Painters, there too: charcoal and the texture brush (through a grain
//     fixed to the picture), watercolour (pooled at its edges), the mixer
//     (blends with what it goes over). A pen's tilt lays the round on its
//     side. ⋯ → Brushes saves a brush and its settings as a preset
//     The wheel sizes them, [ and ] too (Ctrl+wheel zooms), showing the
//     brush as it'll paint and its size; Shift-click paints straight on
//     from where the last stroke ended; a pen's pressure sizes them.
//     QuickShape: hold still at the end of a stroke (not the spray) and it
//     becomes a clean line, arc, circle or ellipse, rectangle or square;
//     still held, dragging turns and sizes it (⋯ turns it off)
//   On a touch screen: two fingers tapped undo, three redo. ⋯ → History
//     lists the steps under the layers: click one, or drag along them, to
//     go back and forth
//   Fill (G), gradient: fill a colour (where it matches the colour
//     clicked, or the whole layer), or a gradient to the background colour
//     (or to nothing). Recolor: the colour clicked becomes the brush colour
//     everywhere (or in what's selected), its shading kept
//   Line (U), rectangle (R), ellipse (O): stroked, filled or both; Shift
//     keeps lines to 45° and shapes square
//   Text (T): click, type, Ctrl+Enter (or a click elsewhere) puts it down
//   Picker (I): the colour under it, with a loupe (Alt held with any brush
//   does too). Alt + right-drag sizes a brush and sets its hardness
//   Crop (C, or ⋯ → Image): drag the frame's edges in to crop, or out past
//     the picture to make the canvas bigger (what's added is the background
//     colour); Enter crops. Image ▸ Canvas size… adds round all sides
//   Hand (H, or hold Space): move about; the wheel zooms (with a brush,
//     Ctrl+wheel; on a Mac's trackpad, two fingers move about and a pinch
//     zooms)
//
// Sizes (the brush, lines, text) are the photo's own pixels, kept the
// same part of the photo from one photo to the next: a brush a tenth of
// the way across a big photo is a tenth of the way across a small one.
//
// Everything is drawn on the photo as it is shown (cropped and turned as
// its edit says), and kept on the photo as it is on disk, so a crop later
// keeps it in place. Painting goes into a stroke of its own first, then
// onto the layer with the tool's opacity, inside the selection.

const PaintEditor = {
    isOpen: false,
    ready: false,
    busy: false,
    file: null,
    tool: 'brush',
    fg: '#e5484d',
    bg: '#ffffff',
    opts: {
        size: 24, hardness: 80, opacity: 100, flow: 100,
        tolerance: 32, contiguous: true, sampleAll: true, fillWhat: 'match', gaps: 0,
        lineWidth: 8, shapeFill: 'none', arrow: false, shapeLayer: true, corner: 16,
        gradient: 'linear', gradTo: 'bg',
        density: 40, range: 30, stamp: 'star', tip: '', quickShape: true, history: false, aligned: true,
        strength: 50, toneRange: 'mid', sponge: 'less',
        smoothing: 0, pressure: 'size', texture: 'canvas', wet: 50, symmetry: 'off',
        font: 'system-ui, sans-serif', fontSize: 72, bold: false, italic: false, align: 'left', outline: 0,
        snap: true,
        sizeFor: 1500   // the long side of the layers the sizes were for
    },
    BRUSHES: ['brush', 'soft-round', 'hard-round', 'pencil', 'ink', 'marker', 'airbrush', 'spray', 'charcoal', 'watercolour', 'texture', 'mixer', 'eraser', 'eraser-block', 'eraser-soft', 'pixel', 'can', 'stamp', 'custom', 'spot-heal', 'heal', 'clone', 'dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge'],
    // The healing tools (paint-heal.js does their pixels): they copy the
    // picture from somewhere else on it, not a colour
    RETOUCH: ['spot-heal', 'heal', 'clone'],
    // The tone and focus brushes (paint-heal.js too): they change what's
    // there, lighter, darker, more or less colour, softer, sharper, smudged
    TONE: ['dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge'],
    // How the round brushes feel: their hardness (none: the Hardness
    // option's), whether they take the Flow option, and how much of it each
    // dab lays down when it builds up as it's held (airbrushes)
    FEEL: {
        brush: { flow: true }, eraser: {}, custom: { flow: true },
        'soft-round': { hard: 0, flow: true }, 'hard-round': { hard: 1, flow: true },
        ink: { hard: 0.92 }, marker: { hard: 0.8 },
        airbrush: { hard: 0, flow: true, build: 0.12 }, 'eraser-soft': { hard: 0, flow: true, build: 0.12 },
        charcoal: { hard: 0.55, grain: 'charcoal' }, watercolour: { hard: 0, flow: true, wet: true },
        texture: { flow: true, grain: true }, mixer: { flow: true }
    },
    // The painters' brushes (phase 5): charcoal and the texture brush paint
    // through a grain fixed to the picture (as paper's tooth is), watercolour
    // pools at its edges and glazes over what's under it, the mixer picks up
    // the colours it goes over and blends them with its own
    ART: ['charcoal', 'watercolour', 'texture', 'mixer'],
    TEXTURES: [['canvas', 'Canvas'], ['paper', 'Paper'], ['sand', 'Sand']],
    ERASERS: ['eraser', 'eraser-block', 'eraser-soft'],
    // Headings in a slot's menu, before the tool they're on
    HEADINGS: { charcoal: 'Painters', pixel: 'Retro', custom: 'Yours', dodge: 'Tone', blur: 'Focus' },
    // The Retro set (inspired by MS Paint and Mario Paint; every picture
    // drawn for jEditor), listed under its own heading in the brush slot
    RETRO: ['pixel', 'can', 'stamp'],
    // The stamps: 12 by 12, # painted
    STAMPS: {
        star: [
        ".....##.....",
        ".....##.....",
        "....####....",
        "############",
        ".##########.",
        "..########..",
        "...######...",
        "..########..",
        "..###..###..",
        ".###....###.",
        ".##......##.",
        "............"],
        heart: [
        "............",
        ".###....###.",
        "#####..#####",
        "############",
        "############",
        "############",
        ".##########.",
        "..########..",
        "...######...",
        "....####....",
        ".....##.....",
        "............"],
        house: [
        ".....##.....",
        "....####....",
        "...######...",
        "..########..",
        ".##########.",
        "############",
        ".##########.",
        ".#..####..#.",
        ".#..####..#.",
        ".######..##.",
        ".######..##.",
        ".######..##."],
        note: [
        "......####..",
        "......#####.",
        "......#..##.",
        "......#...#.",
        "......#.....",
        "......#.....",
        "......#.....",
        "..#####.....",
        ".######.....",
        ".######.....",
        "..####......",
        "............"],
        sun: [
        "#....##....#",
        ".#...##...#.",
        "..#......#..",
        "....####....",
        "...######...",
        "##.######.##",
        "##.######.##",
        "...######...",
        "....####....",
        "..#......#..",
        ".#...##...#.",
        "#....##....#"],
        leaf: [
        "..........##",
        "........####",
        "......#####.",
        "....######..",
        "...######...",
        "..#####.#...",
        "..####.##...",
        ".####.###...",
        ".###.###....",
        ".#.####.....",
        "#...........",
        "#..........."],
        cat: [
        ".#........#.",
        ".##......##.",
        ".###....###.",
        ".##########.",
        "############",
        "###.####.###",
        "############",
        "#####..#####",
        "####.##.####",
        ".##########.",
        "..########..",
        "............"],
        bolt: [
        "......####..",
        ".....####...",
        "....####....",
        "...####.....",
        "..#######...",
        "....####....",
        "...####.....",
        "..####......",
        ".###........",
        "##..........",
        "#...........",
        "............"]
    },
    STAMP_NAMES: { star: 'Star', heart: 'Heart', house: 'House', note: 'Note', sun: 'Sun', leaf: 'Leaf', cat: 'Cat', bolt: 'Bolt' },
    PALETTE: ['#000000', '#ffffff', '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#d6409f', '#8d6e63', '#9e9e9e', '#ffd6a5', '#caffbf', '#a0c4ff', '#ffadad'],
    FONTS: [['system-ui, sans-serif', 'Sans'], ['Georgia, serif', 'Serif'], ['"Courier New", monospace', 'Mono'], ['"Comic Sans MS", "Comic Neue", cursive', 'Comic'], ['Impact, "Arial Black", sans-serif', 'Impact']],

    TOOLS: [
        ['move', 'Move (V)', '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>'],
        ['sep'],
        ['rect-select', 'Rectangle select (M)', '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/>'],
        ['ellipse-select', 'Ellipse select', '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2"/>'],
        ['lasso', 'Lasso (L)', '<path d="M7 18c-2-1-4-3-4-6 0-4 4-8 9-8s9 3 9 7-4 7-9 7c-1 0-2 0-3-.3" stroke-dasharray="3 2"/><path d="M7 18c-1 1-1 3 1 3"/>'],
        ['wand', 'Magic wand: select by colour (W)', '<path d="m15 4 .8 2.2L18 7l-2.2.8L15 10l-.8-2.2L12 7l2.2-.8z"/><path d="M3 21 13 11"/>'],
        ['sep'],
        ['brush', 'Brush (B)', '<path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8 9.2 12z"/><path d="M9.2 12c-2.5 0-4.2 1.6-4.2 4 0 1.5-.8 2.6-2.4 3.4C4.4 21 6.3 21.5 8 21.5c3 0 5-1.9 4.9-4.6z"/>'],
        ['soft-round', 'Soft round', '<circle cx="12" cy="12" r="8" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="3"/>'],
        ['hard-round', 'Hard round', '<circle cx="12" cy="12" r="8"/>'],
        ['pencil', 'Pencil: hard edges (N)', '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>'],
        ['ink', 'Ink: thin when fast, thick when slow (and as a pen\'s pressed)', '<path d="M12 2c2 3 4 6 4 9a4 4 0 0 1-8 0c0-3 2-6 4-9z"/><path d="M12 15v7M9 22h6"/>'],
        ['marker', 'Marker: see-through, darker where strokes cross', '<path d="M15 3l6 6-9 9H6v-6z"/><path d="M6 18l-3 3M12 6l6 6"/>'],
        ['airbrush', 'Airbrush: soft, builds up as it\'s held', '<path d="M3 17l8-8 4 4-8 8H3z"/><path d="M15 5h.01M18 4h.01M19 7h.01M17 9h.01M21 9h.01"/>'],
        ['spray', 'Spray', '<path d="M9 3h3v4H9zM8 7h5v14H8z"/><path d="M16 6h.01M19 4h.01M19 8h.01M17 10h.01M21 6h.01"/>'],
        ['charcoal', 'Charcoal: grainy, as on rough paper', '<path d="M14.5 3.5l6 6-9 9-6-6z"/><path d="M5.5 12.5 3 21l8.5-2.5"/><path d="M4 18h.01M6 20h.01M7 17h.01"/>'],
        ['watercolour', 'Watercolour: see-through, darker at its edges', '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z" stroke-dasharray="3 1.5"/><path d="M9 15a3 3 0 0 0 3 3"/>'],
        ['texture', 'Texture brush: paints through canvas, paper or sand', '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M10 12h.01M14 12h.01M8 16h.01M12 16h.01M16 16h.01"/>'],
        ['mixer', 'Mixer: blends its colour with the colours it goes over', '<circle cx="9" cy="10" r="5"/><circle cx="15" cy="14" r="5"/>'],
        ['pixel', 'Pixel pencil: square pixels on a grid', '<path d="M3 3h6v6H3zM9 9h6v6H9zM15 15h6v6h-6z"/>'],
        ['can', 'Spray can: dots as it\'s held', '<path d="M6 9h6v12H6zM7 6h4v3H7zM12 7h2"/><path d="M17 5h.01M20 4h.01M19 8h.01M22 7h.01M18 11h.01M21 10h.01"/>'],
        ['stamp', 'Stamp: a little picture with each click', '<path d="M12 3l1.8 3.7 4 .6-2.9 2.8.7 4L12 12.2 8.4 14.1l.7-4-2.9-2.8 4-.6z"/><path d="M5 18h14v3H5z"/>'],
        ['custom', 'Your brush: one you made (⋯ → Brushes)', '<path d="M4 20c3 0 5-2 5-5"/><path d="M9 15 19 5"/><path d="M14 4h.01M17 9h.01M20 12h.01M12 7h.01"/>'],
        ['eraser', 'Eraser (E)', '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7M5 11l9 9"/>'],
        ['eraser-block', 'Block eraser: a hard square (E)', '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M5 12h14" opacity=".5"/>'],
        ['eraser-soft', 'Soft eraser: takes off more as it\'s held (E)', '<circle cx="12" cy="12" r="8" stroke-dasharray="2 2"/><path d="M8 12h8"/>'],
        ['spot-heal', 'Spot heal: paint over a mark, and it\'s filled from what\'s round it (J)', '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10 12h.01M12 10h.01M14 12h.01M12 14h.01"/><path d="M19 2.5v3M17.5 4h3"/>'],
        ['heal', 'Heal: Alt-click where to copy from, then paint; it takes on the colours round it (J)', '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M10.5 12h3M12 10.5v3"/>'],
        ['clone', 'Clone stamp: Alt-click where to copy from, then paint (S)', '<path d="M9.5 3h5v5l-1 2.5h4.5a2 2 0 0 1 2 2V16H4v-3.5a2 2 0 0 1 2-2h4.5l-1-2.5z"/><path d="M5 20h14"/>'],
        ['dodge', 'Dodge: lighter where you paint', '<circle cx="9" cy="9" r="5"/><path d="M12.6 12.6 20 20"/>'],
        ['burn', 'Burn: darker where you paint', '<path d="M7 21v-7a2 2 0 0 1 4 0V8a2 2 0 0 1 4 0v8M15 12a2 2 0 0 1 4 0v4a5 5 0 0 1-5 5h-2"/><path d="M5 4.5 7 6M12 2v2.5M19 4.5 17 6"/>'],
        ['sponge', 'Sponge: more or less colour where you paint', '<rect x="4" y="7" width="16" height="11" rx="3"/><path d="M8 11h.01M12 13h.01M16 11h.01M10 15h.01M14 15h.01"/>'],
        ['blur', 'Blur: softer where you paint', '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>'],
        ['sharpen', 'Sharpen: crisper where you paint', '<path d="M12 3 21 20H3z"/>'],
        ['smudge', 'Smudge: drag the colours along', '<path d="M9 21v-9a2 2 0 0 1 4 0v4M13 12a2 2 0 0 1 4 0v4a5 5 0 0 1-5 5"/><path d="M4 7c2-1 4 1 6 0s4-1 6 0"/>'],
        ['sep'],
        ['fill', 'Fill (G)', '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="m5 2 5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z"/>'],
        ['gradient', 'Gradient', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18" opacity=".5"/>'],
        ['recolor', 'Recolor: click a colour to change it to the brush colour', '<path d="M7 3c2.5 3 4 5.2 4 7a4 4 0 0 1-8 0c0-1.8 1.5-4 4-7z"/><path d="M14 14h6M17 11l3 3-3 3"/><path d="M17 21c-1.5 0-2.5-1-2.5-2.3"/>'],
        ['sep'],
        ['line', 'Line (U)', '<path d="M5 19 19 5"/>'],
        ['arrow', 'Arrow', '<path d="M5 19 19 5M10 5h9v9"/>'],
        ['rect', 'Rectangle (R)', '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
        ['roundrect', 'Rounded rectangle', '<rect x="4" y="6" width="16" height="12" rx="4"/>'],
        ['ellipse', 'Ellipse (O)', '<ellipse cx="12" cy="12" rx="9" ry="7"/>'],
        ['polygon', 'Polygon: click each corner; double-click, Enter or the first corner closes it', '<path d="M12 3l8 6-3 10H7L4 9z"/>'],
        ['text', 'Text (T)', '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'],
        ['sep'],
        ['picker', 'Colour picker (I)', '<path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>'],
        ['hand', 'Hand: move about (H, or hold Space)', '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>']
    ],
    // The ten slots down the left (the plan: nine, and Heal in phase 2): tools of a kind share one,
    // which shows the one used last; hold it or right-click it for the
    // others. Hand stays on Space too
    GROUPS: [
        ['move'],
        ['rect-select', 'ellipse-select', 'lasso', 'wand'],
        ['brush', 'soft-round', 'hard-round', 'pencil', 'ink', 'marker', 'airbrush', 'spray', 'charcoal', 'watercolour', 'texture', 'mixer', 'pixel', 'can', 'stamp', 'custom'],
        ['eraser', 'eraser-block', 'eraser-soft'],
        ['spot-heal', 'heal', 'clone', 'dodge', 'burn', 'sponge', 'blur', 'sharpen', 'smudge'],
        ['fill', 'gradient', 'recolor'],
        ['line', 'arrow', 'rect', 'roundrect', 'ellipse', 'polygon'],
        ['text'],
        ['picker'],
        ['hand']
    ],
    // What each tool's options are
    OPTIONS: {
        brush: ['size', 'hardness', 'opacity', 'flow'],
        pencil: ['size', 'opacity'],
        'soft-round': ['size', 'opacity', 'flow'],
        'hard-round': ['size', 'opacity', 'flow'],
        ink: ['size', 'opacity'],
        marker: ['size', 'opacity'],
        airbrush: ['size', 'opacity', 'flow'],
        'eraser-block': ['size', 'opacity'],
        'eraser-soft': ['size', 'opacity', 'flow'],
        spray: ['size', 'density', 'opacity'],
        charcoal: ['size', 'opacity'],
        watercolour: ['size', 'opacity', 'flow'],
        texture: ['texture', 'size', 'hardness', 'opacity', 'flow'],
        mixer: ['size', 'hardness', 'wet', 'opacity'],
        pixel: ['size', 'opacity'],
        can: ['size', 'density', 'opacity'],
        stamp: ['stamp', 'size', 'opacity'],
        custom: ['tip', 'size', 'opacity', 'flow'],
        eraser: ['size', 'hardness', 'opacity'],
        'spot-heal': ['size', 'hardness', 'sampleAll', 'opacity'],
        heal: ['size', 'hardness', 'aligned', 'sampleAll', 'opacity'],
        clone: ['size', 'hardness', 'aligned', 'sampleAll', 'opacity'],
        dodge: ['size', 'hardness', 'toneRange', 'strength', 'sampleAll', 'opacity'],
        burn: ['size', 'hardness', 'toneRange', 'strength', 'sampleAll', 'opacity'],
        sponge: ['size', 'hardness', 'sponge', 'strength', 'sampleAll', 'opacity'],
        blur: ['size', 'hardness', 'strength', 'sampleAll', 'opacity'],
        sharpen: ['size', 'hardness', 'strength', 'sampleAll', 'opacity'],
        smudge: ['size', 'hardness', 'strength', 'sampleAll', 'opacity'],
        fill: ['fillWhat', 'tolerance', 'gaps', 'contiguous', 'sampleAll', 'opacity'],
        gradient: ['gradient', 'gradTo', 'opacity'],
        recolor: ['range', 'sampleAll', 'opacity'],
        line: ['lineWidth', 'arrow', 'opacity', 'shapeLayer'],
        rect: ['lineWidth', 'shapeFill', 'opacity', 'shapeLayer'],
        ellipse: ['lineWidth', 'shapeFill', 'opacity', 'shapeLayer'],
        arrow: ['lineWidth', 'opacity', 'shapeLayer'],
        roundrect: ['lineWidth', 'shapeFill', 'corner', 'opacity', 'shapeLayer'],
        polygon: ['lineWidth', 'shapeFill', 'opacity', 'shapeLayer'],
        text: ['font', 'fontSize', 'bold', 'italic', 'align', 'outline', 'opacity'],
        wand: ['tolerance', 'contiguous', 'sampleAll'],
        'rect-select': [], 'ellipse-select': [], lasso: [], move: [], picker: [], hand: []
    },
    HISTORY_BYTES: 400 * 1024 * 1024,

    el(id) { return document.getElementById(id); },

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.root = this.el('paint-editor');
        this.stage = this.el('paint-stage');
        this.canvas = this.el('paint-canvas');
        try {
            const kept = JSON.parse(localStorage.getItem('jeditor.paint') || 'null');
            if (kept && typeof kept === 'object') {
                for (const k of Object.keys(this.opts)) if (typeof kept[k] === typeof this.opts[k]) this.opts[k] = kept[k];
                if (/^#[0-9a-f]{6}$/i.test(kept.fg)) this.fg = kept.fg;
                if (/^#[0-9a-f]{6}$/i.test(kept.bg)) this.bg = kept.bg;
                if (this.OPTIONS[kept.tool]) this.tool = kept.tool;
                // Kept before sizes followed the photo: as they were, on the next one
                if (typeof kept.sizeFor !== 'number') this.opts.sizeFor = 0;
            }
        } catch (e) { /* private mode */ }

        this.buildTools();
        this.loadTips();
        const bind = (id, fn) => this.el(id).addEventListener('click', (e) => { e.currentTarget.blur(); if (!this.busy) fn(); });
        bind('paint-undo', () => this.undo());
        bind('paint-redo', () => this.redo());
        // ⋯: Select and Layer (the plan: every new command lands in a menu,
        // so the bar never grows)
        this.el('paint-more').addEventListener('click', (e) => {
            const b = e.currentTarget;
            e.stopPropagation(); // not to the window, which closes menus
            b.blur();
            if (this.busy || !this.ready) return;
            const r = b.getBoundingClientRect();
            this.app.openContextMenu(this.moreItems(), r.left, r.bottom + 6);
        });
        // Done, in the file's pill: what Enter does (a crop, a paste or a
        // shape being made is finished first; then back to Photos, kept)
        bind('paint-done', () => this.app.keyHandlers()['paint.done']());
        bind('paint-zoom-fit', () => this.fit());
        bind('paint-zoom-1', () => this.zoomTo(1));
        bind('paint-swap', () => this.swapColours());
        bind('paint-default', () => this.defaultColours());
        bind('paint-layer-add', () => this.addLayer());
        bind('paint-import', () => this.pickImage());
        this.initImport();
        this.initHistory();
        bind('paint-layer-dup', () => this.duplicateLayer());
        bind('paint-layer-up', () => this.moveLayer(1));
        bind('paint-layer-down', () => this.moveLayer(-1));
        bind('paint-layer-merge', () => this.mergeDown());
        bind('paint-layer-delete', () => this.deleteLayer());
        this.el('paint-fg').addEventListener('input', (e) => { this.fg = e.target.value; this.remember(); this.restyleSoon(); });
        this.el('paint-bg').addEventListener('input', (e) => { this.bg = e.target.value; this.remember(); this.restyleSoon(); });
        // Choose a colour…: the system's own picker, for the brush colour
        bind('paint-choose', () => {
            const i = this.el('paint-fg');
            try { if (i.showPicker) { i.showPicker(); return; } } catch (e) { /* not from this gesture */ }
            i.click();
        });
        this.drawPalette();
        const blend = this.el('paint-layer-blend');
        for (const [v, label] of Paint.BLENDS) {
            const o = document.createElement('option');
            o.value = v;
            o.textContent = label;
            blend.appendChild(o);
        }
        blend.addEventListener('change', () => {
            const l = this.layer();
            if (!l) return;
            this.pushState('Blend');
            l.blend = blend.value;
            l.changed = true;
            this.afterState();
        });
        this.opacityRow = this.slider('Opacity', 0, 100, 1, () => Math.round((this.layer() ? this.layer().opacity : 1) * 100), (v, start) => {
            const l = this.layer();
            if (!l) return;
            if (start) this.pushState('Layer opacity');
            l.opacity = v / 100;
            l.changed = true;
            this.renderSoon();
        }, () => this.afterState());
        this.el('paint-layer-opacity').appendChild(this.opacityRow);

        // The photo
        const st = this.stage;
        st.addEventListener('pointerdown', (e) => this.down(e));
        st.addEventListener('pointermove', (e) => this.move(e));
        st.addEventListener('pointerup', (e) => this.up(e));
        st.addEventListener('pointercancel', (e) => this.up(e));
        st.addEventListener('pointerleave', () => { this.hover = null; this.renderSoon(); });
        // Alt + right-drag sizes the brush: no menu when it lets go
        st.addEventListener('contextmenu', (e) => { if (e.altKey || this._sized) { e.preventDefault(); e.stopPropagation(); this._sized = false; } });
        // Alt held: the colour picker, with its loupe, for the tools that
        // paint a colour
        for (const type of ['keydown', 'keyup']) window.addEventListener(type, (e) => {
            if (e.key !== 'Alt' || !this.isOpen) return;
            const on = type === 'keydown';
            if (on === !!this.alt) return;
            this.alt = on;
            if (on) e.preventDefault(); // not the window's menu bar
            this.cursor();
            this.renderSoon();
        }, true);
        window.addEventListener('blur', () => { if (this.alt) { this.alt = false; this.cursor(); this.renderSoon(); } });
        st.addEventListener('wheel', (e) => {
            if (!this.ready) return;
            e.preventDefault();
            const r = this.canvas.getBoundingClientRect();
            const trackpad = Host.mac() && Wheel.kind(e) === 'trackpad';
            // With a brush, the wheel sizes it (on a Mac's trackpad, Alt and
            // two fingers); Ctrl+wheel, or a pinch, zooms
            if (this.isBrush() && !e.ctrlKey && !e.metaKey && (!trackpad || e.altKey) && !this.drag) {
                const px = Wheel.pixels(e);
                this.nudgeSize(Math.exp(-(px.y || px.x) * 0.0015));
                return;
            }
            // On a Mac (wheel.js): two fingers move about, a pinch zooms
            if (trackpad) {
                this.fitted = false;
                this.view.x -= e.deltaX;
                this.view.y -= e.deltaY;
                this.positionText();
                this.renderSoon();
                return;
            }
            const k = Math.exp(-Wheel.pixels(e).y * (e.ctrlKey ? 0.01 : 0.0015));
            this.zoomAt(this.view.z * k, e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });
        st.addEventListener('dblclick', (e) => { if (this.tool === 'hand') this.fit(); else if (this.poly) this.endPoly(true); });
        // Space held: the hand
        window.addEventListener('keydown', (e) => {
            if (!this.isOpen || e.code !== 'Space' || this.app.isTypingTarget(e.target)) return;
            e.preventDefault();
            if (!this.space) { this.space = true; this.cursor(); }
        }, true);
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && this.space) { this.space = false; this.cursor(); }
        }, true);
        // R held and dragged: the view turns (the tool back as it was when
        // R's let go); R tapped twice: the view straight. A tap alone is
        // still the rectangle
        window.addEventListener('keydown', (e) => {
            if (!this.isOpen || !this.ready || e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'r' && e.key !== 'R') || this.app.isTypingTarget(e.target)) return;
            const now = performance.now();
            if (now - (this._rTap || 0) < 350 && this.viewAngle()) this.rotateViewTo(0);
            this._rTap = now;
            this.rHeld = { tool: this.tool, used: false };
        }, true);
        window.addEventListener('keyup', (e) => {
            if ((e.key !== 'r' && e.key !== 'R') || !this.rHeld) return;
            const h = this.rHeld;
            this.rHeld = null;
            if (h.used) { this._rTap = 0; if (this.tool !== h.tool) this.setTool(h.tool); }
        }, true);
        // Shift held over the photo with a brush: the straight line it'd paint
        for (const type of ['keydown', 'keyup']) window.addEventListener(type, (e) => {
            if (e.key !== 'Shift' || !this.isOpen || !this.hover) return;
            this.hover.shift = type === 'keydown';
            if (this.isBrush()) this.renderSoon();
        }, true);
        // The text being typed
        const ta = this.el('paint-text');
        ta.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endText(false); }
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); this.endText(true); }
            else e.stopPropagation();
        });
        ta.addEventListener('input', () => this.sizeText());
        // Fitted, it fits again (the film strip coming in under it, the
        // window made smaller); zoomed by hand, it stays as it is
        this._resize = new ResizeObserver(() => {
            if (!this.ready) return;
            this.sizeCanvas();
            if (this.fitted) this.fit(); else this.render();
        });
        this._resize.observe(st);
        // The top: placed again when the options change or the window does
        const box = this.el('paint-options');
        this._optsSeen = new MutationObserver(() => this.layoutTopSoon());
        this._optsSeen.observe(box, { childList: true });
        this._resizeTop = new ResizeObserver(() => this.layoutTopSoon());
        this._resizeTop.observe(this.root);
        new MutationObserver(() => this.layoutTopSoon()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
        // Zoom's pill: its clicks aren't strokes
        const zoom = this.el('paint-zoom');
        this.el('paint-view-angle').addEventListener('click', (e) => { e.currentTarget.blur(); this.rotateViewTo(0); });
        for (const type of ['pointerdown', 'dblclick', 'contextmenu']) zoom.addEventListener(type, (e) => e.stopPropagation());
        // An open › card closes on a click anywhere else
        window.addEventListener('pointerdown', (e) => {
            const card = box.querySelector('.paint-fold:not(.hidden)');
            if (card && !e.target.closest('.paint-fold, .paint-fold-btn')) {
                card.classList.add('hidden');
                box.querySelector('.paint-fold-btn').setAttribute('aria-expanded', 'false');
            }
        }, true);
    },

    // Zoom's pill: Fit or 100% lit when it's at that, and the zoom
    showZoom() {
        const z = this.view.z, at1 = Math.abs(z - 1) < 0.001, deg = this.viewAngle();
        if (this._zoomShown === z + ':' + this.fitted + ':' + deg) return;
        this._zoomShown = z + ':' + this.fitted + ':' + deg;
        const turn = this.el('paint-view-angle');
        turn.classList.toggle('hidden', !deg);
        turn.querySelector('span').textContent = `${deg}°`;
        turn.querySelector('svg').style.transform = `rotate(${deg}deg)`;
        this.el('paint-zoom-fit').setAttribute('aria-pressed', String(!!this.fitted));
        this.el('paint-zoom-1').setAttribute('aria-pressed', String(at1));
        this.el('paint-zoom-level').textContent = this.fitted || at1 ? '' : `${Math.round(z * 100)}%`;
        // In jEditor's own look the pill shows only zoomed in or turned, as
        // Adjust's (style.css)
        this.root.classList.toggle('paint-zoomed', !this.fitted || !!deg);
    },

    // ---- Snap (View → Snap, Ctrl+;): to the canvas's edges and middle ----

    // Within 5 screen px of an edge or a middle, on it (near enough to
    // catch, not so far it stops a small move by an edge); the lines
    // snapped to show while dragging. Ctrl held while moving: no snapping
    SNAP_NEAR: 5,

    snapTargets() {
        const xs = [0, this.OW / 2, this.OW], ys = [0, this.OH / 2, this.OH];
        for (const b of this.layerEdges()) { xs.push(b.x0, (b.x0 + b.x1) / 2, b.x1); ys.push(b.y0, (b.y0 + b.y1) / 2, b.y1); }
        return { xs, ys };
    },

    // The edges of what's on the other layers shown, in the picture as
    // shown (found once a drag, while nothing changes)
    layerEdges() {
        const key = this.history.length + ':' + this.cur + ':' + this.layers.length;
        if (this._edges && this._edges.key === key) return this._edges.list;
        const list = [];
        this.layers.forEach((l, i) => {
            if (i === this.cur || !this.isShown(l)) return;
            const d = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H).data, W = this.W;
            let x0 = W, y0 = this.H, x1 = -1, y1 = -1;
            for (let y = 0; y < this.H; y++) {
                const row = y * W * 4;
                let first = -1, last = -1;
                for (let x = 0; x < W; x++) if (d[row + x * 4 + 3] > 8) { first = x; break; }
                if (first < 0) continue;
                for (let x = W - 1; x >= first; x--) if (d[row + x * 4 + 3] > 8) { last = x; break; }
                if (first < x0) x0 = first;
                if (last > x1) x1 = last;
                if (y < y0) y0 = y;
                y1 = y;
            }
            if (x1 < 0) return;
            const pts = [[x0, y0], [x1 + 1, y0], [x0, y1 + 1], [x1 + 1, y1 + 1]].map(([x, y]) => this.C.transformPoint({ x, y }));
            const b = { x0: Math.min(...pts.map(q => q.x)), y0: Math.min(...pts.map(q => q.y)), x1: Math.max(...pts.map(q => q.x)), y1: Math.max(...pts.map(q => q.y)) };
            // (one that fills the canvas has the canvas's edges already)
            if (b.x0 <= 0.5 && b.y0 <= 0.5 && b.x1 >= this.OW - 0.5 && b.y1 >= this.OH - 0.5) return;
            list.push(b);
        });
        this._edges = { key, list };
        return list;
    },

    snapPoint(p) {
        this._snapLines = null;
        if (!this.opts.snap || this.view.r) return p;
        const near = this.SNAP_NEAR / this.view.z, { xs, ys } = this.snapTargets();
        const fx = xs.find(x => Math.abs(p.ox - x) < near), fy = ys.find(y => Math.abs(p.oy - y) < near);
        if (fx === undefined && fy === undefined) return p;
        const o = { x: fx === undefined ? p.ox : fx, y: fy === undefined ? p.oy : fy };
        const l = this.Ci.transformPoint(o);
        this._snapLines = { x: fx, y: fy };
        return { ...p, ox: o.x, oy: o.y, x: l.x, y: l.y };
    },

    // What's being moved: its edges or middle onto the canvas's
    snapFloat() {
        this._snapLines = null;
        const f = this.float, t = f.t;
        if (!this.opts.snap || this.view.r || t.rot) return;
        const near = this.SNAP_NEAR / this.view.z, { xs, ys } = this.snapTargets();
        const w = f.w * Math.abs(t.sx), h = f.h * Math.abs(t.sy);
        const cx = f.x0 + f.w / 2 + t.tx, cy = f.y0 + f.h / 2 + t.ty;
        const best = (c, half, targets) => {
            let b = null;
            for (const at of targets) for (const k of [-1, 0, 1]) {
                const dd = at - (c + k * half);
                if (Math.abs(dd) < near && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, at };
            }
            return b;
        };
        const bx = best(cx, w / 2, xs), by = best(cy, h / 2, ys);
        if (bx) t.tx += bx.d;
        if (by) t.ty += by.d;
        if (bx || by) this._snapLines = { x: bx ? bx.at : undefined, y: by ? by.at : undefined };
    },

    drawSnapLines(ctx, VD) {
        const s = this._snapLines;
        if (!s || !this.drag) return;
        ctx.save();
        ctx.setTransform(VD);
        ctx.strokeStyle = '#ff2d95';
        ctx.lineWidth = 1 / this.view.z;
        ctx.beginPath();
        if (s.x !== undefined) { ctx.moveTo(s.x, 0); ctx.lineTo(s.x, this.OH); }
        if (s.y !== undefined) { ctx.moveTo(0, s.y); ctx.lineTo(this.OW, s.y); }
        ctx.stroke();
        ctx.restore();
    },

    toggleSnap() {
        this.opts.snap = !this.opts.snap;
        this.remember();
        this.app.showToast(this.opts.snap ? 'Snap on: to the canvas\'s edges and middle' : 'Snap off', 1400);
    },

    layoutTopSoon() {
        if (this._layTimer) return;
        this._layTimer = requestAnimationFrame(() => { this._layTimer = 0; this.layoutTop(); });
    },

    // The top (jEditor's own look, 2.0, every mode's): the file and Done
    // in the middle, Undo, Redo and ⋯ at the right. The tool's options in
    // a pill at the bottom of the stage. What doesn't fit folds behind ›, last
    // first (a theme keeps its bars, the options under the head)
    layoutTop() {
        const box = this.el('paint-options'), head = this.root.querySelector('.paint-head');
        if (!box || !head) return;
        try {
            this.unfold(box);
            const own = !document.documentElement.hasAttribute('data-skin');
            if (!own || !this.isOpen) { head.style.paddingLeft = head.style.paddingRight = box.style.left = box.style.top = box.style.maxWidth = ''; return; }
            const ed = this.root.getBoundingClientRect();
            const gap = 12;
            // After the mode switcher, when it floats over this row
            let from = 0;
            for (const id of ['mode-row', 'mode-float', 'mode-chip-float', 'mode-seg']) {
                const el = document.getElementById(id);
                if (!el) continue;
                // Watched: it changes size as it settles, or the sidebar opens
                if (!this._watched) this._watched = new Set();
                if (!this._watched.has(el)) { this._watched.add(el); this._resizeTop.observe(el); }
                if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
                const r = el.getBoundingClientRect();
                const hr = head.getBoundingClientRect();
                if (r.width && r.bottom > hr.top && r.top < hr.bottom && r.left < ed.left + ed.width / 2) from = Math.max(from, r.right - ed.left);
            }
            // The file's pill in the middle (2.0, every mode's top), kept clear
            // of the mode switcher at the left and the actions at the right:
            // the same room both sides, so it stays in the middle
            const acts = head.querySelector('.mode-head-acts').getBoundingClientRect();
            const hr = head.getBoundingClientRect();
            const side = Math.max(from, acts.width ? hr.right - acts.left : 0);
            head.style.paddingLeft = head.style.paddingRight = side ? `${Math.round(side + gap)}px` : '';
            // The options: a pill at the bottom of the stage, in the middle
            // of the room right of the tools (2.0, the header the owner
            // picked: the top is the file and the mode's actions only)
            const st = this.el('paint-stage').getBoundingClientRect();
            const tools = this.el('paint-tools').getBoundingClientRect();
            const toolsOver = tools.width && getComputedStyle(this.el('paint-tools')).position === 'absolute';
            const g = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 20;
            const zoom = parseFloat(getComputedStyle(box).zoom) || 1;
            const x0 = (toolsOver ? tools.right : st.left) - ed.left + gap, x1 = st.right - ed.left - gap;
            const room = Math.max(0, x1 - x0);
            box.style.maxWidth = `${room / zoom}px`;
            this.fold(box, room);
            const b = box.getBoundingClientRect();
            box.style.left = `${(x0 + Math.max(0, (room - b.width) / 2)) / zoom}px`;
            box.style.top = `${(st.bottom - ed.top - b.height - g) / zoom}px`;
        } finally {
            // Its own folding isn't a change to lay out again
            if (this._optsSeen) this._optsSeen.takeRecords();
        }
    },

    // The options past the room, last first, into a card under ›
    fold(box, room) {
        const kids = [...box.children];
        if (box.getBoundingClientRect().width <= room + 1 && box.scrollWidth <= box.clientWidth + 1) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ghost sm icon paint-fold-btn';
        btn.title = 'More options';
        btn.setAttribute('aria-label', 'More options');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
        const card = document.createElement('div');
        card.className = 'paint-fold hidden';
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', 'More options');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = card.classList.toggle('hidden') === false;
            btn.setAttribute('aria-expanded', String(open));
            btn.blur();
        });
        box.append(btn, card);
        const over = () => box.getBoundingClientRect().width > room + 1 || box.scrollWidth > box.clientWidth + 1;
        // (All of them, at the narrowest: › alone)
        while (over() && kids.length) card.prepend(kids.pop());
        if (!card.children.length) { btn.remove(); card.remove(); }
    },

    // Back in the row, before it's measured again
    unfold(box) {
        const card = box.querySelector('.paint-fold');
        if (card) {
            const btn = box.querySelector('.paint-fold-btn');
            for (const k of [...card.children]) box.insertBefore(k, btn);
            card.remove();
            if (btn) btn.remove();
        }
    },

    remember() {
        try { localStorage.setItem('jeditor.paint', JSON.stringify({ ...this.opts, fg: this.fg, bg: this.bg, tool: this.tool, slots: this.slots })); } catch (e) { /* private mode */ }
        if (this.text) this.positionText();
    },

    // The slots: each a button showing its group's tool used last, with a
    // small mark in its corner when it holds others. A click takes that
    // tool; holding it (or a right-click) shows the others, with their keys
    buildTools() {
        const tools = this.el('paint-tools');
        tools.textContent = '';
        const byId = Object.fromEntries(this.TOOLS.filter(t => t[0] !== 'sep').map(t => [t[0], t]));
        if (!this.slots) {
            this.slots = {};
            try {
                const kept = JSON.parse(localStorage.getItem('jeditor.paint') || 'null');
                if (kept && kept.slots && typeof kept.slots === 'object') this.slots = kept.slots;
            } catch (e) { /* private mode */ }
        }
        this.GROUPS.forEach((group, g) => {
            if (!group.includes(this.slots[g])) this.slots[g] = group[0];
            const b = document.createElement('button');
            b.className = 'paint-tool' + (group.length > 1 ? ' paint-tool-group' : '');
            b.dataset.group = String(g);
            if (group.length > 1) b.setAttribute('aria-haspopup', 'menu');
            const others = (e) => {
                e.preventDefault();
                const r = b.getBoundingClientRect();
                const items = [];
                for (const id of group) {
                    if (this.HEADINGS[id]) items.push([this.HEADINGS[id], null]);
                    items.push([byId[id][1].replace(/ \(.*\)$/, '').replace(/:.*$/, ''), () => this.setTool(id), false, id === this.tool, `paint.${this.KEY_OF[id] || id}`]);
                }
                this.app.openContextMenu(items, r.right + 6, r.top);
            };
            if (group.length > 1) {
                b.addEventListener('contextmenu', (e) => { e.stopPropagation(); others(e); });
                let held = null;
                b.addEventListener('pointerdown', (e) => {
                    if (e.button !== 0) return;
                    held = setTimeout(() => { held = 'shown'; others(e); }, 400);
                });
                const stop = () => { if (held && held !== 'shown') clearTimeout(held); };
                b.addEventListener('pointerup', stop);
                b.addEventListener('pointerleave', stop);
                b.addEventListener('click', (e) => {
                    e.stopPropagation(); // not to the window, which closes menus
                    b.blur();
                    if (held === 'shown') { held = null; return; }
                    held = null;
                    this.setTool(b.dataset.tool);
                });
            } else b.addEventListener('click', () => { b.blur(); this.setTool(group[0]); });
            tools.appendChild(b);
        });
        this.syncTools();
    },

    // The key each tool has, as script.js names it
    KEY_OF: { 'rect-select': 'rectSelect', 'ellipse-select': 'ellipseSelect', 'spot-heal': 'heal' },

    syncTools() {
        const byId = Object.fromEntries(this.TOOLS.filter(t => t[0] !== 'sep').map(t => [t[0], t]));
        for (const b of this.root.querySelectorAll('.paint-tool')) {
            const group = this.GROUPS[+b.dataset.group];
            if (!group) continue;
            if (group.includes(this.tool)) this.slots[+b.dataset.group] = this.tool;
            const id = this.slots[+b.dataset.group] || group[0];
            if (b.dataset.tool !== id) {
                const [, title, svg] = byId[id];
                b.dataset.tool = id;
                b.innerHTML = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
                const more = group.length > 1 ? ' (hold or right-click for the others)' : '';
                b.title = Host.keys(title + more);
                b.setAttribute('aria-label', title.replace(/ \(.*\)$/, ''));
            }
            b.setAttribute('aria-pressed', String(group.includes(this.tool)));
        }
    },

    // A slider with its number, for the options bar and the layer panel.
    // set(value, start): start is true for the first change of a drag;
    // end(): the drag's over. log: for sizes, as far from 1 to 2 as from
    // 100 to 200, so the small ones a small photo needs aren't squeezed
    // into the slider's first few pixels
    slider(label, min, max, step, get, set, end = null, log = false) {
        const row = document.createElement('label');
        row.className = 'paint-opt';
        row.innerHTML = '<span></span><input type="range"><span class="paint-num"></span>';
        row.querySelector('span').textContent = label;
        const input = row.querySelector('input'), num = row.querySelector('.paint-num');
        const span = Math.log(max / min);
        const toPos = (v) => log ? Math.round(1000 * Math.log(Math.max(min, v) / min) / span) : v;
        const toValue = (pos) => {
            if (!log) return pos;
            const v = min * Math.exp(pos / 1000 * span);
            return v < 10 ? Math.round(v * 2) / 2 : Math.round(v);
        };
        Object.assign(input, log ? { min: 0, max: 1000, step: 1 } : { min, max, step });
        input.setAttribute('aria-label', label);
        let sliding = false;
        input.addEventListener('input', () => {
            const v = toValue(parseFloat(input.value));
            set(v, !sliding);
            sliding = true;
            num.textContent = this.sizeLabel(v);
        });
        input.addEventListener('change', () => { sliding = false; input.blur(); if (end) end(); });
        row._sync = () => { const v = get(); input.value = toPos(v); num.textContent = this.sizeLabel(v); };
        row._sync();
        return row;
    },

    // ---- Opening and closing ----

    // The photo as it's shown behind the layers, for its edit (turn, flip,
    // crop and adjustments): the layers stay on the photo as it is on disk,
    // so turning or flipping it only changes how they're shown (C: layer
    // space to the picture shown)
    setView(edit) {
        this.edit = edit || null;
        const base = this.photo0;
        this.ed = edit && !Edits.wholePhoto(edit) ? CropEditor.fromSnapshot(this.PW, this.PH, edit) : null;
        let shown = this.ed ? this.ed.drawOutput(base) : (() => { const c = document.createElement('canvas'); c.width = this.PW; c.height = this.PH; c.getContext('2d').drawImage(base, 0, 0); return c; })();
        if (edit && edit.adj) Develop.applyCanvas(shown, edit.adj, { scale: this.PW / this.fullW, map: Develop.cropMap(this.ed, this.PW, this.PH) });
        // The picture as shown, before the canvas pads it
        this.PO = { w: shown.width, h: shown.height };
        const pad = this.pad || Paint.ZERO, ext = this.ext;
        if (this.pad) {
            const out = this.newCanvas(Math.max(1, shown.width + pad.l + pad.r), Math.max(1, shown.height + pad.t + pad.b));
            const g = out.getContext('2d');
            if (this.fill) { g.fillStyle = this.fill; g.fillRect(0, 0, out.width, out.height); }
            g.drawImage(shown, pad.l, pad.t);
            shown.width = shown.height = 0;
            shown = out;
        }
        if (this.backdrop && this.backdrop !== shown) this.backdrop.width = this.backdrop.height = 0;
        this.backdrop = shown;
        this.OW = shown.width;
        this.OH = shown.height;
        // The photo as on disk to the picture shown (Cc), and layer space
        // (the photo, and past it as far as the layers reach) to the
        // canvas shown (C), and back
        if (this.ed) {
            const o = this.ed.outputRect();
            const [a, b, c, d] = this.ed.mat(); // the turn, and any flip
            this.Cc = new DOMMatrix([a, b, c, d, -o.x0, -o.y0]).translate(-this.PW / 2, -this.PH / 2);
        } else {
            this.Cc = new DOMMatrix();
        }
        this.C = new DOMMatrix().translate(pad.l, pad.t).multiply(this.Cc).translate(-ext.l, -ext.t);
        this.Ci = this.C.inverse();
        this.showDims();
    },

    // Image ▸ Rotate and Flip: the photo's own turn and flip (an edit, kept
    // with it, never written into the original), the layers going with it.
    // Done keeps it; one step of Undo here
    turnImage(how) {
        if (!this.ready || !Edits.canKeep()) return;
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        const before = this.edit;
        const after = how === 'h' || how === 'v' ? Edits.flipped(before, how) : Edits.turned(before, how);
        // The canvas's margins turn with the picture (the layers reach the
        // same places on the photo)
        const p = this.pad, pad0 = p && { ...p };
        const pad1 = p && ({ 1: { l: p.b, t: p.l, r: p.t, b: p.r }, 3: { l: p.t, t: p.r, r: p.b, b: p.l }, 2: { l: p.r, t: p.b, r: p.l, b: p.t }, h: { l: p.r, t: p.t, r: p.l, b: p.b }, v: { l: p.l, t: p.b, r: p.r, b: p.t } }[how] || p);
        this.applyView(after, pad1);
        this.record({ kind: 'view', name: { 1: 'Rotate right', 3: 'Rotate left', 2: 'Rotate 180°', h: 'Flip left to right', v: 'Flip upside down' }[how] || 'Turn', before, after, pad0, pad1 });
    },

    applyView(edit, pad = this.pad) {
        this.healSrc = this.healOff = null; // (layer px move)
        this.pad = pad ? { ...pad } : null;
        this.dropSelection();
        this.setView(edit);
        this.fit();
        this.drawLayers();
        this.buildOptions();
        this.renderSoon();
    },

    async open(app, file) {
        this.init(app);
        this.file = file;
        this.ready = false;
        this.isOpen = true;
        this.healSrc = this.healOff = null; // (layer px move)
        this.history = [];
        this.future = [];
        this.historyBytes = 0;
        this.trimmed = false;
        this.sel = null;
        this.float = null;
        this.drag = null;
        this.root.classList.remove('hidden');
        if (typeof Modes !== 'undefined') Modes.arrive(this.root);
        this.el('paint-file').textContent = file.name;
        this.el('paint-dims').textContent = 'Loading…';
        const token = this._token = (this._token || 0) + 1;
        const current = () => this.isOpen && this.file === file && this._token === token;

        const kept = Edits.get(file);
        const data = await app.readImage(file);
        const bmp = await createImageBitmap(data);
        const fullW = bmp.width, fullH = bmp.height;
        const kp = kept && kept.paint;
        const size = kp ? { w: kp.w, h: kp.h } : Paint.sizeFor(fullW, fullH);
        // The photo at the layers' size; the canvas past it (paint.js)
        this.PW = size.w;
        this.PH = size.h;
        this.ext = { ...Paint.ZERO, ...(kp && kp.ext) };
        this.pad = kp && kp.pad ? { ...kp.pad } : null;
        this.fill = (kp && kp.fill) || null;
        this.crop = null;
        this.W = this.PW + this.ext.l + this.ext.r;
        this.H = this.PH + this.ext.t + this.ext.b;
        this.fitSizes();
        this.lastDab = null;
        this.paintId = kept && kept.paint ? kept.paint.id : Paint.newId();
        // The photo at the layers' size, its spots done (for the fill and
        // the wand), and as shown: cropped and adjusted (behind the layers)
        const photo = document.createElement('canvas');
        photo.width = this.PW;
        photo.height = this.PH;
        const pg = photo.getContext('2d', { willReadFrequently: true });
        pg.imageSmoothingQuality = 'high';
        pg.drawImage(bmp, 0, 0, this.PW, this.PH);
        bmp.close();
        const base = await Retouch.retouched(photo, kept);
        if (base !== photo) photo.width = photo.height = 0;
        this.photo0 = base;
        this.extendPhoto();
        this.fullW = fullW;
        this.fullH = fullH;
        this.setView(kept);
        // The layers
        this.layers = [];
        this.groups = {};
        if (kept && kept.paint) {
            for (const gr of kept.paint.groups || []) this.groups[gr.id] = { name: gr.name, hidden: !!gr.hidden, open: gr.open !== false };
            for (const l of kept.paint.layers) {
                const c = this.newCanvas();
                const src = await Paint.layerBitmap(kept.paint, l);
                if (src) c.getContext('2d').drawImage(src, 0, 0, this.W, this.H);
                const rec = { id: l.id, rev: l.rev, name: l.name, opacity: l.opacity, blend: l.blend, hidden: l.hidden, lock: !!l.lock, canvas: c, changed: false, text: l.text || null, shape: l.shape || null, clip: !!l.clip, fixed: !!l.fixed, group: l.group || null, adj: l.adj || null };
                if (l.mask) {
                    const m = this.newCanvas(), mb = await Paint.layerBitmap(kept.paint, Paint.maskOf(l));
                    if (mb) m.getContext('2d').drawImage(mb, 0, 0, this.W, this.H);
                    else m.getContext('2d').fillRect(0, 0, this.W, this.H);
                    Object.assign(rec, { mask: m, maskRev: l.mask, maskChanged: false });
                }
                if (l.src) {
                    const sb = await Paint.layerBitmap(kept.paint, Paint.srcOf(l));
                    if (sb && sb.width === l.src.w && sb.height === l.src.h0) {
                        const o = this.newCanvas(sb.width, sb.height);
                        o.getContext('2d').drawImage(sb, 0, 0);
                        rec.src = { canvas: o, h: l.src.h, rev: l.src.rev };
                    }
                }
                this.layers.push(rec);
            }
        }
        if (!this.layers.length) this.layers.push(this.makeLayer('Layer 1'));
        this.cur = this.layers.length - 1;
        if (!current()) { this.dropCanvases(); return; }
        this.stroke = this.newCanvas();
        this.before = this.newCanvas();
        this.showDims();
        this.ready = true;
        this.syncColours();
        this.setTool(this.tool);
        this.sizeCanvas();
        this.view = { z: 1, x: 0, y: 0, r: 0 }; // straight, for each photo
        this.fit();
        this.drawLayers();
    },

    close() {
        if (this.text) this.endText(false);
        this.isOpen = false;
        this.ready = false;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        clearTimeout(this._fine);
        clearTimeout(this._sizeTimer);
        this.dropCanvases();
        this.history = this.future = [];
        if (this.root) this.root.classList.add('hidden');
        this.file = null;
    },

    dropCanvases() {
        const all = [this.photo, this.photo0, this.backdrop, this.stroke, this.before, this.sel && this.sel.mask, this.sel && this.sel.edge, this.float && this.float.canvas, this._scratch, this._shown && this._shown.canvas];
        for (const l of this.layers || []) all.push(l.canvas);
        for (const c of all) if (c) c.width = c.height = 0;
        this.photo = this.photo0 = this.backdrop = this.stroke = this.before = this._scratch = this._shown = this._photoThumb = null;
        this.layers = [];
        this.sel = this.float = null;
    },

    // The photo in layer space: where the layers reach past it, clear
    extendPhoto() {
        const e = this.ext;
        if (this.photo && this.photo !== this.photo0) this.photo.width = this.photo.height = 0;
        if (!(e.l || e.t || e.r || e.b)) { this.photo = this.photo0; return; }
        this.photo = this.newCanvas();
        this.photo.getContext('2d').drawImage(this.photo0, e.l, e.t);
    },

    // The size along the top: the photo's own, or the canvas's when it's
    // bigger or smaller (as Export writes it)
    showDims() {
        const el = this.el('paint-dims');
        if (!el || !this.fullW) return;
        const k = this.fullW / this.PW;
        el.textContent = this.pad ? `${Math.round(this.OW * k)} × ${Math.round(this.OH * k)} (canvas)` : `${this.fullW} × ${this.fullH}`;
    },

    newCanvas(w = this.W, h = this.H) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    },

    makeLayer(name) {
        return { id: Paint.newId().slice(-8), rev: null, name, opacity: 1, blend: 'source-over', hidden: false, canvas: this.newCanvas(), changed: true };
    },

    layer() {
        return (this.layers && this.layers[this.cur]) || null;
    },

    isBrush(t = this.tool) {
        return this.BRUSHES.includes(t);
    },

    // ---- Sizes ----

    // The biggest brush: half the photo's long side (a small photo's
    // brushes are small), from 100 to 1000 px
    sizeMax() {
        return Math.max(100, Math.min(1000, Math.round(Math.max(this.W || 0, this.H || 0) / 2)));
    },

    // A size as shown: whole pixels, halves below 10
    sizeLabel(v) {
        return String(v >= 10 ? Math.round(v) : Math.round(v * 2) / 2);
    },

    // The sizes kept the same part of this photo as of the last one
    fitSizes() {
        const o = this.opts, L = Math.max(this.W, this.H);
        if (o.sizeFor > 0 && o.sizeFor !== L) {
            const k = L / o.sizeFor;
            o.size = Math.min(this.sizeMax(), Math.max(1, o.size * k));
            o.lineWidth = Math.min(200, o.lineWidth * k);
            o.fontSize = Math.min(600, Math.max(6, o.fontSize * k));
        }
        o.sizeFor = L;
    },

    // The size the tool has: the brush's, a line's or the text's
    sizeKey() {
        return this.SHAPES.includes(this.tool) ? 'lineWidth' : this.tool === 'text' ? 'fontSize' : 'size';
    },

    // Bigger or smaller by k (the wheel, [ and ]); whole: by a pixel at least
    nudgeSize(k, whole = false) {
        const key = this.sizeKey(), o = this.opts, was = o[key];
        const [min, max] = { size: [1, this.sizeMax()], lineWidth: [0, 200], fontSize: [6, 600] }[key];
        let v = was * k;
        if (whole) v = Math.round(k > 1 ? Math.max(v, Math.floor(was) + 1) : Math.min(v, Math.ceil(was) - 1));
        o[key] = Math.min(max, Math.max(min, v));
        this.remember();
        const row = this.optRows && this.optRows[key];
        if (row) row._sync();
        this.flashSize();
    },

    // Shift+[ and Shift+]: the hardness, a quarter at a time (tools that
    // have it)
    nudgeHardness(dir) {
        if (!(this.OPTIONS[this.tool] || []).includes('hardness')) return false;
        const o = this.opts;
        o.hardness = Math.min(100, Math.max(0, Math.round((o.hardness + dir * 25) / 25) * 25));
        this.remember();
        const row = this.optRows && this.optRows.hardness;
        if (row) row._sync();
        this.flashSize();
        return true;
    },

    // The brush shown as it'll paint, with its size, for a moment as it
    // changes: under the pointer, or in the middle when it's changed along
    // the top
    flashSize() {
        this._sizeUntil = performance.now() + 900;
        clearTimeout(this._sizeTimer);
        this._sizeTimer = setTimeout(() => this.renderSoon(), 950);
        this.renderSoon();
    },

    // Anything painted (not saved yet)
    changedSinceOpen() {
        return this.history.length > 0 || !!this.float;
    },

    // ---- The tool ----

    setTool(id) {
        if (!this.OPTIONS[id]) return;
        if (this.crop) this.endCrop(false);
        if (this.text) this.endText(true);
        if (this.float && id !== 'move') this.commitFloat();
        if (this.poly && id !== 'polygon') this.endPoly(true);
        this.tool = id;
        this.syncTools();
        this.remember();
        this.buildOptions();
        this.cursor();
        this.renderSoon();
    },

    cursor() {
        const t = this.space || this.tool === 'hand' ? (this.drag && this.drag.kind === 'pan' ? 'grabbing' : 'grab')
            : this.crop ? (this._cropCursor || 'crosshair')
            : this.tool === 'move' ? 'move'
            : this.picking() ? 'crosshair'
            : this.tool === 'text' ? 'text'
            : this.alt && (this.tool === 'heal' || this.tool === 'clone') ? 'crosshair'
            : this.isBrush() ? 'none' : 'crosshair';
        this.stage.style.cursor = t;
    },

    buildOptions() {
        const box = this.el('paint-options');
        box.textContent = '';
        if (this.crop) { this.cropOptions(box); return; }
        if (this.float) { this.transformOptions(box); return; }
        const o = this.opts;
        this.loadShapeStyle();
        const save = () => { this.remember(); this.restyleSoon(); if (this.text) this.positionText(); };
        const add = (el) => { box.appendChild(el); return el; };
        const check = (label, key) => {
            const l = document.createElement('label');
            l.className = 'paint-opt';
            l.innerHTML = '<input type="checkbox"><span></span>';
            l.querySelector('span').textContent = label;
            const i = l.querySelector('input');
            i.checked = !!o[key];
            i.addEventListener('change', () => { o[key] = i.checked; save(); i.blur(); });
            return add(l);
        };
        const choose = (label, key, items) => {
            const l = document.createElement('label');
            l.className = 'paint-opt';
            l.innerHTML = '<span></span><select class="field"></select>';
            l.querySelector('span').textContent = label;
            const sel = l.querySelector('select');
            for (const [v, t] of items) {
                const op = document.createElement('option');
                op.value = v;
                op.textContent = t;
                sel.appendChild(op);
            }
            sel.value = String(o[key]);
            sel.addEventListener('change', () => { o[key] = typeof o[key] === 'number' ? +sel.value : sel.value; save(); sel.blur(); });
            return add(l);
        };
        // Bold and Italic: toggle buttons side by side, as text tools have
        // them (audit M4), not checkboxes
        let toggles = null;
        const toggle = (label, key, glyph) => {
            if (!toggles) {
                toggles = add(document.createElement('div'));
                toggles.className = 'paint-opt paint-toggles';
                toggles.setAttribute('role', 'group');
                toggles.setAttribute('aria-label', 'Style');
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'paint-toggle';
            b.dataset.opt = key;
            b.innerHTML = glyph;
            b.title = label;
            b.setAttribute('aria-label', label);
            b.setAttribute('aria-pressed', String(!!o[key]));
            b.addEventListener('click', () => { o[key] = !o[key]; b.setAttribute('aria-pressed', String(!!o[key])); save(); b.blur(); });
            toggles.appendChild(b);
            return b;
        };
        // A few choices shown at once: a segmented control (Align)
        const segment = (label, key, items) => {
            const d = document.createElement('div');
            d.className = 'paint-opt';
            d.innerHTML = '<span></span><div class="paint-seg" role="radiogroup"></div>';
            d.querySelector('span').textContent = label;
            const row = d.querySelector('.paint-seg');
            row.setAttribute('aria-label', label);
            for (const [v, t, icon] of items) {
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('role', 'radio');
                b.dataset.value = v;
                b.title = t;
                b.setAttribute('aria-label', t);
                b.innerHTML = icon;
                b.addEventListener('click', () => {
                    o[key] = v;
                    row.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
                    save();
                    b.blur();
                });
                b.setAttribute('aria-checked', String(String(o[key]) === v));
                row.appendChild(b);
            }
            return add(d);
        };
        const lines = (a) => `<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true">${a}</svg>`;
        // (Sizes, and how the brush paints, shown on the photo as they change)
        const shown = ['size', 'hardness', 'flow', 'density', 'lineWidth', 'fontSize'];
        this.optRows = {};
        const num = (label, key, min, max, step = 1, log = false) => {
            o[key] = Math.min(max, Math.max(min, o[key]));
            return this.optRows[key] = add(this.slider(label, min, max, step, () => o[key], (v) => {
                o[key] = v;
                save();
                if (shown.includes(key)) this.flashSize(); else this.renderSoon();
            }, null, log));
        };
        // Filling the whole layer: no colour to match, so none of its options
        const wholeFill = this.tool === 'fill' && o.fillWhat === 'layer';
        for (const k of this.OPTIONS[this.tool]) {
            if (wholeFill && ['tolerance', 'gaps', 'contiguous', 'sampleAll'].includes(k)) continue;
            if (k === 'fillWhat') choose('Fill', 'fillWhat', [['match', 'Matching colour'], ['layer', 'Whole layer']]).querySelector('select').addEventListener('change', () => this.buildOptions());
            if (k === 'size') {
                // (Said on hover, not along the top: the bar stays one line)
                num('Size', 'size', 1, this.sizeMax(), 1, true).title = Host.keys(this.tool === 'spray'
                    ? 'The wheel over the photo sizes it, [ and ] too (Ctrl+wheel zooms)'
                    : 'The wheel over the photo sizes it, [ and ] too (Ctrl+wheel zooms). Shift-click paints a straight line on from the last stroke');
            }
            if (k === 'hardness') num('Hardness', 'hardness', 0, 100);
            if (k === 'opacity') num('Opacity', 'opacity', 1, 100);
            if (k === 'flow') num('Flow', 'flow', 1, 100);
            if (k === 'density') num('Density', 'density', 1, 100);
            if (k === 'tolerance') num('Tolerance', 'tolerance', 0, 255);
            if (k === 'range') num('Range', 'range', 1, 100).title = 'How far from the colour clicked a colour can be and still change (its lighter and darker shades are caught first)';
            if (k === 'lineWidth') num('Line', 'lineWidth', 0, 200);
            if (k === 'fontSize') num('Size', 'fontSize', 6, 600, 1, true);
            if (k === 'gaps') choose('Close gaps', 'gaps', [[0, 'Off'], [2, 'Small'], [5, 'Medium'], [10, 'Large']]).title = 'A line drawing with small gaps in its lines still fills one area, not the whole picture';
            if (k === 'contiguous') check('Joined only', 'contiguous');
            if (k === 'sampleAll') {
                const c = check('All layers', 'sampleAll');
                if ((this.RETOUCH.includes(this.tool) || this.TONE.includes(this.tool)) && c) c.title = 'Copy from the picture as it looks (this layer and those under it), not just this layer';
            }
            if (k === 'strength') num('Strength', 'strength', 1, 100);
            if (k === 'wet') num('Wet', 'wet', 0, 100).title = 'How much of the colours it goes over it picks up and blends with its own';
            if (k === 'texture') choose('Texture', 'texture', this.TEXTURES);
            if (k === 'toneRange') choose('Range', 'toneRange', [['shadows', 'Shadows'], ['mid', 'Midtones'], ['highlights', 'Highlights']]);
            if (k === 'sponge') choose('Colour', 'sponge', [['less', 'Less'], ['more', 'More']]);
            if (k === 'aligned') {
                const c = check('Aligned', 'aligned');
                if (c) c.title = 'On: each stroke goes on copying from the same distance away. Off: each stroke starts again from where you Alt-clicked';
            }
            if (k === 'arrow') check('Arrow', 'arrow');
            if (k === 'shapeLayer') {
                const c = check('New layer', 'shapeLayer');
                if (c) c.title = 'On: each shape is a layer of its own, its line and fill changed later. Off: drawn onto this layer';
            }
            if (k === 'bold') toggle('Bold', 'bold', '<b>B</b>');
            if (k === 'italic') toggle('Italic', 'italic', '<i>I</i>');
            if (k === 'align') segment('Align', 'align', [
                ['left', 'Left', lines('<path d="M4 6h16M4 12h10M4 18h13"/>')],
                ['center', 'Centre', lines('<path d="M4 6h16M7 12h10M5.5 18h13"/>')],
                ['right', 'Right', lines('<path d="M4 6h16M10 12h10M7 18h13"/>')]
            ]);
            if (k === 'outline') {
                const c = num('Outline', 'outline', 0, 50);
                if (c) c.title = 'An outline round the letters, in the background colour';
            }
            if (k === 'shapeFill') {
                // As MS Paint has them: the outline in the brush colour, the
                // fill in it too (Filled) or in the background colour
                const c = choose('Style', 'shapeFill', [['none', 'Outline'], ['fg', 'Filled'], ['bg', 'Outline and fill']]);
                if (c) c.title = 'Outline: the brush colour. Filled: all the brush colour. Outline and fill: filled with the background colour';
            }
            if (k === 'corner') num('Corners', 'corner', 0, 200, 1);
            if (k === 'gradient') choose('Shape', 'gradient', [['linear', 'Linear'], ['radial', 'Radial']]);
            if (k === 'gradTo') choose('To', 'gradTo', [['bg', 'Background colour'], ['clear', 'Nothing']]);
            if (k === 'font') choose('Font', 'font', this.FONTS);
            if (k === 'stamp') choose('Stamp', 'stamp', Object.entries(this.STAMP_NAMES));
            if (k === 'tip') {
                const own = this.ownBrushes();
                if (own.length) {
                    if (!own.some(b => b.id === o.tip)) o.tip = own[0].id;
                    choose('Tip', 'tip', own.map(b => [b.id, b.name]));
                }
            }
        }
        const hint = document.createElement('span');
        hint.className = 'paint-opt paint-hint';
        hint.textContent = {
            move: this.sel ? 'Drag what\'s selected; its corners scale it, the knob above turns it. Enter puts it down' : 'Drag the layer; select first to move part of it',
            'rect-select': 'Drag a rectangle. Shift adds, Alt takes away; Ctrl+D selects nothing',
            'ellipse-select': 'Drag an ellipse. Shift adds, Alt takes away',
            lasso: 'Draw round what to select. Shift adds, Alt takes away',
            wand: 'Click a colour to select it. Shift adds, Alt takes away',
            picker: 'Click or drag for the foreground colour, Alt for the background. With a brush, hold Alt to pick',
            hand: 'Drag to move about; Shift-drag turns the view; the wheel zooms; double-click fits',
            text: 'Click where the text goes; Ctrl+Enter puts it down',
            fill: wholeFill ? 'Click to fill the whole layer (or what\'s selected) with the foreground colour' : 'Click to fill with the foreground colour',
            gradient: 'Drag from where it starts to where it ends',
            recolor: 'Click a colour: it becomes the foreground colour everywhere, its shading kept',
            pixel: 'Square pixels on a grid the brush\'s size, crisp at any zoom',
            can: 'Hold to spray: the longer it\'s held, the more dots',
            stamp: 'Click for a stamp; drag for a row of them',
            charcoal: 'Grainy, as on rough paper; with a pen, tilt it for a broad side',
            watercolour: 'See-through: it pools at its edges, and darkens where strokes cross',
            texture: 'Paints through the texture; go over it again to fill it in',
            mixer: 'Starts with the brush colour and blends in the colours it goes over',
            custom: this.ownBrushes().length ? 'One of your own brushes; ⋯ → Brushes makes more' : 'Make one first: select part of the picture, then ⋯ → Brushes',
            'spot-heal': 'Paint over a mark or a speck: it\'s filled from what\'s round it',
            heal: this.healSrc ? 'Paint over what to hide: copied from the + mark, in the colours round it. Alt-click to copy from elsewhere' : 'Alt-click where to copy from, then paint over what to hide',
            ink: 'Thin when you go fast, thick when slow; with a pen, as hard as you press',
            marker: 'See-through, like a felt pen: where strokes cross, it\'s darker',
            airbrush: 'Soft: hold still or go over it again to build it up',
            'eraser-soft': 'Soft: hold still or go over it again to take more off',
            'eraser-block': 'A hard square, like the pencil',
            dodge: 'Paint to lighten; again over it for more',
            burn: 'Paint to darken; again over it for more',
            sponge: 'Paint to take colour out, or (More) to put it in',
            blur: 'Paint to soften; again over it for more',
            sharpen: 'Paint to make it crisper; a little goes a long way',
            smudge: 'Drag: the colours under the brush go with it',
            clone: this.healSrc ? 'Paint: copied from the + mark. Alt-click to copy from elsewhere' : 'Alt-click where to copy from, then paint'
        }[this.tool] || '';
        // On a mask: what the colours do there
        if (this.onMask && this.layer() && this.layer().mask && this.isBrush()) hint.textContent = 'On the mask: black hides the layer, white shows it again (X swaps them)';
        hint.textContent = Host.keys(hint.textContent);
        if (hint.textContent) {
            hint.title = hint.textContent;
            hint.style.color = 'var(--text-3, var(--text-2))';
            add(hint);
        }
    },

    // ---- Colours ----

    // Saved colours: kept between sessions (the plan's starting row until
    // the first is saved or taken off)
    PALETTE_MAX: 32,

    savedColours() {
        try {
            const v = JSON.parse(localStorage.getItem('jeditor.paintColours') || 'null');
            if (Array.isArray(v)) return v.filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, this.PALETTE_MAX);
        } catch (e) { /* private mode */ }
        return this.PALETTE.slice();
    },

    setSavedColours(list) {
        try { localStorage.setItem('jeditor.paintColours', JSON.stringify(list)); } catch (e) { /* private mode */ }
        this.drawPalette();
    },

    // + saves the brush colour (at the end; one already saved isn't saved twice)
    saveColour(c = this.fg) {
        const list = this.savedColours();
        c = c.toLowerCase();
        if (list.includes(c)) { this.app.showToast('That colour is saved already', 1400); return; }
        if (list.length >= this.PALETTE_MAX) { this.app.showToast(`Up to ${this.PALETTE_MAX} saved colours: right-click one to take it off`, 2200); return; }
        this.setSavedColours([...list, c]);
    },

    removeColour(c) {
        this.setSavedColours(this.savedColours().filter(x => x !== c));
    },

    drawPalette() {
        const pal = this.el('paint-palette');
        if (!pal) return;
        pal.textContent = '';
        for (const c of this.savedColours()) {
            const b = document.createElement('button');
            b.style.background = c;
            b.title = `${c} (Alt-click: background; right-click to take it off)`;
            b.setAttribute('aria-label', c);
            b.addEventListener('click', (e) => { b.blur(); if (e.altKey) this.bg = c; else this.fg = c; this.syncColours(); this.remember(); });
            b.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.app.openContextMenu([['Use for the brush', () => { this.fg = c; this.syncColours(); this.remember(); }], ['Use for the background', () => { this.bg = c; this.syncColours(); this.remember(); }], ['—'], ['Take it off', () => this.removeColour(c), true]], e.clientX, e.clientY);
            });
            pal.appendChild(b);
        }
        const add = document.createElement('button');
        add.className = 'paint-palette-add';
        add.title = 'Save the brush colour';
        add.setAttribute('aria-label', 'Save the brush colour');
        add.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
        add.addEventListener('click', () => { add.blur(); this.saveColour(); });
        pal.appendChild(add);
    },

    syncColours() {
        this.el('paint-fg').value = this.fg;
        this.el('paint-bg').value = this.bg;
    },

    swapColours() {
        [this.fg, this.bg] = [this.bg, this.fg];
        this.syncColours();
        this.remember();
    },

    defaultColours() {
        this.fg = '#000000';
        this.bg = '#ffffff';
        this.syncColours();
        this.remember();
    },

    // ---- The view ----

    sizeCanvas() {
        const r = this.stage.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.cssW = r.width;
        this.cssH = r.height;
        this.canvas.width = Math.max(1, Math.round(r.width * dpr));
        this.canvas.height = Math.max(1, Math.round(r.height * dpr));
        this.dpr = dpr;
    },

    // Where the fitted picture goes in the stage: 24px round it, and in
    // jEditor's own look clear of what floats over the stage, by the
    // gutter: the head's pills at the top, the tools at the left, the
    // options at the bottom (the owner: pills never on the photo at Fit)
    fitBox() {
        const pad = 24, box = { l: pad, t: pad, r: pad, b: pad };
        if (!document.documentElement.hasAttribute('data-skin') && this.root) {
            const st = this.el('paint-stage').getBoundingClientRect();
            const g = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 20;
            const over = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return r.width && r.right > st.left && r.left < st.right && r.bottom > st.top && r.top < st.bottom ? r : null; };
            const head = this.root.querySelector('.paint-head');
            const pills = head ? [...head.querySelectorAll('.mode-file, .mode-head-acts')].map(over).filter(Boolean) : [];
            if (pills.length) box.t = Math.max(pad, Math.max(...pills.map(r => r.bottom)) - st.top + g);
            const tools = over(this.el('paint-tools'));
            if (tools) box.l = Math.max(pad, tools.right - st.left + g);
            const opts = this.el('paint-options');
            if (opts && opts.children.length && opts.getClientRects().length) box.b = Math.max(pad, opts.getBoundingClientRect().height + 2 * g);
        }
        return { x: box.l, y: box.t, w: Math.max(1, this.cssW - box.l - box.r), h: Math.max(1, this.cssH - box.t - box.b) };
    },

    fit() {
        if (!this.ready) return;
        const r = (this.view && this.view.r) || 0;
        // Turned (View → Rotate), the picture's bounds turned
        const c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
        const bw = this.OW * c + this.OH * sn, bh = this.OW * sn + this.OH * c;
        const f = this.fitBox();
        const z = Math.min(f.w / bw, f.h / bh, 8);
        this.view = { z, x: 0, y: 0, r };
        this.place({ x: this.OW / 2, y: this.OH / 2 }, f.x + f.w / 2, f.y + f.h / 2);
        this.fitted = true;
        this.positionText();
        this.render();
    },

    zoomTo(z) {
        this.zoomAt(z, this.cssW / 2, this.cssH / 2);
    },

    zoomAt(z, cx, cy) {
        if (!this.ready) return;
        z = Math.min(32, Math.max(0.02, z));
        this.fitted = false;
        const o = this.V().inverse().transformPoint({ x: cx, y: cy });
        this.view.z = z;
        this.place(o, cx, cy);
        this.positionText();
        this.renderSoon();
    },

    // The view moved so the picture's point o is at (cx, cy) on screen
    place(o, cx, cy) {
        this.view.x = this.view.y = 0;
        const q = this.V().transformPoint(o);
        this.view.x = cx - q.x;
        this.view.y = cy - q.y;
    },

    // ---- Turning the view (not the picture): View → Rotate, < and >,
    // Shift-drag with the Hand. Straight again with Put the view straight
    // or a click on the angle in the zoom pill ----

    rotateViewTo(deg, cx = this.cssW / 2, cy = this.cssH / 2) {
        if (!this.ready) return;
        // Within a degree of straight (or a quarter turn) it's that
        let a = ((deg % 360) + 540) % 360 - 180;
        for (const q of [-180, -90, 0, 90, 180]) if (Math.abs(a - q) < 1) a = q;
        const o = this.V().inverse().transformPoint({ x: cx, y: cy });
        this.view.r = a * Math.PI / 180;
        this.place(o, cx, cy);
        if (this.fitted) this.fit();
        this.positionText();
        this.renderSoon();
    },

    viewAngle() {
        return Math.round(((this.view && this.view.r) || 0) * 180 / Math.PI);
    },

    // The view as a matrix: the picture shown (output px) → css px
    V() {
        const v = this.view;
        return new DOMMatrix().translate(v.x, v.y).rotate((v.r || 0) * 180 / Math.PI).scale(v.z);
    },

    // A pointer event → the picture shown (output px) and layer px
    point(e) {
        const r = this.canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        const o = this.V().inverse().transformPoint({ x: sx, y: sy });
        const l = this.Ci.transformPoint(o);
        // A pen's pressure (a mouse or a finger paints at full size)
        const pr = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;
        return { sx, sy, ox: o.x, oy: o.y, x: l.x, y: l.y, pr, tilt: this.tiltOf(e), shift: e.shiftKey };
    },

    // A pen's tilt: the round brushes lie over on their side, longer the
    // further it leans, along the way it leans (on the layer, the view's
    // and the layer's turn taken off). Upright, a mouse or a finger: none
    tiltOf(e) {
        if (e.pointerType !== 'pen') return null;
        const tx = e.tiltX || 0, ty = e.tiltY || 0, m = Math.hypot(tx, ty);
        if (m < 8) return null;
        const v = this.Ci.transformPoint({ x: 1, y: 0 }), o = this.Ci.transformPoint({ x: 0, y: 0 });
        const a = Math.atan2(ty, tx) - (this.view.r || 0) + Math.atan2(v.y - o.y, v.x - o.x);
        return { a, k: 1 + Math.min(m, 70) / 70 * 1.6 };
    },

    // The next frame, quickly (a stroke, the brush following the pointer);
    // the fine one once things stop
    renderSoon() {
        if (this._raf || !this.ready) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this.render({ quick: true }); });
    },

    render({ quick = false } = {}) {
        if (!this.ready) return;
        clearTimeout(this._fine);
        quick = quick || !!this.drag;
        if (quick) this._fine = setTimeout(() => this.render(), 200);
        const ctx = this.canvas.getContext('2d');
        const dpr = this.dpr || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        const VD = new DOMMatrix([dpr, 0, 0, dpr, 0, 0]).multiply(this.V());
        // The photo, drawn at screen size once for this view (a fine
        // downscale of a big photo every frame is what made strokes lag)
        ctx.drawImage(this.shown(VD), 0, 0);
        ctx.setTransform(VD);
        this.showZoom();
        ctx.imageSmoothingEnabled = this.view.z < 2;
        // Layers: the quick downscale while drawing, the fine one once it stops
        ctx.imageSmoothingQuality = quick ? 'low' : 'high';
        // Clipped to the picture (a crop shows only its part of the layers)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, this.OW, this.OH);
        ctx.clip();
        const LD = VD.multiply(this.C);
        this.layers.forEach((l, i) => {
            if (!this.isShown(l) || (this.text && this.text.layer === l)) return;
            if (l.adj) {
                // What's under it, as shown, adjusted (through its mask,
                // as it's being painted)
                const stroking = i === this.cur && this.drag && this.drag.stroke && this.drag.target && this.drag.target.isMask;
                const m = l.mask && (stroking ? this.preview(this.drag.target) : l.mask);
                ctx.save();
                // A filter (slow): kept while what's under it is the same,
                // and while something's being dragged, until it's let go
                let key = null;
                if (Paint.ADJ[l.adj.kind][2]) {
                    const v = this.view;
                    key = [l.id, JSON.stringify(l.adj), v.z, v.x, v.y, v.r, ctx.canvas.width, ctx.canvas.height, this.history.length, this.future.length, this.cur, i].join('|');
                    if (this.drag && this._fxKey && this._fxKey.startsWith(l.id + '|' + JSON.stringify(l.adj) + '|' + [v.z, v.x, v.y, v.r].join('|'))) key = this._fxKey;
                    else if (!this.drag) this._fxKey = key;
                }
                const pr = [[0, 0], [this.OW, 0], [0, this.OH], [this.OW, this.OH]].map(([x, y]) => VD.transformPoint({ x, y }));
                const px = pr.map(q => q.x), py = pr.map(q => q.y);
                const rect = { x: Math.min(...px), y: Math.min(...py), w: Math.max(...px) - Math.min(...px), h: Math.max(...py) - Math.min(...py) };
                Paint.adjustCanvas(ctx.canvas, l.adj, m ? (t) => { t.setTransform(LD); t.drawImage(m, 0, 0); } : null, l.opacity, Math.hypot(LD.a, LD.b), key, rect);
                ctx.restore();
                return;
            }
            ctx.save();
            ctx.globalAlpha = l.opacity;
            ctx.globalCompositeOperation = l.blend;
            ctx.setTransform(LD);
            let src = l.canvas;
            // The stroke being made, shown as it'll go on (on the mask: the
            // mask as it'll be)
            const stroking = i === this.cur && this.drag && this.drag.stroke;
            const onMask = stroking && this.drag.target && this.drag.target.isMask;
            if (stroking && !onMask) src = this.preview(l);
            if (l.mask) src = this.maskedNow(src, onMask ? this.preview(this.drag.target) : l.mask);
            const base = this.baseOf(i);
            if (base >= 0) src = this.clipNow(src, this.layers[base]);
            ctx.drawImage(src, 0, 0);
            if (i === this.cur && this.float) this.drawFloat(ctx, VD);
            ctx.restore();
        });
        ctx.restore();
        const loupe = this.picking() && this.hover ? this.sampleLoupe(ctx) : null;
        if (this.crop) { this.drawCrop(ctx, VD); return; }
        this.drawSelection(ctx, VD, LD);
        this.drawGuides(ctx, VD, LD);
        this.drawSnapLines(ctx, VD);
        if (loupe) this.drawLoupe(ctx, loupe);
    },

    // The picture round the pointer, before anything's drawn over it
    // (9 by 9 of the screen's pixels)
    LOUPE_N: 9,

    sampleLoupe(ctx) {
        const dpr = this.dpr || 1, n = this.LOUPE_N, h = n >> 1;
        const x = Math.round(this.hover.sx * dpr) - h, y = Math.round(this.hover.sy * dpr) - h;
        try { return { x: this.hover.sx, y: this.hover.sy, img: ctx.getImageData(x, y, n, n) }; } catch (e) { return null; }
    },

    // The loupe: those pixels big, the middle one outlined, in a ring that's
    // the colour picked (above) and the brush colour (below), up and to the
    // right of the pointer, kept in the view
    drawLoupe(ctx, { x, y, img }) {
        const dpr = this.dpr || 1, n = this.LOUPE_N, R = 52, ring = 7, gap = 64;
        let cx = x + gap, cy = y - gap;
        if (cx + R + ring > this.cssW) cx = x - gap;
        if (cy - R - ring < 0) cy = y + gap;
        const c = this._loupeCv || (this._loupeCv = document.createElement('canvas'));
        c.width = c.height = n;
        c.getContext('2d').putImageData(img, 0, 0);
        const mid = ((n >> 1) * n + (n >> 1)) * 4, d = img.data;
        const picked = `rgb(${d[mid]},${d[mid + 1]},${d[mid + 2]})`;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, R + ring, Math.PI, 0);
        ctx.fillStyle = picked;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.beginPath();
        ctx.arc(cx, cy, R + ring, 0, Math.PI);
        ctx.fillStyle = this.drag && this.drag.toBg ? this.bg : this.fg;
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(c, cx - R, cy - R, R * 2, R * 2);
        ctx.restore();
        const cell = (R * 2) / n;
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeRect(cx - cell / 2 - 0.5, cy - cell / 2 - 0.5, cell + 1, cell + 1);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(cx - cell / 2 + 0.5, cy - cell / 2 + 0.5, cell - 1, cell - 1);
        for (const [r, col, w] of [[R + ring, 'rgba(0,0,0,0.45)', 1], [R, 'rgba(255,255,255,0.85)', 1.5]]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.stroke();
        }
        ctx.restore();
    },

    // The photo with its shadow, at screen size for the view VD: kept
    // until the view, the window or the photo changes
    shown(VD) {
        const c = this.canvas;
        const key = [c.width, c.height, VD.a, VD.b, VD.c, VD.d, VD.e, VD.f].join();
        const cache = this._shown;
        if (cache && cache.key === key && cache.src === this.backdrop) return cache.canvas;
        const out = cache && cache.canvas.width === c.width && cache.canvas.height === c.height ? cache.canvas : this.newCanvas(c.width, c.height);
        const g = out.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, out.width, out.height);
        g.setTransform(VD);
        g.imageSmoothingEnabled = this.view.z < 2;
        g.imageSmoothingQuality = 'high';
        g.shadowColor = 'rgba(0,0,0,0.35)';
        g.shadowBlur = 12;
        g.drawImage(this.backdrop, 0, 0);
        this._shown = { key, src: this.backdrop, canvas: out };
        return out;
    },

    // The layer with the stroke so far on it, to show: kept from frame to
    // frame and redone only where the stroke has reached since the last
    // (the whole layer each frame was too much for a laptop's graphics)
    preview(l) {
        const d = this.drag, sc = this.scratch(), g = sc.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (!d.preview) {
            g.globalCompositeOperation = 'copy';
            g.drawImage(l.canvas, 0, 0);
            g.globalCompositeOperation = 'source-over';
            d.preview = true;
            d.fresh = d.dirty && { ...d.dirty };
        }
        const f = d.fresh;
        d.fresh = null;
        if (!f) return sc;
        const x = Math.max(0, Math.floor(f.x0)), y = Math.max(0, Math.floor(f.y0));
        const w = Math.min(this.W, Math.ceil(f.x1)) - x, h = Math.min(this.H, Math.ceil(f.y1)) - y;
        if (w <= 0 || h <= 0) return sc;
        g.save();
        g.beginPath();
        g.rect(x, y, w, h);
        g.clip(); // ('copy' clears whatever's outside it)
        g.globalCompositeOperation = 'copy';
        g.drawImage(l.canvas, x, y, w, h, x, y, w, h);
        g.restore();
        this.putStroke(g, { x, y, w, h });
        return sc;
    },

    // A spare layer-sized canvas
    scratch() {
        if (!this._scratch) this._scratch = this.newCanvas();
        return this._scratch;
    },

    // ---- Pointer ----

    down(e) {
        if (!this.ready || this.busy) return;
        if (e.pointerType === 'touch' && this.touchDown(e)) return;
        this.alt = e.altKey;
        // A fresh press: only an Alt+right-drag from here on holds back the
        // menu, not one that ended without a right-click after it
        this._sized = false;
        // Alt + right-drag: the brush's size sideways, its hardness up and down
        if (e.button === 2 && e.altKey && this.isBrush()) {
            e.preventDefault();
            try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
            const p = this.point(e);
            this.drag = { kind: 'size', sx: p.sx, sy: p.sy, at: p, size: this.opts.size, hard: this.opts.hardness };
            this._sized = true;
            return;
        }
        if (e.button === 1 || e.button === 2) {
            if (e.button === 1) this.startPan(e);
            return;
        }
        e.preventDefault();
        try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
        const p = this.point(e);
        // R held: dragging turns the view
        if (this.rHeld) { this.startPan(e); this.drag.turnAlways = true; this.rHeld.used = true; return; }
        if (this.space || this.tool === 'hand') { this.startPan(e); return; }
        if (this.crop) { this.startCropDrag(p); return; }
        if (this.text && e.target !== this.el('paint-text')) { this.endText(true); return; }
        const t = this.tool;
        // The picker (I), or Alt with a tool that paints a colour: picks as
        // it's dragged, with the loupe showing what's under it
        if (this.picking()) {
            const toBg = t === 'picker' && e.altKey;
            this.drag = { kind: 'pick', toBg };
            this.pick(p, toBg);
            this.renderSoon();
            return;
        }
        if (!this.layer()) return;
        if (this.layer().hidden && !['rect-select', 'ellipse-select', 'lasso', 'wand', 'move'].includes(t)) {
            this.app.showToast('That layer is hidden: show it to paint on it', 2000);
            return;
        }
        if (this.layer().fixed && !['rect-select', 'ellipse-select', 'lasso', 'wand', 'picker'].includes(t)) { this.fixedToast(); return; }
        if (this.ERASERS.includes(t) && this.layer().lock) { this.lockedToast(); return; }
        // Heal and clone: Alt-click is where they copy from
        if ((t === 'heal' || t === 'clone') && e.altKey) { this.setSource(p); return; }
        if (this.isBrush(t)) return this.startStroke(p, e.shiftKey ? this.lastDab : null);
        if (t === 'polygon') { this.polyClick(p); return; }
        if (['line', 'arrow', 'rect', 'roundrect', 'ellipse', 'gradient', 'rect-select', 'ellipse-select'].includes(t)) {
            const sp = this.snapPoint(p);
            this.drag = { kind: 'shape', start: sp, end: sp, mode: e.altKey ? 'sub' : e.shiftKey && t.endsWith('select') ? 'add' : 'new' };
            return;
        }
        if (t === 'lasso') {
            this.drag = { kind: 'lasso', pts: [p], mode: e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new' };
            return;
        }
        if (t === 'wand') { this.wand(p, e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new'); return; }
        if (t === 'fill') { this.fillAt(p); return; }
        if (t === 'recolor') { this.recolorAt(p); return; }
        if (t === 'text') { this.startText(p); return; }
        if (t === 'move') { this.startMove(p, e); return; }
    },

    move(e) {
        if (!this.ready) return;
        if (e.pointerType === 'touch' && this.touchMove(e)) return;
        const p = this.point(e);
        const d = this.drag;
        if (!d && e.altKey !== !!this.alt) { this.alt = e.altKey; this.cursor(); }
        this.hover = d && d.kind === 'size' ? d.at : p;
        if (!d) { if (this.crop) this.cropCursor(p); this.renderSoon(); return; }
        if (d.kind === 'size') { this.sizeBy(p.sx - d.sx, p.sy - d.sy); return; }
        if (d.kind === 'pick') { this.pick(p, d.toBg); this.renderSoon(); return; }
        if (d.kind === 'pan' && (e.shiftKey || d.turnAlways)) {
            // Shift-drag with the Hand: the view turns about the middle
            const cx = this.cssW / 2, cy = this.cssH / 2;
            const ang = (q) => Math.atan2(q.sy - cy, q.sx - cx) * 180 / Math.PI;
            if (!d.turn) d.turn = { a0: ang(d), r0: this.viewAngle() };
            let deg = d.turn.r0 + ang(p) - d.turn.a0;
            if (!e.shiftKey) deg = Math.round(deg);
            else deg = Math.round(deg / 15) * 15;
            this.rotateViewTo(deg);
            // (Shift let go: it pans on from here)
            Object.assign(d, { vx: this.view.x, vy: this.view.y, sx: p.sx, sy: p.sy });
            if (!e.shiftKey && !d.turnAlways) d.turn = null;
        } else if (d.kind === 'pan') {
            this.fitted = false;
            this.view.x = d.vx + (p.sx - d.sx);
            this.view.y = d.vy + (p.sy - d.sy);
            this.positionText();
        } else if (d.kind === 'paint' && d.snap) {
            this.moveShape(p);
        } else if (d.kind === 'paint') {
            // Every point the pointer went through since the last event (a
            // fast stroke, a pen), not only the last
            const all = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
            if (all.length > 1) for (const c of all) this.strokeTo(this.smooth(this.point(c)));
            else this.strokeTo(this.smooth(p));
            if (d.pts) {
                d.pts.push({ x: p.ox, y: p.oy });
                // Held still means within a few pixels on screen
                if (Math.hypot(p.sx - d.still.sx, p.sy - d.still.sy) > 5) { d.still = p; this.holdSoon(); }
            }
        } else if (d.kind === 'shape') {
            d.end = this.snapPoint(p);
            d.shift = e.shiftKey;
        } else if (d.kind === 'lasso') {
            const last = d.pts[d.pts.length - 1];
            if (Math.hypot(p.sx - last.sx, p.sy - last.sy) >= 2) d.pts.push(p);
        } else if (d.kind === 'float') {
            this.dragFloat(p, e.shiftKey, e.ctrlKey || e.metaKey);
        } else if (d.kind === 'crop') {
            this.dragCrop(p);
        }
        this.renderSoon();
    },

    up(e) {
        if (e.pointerType === 'touch' && this.touchUp(e)) return;
        const d = this.drag;
        if (this.stage.hasPointerCapture && this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
        clearTimeout(this._hold);
        if (!d) return;
        if (d.kind === 'paint' && d.snap && d.snap.due) this.drawSnap();
        if (d.kind === 'paint') this.endStroke();
        else if (d.kind === 'shape') this.endShape(d);
        else if (d.kind === 'lasso') this.endLasso(d);
        this.drag = null;
        this.cursor();
        this.renderSoon();
    },

    startPan(e) {
        const p = this.point(e);
        this.drag = { kind: 'pan', sx: p.sx, sy: p.sy, vx: this.view.x, vy: this.view.y };
        this.cursor();
    },

    // The tools Alt turns into the colour picker
    PICKS: ['brush', 'pencil', 'spray', 'charcoal', 'watercolour', 'texture', 'mixer', 'pixel', 'can', 'stamp', 'fill', 'recolor', 'line', 'arrow', 'rect', 'roundrect', 'ellipse', 'polygon', 'gradient', 'text'],
    SHAPES: ['line', 'arrow', 'rect', 'roundrect', 'ellipse', 'polygon'],

    picking() {
        if (this.space || (this.drag && this.drag.kind === 'size')) return false;
        return this.tool === 'picker' || (!!this.alt && this.PICKS.includes(this.tool));
    },

    // Alt + right-drag: 1 px of size for each pixel sideways (more on a big
    // brush), and 1% of hardness for each pixel up; shown as it'll paint
    sizeBy(dx, dy) {
        const d = this.drag, o = this.opts;
        o.size = Math.min(this.sizeMax(), Math.max(1, d.size * Math.exp(dx / 150)));
        if ((this.OPTIONS[this.tool] || []).includes('hardness')) o.hardness = Math.round(Math.min(100, Math.max(0, d.hard - dy / 2)));
        for (const k of ['size', 'hardness']) { const row = this.optRows && this.optRows[k]; if (row) row._sync(); }
        this.remember();
        this.flashSize();
    },

    pick(p, toBg) {
        // What's on screen now, not a frame behind (the loupe is off to the
        // side, so it's never what's picked)
        this.render();
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        const dpr = this.dpr || 1;
        const px = ctx.getImageData(Math.round(p.sx * dpr), Math.round(p.sy * dpr), 1, 1).data;
        const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        if (toBg) this.bg = hex; else this.fg = hex;
        this.syncColours();
        this.remember();
    },

    // ---- Undo ----

    // Before a change to a layer's pixels: the layer as it was
    beginPixels(l) {
        const g = this.before.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(l.canvas, 0, 0);
        g.globalCompositeOperation = 'source-over';
        this._beforeOf = l;
    },

    // After it: the part that changed (r), before and after
    endPixels(l, r, { free = false, name = this.toolName(), vec = null } = {}) {
        r = this.clampRect(r);
        if (!r || this._beforeOf !== l) return;
        // A locked layer (or its mask): put back, nothing kept
        if ((l.owner || l).fixed) {
            l.canvas.getContext('2d').putImageData(this.before.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h), r.x, r.y);
            this._beforeOf = null;
            this.fixedToast();
            this.renderSoon();
            return;
        }
        const v0 = l.text || l.shape || l.src ? { text: l.text || null, shape: l.shape || null, src: l.src || null } : null;
        const before = this.before.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h);
        const after = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h);
        // Transparency locked: each pixel keeps how see-through it was (a
        // move, free, takes its pixels with it)
        if (l.lock && !free) {
            const b = before.data, a = after.data;
            for (let i = 0; i < a.length; i += 4) {
                if (b[i + 3] === 0) { a[i] = b[i]; a[i + 1] = b[i + 1]; a[i + 2] = b[i + 2]; }
                a[i + 3] = b[i + 3];
            }
            l.canvas.getContext('2d').putImageData(after, r.x, r.y);
        }
        l.changed = true;
        const entry = { kind: 'px', name, layer: l, r, before, after, bytes: r.w * r.h * 8 };
        // A text or shape layer painted on is pixels from then on (vec:
        // what it is after a move)
        if (v0 || vec) {
            Object.assign(entry, { vec0: v0, vec1: vec });
            l.text = vec ? vec.text : null;
            l.shape = vec ? vec.shape : null;
            l.src = vec ? vec.src || null : null;
            if (v0 && !vec) this.drawLayers();
        }
        this.record(entry);
    },

    clampRect(r) {
        if (!r) return null;
        const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(this.W, Math.ceil(r.x + r.w)), y1 = Math.min(this.H, Math.ceil(r.y + r.h));
        return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    },

    record(entry) {
        this.history.push(entry);
        this.historyBytes += entry.bytes || 0;
        this.future = [];
        while (this.history.length > 1 && (this.history.length > 60 || this.historyBytes > this.HISTORY_BYTES)) {
            this.historyBytes -= this.history.shift().bytes || 0;
            this.trimmed = true;
        }
        this.drawLayersSoon();
    },

    // The layer list as it is (for undoing a change to it)
    snapshot() {
        return { layers: this.layers.map(l => ({ ...l })), cur: this.cur, groups: JSON.parse(JSON.stringify(this.groups || {})) };
    },

    // name: the step, as the history lists it
    pushState(name = 'Layers') {
        this._state = this.snapshot();
        this._state.name = name;
    },

    afterState(extra = null) {
        const before = this._state;
        this._state = null;
        if (!before) return;
        const entry = { kind: 'state', name: before.name, before, after: this.snapshot(), extra, bytes: extra ? extra.bytes : 0 };
        this.record(entry);
        this.drawLayers();
        this.renderSoon();
    },

    apply(entry, undo) {
        if (entry.kind === 'view') { this.applyView(undo ? entry.before : entry.after, undo ? entry.pad0 : entry.pad1); return; }
        if (entry.kind === 'canvas') { this.applyCanvas(undo ? entry.before : entry.after); return; }
        if (entry.kind === 'px') {
            entry.layer.canvas.getContext('2d').putImageData(undo ? entry.before : entry.after, entry.r.x, entry.r.y);
            entry.layer.changed = true;
            if (entry.vec0 || entry.vec1) {
                const k = this.layers.find(x => x.canvas === entry.layer.canvas), v = undo ? entry.vec0 : entry.vec1;
                if (k) { k.text = v ? v.text : null; k.shape = v ? v.shape : null; k.src = v ? v.src || null : null; }
            }
        } else if (entry.kind === 'state') {
            if (undo && entry.extra) this.apply(entry.extra, true);
            const s = undo ? entry.before : entry.after;
            this.layers = s.layers.map(l => ({ ...l, changed: true }));
            this.groups = JSON.parse(JSON.stringify(s.groups || {}));
            this.cur = Math.min(s.cur, this.layers.length - 1);
            if (!undo && entry.extra) this.apply(entry.extra, false);
        }
    },

    undo() {
        if (this.crop) { this.endCrop(false); return true; }
        if (this.float) { this.cancelFloat(); return true; }
        if (this.text) { this.endText(false); return true; }
        if (this.poly) { this.endPoly(false); return true; }
        const e = this.history.pop();
        if (!e) return false;
        const was = this.frame();
        this.historyBytes -= e.bytes || 0;
        this.apply(e, true);
        this.future.push(e);
        this.drawLayers();
        this.puff(was);
        this.renderSoon();
        return true;
    },

    redo() {
        const e = this.future.pop();
        if (!e) return false;
        const was = this.frame();
        this.apply(e, false);
        this.history.push(e);
        this.historyBytes += e.bytes || 0;
        this.drawLayers();
        this.puff(was);
        this.renderSoon();
        return true;
    },

    // ---- The puff ----
    // Undo and Redo, one at a time: what changed puffs away (it fades,
    // softens and lifts a little), over the picture as it is now. Not
    // with Settings → Animations off, reduced motion or a theme
    // (Motion.on), nor going along the history

    // The picture as shown, before the step (null when there's no puff)
    frame() {
        if (this._batch || !this.ready || typeof Motion === 'undefined' || !Motion.on()) return null;
        const c = this.canvas;
        if (!c.width || !c.height || c.width * c.height > 9e6) return null;
        const f = document.createElement('canvas');
        f.width = c.width; f.height = c.height;
        f.getContext('2d').drawImage(c, 0, 0);
        return f;
    },

    puff(was) {
        if (!was) return;
        this.render();
        const c = this.canvas, w = c.width, h = c.height;
        if (was.width !== w || was.height !== h) return;
        const g = was.getContext('2d', { willReadFrequently: true });
        const a = g.getImageData(0, 0, w, h), b = c.getContext('2d').getImageData(0, 0, w, h).data, d = a.data;
        // Only what changed is kept on it
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0, i = 0; y < h; y++) {
            for (let x = 0; x < w; x++, i += 4) {
                if (Math.abs(d[i] - b[i]) + Math.abs(d[i + 1] - b[i + 1]) + Math.abs(d[i + 2] - b[i + 2]) + Math.abs(d[i + 3] - b[i + 3]) < 24) { d[i + 3] = 0; continue; }
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        if (x1 < 0) return;
        g.putImageData(a, 0, 0);
        if (this._puff) this._puff.remove();
        const dpr = this.dpr || 1;
        was.className = 'paint-puff';
        was.setAttribute('aria-hidden', 'true');
        was.style.transformOrigin = `${(x0 + x1) / 2 / dpr}px ${(y0 + y1) / 2 / dpr}px`;
        c.after(was);
        this._puff = was;
        const done = () => { was.remove(); if (this._puff === was) this._puff = null; };
        if (!was.animate) { done(); return; }
        was.animate([
            { opacity: 1, filter: 'blur(0)', transform: 'none' },
            { opacity: 0, filter: 'blur(6px)', transform: 'translateY(-6px) scale(1.06)' }
        ], { duration: 280, easing: 'cubic-bezier(.2, .7, .3, 1)' }).onfinish = done;
    },

    // A tool's name, as the history lists it
    toolName(t = this.tool) {
        const row = this.TOOLS.find(x => x[0] === t);
        return row ? row[1].replace(/[:(].*$/, '').trim() : 'Paint';
    },

    // ---- History ----
    //
    // ⋯ → History: the steps under the layers, the one now chosen; a click
    // or a drag along them goes there (each step undone or redone in turn)

    toggleHistory() {
        this.opts.history = !this.opts.history;
        this.remember();
        this.drawHistory();
    },

    // To n steps done (0: as opened, or as far back as is kept)
    goTo(n) {
        n = Math.max(0, Math.min(n, this.history.length + this.future.length));
        let moved = false;
        this._batch = true;
        try {
            while (this.history.length > n && this.undo()) moved = true;
            while (this.history.length < n && this.redo()) moved = true;
        } finally { this._batch = false; }
        this.drawLayers();
        return moved;
    },

    drawHistory() {
        const sec = this.el('paint-history-sec'), list = this.el('paint-history');
        if (!sec || !list) return;
        sec.classList.toggle('hidden', !this.opts.history);
        if (!this.opts.history || !this.ready) return;
        const done = this.history.length;
        const steps = [this.trimmed ? 'Earlier steps' : 'Opened', ...this.history.map(e => e.name || 'Paint'), ...this.future.slice().reverse().map(e => e.name || 'Paint')];
        list.textContent = '';
        steps.forEach((name, i) => {
            const row = document.createElement('div');
            row.className = 'paint-step' + (i > done ? ' paint-step-undone' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(i === done));
            row.dataset.step = String(i);
            row.textContent = name;
            list.appendChild(row);
        });
        const now = list.children[done];
        if (now && now.scrollIntoView) now.scrollIntoView({ block: 'nearest' });
    },

    initHistory() {
        const list = this.el('paint-history');
        if (!list) return;
        const at = (e) => {
            const row = document.elementFromPoint(e.clientX, e.clientY);
            const step = row && row.closest && row.closest('.paint-step');
            return step && list.contains(step) ? +step.dataset.step : null;
        };
        let scrubbing = false;
        list.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || this.busy || !this.ready) return;
            const n = at(e);
            if (n === null) return;
            e.preventDefault();
            scrubbing = true;
            try { list.setPointerCapture(e.pointerId); } catch (err) { /* not a live pointer */ }
            this.goTo(n);
        });
        list.addEventListener('pointermove', (e) => {
            if (!scrubbing) return;
            const n = at(e);
            if (n !== null && n !== this.history.length) this.goTo(n);
        });
        const stop = () => { scrubbing = false; };
        list.addEventListener('pointerup', stop);
        list.addEventListener('pointercancel', stop);
    },

    // ---- Taps on a touch screen ----
    //
    // Two fingers tapped: undo; three: redo. A second finger within a
    // moment of the first makes it a tap (what the first began is dropped);
    // later, other fingers are ignored and the first keeps painting

    TAP_JOIN_MS: 250,
    TAP_MS: 500,

    touchDown(e) {
        const T = this.touches || (this.touches = { ids: new Map(), main: null, tap: null });
        T.ids.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (T.ids.size === 1) {
            T.main = e.pointerId;
            T.t0 = performance.now();
            T.h0 = this.history.length;
            T.tap = null;
            return false;
        }
        e.preventDefault();
        if (!T.tap && T.main !== null && performance.now() - T.t0 < this.TAP_JOIN_MS) {
            this.dropDrag();
            T.tap = { n: 0, moved: false };
            T.main = null;
        }
        if (T.tap) T.tap.n = Math.max(T.tap.n, T.ids.size);
        return true;
    },

    touchMove(e) {
        const T = this.touches;
        if (!T || e.pointerId === T.main) return false;
        const s = T.ids.get(e.pointerId);
        if (T.tap && s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) T.tap.moved = true;
        return true;
    },

    touchUp(e) {
        const T = this.touches;
        if (!T) return false;
        T.ids.delete(e.pointerId);
        if (e.pointerId === T.main) { T.main = null; return false; }
        if (!T.tap || T.ids.size) return true;
        const tap = T.tap;
        T.tap = null;
        if (tap.moved || performance.now() - T.t0 > this.TAP_MS) return true;
        // What the first finger did at once (a fill, say) is part of the tap
        while (this.history.length > T.h0 && this.undo()) this.future.pop();
        if (tap.n === 2) { if (!this.undo()) this.app.showToast('Nothing to undo', 1200); }
        else if (tap.n === 3) { if (!this.redo()) this.app.showToast('Nothing to redo', 1200); }
        return true;
    },

    // What's being drawn, dropped (nothing goes on the layer)
    dropDrag() {
        clearTimeout(this._hold);
        const d = this.drag;
        if (!d) return;
        if (d.kind === 'paint') this.stroke.getContext('2d').clearRect(0, 0, this.W, this.H);
        this.drag = null;
        this.cursor();
        this.renderSoon();
    },

    // ---- Brushes ----

    // from: where the last stroke ended (Shift-click), to paint straight on
    // from there
    startStroke(p, from = null) {
        // Heal and clone: copied from a distance away, kept for the next
        // stroke when they're aligned
        let off = null;
        if (this.RETOUCH.includes(this.tool)) {
            if (this.tool === 'spot-heal') off = { dx: 0, dy: 0 };
            else if (!this.healSrc) {
                this.app.showToast(Host.keys('Alt-click where to copy from first'), 2200);
                return;
            } else {
                const at = from || p;
                off = this.opts.aligned && this.healOff ? this.healOff
                    : { dx: Math.round(this.healSrc.x - at.x), dy: Math.round(this.healSrc.y - at.y) };
                this.healOff = off;
            }
        }
        // (ink starts thin)
        if (this.tool === 'ink' && !from) p = { ...p, pr: (p.pr || 1) * 0.45 };
        const l = this.target();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, this.W, this.H);
        this.drag = { kind: 'paint', stroke: true, last: from || p, dirty: null, tool: this.tool, carry: 0, off, tone: this.TONE.includes(this.tool), target: l };
        if (off || this.drag.tone || this.tool === 'mixer') this.drag.base = this.healBase();
        if (this.tool === 'mixer') this.drag.mix = this.rgb(this.fg).slice(0, 3);
        if (this.drag.tone) this.drag.rad = PaintHeal.blurOf(this.tool, this.radius());
        // Symmetry (⋯): each dab again, mirrored or turned round the
        // picture's middle (not heal and clone, which copy from elsewhere)
        this.drag.sym = off ? [] : this.symMats();
        if (from) this.strokeTo(p);
        else this.dab(p);
        if (this.tool === 'spray' || this.tool === 'can' || (this.FEEL[this.tool] || {}).build) this.sprayLoop();
        // QuickShape: the stroke's points as shown, to fit a shape to when
        // the pointer's held still (not for stamps)
        else if (this.opts.quickShape && this.tool !== 'stamp' && !off && !this.drag.tone) {
            const first = from ? this.C.transformPoint(from) : { x: p.ox, y: p.oy };
            this.drag.pts = [{ x: first.x, y: first.y }, { x: p.ox, y: p.oy }];
            this.drag.still = p;
            this.holdSoon();
        }
        this.renderSoon();
    },

    // Brush size in layer px (sizes are the photo's own pixels)
    radius() {
        return Math.max(0.5, this.opts.size / 2);
    },

    grow(r) {
        const d = this.drag;
        // Where it's grown since the stroke was last shown (preview)
        const f = d.fresh;
        d.fresh = f ? { x0: Math.min(f.x0, r.x), y0: Math.min(f.y0, r.y), x1: Math.max(f.x1, r.x + r.w), y1: Math.max(f.y1, r.y + r.h) }
            : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
        if (!d.dirty) d.dirty = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
        else {
            d.dirty.x0 = Math.min(d.dirty.x0, r.x); d.dirty.y0 = Math.min(d.dirty.y0, r.y);
            d.dirty.x1 = Math.max(d.dirty.x1, r.x + r.w); d.dirty.y1 = Math.max(d.dirty.y1, r.y + r.h);
        }
    },

    dab(p) {
        this.dabAt(p);
        for (const M of this.drag.sym || []) {
            const q = M.transformPoint(p), tl = p.tilt;
            let tilt = null;
            if (tl) {
                const o = M.transformPoint({ x: 0, y: 0 }), v = M.transformPoint({ x: Math.cos(tl.a), y: Math.sin(tl.a) });
                tilt = { a: Math.atan2(v.y - o.y, v.x - o.x), k: tl.k };
            }
            this.dabAt({ ...p, x: q.x, y: q.y, tilt });
        }
    },

    // Symmetry: the picture's middle, mirrored left and right, top and
    // bottom, both, or turned round it 3 to 8 times
    SYMMETRY: [['off', 'Off'], ['x', 'Left and right'], ['y', 'Top and bottom'], ['xy', 'Both ways'], ['r3', 'Round, 3 times'], ['r4', 'Round, 4 times'], ['r6', 'Round, 6 times'], ['r8', 'Round, 8 times']],

    // Each copy, as layer px to layer px
    symMats() {
        const s = this.opts.symmetry || 'off', ms = [];
        if (s === 'x' || s === 'xy') ms.push(new DOMMatrix().scale(-1, 1));
        if (s === 'y' || s === 'xy') ms.push(new DOMMatrix().scale(1, -1));
        if (s === 'xy') ms.push(new DOMMatrix().scale(-1, -1));
        if (s[0] === 'r') for (let i = 1, n = +s.slice(1); i < n; i++) ms.push(new DOMMatrix().rotate(360 * i / n));
        const cx = this.OW / 2, cy = this.OH / 2;
        return ms.map(m => this.Ci.multiply(new DOMMatrix().translate(cx, cy).multiply(m).translate(-cx, -cy)).multiply(this.C));
    },

    setSymmetry(v) {
        this.opts.symmetry = v;
        this.remember();
        this.renderSoon();
    },

    dabAt(p) {
        const g = this.stroke.getContext('2d');
        const t = this.drag.tool, pr = p.pr || 1;
        // A pen's pressure: the brush's size, its opacity, or both (⋯);
        // ink always thins as it's pressed lighter
        const prSize = t === 'ink' || this.opts.pressure !== 'opacity' ? pr : 1;
        const r = Math.max(0.5, this.radius() * prSize);
        const colour = this.ERASERS.includes(t) ? '#000000' : this.fg;
        if (this.drag.off) { this.healDab(g, p, r); return; }
        if (this.drag.tone) { this.toneDab(g, p, r); return; }
        if (t === 'pencil' || t === 'eraser-block') {
            const s = Math.max(1, Math.round(this.opts.size * prSize));
            g.fillStyle = colour;
            g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
            this.grow({ x: p.x - s, y: p.y - s, w: 2 * s, h: 2 * s });
            return;
        }
        if (t === 'pixel') {
            const s = this.pixelCell(), x = Math.floor(p.x / s) * s, y = Math.floor(p.y / s) * s;
            g.fillStyle = colour;
            g.fillRect(x, y, s, s);
            this.grow({ x: x - 1, y: y - 1, w: s + 2, h: s + 2 });
            return;
        }
        if (t === 'can') {
            // Hard dots, each a whole pixel (bigger on a big can), anywhere
            // in the round: fewer than the spray's, as a can's are
            const R = this.radius(), dot = Math.max(1, Math.round(R / 16));
            const n = Math.max(1, Math.round(this.opts.density * R / 40));
            g.fillStyle = colour;
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R;
                g.fillRect(Math.round(p.x + Math.cos(a) * d), Math.round(p.y + Math.sin(a) * d), dot, dot);
            }
            this.grow({ x: p.x - R - dot - 1, y: p.y - R - dot - 1, w: 2 * (R + dot + 1), h: 2 * (R + dot + 1) });
            return;
        }
        if (t === 'stamp') {
            const s = Math.max(4, this.opts.size);
            this.drawStamp(g, p.x, p.y, s, colour);
            this.grow({ x: p.x - s / 2 - 1, y: p.y - s / 2 - 1, w: s + 2, h: s + 2 });
            return;
        }
        if (t === 'spray') {
            const n = Math.max(1, Math.round(this.opts.density * r * r / 400));
            const dot = Math.max(0.6, r / 24);
            g.fillStyle = colour;
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
                g.beginPath();
                g.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, dot, 0, Math.PI * 2);
                g.fill();
            }
            this.grow({ x: p.x - r - 2, y: p.y - r - 2, w: 2 * r + 4, h: 2 * r + 4 });
            return;
        }
        const feel = this.FEEL[t] || {};
        const hard = feel.hard !== undefined ? feel.hard : ['eraser', 'brush', 'texture', 'mixer'].includes(t) ? this.opts.hardness / 100 : 1;
        let flow = (feel.flow ? this.opts.flow / 100 : 1) * (feel.build || 1);
        // Pressure for opacity: each dab lighter, so where they overlap
        // along the stroke (about 2r / step of them) it comes to the pressure
        if (pr < 1 && t !== 'ink' && this.opts.pressure !== 'size') flow *= 1 - Math.pow(1 - pr, 0.09);
        if (t === 'custom') { this.tipDab(g, p, prSize, colour, flow); return; }
        let rgb = this.rgb(colour), rr = r;
        if (t === 'mixer') rgb = this.mixDab(p, r);
        // (watercolour: each dab a little bigger or smaller, so its edge wanders)
        if (feel.wet) rr = r * (0.88 + Math.random() * 0.24);
        const c = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
        g.save();
        g.translate(p.x, p.y);
        // A pen's tilt: the round lies over, long the way the pen leans
        const tl = p.tilt, k = tl ? tl.k : 1;
        if (tl) { g.rotate(tl.a); g.scale(k, 1); }
        if (feel.wet) {
            // Watercolour: thin in the middle, pooled at its edge
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, rr);
            grad.addColorStop(0, c(flow * 0.1));
            grad.addColorStop(0.7, c(flow * 0.16));
            grad.addColorStop(0.9, c(flow * 0.3));
            grad.addColorStop(1, c(0));
            g.fillStyle = grad;
        } else if (hard >= 0.99) {
            g.fillStyle = c(flow);
        } else {
            const grad = g.createRadialGradient(0, 0, rr * hard, 0, 0, rr);
            grad.addColorStop(0, c(flow));
            grad.addColorStop(1, c(0));
            g.fillStyle = grad;
        }
        g.beginPath();
        g.arc(0, 0, rr, 0, Math.PI * 2);
        g.fill();
        g.restore();
        const R = rr * k;
        this.grow({ x: p.x - R - 1, y: p.y - R - 1, w: 2 * R + 2, h: 2 * R + 2 });
    },

    // The mixer: the colour it lays down is its own (the brush colour to
    // start) blended with what's under it, as wet as it's set; and what it
    // lays down slowly becomes its own, so a stroke carries colour along
    mixDab(p, r) {
        const d = this.drag, wet = this.opts.wet / 100;
        const n = Math.max(1, Math.min(12, Math.round(r))), x = Math.round(p.x - n / 2), y = Math.round(p.y - n / 2);
        const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.W, x + n), y1 = Math.min(this.H, y + n);
        let sr = 0, sg = 0, sb = 0, sa = 0;
        if (x1 > x0 && y1 > y0) {
            const px = d.base.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, x1 - x0, y1 - y0).data;
            for (let i = 0; i < px.length; i += 4) {
                const a = px[i + 3];
                sr += px[i] * a; sg += px[i + 1] * a; sb += px[i + 2] * a; sa += a;
            }
        }
        const m = d.mix;
        if (sa > 0) {
            const w = wet * Math.min(1, sa / (255 * (x1 - x0) * (y1 - y0)));
            const s = [sr / sa, sg / sa, sb / sa], out = m.map((v, i) => v + (s[i] - v) * w);
            for (let i = 0; i < 3; i++) m[i] += (out[i] - m[i]) * 0.1;
            return out.map(Math.round);
        }
        return m.map(Math.round);
    },

    // The grains charcoal and the texture brush paint through: 128 px
    // squares, repeated, fixed to the picture; made once each
    grain(name) {
        if (!this._grains) this._grains = {};
        if (this._grains[name]) return this._grains[name];
        const N = 128, c = this.newCanvas(N, N), g = c.getContext('2d'), img = g.createImageData(N, N), a = img.data;
        // (the same grain every time: a seeded random)
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        // A smooth noise, cells c across, for paper's lumps
        const lumps = (cells) => {
            const v = Array.from({ length: cells * cells }, rnd), f = (t) => t * t * (3 - 2 * t);
            return (x, y) => {
                const gx = x / N * cells, gy = y / N * cells, i = Math.floor(gx), j = Math.floor(gy), u = f(gx - i), w = f(gy - j);
                const at = (ii, jj) => v[((jj % cells) * cells) + (ii % cells)];
                return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - w) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * w;
            };
        };
        const big = lumps(8), small = lumps(32);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                let v;
                if (name === 'charcoal') v = small(x, y) * 0.6 + rnd() * 0.5 > 0.5 ? 0.75 + rnd() * 0.25 : rnd() * 0.25;
                else if (name === 'canvas') {
                    // woven: threads one way, then the other, in a checker
                    const over = ((x >> 2) + (y >> 2)) & 1, t = over ? x % 4 : y % 4;
                    v = 0.45 + 0.5 * Math.sin((t + 0.5) / 4 * Math.PI) - rnd() * 0.15;
                } else if (name === 'paper') v = 0.25 + big(x, y) * 0.45 + small(x, y) * 0.3 + (rnd() - 0.5) * 0.15;
                else v = rnd() < 0.5 ? 0.9 : rnd() * 0.3;
                a[(y * N + x) * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, v)));
            }
        }
        g.putImageData(img, 0, 0);
        return (this._grains[name] = c);
    },

    // The stroke through its grain (charcoal, the texture brush), on a
    // canvas of its own so the stroke itself keeps building up under it
    grained(name, r) {
        let c = this._grained;
        if (!c || c.width !== this.W || c.height !== this.H) c = this._grained = this.newCanvas();
        const g = c.getContext('2d');
        g.save();
        if (r) { g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); }
        g.globalCompositeOperation = 'copy';
        g.drawImage(this.stroke, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = g.createPattern(this.grain(name), 'repeat');
        g.fillRect(0, 0, this.W, this.H);
        g.restore();
        return c;
    },

    // ---- Your brushes (like Photoshop's Define Brush) ----
    // A tip made from part of the picture, or from a picture file: what's
    // dark in it paints (or, where it's see-through, its shape), up to
    // TIP_MAX across. Named and kept (localStorage), listed in ⋯ → Brushes
    // and in the Brush slot as Your brush, with the tip chosen along the top

    BRUSH_MAX: 24,
    TIP_MAX: 256,

    ownBrushes() {
        try {
            const v = JSON.parse(localStorage.getItem('jeditor.paintBrushes') || '[]');
            if (Array.isArray(v)) return v.filter(b => b && typeof b.id === 'string' && typeof b.name === 'string' && /^data:image\/png;base64,/.test(b.data || '')).slice(0, this.BRUSH_MAX);
        } catch (e) { /* private mode */ }
        return [];
    },

    setOwnBrushes(list) {
        try {
            localStorage.setItem('jeditor.paintBrushes', JSON.stringify(list));
        } catch (e) {
            this.app.showToast('Couldn\'t keep the brush: there\'s no room left for it', 2500);
            return false;
        }
        this.loadTips();
        if (this.tool === 'custom') this.buildOptions();
        return true;
    },

    // The tips, decoded once (a dab draws straight away)
    loadTips() {
        if (!this._tips) this._tips = new Map();
        const own = this.ownBrushes();
        for (const id of [...this._tips.keys()]) if (!own.some(b => b.id === id)) this._tips.delete(id);
        for (const b of own) {
            if (this._tips.has(b.id)) continue;
            const img = new Image();
            img.src = b.data;
            this._tips.set(b.id, { img, tinted: null, colour: null });
        }
    },

    // The tip in this colour (made again when the colour changes)
    tinted(id, colour) {
        if (!this._tips) this.loadTips();
        const t = this._tips.get(id);
        if (!t || !t.img.complete || !t.img.naturalWidth) return null;
        if (t.tinted && t.colour === colour) return t.tinted;
        const c = t.tinted || document.createElement('canvas');
        c.width = t.img.naturalWidth;
        c.height = t.img.naturalHeight;
        const g = c.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(t.img, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = colour;
        g.fillRect(0, 0, c.width, c.height);
        t.tinted = c;
        t.colour = colour;
        return c;
    },

    // One dab of the tip: Size is its long side
    tipDab(g, p, prSize, colour, flow) {
        const tip = this.tinted(this.opts.tip, colour);
        if (!tip) return;
        const s = Math.max(1, this.opts.size * prSize), k = s / Math.max(tip.width, tip.height);
        const w = tip.width * k, h = tip.height * k;
        g.save();
        g.globalAlpha = Math.min(1, flow);
        g.imageSmoothingQuality = 'high';
        g.drawImage(tip, p.x - w / 2, p.y - h / 2, w, h);
        g.restore();
        this.grow({ x: p.x - w / 2 - 1, y: p.y - h / 2 - 1, w: w + 2, h: h + 2 });
    },

    // Pixels (a canvas) → a tip: black, its alpha what paints, cropped to
    // what paints and made no more than TIP_MAX across. Null: nothing would
    tipFrom(src) {
        const W = src.width, H = src.height;
        if (!W || !H) return null;
        const px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
        // See-through somewhere: its shape paints; else what's dark does
        let clear = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] < 250) clear++;
        const shape = clear > W * H * 0.01;
        const a = new Uint8ClampedArray(W * H);
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
            const j = i * 4, al = px[j + 3];
            const lum = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
            const v = shape ? al : Math.round((255 - lum) * al / 255);
            a[i] = v;
            if (v > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) return null;
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const full = document.createElement('canvas');
        full.width = cw;
        full.height = ch;
        const fg = full.getContext('2d');
        const img = fg.createImageData(cw, ch);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img.data[(y * cw + x) * 4 + 3] = a[(y + y0) * W + x + x0];
        fg.putImageData(img, 0, 0);
        const k = Math.min(1, this.TIP_MAX / Math.max(cw, ch));
        if (k === 1) return full;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(cw * k));
        out.height = Math.max(1, Math.round(ch * k));
        const og = out.getContext('2d');
        og.imageSmoothingQuality = 'high';
        og.drawImage(full, 0, 0, out.width, out.height);
        full.width = full.height = 0;
        return out;
    },

    // What's selected of the picture as it looks (the photo and the layers
    // shown), cut to the selection's bounds
    selectedPixels() {
        if (!this.sel || !this.sel.box) return null;
        const b = this.sel.box;
        const c = document.createElement('canvas');
        c.width = b.w;
        c.height = b.h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.translate(-b.x, -b.y);
        g.drawImage(this.photo, 0, 0, this.W, this.H);
        for (const l of this.layers) {
            if (!this.isShown(l)) continue;
            this.drawShown(g, l);
        }
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(this.sel.mask, 0, 0);
        return c;
    },

    // ⋯ → Brushes → Make a brush: from what's selected, or a picture file
    // (file: one handed in, as tests do; true: pick one)
    async defineBrush(file = null) {
        if (!this.ready || this.busy) return null;
        const own = this.ownBrushes();
        if (own.length >= this.BRUSH_MAX) { this.app.showToast(`Up to ${this.BRUSH_MAX} brushes: delete one in ⋯ → Brushes to make another`, 2500); return null; }
        let src;
        if (file) {
            if (file === true) {
                file = await new Promise((res) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.addEventListener('change', () => res(input.files[0] || null));
                    input.click();
                });
                if (!file) return null;
            }
            try {
                const bmp = await createImageBitmap(file);
                src = document.createElement('canvas');
                src.width = bmp.width;
                src.height = bmp.height;
                src.getContext('2d').drawImage(bmp, 0, 0);
                bmp.close();
            } catch (e) {
                this.app.showToast(`Couldn't open ${file.name || 'that'} as a picture`, 2500);
                return null;
            }
        } else {
            if (this.float) this.commitFloat();
            src = this.selectedPixels();
            if (!src) { this.app.showToast('Select part of the picture first, or make one from a picture file', 2500); return null; }
        }
        const tip = this.tipFrom(src);
        src.width = src.height = 0;
        if (!tip) { this.app.showToast('Nothing in it to paint with: what\'s dark, or not see-through, paints', 2500); return null; }
        const name = await UI.prompt({ title: 'Name the brush', input: { label: 'Name', value: `Brush ${own.length + 1}` }, ok: 'Keep' });
        if (name === null) return null;
        const b = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (name.trim() || `Brush ${own.length + 1}`).slice(0, 40), data: tip.toDataURL('image/png') };
        const size = Math.max(tip.width, tip.height);
        tip.width = tip.height = 0;
        if (!this.setOwnBrushes([...own, b])) return null;
        this.opts.tip = b.id;
        this.opts.size = Math.min(this.sizeMax(), Math.max(1, size));
        this.setTool('custom');
        this.remember();
        this.app.showToast(`${b.name}: kept, in ⋯ → Brushes and the Brush slot`, 2200);
        return b;
    },

    async deleteBrush(id) {
        const own = this.ownBrushes(), b = own.find(x => x.id === id);
        if (!b) return;
        const ok = await UI.confirm({ title: `Delete ${b.name}?`, message: 'The brush goes from your brushes. What it painted stays.', ok: 'Delete', danger: true });
        if (!ok) return;
        this.setOwnBrushes(own.filter(x => x.id !== id));
    },

    // ---- Brush presets ----
    // A brush with its settings, named and kept (localStorage): the tool
    // and its options (size, hardness and the rest) and how a pen works it,
    // not the colour. ⋯ → Brushes saves the brush as it's set and lists them
    PRESET_MAX: 32,
    PRESET_KEYS: ['size', 'hardness', 'opacity', 'flow', 'density', 'stamp', 'tip', 'texture', 'wet', 'strength', 'toneRange', 'sponge', 'sampleAll', 'aligned'],

    presets() {
        try {
            const v = JSON.parse(localStorage.getItem('jeditor.paintPresets') || '[]');
            if (!Array.isArray(v)) return [];
            return v.filter(b => b && typeof b.id === 'string' && typeof b.name === 'string' && this.BRUSHES.includes(b.tool) && b.opts && typeof b.opts === 'object').slice(0, this.PRESET_MAX);
        } catch (e) { return []; }
    },

    setPresets(list) {
        try {
            localStorage.setItem('jeditor.paintPresets', JSON.stringify(list));
            return true;
        } catch (e) {
            this.app.showToast('Couldn\'t keep the preset: there\'s no room left for it', 2500);
            return false;
        }
    },

    // name: as tests give it; otherwise asked for
    async savePreset(name = null) {
        if (!this.BRUSHES.includes(this.tool)) return null;
        const list = this.presets();
        if (list.length >= this.PRESET_MAX) { this.app.showToast(`Up to ${this.PRESET_MAX} presets: delete one in ⋯ → Brushes to save another`, 2500); return null; }
        const def = `${this.toolName()} ${Math.round(this.opts.size)}`;
        if (name === null) name = await UI.prompt({ title: 'Save the brush as a preset', input: { label: 'Name', value: def }, ok: 'Save' });
        if (name === null) return null;
        const keys = [...this.OPTIONS[this.tool].filter(k => this.PRESET_KEYS.includes(k)), 'smoothing', 'pressure'];
        const b = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (String(name).trim() || def).slice(0, 40), tool: this.tool, opts: {} };
        for (const k of keys) b.opts[k] = this.opts[k];
        if (!this.setPresets([...list, b])) return null;
        this.app.showToast(`Saved ${b.name}: ⋯ → Brushes`, 1800);
        return b;
    },

    usePreset(id) {
        const b = this.presets().find(x => x.id === id);
        if (!b) return;
        for (const [k, v] of Object.entries(b.opts)) if (k in this.opts && typeof v === typeof this.opts[k]) this.opts[k] = v;
        this.opts.size = Math.min(this.sizeMax(), Math.max(1, this.opts.size));
        this.setTool(b.tool);
        this.remember();
        this.buildOptions();
        this.flashSize();
    },

    async deletePreset(id) {
        const list = this.presets(), b = list.find(x => x.id === id);
        if (!b) return;
        const ok = await UI.confirm({ title: `Delete ${b.name}?`, message: 'The preset goes. What it painted stays.', ok: 'Delete', danger: true });
        if (ok) this.setPresets(list.filter(x => x.id !== id));
    },

    // ⋯ → Brushes
    brushItems() {
        const own = this.ownBrushes(), pre = this.presets();
        return [
            ...(this.BRUSHES.includes(this.tool) ? [['Save the brush as a preset…', () => this.savePreset()]] : []),
            ...(pre.length ? [['—'], ...pre.map(b => [b.name, () => this.usePreset(b.id)]), ['Delete a preset', pre.map(b => [b.name, () => this.deletePreset(b.id), true])]] : []),
            ...(this.BRUSHES.includes(this.tool) || pre.length ? [['—']] : []),
            ...(this.sel ? [['Make a brush from what\'s selected…', () => this.defineBrush()]] : []),
            ['Make a brush from a picture…', () => this.defineBrush(true)],
            ...(own.length ? [['—'],
                ...own.map(b => [b.name, () => { this.opts.tip = b.id; this.setTool('custom'); this.remember(); }, false, this.tool === 'custom' && this.opts.tip === b.id]),
                ['—'],
                ['Delete a brush', own.map(b => [b.name, () => this.deleteBrush(b.id), true])]] : [])
        ];
    },

    // The pixel pencil's square: the brush's size, whole pixels
    pixelCell() {
        return Math.max(1, Math.round(this.opts.size));
    },

    // A stamp s across, centred on (x, y): its cells drawn square, whole
    // pixels where they can be (no smoothing at any size)
    drawStamp(g, x, y, s, colour, name = this.opts.stamp) {
        const rows = this.STAMPS[name] || this.STAMPS.star, n = rows.length, c = s / n;
        const x0 = x - s / 2, y0 = y - s / 2;
        g.fillStyle = colour;
        rows.forEach((row, j) => {
            for (let i = 0; i < row.length; i++) {
                if (row[i] !== '#') continue;
                const ax = Math.round(x0 + i * c), ay = Math.round(y0 + j * c);
                g.fillRect(ax, ay, Math.max(1, Math.round(x0 + (i + 1) * c) - ax), Math.max(1, Math.round(y0 + (j + 1) * c) - ay));
            }
        });
    },

    strokeTo(p) {
        const d = this.drag, a = d.last;
        if (d.tool === 'spray' || d.tool === 'can') { d.last = p; return; }
        // Ink: thinner the faster it goes (eased, so it swells and thins
        // smoothly), and from thin at its start
        if (d.tool === 'ink') {
            const len = Math.hypot(p.x - a.x, p.y - a.y), R = Math.max(1, this.radius());
            const want = Math.min(1.15, Math.max(0.3, 1.2 - len / (6 * R)));
            d.inkF = d.inkF === undefined ? 0.45 : d.inkF * 0.75 + want * 0.25;
            p = { ...p, pr: (p.pr || 1) * d.inkF };
        }
        const len = Math.hypot(p.x - a.x, p.y - a.y);
        const pa = a.pr || 1, pb = p.pr || 1;
        const step = d.tool === 'pencil' || d.tool === 'eraser-block' ? 1
            : d.tool === 'pixel' ? Math.max(1, this.pixelCell() / 2)
            : d.tool === 'stamp' ? Math.max(2, this.opts.size * 1.15)
            : d.tool === 'custom' ? Math.max(1, this.opts.size * 0.25 * (this.opts.pressure !== 'opacity' ? Math.min(pa, pb) : 1))
            : Math.max(0.5, this.radius() * (d.tool === 'ink' || this.opts.pressure !== 'opacity' ? Math.min(pa, pb) : 1) * 0.18);
        let t = step - d.carry;
        while (t <= len) {
            const k = t / len;
            this.dab({ x: a.x + (p.x - a.x) * k, y: a.y + (p.y - a.y) * k, pr: pa + (pb - pa) * k, tilt: p.tilt });
            t += step;
        }
        d.carry = len - (t - step);
        d.last = p;
    },

    // Smoothing (⋯): the stroke follows the pointer a little behind, as on
    // a string, so a shaky hand draws a steady line; it catches up where
    // it's let go
    SMOOTHING: [[0, 'Off'], [25, 'Some'], [50, 'More'], [75, 'Most']],

    smooth(q) {
        const d = this.drag, k = Math.min(0.9, (this.opts.smoothing || 0) / 100);
        if (!k || d.tool === 'spray' || d.tool === 'can') return q;
        const s = d.sm || d.last, t = 1 - k * 0.9;
        d.sm = { ...q, x: s.x + (q.x - s.x) * t, y: s.y + (q.y - s.y) * t };
        d.raw = q;
        return d.sm;
    },

    // ---- QuickShape ----

    HOLD_MS: 550,

    holdSoon() {
        clearTimeout(this._hold);
        const d = this.drag;
        this._hold = setTimeout(() => { if (this.drag === d) this.snapShape(); }, this.HOLD_MS);
    },

    // Held still: the stroke becomes the shape it looks like (if any), and
    // dragging on turns and sizes it about its pivot
    snapShape() {
        const d = this.drag;
        if (!d || d.kind !== 'paint' || d.snap || !d.pts) return;
        const fit = this.fitShape(d.pts, this.view.z);
        if (!fit) return;
        const at = { x: d.still.ox, y: d.still.oy };
        d.snap = { ...fit, base: fit.pts, at, pr: d.still.pr || 1, rot: 0, k: 1 };
        this.drawSnap();
        this.renderSoon();
    },

    moveShape(p) {
        const s = this.drag.snap;
        const a = { x: s.at.x - s.pivot.x, y: s.at.y - s.pivot.y }, q = { x: p.ox - s.pivot.x, y: p.oy - s.pivot.y };
        const la = Math.hypot(a.x, a.y), lq = Math.hypot(q.x, q.y);
        if (la < 1e-6 || lq < 1e-6) return;
        s.k = lq / la;
        s.rot = Math.atan2(q.y, q.x) - Math.atan2(a.y, a.x);
        // A closed shape that's barely turned stays as it was (straight)
        const near = Math.abs(Math.atan2(Math.sin(s.rot), Math.cos(s.rot)));
        if (s.closed && near < 4 * Math.PI / 180) s.rot = 0;
        // Redrawn once a frame, however fast the pointer
        if (!s.due) {
            s.due = true;
            requestAnimationFrame(() => { if (this.drag && this.drag.snap === s && s.due) { this.drawSnap(); this.renderSoon(); } });
        }
    },

    // The shape (turned and sized) painted with the brush, in place of the
    // stroke so far
    drawSnap() {
        const d = this.drag, s = d.snap;
        s.due = false;
        const c = Math.cos(s.rot) * s.k, n = Math.sin(s.rot) * s.k;
        const pts = s.base.map(q => {
            const x = q.x - s.pivot.x, y = q.y - s.pivot.y;
            const o = { x: s.pivot.x + x * c - y * n, y: s.pivot.y + x * n + y * c };
            const l = this.Ci.transformPoint(o);
            return { x: l.x, y: l.y, pr: s.pr };
        });
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        d.carry = 0;
        d.last = pts[0];
        this.dab(pts[0]);
        for (let i = 1; i < pts.length; i++) this.strokeTo(pts[i]);
        // The whole stroke shown again (the freehand one's gone)
        d.fresh = d.dirty && { ...d.dirty };
    },

    // The shape a stroke (points in the picture as shown) looks like:
    // { name, pts, pivot, closed }, or null for none. z: the zoom, so a
    // scribble too small to see isn't a shape
    fitShape(raw, z = 1) {
        const N = 96;
        // Evenly along the stroke
        let L = 0;
        for (let i = 1; i < raw.length; i++) L += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
        if (L * z < 24) return null;
        const P = [{ x: raw[0].x, y: raw[0].y }];
        let need = L / (N - 1), acc = 0;
        for (let i = 1; i < raw.length && P.length < N; i++) {
            const a = raw[i - 1], b = raw[i], seg = Math.hypot(b.x - a.x, b.y - a.y);
            let t = 0;
            while (acc + (seg - t) >= need && P.length < N) {
                t += need - acc;
                acc = 0;
                P.push({ x: a.x + (b.x - a.x) * t / seg, y: a.y + (b.y - a.y) * t / seg });
            }
            acc += seg - t;
        }
        const last = raw[raw.length - 1];
        if (P.length < N) P.push({ x: last.x, y: last.y }); else P[N - 1] = { x: last.x, y: last.y };
        const A = P[0], B = P[P.length - 1], chord = Math.hypot(B.x - A.x, B.y - A.y);
        const mean = (f) => P.reduce((t, q) => t + f(q), 0) / P.length;
        const deg = Math.PI / 180;
        // A line: nothing far off the one from start to end
        if (chord > 0.5 * L) {
            const ux = (B.x - A.x) / chord, uy = (B.y - A.y) / chord;
            const off = Math.max(...P.map(q => Math.abs((q.x - A.x) * uy - (q.y - A.y) * ux)));
            if (off < 0.07 * L) return { name: 'Line', pts: [A, B], pivot: A, closed: false };
        }
        // Closed: it ends near where it started, for its size
        const xs = P.map(q => q.x), ys = P.map(q => q.y);
        const D = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        if (chord < 0.3 * D && L > 2 * D) {
            // An ellipse (circle) or a rectangle (square), whichever's nearer
            const cx = mean(q => q.x), cy = mean(q => q.y);
            const sxx = mean(q => (q.x - cx) ** 2), syy = mean(q => (q.y - cy) ** 2), sxy = mean(q => (q.x - cx) * (q.y - cy));
            const frame = (ang) => {
                const co = Math.cos(ang), si = Math.sin(ang);
                const uv = P.map(q => ({ u: (q.x - cx) * co + (q.y - cy) * si, v: -(q.x - cx) * si + (q.y - cy) * co }));
                const u0 = Math.min(...uv.map(q => q.u)), u1 = Math.max(...uv.map(q => q.u));
                const v0 = Math.min(...uv.map(q => q.v)), v1 = Math.max(...uv.map(q => q.v));
                const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
                return { co, si, uv: uv.map(q => ({ u: q.u - mu, v: q.v - mv })), rx: (u1 - u0) / 2, ry: (v1 - v0) / 2, mx: cx + mu * co - mv * si, my: cy + mu * si + mv * co };
            };
            const out = (f, u, v) => ({ x: f.mx + u * f.co - v * f.si, y: f.my + u * f.si + v * f.co });
            const straight = (ang) => {
                // Near straight (as shown) is straight
                const k = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
                return Math.abs(ang - k) < 10 * deg ? k : ang;
            };
            // The ellipse: along its long axis
            const fe = frame(straight(0.5 * Math.atan2(2 * sxy, sxx - syy)));
            if (fe.rx < 1e-3 || fe.ry < 1e-3) return null;
            const errE = fe.uv.reduce((t, q) => t + Math.abs(Math.hypot(q.u / fe.rx, q.v / fe.ry) - 1), 0) / P.length;
            // The rectangle: along its sides (the stroke's main direction, in quarter turns)
            let s4 = 0, c4 = 0;
            for (let i = 1; i < P.length; i++) {
                const a = Math.atan2(P[i].y - P[i - 1].y, P[i].x - P[i - 1].x);
                s4 += Math.sin(4 * a); c4 += Math.cos(4 * a);
            }
            const fr = frame(straight(Math.atan2(s4, c4) / 4));
            const half = (fr.rx + fr.ry) / 2;
            const errR = fr.uv.reduce((t, q) => t + Math.min(Math.abs(Math.abs(q.u) - fr.rx), Math.abs(Math.abs(q.v) - fr.ry)), 0) / P.length / half;
            if (Math.min(errE, errR) > 0.14) return null;
            if (errE <= errR) {
                let { rx, ry } = fe;
                const round = Math.abs(rx - ry) / Math.max(rx, ry) < 0.15;
                if (round) rx = ry = (rx + ry) / 2;
                const pts = [];
                for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(out(fe, Math.cos(a) * rx, Math.sin(a) * ry)); }
                return { name: round ? 'Circle' : 'Ellipse', pts, pivot: { x: fe.mx, y: fe.my }, closed: true };
            }
            let { rx, ry } = fr;
            const square = Math.abs(rx - ry) / Math.max(rx, ry) < 0.12;
            if (square) rx = ry = (rx + ry) / 2;
            const pts = [[-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry], [-rx, -ry]].map(([u, v]) => out(fr, u, v));
            return { name: square ? 'Square' : 'Rectangle', pts, pivot: { x: fr.mx, y: fr.my }, closed: true };
        }
        // An arc: the circle through its start, middle and end
        const M = P[P.length >> 1];
        const d2 = 2 * (A.x * (M.y - B.y) + M.x * (B.y - A.y) + B.x * (A.y - M.y));
        if (Math.abs(d2) < 1e-9) return null;
        const a2 = A.x * A.x + A.y * A.y, m2 = M.x * M.x + M.y * M.y, b2 = B.x * B.x + B.y * B.y;
        const ox = (a2 * (M.y - B.y) + m2 * (B.y - A.y) + b2 * (A.y - M.y)) / d2;
        const oy = (a2 * (B.x - M.x) + m2 * (A.x - B.x) + b2 * (M.x - A.x)) / d2;
        const R = Math.hypot(A.x - ox, A.y - oy);
        // (off by how much, for the size of the arc: a huge circle fits anything)
        if (mean(q => Math.abs(Math.hypot(q.x - ox, q.y - oy) - R)) / Math.min(R, chord) > 0.04) return null;
        // From the start's angle to the end's, the way round the middle is
        const ang = (q) => Math.atan2(q.y - oy, q.x - ox);
        const a0 = ang(A), am = ang(M), turn = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ccw = turn(am - a0) < turn(ang(B) - a0);
        const sweep = ccw ? turn(ang(B) - a0) : -turn(a0 - ang(B));
        const pts = [];
        const n = Math.max(8, Math.ceil(Math.abs(sweep) / (2 * deg)));
        for (let i = 0; i <= n; i++) { const a = a0 + sweep * i / n; pts.push({ x: ox + Math.cos(a) * R, y: oy + Math.sin(a) * R }); }
        return { name: 'Arc', pts, pivot: A, closed: false };
    },

    sprayLoop() {
        const d = this.drag;
        if (!d || d.kind !== 'paint' || (d.tool !== 'spray' && d.tool !== 'can' && !(this.FEEL[d.tool] || {}).build)) return;
        this.dab(d.last);
        this.renderSoon();
        setTimeout(() => this.sprayLoop(), 30);
    },

    // The stroke onto a layer's context (the layer itself, or the preview
    // of it): inside the selection, with the tool's opacity. r: only there
    putStroke(g, r = null) {
        const d = this.drag;
        if (this.sel) {
            const sg = this.stroke.getContext('2d');
            sg.save();
            if (r) { sg.beginPath(); sg.rect(r.x, r.y, r.w, r.h); sg.clip(); }
            sg.globalCompositeOperation = 'destination-in';
            sg.drawImage(this.sel.mask, 0, 0);
            sg.restore();
        }
        g.save();
        if (r) { g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip(); }
        // (spot heal, until it's let go: where it'll heal, darkened)
        g.globalAlpha = this.opts.opacity / 100 * (d && d.tool === 'spot-heal' && !d.healed ? 0.45 : 1);
        const t = (d && d.target) || this.layer();
        g.globalCompositeOperation = d && this.ERASERS.includes(d.tool) ? 'destination-out'
            // On a mask: dark hides (takes it off), light shows
            : t && t.isMask ? (this.lum(this.fg) < 0.5 ? 'destination-out' : 'source-over')
            : t && t.lock ? 'source-atop'
            : d && (d.tool === 'marker' || d.tool === 'watercolour') ? 'multiply' : 'source-over';
        const gr = d && (this.FEEL[d.tool] || {}).grain;
        g.drawImage(gr ? this.grained(gr === true ? this.opts.texture : gr, r) : this.stroke, 0, 0);
        g.restore();
    },

    endStroke() {
        const d = this.drag, l = d.target || this.layer();
        if (d.raw && !d.snap) this.strokeTo(d.raw);
        this.lastDab = { x: d.last.x, y: d.last.y, pr: d.last.pr };
        if (!d.dirty) return;
        if (d.tool === 'heal' || d.tool === 'spot-heal') this.healStroke(d);
        this.putStroke(l.canvas.getContext('2d'));
        const r = { x: d.dirty.x0, y: d.dirty.y0, w: d.dirty.x1 - d.dirty.x0, h: d.dirty.y1 - d.dirty.y0 };
        this.stroke.getContext('2d').clearRect(0, 0, this.W, this.H);
        this.drag = null;
        this.endPixels(l, r, { name: d.snap ? `${this.toolName(d.tool)}: ${d.snap.name}` : this.toolName(d.tool) });
    },

    // ---- Heal and clone ----

    // Where heal and clone copy from (Alt-click), in layer px
    setSource(p) {
        this.healSrc = { x: p.x, y: p.y };
        this.healOff = null;
        this.buildOptions();
        this.renderSoon();
    },

    // What they copy from: the picture as it was when the stroke began
    // (so a stroke never copies itself), kept for the next stroke's use
    healBase() {
        let c = this._healBase;
        if (!c || c.width !== this.W || c.height !== this.H) c = this._healBase = this.newCanvas();
        this.compose(c.getContext('2d', { willReadFrequently: true }), this.layer());
        return c;
    },

    // One dab: the source through a soft round (spot heal: the round
    // alone, which is healed when the stroke's let go)
    healDab(g, p, r, src = this.drag.base, off = this.drag.off) {
        const d = this.drag, hard = Math.min(0.98, this.opts.hardness / 100);
        const s = Math.ceil(2 * r + 4), x0 = Math.floor(p.x - r - 2), y0 = Math.floor(p.y - r - 2);
        let dc = this._dab;
        if (!dc || dc.width < s || dc.height < s) dc = this._dab = this.newCanvas(Math.max(s, dc ? dc.width : 0), Math.max(s, dc ? dc.height : 0));
        const dg = dc.getContext('2d');
        dg.globalCompositeOperation = 'copy';
        const grad = dg.createRadialGradient(p.x - x0, p.y - y0, r * hard, p.x - x0, p.y - y0, r);
        grad.addColorStop(0, '#000');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        dg.fillStyle = grad;
        dg.fillRect(0, 0, s, s);
        if (d.tool !== 'spot-heal') {
            dg.globalCompositeOperation = 'source-in';
            dg.drawImage(src, x0 + off.dx, y0 + off.dy, s, s, 0, 0, s, s);
        }
        dg.globalCompositeOperation = 'source-over';
        g.drawImage(dc, 0, 0, s, s, x0, y0, s, s);
        this.grow({ x: x0, y: y0, w: s, h: s });
    },

    // ---- Tone and focus ----

    // One dab of dodge, burn, sponge, blur or sharpen: the picture as the
    // stroke began with the effect on it (worked out once a stroke, a
    // tile at a time as the brush reaches it), through a soft round
    toneDab(g, p, r) {
        if (this.drag.tool === 'smudge') { this.smudgeDab(g, p, r); return; }
        const s = Math.ceil(2 * r + 4), x0 = Math.floor(p.x - r - 2), y0 = Math.floor(p.y - r - 2);
        this.toneTiles(x0, y0, x0 + s, y0 + s);
        this.healDab(g, p, r, this.drag.fx, { dx: 0, dy: 0 });
    },

    TILE: 256,

    toneTiles(x0, y0, x1, y1) {
        const d = this.drag, T = this.TILE, W = this.W, H = this.H, o = this.opts;
        if (!d.fx) {
            let c = this._fx;
            if (!c || c.width !== W || c.height !== H) c = this._fx = this.newCanvas();
            c.getContext('2d').clearRect(0, 0, W, H);
            d.fx = c;
            d.tiles = new Set();
        }
        const m = 3 * d.rad, bg = d.base.getContext('2d', { willReadFrequently: true });
        const set = { amount: o.strength / 100, range: o.toneRange, more: o.sponge === 'more', radius: d.rad };
        for (let ty = Math.floor(Math.max(0, y0) / T); ty * T < Math.min(H, y1); ty++) {
            for (let tx = Math.floor(Math.max(0, x0) / T); tx * T < Math.min(W, x1); tx++) {
                const key = ty * 100000 + tx;
                if (d.tiles.has(key)) continue;
                d.tiles.add(key);
                const ax = tx * T, ay = ty * T, tw = Math.min(T, W - ax), th = Math.min(T, H - ay);
                const src = bg.getImageData(ax - m, ay - m, tw + 2 * m, th + 2 * m);
                const valid = { x0: Math.max(0, m - ax), y0: Math.max(0, m - ay), x1: Math.min(tw + 2 * m, W - ax + m), y1: Math.min(th + 2 * m, H - ay + m) };
                d.fx.getContext('2d').putImageData(PaintHeal.tone(d.tool, src, m, tw, th, set, valid), ax, ay);
            }
        }
    },

    // Smudge: what the brush picked up laid down softly (with the
    // strength), then what's there now picked up for the next dab
    smudgeDab(g, p, r) {
        const d = this.drag, hard = Math.min(0.98, this.opts.hardness / 100);
        const s = Math.ceil(2 * r + 4), x0 = Math.floor(p.x - r - 2), y0 = Math.floor(p.y - r - 2);
        if (!d.held) d.held = this.newCanvas(s, s);
        const cw = d.held.width, cg = d.held.getContext('2d');
        if (d.picked) {
            let dc = this._dab;
            if (!dc || dc.width < s || dc.height < s) dc = this._dab = this.newCanvas(Math.max(s, dc ? dc.width : 0), Math.max(s, dc ? dc.height : 0));
            const dg = dc.getContext('2d');
            dg.globalCompositeOperation = 'copy';
            const grad = dg.createRadialGradient(p.x - x0, p.y - y0, r * hard, p.x - x0, p.y - y0, r);
            grad.addColorStop(0, '#000');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            dg.fillStyle = grad;
            dg.fillRect(0, 0, s, s);
            dg.globalCompositeOperation = 'source-in';
            dg.drawImage(d.held, 0, 0, cw, cw, 0, 0, s, s);
            dg.globalCompositeOperation = 'source-over';
            g.save();
            g.globalAlpha = this.opts.strength / 100;
            g.drawImage(dc, 0, 0, s, s, x0, y0, s, s);
            g.restore();
            this.grow({ x: x0, y: y0, w: s, h: s });
        }
        // (the picture as the stroke began, with the stroke so far on it)
        cg.globalCompositeOperation = 'copy';
        cg.drawImage(d.base, x0, y0, s, s, 0, 0, cw, cw);
        cg.globalCompositeOperation = 'source-over';
        cg.drawImage(this.stroke, x0, y0, s, s, 0, 0, cw, cw);
        d.picked = true;
    },

    // Heal and spot heal, as the stroke's let go: the stroke's pixels
    // become the source's in the colours round the stroke (paint-heal.js);
    // spot heal finds its source first
    healStroke(d) {
        const r = d.dirty, R = this.radius();
        const pad = d.tool === 'spot-heal' ? Math.ceil(R * 0.6) + 4 : 3;
        const x = Math.max(0, Math.floor(r.x0) - pad), y = Math.max(0, Math.floor(r.y0) - pad);
        const w = Math.min(this.W, Math.ceil(r.x1) + pad) - x, h = Math.min(this.H, Math.ceil(r.y1) + pad) - y;
        d.healed = true;
        if (w <= 0 || h <= 0) return;
        const sg = this.stroke.getContext('2d'), bg = d.base.getContext('2d', { willReadFrequently: true });
        const M = sg.getImageData(x, y, w, h);
        let off = d.off;
        if (d.tool === 'spot-heal') {
            const look = Math.round(Math.max(5.5 * R, 2 * Math.min(w, h) + R)) + 4;
            const ax = Math.max(0, x - look), ay = Math.max(0, y - look);
            const aw = Math.min(this.W, x + w + look) - ax, ah = Math.min(this.H, y + h + look) - ay;
            off = PaintHeal.findSource(bg.getImageData(ax, ay, aw, ah), ax, ay, M, x, y, R);
            d.off = off;
        }
        const out = PaintHeal.heal(bg.getImageData(x, y, w, h), bg.getImageData(x + off.dx, y + off.dy, w, h), M);
        sg.putImageData(out, x, y);
        this.grow({ x, y, w, h });
    },

    rgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },

    // ---- Shapes, gradients and rectangle/ellipse selections ----
    //
    // Drawn in the picture as shown (so a square looks square however the
    // photo's turned), onto layer space through Ci

    shapeGeom(d) {
        let a = { x: d.start.ox, y: d.start.oy }, b = { x: d.end.ox, y: d.end.oy };
        if (d.shift) {
            if (this.tool === 'line' || this.tool === 'gradient') {
                const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
            } else {
                const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
                b = { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
            }
        }
        return { a, b };
    },

    // A shape's path, in the picture as shown
    shapePath(kind, a, b, st = null) {
        const p = new Path2D();
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (kind === 'polygon' && st && st.pts) {
            st.pts.forEach(([px, py], i) => i ? p.lineTo(px, py) : p.moveTo(px, py));
            p.closePath();
        } else if (kind === 'roundrect') {
            const r = Math.max(0, Math.min((st && st.rad) || 0, w / 2, h / 2));
            if (p.roundRect) p.roundRect(x, y, w, h, r);
            else p.rect(x, y, w, h);
        } else if (kind === 'rect' || kind === 'rect-select') p.rect(x, y, w, h);
        else if (kind === 'ellipse' || kind === 'ellipse-select') p.ellipse(x + w / 2, y + h / 2, w / 2 || 0.01, h / 2 || 0.01, 0, 0, Math.PI * 2);
        else { p.moveTo(a.x, a.y); p.lineTo(b.x, b.y); }
        return p;
    },

    // Shape options as drawn: draws onto g (already set to output space)
    shapeStyle(kind = this.tool) {
        const o = this.opts, line = kind === 'line' || kind === 'arrow';
        return {
            stroke: this.fg, lw: o.lineWidth,
            fill: line || o.shapeFill === 'none' ? null : o.shapeFill === 'bg' ? this.bg : this.fg,
            from: line ? 'none' : o.shapeFill, arrow: kind === 'arrow' || (line && !!o.arrow),
            ...(kind === 'roundrect' ? { rad: o.corner } : {})
        };
    },

    drawShape(g, kind, a, b, st = this.shapeStyle(kind)) {
        if (kind === 'polygon' && !st.pts && this.poly) st = { ...st, pts: this.poly.pts };
        const path = this.shapePath(kind, a, b, st);
        g.lineJoin = 'round';
        g.lineCap = 'round';
        if (kind !== 'line' && kind !== 'arrow' && st.fill) {
            g.fillStyle = st.fill;
            g.fill(path);
        }
        if (st.lw > 0) {
            g.strokeStyle = st.stroke;
            g.lineWidth = st.lw;
            g.stroke(path);
            if ((kind === 'line' || kind === 'arrow') && st.arrow) {
                const ang = Math.atan2(b.y - a.y, b.x - a.x), L = Math.max(10, st.lw * 4);
                g.beginPath();
                g.moveTo(b.x, b.y);
                g.lineTo(b.x - Math.cos(ang - 0.45) * L, b.y - Math.sin(ang - 0.45) * L);
                g.lineTo(b.x - Math.cos(ang + 0.45) * L, b.y - Math.sin(ang + 0.45) * L);
                g.closePath();
                g.fillStyle = st.stroke;
                g.fill();
            }
        }
    },

    // ---- Polygon: a click for each corner; double-click, Enter or the
    // first corner again closes it, Esc lets it go ----

    polyClick(p) {
        const q = [p.ox, p.oy], near = 8 / this.view.z;
        if (!this.poly) { this.poly = { pts: [q] }; this.renderSoon(); return; }
        const pts = this.poly.pts, f = pts[0], last = pts[pts.length - 1];
        if (pts.length >= 3 && Math.hypot(q[0] - f[0], q[1] - f[1]) <= near) { this.endPoly(true); return; }
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 2 / this.view.z) pts.push(q);
        this.renderSoon();
    },

    endPoly(keep) {
        const poly = this.poly;
        if (!poly) return;
        this.poly = null;
        this.renderSoon();
        if (!keep || poly.pts.length < 3) return;
        const xs = poly.pts.map(q => q[0]), ys = poly.pts.map(q => q[1]);
        this.placeShape('polygon', { x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) }, poly.pts);
    },

    // A shape's bounds in layer px (for undo)
    layerBounds(pts, pad = 0) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of pts) {
            const l = this.Ci.transformPoint(q);
            x0 = Math.min(x0, l.x); y0 = Math.min(y0, l.y); x1 = Math.max(x1, l.x); y1 = Math.max(y1, l.y);
        }
        return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
    },

    endShape(d) {
        const t = this.tool;
        const { a, b } = this.shapeGeom(d);
        const tiny = Math.hypot(b.x - a.x, b.y - a.y) * this.view.z < 3;
        if (t === 'rect-select' || t === 'ellipse-select') {
            if (tiny) { if (d.mode === 'new') this.deselect(); return; }
            this.selectPath(this.shapePath(t, a, b), d.mode);
            return;
        }
        if (tiny) return;
        if (t !== 'gradient') { this.placeShape(t, a, b); return; }
        this.placeGradient(a, b);
    },

    // A shape made: a shape layer of its own (by default), or drawn onto
    // the layer; pts: a polygon's corners
    placeShape(t, a, b, pts = null) {
        const st = { ...this.shapeStyle(t), ...(pts ? { pts: pts.map(q => [+q[0].toFixed(2), +q[1].toFixed(2)]) } : {}) };
        if (this.opts.shapeLayer && this.layers.length < Paint.MAX_LAYERS) {
            const rec = { kind: t, a: [a.x, a.y].map(v => +v.toFixed(2)), b: [b.x, b.y].map(v => +v.toFixed(2)), ...st, alpha: +(this.opts.opacity / 100).toFixed(3), m: this.textArr(this.extM().inverse().multiply(this.Ci)) };
            this.pushState(this.toolName(t));
            const l = this.makeLayer(this.toolName(t));
            l.shape = rec;
            this.drawVec(l);
            this.layers.splice(this.cur + 1, 0, l);
            this.cur++;
            this.onMask = false;
            this.afterState();
            return;
        }
        const l = this.layer();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.setTransform(this.Ci);
        this.drawShape(g, t, a, b, st);
        const pad = this.opts.lineWidth * (st.arrow ? 4 : 1) + 4;
        const r = this.layerBounds(pts ? pts.map(q => ({ x: q[0], y: q[1] })) : [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }], pad);
        g.setTransform(1, 0, 0, 1, 0, 0);
        this.drag = { tool: t };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        this.endPixels(l, r, { name: this.toolName(t) });
    },

    placeGradient(a, b) {
        const t = 'gradient';
        const l = this.layer();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.setTransform(this.Ci);
        let r;
        {
            const o = this.opts;
            const grad = o.gradient === 'radial'
                ? g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.hypot(b.x - a.x, b.y - a.y))
                : g.createLinearGradient(a.x, a.y, b.x, b.y);
            grad.addColorStop(0, this.fg);
            const to = this.rgb(this.bg);
            grad.addColorStop(1, o.gradTo === 'clear' ? `rgba(${this.rgb(this.fg).join(',')},0)` : `rgb(${to.join(',')})`);
            g.fillStyle = grad;
            g.fillRect(-1e5, -1e5, 2e5, 2e5);
            r = { x: 0, y: 0, w: this.W, h: this.H };
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        this.drag = { tool: t };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        this.endPixels(l, r);
    },

    // ---- Selections ----
    //
    // A mask the size of the layers (alpha: how much is selected), and its
    // edge for showing it

    selectPath(path, mode) {
        const m = this.newCanvas();
        const g = m.getContext('2d');
        g.setTransform(this.Ci);
        g.fillStyle = '#000';
        g.fill(path);
        this.combineSelection(m, mode);
    },

    combineSelection(m, mode) {
        if (this.float) this.commitFloat();
        if (mode !== 'new' && this.sel) {
            const g = this.sel.mask.getContext('2d');
            g.globalCompositeOperation = mode === 'sub' ? 'destination-out' : 'source-over';
            g.drawImage(m, 0, 0);
            g.globalCompositeOperation = 'source-over';
            m.width = m.height = 0;
        } else if (mode === 'sub') {
            m.width = m.height = 0;
            return;
        } else {
            this.dropSelection();
            this.sel = { mask: m };
        }
        this.selectionChanged();
    },

    dropSelection() {
        if (this.sel) {
            if (this.sel.mask) this.sel.mask.width = this.sel.mask.height = 0;
            if (this.sel.edge) this.sel.edge.width = this.sel.edge.height = 0;
        }
        this.sel = null;
    },

    // Its bounds and edge, worked out again; an empty one is none
    selectionChanged() {
        const m = this.sel.mask;
        const d = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H).data;
        const W = this.W, H = this.H;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (d[(y * W + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0) { this.dropSelection(); this.buildOptions(); this.renderSoon(); return; }
        this.sel.box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
        // The edge: selected pixels next to unselected ones
        const e = this.newCanvas();
        const eg = e.getContext('2d');
        const img = eg.createImageData(W, H);
        const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 127;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            if (!at(x, y)) continue;
            if (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)) continue;
            const i = (y * W + x) * 4, dark = ((x + y) >> 2) & 1;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = dark ? 0 : 255;
            img.data[i + 3] = 255;
        }
        eg.putImageData(img, 0, 0);
        if (this.sel.edge) this.sel.edge.width = this.sel.edge.height = 0;
        this.sel.edge = e;
        this.buildOptions();
        this.renderSoon();
    },

    selectAll() {
        if (!this.ready) return;
        const m = this.newCanvas();
        m.getContext('2d').fillRect(0, 0, this.W, this.H);
        this.combineSelection(m, 'new');
    },

    // Select all, but what was selected: nothing selected stays nothing
    invertSelection() {
        if (!this.ready || !this.sel) return;
        const m = this.newCanvas();
        const g = m.getContext('2d');
        g.fillRect(0, 0, this.W, this.H);
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(this.sel.mask, 0, 0);
        this.combineSelection(m, 'new');
    },

    // Feather, grow and shrink: the mask's alpha worked on and put back
    reshapeSelection(fn) {
        if (!this.ready || !this.sel) return;
        if (this.float) this.commitFloat();
        const g = this.sel.mask.getContext('2d', { willReadFrequently: true });
        const img = g.getImageData(0, 0, this.W, this.H);
        const a = new Uint8ClampedArray(this.W * this.H);
        for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3];
        const out = fn(a, this.W, this.H);
        for (let i = 0; i < out.length; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 0; img.data[i * 4 + 3] = out[i]; }
        g.putImageData(img, 0, 0);
        this.selectionChanged();
    },

    // How many pixels, asked for (Feather, Grow, Shrink)
    async askPixels(title, key, def) {
        if (!this.sel) return null;
        const v = await UI.prompt({ title, input: { label: 'Pixels', value: String(this._selPx && this._selPx[key] || def), inputMode: 'numeric' }, ok: title.replace(/…$/, '') });
        const n = Math.round(Number(v));
        if (v === null || !(n >= 1)) return null;
        (this._selPx || (this._selPx = {}))[key] = Math.min(n, 500);
        return Math.min(n, 500);
    },

    async featherSelection(r) {
        r = r || await this.askPixels('Feather…', 'feather', 8);
        if (r) this.reshapeSelection((a, W, H) => PaintEditor.blurAlpha(a, W, H, r));
    },

    async growSelection(r) {
        r = r || await this.askPixels('Grow…', 'grow', 4);
        if (r) this.reshapeSelection((a, W, H) => PaintEditor.spread(a, W, H, r, true));
    },

    async shrinkSelection(r) {
        r = r || await this.askPixels('Shrink…', 'shrink', 4);
        if (r) this.reshapeSelection((a, W, H) => PaintEditor.spread(a, W, H, r, false));
    },

    // A soft edge r pixels wide: three box blurs, across then down, which
    // come close to a Gaussian (no canvas filter: not in every web view)
    blurAlpha(a, W, H, r) {
        let src = Float32Array.from(a), tmp = new Float32Array(a.length);
        const k = Math.max(1, Math.round(r / 2));
        const pass = (from, to, n, len, step, line) => {
            for (let j = 0; j < n; j++) {
                const o = j * line;
                let sum = 0;
                for (let i = -k; i <= k; i++) sum += from[o + Math.min(len - 1, Math.max(0, i)) * step];
                for (let i = 0; i < len; i++) {
                    to[o + i * step] = sum / (2 * k + 1);
                    sum += from[o + Math.min(len - 1, i + k + 1) * step] - from[o + Math.max(0, i - k) * step];
                }
            }
        };
        for (let n = 0; n < 3; n++) {
            pass(src, tmp, H, W, 1, W);
            pass(tmp, src, W, H, W, 1);
        }
        return Uint8ClampedArray.from(src, v => Math.round(v));
    },

    // Grow (out) or shrink (in) by r pixels, round at the corners: how far
    // each pixel is from the nearest selected one (or unselected one, to
    // shrink), by the 3-4 chamfer (within a few per cent of a circle)
    spread(a, W, H, r, out) {
        const INF = 1e9, d = new Float64Array(W * H);
        for (let i = 0; i < d.length; i++) d[i] = (a[i] > 127) === out ? 0 : INF;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = y * W + x;
            let v = d[i];
            if (x > 0) v = Math.min(v, d[i - 1] + 3);
            if (y > 0) {
                v = Math.min(v, d[i - W] + 3);
                if (x > 0) v = Math.min(v, d[i - W - 1] + 4);
                if (x < W - 1) v = Math.min(v, d[i - W + 1] + 4);
            }
            d[i] = v;
        }
        for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
            const i = y * W + x;
            let v = d[i];
            if (x < W - 1) v = Math.min(v, d[i + 1] + 3);
            if (y < H - 1) {
                v = Math.min(v, d[i + W] + 3);
                if (x < W - 1) v = Math.min(v, d[i + W + 1] + 4);
                if (x > 0) v = Math.min(v, d[i + W - 1] + 4);
            }
            d[i] = v;
        }
        const lim = r * 3, res = new Uint8ClampedArray(W * H);
        for (let i = 0; i < res.length; i++) res[i] = out ? (d[i] <= lim ? 255 : 0) : (d[i] > lim ? 255 : 0);
        return res;
    },

    // The ⋯ menu: Select and Layer, each with its keys; what can't be
    // done now isn't shown
    moreItems() {
        const sel = !!this.sel, n = this.layers.length, room = n < Paint.MAX_LAYERS;
        const when = (ok, item) => (ok ? [item] : []);
        const turn = [['Image', [
            ['Crop…', () => this.startCrop(), false, undefined, 'paint.crop'],
            ['Canvas size…', () => this.canvasSize()],
            ...when(!!this.pad, ['Canvas back to the photo', () => this.setCanvas(null, 'Canvas back to the photo')]),
            ...(Edits.canKeep() ? [['—'],
                ['Rotate right', () => this.turnImage(1)],
                ['Rotate left', () => this.turnImage(3)],
                ['Rotate 180°', () => this.turnImage(2)],
                ['—'],
                ['Flip left to right', () => this.turnImage('h')],
                ['Flip upside down', () => this.turnImage('v')]] : [])
        ]]];
        return [
            ...turn,
            ['Select', [
                ['Select all', () => this.selectAll(), false, undefined, 'paint.selectAll'],
                ...when(sel, ['Select nothing', () => this.deselect(), false, undefined, 'paint.deselect']),
                ...when(sel, ['Invert', () => this.invertSelection(), false, undefined, 'paint.invert']),
                ...(sel ? [['—'],
                    ['Feather…', () => this.featherSelection()],
                    ['Grow…', () => this.growSelection()],
                    ['Shrink…', () => this.shrinkSelection()]] : [])
            ]],
            ['Layer', [
                ...when(room, ['New layer', () => this.addLayer(), false, undefined, 'paint.newLayer']),
                ...when(room, ['Duplicate', () => this.duplicateLayer(), false, undefined, 'paint.duplicate']),
                ...when(this.cur > 0, ['Merge down', () => this.mergeDown(), false, undefined, 'paint.merge']),
                ...when(n > 1, ['Merge visible', () => this.mergeVisible(), false, undefined, 'paint.mergeVisible']),
                ...when(n > 1, ['Flatten', () => this.mergeVisible(true)]),
                ...(this.layer() && this.layer().group ? [['Take it out of the group', () => this.ungroupLayer(), false, undefined, 'paint.ungroup']] : [['Group it', () => this.groupLayer(), false, undefined, 'paint.group']]),
                ...when(this.cur > 0, ['Clip to the layer below', () => this.toggleClip(), false, !!(this.layer() && this.layer().clip), 'paint.clip']),
                ['Free transform', () => this.freeTransform(), false, undefined, 'paint.transform'],
                ['—'],
                ['Bring in an image…', () => this.pickImage(), false, undefined, 'paint.import'],
                ...when(room, ['New adjustment layer', this.adjItems()]),
                ['Mask', this.maskItems()],
                ...(n > 1 ? [['—'], ['Delete layer', () => this.deleteLayer(), true]] : [])
            ]],
            ['Filter', this.adjItems(true)],
            ['Brushes', this.brushItems()],
            ['View', [
                ['Snap', () => this.toggleSnap(), false, !!this.opts.snap, 'paint.snap'],
                ['—'],
                ['Rotate the view left', () => this.rotateViewTo(this.viewAngle() - 15), false, undefined, 'paint.viewLeft'],
                ['Rotate the view right', () => this.rotateViewTo(this.viewAngle() + 15), false, undefined, 'paint.viewRight'],
                ...when(!!this.viewAngle(), ['Put the view straight', () => this.rotateViewTo(0)]),
                ['—'],
                ['Fit', () => this.fit(), false, undefined, 'paint.fit'],
                ['Actual pixels', () => this.zoomTo(1), false, undefined, 'paint.actual']
            ]],
            ['—'],
            ['History', () => this.toggleHistory(), false, this.opts.history],
            ['QuickShape: hold at a stroke\'s end', () => { this.opts.quickShape = !this.opts.quickShape; this.remember(); }, false, this.opts.quickShape],
            ['Smoothing', this.SMOOTHING.map(([v, name]) => [name, () => { this.opts.smoothing = v; this.remember(); }, false, (this.opts.smoothing || 0) === v])],
            ['Symmetry', this.SYMMETRY.map(([v, name]) => [name, () => this.setSymmetry(v), false, (this.opts.symmetry || 'off') === v])],
            ['Pen pressure', [['size', 'Size'], ['opacity', 'Opacity'], ['both', 'Size and opacity']].map(([v, name]) => [name, () => { this.opts.pressure = v; this.remember(); }, false, this.opts.pressure === v])],
            ...(Edits.canKeep() ? [['—'], ['Write edits to file', () => this.app.saveOverOriginal([this.file]), false, undefined, 'paint.saveOver']] : [])
        ];
    },

    deselect() {
        if (this.float) this.commitFloat();
        this.dropSelection();
        this.buildOptions();
        this.renderSoon();
    },

    endLasso(d) {
        if (d.pts.length < 3) { if (d.mode === 'new') this.deselect(); return; }
        const p = new Path2D();
        d.pts.forEach((q, i) => i ? p.lineTo(q.ox, q.oy) : p.moveTo(q.ox, q.oy));
        p.closePath();
        this.selectPath(p, d.mode);
    },

    // What the fill and the wand look at: the photo and the layers shown,
    // or just this layer (RGBA bytes at layer size)
    sample() {
        const c = this.scratch();
        const g = c.getContext('2d', { willReadFrequently: true });
        this.compose(g);
        return g.getImageData(0, 0, this.W, this.H).data;
    },

    // The picture onto g (layer-sized): the photo and the layers shown,
    // or just this layer; upTo: only the layers up to it (as heal and
    // clone copy from: what's above isn't this layer's to copy)
    compose(g, upTo = null) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'copy';
        if (this.opts.sampleAll) {
            g.drawImage(this.photo, 0, 0, this.W, this.H);
            g.globalCompositeOperation = 'source-over';
            for (const l of upTo ? this.layers.slice(0, this.layers.indexOf(upTo) + 1) : this.layers) {
                if (!this.isShown(l)) continue;
                this.drawShown(g, l);
            }
            g.globalAlpha = 1;
        } else {
            g.drawImage(this.layer().canvas, 0, 0);
        }
        g.globalCompositeOperation = 'source-over';
    },

    // The pixels like the one at (x, y): a mask (1 each), and its bounds
    region(px, x, y, { gaps = 0 } = {}) {
        const W = this.W, H = this.H;
        x = Math.floor(x); y = Math.floor(y);
        if (x < 0 || y < 0 || x >= W || y >= H) return null;
        const tol = this.opts.tolerance;
        const i0 = (y * W + x) * 4;
        const c = [px[i0], px[i0 + 1], px[i0 + 2], px[i0 + 3]];
        const like = new Uint8Array(W * H);
        for (let k = 0, i = 0; k < like.length; k++, i += 4) {
            like[k] = Math.abs(px[i] - c[0]) <= tol && Math.abs(px[i + 1] - c[1]) <= tol && Math.abs(px[i + 2] - c[2]) <= tol && Math.abs(px[i + 3] - c[3]) <= tol ? 1 : 0;
        }
        let mask;
        if (!this.opts.contiguous) mask = like;
        else if (gaps > 0) mask = PaintEditor.closedFlood(like, W, H, x, y, gaps);
        else mask = PaintEditor.flood(like, W, H, x, y);
        let x0 = W, x1 = -1, y0 = H, y1 = -1;
        for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
            if (!mask[yy * W + xx]) continue;
            if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
        }
        if (x1 < 0) return null;
        return { mask, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
    },

    // The pixels joined to (x, y) where ok is 1, by scanlines
    flood(ok, W, H, x, y) {
        const mask = new Uint8Array(W * H);
        if (!ok[y * W + x]) return mask;
        const can = (i) => ok[i] && !mask[i];
        const stack = [[x, y]];
        while (stack.length) {
            const [sx, sy] = stack.pop();
            let lx = sx;
            while (lx >= 0 && can(sy * W + lx)) lx--;
            lx++;
            let rx = lx, up = false, down = false;
            while (rx < W && can(sy * W + rx)) {
                mask[sy * W + rx] = 1;
                if (sy > 0) {
                    const u = can((sy - 1) * W + rx);
                    if (u && !up) { stack.push([rx, sy - 1]); up = true; } else if (!u) up = false;
                }
                if (sy < H - 1) {
                    const dn = can((sy + 1) * W + rx);
                    if (dn && !down) { stack.push([rx, sy + 1]); down = true; } else if (!dn) down = false;
                }
                rx++;
            }
        }
        return mask;
    },

    // Fill with gaps closed: the lines made g pixels thicker, so a gap
    // narrower than twice that is shut; the area filled inside them; then
    // grown back out to the lines (only over pixels like the one clicked).
    // A click too near a line to be inside the thickened ones fills as usual
    closedFlood(like, W, H, x, y, g) {
        const walls = new Uint8ClampedArray(W * H);
        for (let i = 0; i < walls.length; i++) walls[i] = like[i] ? 0 : 255;
        const thick = PaintEditor.spread(walls, W, H, g, true);
        const open = new Uint8Array(W * H);
        for (let i = 0; i < open.length; i++) open[i] = like[i] && !thick[i] ? 1 : 0;
        if (!open[y * W + x]) return PaintEditor.flood(like, W, H, x, y);
        const inside = PaintEditor.flood(open, W, H, x, y);
        const a = new Uint8ClampedArray(W * H);
        for (let i = 0; i < a.length; i++) a[i] = inside[i] ? 255 : 0;
        const back = PaintEditor.spread(a, W, H, g + 1, true);
        const mask = new Uint8Array(W * H);
        for (let i = 0; i < mask.length; i++) mask[i] = back[i] && like[i] ? 1 : 0;
        return mask;
    },

    // A region as a canvas (white where it is), a pixel's anti-aliasing
    // round its edge
    regionCanvas(reg, colour) {
        const c = this.newCanvas();
        const g = c.getContext('2d');
        const { x, y, w, h } = reg.box;
        const img = g.createImageData(w, h);
        const rgb = this.rgb(colour);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
            if (!reg.mask[(y + yy) * this.W + x + xx]) continue;
            const i = (yy * w + xx) * 4;
            img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
        }
        g.putImageData(img, x, y);
        return c;
    },

    wand(p, mode) {
        const reg = this.region(this.sample(), p.x, p.y);
        if (!reg) return;
        this.combineSelection(this.regionCanvas(reg, '#000000'), mode);
    },

    // Where the colour clicked matches, or the whole layer (inside the
    // selection either way)
    fillAt(p) {
        const l = this.layer();
        const whole = this.opts.fillWhat === 'layer';
        const reg = whole ? null : this.region(this.sample(), p.x, p.y, { gaps: this.opts.gaps });
        if (!whole && !reg) return;
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        if (whole) {
            g.fillStyle = this.fg;
            g.fillRect(0, 0, this.W, this.H);
        } else {
            const c = this.regionCanvas(reg, this.fg);
            g.drawImage(c, 0, 0);
            c.width = c.height = 0;
        }
        this.drag = { tool: 'fill' };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        const b = whole ? (this.sel ? this.sel.box : { x: 0, y: 0, w: this.W, h: this.H }) : reg.box;
        this.endPixels(l, { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 });
        this.renderSoon();
    },

    // ---- Recolor ----
    //
    // The colour clicked becomes the foreground colour wherever it's found
    // (in what's selected, with a selection), its shading kept: each pixel
    // near it in colour is moved in hue, saturation and lightness by as much
    // as the colour clicked is moved, fading out at the edge of the range.
    // Near is measured in Oklab with lightness counting for little, so the
    // colour's own shadows and highlights are caught. The result goes on
    // the layer (over the photo and the layers, with All layers)

    // sRGB 0-255 → Oklab
    oklab(r, g, b) {
        const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const R = f(r), G = f(g), B = f(b);
        const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
        const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
        const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
        return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
    },

    // RGB 0-255 ↔ HSL (h 0-1, s and l 0-1)
    toHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
        if (!d) return [0, 0, l];
        const s = d / (1 - Math.abs(2 * l - 1));
        const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [h / 6, s, l];
    },

    fromHsl(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s, hp = ((h % 1) + 1) % 1 * 6, x = c * (1 - Math.abs(hp % 2 - 1)), m = l - c / 2;
        const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    },

    // px: RGBA pixels; from: the colour clicked, to: the one it becomes
    // (RGB); range 1-100. → RGBA pixels: each changed one, with how much
    // as its alpha (none where nothing changes), and how many changed
    recolorPixels(px, from, to, range) {
        const n = px.length >> 2, out = new Uint8ClampedArray(px.length);
        const [fl, fa, fb] = this.oklab(...from);
        const [h0, s0, l0] = this.toHsl(...from), [h1, s1, l1] = this.toHsl(...to);
        const grey = s0 < 0.04;
        const dh = h1 - h0, ks = s1 / Math.max(s0, 0.04), dl = l1 - l0;
        const r = 0.03 + range / 100 * 0.37, inner = r * 0.6;
        let changed = 0;
        // The same colours come up again and again: worked out once each
        const memo = new Map();
        for (let i = 0; i < n; i++) {
            const o = i * 4;
            if (!px[o + 3]) continue;
            const key = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
            let hit = memo.get(key);
            if (hit === undefined) {
                const [L, A, B] = this.oklab(px[o], px[o + 1], px[o + 2]);
                const d = Math.hypot(A - fa, B - fb, (L - fl) * 0.3);
                const w = d >= r ? 0 : d <= inner ? 1 : 1 - (d - inner) / (r - inner);
                if (!w) hit = null;
                else {
                    const [h, s, l] = this.toHsl(px[o], px[o + 1], px[o + 2]);
                    const c = this.fromHsl(grey ? h1 : h + dh, Math.min(1, grey ? s1 : s * ks), Math.min(1, Math.max(0, l + dl)));
                    hit = [c[0], c[1], c[2], Math.round(w * 255)];
                }
                if (memo.size < 1 << 18) memo.set(key, hit);
            }
            if (!hit) continue;
            out[o] = hit[0]; out[o + 1] = hit[1]; out[o + 2] = hit[2];
            out[o + 3] = Math.round(hit[3] * px[o + 3] / 255);
            changed++;
        }
        return { px: out, changed };
    },

    recolorAt(p) {
        const l = this.layer();
        const x = Math.floor(p.x), y = Math.floor(p.y);
        if (!l || x < 0 || y < 0 || x >= this.W || y >= this.H) return;
        const px = this.sample(), o = (y * this.W + x) * 4;
        if (!px[o + 3]) { this.app.showToast('Nothing there to recolor', 1600); return; }
        const res = this.recolorPixels(px, [px[o], px[o + 1], px[o + 2]], this.rgb(this.fg), this.opts.range);
        if (!res.changed) return;
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.putImageData(new ImageData(res.px, this.W, this.H), 0, 0);
        this.drag = { tool: 'recolor' };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        this.endPixels(l, this.sel ? this.sel.box : { x: 0, y: 0, w: this.W, h: this.H });
        this.renderSoon();
    },

    // Delete: what's selected on this layer gone (or the whole layer)
    clearSelected() {
        if (this.float) { this.discardFloat(); return; }
        const l = this.layer();
        if (!l) return;
        if (l.lock) { this.lockedToast(); return; }
        this.beginPixels(l);
        const g = l.canvas.getContext('2d');
        let r = { x: 0, y: 0, w: this.W, h: this.H };
        if (this.sel) {
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(this.sel.mask, 0, 0);
            g.globalCompositeOperation = 'source-over';
            r = this.sel.box;
        } else {
            g.clearRect(0, 0, this.W, this.H);
        }
        this.endPixels(l, r, { name: 'Delete' });
        this.renderSoon();
    },

    // ---- Text ----

    font(scale = 1) {
        const o = this.opts;
        return `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${Math.max(1, o.fontSize * scale)}px ${o.font}`;
    },

    // Text goes on a layer of its own that keeps its words, font, colour
    // and where it is (l.text: { v, font, size, bold, italic, color, alpha,
    // m, align?, outline?, ocolor? }, m from its own space, its top left at 0,0, to the photo's,
    // as paint.js keeps it), so the Text tool clicked on it opens it again.
    // Painting on it makes it pixels; moving or transforming it doesn't

    startText(p) {
        const i = this.textAt(p);
        if (i >= 0) { this.editText(i); return; }
        this.text = { ox: p.ox, oy: p.oy, rot: 0, k: 1 };
        this.openTextBox('');
    },

    openTextBox(value) {
        const ta = this.el('paint-text');
        ta.value = value;
        ta.classList.remove('hidden');
        this.positionText();
        setTimeout(() => { ta.focus(); ta.select(); }, 0);
    },

    // Its text layer opened again to type in (the Text tool's options
    // taken from it)
    editText(i) {
        const l = this.layers[i];
        if (!l || !l.text || !this.ready) return;
        if (l.fixed) { this.fixedToast(); return; }
        if (this.float) this.commitFloat();
        if (this.text) this.endText(true);
        if (this.tool !== 'text') this.setTool('text');
        const t = l.text;
        this.cur = i;
        this.onMask = false;
        Object.assign(this.opts, { font: t.font, fontSize: t.size, bold: t.bold, italic: t.italic, align: t.align || 'left', outline: t.outline || 0, opacity: Math.round(t.alpha * 100) });
        this.fg = t.color;
        if (t.outline) this.bg = t.ocolor;
        this.syncColours();
        const M = this.C.multiply(this.textM(t)), o = M.transformPoint({ x: 0, y: 0 });
        this.text = { ox: o.x, oy: o.y, rot: Math.atan2(M.b, M.a), k: Math.hypot(M.a, M.b) || 1, layer: l };
        this.drawLayers();
        this.buildOptions();
        this.openTextBox(t.v);
        this.renderSoon();
    },

    positionText() {
        if (!this.text) return;
        const ta = this.el('paint-text'), t = this.text;
        const s = this.V().transformPoint({ x: t.ox, y: t.oy });
        ta.style.left = `${s.x}px`;
        ta.style.top = `${s.y}px`;
        ta.style.transformOrigin = '0 0';
        const r = this.view.r + t.rot;
        ta.style.transform = r ? `rotate(${r}rad)` : '';
        ta.style.font = this.font(this.view.z * t.k);
        ta.style.color = this.fg;
        ta.style.opacity = String(this.opts.opacity / 100);
        ta.style.textAlign = this.opts.align;
        // (The outline outside the letters, as it'll be drawn: twice as wide, under them)
        const ow = this.opts.outline * this.view.z * t.k;
        ta.style.webkitTextStroke = ow ? `${ow * 2}px ${this.bg}` : '';
        ta.style.paintOrder = ow ? 'stroke fill' : '';
        this.sizeText();
    },

    sizeText() {
        const ta = this.el('paint-text'), k = this.text ? this.text.k : 1;
        const g = this.canvas.getContext('2d');
        g.save();
        g.font = this.font(this.view.z * k);
        const lines = (ta.value || ' ').split('\n');
        const w = Math.max(...lines.map(t => g.measureText(t || ' ').width));
        g.restore();
        ta.style.width = `${Math.ceil(w) + 8}px`;
        ta.style.height = `${Math.ceil(lines.length * this.opts.fontSize * this.view.z * k * 1.2) + 4}px`;
    },

    // Photo space to layer space (the canvas made bigger: the layers reach past it)
    extM() {
        return new DOMMatrix().translate(this.ext.l, this.ext.t);
    },

    textM(t) {
        return this.extM().multiply(new DOMMatrix(t.m));
    },

    // ---- Shape layers ----
    // A line, rectangle or ellipse on a layer of its own (l.shape: { kind,
    // a, b, stroke, lw, fill, from, arrow, alpha, m }, a and b in its own
    // space, m from there to the photo's). With its tool out and the layer
    // chosen, the line, fill, opacity and colours change it; Move and Free
    // transform keep it a shape; painting on it makes it pixels

    // A text or shape layer's pixels drawn again from what it keeps
    drawVec(l, canvas = l.canvas) {
        if (l.text) { this.drawText(l.text, canvas); return; }
        const sh = l.shape;
        if (!sh) return;
        const g = canvas.getContext('2d');
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.setTransform(this.textM(sh));
        g.globalAlpha = sh.alpha;
        this.drawShape(g, sh.kind, { x: sh.a[0], y: sh.a[1] }, { x: sh.b[0], y: sh.b[1] }, sh);
        g.restore();
    },

    // The shape layer chosen, with its own tool out
    shapeHere() {
        const l = this.layer();
        return l && l.shape && !this.onMask && l.shape.kind === this.tool ? l : null;
    },

    // Its style into the tool's options (and colours), so they show it
    loadShapeStyle() {
        const l = this.shapeHere();
        if (!l || this._shapeShown === l.shape) return;
        this._shapeShown = l.shape;
        const sh = l.shape;
        Object.assign(this.opts, { lineWidth: sh.lw, opacity: Math.round(sh.alpha * 100) });
        if (sh.kind === 'line') this.opts.arrow = sh.arrow;
        else if (sh.kind !== 'arrow') this.opts.shapeFill = sh.from;
        if (sh.kind === 'roundrect') this.opts.corner = sh.rad || 0;
        this.fg = sh.stroke;
        if (sh.from === 'bg' && sh.fill) this.bg = sh.fill;
        this.syncColours();
    },

    // The options changed: the shape layer chosen follows (a moment after,
    // so dragging a colour is one step of Undo)
    restyleSoon() {
        clearTimeout(this._restyle);
        if (!this.shapeHere()) return;
        this._restyle = setTimeout(() => this.restyle(), 250);
    },

    restyle() {
        clearTimeout(this._restyle);
        const l = this.shapeHere();
        if (!l) return;
        const rec = { ...l.shape, ...this.shapeStyle(l.shape.kind), alpha: +(this.opts.opacity / 100).toFixed(3) };
        if (JSON.stringify(rec) === JSON.stringify(l.shape)) return;
        this.pushState('Shape style');
        Object.assign(l, { shape: rec, canvas: this.newCanvas(), changed: true });
        this._shapeShown = rec;
        this.drawVec(l);
        this.afterState();
    },

    textArr(M) {
        return [M.a, M.b, M.c, M.d, M.e, M.f].map(v => +v.toFixed(5));
    },

    textFont(t) {
        return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${Math.max(1, t.size)}px ${t.font}`;
    },

    // Its box in its own space
    textSize(t) {
        const g = this.canvas.getContext('2d');
        g.save();
        g.font = this.textFont(t);
        const lines = t.v.split('\n');
        const w = Math.max(...lines.map(x => g.measureText(x).width));
        g.restore();
        return { w, h: lines.length * t.size * 1.2 };
    },

    // The layer's pixels drawn from its text (all else on it cleared)
    drawText(t, canvas) {
        const g = canvas.getContext('2d');
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.setTransform(this.textM(t));
        g.globalAlpha = t.alpha;
        this.textLines(g, t, 0, 0);
        g.restore();
    },

    // Its lines set out from x, y (its top left): each lined up left, in
    // the middle or right of the widest, with its outline (in its own
    // colour, outside the letters) under them. Its width back
    textLines(g, t, x, y) {
        g.font = this.textFont(t);
        g.textBaseline = 'top';
        const lines = t.v.split('\n'), ws = lines.map(line => g.measureText(line).width), w = Math.max(...ws);
        const f = { center: 0.5, right: 1 }[t.align] || 0;
        g.lineJoin = 'round';
        lines.forEach((line, i) => {
            const lx = x + (w - ws[i]) * f, ly = y + i * t.size * 1.2 + t.size * 0.1;
            if (t.outline) {
                g.strokeStyle = t.ocolor;
                g.lineWidth = t.outline * 2;
                g.strokeText(line, lx, ly);
            }
            g.fillStyle = t.color;
            g.fillText(line, lx, ly);
        });
        return w;
    },

    // The top shown text layer under p, or -1
    textAt(p) {
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const l = this.layers[i];
            if (!l.text || l.hidden) continue;
            const q = this.textM(l.text).inverse().transformPoint(this.Ci.transformPoint({ x: p.ox, y: p.oy }));
            const b = this.textSize(l.text), m = 4 + (l.text.outline || 0);
            if (q.x >= -m && q.y >= -m && q.x <= b.w + m && q.y <= b.h + m) return i;
        }
        return -1;
    },

    // The text as typed, with the Text tool's options now
    textRec(v, m) {
        const o = this.opts;
        // (Left and no outline aren't kept, as text from before them)
        return { v, font: o.font, size: o.fontSize, bold: !!o.bold, italic: !!o.italic, color: this.fg, alpha: +(o.opacity / 100).toFixed(3), m,
            ...(o.align !== 'left' ? { align: o.align } : {}), ...(o.outline > 0 ? { outline: o.outline, ocolor: this.bg } : {}) };
    },

    textName(v) {
        const line = v.trim().split('\n')[0].trim();
        return line.length > 30 ? line.slice(0, 29) + '…' : line || 'Text';
    },

    endText(keep) {
        const t = this.text;
        if (!t) return;
        this.text = null;
        const ta = this.el('paint-text');
        const value = ta.value;
        ta.classList.add('hidden');
        ta.blur();
        // A text layer opened again: changed, or gone when emptied
        if (t.layer) {
            const l = t.layer, i = this.layers.indexOf(l);
            this.renderSoon();
            if (!keep || i < 0) return;
            if (!value.trim()) {
                this.cur = i;
                if (this.layers.length > 1) { this.deleteLayer(); return; }
                this.pushState('Delete text');
                Object.assign(l, { text: null, canvas: this.newCanvas(), changed: true });
                this.afterState();
                return;
            }
            const rec = this.textRec(value, l.text.m);
            if (JSON.stringify(rec) === JSON.stringify(l.text)) return;
            this.pushState('Edit text');
            if (l.name === this.textName(l.text.v)) l.name = this.textName(value);
            Object.assign(l, { text: rec, canvas: this.newCanvas(), changed: true });
            this.drawText(rec, l.canvas);
            this.afterState();
            return;
        }
        if (!keep || !value.trim()) return;
        // New: a text layer of its own above this one (with room for it)
        if (this.layers.length < Paint.MAX_LAYERS) {
            const rec = this.textRec(value, this.textArr(this.extM().inverse().multiply(this.Ci).translate(t.ox, t.oy)));
            this.pushState('Text');
            const l = this.makeLayer(this.textName(value));
            l.text = rec;
            this.drawText(rec, l.canvas);
            this.layers.splice(this.cur + 1, 0, l);
            this.cur++;
            this.onMask = false;
            this.afterState();
            return;
        }
        const l = this.layer();
        this.beginPixels(l);
        const g = this.stroke.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.W, this.H);
        g.setTransform(this.Ci);
        const lines = value.split('\n'), lh = this.opts.fontSize * 1.2;
        const w = this.textLines(g, this.textRec(value, null), t.ox, t.oy);
        g.setTransform(1, 0, 0, 1, 0, 0);
        this.drag = { tool: 'text' };
        this.putStroke(l.canvas.getContext('2d'));
        this.drag = null;
        g.clearRect(0, 0, this.W, this.H);
        const h = lines.length * lh;
        this.endPixels(l, this.layerBounds([{ x: t.ox, y: t.oy }, { x: t.ox + w, y: t.oy }, { x: t.ox, y: t.oy + h }, { x: t.ox + w, y: t.oy + h }], this.opts.fontSize * 0.5 + this.opts.outline));
        this.renderSoon();
    },

    // ---- Move: a floating copy of the layer, or what's selected ----
    //
    // Lifted off the layer into the picture as shown (an axis-lined box
    // there), moved, scaled and turned about its middle, and put back down
    // through Ci when it's done

    startMove(p, e = {}) {
        if (this.float) {
            const f = this.float, hit = this.floatHit(p);
            if (hit) {
                this.drag = { kind: 'float', part: hit, start: p, orig: { ...f.t } };
                if (f.mesh) { this.drag.mesh = f.mesh.map(q => ({ ...q })); return; }
                // A corner or side with Ctrl (Ctrl+Alt+Shift: perspective),
                // or in Skew, Distort or Perspective: the corners go free
                const how = e.ctrlKey || e.metaKey ? (e.altKey && e.shiftKey ? 'perspective' : 'distort') : f.mode;
                if (hit !== 'rotate' && (f.quad || (how !== 'free' && hit !== 'move'))) {
                    if (!f.quad) f.quad = this.quadOf(f);
                    Object.assign(this.drag, { quad: f.quad.map(q => ({ ...q })), how });
                    this.buildOptions();
                }
                return;
            }
            this.commitFloat();
        }
        if (!this.liftFloat()) return;
        this.drag = { kind: 'float', part: 'move', start: p, orig: { ...this.float.t } };
    },

    liftFloat() {
        const l = this.layer();
        if (!l) return false;
        if (l.fixed) { this.fixedToast(); return false; }
        if (l.adj) { this.app.showToast('An adjustment layer has nothing to move: paint on its mask instead', 2000); return false; }
        this.beginPixels(l);
        // What's lifted, in layer space: the selection of the layer, or all of it
        const lifted = this.newCanvas();
        const lg = lifted.getContext('2d');
        lg.drawImage(l.canvas, 0, 0);
        if (this.sel) {
            lg.globalCompositeOperation = 'destination-in';
            lg.drawImage(this.sel.mask, 0, 0);
            lg.globalCompositeOperation = 'source-over';
        }
        const g = l.canvas.getContext('2d');
        if (this.sel) {
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(this.sel.mask, 0, 0);
            g.globalCompositeOperation = 'source-over';
        } else {
            g.clearRect(0, 0, this.W, this.H);
        }
        // Into the picture as shown, its bounds there: the selection's, or
        // just what's on the layer (its box fits it, not the whole canvas)
        const lb = this.sel ? this.sel.box : this.contentBox(lifted) || { x: 0, y: 0, w: this.W, h: this.H };
        const corners = [[lb.x, lb.y], [lb.x + lb.w, lb.y], [lb.x, lb.y + lb.h], [lb.x + lb.w, lb.y + lb.h]].map(([x, y]) => this.C.transformPoint({ x, y }));
        const x0 = Math.floor(Math.min(...corners.map(q => q.x))), y0 = Math.floor(Math.min(...corners.map(q => q.y)));
        const x1 = Math.ceil(Math.max(...corners.map(q => q.x))), y1 = Math.ceil(Math.max(...corners.map(q => q.y)));
        const fc = this.newCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
        const fg = fc.getContext('2d');
        fg.setTransform(new DOMMatrix().translate(-x0, -y0).multiply(this.C));
        fg.drawImage(lifted, 0, 0);
        lifted.width = lifted.height = 0;
        this.float = { canvas: fc, x0, y0, w: x1 - x0, h: y1 - y0, t: { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 }, layer: l, sel: this.sel ? this.sel.box : null, mode: 'free', quad: null };
        this.buildOptions();
        return true;
    },

    // The float's matrix in the picture as shown (its own px → output px)
    floatM() {
        const f = this.float, t = f.t;
        const cx = f.x0 + f.w / 2, cy = f.y0 + f.h / 2;
        return new DOMMatrix().translate(cx + t.tx, cy + t.ty).rotate(t.rot * 180 / Math.PI).scale(t.sx, t.sy).translate(-f.w / 2, -f.h / 2);
    },

    // Its corners and the turning knob, in output px
    floatHandles() {
        const f = this.float;
        if (f.quad) {
            const q = f.quad, mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            return {
                corners: [['nw', q[0]], ['ne', q[1]], ['sw', q[3]], ['se', q[2]]],
                edges: [['n', mid(q[0], q[1])], ['s', mid(q[3], q[2])], ['w', mid(q[0], q[3])], ['e', mid(q[1], q[2])]],
                knob: null, quad: q
            };
        }
        const M = this.floatM();
        const at = (x, y) => M.transformPoint({ x, y });
        const knobLen = 28 / this.view.z;
        const top = at(f.w / 2, 0), mid = at(f.w / 2, f.h / 2);
        const dx = top.x - mid.x, dy = top.y - mid.y, len = Math.hypot(dx, dy) || 1;
        return {
            corners: [['nw', at(0, 0)], ['ne', at(f.w, 0)], ['sw', at(0, f.h)], ['se', at(f.w, f.h)]],
            // The middles of the sides: stretch one way only
            edges: [['n', at(f.w / 2, 0)], ['s', at(f.w / 2, f.h)], ['w', at(0, f.h / 2)], ['e', at(f.w, f.h / 2)]],
            knob: { x: top.x + dx / len * knobLen * Math.sign(this.float.t.sy || 1), y: top.y + dy / len * knobLen * Math.sign(this.float.t.sy || 1) },
            M
        };
    },

    floatHit(p) {
        const r = 9 / this.view.z;
        if (this.float.mesh) {
            const m = this.float.mesh;
            for (let i = 0; i < 16; i++) if (Math.hypot(p.ox - m[i].x, p.oy - m[i].y) <= r) return 'm' + i;
            return this.inMesh(m, p.ox, p.oy) ? 'move' : null;
        }
        const h = this.floatHandles();
        if (h.knob && Math.hypot(p.ox - h.knob.x, p.oy - h.knob.y) <= r) return 'rotate';
        for (const [id, q] of [...h.corners, ...h.edges]) if (Math.hypot(p.ox - q.x, p.oy - q.y) <= r) return id;
        if (h.quad) return this.inQuad(h.quad, p.ox, p.oy) ? 'move' : null;
        const l = h.M.inverse().transformPoint({ x: p.ox, y: p.oy });
        if (l.x >= 0 && l.y >= 0 && l.x <= this.float.w && l.y <= this.float.h) return 'move';
        return null;
    },

    // free: Ctrl held, moved without snapping
    dragFloat(p, keepShape, free = false) {
        const d = this.drag, f = this.float, t = f.t, o = d.orig;
        if (f.mesh && d.mesh) { this.dragMesh(p); return; }
        if (f.quad && d.quad) { this.dragQuad(p); return; }
        const cx = f.x0 + f.w / 2 + o.tx, cy = f.y0 + f.h / 2 + o.ty;
        if (d.part === 'move') {
            t.tx = o.tx + (p.ox - d.start.ox);
            t.ty = o.ty + (p.oy - d.start.oy);
            if (free) this._snapLines = null;
            else this.snapFloat();
            // Neither turned nor sized: in whole pixels, so it stays crisp
            // and goes a pixel at a time
            if (!t.rot && Math.abs(t.sx) === 1 && Math.abs(t.sy) === 1) {
                t.tx = Math.round(t.tx);
                t.ty = Math.round(t.ty);
            }
        } else if (d.part === 'rotate') {
            const a0 = Math.atan2(d.start.oy - cy, d.start.ox - cx), a1 = Math.atan2(p.oy - cy, p.ox - cx);
            let rot = o.rot + a1 - a0;
            if (keepShape) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
            t.rot = rot;
        } else {
            // A corner: scaled about the middle, on the box's own axes
            const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
            const lx = c * (p.ox - cx) - s * (p.oy - cy), ly = s * (p.ox - cx) + c * (p.oy - cy);
            let sx = Math.max(0.02, Math.abs(lx) / (f.w / 2)), sy = Math.max(0.02, Math.abs(ly) / (f.h / 2));
            // A side: that way only (Shift: both, its shape kept)
            if (d.part === 'e' || d.part === 'w') sy = keepShape ? sx : Math.abs(o.sy);
            else if (d.part === 'n' || d.part === 's') sx = keepShape ? sy : Math.abs(o.sx);
            else if (keepShape) sx = sy = Math.max(sx, sy);
            t.sx = sx * Math.sign(o.sx || 1);
            t.sy = sy * Math.sign(o.sy || 1);
        }
        this.syncTransform();
    },

    // ---- Free transform (Ctrl+T): the layer, or what's selected, lifted to
    // move, size, stretch, turn and flip, its numbers along the top ----

    freeTransform() {
        if (!this.ready || this.busy) return;
        if (this.text) this.endText(true);
        if (this.crop) return;
        if (this.float) return; // already
        const l = this.layer();
        if (!l) return;
        if (this.empty(l) && !this.sel) { this.app.showToast('Nothing on this layer to transform', 1800); return; }
        if (this.tool !== 'move') this.setTool('move');
        if (this.liftFloat()) this.renderSoon();
    },

    // W and H (% of what was lifted) and the angle, typed
    transformOptions(box) {
        const f = this.float, t = f.t;
        const num = (label, get, set, unit, min, max) => {
            const l = document.createElement('label');
            l.className = 'paint-opt';
            l.innerHTML = '<span></span><input type="number" class="field paint-tf-num"><span class="paint-tf-unit"></span>';
            l.querySelector('span').textContent = label;
            l.querySelector('.paint-tf-unit').textContent = unit;
            const i = l.querySelector('input');
            Object.assign(i, { min, max, step: 1 });
            i.value = get();
            i.addEventListener('change', () => {
                const v = parseFloat(i.value);
                if (isFinite(v)) { set(Math.min(max, Math.max(min, v))); this.renderSoon(); }
                i.value = get();
            });
            i.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); i.dispatchEvent(new Event('change')); i.blur(); } });
            l._sync = () => { if (document.activeElement !== i) i.value = get(); };
            box.appendChild(l);
            return l;
        };
        // How the corners and sides drag
        const mode = document.createElement('label');
        mode.className = 'paint-opt';
        mode.innerHTML = '<span>Mode</span><select class="field paint-tf-mode"></select>';
        const ms = mode.querySelector('select');
        for (const [v, t] of [['free', 'Size and turn'], ['skew', 'Skew'], ['distort', 'Distort'], ['perspective', 'Perspective'], ['warp', 'Warp']]) ms.add(new Option(t, v));
        ms.value = f.mode || 'free';
        ms.title = 'How the corners and sides drag. Ctrl-drag a corner to distort it whatever this is';
        ms.addEventListener('change', () => { this.setWarp(ms.value === 'warp'); f.mode = ms.value; ms.blur(); });
        box.appendChild(mode);
        if (f.mesh) {
            const fin = (label, title, fn, cls) => { const x = document.createElement('button'); x.className = cls; x.textContent = label; x.title = title; x.addEventListener('click', () => { x.blur(); fn(); }); box.appendChild(x); };
            const hint = document.createElement('span');
            hint.className = 'paint-opt paint-hint';
            hint.textContent = 'Drag a point to bend it; drag inside to move it';
            hint.title = hint.textContent;
            box.appendChild(hint);
            fin('Reset', 'Take the bend out', () => { f.mesh = this.meshOf({ ...f, mesh: null }, true); this.renderSoon(); }, 'btn ghost sm');
            fin('Cancel', 'Put it back as it was (Esc)', () => this.cancelFloat(), 'btn secondary paint-tf-cancel');
            fin('Done', 'Put it down (Enter)', () => this.commitFloat(), 'btn primary paint-tf-ok');
            this.tfRows = [];
            return;
        }
        if (f.quad) {
            // The corners free: W, H and the angle no longer say it all
            const flip = (order) => { f.quad = order.map(i => f.quad[i]); this.renderSoon(); };
            const b = (label, title, fn) => { const x = document.createElement('button'); x.className = 'btn ghost sm'; x.textContent = label; x.title = title; x.addEventListener('click', () => { x.blur(); fn(); }); box.appendChild(x); };
            b('Flip ↔', 'Flip left to right', () => flip([1, 0, 3, 2]));
            b('Flip ↕', 'Flip upside down', () => flip([3, 2, 1, 0]));
            const fin = (label, title, fn, cls) => { const x = document.createElement('button'); x.className = cls; x.textContent = label; x.title = title; x.addEventListener('click', () => { x.blur(); fn(); }); box.appendChild(x); };
            fin('Cancel', 'Put it back as it was (Esc)', () => this.cancelFloat(), 'btn secondary paint-tf-cancel');
            fin('Done', 'Put it down (Enter)', () => this.commitFloat(), 'btn primary paint-tf-ok');
            this.tfRows = [];
            return;
        }
        this.tfRows = [
            num('W', () => Math.round(Math.abs(t.sx) * 100), (v) => { t.sx = Math.sign(t.sx || 1) * v / 100; }, '%', 1, 2000),
            num('H', () => Math.round(Math.abs(t.sy) * 100), (v) => { t.sy = Math.sign(t.sy || 1) * v / 100; }, '%', 1, 2000),
            num('Angle', () => Math.round(((t.rot * 180 / Math.PI) % 360 + 540) % 360 - 180), (v) => { t.rot = v * Math.PI / 180; }, '°', -180, 180)
        ];
        const button = (label, title, fn, cls = 'btn ghost sm') => {
            const b = document.createElement('button');
            b.className = cls;
            b.textContent = label;
            b.title = title;
            b.addEventListener('click', () => { b.blur(); fn(); });
            box.appendChild(b);
            return b;
        };
        button('Flip ↔', 'Flip left to right', () => { t.sx = -t.sx; this.renderSoon(); });
        button('Flip ↕', 'Flip upside down', () => { t.sy = -t.sy; this.renderSoon(); });
        const hint = document.createElement('span');
        hint.className = 'paint-opt paint-hint';
        hint.textContent = 'Drag a corner to size it, a side to stretch it (Shift keeps its shape), the knob to turn it; Ctrl-drag a corner to distort it';
        hint.title = hint.textContent;
        box.appendChild(hint);
        button('Cancel', 'Put it back as it was (Esc)', () => this.cancelFloat(), 'btn secondary paint-tf-cancel');
        button('Done', 'Put it down (Enter)', () => this.commitFloat(), 'btn primary paint-tf-ok');
    },

    syncTransform() {
        for (const r of this.tfRows || []) if (r.isConnected) r._sync();
    },

    drawFloat(ctx, VD) {
        const f = this.float;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if (f.mesh) {
            ctx.setTransform(VD);
            this.drawMap(ctx, f.canvas, (x, y) => this.patchAt(f.mesh, x / f.w, y / f.h), f.w, f.h, 16);
        } else if (f.quad) {
            ctx.setTransform(VD);
            this.drawHom(ctx, f.canvas, this.homRectToQuad(f.w, f.h, f.quad), f.w, f.h, 10);
        } else {
            ctx.setTransform(VD.multiply(this.floatM()));
            ctx.drawImage(f.canvas, 0, 0);
        }
        ctx.restore();
    },

    // ---- Skew, distort and perspective ----
    // The float's corners set free (f.quad: nw, ne, se, sw, in the picture
    // as shown), it drawn through the homography from its own px to them,
    // as small triangles each drawn straight

    quadOf(f) {
        const M = this.floatM.call({ float: f, view: this.view });
        return [[0, 0], [f.w, 0], [f.w, f.h], [0, f.h]].map(([x, y]) => { const q = M.transformPoint({ x, y }); return { x: q.x, y: q.y }; });
    },

    inQuad(q, x, y) {
        let inside = false;
        for (let i = 0, j = 3; i < 4; j = i++) {
            if ((q[i].y > y) !== (q[j].y > y) && x < (q[j].x - q[i].x) * (y - q[i].y) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
        }
        return inside;
    },

    // 3×3 matrices, row by row: [a b c; d e f; g h i] takes (x, y, 1)
    hom(M) { return [M.a, M.c, M.e, M.b, M.d, M.f, 0, 0, 1]; },

    homMul(A, B) {
        const r = [];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]);
        return r;
    },

    homAt(H, x, y) {
        const w = H[6] * x + H[7] * y + H[8];
        return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
    },

    // The rectangle 0,0 to w,h onto the four corners q (nw, ne, se, sw)
    homRectToQuad(w, h, q) {
        const [p0, p1, p2, p3] = q;
        const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
        let g = 0, k = 0;
        if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
            const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
            const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
            g = (sx * dy2 - dx2 * sy) / den;
            k = (dx1 * sy - sx * dy1) / den;
        }
        const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + k * p3.x, d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + k * p3.y;
        return [a / w, b / h, p0.x, d / w, e / h, p0.y, g / w, k / h, 1];
    },

    // src (sw by sh) drawn onto g through H, on top of g's transform
    drawHom(g, src, H, sw, sh, n = 24) {
        if (Math.abs(H[6]) < 1e-12 && Math.abs(H[7]) < 1e-12) {
            g.save();
            g.transform(H[0] / H[8], H[3] / H[8], H[1] / H[8], H[4] / H[8], H[2] / H[8], H[5] / H[8]);
            g.drawImage(src, 0, 0);
            g.restore();
            return;
        }
        this.drawMap(g, src, (x, y) => this.homAt(H, x, y), sw, sh, n);
    },

    // src's sw × sh px drawn through any smooth mapping of them (as small
    // triangles, each drawn straight)
    drawMap(g, src, at, sw, sh, n = 24) {
        const tri = (s0, s1, s2, d0, d1, d2, cx, cy, cw, ch) => {
            const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
            if (!det) return;
            const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
            const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
            const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
            const dd = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;
            const e = d0.x - a * s0.x - c * s0.y, f = d0.y - b * s0.x - dd * s0.y;
            // Grown a little round its middle, so no seams show
            const mx = (d0.x + d1.x + d2.x) / 3, my = (d0.y + d1.y + d2.y) / 3;
            const out = (q) => { const l = Math.hypot(q.x - mx, q.y - my) || 1; return { x: q.x + (q.x - mx) / l * 1.2, y: q.y + (q.y - my) / l * 1.2 }; };
            const [e0, e1, e2] = [out(d0), out(d1), out(d2)];
            g.save();
            g.beginPath();
            g.moveTo(e0.x, e0.y); g.lineTo(e1.x, e1.y); g.lineTo(e2.x, e2.y); g.closePath();
            g.clip();
            g.transform(a, b, c, dd, e, f);
            g.drawImage(src, cx, cy, cw, ch, cx, cy, cw, ch);
            g.restore();
        };
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            const u0 = sw * i / n, u1 = sw * (i + 1) / n, v0 = sh * j / n, v1 = sh * (j + 1) / n;
            const s00 = { x: u0, y: v0 }, s10 = { x: u1, y: v0 }, s11 = { x: u1, y: v1 }, s01 = { x: u0, y: v1 };
            const [d00, d10, d11, d01] = [s00, s10, s11, s01].map(q => at(q.x, q.y));
            const cx = Math.max(0, Math.floor(u0) - 2), cy = Math.max(0, Math.floor(v0) - 2);
            const cw = Math.min(sw, Math.ceil(u1) + 2) - cx, ch = Math.min(sh, Math.ceil(v1) + 2) - cy;
            if (cw <= 0 || ch <= 0) continue;
            tri(s00, s10, s11, d00, d10, d11, cx, cy, cw, ch);
            tri(s00, s11, s01, d00, d11, d01, cx, cy, cw, ch);
        }
    },

    // A corner or side dragged with the corners free
    dragQuad(p) {
        const d = this.drag, f = this.float, o = d.quad, q = o.map(x => ({ ...x }));
        const dx = p.ox - d.start.ox, dy = p.oy - d.start.oy;
        const C = { nw: 0, ne: 1, se: 2, sw: 3 }, E = { n: [0, 1], e: [1, 2], s: [3, 2], w: [0, 3] };
        const add = (i, x, y) => { q[i] = { x: o[i].x + x, y: o[i].y + y }; };
        if (d.part === 'move') {
            for (let i = 0; i < 4; i++) add(i, dx, dy);
        } else if (d.part in C) {
            const i = C[d.part], across = dx * dx >= dy * dy;
            if (d.how === 'perspective') {
                // Its neighbour along that side goes the other way
                if (across) { const j = [1, 0, 3, 2][i]; add(i, dx, 0); add(j, -dx, 0); } else { const j = [3, 2, 1, 0][i]; add(i, 0, dy); add(j, 0, -dy); }
            } else if (d.how === 'skew') {
                if (across) add(i, dx, 0); else add(i, 0, dy);
            } else add(i, dx, dy);
        } else if (d.part in E) {
            const [i, j] = E[d.part];
            if (d.how === 'distort') { add(i, dx, dy); add(j, dx, dy); } else {
                // Skew (and perspective): the side slides along itself
                const ux = o[j].x - o[i].x, uy = o[j].y - o[i].y, l = Math.hypot(ux, uy) || 1;
                const t = (dx * ux + dy * uy) / l;
                add(i, ux / l * t, uy / l * t); add(j, ux / l * t, uy / l * t);
            }
        }
        f.quad = q;
    },

    // Put down where it is
    commitFloat() {
        let f = this.float;
        if (!f) return;
        // Put past the layers' edges: they grow to keep all of it
        this.growFor(f);
        f = this.float;
        this.float = null;
        const l = f.layer;
        const g = l.canvas.getContext('2d');
        let text = null;
        // Its own px to layer px, as a 3×3: through the quad, or the move
        const A = this.hom(new DOMMatrix().translate(-f.x0, -f.y0).multiply(this.C));
        const out = f.quad ? this.homRectToQuad(f.w, f.h, f.quad) : this.hom(this.floatM.call({ float: f, view: this.view }));
        const K = this.homMul(this.hom(this.Ci), this.homMul(out, A));
        const slid = !f.quad && !f.mesh && !l.src && f.t.rot === 0 && f.t.sx === 1 && f.t.sy === 1;
        let warped = null;
        if (f.mesh) {
            // Warped: plain pixels from here (text and shapes too)
            const at = (x, y) => this.patchAt(f.mesh, x / f.w, y / f.h);
            g.save();
            g.setTransform(this.Ci);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            this.drawMap(g, f.canvas, at, f.w, f.h, 32);
            g.restore();
            if (this.sel) {
                warped = this.newCanvas();
                const wg = warped.getContext('2d');
                wg.setTransform(this.Ci);
                this.drawMap(wg, f.canvas, at, f.w, f.h, 32);
            }
        } else if (!f.sel && !l.text && !l.shape && !slid) {
            // A smart layer: kept as it was before its first transform, so
            // each transform after is drawn from that, not resampled again
            // (the first time, what was lifted, from its own px)
            const orig = l.src ? l.src.canvas : f.canvas;
            const h = l.src ? this.homMul(K, l.src.h) : this.homMul(this.hom(this.Ci), out);
            if (orig === f.canvas) f.kept = true;
            text = { text: null, shape: null, src: { canvas: orig, h: h.map(v => +v.toPrecision(12)) } };
            g.save();
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, this.W, this.H);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            this.drawHom(g, orig, h, orig.width, orig.height);
            g.restore();
        } else if (f.quad) {
            g.save();
            g.setTransform(this.Ci);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            this.drawHom(g, f.canvas, out, f.w, f.h);
            g.restore();
        } else if ((l.text || l.shape) && !f.sel) {
            // Its matrix taken through the move: drawn again, not resampled
            const K = this.Ci.multiply(this.floatM.call({ float: f, view: this.view })).multiply(new DOMMatrix().translate(-f.x0, -f.y0)).multiply(this.C);
            const moved = (r) => r && { ...r, m: this.textArr(this.extM().inverse().multiply(K).multiply(this.textM(r))) };
            text = { text: moved(l.text) || null, shape: moved(l.shape) || null };
            this.drawVec(text, l.canvas);
        } else {
            g.save();
            g.setTransform(this.Ci.multiply(this.floatM.call({ float: f, view: this.view })));
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = 'high';
            g.drawImage(f.canvas, 0, 0);
            g.restore();
        }
        if (!f.kept) f.canvas.width = f.canvas.height = 0;
        // The selection moves with it (warped: what's left where it went)
        if (warped) {
            this.dropSelection();
            this.sel = { mask: warped };
            this.selectionChanged();
        } else if (this.sel) {
            const m = this.newCanvas();
            const mg = m.getContext('2d');
            mg.imageSmoothingEnabled = true;
            this.drawHom(mg, this.sel.mask, K, this.W, this.H);
            this.dropSelection();
            this.sel = { mask: m };
            this.selectionChanged();
        }
        this.endPixels(l, { x: 0, y: 0, w: this.W, h: this.H }, { free: true, name: 'Move', vec: text });
        this.buildOptions();
        this.renderSoon();
    },

    // ---- Warp (Free transform's Mode → Warp) ----
    //
    // A smooth bend: 16 points (f.mesh, rows top to bottom, in the picture
    // as shown), a bicubic Bézier patch over what's lifted. The corners are
    // its corners; the others pull the edges and the middle toward them

    // The mesh over what's floating as it is now (its quad or its box)
    meshOf(f, flat = false) {
        const c = flat || !f.mesh ? (f.quad || this.quadOf(f)) : null;
        if (!c) return f.mesh;
        const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
        const m = [];
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) m.push(lerp(lerp(c[0], c[1], i / 3), lerp(c[3], c[2], i / 3), j / 3));
        return m;
    },

    // Warp on (a mesh from the shape it has) or off (back to that shape)
    setWarp(on) {
        const f = this.float;
        if (!f || !!f.mesh === on) return;
        f.mesh = on ? this.meshOf(f) : null;
        this.buildOptions();
        this.renderSoon();
    },

    // The patch at (u, v), each 0 to 1
    patchAt(m, u, v) {
        const b = (t) => { const s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; };
        const bu = b(u), bv = b(v);
        let x = 0, y = 0;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const w = bu[i] * bv[j], q = m[j * 4 + i]; x += q.x * w; y += q.y * w; }
        return { x, y };
    },

    // Inside the patch (near enough: inside its outline, sampled)
    inMesh(m, x, y) {
        const n = 12, pts = [];
        for (let i = 0; i < n; i++) pts.push(this.patchAt(m, i / n, 0));
        for (let i = 0; i < n; i++) pts.push(this.patchAt(m, 1, i / n));
        for (let i = n; i > 0; i--) pts.push(this.patchAt(m, i / n, 1));
        for (let i = n; i > 0; i--) pts.push(this.patchAt(m, 0, i / n));
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i], b = pts[j];
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
    },

    dragMesh(p) {
        const d = this.drag, f = this.float, dx = p.ox - d.start.ox, dy = p.oy - d.start.oy;
        f.mesh = d.mesh.map((q, i) => d.part === 'move' || d.part === 'm' + i ? { x: q.x + dx, y: q.y + dy } : { ...q });
    },

    // Its outline and the lines across at the thirds, and the points
    drawMesh(ctx, outline) {
        const m = this.float.mesh, z = this.view.z, path = new Path2D(), n = 16;
        for (const k of [0, 1 / 3, 2 / 3, 1]) {
            for (const across of [true, false]) {
                for (let i = 0; i <= n; i++) {
                    const q = across ? this.patchAt(m, i / n, k) : this.patchAt(m, k, i / n);
                    if (i) path.lineTo(q.x, q.y); else path.moveTo(q.x, q.y);
                }
            }
        }
        outline(path, [4 / z, 3 / z]);
        for (const q of m) {
            ctx.beginPath();
            ctx.arc(q.x, q.y, 4 / z, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.lineWidth = 1.5 / z;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.stroke();
        }
    },

    // How far past the layers' edges what's floating reaches (layer px,
    // each side), or null: inside them
    reachOf(f) {
        const pts = f.mesh ? f.mesh : f.quad ? f.quad : (() => { const M = this.floatM.call({ float: f, view: this.view }); return [[0, 0], [f.w, 0], [0, f.h], [f.w, f.h]].map(([x, y]) => M.transformPoint({ x, y })); })();
        const q = pts.map(p => this.Ci.transformPoint(p)), xs = q.map(p => p.x), ys = q.map(p => p.y);
        const out = (v) => Math.max(0, Math.ceil(v - 0.01));
        const r = { l: out(-Math.min(...xs)), t: out(-Math.min(...ys)), r: out(Math.max(...xs) - this.W), b: out(Math.max(...ys) - this.H) };
        return r.l || r.t || r.r || r.b ? r : null;
    },

    // The layers grown so what's floating fits on them, kept past the
    // canvas (hidden there, not written by Export) to come back when it's
    // moved in again or the canvas is made bigger. One step of Undo before
    // the move's own; up to three times the photo's size
    growFor(f) {
        const need = this.reachOf(f);
        if (!need) return;
        const cap = 3 * Math.max(this.PW, this.PH);
        const room = (have, k) => Math.max(0, Math.min(need[k], cap - have));
        const e0 = this.ext;
        const add = { l: room(this.W, 'l') }; add.r = room(this.W + add.l, 'r');
        add.t = room(this.H, 't'); add.b = room(this.H + add.t, 'b');
        const W = this.W + add.l + add.r, H = this.H + add.t + add.b;
        if (!(add.l || add.t || add.r || add.b) || W > 16384 || H > 16384 || W * H > Math.max(36e6, 4 * this.PW * this.PH)) return;
        const l = f.layer, grow = (c, white = false) => {
            const n = this.newCanvas(W, H), g = n.getContext('2d');
            if (white) { g.fillRect(0, 0, W, H); g.clearRect(add.l, add.t, c.width, c.height); }
            g.drawImage(c, add.l, add.t);
            return n;
        };
        // The layer as it was before it was lifted, and as it is (lifted)
        const was = this.newCanvas(this.W, this.H);
        was.getContext('2d').drawImage(this.before, 0, 0);
        const before = this.canvasState();
        before.canvases.set(l.id, was);
        const canvases = new Map();
        for (const k of this.layers) {
            canvases.set(k.id, grow(k === l ? was : k.canvas));
            if (k.mask) canvases.set(k.id + 'm', grow(k.mask, true));
        }
        const lifted = grow(l.canvas), sel = this.sel && grow(this.sel.mask);
        const ext = { l: e0.l + add.l, t: e0.t + add.t, r: e0.r + add.r, b: e0.b + add.b };
        const after = { ext, pad: this.pad, fill: this.fill, canvases, keepView: true };
        before.keepView = true;
        this.float = null;
        this.applyCanvas(after);
        this.record({ kind: 'canvas', name: 'Move', before, after, bytes: W * H * 4 * this.layers.length });
        // Lifted again, on the grown layer: the move's own step from here
        this.beginPixels(l);
        l.canvas = lifted;
        if (sel) { this.sel = { mask: sel }; this.selectionChanged(); }
        this.float = f;
    },

    // Put back as it was
    cancelFloat() {
        const f = this.float;
        if (!f) return;
        this.float = null;
        const l = f.layer;
        const g = l.canvas.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(this.before, 0, 0);
        g.globalCompositeOperation = 'source-over';
        f.canvas.width = f.canvas.height = 0;
        this._beforeOf = null;
        this.buildOptions();
        this.renderSoon();
    },

    // Thrown away (Delete while moving)
    discardFloat() {
        const f = this.float;
        if (!f) return;
        this.float = null;
        f.canvas.width = f.canvas.height = 0;
        this.endPixels(f.layer, { x: 0, y: 0, w: this.W, h: this.H }, { free: true, name: 'Delete' });
        this.buildOptions();
        this.renderSoon();
    },

    // Copy and paste, inside Paint: what's selected on this layer
    // Ctrl+C: what's selected on this layer. Copy merged (Ctrl+Shift+C):
    // the photo and every layer shown, as they look together
    copy({ merged = false } = {}) {
        const l = this.layer();
        if (!l) return;
        const b = this.sel ? this.sel.box : { x: 0, y: 0, w: this.W, h: this.H };
        const c = this.newCanvas(b.w, b.h);
        const g = c.getContext('2d');
        if (merged) {
            g.drawImage(this.photo, -b.x, -b.y, this.W, this.H);
            for (const k of this.layers) {
                if (!this.isShown(k)) continue;
                g.save();
                this.drawShown(g, k, -b.x, -b.y);
                g.restore();
            }
        } else g.drawImage(l.canvas, -b.x, -b.y);
        if (this.sel) {
            g.globalCompositeOperation = 'destination-in';
            g.drawImage(this.sel.mask, -b.x, -b.y);
        }
        if (this._clip) this._clip.width = this._clip.height = 0;
        this._clip = c;
        this._clipAt = { x: b.x, y: b.y };
        this._clipStale = false;
        this.app.showToast(merged ? 'Copied, merged' : 'Copied', 1000);
    },

    // Ctrl+V: in the middle of what's on screen. Paste in place
    // (Ctrl+Shift+V): where it was copied from
    paste({ inPlace = false } = {}) {
        // By the key: the paste event the key also sends isn't a second paste
        if (inPlace) this._pastedAt = performance.now();
        const c = this._clip;
        if (!c) { this.app.showToast('Nothing copied yet: select something and copy it (Ctrl+C)', 2000); return; }
        if (this.float) this.commitFloat();
        const l = this.layer();
        this.beginPixels(l);
        const fc = this.newCanvas(c.width, c.height);
        fc.getContext('2d').drawImage(c, 0, 0);
        // In the middle of what's on screen (as shown), or in place (in the layer)
        const mid = this.V().inverse().transformPoint({ x: this.cssW / 2, y: this.cssH / 2 });
        const here = inPlace && this._clipAt;
        const at = here ? this.C.transformPoint({ x: this._clipAt.x + c.width / 2, y: this._clipAt.y + c.height / 2 }) : mid;
        // In place, turned and flipped as the photo is shown, so it lands
        // on the very pixels it came from
        const C = this.C, flip = C.a * C.d - C.b * C.c < 0;
        const t = here ? { tx: 0, ty: 0, sx: 1, sy: flip ? -1 : 1, rot: Math.atan2(C.b, C.a) } : { tx: 0, ty: 0, sx: 1, sy: 1, rot: 0 };
        this.float = { canvas: fc, x0: at.x - c.width / 2, y0: at.y - c.height / 2, w: c.width, h: c.height, t, layer: l, sel: null };
        this.dropSelection();
        this.setTool('move');
        this.renderSoon();
    },

    // ---- Images brought in (Import image…, dropped on, or pasted from
    // another app): each on a layer of its own, named for it, fitted in the
    // picture and left floating, to move, size and turn before Enter puts
    // it down ----

    IMPORT_MAX: 4096, // pixels a side kept of an image brought in

    pickImage() {
        if (!this.ready || this.busy) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*,.dng,.cr2,.cr3,.nef,.arw,.orf,.rw2,.raf,.pef,.srw';
        input.multiple = true;
        input.addEventListener('change', () => this.importFiles([...input.files]));
        input.click();
    },

    // Files: the images among them, one after another (the last left floating)
    async importFiles(files) {
        const images = files.filter(f => /^image\//.test(f.type) || this.app.isImage(f.name));
        if (!images.length) {
            if (files.length) this.app.showToast('Only images can be brought into Paint', 2000);
            return 0;
        }
        let n = 0;
        for (const f of images) if (await this.importImage(f, f.name)) n++;
        return n;
    },

    // One of the folder's photos, dragged in from the film strip
    async importPhoto(file) {
        if (!this.ready || this.busy) return false;
        let data;
        try { data = await this.app.readImage(file); } catch (e) { this.app.showToast(`Couldn't open ${file.name}`, 2500); return false; }
        return this.importImage(data, file.name.replace(/\.[^.]+$/, ''));
    },

    async importImage(blob, name = 'Image') {
        if (!this.ready || this.busy) return false;
        if (this.layers.length >= Paint.MAX_LAYERS) {
            this.app.showToast(`Up to ${Paint.MAX_LAYERS} layers: merge some (Ctrl+E) to bring in more`, 2500);
            return false;
        }
        let bmp;
        try {
            const src = Raw.is(name) ? await Raw.preview(blob) : blob;
            if (!src) throw new Error('no preview in this RAW file');
            bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
        } catch (e) {
            this.app.showToast(`Couldn't open ${name} as an image`, 2500);
            return false;
        }
        if (!this.isOpen || !this.ready) { bmp.close(); return false; }
        if (this.float) this.commitFloat();
        const k = Math.min(1, this.IMPORT_MAX / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const fc = this.newCanvas(w, h);
        const fg = fc.getContext('2d');
        fg.imageSmoothingQuality = 'high';
        fg.drawImage(bmp, 0, 0, w, h);
        bmp.close();
        // A layer of its own, above this one
        this.pushState('Bring in an image');
        this.layers.splice(this.cur + 1, 0, this.makeLayer(String(name).replace(/\.[^.]+$/, '').slice(0, 40) || 'Image'));
        this.cur++;
        this.afterState();
        const l = this.layer();
        this.beginPixels(l);
        // Fitted in the picture (never made bigger), in the middle of what's on screen
        const fit = Math.min(1, 0.9 * this.OW / w, 0.9 * this.OH / h);
        const mid = this.V().inverse().transformPoint({ x: this.cssW / 2, y: this.cssH / 2 });
        mid.x = Math.max(0, Math.min(this.OW, mid.x));
        mid.y = Math.max(0, Math.min(this.OH, mid.y));
        this.float = { canvas: fc, x0: mid.x - w / 2, y0: mid.y - h / 2, w, h, t: { tx: 0, ty: 0, sx: fit, sy: fit, rot: 0 }, layer: l, sel: null };
        this.dropSelection();
        this.setTool('move');
        this.renderSoon();
        this.app.showToast('Drag it to move it, a corner to size it (Shift keeps its shape); Enter puts it down', 3500);
        return true;
    },

    // Dropped on Paint, or pasted from another app (Ctrl+V with nothing
    // copied in Paint)
    initImport() {
        // A photo from the film strip (Modes.STRIP_TYPE), or files from outside
        const outside = (e) => this.isOpen && !!e.dataTransfer && [...e.dataTransfer.types].some(t => t === 'Files' || t === Modes.STRIP_TYPE);
        document.addEventListener('dragover', (e) => {
            if (!outside(e)) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        }, true);
        document.addEventListener('drop', (e) => {
            if (!outside(e)) return;
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.remove('drag-over');
            const f = Modes.dragging;
            if (f) this.importPhoto(f);
            else this.importFiles([...e.dataTransfer.files]);
        }, true);
        document.addEventListener('paste', (e) => {
            if (!this.isOpen || !e.clipboardData) return;
            if (this.app.isTypingTarget(e.target)) return;
            // Pasted by the key already (a Mac's Edit menu sends both)
            if (performance.now() - (this._pastedAt || 0) < 300) { e.preventDefault(); return; }
            const files = [...e.clipboardData.items].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean);
            e.preventDefault();
            if (files.length) this.importImage(files[0], files[0].name && files[0].name !== 'image.png' ? files[0].name : 'Pasted');
            else this.paste();
        });
        // Away to another app: what's copied there may be newer than Paint's own copy
        window.addEventListener('blur', () => { if (this._clip) this._clipStale = true; });
    },

    // Ctrl+V: Paint's own copy if it's the newest thing copied; else the
    // system's clipboard, through the paste event (false: let it come)
    pasteKey() {
        if (this._clip && !this._clipStale) { this._pastedAt = performance.now(); this.paste(); return true; }
        return false;
    },

    // ---- Drawn over the photo: selection, shapes being drawn, handles ----

    drawSelection(ctx, VD, LD) {
        if (!this.sel || !this.sel.edge || this.float) return;
        ctx.save();
        ctx.setTransform(LD);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.sel.edge, 0, 0);
        ctx.restore();
    },

    drawGuides(ctx, VD, LD) {
        const d = this.drag, z = this.view.z;
        ctx.save();
        ctx.setTransform(VD);
        const outline = (path, dash = [5 / z, 4 / z]) => {
            for (const [c, w] of [['rgba(0,0,0,0.7)', 2.5 / z], ['#fff', 1.2 / z]]) {
                ctx.setLineDash(c === '#fff' ? dash : []);
                ctx.strokeStyle = c;
                ctx.lineWidth = w;
                ctx.stroke(path);
            }
            ctx.setLineDash([]);
        };
        if (d && d.kind === 'shape') {
            const { a, b } = this.shapeGeom(d);
            if (this.tool === 'gradient' || this.tool.endsWith('select')) {
                outline(this.shapePath(this.tool === 'gradient' ? 'line' : this.tool, a, b));
            } else {
                ctx.globalAlpha = this.opts.opacity / 100;
                this.drawShape(ctx, this.tool, a, b);
                ctx.globalAlpha = 1;
            }
        }
        if (this.poly && this.tool === 'polygon') {
            const pts = this.poly.pts.slice();
            if (this.hover) pts.push([this.hover.ox, this.hover.oy]);
            const pl = new Path2D();
            pts.forEach(([x, y], i) => i ? pl.lineTo(x, y) : pl.moveTo(x, y));
            ctx.globalAlpha = this.opts.opacity / 100;
            ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.strokeStyle = this.fg; ctx.lineWidth = Math.max(this.opts.lineWidth, 1 / z);
            ctx.stroke(pl);
            ctx.globalAlpha = 1;
            const f = this.poly.pts[0];
            ctx.beginPath(); ctx.arc(f[0], f[1], 5 / z, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill();
            ctx.lineWidth = 1.5 / z; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
        }
        if (d && d.kind === 'lasso' && d.pts.length > 1) {
            const p = new Path2D();
            d.pts.forEach((q, i) => i ? p.lineTo(q.ox, q.oy) : p.moveTo(q.ox, q.oy));
            outline(p);
        }
        if (this.float && this.float.mesh) this.drawMesh(ctx, outline);
        else if (this.float) {
            const h = this.floatHandles(), f = this.float;
            const box = new Path2D();
            const c = h.corners.map(x => x[1]);
            box.moveTo(c[0].x, c[0].y); box.lineTo(c[1].x, c[1].y); box.lineTo(c[3].x, c[3].y); box.lineTo(c[2].x, c[2].y); box.closePath();
            outline(box, [4 / z, 3 / z]);
            if (h.knob) {
                const top = h.M.transformPoint({ x: f.w / 2, y: 0 });
                const knob = new Path2D();
                knob.moveTo(top.x, top.y); knob.lineTo(h.knob.x, h.knob.y);
                outline(knob, []);
            }
            for (const q of [...c, ...h.edges.map(x => x[1]), ...(h.knob ? [h.knob] : [])]) {
                ctx.beginPath();
                ctx.arc(q.x, q.y, (h.edges.some(x => x[1] === q) ? 4 : 5) / z, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.lineWidth = 1.5 / z;
                ctx.strokeStyle = 'rgba(0,0,0,0.7)';
                ctx.stroke();
            }
        }
        // The brush under the pointer; as its size changes, how it'll paint
        // and the size (in the middle when it's changed along the top)
        const sizing = performance.now() < (this._sizeUntil || 0);
        const brush = this.isBrush() && !this.space && !(d && d.kind === 'pan') && !this.picking();
        const at = this.hover || (sizing ? this.V().inverse().transformPoint({ x: this.cssW / 2, y: this.cssH / 2 }) : null);
        const ox = at && (at.ox !== undefined ? at.ox : at.x), oy = at && (at.oy !== undefined ? at.oy : at.y);
        const r = this.radius();
        // Symmetry: its lines through the picture's middle, faintly
        const sym = this.opts.symmetry || 'off';
        if (brush && sym !== 'off') {
            const cx = this.OW / 2, cy = this.OH / 2, m = new Path2D();
            if (sym === 'x' || sym === 'xy') { m.moveTo(cx, 0); m.lineTo(cx, this.OH); }
            if (sym === 'y' || sym === 'xy') { m.moveTo(0, cy); m.lineTo(this.OW, cy); }
            if (sym[0] === 'r') {
                const n = +sym.slice(1), R = Math.hypot(cx, cy);
                for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + Math.PI * 2 * i / n; m.moveTo(cx, cy); m.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
            }
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.rect(0, 0, this.OW, this.OH); ctx.clip();
            outline(m, [6 / z, 5 / z]);
            ctx.restore();
        }
        if (brush && at) {
            // Shift held: the straight line a click paints from the last stroke
            if (!d && this.hover && this.hover.shift && this.lastDab && this.tool !== 'spray') {
                const from = this.C.transformPoint(this.lastDab), line = new Path2D();
                line.moveTo(from.x, from.y);
                line.lineTo(ox, oy);
                outline(line);
            }
            if ((sizing && !this.RETOUCH.includes(this.tool) && !this.TONE.includes(this.tool)) || this.tool === 'stamp') this.drawGhost(ctx, ox, oy, r);
            // Heal and clone: a + where they're copying from
            if ((this.tool === 'heal' || this.tool === 'clone') && this.healSrc) {
                const off = d && d.kind === 'paint' && d.off ? d.off : !this.alt && this.opts.aligned && this.healOff ? this.healOff : null;
                const q = this.C.transformPoint(off && at.ox !== undefined ? { x: at.x + off.dx, y: at.y + off.dy } : this.healSrc);
                const m = new Path2D(), k = Math.max(r, 4 / z), c = 5 / z;
                m.arc(q.x, q.y, k, 0, Math.PI * 2);
                m.moveTo(q.x - c, q.y); m.lineTo(q.x + c, q.y);
                m.moveTo(q.x, q.y - c); m.lineTo(q.x, q.y + c);
                outline(m, [3 / z, 3 / z]);
            }
            const p = new Path2D();
            if (this.tool === 'pencil' || this.tool === 'eraser-block') {
                const s = Math.max(1, Math.round(this.opts.size));
                p.rect(Math.round(ox - s / 2), Math.round(oy - s / 2), s, s);
            } else if (this.tool === 'pixel' && at.x !== undefined && at.ox !== undefined) {
                // The square of the grid it'll paint
                const s = this.pixelCell(), x = Math.floor(at.x / s) * s, y = Math.floor(at.y / s) * s;
                const c = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]].map(([a, b]) => this.C.transformPoint({ x: a, y: b }));
                p.moveTo(c[0].x, c[0].y); c.slice(1).forEach(q => p.lineTo(q.x, q.y)); p.closePath();
            } else if (this.tool === 'stamp') {
                const s = Math.max(4, this.opts.size);
                p.rect(ox - s / 2, oy - s / 2, s, s);
            } else p.arc(ox, oy, Math.max(r, 1 / z), 0, Math.PI * 2);
            // Too small to see: a cross round it, to show where it'll paint
            if (r * z < 4) {
                const g = Math.max(r, 1 / z) + 3 / z, s = 6 / z;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    p.moveTo(ox + dx * g, oy + dy * g);
                    p.lineTo(ox + dx * (g + s), oy + dy * (g + s));
                }
            }
            outline(p, []);
        }
        // QuickShape: what the stroke became, while it's held
        if (d && d.kind === 'paint' && d.snap && at) {
            this.drawLabel(ctx, d.snap.name, this.V().transformPoint({ x: ox, y: oy }), r * z);
        }
        if (sizing && at) {
            const v = this.opts[this.sizeKey()];
            this.drawLabel(ctx, `${this.sizeLabel(v)} px`, this.V().transformPoint({ x: ox, y: oy }), brush ? r * z : 0);
        }
        ctx.restore();
    },

    // How the brush paints, faintly, at (x, y) in the picture as shown
    drawGhost(ctx, x, y, r) {
        const o = this.opts, t = this.tool;
        const feel = this.FEEL[t] || {};
        const rgb = this.rgb(this.ERASERS.includes(t) ? '#ffffff' : this.fg);
        const a = 0.7 * o.opacity / 100 * (feel.flow && !feel.build ? o.flow / 100 : 1) * (t === 'spray' || feel.build ? 0.4 : 1);
        const hard = feel.hard !== undefined ? feel.hard : t === 'brush' || t === 'eraser' ? o.hardness / 100 : 1;
        ctx.save();
        if (hard >= 0.99) ctx.fillStyle = `rgba(${rgb.join(',')},${a})`;
        else {
            const g = ctx.createRadialGradient(x, y, r * hard, x, y, r);
            g.addColorStop(0, `rgba(${rgb.join(',')},${a})`);
            g.addColorStop(1, `rgba(${rgb.join(',')},0)`);
            ctx.fillStyle = g;
        }
        ctx.beginPath();
        if (t === 'stamp') {
            ctx.globalAlpha = 0.6;
            this.drawStamp(ctx, x, y, Math.max(4, o.size), ctx.fillStyle);
            ctx.restore();
            return;
        }
        if (t === 'pencil' || t === 'pixel' || t === 'eraser-block') {
            const s = Math.max(1, Math.round(o.size));
            ctx.rect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
        } else ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    // A label under a point on screen (css px), below a brush of radius rs
    // there, kept inside the view
    drawLabel(ctx, text, s, rs) {
        const dpr = this.dpr || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // The theme's typeface: a canvas doesn't inherit one
        const font = getComputedStyle(ctx.canvas).getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif';
        ctx.font = `600 12px ${font}`;
        const w = Math.ceil(ctx.measureText(text).width) + 16, h = 22;
        let x = s.x - w / 2, y = s.y + rs + 10;
        if (y + h > this.cssH - 6) y = s.y - rs - 10 - h;
        x = Math.min(this.cssW - w - 6, Math.max(6, x));
        y = Math.min(this.cssH - h - 6, Math.max(6, y));
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, h / 2); else ctx.rect(x, y, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
        ctx.restore();
    },

    // ---- Layers ----

    drawLayersSoon() {
        clearTimeout(this._layersTimer);
        this._layersTimer = setTimeout(() => this.drawLayers(), 150);
    },

    drawLayers() {
        if (this._batch) return;
        this.drawHistory();
        const list = this.el('paint-layer-list');
        if (!list || !this.ready) return;
        list.textContent = '';
        const asp = this.W / this.H;
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const l = this.layers[i];
            const gr = l.group && this.groups[l.group];
            if (gr && (i === this.layers.length - 1 || this.layers[i + 1].group !== l.group)) list.appendChild(this.groupRow(l.group));
            if (gr && !gr.open) continue;
            const row = document.createElement('div');
            row.className = 'paint-layer' + (l.hidden ? ' hidden-layer' : '') + (this.baseOf(i) >= 0 ? ' clipped' : '') + (gr ? ' in-group' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(i === this.cur));
            row.innerHTML = '<button class="paint-eye"></button><canvas></canvas><span class="paint-layer-name"></span>';
            if (l.text) {
                const m = document.createElement('span');
                m.className = 'paint-layer-kind';
                m.textContent = 'T';
                m.title = 'Text: double-click, or click it with the Text tool, to change it';
                row.appendChild(m);
                row.addEventListener('dblclick', (e) => { e.preventDefault(); this.editText(i); });
            }
            if (l.src) {
                const m = document.createElement('span');
                m.className = 'paint-layer-kind';
                m.textContent = '⧉';
                m.title = 'Transformed: kept as it was, so transforming it again stays sharp. Painting on it makes it plain pixels';
                row.appendChild(m);
            }
            if (l.shape) {
                const m = document.createElement('span');
                m.className = 'paint-layer-kind';
                m.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="11" height="11" rx="1"/><circle cx="15" cy="15" r="6"/></svg>';
                m.title = 'Shape: with its tool out, the line, fill and colours change it; double-click for its tool';
                row.appendChild(m);
                row.addEventListener('dblclick', (e) => { e.preventDefault(); this.cur = i; this.onMask = false; this.setTool(l.shape.kind); this.drawLayers(); });
            }
            if (this.baseOf(i) >= 0) {
                const m = document.createElement('span');
                m.className = 'paint-layer-clip';
                m.textContent = '↳';
                m.title = `Clipped to ${this.layers[this.baseOf(i)].name}: it shows only where that layer has paint`;
                row.querySelector('canvas').before(m);
            }
            if (l.fixed) {
                const m = document.createElement('span');
                m.className = 'paint-layer-lock fixed';
                m.title = 'Locked: nothing is painted on it, moved or transformed (right-click to unlock)';
                m.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
                row.appendChild(m);
            }
            if (l.lock) {
                const m = document.createElement('span');
                m.className = 'paint-layer-lock';
                m.title = 'Transparency locked (/): painting stays on what\'s there';
                m.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
                row.appendChild(m);
            }
            const eye = row.querySelector('.paint-eye');
            eye.title = (l.hidden ? 'Show' : 'Hide') + ' (Alt-click: this layer alone)';
            eye.setAttribute('aria-label', `${l.hidden ? 'Show' : 'Hide'} ${l.name}`);
            eye.innerHTML = l.hidden
                ? '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2l20 20M10.6 6.1A10 10 0 0 1 22 12a14 14 0 0 1-2.4 3.4M6.6 6.6A14 14 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>'
                : '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
            eye.addEventListener('click', (e) => {
                e.stopPropagation();
                eye.blur();
                if (e.altKey) { this.soloLayer(i); return; }
                this.pushState(l.hidden ? 'Show layer' : 'Hide layer');
                l.hidden = !l.hidden;
                l.changed = true;
                this.afterState();
            });
            const cv = row.querySelector('canvas');
            cv.width = 96;
            cv.height = 72;
            const g = cv.getContext('2d');
            const w = asp > 96 / 72 ? 96 : 72 * asp, h = asp > 96 / 72 ? 96 / asp : 72;
            if (l.adj) {
                // (half dark, half light: what it does is to what's under it)
                g.fillStyle = '#222';
                g.beginPath(); g.arc(48, 36, 22, Math.PI / 2, Math.PI * 1.5); g.fill();
                g.fillStyle = '#eee';
                g.beginPath(); g.arc(48, 36, 22, -Math.PI / 2, Math.PI / 2); g.fill();
                g.strokeStyle = '#888'; g.lineWidth = 1.5;
                g.beginPath(); g.arc(48, 36, 22, 0, Math.PI * 2); g.stroke();
                cv.title = 'An adjustment layer: double-click for its settings; paint black on its mask to keep it off there';
            } else g.drawImage(l.canvas, (96 - w) / 2, (72 - h) / 2, w, h);
            row.querySelector('.paint-layer-name').textContent = l.name;
            cv.title = Host.keys('Ctrl+click: select its pixels (Shift adds, Alt takes away)');
            cv.addEventListener('click', (e) => {
                if (!(e.ctrlKey || e.metaKey)) { this.onMask = false; return; }
                e.stopPropagation();
                this.selectLayerPixels(i, e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new');
            });
            // Its mask: white shows, black hides; click it to paint on it
            if (l.mask) {
                const mc = document.createElement('canvas');
                mc.width = 96;
                mc.height = 72;
                mc.className = 'paint-mask-thumb';
                const mg = mc.getContext('2d');
                mg.fillStyle = '#fff';
                mg.fillRect(0, 0, 96, 72);
                mg.globalCompositeOperation = 'destination-in';
                mg.drawImage(l.mask, (96 - w) / 2, (72 - h) / 2, w, h);
                mg.globalCompositeOperation = 'destination-over';
                mg.fillStyle = '#000';
                mg.fillRect(0, 0, 96, 72);
                mc.title = 'The mask: white shows the layer, black hides it. Click to paint on it';
                const editing = i === this.cur && this.onMask;
                mc.classList.toggle('on', editing);
                cv.classList.toggle('on', i === this.cur && !editing);
                mc.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.float) this.commitFloat();
                    this.cur = i;
                    this.editMask(true);
                });
                cv.after(mc);
            }
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.busy) return;
                if (this.float) this.commitFloat();
                if (this.cur !== i) { this.cur = i; this.drawLayers(); }
                this.app.openContextMenu(this.layerItems(i), e.clientX, e.clientY);
            });
            row.addEventListener('click', () => {
                if (this.float) this.commitFloat();
                if (this.cur !== i) this.onMask = false;
                this.cur = i;
                this.drawLayers();
                this.buildOptions();
            });
            row.addEventListener('dblclick', () => { if (l.adj) this.openAdj(i); else this.renameLayer(i); });
            list.appendChild(row);
        }
        // The photo: the bottom layer, locked (painting goes on the layers
        // above it, so it's never changed)
        const base = document.createElement('div');
        base.className = 'paint-layer paint-photo-layer';
        base.setAttribute('role', 'option');
        base.setAttribute('aria-selected', 'false');
        base.setAttribute('aria-disabled', 'true');
        base.title = 'The photo is locked: paint on a layer above it';
        base.innerHTML = '<span class="paint-eye paint-lock"><svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span><canvas></canvas><span class="paint-layer-name">Photo</span>';
        // Made small once for each photo, not on every redraw of the list
        if (this.backdrop && (!this._photoThumb || this._photoThumb.src !== this.backdrop)) {
            const t = document.createElement('canvas');
            t.width = 96;
            t.height = 72;
            const pa = this.backdrop.width / this.backdrop.height;
            const bw = pa > 96 / 72 ? 96 : 72 * pa, bh = pa > 96 / 72 ? 96 / pa : 72;
            t.getContext('2d').drawImage(this.backdrop, (96 - bw) / 2, (72 - bh) / 2, bw, bh);
            this._photoThumb = { src: this.backdrop, canvas: t };
        }
        const bc = base.querySelector('canvas');
        bc.width = 96;
        bc.height = 72;
        if (this._photoThumb) bc.getContext('2d').drawImage(this._photoThumb.canvas, 0, 0);
        base.addEventListener('click', () => this.app.showToast('The photo is locked: paint on a layer above it', 2000));
        list.appendChild(base);
        const l = this.layer();
        if (l) this.el('paint-layer-blend').value = l.blend;
        this.opacityRow._sync();
        this.el('paint-layer-merge').disabled = this.cur <= 0;
        this.el('paint-layer-down').disabled = this.cur <= 0;
        this.el('paint-layer-up').disabled = this.cur >= this.layers.length - 1;
        this.el('paint-layer-delete').disabled = this.layers.length <= 1;
        this.el('paint-undo').disabled = !this.history.length && !this.float;
        this.el('paint-redo').disabled = !this.future.length;
    },

    // A group's row: its eye, open or closed, its name
    groupRow(g) {
        const gr = this.groups[g];
        const row = document.createElement('div');
        row.className = 'paint-layer paint-group-row' + (gr.hidden ? ' hidden-layer' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.setAttribute('aria-expanded', String(gr.open !== false));
        row.innerHTML = '<button class="paint-eye"></button><button class="paint-group-open btn ghost sm"></button><svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span class="paint-layer-name"></span>';
        row.querySelector('.paint-layer-name').textContent = gr.name;
        const eye = row.querySelector('.paint-eye');
        eye.title = gr.hidden ? 'Show the group' : 'Hide the group';
        eye.setAttribute('aria-label', `${gr.hidden ? 'Show' : 'Hide'} ${gr.name}`);
        eye.innerHTML = gr.hidden
            ? '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2l20 20M10.6 6.1A10 10 0 0 1 22 12a14 14 0 0 1-2.4 3.4M6.6 6.6A14 14 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>'
            : '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
        eye.addEventListener('click', (e) => { e.stopPropagation(); eye.blur(); this.toggleGroupShown(g); });
        const open = row.querySelector('.paint-group-open');
        open.textContent = gr.open !== false ? '▾' : '▸';
        open.title = gr.open !== false ? 'Close the group' : 'Open the group';
        open.addEventListener('click', (e) => { e.stopPropagation(); open.blur(); this.toggleGroupOpen(g); });
        row.addEventListener('click', () => {
            // (its top layer chosen)
            const m = this.groupMembers(g);
            if (this.float) this.commitFloat();
            this.onMask = false;
            this.cur = m[m.length - 1];
            this.drawLayers();
            this.buildOptions();
        });
        row.addEventListener('dblclick', () => this.renameGroup(g));
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.busy) return;
            this.app.openContextMenu(this.groupItems(g), e.clientX, e.clientY);
        });
        return row;
    },

    lockedToast() {
        this.app.showToast('This layer\'s transparency is locked (/ unlocks it)', 2200);
    },

    // Lock transparency (/): painting, fills, shapes and text go only where
    // the layer already has paint, and keep how see-through it is
    toggleLock(i = this.cur) {
        const l = this.layers[i];
        if (!l) return;
        this.pushState('Lock transparency');
        l.lock = !l.lock;
        this.afterState();
        this.app.showToast(l.lock ? `${l.name}: transparency locked` : `${l.name}: transparency unlocked`, 1600);
    },

    // Alt-click an eye: that layer alone; again, all of them back
    soloLayer(i) {
        const alone = this.layers.every((l, j) => (j === i) !== !!l.hidden);
        this.pushState('Show one layer');
        this.layers.forEach((l, j) => { l.hidden = alone ? false : j !== i; l.changed = true; });
        this.afterState();
    },

    // Ctrl-click a thumbnail: what's painted on that layer, selected
    selectLayerPixels(i, mode = 'new') {
        const l = this.layers[i];
        if (!l || !this.ready) return;
        const m = this.newCanvas();
        m.getContext('2d').drawImage(l.canvas, 0, 0);
        this.combineSelection(m, mode);
        if (!this.sel) this.app.showToast('Nothing on that layer to select', 1600);
    },

    // A layer's right-click menu
    layerItems(i) {
        const l = this.layers[i], n = this.layers.length, room = n < Paint.MAX_LAYERS;
        return [
            ['Lock transparency', () => this.toggleLock(i), false, !!l.lock, 'paint.lockAlpha'],
            ['Lock the layer', () => this.toggleFixed(i), false, !!l.fixed],
            ...(l.adj ? [['Its settings…', () => this.openAdj(i)]] : []),
            ...(i > 0 ? [['Clip to the layer below', () => this.toggleClip(i), false, !!l.clip, 'paint.clip']] : []),
            ['Show this layer alone', () => this.soloLayer(i)],
            ['Select its pixels', () => this.selectLayerPixels(i)],
            ...(l.group ? [['Take it out of the group', () => this.ungroupLayer(i), false, undefined, 'paint.ungroup']]
                : [['Group it', () => this.groupLayer(i), false, undefined, 'paint.group'], ...(i > 0 ? [['Group with the layer below', () => this.groupWithBelow(i)]] : [])]),
            ...(l.text ? [['—'], ['Edit the text', () => this.editText(i)], ['Make it pixels', () => this.rasterize(i)]] : []),
            ...(l.shape || l.src ? [['—'], ['Make it pixels', () => this.rasterize(i)]] : []),
            ['—'],
            ...(room ? [['Duplicate', () => this.duplicateLayer(), false, undefined, 'paint.duplicate']] : []),
            ...(i > 0 ? [['Merge down', () => this.mergeDown(), false, undefined, 'paint.merge']] : []),
            ['Mask', this.maskItems()],
            ['Rename…', () => this.renameLayer(i)],
            ...(n > 1 ? [['—'], ['Delete layer', () => this.deleteLayer(), true]] : [])
        ];
    },

    // ---- Layer masks ----
    // A layer's mask: a canvas its size whose alpha is how much of the
    // layer shows. Painting on it (its thumbnail chosen) with a dark colour
    // hides, a light one shows again; the eraser hides. Kept as a file of
    // its own beside the layer's (paint.js: maskOf)

    // What painting goes on: the layer, or its mask
    target() {
        const l = this.layer();
        return l && l.mask && (this.onMask || l.adj) ? this.maskTarget(l) : l;
    },

    // The mask, as a layer for the strokes and Undo (its changes mark the
    // mask changed)
    maskTarget(l) {
        if (l._mt && l._mt.owner === l) return l._mt;
        const owner = l;
        l._mt = {
            isMask: true, owner, lock: false, hidden: false, opacity: 1, blend: 'source-over',
            get name() { return `${owner.name} mask`; },
            get canvas() { return owner.mask; },
            get changed() { return !!owner.maskChanged; },
            set changed(v) { if (v) owner.maskChanged = true; }
        };
        return l._mt;
    },

    // The layer as it shows: its pixels through its mask (a new canvas)
    shownOf(l) {
        const src = l.mask ? Paint.masked(l.canvas, l.mask) : l.canvas;
        const b = this.baseOf(this.layers.indexOf(l));
        return b >= 0 ? Paint.masked(src, this.shownOf(this.layers[b])) : src;
    },

    // A layer onto g (layer-sized, at dx, dy) as it shows: drawn, or for an
    // adjustment layer, what's on g so far adjusted
    drawShown(g, l, dx = 0, dy = 0) {
        if (l.adj) {
            const T = g.getTransform().translate(dx, dy);
            Paint.adjustCanvas(g.canvas, l.adj, l.mask ? (t) => { t.setTransform(T); t.drawImage(l.mask, 0, 0); } : null, l.opacity, Math.hypot(T.a, T.b));
            return;
        }
        g.globalAlpha = l.opacity;
        g.globalCompositeOperation = l.blend;
        g.drawImage(this.shownOf(l), dx, dy);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
    },

    // ---- Adjustment layers ----
    // ⋯ → Layer → New adjustment layer: a layer that changes what's under
    // it (l.adj), painted on through its mask (black hides it there);
    // double-click it for its settings

    addAdjLayer(kind) {
        if (!this.ready || !Paint.ADJ[kind]) return;
        if (this.layers.length >= Paint.MAX_LAYERS) { this.app.showToast(`Up to ${Paint.MAX_LAYERS} layers`); return; }
        if (this.float) this.commitFloat();
        if (this.text) this.endText(true);
        this.pushState(`New ${Paint.ADJ[kind][0]}`);
        const l = this.makeLayer(Paint.ADJ[kind][0]);
        l.adj = { kind, ...Paint.ADJ[kind][1] };
        l.mask = this.newCanvas();
        l.mask.getContext('2d').fillRect(0, 0, this.W, this.H);
        Object.assign(l, { maskRev: null, maskChanged: true, group: (this.layer() && this.layer().group) || null });
        this.layers.splice(this.cur + 1, 0, l);
        this.cur++;
        this.onMask = true;
        this.afterState();
        if (Object.keys(Paint.ADJ[kind][1]).length) this.openAdj(this.cur);
    },

    adjItems(filters = false) {
        return Object.entries(Paint.ADJ).filter(([, v]) => !!v[2] === filters).map(([k, [name]]) => [name + (Object.keys(Paint.ADJ[k][1]).length ? '…' : ''), () => this.addAdjLayer(k)]);
    },

    // Its settings, in a card by the layers, live; one step of Undo
    openAdj(i = this.cur) {
        const l = this.layers[i];
        if (!l || !l.adj) return;
        this.closeAdj(true);
        const card = document.createElement('div');
        card.className = 'paint-adj-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', l.name);
        const title = document.createElement('div');
        title.className = 'paint-adj-title';
        title.textContent = l.name;
        card.appendChild(title);
        const before = { ...l.adj };
        this.pushState(l.name);
        const set = (k, v) => { l.adj = { ...l.adj, [k]: v }; l.changed = true; this.renderSoon(); };
        const rows = [];
        const add = (label, k, min, max, step, log = false) => {
            const r = this.slider(label, min, max, step, () => l.adj[k], (v) => set(k, v), null, log);
            rows.push(r);
            card.appendChild(r);
        };
        const a = l.adj;
        if (a.kind === 'bc') { add('Brightness', 'b', -100, 100, 1); add('Contrast', 'c', -100, 100, 1); }
        if (a.kind === 'hsl') { add('Hue', 'h', -180, 180, 1); add('Saturation', 's', -100, 100, 1); add('Lightness', 'l', -100, 100, 1); }
        if (a.kind === 'levels') { add('Black', 'lo', 0, 253, 1); add('White', 'hi', 2, 255, 1); add('Midtones', 'g', 0.1, 10, 0.01); }
        if (a.kind === 'gauss' || a.kind === 'highpass') add('Radius', 'r', 0.5, 100, 0.5, true);
        if (a.kind === 'motion') { add('Angle', 'a', -180, 180, 1); add('Distance', 'd', 1, 200, 1, true); }
        if (a.kind === 'unsharp') { add('Amount', 'amt', 1, 500, 1); add('Radius', 'r', 0.5, 50, 0.5, true); add('Threshold', 'th', 0, 255, 1); }
        if (a.kind === 'noise') add('Amount', 'amt', 0, 100, 1);
        if (a.kind === 'median') add('Radius', 'r', 1, 20, 1);
        const foot = document.createElement('div');
        foot.className = 'paint-adj-foot';
        const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.addEventListener('click', () => { b.blur(); fn(); }); foot.appendChild(b); };
        btn('Reset', 'btn ghost sm', () => { l.adj = { kind: a.kind, ...Paint.ADJ[a.kind][1] }; rows.forEach(r => r._sync && r._sync()); this.renderSoon(); });
        btn('Done', 'btn primary sm paint-adj-done', () => this.closeAdj());
        card.appendChild(foot);
        card.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.closeAdj(); } });
        this.root.appendChild(card);
        const list = this.el('paint-layer-list');
        const r = list ? list.getBoundingClientRect() : null;
        if (r && r.width) {
            card.style.top = `${Math.max(8, r.top)}px`;
            card.style.left = `${Math.max(8, r.left - card.offsetWidth - 12)}px`;
        }
        this._adj = { card, layer: l, before };
    },

    // Done: kept as one step (nothing changed: none)
    closeAdj(quiet = false) {
        const o = this._adj;
        if (!o) return;
        this._adj = null;
        o.card.remove();
        if (JSON.stringify(o.layer.adj) === JSON.stringify(o.before)) { this._state = null; return; }
        this.afterState();
    },

    // ---- Clipping masks ----
    // A clipped layer shows only where the layer it's clipped to (the
    // nearest one below that isn't clipped itself) has paint, and not at
    // all when that one's hidden

    // The layer i is clipped to, or -1
    baseOf(i) {
        const l = this.layers[i];
        if (!l || !l.clip) return -1;
        let j = i - 1;
        while (j >= 0 && this.layers[j].clip) j--;
        return j;
    },

    isShown(l) {
        if (!l || l.hidden) return false;
        if (l.group && this.groups[l.group] && this.groups[l.group].hidden) return false;
        const b = this.baseOf(this.layers.indexOf(l));
        return b < 0 || !this.layers[b].hidden;
    },

    // Each frame, into one canvas kept for it
    clipNow(src, base) {
        let c = this._clipC;
        if (!c || c.width !== this.W || c.height !== this.H) c = this._clipC = this.newCanvas();
        const g = c.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(this.shownOf(base), 0, 0);
        g.globalCompositeOperation = 'source-over';
        return c;
    },

    toggleClip(i = this.cur) {
        const l = this.layers[i];
        if (!l || !this.ready) return;
        if (!l.clip && i === 0) { this.app.showToast('There\'s no layer below to clip it to', 1800); return; }
        if (l.adj) { this.app.showToast('An adjustment layer changes everything under it; it can\'t be clipped', 2000); return; }
        if (this.float) this.commitFloat();
        this.pushState(l.clip ? 'Unclip' : 'Clip to the layer below');
        l.clip = !l.clip;
        l.changed = true;
        this.afterState();
    },

    // ---- Lock the layer: nothing painted on it, moved or transformed ----

    toggleFixed(i = this.cur) {
        const l = this.layers[i];
        if (!l) return;
        if (this.float) this.commitFloat();
        this.pushState(l.fixed ? 'Unlock the layer' : 'Lock the layer');
        l.fixed = !l.fixed;
        this.afterState();
        this.app.showToast(l.fixed ? `${l.name}: locked` : `${l.name}: unlocked`, 1600);
    },

    fixedToast() {
        this.app.showToast('This layer is locked (right-click it to unlock it)', 2200);
    },

    // ---- Merge visible (Ctrl+Shift+E) and Flatten: the layers shown, as
    // they look together, into one (Flatten: the hidden ones gone too) ----

    mergeVisible(flatten = false) {
        if (!this.ready || this.busy) return;
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        const shown = this.layers.filter(l => this.isShown(l));
        if (!flatten && shown.length < 2) { this.app.showToast('Two or more layers need to be shown to merge them', 2000); return; }
        if (flatten && this.layers.length < 2 && !this.layers.some(l => l.mask || l.clip || l.text || l.shape)) return;
        const c = this.newCanvas(), g = c.getContext('2d');
        for (const l of shown) this.drawShown(g, l);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        this.pushState(flatten ? 'Flatten' : 'Merge visible');
        const top = shown.length ? this.layers.indexOf(shown[shown.length - 1]) : 0;
        const m = this.makeLayer(flatten ? 'Layer 1' : 'Merged');
        m.canvas = c;
        if (flatten) {
            this.layers = [m];
            this.groups = {};
            this.cur = 0;
        } else {
            const kept = this.layers.filter(l => !shown.includes(l));
            const at = this.layers.slice(0, top).filter(l => !shown.includes(l)).length;
            kept.splice(at, 0, m);
            this.layers = kept;
            this.cur = at;
        }
        this.onMask = false;
        this.afterState();
    },

    // The same, each frame, into one canvas kept for it
    maskedNow(src, mask) {
        let c = this._maskedC;
        if (!c || c.width !== this.W || c.height !== this.H) c = this._maskedC = this.newCanvas();
        const g = c.getContext('2d');
        g.globalCompositeOperation = 'copy';
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(mask, 0, 0);
        g.globalCompositeOperation = 'source-over';
        return c;
    },

    lum(hex) {
        const [r, g, b] = this.rgb(hex);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    },

    // how: 'all' (all of it shows), 'sel' (what's selected shows), 'none'
    addMask(how = 'all') {
        const l = this.layer();
        if (!l || l.mask || !this.ready) return;
        if (this.float) this.commitFloat();
        const m = this.newCanvas(), g = m.getContext('2d');
        if (how === 'sel' && this.sel) g.drawImage(this.sel.mask, 0, 0);
        else if (how !== 'none') g.fillRect(0, 0, this.W, this.H);
        this.pushState(how === 'sel' ? 'Mask from the selection' : 'Add a mask');
        Object.assign(l, { mask: m, maskRev: null, maskChanged: true });
        this.afterState();
        if (how === 'sel') this.deselect();
        this.editMask(true);
    },

    // Painting on the mask (true) or the layer; on the mask the colours are
    // black and white, as Photoshop has them
    editMask(on) {
        const l = this.layer();
        this.onMask = !!(on && l && l.mask);
        if (this.onMask) { this.fg = '#000000'; this.bg = '#ffffff'; this.syncColours(); }
        this.drawLayers();
        this.buildOptions();
    },

    deleteMask() {
        const l = this.layer();
        if (!l || !l.mask || l.adj) return;
        this.pushState('Delete the mask');
        l.mask = null;
        this.onMask = false;
        this.afterState();
        this.buildOptions();
    },

    // The mask put into the layer's pixels (what it hid is gone), then off
    applyMask() {
        const l = this.layer();
        if (!l || !l.mask || l.adj) return;
        if (this.float) this.commitFloat();
        this.beginPixels(l);
        const g = l.canvas.getContext('2d');
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(l.mask, 0, 0);
        g.globalCompositeOperation = 'source-over';
        this.endPixels(l, { x: 0, y: 0, w: this.W, h: this.H }, { free: true, name: 'Apply the mask' });
        this.deleteMask();
    },

    // Black and white swapped: what showed is hidden, and the other way
    invertMask() {
        const t = this.layer() && this.layer().mask ? this.maskTarget(this.layer()) : null;
        if (!t) return;
        this.beginPixels(t);
        const m = t.canvas, g = m.getContext('2d');
        const inv = this.newCanvas(), ig = inv.getContext('2d');
        ig.fillRect(0, 0, this.W, this.H);
        ig.globalCompositeOperation = 'destination-out';
        ig.drawImage(m, 0, 0);
        g.globalCompositeOperation = 'copy';
        g.drawImage(inv, 0, 0);
        g.globalCompositeOperation = 'source-over';
        inv.width = inv.height = 0;
        this.endPixels(t, { x: 0, y: 0, w: this.W, h: this.H }, { free: true, name: 'Invert the mask' });
        this.renderSoon();
    },

    maskItems() {
        const l = this.layer();
        if (!l) return [];
        if (!l.mask) return [
            ['Add a mask', () => this.addMask('all')],
            ...(this.sel ? [['Add a mask from the selection', () => this.addMask('sel')]] : []),
            ['Add a mask that hides it all', () => this.addMask('none')]
        ];
        return [
            [this.onMask ? 'Paint on the layer' : 'Paint on the mask', () => this.editMask(!this.onMask)],
            ['Invert the mask', () => this.invertMask()],
            ['Apply the mask', () => this.applyMask()],
            ['Delete the mask', () => this.deleteMask(), true]
        ];
    },

    addLayer() {
        if (!this.ready) return;
        if (this.layers.length >= Paint.MAX_LAYERS) { this.app.showToast(`Up to ${Paint.MAX_LAYERS} layers`); return; }
        if (this.float) this.commitFloat();
        this.pushState('New layer');
        const n = this.layers.length + 1, made = this.makeLayer(`Layer ${n}`);
        made.group = (this.layer() && this.layer().group) || null;
        this.layers.splice(this.cur + 1, 0, made);
        this.cur++;
        this.afterState();
    },

    duplicateLayer() {
        const l = this.layer();
        if (!l || this.layers.length >= Paint.MAX_LAYERS) return;
        if (this.float) this.commitFloat();
        this.pushState('Duplicate layer');
        const copy = this.makeLayer(`${l.name} copy`);
        Object.assign(copy, { opacity: l.opacity, blend: l.blend, hidden: l.hidden, lock: l.lock, text: l.text || null, shape: l.shape || null, src: l.src || null, clip: !!l.clip, group: l.group || null, adj: l.adj || null });
        if (l.mask) {
            copy.mask = this.newCanvas();
            copy.mask.getContext('2d').drawImage(l.mask, 0, 0);
            copy.maskChanged = true;
        }
        copy.canvas.getContext('2d').drawImage(l.canvas, 0, 0);
        this.layers.splice(this.cur + 1, 0, copy);
        this.cur++;
        this.afterState();
    },

    deleteLayer() {
        if (this.layers.length <= 1) return;
        if (this.float) this.commitFloat();
        this.pushState('Delete layer');
        this.layers.splice(this.cur, 1);
        this.cur = Math.max(0, this.cur - 1);
        this.afterState();
    },

    moveLayer(dir) {
        const j = this.cur + dir, l = this.layer();
        if (!l) return;
        if (this.float) this.commitFloat();
        const nb = this.layers[j];
        // At a group's edge: out of it, or into the one next to it, before
        // going past
        if (l.group && (!nb || nb.group !== l.group)) {
            this.pushState('Out of the group');
            l.group = null;
            this.afterState();
            return;
        }
        if (!nb) return;
        if (!l.group && nb.group) {
            this.pushState('Into the group');
            l.group = nb.group;
            this.afterState();
            return;
        }
        this.pushState('Move layer');
        [this.layers[this.cur], this.layers[j]] = [this.layers[j], this.layers[this.cur]];
        this.cur = j;
        this.afterState();
    },

    // ---- Groups ----
    // One level: a group is the run of layers (next to each other) with
    // its id (l.group); this.groups has each one's name, whether it's
    // hidden and whether it's open in the list

    // Ctrl+G: the layer into a group of its own
    groupLayer(i = this.cur) {
        const l = this.layers[i];
        if (!l || !this.ready) return;
        if (l.group) { this.app.showToast('That layer\'s in a group already', 1600); return; }
        if (this.float) this.commitFloat();
        this.pushState('Group');
        const id = Paint.newId().slice(-8), n = Object.keys(this.groups).length + 1;
        this.groups[id] = { name: `Group ${n}`, hidden: false, open: true };
        l.group = id;
        this.afterState();
    },

    // Into a group with the layer below it (its group, or a new one)
    groupWithBelow(i = this.cur) {
        const l = this.layers[i], b = this.layers[i - 1];
        if (!l || !b) return;
        if (this.float) this.commitFloat();
        this.pushState('Group');
        if (!b.group) {
            const id = Paint.newId().slice(-8), n = Object.keys(this.groups).length + 1;
            this.groups[id] = { name: `Group ${n}`, hidden: false, open: true };
            b.group = id;
        }
        l.group = b.group;
        this.afterState();
    },

    // Ctrl+Shift+G: out of its group, put just above it
    ungroupLayer(i = this.cur) {
        const l = this.layers[i];
        if (!l || !l.group) return;
        if (this.float) this.commitFloat();
        this.pushState('Out of the group');
        const g = l.group;
        let top = i;
        while (top + 1 < this.layers.length && this.layers[top + 1].group === g) top++;
        l.group = null;
        this.layers.splice(i, 1);
        this.layers.splice(top, 0, l);
        this.cur = top;
        this.afterState();
    },

    groupMembers(g) {
        return this.layers.map((l, i) => l.group === g ? i : -1).filter(i => i >= 0);
    },

    ungroup(g) {
        if (!this.groups[g]) return;
        this.pushState('Ungroup');
        for (const l of this.layers) if (l.group === g) {
            // (hidden with the group: hidden on its own now)
            if (this.groups[g].hidden) l.hidden = true;
            l.group = null;
        }
        delete this.groups[g];
        this.afterState();
    },

    toggleGroupShown(g) {
        if (!this.groups[g]) return;
        this.pushState(this.groups[g].hidden ? 'Show group' : 'Hide group');
        this.groups[g].hidden = !this.groups[g].hidden;
        for (const l of this.layers) if (l.group === g) l.changed = true;
        this.afterState();
    },

    toggleGroupOpen(g) {
        if (!this.groups[g]) return;
        this.groups[g].open = !this.groups[g].open;
        const m = this.groupMembers(g);
        if (!this.groups[g].open && m.includes(this.cur)) this.cur = m[m.length - 1];
        this.drawLayers();
    },

    async renameGroup(g) {
        if (!this.groups[g]) return;
        const name = await UI.prompt({ title: 'Rename the group', input: { label: 'Name', value: this.groups[g].name }, ok: 'Rename' });
        if (name === null || !name.trim()) return;
        this.pushState('Rename group');
        this.groups[g].name = name.trim().slice(0, 60);
        this.afterState();
    },

    // Its layers shown, as they look together, into one in its place
    mergeGroup(g) {
        const m = this.groupMembers(g);
        if (!m.length) return;
        if (this.float) this.commitFloat();
        if (m.some(i => this.layers[i].fixed)) { this.fixedToast(); return; }
        const c = this.newCanvas(), gc = c.getContext('2d');
        for (const i of m) {
            const l = this.layers[i];
            if (!this.isShown(l)) continue;
            this.drawShown(gc, l);
        }
        gc.globalAlpha = 1;
        gc.globalCompositeOperation = 'source-over';
        this.pushState('Merge group');
        const merged = this.makeLayer(this.groups[g].name);
        merged.canvas = c;
        if (this.groups[g].hidden) merged.hidden = true;
        this.layers.splice(m[0], m.length, merged);
        delete this.groups[g];
        this.cur = m[0];
        this.afterState();
    },

    deleteGroup(g) {
        const m = this.groupMembers(g);
        if (!m.length || m.length >= this.layers.length) { this.app.showToast('A group can\'t be every layer there is to delete it; ungroup it instead', 2400); return; }
        if (this.float) this.commitFloat();
        this.pushState('Delete group');
        this.layers.splice(m[0], m.length);
        delete this.groups[g];
        this.cur = Math.max(0, Math.min(m[0] - 1, this.layers.length - 1));
        this.afterState();
    },

    groupItems(g) {
        const gr = this.groups[g];
        return [
            [gr.hidden ? 'Show the group' : 'Hide the group', () => this.toggleGroupShown(g)],
            ['Rename group…', () => this.renameGroup(g)],
            ['Merge group', () => this.mergeGroup(g)],
            ['Ungroup', () => this.ungroup(g)],
            ['—'],
            ['Delete group and its layers', () => this.deleteGroup(g), true]
        ];
    },

    // Alt+[ and Alt+]: the layer below or above
    stepLayer(dir) {
        const j = this.cur + dir;
        if (!this.ready || j < 0 || j >= this.layers.length) return;
        if (this.float) this.commitFloat();
        this.cur = j;
        this.drawLayers();
    },

    // The arrow keys (Shift: 10 px): what's being moved; with Move, the
    // layer, or what's selected on it; with a selecting tool, the selection
    // outline. False: nothing to move
    nudge(dx, dy) {
        if (!this.ready || this.drag || this.crop) return false;
        if (this.float) {
            const f = this.float;
            for (const q of f.mesh || f.quad || []) { q.x += dx; q.y += dy; }
            f.t.tx += dx;
            f.t.ty += dy;
            this.renderSoon();
            return true;
        }
        // The picture as shown is the layers turned or flipped a quarter at a
        // time: the step, in layer space
        const Ci = this.Ci, vx = Math.round(Ci.a * dx + Ci.c * dy), vy = Math.round(Ci.b * dx + Ci.d * dy);
        const selecting = ['rect-select', 'ellipse-select', 'lasso', 'wand'].includes(this.tool);
        if (selecting && this.sel) {
            const m = this.newCanvas();
            m.getContext('2d').drawImage(this.sel.mask, vx, vy);
            this.sel.mask.width = this.sel.mask.height = 0;
            this.sel.mask = m;
            this.selectionChanged();
            return true;
        }
        if (this.tool !== 'move') return false;
        const l = this.layer();
        if (!l) return false;
        // Nudges one after another are one step to undo
        const last = this.history[this.history.length - 1];
        const going = this._nudged && this._nudged.entry === last && last && last.layer === l && performance.now() - this._nudged.at < 1500;
        if (going) {
            this.history.pop();
            this.historyBytes -= last.bytes || 0;
            this.before.getContext('2d').putImageData(last.before, 0, 0);
            this._beforeOf = l;
        } else {
            this.beginPixels(l);
        }
        const g = l.canvas.getContext('2d');
        const part = this.newCanvas();
        const pg = part.getContext('2d');
        pg.drawImage(l.canvas, 0, 0);
        if (this.sel) {
            pg.globalCompositeOperation = 'destination-in';
            pg.drawImage(this.sel.mask, 0, 0);
            g.globalCompositeOperation = 'destination-out';
            g.drawImage(this.sel.mask, 0, 0);
        } else {
            g.clearRect(0, 0, this.W, this.H);
        }
        g.globalCompositeOperation = 'source-over';
        g.drawImage(part, vx, vy);
        part.width = part.height = 0;
        // The selection goes with it
        if (this.sel) {
            const m = this.newCanvas();
            m.getContext('2d').drawImage(this.sel.mask, vx, vy);
            this.sel.mask.width = this.sel.mask.height = 0;
            this.sel.mask = m;
            this.selectionChanged();
        }
        this.endPixels(l, { x: 0, y: 0, w: this.W, h: this.H }, { free: true, name: 'Nudge' });
        this._nudged = { entry: this.history[this.history.length - 1], at: performance.now() };
        this.renderSoon();
        return true;
    },

    mergeDown() {
        if (this.cur <= 0) return;
        if (this.float) this.commitFloat();
        const top = this.layer(), below = this.layers[this.cur - 1];
        if (below.fixed || top.fixed) { this.fixedToast(); return; }
        if (below.adj) { this.app.showToast('Nothing can be merged onto an adjustment layer', 2000); return; }
        this.pushState('Merge down');
        below.text = below.shape = below.src = null;
        this.beginPixels(below);
        const g = below.canvas.getContext('2d');
        if (!top.hidden) {
            g.save();
            this.drawShown(g, top);
            g.restore();
        }
        const before = this.before.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H);
        const after = g.getImageData(0, 0, this.W, this.H);
        below.changed = true;
        this.layers.splice(this.cur, 1);
        this.cur--;
        this.afterState({ kind: 'px', layer: below, r: { x: 0, y: 0, w: this.W, h: this.H }, before, after, bytes: this.W * this.H * 8 });
    },

    // A text layer as pixels: painted on like any other, no longer text
    rasterize(i) {
        const l = this.layers[i];
        if (!l || !(l.text || l.shape || l.src)) return;
        this.pushState('Make it pixels');
        l.text = l.shape = l.src = null;
        this.afterState();
    },

    async renameLayer(i) {
        const l = this.layers[i];
        if (!l) return;
        const name = await UI.prompt({ title: 'Rename the layer', input: { label: 'Name', value: l.name }, ok: 'Rename' });
        if (name === null || !name.trim()) return;
        this.pushState('Rename layer');
        l.name = name.trim().slice(0, 60);
        this.afterState();
    },

    // Is there anything on a layer?
    // Where a canvas has anything on it, in its own px, or null: nothing
    contentBox(c) {
        const w = c.width, h = c.height, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
            const row = y * w * 4;
            let first = -1;
            for (let x = 0; x < w; x++) if (d[row + x * 4 + 3]) { first = x; break; }
            if (first < 0) continue;
            let last = first;
            for (let x = w - 1; x > first; x--) if (d[row + x * 4 + 3]) { last = x; break; }
            if (first < x0) x0 = first;
            if (last > x1) x1 = last;
            if (y < y0) y0 = y;
            y1 = y;
        }
        return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },

    empty(l) {
        const d = l.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, this.W, this.H).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
        return true;
    },

    // ---- The canvas: Crop (C) and Image ▸ Canvas size ----
    //
    // The canvas is the picture as shown with a margin round it (pad: in
    // layer px, less than 0 cropping in; paint.js). The layers reach as far
    // past the photo as the canvas does (ext, on the photo as on disk), so
    // what's painted out there is kept and Export writes it.

    // The layers' reach past the photo that a canvas padded so needs
    extFor(pad) {
        const p = pad || Paint.ZERO, Ci = this.Cc.inverse();
        const pts = [[-p.l, -p.t], [this.PO.w + p.r, -p.t], [-p.l, this.PO.h + p.b], [this.PO.w + p.r, this.PO.h + p.b]].map(([x, y]) => Ci.transformPoint({ x, y }));
        const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
        const out = (v) => Math.max(0, Math.ceil(v - 1e-6));
        return { l: out(-Math.min(...xs)), t: out(-Math.min(...ys)), r: out(Math.max(...xs) - this.PW), b: out(Math.max(...ys) - this.PH) };
    },

    // The biggest a canvas may be (in layer px): its sides up to three
    // times the photo's, and no more pixels than that many layers can hold
    canvasFits(pad) {
        const e = this.extFor(pad), w = this.PW + e.l + e.r, h = this.PH + e.t + e.b;
        const ow = this.PO.w + (pad ? pad.l + pad.r : 0), oh = this.PO.h + (pad ? pad.t + pad.b : 0);
        return ow >= 1 && oh >= 1 && w <= 16384 && h <= 16384 && w * h <= Math.max(36e6, 4 * this.PW * this.PH) && Math.max(w, h) <= 3 * Math.max(this.PW, this.PH);
    },

    canvasState() {
        return { ext: { ...this.ext }, pad: this.pad && { ...this.pad }, fill: this.fill, canvases: new Map(this.layers.flatMap(l => [[l.id, l.canvas], ...(l.mask ? [[l.id + 'm', l.mask]] : [])])) };
    },

    // The canvas padded so (null: the photo's own), one step of Undo; what's
    // added is the background colour
    setCanvas(pad, name = 'Canvas size') {
        if (!this.ready) return false;
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        pad = pad && (pad.l || pad.t || pad.r || pad.b) ? { l: pad.l | 0, t: pad.t | 0, r: pad.r | 0, b: pad.b | 0 } : null;
        const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
        if (same(pad, this.pad)) return false;
        if (!this.canvasFits(pad)) { this.app.showToast('That canvas is too big: up to three times the photo\'s size', 2400); return false; }
        const before = this.canvasState();
        // (the layers keep what's past the canvas)
        const want = this.extFor(pad), ext = { l: Math.max(want.l, this.ext.l), t: Math.max(want.t, this.ext.t), r: Math.max(want.r, this.ext.r), b: Math.max(want.b, this.ext.b) };
        const W = this.PW + ext.l + ext.r, H = this.PH + ext.t + ext.b;
        const dx = ext.l - this.ext.l, dy = ext.t - this.ext.t;
        const canvases = new Map();
        for (const l of this.layers) {
            const c = this.newCanvas(W, H);
            c.getContext('2d').drawImage(l.canvas, dx, dy);
            canvases.set(l.id, c);
            // A mask: what's added shows
            if (l.mask) {
                const m = this.newCanvas(W, H), mg = m.getContext('2d');
                mg.fillRect(0, 0, W, H);
                mg.clearRect(dx, dy, l.mask.width, l.mask.height);
                mg.drawImage(l.mask, dx, dy);
                canvases.set(l.id + 'm', m);
            }
        }
        const fill = pad ? (this.fill || this.bg) : null;
        const after = { ext, pad, fill, canvases };
        this.applyCanvas(after);
        this.record({ kind: 'canvas', name, before, after, bytes: W * H * 4 * this.layers.length });
        return true;
    },

    // A canvas state put on (setCanvas, Undo and Redo): the layers' pictures
    // swapped for that state's, the photo and the view made again
    applyCanvas(s) {
        this.healSrc = this.healOff = null; // (layer px move)
        this.dropSelection();
        if (this.float) this.commitFloat();
        this.ext = { ...s.ext };
        this.pad = s.pad ? { ...s.pad } : null;
        this.fill = s.fill || null;
        this.W = this.PW + this.ext.l + this.ext.r;
        this.H = this.PH + this.ext.t + this.ext.b;
        for (const l of this.layers) {
            const c = s.canvases.get(l.id);
            l.src = null;
            if (c) l.canvas = c;
            else if (l.canvas.width !== this.W || l.canvas.height !== this.H) l.canvas = this.newCanvas();
            l.changed = true;
            if (l.mask) {
                const m = s.canvases.get(l.id + 'm');
                if (m) l.mask = m;
                else if (l.mask.width !== this.W || l.mask.height !== this.H) { l.mask = this.newCanvas(); l.mask.getContext('2d').fillRect(0, 0, this.W, this.H); }
                l.maskChanged = true;
            }
        }
        for (const k of ['stroke', 'before']) { this[k].width = this[k].height = 0; this[k] = this.newCanvas(); }
        if (this._scratch) this._scratch.width = this._scratch.height = 0;
        this._scratch = null;
        this.lastDab = null;
        this.extendPhoto();
        this.setView(this.edit);
        if (!s.keepView) this.fit();
        this.drawLayers();
        this.buildOptions();
        this.renderSoon();
    },

    // Image ▸ Canvas size…: the new size in the picture's own pixels (as
    // Export writes it), what's added shared round all four sides
    async canvasSize() {
        if (!this.ready) return;
        const k = this.fullW / this.PW;
        const v = await UI.prompt({
            title: 'Canvas size',
            message: 'The picture stays in the middle; what\'s added is the background colour, and can be painted on. Crop (C) adds on one side only.',
            input: { label: 'Width × height, in pixels', value: `${Math.round(this.OW * k)} × ${Math.round(this.OH * k)}` },
            ok: 'Set'
        });
        if (v === null || !this.ready) return;
        const m = /^\s*(\d+)\s*[x×*,]?\s*(\d+)\s*(px)?\s*$/i.exec(v);
        if (!m || +m[1] < 1 || +m[2] < 1) { this.app.showToast('Two numbers, like 2000 × 1500', 2000); return; }
        const dw = Math.round(+m[1] / k) - this.OW, dh = Math.round(+m[2] / k) - this.OH;
        const p = this.pad || Paint.ZERO, hw = Math.floor(dw / 2), hh = Math.floor(dh / 2);
        this.setCanvas({ l: p.l + hw, r: p.r + dw - hw, t: p.t + hh, b: p.b + dh - hh }, 'Canvas size');
    },

    // Crop (C): a frame on the canvas, as shown. Its edges and corners drag
    // in to crop, or out past the picture to add to it; dragging inside it
    // moves it, and outside draws a new one. Enter crops, Esc doesn't
    startCrop() {
        if (!this.ready) return;
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        this.dropSelection();
        this.crop = { x0: 0, y0: 0, x1: this.OW, y1: this.OH };
        // Room round it to drag out into
        this.fit();
        this.zoomTo(this.view.z * 0.7);
        this.buildOptions();
        this.cursor();
        this.renderSoon();
    },

    endCrop(apply) {
        const c = this.crop;
        if (!c) return false;
        this.crop = null;
        this._cropCursor = null;
        if (this.drag && this.drag.kind === 'crop') this.drag = null;
        let done = false;
        if (apply) {
            const r = this.cropRect(c), p = this.pad || Paint.ZERO;
            done = this.setCanvas({ l: p.l - r.x0, t: p.t - r.y0, r: r.x1 - p.l - this.PO.w, b: r.y1 - p.t - this.PO.h }, 'Crop');
        }
        if (!done) { this.fit(); this.buildOptions(); }
        this.cursor();
        this.renderSoon();
        return true;
    },

    // The frame in whole pixels, ends in order
    cropRect(c) {
        const x0 = Math.round(Math.min(c.x0, c.x1)), x1 = Math.round(Math.max(c.x0, c.x1));
        const y0 = Math.round(Math.min(c.y0, c.y1)), y1 = Math.round(Math.max(c.y0, c.y1));
        return { x0, y0, x1: Math.max(x0 + 1, x1), y1: Math.max(y0 + 1, y1) };
    },

    cropOptions(box) {
        const hint = document.createElement('span');
        hint.className = 'paint-opt paint-hint';
        hint.textContent = 'Drag the edges in to crop, or out past the picture for more canvas. Enter crops, Esc doesn\'t';
        hint.title = hint.textContent;
        hint.style.color = 'var(--text-3, var(--text-2))';
        box.appendChild(hint);
        const r = this.crop ? this.cropRect(this.crop) : null, k = this.fullW / this.PW;
        if (r) {
            const size = document.createElement('span');
            size.className = 'paint-opt paint-num';
            size.id = 'paint-crop-size';
            size.textContent = `${Math.round((r.x1 - r.x0) * k)} × ${Math.round((r.y1 - r.y0) * k)}`;
            box.appendChild(size);
        }
        for (const [label, yes, cls] of [['Cancel', false, 'btn secondary'], ['Crop', true, 'btn primary']]) {
            const b = document.createElement('button');
            b.className = cls + ' paint-crop-' + (yes ? 'ok' : 'cancel');
            b.textContent = label;
            b.addEventListener('click', () => { b.blur(); this.endCrop(yes); });
            box.appendChild(b);
        }
    },

    // What a point on the screen (css px) is over: an edge or corner of the
    // frame ('l', 'tr', …), inside it ('in') or outside
    cropHit(p) {
        const c = this.cropRect(this.crop), V = this.V();
        const a = V.transformPoint({ x: c.x0, y: c.y0 }), b = V.transformPoint({ x: c.x1, y: c.y1 });
        const near = 9, x = p.sx, y = p.sy;
        const inX = x > a.x - near && x < b.x + near, inY = y > a.y - near && y < b.y + near;
        let h = '';
        if (inX && Math.abs(y - a.y) < near) h += 't'; else if (inX && Math.abs(y - b.y) < near) h += 'b';
        if (inY && Math.abs(x - a.x) < near) h += 'l'; else if (inY && Math.abs(x - b.x) < near) h += 'r';
        if (h) return h;
        return x > a.x && x < b.x && y > a.y && y < b.y ? 'in' : 'out';
    },

    cropCursor(p) {
        const h = this.cropHit(p);
        const c = { t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize', tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', in: 'move', out: 'crosshair' }[h];
        if (c !== this._cropCursor) { this._cropCursor = c; this.cursor(); }
    },

    startCropDrag(p) {
        const h = this.cropHit(p);
        const r = this.cropRect(this.crop);
        if (h === 'out') this.crop = { x0: p.ox, y0: p.oy, x1: p.ox, y1: p.oy };
        this.drag = { kind: 'crop', h: h === 'out' ? 'br' : h, from: p, r: h === 'out' ? null : r };
    },

    dragCrop(p) {
        const d = this.drag, c = this.crop;
        if (!c) return;
        if (!d.r) { c.x1 = p.ox; c.y1 = p.oy; }
        else if (d.h === 'in') {
            const dx = p.ox - d.from.ox, dy = p.oy - d.from.oy;
            Object.assign(c, { x0: d.r.x0 + dx, x1: d.r.x1 + dx, y0: d.r.y0 + dy, y1: d.r.y1 + dy });
        } else {
            const min = 4 / this.view.z;
            if (d.h.includes('l')) c.x0 = Math.min(p.ox, d.r.x1 - min);
            if (d.h.includes('r')) c.x1 = Math.max(p.ox, d.r.x0 + min);
            if (d.h.includes('t')) c.y0 = Math.min(p.oy, d.r.y1 - min);
            if (d.h.includes('b')) c.y1 = Math.max(p.oy, d.r.y0 + min);
        }
        const size = this.el('paint-crop-size'), r = this.cropRect(c), k = this.fullW / this.PW;
        if (size) size.textContent = `${Math.round((r.x1 - r.x0) * k)} × ${Math.round((r.y1 - r.y0) * k)}`;
    },

    // The frame: outside it dimmed, what it adds past the canvas in the
    // background colour, its edges and corners
    drawCrop(ctx, VD) {
        const r = this.cropRect(this.crop), z = this.view.z;
        ctx.save();
        ctx.setTransform(VD);
        const w = r.x1 - r.x0, h = r.y1 - r.y0;
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x0, r.y0, w, h);
        ctx.clip();
        const added = new Path2D();
        added.rect(r.x0, r.y0, w, h);
        added.rect(0, 0, this.OW, this.OH);
        ctx.fillStyle = this.fill || this.bg;
        ctx.fill(added, 'evenodd');
        ctx.restore();
        const big = 1e5 / Math.max(z, 1e-3);
        const dim = new Path2D();
        dim.rect(-big, -big, 2 * big, 2 * big);
        dim.rect(r.x0, r.y0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fill(dim, 'evenodd');
        ctx.lineWidth = 1.5 / z;
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(r.x0, r.y0, w, h);
        // Thirds, faintly
        ctx.lineWidth = 1 / z;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        for (const t of [1 / 3, 2 / 3]) {
            ctx.moveTo(r.x0 + w * t, r.y0); ctx.lineTo(r.x0 + w * t, r.y1);
            ctx.moveTo(r.x0, r.y0 + h * t); ctx.lineTo(r.x1, r.y0 + h * t);
        }
        ctx.stroke();
        // The handles: the corners and the middle of each edge
        const s = 7 / z;
        for (const x of [r.x0, (r.x0 + r.x1) / 2, r.x1]) for (const y of [r.y0, (r.y0 + r.y1) / 2, r.y1]) {
            if (x === (r.x0 + r.x1) / 2 && y === (r.y0 + r.y1) / 2) continue;
            ctx.fillStyle = '#fff';
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
            ctx.lineWidth = 1 / z;
            ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.strokeRect(x - s / 2, y - s / 2, s, s);
        }
        ctx.restore();
    },

    // ---- Done ----

    // The paint record to keep (layers written to the project), or null:
    // nothing painted
    async keep() {
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        const paint = { id: this.paintId, w: this.PW, h: this.PH, layers: [], ext: this.ext, pad: this.pad, fill: this.fill };
        for (const l of this.layers) {
            if ((l.changed || !l.rev) && this.empty(l) && !l.adj) continue;
            const rec = { id: l.id, rev: l.rev, name: l.name, opacity: l.opacity, blend: l.blend, hidden: l.hidden, ...(l.lock ? { lock: true } : {}), ...(l.text ? { text: l.text } : {}), ...(l.shape ? { shape: l.shape } : {}), ...(l.clip ? { clip: true } : {}), ...(l.fixed ? { fixed: true } : {}), ...(l.group && this.groups[l.group] ? { group: l.group } : {}), ...(l.adj ? { adj: l.adj } : {}) };
            if (l.changed || !l.rev) {
                rec.rev = Paint.newId().slice(-10);
                await Paint.writeLayer(paint, rec, l.canvas);
            }
            if (l.mask) {
                rec.mask = l.maskRev;
                if (l.maskChanged || !l.maskRev) {
                    rec.mask = Paint.newId().slice(-10);
                    await Paint.writeLayer(paint, Paint.maskOf(rec), l.mask);
                }
            }
            if (l.src) {
                if (!l.src.rev) {
                    l.src.rev = Paint.newId().slice(-10);
                    await Paint.writeLayer(paint, Paint.srcOf({ id: l.id, src: l.src }), l.src.canvas);
                }
                rec.src = { rev: l.src.rev, h: l.src.h, w: l.src.canvas.width, h0: l.src.canvas.height };
            }
            paint.layers.push(rec);
        }
        const used = [...new Set(paint.layers.map(l => l.group).filter(Boolean))];
        if (used.length) paint.groups = used.map(id => ({ id, name: this.groups[id].name, hidden: !!this.groups[id].hidden, open: this.groups[id].open !== false }));
        return Paint.clean(paint);
    },

    // For writing into the photo (no project): the layers to put on
    layersNow() {
        if (this.text) this.endText(true);
        if (this.float) this.commitFloat();
        return { w: this.PW, h: this.PH, ext: this.ext, pad: Paint.padOf(this), fill: this.fill, layers: this.layers.filter(l => this.isShown(l) && l.opacity > 0).map(l => l.adj ? { adj: l.adj, src: l.mask || null, opacity: l.opacity } : ({ src: this.shownOf(l), opacity: l.opacity, blend: l.blend })) };
    }
};
