// Develop: Lightroom-style adjustments, non-destructive. An adjustment is
// a small set of settings kept with the photo's edit (edits.js, `adj`),
// never in the photo: it's applied whenever the photo is shown, and Export
// (or Save edits) writes the finished file.
//
// Every adjustment here works on each pixel's colour alone, so the whole
// look is two lookup tables, made in JavaScript from the settings:
//   1. per channel (256 entries each): white balance and exposure (in
//      linear light), then the Light sliders, levels and curves;
//   2. a 3D colour table (33³) for what mixes the channels: the colour
//      mixer (HSL), vibrance and saturation. Skipped when they're all 0.
// The GPU (WebGL2) applies them, so sliders stay live on a big photo;
// without WebGL2 the same tables are applied on the CPU, so there's one
// definition of every slider and the two always agree.
//
// Settings, as kept (anything left out is at its default):
//   exposure (EV, ±5), contrast, highlights, shadows, whites, blacks,
//   temp, tint, vibrance, saturation (±100);
//   levels: { rgb|r|g|b: [in black, gamma, in white, out black, out white] }
//   curve:  { rgb|r|g|b: [[x, y], …] } (0–1, from the left)
//   hsl:    { hue|sat|lum: [8 values, ±100] } (red … magenta, HUES)
//   grade:  { s|m|h: [hue 0–360, saturation 0–100, luminance ±100] }
//           (shadows, midtones, highlights), with gradeBlend, gradeBalance
//   mono:   [red, green, blue] weights: black and white, from linear light
//           (a film's own sensitivity to each colour)
//   vignette, vigMid, vigFeather, vigRound; grain, grainSize, grainColor;
//           halation (the red glow round highlights) (Effects:
//           they depend on where the pixel is, so they're a GPU stage of
//           their own after the tables, not part of them)
//   sharpen (0–150), sharpRadius (px), sharpMask; noise, colorNoise
//           (Detail: they look at the pixels round each one, so they're
//           done first, on the photo itself, on the CPU: see applyDetail)
//   masks:  [{ type: 'linear'|'radial'|'brush', invert, adj: {exposure,
//           contrast, … MASK_SLIDERS}, linear: [x0, y0, x1, y1], radial:
//           [cx, cy, rx, ry, angle, feather], brush: [{ size, feather,
//           flow, erase, pts: [x, y, …] }] }] (Masks: settings for part of
//           the photo. Places are on the photo as it is on disk, before any
//           crop or turn — x across 0–1, y down 0–1 — so a crop later
//           doesn't move them; sizes are in heights of the photo)
//   look:   a film look (LOOKS), with lookAmount (0–200%): applied over
//           everything else, inside the colour table

const Develop = {
    SLIDERS: {
        exposure: { min: -5, max: 5, step: 0.01 },
        contrast: { min: -100, max: 100, step: 1 },
        highlights: { min: -100, max: 100, step: 1 },
        shadows: { min: -100, max: 100, step: 1 },
        whites: { min: -100, max: 100, step: 1 },
        blacks: { min: -100, max: 100, step: 1 },
        temp: { min: -100, max: 100, step: 1 },
        tint: { min: -100, max: 100, step: 1 },
        vibrance: { min: -100, max: 100, step: 1 },
        saturation: { min: -100, max: 100, step: 1 },
        gradeBlend: { min: 0, max: 100, step: 1, def: 50 },
        gradeBalance: { min: -100, max: 100, step: 1 },
        vignette: { min: -100, max: 100, step: 1 },
        vigMid: { min: 0, max: 100, step: 1, def: 50 },
        vigFeather: { min: 0, max: 100, step: 1, def: 50 },
        vigRound: { min: -100, max: 100, step: 1 },
        grain: { min: 0, max: 100, step: 1 },
        grainSize: { min: 0, max: 100, step: 1, def: 25 },
        grainColor: { min: 0, max: 100, step: 1 },
        sharpen: { min: 0, max: 150, step: 1 },
        sharpRadius: { min: 0.5, max: 3, step: 0.1, def: 1 },
        sharpMask: { min: 0, max: 100, step: 1 },
        noise: { min: 0, max: 100, step: 1 },
        colorNoise: { min: 0, max: 100, step: 1 },
        halation: { min: 0, max: 100, step: 1 },
        lookAmount: { min: 0, max: 200, step: 1, def: 100 }
    },
    ZONES: [['s', 'Shadows'], ['m', 'Midtones'], ['h', 'Highlights']],

    // Film looks: each a real film stock (or a darkroom trick), made as
    // settings of its own and put over the photo's (Amount 100% is the
    // film as made; 0 none, 200 twice as strong). Grouped by process:
    //   C-41  colour negative, as scanned: soft contrast, a gentle
    //         shoulder in the highlights, lifted blacks, colour grain
    //   E-6   colour slide (reversal): deep blacks, high contrast and
    //         saturation, the finest grain
    //   ECN-2 motion-picture negative (Kodak Vision3): very low contrast,
    //         wide latitude; without its rem-jet backing (CineStill) the
    //         highlights get a red halo (halation)
    //   B&W   each film's own sensitivity to red, green and blue (`mono`,
    //         on linear light), its contrast and grain
    // Grain follows speed: fine at 50–100, coarse at 800–3200.
    PROCESSES: [['C-41', 'Negative', 'Colour negative film (C-41)'], ['E-6', 'Slide', 'Colour slide film (E-6)'], ['ECN-2', 'Cinema', 'Motion-picture film (ECN-2)'], ['B&W', 'B&W', 'Black-and-white film'], ['Creative', 'Creative', 'Darkroom and print looks']],
    LOOKS: [
        // ---- C-41 colour negative ----
        { id: 'portra160', process: 'C-41', name: 'Portra 160', maker: 'Kodak', note: 'Low contrast, natural skin, very fine grain; a touch cooler than 400',
            adj: { contrast: -16, saturation: -10, curve: { rgb: [[0, 0.035], [0.25, 0.265], [0.5, 0.505], [0.75, 0.75], [1, 0.975]] }, hsl: { hue: [3, 4, -6, -14, -4, 0, 0, 0], sat: [-6, -4, -12, -22, -12, -8, 0, -6], lum: [0, 4, 2, -4, 0, 0, 0, 0] }, grade: { h: [40, 6, 0] }, grain: 8, grainSize: 14, grainColor: 25 } },
        { id: 'portra400', process: 'C-41', name: 'Portra 400', maker: 'Kodak', note: 'Warm, glowing skin, olive greens, soft highlights, wide latitude',
            adj: { contrast: -10, temp: 4, curve: { rgb: [[0, 0.04], [0.25, 0.26], [0.75, 0.765], [1, 0.97]], r: [[0, 0], [0.5, 0.51], [1, 1]] }, hsl: { hue: [4, 6, -8, -20, -6, -6, 0, 0], sat: [-2, 0, -10, -24, -14, -10, 0, -4], lum: [0, 6, 4, -2, 0, -4, 0, 0] }, grade: { s: [195, 8, 0], h: [42, 10, 0] }, grain: 14, grainSize: 22, grainColor: 30 } },
        { id: 'portra800', process: 'C-41', name: 'Portra 800', maker: 'Kodak', note: 'Warmer and richer than 400, deeper colour, more grain',
            adj: { contrast: -4, temp: 7, saturation: 6, curve: { rgb: [[0, 0.05], [0.3, 0.31], [0.75, 0.77], [1, 0.97]] }, hsl: { hue: [5, 8, -6, -16, 0, -4, 0, 0], sat: [6, 6, -4, -14, -6, 0, 0, 0], lum: [0, 6, 2, 0, 0, -6, 0, 0] }, grade: { s: [200, 10, -2], h: [40, 14, 0] }, grain: 22, grainSize: 32, grainColor: 35 } },
        { id: 'ektar', process: 'C-41', name: 'Ektar 100', maker: 'Kodak', note: 'The most saturated negative: punchy reds, deep blues, cool, finest grain',
            adj: { contrast: 18, temp: -4, vibrance: 26, saturation: 10, curve: { rgb: [[0, 0.01], [0.25, 0.22], [0.75, 0.79], [1, 0.99]] }, hsl: { hue: [-2, -6, -6, 6, 4, -6, 0, 0], sat: [20, 14, 4, 10, 12, 22, 6, 6], lum: [-6, -2, 0, -6, 0, -12, 0, 0] }, grain: 6, grainSize: 10, grainColor: 20 } },
        { id: 'gold', process: 'C-41', name: 'Gold 200', maker: 'Kodak', note: 'Golden and warm, strong yellows, nostalgic grain',
            adj: { contrast: 6, temp: 14, tint: 4, saturation: 4, curve: { rgb: [[0, 0.04], [0.5, 0.52], [1, 0.97]], b: [[0, 0.02], [0.5, 0.47], [1, 0.95]] }, hsl: { hue: [2, 4, -6, -10, 0, 0, 0, 0], sat: [6, 10, 16, -6, -8, -6, 0, 0], lum: [0, 4, 6, 0, 0, -4, 0, 0] }, grade: { m: [40, 6, 0], h: [45, 16, 2] }, grain: 18, grainSize: 30, grainColor: 35 } },
        { id: 'ultramax', process: 'C-41', name: 'UltraMax 400', maker: 'Kodak', note: 'Warm, saturated, contrasty everyday film, grainier',
            adj: { contrast: 14, temp: 9, vibrance: 12, saturation: 8, curve: { rgb: [[0, 0.03], [0.25, 0.235], [0.75, 0.78], [1, 0.98]] }, hsl: { hue: [2, 4, -4, -8, 0, -4, 0, 0], sat: [12, 8, 10, 0, 0, 6, 0, 0], lum: [-4, 2, 4, 0, 0, -6, 0, 0] }, grade: { h: [38, 10, 0] }, grain: 22, grainSize: 34, grainColor: 40 } },
        { id: 'superia', process: 'C-41', name: 'Superia 400', maker: 'Fujifilm', note: 'Cool with a green bias, punchy greens, cyan skies, magenta reds',
            adj: { contrast: 10, temp: -6, tint: -6, saturation: 6, curve: { rgb: [[0, 0.03], [0.25, 0.24], [0.75, 0.77], [1, 0.98]], g: [[0, 0.02], [0.5, 0.515], [1, 1]] }, hsl: { hue: [-6, -4, 6, 10, 6, -6, 0, 4], sat: [6, 0, -4, 14, 10, 8, 0, 0], lum: [0, 0, 0, -4, 0, -6, 0, 0] }, grade: { s: [165, 14, -2], h: [55, 6, 0] }, grain: 22, grainSize: 32, grainColor: 40 } },
        { id: 'pro400h', process: 'C-41', name: 'Pro 400H', maker: 'Fujifilm', note: 'Pastel and airy: minty greens, a cyan cast, lifted shadows',
            adj: { exposure: 0.15, contrast: -22, tint: -4, saturation: -14, curve: { rgb: [[0, 0.07], [0.25, 0.29], [0.75, 0.78], [1, 0.97]] }, hsl: { hue: [0, 4, 10, 24, 6, -4, 0, 0], sat: [-8, -10, -20, -14, -6, -14, 0, 0], lum: [0, 6, 8, 6, 4, 4, 0, 0] }, grade: { s: [175, 14, 2], h: [60, 6, 0] }, grain: 14, grainSize: 24, grainColor: 30 } },
        { id: 'c200', process: 'C-41', name: 'C200', maker: 'Fujifilm', note: 'Cool and greenish, muted, plain everyday colour',
            adj: { contrast: 4, temp: -8, tint: -8, saturation: -8, curve: { rgb: [[0, 0.03], [1, 0.97]] }, hsl: { hue: [-4, 0, 8, 10, 0, -4, 0, 0], sat: [-4, -6, -8, 4, 0, 0, 0, 0] }, grade: { s: [160, 12, 0] }, grain: 18, grainSize: 28, grainColor: 35 } },
        // ---- E-6 colour slide ----
        { id: 'velvia50', process: 'E-6', name: 'Velvia 50', maker: 'Fujifilm', note: 'Intense colour, vivid greens and blues, high contrast, magenta shadows',
            adj: { contrast: 30, blacks: -14, tint: 6, vibrance: 24, saturation: 12, curve: { rgb: [[0, 0], [0.25, 0.19], [0.5, 0.49], [0.75, 0.8], [1, 1]] }, hsl: { hue: [-4, -4, -6, -10, -6, -8, 0, -6], sat: [16, 8, 14, 16, 20, 26, 10, 10], lum: [-6, 0, 0, -16, -6, -16, 0, 0] }, grade: { s: [290, 10, -4] }, grain: 4, grainSize: 8, grainColor: 15 } },
        { id: 'velvia100', process: 'E-6', name: 'Velvia 100', maker: 'Fujifilm', note: 'Like 50, a little cooler and gentler, magenta-blue skies',
            adj: { contrast: 26, blacks: -10, temp: -4, tint: 8, vibrance: 24, saturation: 14, curve: { rgb: [[0, 0], [0.25, 0.2], [0.75, 0.79], [1, 1]] }, hsl: { hue: [-6, -4, -4, -8, -4, -6, 0, -6], sat: [14, 6, 10, 12, 16, 22, 8, 10], lum: [-4, 0, 0, -12, -4, -12, 0, 0] }, grade: { s: [300, 10, -4] }, grain: 5, grainSize: 9, grainColor: 15 } },
        { id: 'provia', process: 'E-6', name: 'Provia 100F', maker: 'Fujifilm', note: 'Neutral and true, slide contrast, slightly cool',
            adj: { contrast: 16, blacks: -6, temp: -3, vibrance: 10, curve: { rgb: [[0, 0], [0.25, 0.22], [0.75, 0.78], [1, 1]] }, hsl: { sat: [4, 2, 4, 8, 6, 8, 0, 0], lum: [0, 0, 0, -4, 0, -6, 0, 0] }, grain: 5, grainSize: 9, grainColor: 15 } },
        { id: 'e100', process: 'E-6', name: 'Ektachrome E100', maker: 'Kodak', note: 'Clean and neutral-cool, crisp blues, fine grain',
            adj: { contrast: 14, blacks: -6, temp: -5, tint: 2, vibrance: 12, curve: { rgb: [[0, 0], [0.25, 0.22], [0.75, 0.78], [1, 1]] }, hsl: { hue: [0, -2, -4, 4, 4, -4, 0, 0], sat: [6, 2, 0, 6, 10, 14, 4, 0], lum: [0, 0, 0, -2, 0, -8, 0, 0] }, grade: { s: [215, 8, -2] }, grain: 5, grainSize: 9, grainColor: 15 } },
        { id: 'kodachrome', process: 'E-6', code: 'K-14', name: 'Kodachrome 64', maker: 'Kodak', note: 'K-14, not E-6 (gone since 2010): warm, rich reds, deep blues, dense shadows',
            adj: { contrast: 22, blacks: -8, temp: 6, saturation: 8, curve: { rgb: [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 0.99]] }, hsl: { hue: [-4, -6, -10, 12, 0, -8, 0, 0], sat: [18, 8, 2, -8, 0, 16, 0, 0], lum: [-8, 0, 0, -6, 0, -14, 0, 0] }, grade: { s: [200, 10, -4], h: [42, 12, 0] }, grain: 8, grainSize: 14, grainColor: 20 } },
        // ---- ECN-2 motion-picture negative ----
        { id: 'vision50d', process: 'ECN-2', name: 'Vision3 50D', maker: 'Kodak 5203', note: 'Daylight cinema film: very fine grain, neutral, low contrast, huge latitude',
            adj: { contrast: -16, saturation: -6, curve: { rgb: [[0, 0.04], [0.25, 0.27], [0.75, 0.76], [1, 0.96]] }, hsl: { sat: [-4, -2, -6, -12, -6, -6, 0, 0] }, grade: { s: [190, 6, 0], h: [40, 6, 0] }, grain: 6, grainSize: 10, grainColor: 20 } },
        { id: 'vision250d', process: 'ECN-2', name: 'Vision3 250D', maker: 'Kodak 5207', note: 'Daylight cinema film: a little warmer and grainier than 50D',
            adj: { contrast: -10, temp: 3, saturation: -2, curve: { rgb: [[0, 0.04], [0.25, 0.265], [0.75, 0.765], [1, 0.965]] }, hsl: { sat: [0, 0, -4, -10, -4, -4, 0, 0] }, grade: { s: [190, 8, 0], h: [38, 8, 0] }, grain: 12, grainSize: 20, grainColor: 30 } },
        { id: 'vision500t', process: 'ECN-2', name: 'Vision3 500T', maker: 'Kodak 5219', note: 'Tungsten cinema film: cool in daylight, teal shadows, warm skin, grain',
            adj: { contrast: -6, temp: -12, tint: -2, curve: { rgb: [[0, 0.05], [0.25, 0.27], [0.75, 0.77], [1, 0.96]] }, hsl: { hue: [4, 6, -8, -14, 0, -6, 0, 0], sat: [4, 6, -8, -16, -6, 0, 0, 0] }, grade: { s: [190, 18, -2], h: [35, 12, 0] }, grain: 22, grainSize: 32, grainColor: 40 } },
        { id: 'cinestill800t', process: 'ECN-2', name: 'CineStill 800T', maker: 'Vision3 500T, no rem-jet', note: 'Tungsten, cool and teal, with red halation glowing round the lights',
            adj: { contrast: -2, temp: -16, tint: -2, curve: { rgb: [[0, 0.05], [0.25, 0.27], [0.75, 0.775], [1, 0.97]] }, hsl: { hue: [6, 6, -8, -14, 0, -6, 0, 0], sat: [8, 6, -8, -16, -4, 4, 0, 0] }, grade: { s: [185, 20, -2], h: [30, 10, 0] }, halation: 60, grain: 26, grainSize: 36, grainColor: 45 } },
        { id: 'cinestill50d', process: 'ECN-2', name: 'CineStill 50D', maker: 'Vision3 50D, no rem-jet', note: 'Daylight, clean and cool-neutral, with a soft halation',
            adj: { contrast: -10, temp: -4, saturation: -2, curve: { rgb: [[0, 0.04], [0.25, 0.27], [0.75, 0.765], [1, 0.965]] }, hsl: { sat: [-2, 0, -6, -8, 0, 4, 0, 0] }, grade: { s: [200, 8, 0] }, halation: 32, grain: 8, grainSize: 12, grainColor: 25 } },
        // ---- Black and white ----
        { id: 'trix', process: 'B&W', name: 'Tri-X 400', maker: 'Kodak', note: 'The classic: punchy contrast, deep blacks, gritty grain',
            adj: { mono: [0.24, 0.6, 0.16], contrast: 22, blacks: -8, curve: { rgb: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]] }, grain: 32, grainSize: 40 } },
        { id: 'hp5', process: 'B&W', name: 'HP5 Plus', maker: 'Ilford', note: 'Softer and flatter than Tri-X, forgiving, visible grain',
            adj: { mono: [0.25, 0.58, 0.17], contrast: 6, curve: { rgb: [[0, 0.03], [0.25, 0.245], [0.75, 0.77], [1, 0.98]] }, grain: 30, grainSize: 42 } },
        { id: 'tmax100', process: 'B&W', name: 'T-Max 100', maker: 'Kodak', note: 'Smooth tones, fine grain, more red sensitivity (lighter skin)',
            adj: { mono: [0.3, 0.58, 0.12], contrast: 14, curve: { rgb: [[0, 0.01], [0.25, 0.23], [0.75, 0.78], [1, 1]] }, grain: 8, grainSize: 12 } },
        { id: 'tmax400', process: 'B&W', name: 'T-Max 400', maker: 'Kodak', note: 'Fine grain for its speed, crisp, smooth',
            adj: { mono: [0.29, 0.58, 0.13], contrast: 16, curve: { rgb: [[0, 0.01], [0.25, 0.225], [0.75, 0.785], [1, 1]] }, grain: 16, grainSize: 22 } },
        { id: 'fp4', process: 'B&W', name: 'FP4 Plus', maker: 'Ilford', note: 'Fine grain, classic medium contrast',
            adj: { mono: [0.25, 0.6, 0.15], contrast: 12, curve: { rgb: [[0, 0.02], [0.25, 0.235], [0.75, 0.775], [1, 0.99]] }, grain: 10, grainSize: 16 } },
        { id: 'panf', process: 'B&W', name: 'Pan F Plus 50', maker: 'Ilford', note: 'Very fine grain, high contrast, rich blacks',
            adj: { mono: [0.24, 0.6, 0.16], contrast: 28, blacks: -10, curve: { rgb: [[0, 0], [0.25, 0.2], [0.75, 0.81], [1, 1]] }, grain: 5, grainSize: 8 } },
        { id: 'acros', process: 'B&W', name: 'Acros 100 II', maker: 'Fujifilm', note: 'Orthopanchromatic: reds darker, blue skies lighter; very fine grain',
            adj: { mono: [0.16, 0.6, 0.24], contrast: 18, blacks: -6, curve: { rgb: [[0, 0], [0.25, 0.215], [0.75, 0.79], [1, 1]] }, grain: 6, grainSize: 10 } },
        { id: 'delta3200', process: 'B&W', name: 'Delta 3200', maker: 'Ilford', note: 'Low light: big grain, open shadows, soft contrast',
            adj: { mono: [0.26, 0.58, 0.16], contrast: 4, shadows: 10, curve: { rgb: [[0, 0.05], [0.25, 0.27], [0.75, 0.77], [1, 0.98]] }, grain: 52, grainSize: 62 } },
        { id: 'sfx', process: 'B&W', name: 'SFX 200', maker: 'Ilford', note: 'Extended red, as with a deep red filter: dark skies, glowing skin',
            adj: { mono: [0.55, 0.37, 0.08], contrast: 18, curve: { rgb: [[0, 0], [0.25, 0.215], [0.75, 0.79], [1, 1]] }, grain: 18, grainSize: 26 } },
        // ---- Creative ----
        { id: 'cross', process: 'Creative', name: 'Cross process', maker: 'E-6 in C-41', note: 'Slide film in negative chemistry: yellow-green highlights, blue shadows, hard contrast',
            adj: { contrast: 24, saturation: 14, curve: { r: [[0, 0], [0.25, 0.19], [0.75, 0.84], [1, 1]], g: [[0, 0.03], [0.5, 0.56], [1, 1]], b: [[0, 0.14], [0.5, 0.44], [1, 0.82]] }, grain: 10, grainSize: 16, grainColor: 25 } },
        { id: 'instant', process: 'Creative', name: 'Instant', maker: 'Integral film', note: 'Soft, warm, faded edges, cyan-green shadows',
            adj: { contrast: -8, temp: 12, tint: -6, saturation: -10, curve: { rgb: [[0, 0.08], [0.5, 0.52], [1, 0.94]] }, grade: { s: [160, 16, 0], h: [50, 16, 4] }, vignette: -22, vigMid: 40, grain: 10 } },
        { id: 'faded', process: 'Creative', name: 'Faded print', maker: 'An old colour print', note: 'Washed out, lifted blacks, blue shadows',
            adj: { contrast: -18, saturation: -22, curve: { rgb: [[0, 0.12], [0.3, 0.32], [0.75, 0.74], [1, 0.92]] }, grade: { s: [215, 14, 0], h: [50, 8, 0] } } },
        { id: 'teal', process: 'Creative', name: 'Teal and orange', maker: 'Film grade', note: 'Teal shadows, orange skin and highlights',
            adj: { contrast: 14, vibrance: 10, grade: { s: [190, 28, 0], m: [30, 6, 0], h: [35, 22, 0] }, hsl: { hue: [0, -4, -10, 30, 6, -8, 0, 0], sat: [0, 8, -10, -30, 0, 10, 0, 0] } } },
        { id: 'sepia', process: 'Creative', name: 'Sepia', maker: 'Toned print', note: 'Black and white, toned warm brown',
            adj: { mono: [0.2126, 0.7152, 0.0722], contrast: 10, grade: { s: [30, 26, 0], m: [38, 24, 0], h: [45, 14, 0] }, curve: { rgb: [[0, 0.05], [1, 0.96]] }, grain: 10 } },
        { id: 'selenium', process: 'Creative', name: 'Selenium', maker: 'Toned print', note: 'Black and white, cool purple-brown shadows, deep blacks',
            adj: { mono: [0.24, 0.6, 0.16], contrast: 18, blacks: -6, grade: { s: [300, 14, -2], m: [320, 6, 0] }, grain: 12, grainSize: 20 } }
    ],
    CHANNELS: ['rgb', 'r', 'g', 'b'],
    HUES: [
        { id: 'red', name: 'Red', at: 0, color: '#e5484d' },
        { id: 'orange', name: 'Orange', at: 30, color: '#f76b15' },
        { id: 'yellow', name: 'Yellow', at: 60, color: '#ffc53d' },
        { id: 'green', name: 'Green', at: 120, color: '#46a758' },
        { id: 'aqua', name: 'Aqua', at: 180, color: '#12a594' },
        { id: 'blue', name: 'Blue', at: 225, color: '#0090ff' },
        { id: 'purple', name: 'Purple', at: 270, color: '#8e4ec6' },
        { id: 'magenta', name: 'Magenta', at: 315, color: '#d6409f' }
    ],
    LEVELS: [0, 1, 1, 0, 1],
    LUT_SIZE: 33,

    // ---- Settings ----

    // Every setting, defaults filled in
    full(adj) {
        const a = adj || {};
        const out = {};
        for (const [k, r] of Object.entries(this.SLIDERS)) out[k] = typeof a[k] === 'number' ? a[k] : (r.def || 0);
        out.levels = {};
        out.curve = {};
        for (const c of this.CHANNELS) {
            out.levels[c] = (a.levels && a.levels[c]) ? a.levels[c].slice() : this.LEVELS.slice();
            out.curve[c] = (a.curve && a.curve[c]) ? a.curve[c].map(p => p.slice()) : [[0, 0], [1, 1]];
        }
        out.hsl = {};
        for (const k of ['hue', 'sat', 'lum']) out.hsl[k] = (a.hsl && a.hsl[k]) ? a.hsl[k].slice() : new Array(8).fill(0);
        out.grade = {};
        for (const [z] of this.ZONES) out.grade[z] = (a.grade && a.grade[z]) ? a.grade[z].slice() : [0, 0, 0];
        out.look = this.look(a.look) ? a.look : null;
        out.mono = this.monoOf(a.mono);
        out.masks = (this.cleanMasks(a.masks) || []).map(m => JSON.parse(JSON.stringify(m)));
        return out;
    },

    // Black-and-white weights, adding up to 1, or null
    monoOf(m) {
        if (!Array.isArray(m) || m.length !== 3 || !m.every(x => typeof x === 'number' && isFinite(x) && x >= 0)) return null;
        const sum = m[0] + m[1] + m[2];
        return sum > 0 ? m.map(x => +(x / sum).toFixed(4)) : null;
    },

    look(id) {
        return (typeof id === 'string' && this.LOOKS.find(l => l.id === id)) || null;
    },

    // Checked and made compact (only what's changed), or null for none.
    // Anything out of range is brought into it.
    clean(v) {
        if (!v || typeof v !== 'object') return null;
        const num = (x) => typeof x === 'number' && isFinite(x);
        const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
        const out = {};
        for (const [k, r] of Object.entries(this.SLIDERS)) {
            if (num(v[k]) && v[k] !== (r.def || 0)) {
                const x = Math.round(clamp(v[k], r.min, r.max) / r.step) * r.step;
                if (x !== (r.def || 0)) out[k] = +x.toFixed(2);
            }
        }
        for (const c of this.CHANNELS) {
            const l = v.levels && v.levels[c];
            if (Array.isArray(l) && l.length === 5 && l.every(num)) {
                let [i0, g, i1, o0, o1] = l;
                i0 = clamp(i0, 0, 0.99);
                i1 = clamp(i1, i0 + 0.01, 1);
                g = clamp(g, 0.1, 9.99);
                o0 = clamp(o0, 0, 1);
                o1 = clamp(o1, 0, 1);
                const q = [i0, g, i1, o0, o1].map(x => +x.toFixed(4));
                if (q.some((x, i) => Math.abs(x - this.LEVELS[i]) > 1e-4)) (out.levels || (out.levels = {}))[c] = q;
            }
            const p = v.curve && v.curve[c];
            if (Array.isArray(p) && p.length >= 2 && p.length <= 16 && p.every(pt => Array.isArray(pt) && pt.length === 2 && pt.every(num))) {
                const pts = p.map(([x, y]) => [+clamp(x, 0, 1).toFixed(4), +clamp(y, 0, 1).toFixed(4)]).sort((a, b) => a[0] - b[0]);
                const ok = pts.every((pt, i) => !i || pt[0] - pts[i - 1][0] >= 0.01);
                const straight = pts.every(([x, y]) => Math.abs(x - y) < 1e-4);
                if (ok && !straight) (out.curve || (out.curve = {}))[c] = pts;
            }
        }
        for (const k of ['hue', 'sat', 'lum']) {
            const h = v.hsl && v.hsl[k];
            if (Array.isArray(h) && h.length === 8 && h.every(num) && h.some(x => Math.round(x))) {
                (out.hsl || (out.hsl = {}))[k] = h.map(x => Math.round(clamp(x, -100, 100)));
            }
        }
        for (const [z] of this.ZONES) {
            const g = v.grade && v.grade[z];
            if (Array.isArray(g) && g.length === 3 && g.every(num)) {
                const q = [Math.round(((g[0] % 360) + 360) % 360), Math.round(clamp(g[1], 0, 100)), Math.round(clamp(g[2], -100, 100))];
                if (q[1] || q[2]) (out.grade || (out.grade = {}))[z] = q;
            }
        }
        const mono = this.monoOf(v.mono);
        if (mono) out.mono = mono;
        const masks = this.cleanMasks(v.masks);
        if (masks) out.masks = masks;
        if (this.look(v.look)) out.look = v.look;
        else delete out.lookAmount;
        return Object.keys(out).length ? out : null;
    },

    active(adj) {
        return !!this.clean(adj);
    },

    // ---- Masks: settings for part of the photo ----

    MAX_MASKS: 8,
    MASK_SLIDERS: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'vibrance', 'saturation'],
    MASK_LUT: 17,

    cleanMasks(list) {
        if (!Array.isArray(list)) return null;
        const num = (x) => typeof x === 'number' && isFinite(x);
        const r4 = (x) => +(+x).toFixed(4);
        const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
        const out = [];
        for (const m of list.slice(0, this.MAX_MASKS)) {
            if (!m || typeof m !== 'object') continue;
            const adj = {};
            if (m.adj && typeof m.adj === 'object') {
                for (const k of this.MASK_SLIDERS) {
                    const r = this.SLIDERS[k];
                    if (num(m.adj[k]) && m.adj[k]) {
                        const x = Math.round(clamp(m.adj[k], r.min, r.max) / r.step) * r.step;
                        if (x) adj[k] = +x.toFixed(2);
                    }
                }
            }
            const c = { type: m.type, invert: !!m.invert, adj };
            if (m.type === 'linear' && Array.isArray(m.linear) && m.linear.length === 4 && m.linear.every(num)) {
                c.linear = m.linear.map(r4);
                if (c.linear[0] === c.linear[2] && c.linear[1] === c.linear[3]) continue;
            } else if (m.type === 'radial' && Array.isArray(m.radial) && m.radial.length === 6 && m.radial.every(num)) {
                const [cx, cy, rx, ry, a, f] = m.radial;
                c.radial = [r4(cx), r4(cy), r4(clamp(rx, 0.002, 10)), r4(clamp(ry, 0.002, 10)), r4(a), r4(clamp(f, 0, 1))];
            } else if (m.type === 'brush' && Array.isArray(m.brush)) {
                let n = 0;
                c.brush = m.brush.filter(st => st && Array.isArray(st.pts) && st.pts.length >= 2 && st.pts.length % 2 === 0 && st.pts.every(num) && num(st.size))
                    .map(st => ({ size: r4(clamp(st.size, 0.002, 1)), feather: r4(clamp(num(st.feather) ? st.feather : 0.5, 0, 1)), flow: r4(clamp(num(st.flow) ? st.flow : 1, 0.05, 1)), erase: !!st.erase, pts: st.pts.map(r4) }))
                    .filter(st => (n += st.pts.length) <= 40000);
                if (!c.brush.length) continue;
            } else continue;
            out.push(c);
        }
        return out.length ? out : null;
    },

    // The map from where a pixel is in the picture shown (0–1 across and
    // down) to where it is on the photo as it is on disk: ed is a crop
    // editor on the W × H photo (CropEditor.fromSnapshot), or none
    cropMap(ed, W, H) {
        if (!ed) return { m: [1, 0, 0, 0, 1, 0], asp: W / H };
        const o = ed.outputRect();
        const [c, s] = ed.cs();
        return {
            m: [c * o.w / W, s * o.h / W, (c * o.x0 + s * o.y0) / W + 0.5,
                -s * o.w / H, c * o.h / H, (-s * o.x0 + c * o.y0) / H + 0.5],
            asp: W / H
        };
    },

    // Each mask's own tables and its shape: what the shader and the CPU need
    maskTables(masks) {
        if (!masks) return null;
        const list = [];
        let brushes = 0;
        for (const m of masks) {
            const a = this.full(m.adj);
            const e = { type: { linear: 1, radial: 2, brush: 3 }[m.type], inv: m.invert ? 1 : 0, A: [0, 0, 0, 0], B: [0, 0, 0, 0] };
            e.tone = this.channelTables(a);
            e.lut = this.colourLut(a, this.MASK_LUT);
            if (m.type === 'linear') e.A = m.linear;
            if (m.type === 'radial') { e.A = m.radial.slice(0, 4); e.B = [m.radial[4], m.radial[5], 0, 0]; }
            if (m.type === 'brush') { e.slot = brushes++; e.strokes = m.brush; }
            list.push(e);
        }
        return { list, brushes, key: JSON.stringify(masks) };
    },

    // The brush maps for these masks on a photo this shape (remembered)
    brushFor(M, asp) {
        if (!M || !M.brushes) return null;
        const key = M.key + '|' + asp.toFixed(4);
        if (this._brushKey !== key) {
            this._brushKey = key;
            this._brush = this.brushMaps(M.list, asp);
        }
        return this._brush;
    },

    // Brush masks painted onto two 4-channel maps (a channel each), on the
    // photo as it is on disk, its long side 512: made once per change
    BRUSH_EDGE: 512,
    brushMaps(list, asp) {
        const maps = [];
        const W = this.BRUSH_EDGE, H = this.BRUSH_EDGE;
        for (const e of list) {
            if (e.type !== 3) continue;
            const c = document.createElement('canvas');
            c.width = W; c.height = H;
            const g = c.getContext('2d', { willReadFrequently: true });
            for (const st of e.strokes) {
                const r = st.size / 2;
                g.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
                const dab = (x, y) => {
                    // Sizes are in heights of the photo; the map is square,
                    // so a round dab is narrower across by the photo's shape
                    const rp = r * H;
                    g.setTransform(1 / asp, 0, 0, 1, x * W, y * H);
                    const grad = g.createRadialGradient(0, 0, rp * (1 - st.feather) * 0.999, 0, 0, rp);
                    grad.addColorStop(0, `rgba(255,255,255,${st.flow})`);
                    grad.addColorStop(1, 'rgba(255,255,255,0)');
                    g.fillStyle = grad;
                    g.beginPath();
                    g.arc(0, 0, rp, 0, Math.PI * 2);
                    g.fill();
                };
                const pts = st.pts;
                dab(pts[0], pts[1]);
                for (let i = 2; i < pts.length; i += 2) {
                    const x0 = pts[i - 2], y0 = pts[i - 1], x1 = pts[i], y1 = pts[i + 1];
                    const len = Math.hypot((x1 - x0) * asp, y1 - y0), step = Math.max(1e-4, r * 0.25);
                    const n = Math.max(1, Math.ceil(len / step));
                    for (let k = 1; k <= n; k++) dab(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
                }
            }
            g.setTransform(1, 0, 0, 1, 0, 0);
            const px = g.getImageData(0, 0, W, H).data;
            const slot = e.slot, t = slot >> 2, ch = slot & 3;
            if (!maps[t]) maps[t] = { w: W, h: H, data: new Uint8Array(W * H * 4) };
            for (let i = 0; i < W * H; i++) maps[t].data[i * 4 + ch] = px[i * 4 + 3];
            c.width = c.height = 0;
        }
        return maps;
    },

    // One mask's strength at (u, v) on the photo (asp: its width / height)
    maskWeight(e, u, v, asp, brush) {
        let w = 0;
        const px = u * asp, py = v;
        if (e.type === 1) {
            const [x0, y0, x1, y1] = e.A;
            const dx = (x1 - x0) * asp, dy = y1 - y0;
            const t = ((px - x0 * asp) * dx + (py - y0) * dy) / (dx * dx + dy * dy);
            w = 1 - this.smooth(0, 1, t);
        } else if (e.type === 2) {
            const [cx, cy, rx, ry] = e.A, [ang, fe] = e.B;
            const qx = px - cx * asp, qy = py - cy;
            const c = Math.cos(ang), s = Math.sin(ang);
            const lx = (c * qx + s * qy) / rx, ly = (-s * qx + c * qy) / ry;
            const d = Math.sqrt(lx * lx + ly * ly);
            w = 1 - this.smooth(1 - Math.max(0.01, fe), 1, d);
        } else if (e.type === 3 && brush) {
            const m = brush[e.slot >> 2];
            w = m ? this.brushAt(m, e.slot & 3, u, v) : 0;
        }
        return e.inv ? 1 - w : w;
    },

    same(a, b) {
        return JSON.stringify(this.clean(a)) === JSON.stringify(this.clean(b));
    },

    // ---- The maths ----

    toLinear(x) { return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); },
    toGamma(x) { return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; },

    // A smooth curve through the points that never turns back on itself
    // (monotone cubic, Fritsch–Carlson): x → y, flat beyond the ends
    spline(points) {
        const p = points.slice().sort((a, b) => a[0] - b[0]);
        const n = p.length;
        if (n < 2) return () => (n ? p[0][1] : 0);
        const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
        const d = [], m = new Array(n);
        for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
        m[0] = d[0];
        m[n - 1] = d[n - 2];
        for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
        for (let i = 0; i < n - 1; i++) {
            if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
            const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                m[i] = t * a * d[i];
                m[i + 1] = t * b * d[i];
            }
        }
        return (x) => {
            if (x <= xs[0]) return ys[0];
            if (x >= xs[n - 1]) return ys[n - 1];
            let i = 0;
            while (i < n - 2 && x > xs[i + 1]) i++;
            const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
            return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] +
                (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
        };
    },

    // White balance as gains on linear light, a grey kept as bright
    whiteBalance(temp, tint) {
        const t = temp / 100, g = tint / 100;
        const k = [Math.exp(0.35 * t), Math.exp(-0.3 * g), Math.exp(-0.35 * t)];
        const y = 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
        return k.map(x => x / y);
    },

    // The Light sliders as one curve (gamma-encoded values): whites and
    // blacks move the ends, contrast bends it round the middle, highlights
    // and shadows lift or lower the bright and dark quarters
    toneCurve(a) {
        const c = a.contrast / 100, h = a.highlights / 100, s = a.shadows / 100;
        const lo = -0.25 * a.blacks / 100, hi = 1 - 0.25 * a.whites / 100;
        if (!c && !h && !s && !lo && hi === 1) return null;
        const f = this.spline([[0, 0], [0.25, 0.25 - 0.07 * c + 0.13 * s], [0.5, 0.5], [0.75, 0.75 + 0.07 * c + 0.13 * h], [1, 1]]);
        return (x) => f(Math.min(1, Math.max(0, (x - lo) / (hi - lo))));
    },

    levels(l, x) {
        const [i0, g, i1, o0, o1] = l;
        const t = Math.min(1, Math.max(0, (x - i0) / (i1 - i0)));
        return o0 + Math.pow(t, 1 / g) * (o1 - o0);
    },

    // The per-channel part: input value (0–255) → output (0–1) for each
    // channel. upto: 'levels' stops before levels and curves (Auto looks
    // at the photo there)
    channelTables(a, upto = null) {
        const wb = this.whiteBalance(a.temp, a.tint);
        const ex = Math.pow(2, a.exposure);
        const tone = this.toneCurve(a);
        const curveAll = this.spline(a.curve.rgb);
        const out = new Float32Array(256 * 4);
        const lin = new Float32Array(256);
        for (let i = 0; i < 256; i++) lin[i] = this.toLinear(i / 255);
        ['r', 'g', 'b'].forEach((ch, c) => {
            const curve = this.spline(a.curve[ch]);
            for (let i = 0; i < 256; i++) {
                let x = this.toGamma(Math.min(1, lin[i] * wb[c] * ex));
                if (tone) x = tone(x);
                if (upto !== 'levels') {
                    x = this.levels(a.levels.rgb, this.levels(a.levels[ch], x));
                    x = curve(curveAll(x));
                }
                out[i * 4 + c] = Math.min(1, Math.max(0, x));
            }
        });
        for (let i = 0; i < 256; i++) out[i * 4 + 3] = 1;
        return out;
    },

    // The colour mixer, vibrance and saturation, on one colour (0–1)
    colourFn(a) {
        const own = this.ownColourFn(a);
        const look = this.look(a.look);
        if (!look) return own;
        // The look, over the photo's own settings, by its amount
        // (a look's own tables never change: made once)
        this._looks = this._looks || {};
        const made = this._looks[look.id] || (this._looks[look.id] = (() => {
            const la = this.full(look.adj);
            return { lt: this.channelTables(la), lc: this.ownColourFn(la) };
        })());
        const { lt, lc } = made;
        const k = a.lookAmount / 100;
        const at = (c, x) => {
            const f = Math.min(255, Math.max(0, x * 255)), i = Math.min(254, f | 0), t = f - i;
            return lt[i * 4 + c] * (1 - t) + lt[(i + 1) * 4 + c] * t;
        };
        return (r, g, b) => {
            if (own) [r, g, b] = own(r, g, b);
            let l = [at(0, r), at(1, g), at(2, b)];
            if (lc) l = lc(l[0], l[1], l[2]);
            const mix = (x, y) => Math.min(1, Math.max(0, x + (y - x) * k));
            return [mix(r, l[0]), mix(g, l[1]), mix(b, l[2])];
        };
    },

    smooth(e0, e1, x) {
        const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
    },

    // Colour grading: a tint (hue, strength) and a brightness for the
    // shadows, midtones and highlights. Blending widens the zones into each
    // other; Balance moves where they meet. The tint keeps the brightness.
    gradeFn(a) {
        const zones = this.ZONES.map(([z]) => a.grade[z]);
        if (!zones.some(g => g[1] || g[2])) return null;
        const B = a.gradeBlend / 100, c = 0.5 - 0.3 * a.gradeBalance / 100;
        const sEnd = c * (0.6 + 0.8 * B), hStart = 1 - (1 - c) * (0.6 + 0.8 * B);
        const tints = zones.map(([h, s, l]) => {
            const x = h / 60, C = 1, X = 1 - Math.abs((x % 2) - 1);
            const rgb = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][Math.floor(x) % 6];
            const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
            return { d: rgb.map(v => (v - y) * (s / 100) * 0.3), l: l / 100 * 0.2 };
        });
        return (r, g, b) => {
            const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const ws = 1 - this.smooth(0, sEnd, L), wh = this.smooth(hStart, 1, L), wm = Math.max(0, 1 - ws - wh);
            const w = [ws, wm, wh];
            for (let z = 0; z < 3; z++) {
                const t = tints[z], k = w[z];
                if (!k) continue;
                r += (t.d[0] + t.l) * k; g += (t.d[1] + t.l) * k; b += (t.d[2] + t.l) * k;
            }
            return [r, g, b];
        };
    },

    // The colour mixer, vibrance, saturation and grading of these settings
    ownColourFn(a) {
        const hsl = a.hsl;
        const anyHsl = ['hue', 'sat', 'lum'].some(k => hsl[k].some(x => x));
        const sat = 1 + a.saturation / 100, vib = a.vibrance / 100;
        const grade = this.gradeFn(a);
        const mono = a.mono;
        if (!anyHsl && !a.saturation && !vib && !grade && !mono) return null;
        const at = this.HUES.map(h => h.at);
        const band = (h, list) => {
            // Between the two nearest colours, eased
            let i = at.length - 1;
            for (let k = 0; k < at.length; k++) if (h >= at[k]) i = k;
            const j = (i + 1) % at.length;
            const span = ((at[j] - at[i]) + 360) % 360 || 360;
            let t = (((h - at[i]) + 360) % 360) / span;
            t = t * t * (3 - 2 * t);
            return list[i] * (1 - t) + list[j] * t;
        };
        return (r, g, b) => {
            if (anyHsl) {
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                const l = (max + min) / 2, d = max - min;
                if (d > 1e-6) {
                    let s = d / (1 - Math.abs(2 * l - 1) || 1);
                    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
                    h = (h * 60 + 360) % 360;
                    const dh = band(h, hsl.hue) * 0.3, ds = band(h, hsl.sat) / 100, dl = band(h, hsl.lum) / 100;
                    const h2 = (h + dh + 360) % 360;
                    const s2 = Math.min(1, Math.max(0, s * (1 + ds)));
                    const k = 0.6 * Math.min(1, s);
                    const l2 = dl > 0 ? l + dl * k * (1 - l) : l + dl * k * l;
                    // Back to RGB
                    const C = (1 - Math.abs(2 * l2 - 1)) * s2, X = C * (1 - Math.abs((h2 / 60) % 2 - 1)), m = l2 - C / 2;
                    const seg = Math.floor(h2 / 60) % 6;
                    const rgb = [[C, X, 0], [X, C, 0], [0, C, X], [0, X, C], [X, 0, C], [C, 0, X]][seg];
                    r = rgb[0] + m; g = rgb[1] + m; b = rgb[2] + m;
                }
            }
            if (sat !== 1 || vib) {
                const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                const s = Math.max(r, g, b) - Math.min(r, g, b);
                const f = Math.max(0, sat * (1 + vib * (vib > 0 ? (1 - s) * (1 - s) : 1)));
                r = y + (r - y) * f; g = y + (g - y) * f; b = y + (b - y) * f;
            }
            // Black and white as the film saw it: its weights on the light
            if (mono) {
                const y = this.toGamma(Math.min(1, Math.max(0, mono[0] * this.toLinear(Math.min(1, Math.max(0, r))) + mono[1] * this.toLinear(Math.min(1, Math.max(0, g))) + mono[2] * this.toLinear(Math.min(1, Math.max(0, b))))));
                r = g = b = y;
            }
            if (grade) [r, g, b] = grade(r, g, b);
            return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
        };
    },

    colourLut(a, N = this.LUT_SIZE) {
        const f = this.colourFn(a);
        if (!f) return null;
        const out = new Float32Array(N * N * N * 4);
        let o = 0;
        for (let b = 0; b < N; b++) {
            for (let g = 0; g < N; g++) {
                for (let r = 0; r < N; r++) {
                    const c = f(r / (N - 1), g / (N - 1), b / (N - 1));
                    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 1;
                    o += 4;
                }
            }
        }
        return out;
    },

    // Both tables for a set of settings (remembered for the last few)
    tables(adj) {
        const key = JSON.stringify(this.clean(adj));
        this._tables = this._tables || new Map();
        let t = this._tables.get(key);
        if (!t) {
            const a = this.full(adj);
            const c = this.clean(adj);
            t = { key, channels: this.channelTables(a), lut: this.colourLut(a), N: this.LUT_SIZE, fx: this.effects(a), masks: this.maskTables(c && c.masks) };
            this._tables.set(key, t);
            if (this._tables.size > 8) this._tables.delete(this._tables.keys().next().value);
        }
        return t;
    },

    // ---- Effects: vignette and grain ----

    // The vignette and grain to apply (a look's added, by its amount), or
    // null for none: { vig: [amount, middle, width, roundness], grain:
    // [amount, cells across the long side] }
    effects(a) {
        const look = this.look(a.look);
        const la = look ? this.full(look.adj) : null, k = look ? a.lookAmount / 100 : 0;
        const vig = Math.max(-100, Math.min(100, a.vignette + (la ? la.vignette * k : 0)));
        const grain = Math.min(100, a.grain + (la ? la.grain * k : 0));
        const hal = Math.min(100, a.halation + (la ? la.halation * k : 0));
        if (!vig && !grain && !hal) return null;
        const useOwnVig = a.vignette || !la, useOwnGrain = a.grain || !la;
        const mid = useOwnVig ? a.vigMid : la.vigMid, feather = useOwnVig ? a.vigFeather : la.vigFeather;
        const round = useOwnVig ? a.vigRound : la.vigRound, size = useOwnGrain ? a.grainSize : la.grainSize;
        const color = useOwnGrain ? a.grainColor : la.grainColor;
        return {
            vig: [vig / 100, 0.15 + 0.7 * mid / 100, 0.05 + 0.9 * feather / 100, round / 100],
            grain: [grain / 100 * 0.16, 300 + 1700 * (1 - size / 100), color / 100],
            // Amount, and its colour: the red of light back through the film base
            hal: [hal / 100 * 0.9, 1.0, 0.28, 0.1]
        };
    },

    // ---- Halation's map ----
    //
    // Light from a bright highlight goes through the film, bounces off the
    // back and comes back as a red glow round it (cinema film without its
    // backing, CineStill). The glow is the highlights, blurred: made from
    // a small copy of the whole picture (so every tile, and the preview,
    // use the same), and looked up by where each pixel is.

    GLOW_EDGE: 320,

    // From RGBA bytes already through the tables: { data, w, h }
    glowMap(px, w, h) {
        const n = w * h, a = new Float32Array(n), b = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const L = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
            a[i] = this.smooth(0.72, 1, L);
        }
        // Three box blurs, about a Gaussian, 1.2% of the long side
        const r = Math.max(1, Math.round(0.012 * Math.max(w, h)));
        const pass = (src, dst, horiz) => {
            const len = horiz ? w : h, lines = horiz ? h : w;
            for (let l = 0; l < lines; l++) {
                const at = (k) => horiz ? l * w + k : k * w + l;
                let sum = 0;
                for (let k = -r; k <= r; k++) sum += src[at(Math.min(len - 1, Math.max(0, k)))];
                for (let k = 0; k < len; k++) {
                    dst[at(k)] = sum / (2 * r + 1);
                    sum += src[at(Math.min(len - 1, k + r + 1))] - src[at(Math.max(0, k - r))];
                }
            }
        };
        for (let i = 0; i < 3; i++) { pass(a, b, true); pass(b, a, false); }
        // A small light glows as much as a big one, nearly (the blur
        // spreads it thin)
        for (let i = 0; i < n; i++) a[i] = Math.min(1, a[i] * 4);
        return { data: a, w, h };
    },

    // The map at (u, v) (0–1 across the picture), as the GPU's linear
    // filtering reads it
    glowAt(map, u, v) {
        const fx = u * map.w - 0.5, fy = v * map.h - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const cx = (x) => Math.min(map.w - 1, Math.max(0, x)), cy = (y) => Math.min(map.h - 1, Math.max(0, y));
        const at = (x, y) => map.data[cy(y) * map.w + cx(x)];
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        return top + (bot - top) * ty;
    },

    // A brush map's channel at (u, v), as the GPU's linear filtering reads it
    brushAt(map, ch, u, v) {
        const fx = u * map.w - 0.5, fy = v * map.h - 0.5;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const at = (x, y) => map.data[((Math.min(map.h - 1, Math.max(0, y)) * map.w) + Math.min(map.w - 1, Math.max(0, x))) * 4 + ch] / 255;
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        return top + (bot - top) * ty;
    },

    // A whole canvas's map (saving, previews): from a small copy of it
    canvasGlow(canvas, T) {
        const s = Math.min(1, this.GLOW_EDGE / Math.max(canvas.width, canvas.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(canvas.width * s));
        c.height = Math.max(1, Math.round(canvas.height * s));
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(canvas, 0, 0, c.width, c.height);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        return this.glowMap(this.applyCPU(px, { ...T, fx: null }), c.width, c.height);
    },

    // The same 32-bit hash as the shader's
    hash(x, y) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
        x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
        x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
        x = (x + Math.imul(y, 1664525)) >>> 0;
        return (x ^ (x >>> 16)) >>> 0;
    },

    // Smooth noise, 0–1, the same as the shader's (off: another field)
    noise(gx, gy, off = 0) {
        const ix = Math.floor(gx), iy = Math.floor(gy);
        let sx = gx - ix, sy = gy - iy;
        sx = sx * sx * (3 - 2 * sx); sy = sy * sy * (3 - 2 * sy);
        const h = (x, y) => this.hash(x + off, y) / 4294967295;
        const top = h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * sx;
        const bot = h(ix, iy + 1) + (h(ix + 1, iy + 1) - h(ix, iy + 1)) * sx;
        return top + (bot - top) * sy;
    },

    // One pixel's effects: (px, py) its middle, in a W × H frame; glow:
    // halation's map
    effect(fx, rgb, px, py, W, H, glow = null) {
        let [r, g, b] = rgb;
        const hl = fx.hal;
        if (hl[0] && glow) {
            const k = hl[0] * this.glowAt(glow, px / W, py / H);
            r = 1 - (1 - r) * (1 - k * hl[1]); g = 1 - (1 - g) * (1 - k * hl[2]); b = 1 - (1 - b) * (1 - k * hl[3]);
        }
        const v = fx.vig;
        if (v[0]) {
            const ex = (px / W - 0.5) * 2, ey = (py / H - 0.5) * 2;
            let t;
            if (v[3] >= 0) {
                const m = Math.min(W, H) / 2, cx = (px - W / 2) / m, cy = (py - H / 2) / m;
                const te = Math.hypot(ex, ey) / Math.SQRT2, tc = Math.hypot(cx, cy) / Math.hypot(W / 2 / m, H / 2 / m);
                t = te + (tc - te) * v[3];
            } else {
                const q = 2 - v[3] * 6;
                t = Math.pow(Math.pow(Math.abs(ex), q) + Math.pow(Math.abs(ey), q), 1 / q) / Math.pow(2, 1 / q);
            }
            const f = this.smooth(v[1] - v[2] / 2, v[1] + v[2] / 2, t);
            if (v[0] < 0) { const k = 1 + v[0] * f; r *= k; g *= k; b *= k; }
            else { const k = v[0] * f; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k; }
        }
        const gr = fx.grain;
        if (gr[0]) {
            const cell = Math.max(W, H) / gr[1];
            const gx = px / cell, gy = py / cell;
            const n = this.noise(gx, gy) - 0.5;
            const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const k = gr[0] * (0.4 + 2.4 * L * (1 - L));
            // Colour film's grain is dye clouds: partly its own in each colour
            const c = gr[2];
            if (c) {
                r += (n * (1 - c) + (this.noise(gx, gy, 65537) - 0.5) * c) * k;
                g += (n * (1 - c) + (this.noise(gx, gy, 131074) - 0.5) * c) * k;
                b += (n * (1 - c) + (this.noise(gx, gy, 196611) - 0.5) * c) * k;
            } else {
                r += n * k; g += n * k; b += n * k;
            }
        }
        return [Math.min(1, Math.max(0, r)), Math.min(1, Math.max(0, g)), Math.min(1, Math.max(0, b))];
    },

    // ---- On the CPU (no WebGL2, histograms, Auto) ----

    // RGBA bytes (in place, or into `out`). frame: where these pixels are
    // in the whole picture { x, y, w, W, H, glow } (the effects need it; w
    // is this block's width, glow halation's map); none: no effects
    // A colour table (N³, RGBA floats) at (r, g, b), trilinear
    lutAt(lut, N, r, g, b) {
        const M = N - 1;
        const fr = Math.min(1, Math.max(0, r)) * M, fg = Math.min(1, Math.max(0, g)) * M, fb = Math.min(1, Math.max(0, b)) * M;
        const r0 = Math.min(M - 1, fr | 0), g0 = Math.min(M - 1, fg | 0), b0 = Math.min(M - 1, fb | 0);
        const tr = fr - r0, tg = fg - g0, tb = fb - b0;
        const at = (x, y, z, k) => lut[((z * N + y) * N + x) * 4 + k];
        const c = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
            const c00 = at(r0, g0, b0, k) * (1 - tr) + at(r0 + 1, g0, b0, k) * tr;
            const c10 = at(r0, g0 + 1, b0, k) * (1 - tr) + at(r0 + 1, g0 + 1, b0, k) * tr;
            const c01 = at(r0, g0, b0 + 1, k) * (1 - tr) + at(r0 + 1, g0, b0 + 1, k) * tr;
            const c11 = at(r0, g0 + 1, b0 + 1, k) * (1 - tr) + at(r0 + 1, g0 + 1, b0 + 1, k) * tr;
            c[k] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
        }
        return c;
    },

    // A channel table (256 per channel) at x (0–1), linear between entries
    toneAt(tab, c, x) {
        const f = Math.min(1, Math.max(0, x)) * 255, i = Math.min(254, f | 0), t = f - i;
        return tab[i * 4 + c] * (1 - t) + tab[(i + 1) * 4 + c] * t;
    },

    // The masks on one colour at (a, b) across the picture (0–1)
    masked(M, rgb, a, b, map, brush) {
        const m = map.m;
        const u = m[0] * a + m[1] * b + m[2], v = m[3] * a + m[4] * b + m[5];
        let [r, g, bl] = rgb;
        for (const e of M.list) {
            const w = this.maskWeight(e, u, v, map.asp, brush);
            if (w <= 0) continue;
            let q = [this.toneAt(e.tone, 0, r), this.toneAt(e.tone, 1, g), this.toneAt(e.tone, 2, bl)];
            if (e.lut) q = this.lutAt(e.lut, this.MASK_LUT, q[0], q[1], q[2]);
            r += (q[0] - r) * w; g += (q[1] - g) * w; bl += (q[2] - bl) * w;
        }
        return [r, g, bl];
    },

    applyCPU(px, T, out = px, frame = null) {
        const fx = T.fx, M = frame ? T.masks : null;
        const fw = frame ? frame.w : 0;
        const map = frame && (frame.map || this.cropMap(null, frame.W, frame.H));
        const brush = M && M.brushes ? (frame.brush || this.brushFor(M, map.asp)) : null;
        const ch = T.channels, lut = T.lut, N = T.N;
        for (let i = 0; i < px.length; i += 4) {
            let r = ch[px[i] * 4], g = ch[px[i + 1] * 4 + 1], b = ch[px[i + 2] * 4 + 2];
            if (lut) [r, g, b] = this.lutAt(lut, N, r, g, b);
            if ((fx || M) && frame) {
                const k = i / 4, x = k % fw, y = (k - x) / fw;
                const px0 = frame.x + x + 0.5, py0 = frame.y + y + 0.5;
                if (M) [r, g, b] = this.masked(M, [r, g, b], px0 / frame.W, py0 / frame.H, map, brush);
                if (fx) [r, g, b] = this.effect(fx, [r, g, b], px0, py0, frame.W, frame.H, frame.glow);
            }
            out[i] = Math.round(r * 255);
            out[i + 1] = Math.round(g * 255);
            out[i + 2] = Math.round(b * 255);
            out[i + 3] = px[i + 3];
        }
        return out;
    },

    // 256 bins each of red, green, blue and brightness
    histogram(px) {
        const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), l: new Uint32Array(256), n: 0 };
        for (let i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 8) continue;
            const r = px[i], g = px[i + 1], b = px[i + 2];
            h.r[r]++; h.g[g]++; h.b[b]++;
            h.l[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
            h.n++;
        }
        return h;
    },

    // The value below which `p` of the pixels are
    percentile(bins, n, p) {
        const want = n * p;
        let sum = 0;
        for (let i = 0; i < 256; i++) {
            sum += bins[i];
            if (sum > want) return i / 255;
        }
        return 1;
    },

    // Auto: levels from the photo as the other settings leave it. colour:
    // each channel on its own too (a faded print's cast goes)
    auto(px, adj, { colour = false } = {}) {
        const a = this.full(adj);
        const T = { channels: this.channelTables(a, 'levels'), lut: null, N: this.LUT_SIZE };
        const h = this.histogram(this.applyCPU(px, T, new Uint8ClampedArray(px.length)));
        if (!h.n) return adj;
        const levels = {};
        let lum = h.l;
        if (colour) {
            const lo = [], hi = [];
            for (const c of ['r', 'g', 'b']) {
                const i0 = this.percentile(h[c], h.n, 0.005), i1 = Math.max(i0 + 0.05, this.percentile(h[c], h.n, 0.995));
                levels[c] = [i0, 1, Math.min(1, i1), 0, 1];
                lo.push(i0); hi.push(i1);
            }
            // The brightness after those, for the midtones
            const per = { ...a, levels: { ...a.levels, ...levels, rgb: this.LEVELS.slice() } };
            const T2 = { channels: this.channelTables(per), lut: null, N: this.LUT_SIZE };
            lum = this.histogram(this.applyCPU(px, T2, new Uint8ClampedArray(px.length))).l;
        }
        const i0 = colour ? 0 : this.percentile(lum, h.n, 0.001);
        const i1 = colour ? 1 : Math.max(i0 + 0.05, this.percentile(lum, h.n, 0.999));
        const mid = this.percentile(lum, h.n, 0.5);
        const t = Math.min(0.95, Math.max(0.05, (mid - i0) / (i1 - i0)));
        const gamma = Math.min(2, Math.max(0.5, Math.log(t) / Math.log(0.46)));
        levels.rgb = [i0, gamma, Math.min(1, i1), 0, 1];
        if (!colour) for (const c of ['r', 'g', 'b']) levels[c] = this.LEVELS.slice();
        const base = this.clean(adj) || {};
        return this.clean({ ...base, levels: { ...(base.levels || {}), ...levels } });
    },

    // ---- On the GPU ----

    VERT: `#version 300 es
in vec2 pos;
out vec2 uv;
uniform bool flip;
void main() {
    uv = vec2(pos.x * 0.5 + 0.5, (flip ? -pos.y : pos.y) * -0.5 + 0.5);
    gl_Position = vec4(pos, 0.0, 1.0);
}`,
    FRAG: `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
out vec4 o;
uniform sampler2D img;
uniform sampler2D tone;
uniform sampler3D lut;
uniform bool useLut;
uniform bool before;
uniform bool flip;
uniform float lutN;
uniform vec4 vig;    // amount, middle, width, roundness
uniform vec3 grain;  // amount, cells across the long side, colour
uniform vec4 hal;    // halation: amount, colour
uniform sampler2D glow;
uniform vec4 frame;  // this block's place in the picture (x, y), and the picture's size
uniform float tileH;
// Masks: up to 8, each its own channel row and colour slab, and its shape
uniform int mCount;
uniform int mType[8];
uniform float mInv[8];
uniform float mHasLut[8];
uniform vec4 mA[8];
uniform vec4 mB[8];
uniform sampler2D mTone;
uniform sampler3D mLut;
uniform sampler2D mBrush0;
uniform sampler2D mBrush1;
uniform vec3 mapU;
uniform vec3 mapV;
uniform float asp;
float at(float x) { return x * (255.0 / 256.0) + 0.5 / 256.0; }
float ss(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float maskW(int k, float u, float v) {
    float w = 0.0;
    vec2 P = vec2(u * asp, v);
    vec4 A = mA[k], B = mB[k];
    int ty = mType[k];
    if (ty == 1) {
        vec2 d = vec2((A.z - A.x) * asp, A.w - A.y);
        float t = dot(P - vec2(A.x * asp, A.y), d) / dot(d, d);
        w = 1.0 - ss(0.0, 1.0, t);
    } else if (ty == 2) {
        vec2 q = P - vec2(A.x * asp, A.y);
        float c = cos(B.x), s = sin(B.x);
        vec2 l = vec2((c * q.x + s * q.y) / A.z, (-s * q.x + c * q.y) / A.w);
        w = 1.0 - ss(1.0 - max(0.01, B.y), 1.0, length(l));
    } else if (ty == 3) {
        int slot = int(B.z + 0.5);
        vec4 b = slot < 4 ? texture(mBrush0, vec2(u, v)) : texture(mBrush1, vec2(u, v));
        int ch = slot - (slot / 4) * 4;
        w = ch == 0 ? b.r : ch == 1 ? b.g : ch == 2 ? b.b : b.a;
    }
    return mInv[k] > 0.5 ? 1.0 - w : w;
}
uint hash(uvec2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u; v.y += v.x * 1664525u;
    v ^= v >> 16u;
    v.x += v.y * 1664525u;
    v ^= v >> 16u;
    return v.x;
}
float h01(float x, float y, uint off) { return float(hash(uvec2(uint(x) + off, uint(y)))) / 4294967295.0; }
float vnoise(vec2 g, uint off) {
    vec2 i = floor(g), s = g - i;
    s = s * s * (3.0 - 2.0 * s);
    float top = mix(h01(i.x, i.y, off), h01(i.x + 1.0, i.y, off), s.x);
    float bot = mix(h01(i.x, i.y + 1.0, off), h01(i.x + 1.0, i.y + 1.0, off), s.x);
    return mix(top, bot, s.y);
}
void main() {
    vec4 c = texture(img, uv);
    if (before) { o = c; return; }
    vec3 t = vec3(texture(tone, vec2(at(c.r), 0.5)).r, texture(tone, vec2(at(c.g), 0.5)).g, texture(tone, vec2(at(c.b), 0.5)).b);
    if (useLut) t = texture(lut, t * ((lutN - 1.0) / lutN) + 0.5 / lutN).rgb;
    // Where this pixel is in the whole picture (its middle)
    vec2 p = frame.xy + vec2(gl_FragCoord.x, flip ? gl_FragCoord.y : tileH - gl_FragCoord.y);
    float W = frame.z, H = frame.w;
    if (mCount > 0) {
        vec3 ab = vec3(p / vec2(W, H), 1.0);
        float u = dot(mapU, ab), v = dot(mapV, ab);
        for (int k = 0; k < 8; k++) {
            if (k >= mCount) break;
            float w = maskW(k, u, v);
            if (w <= 0.0) continue;
            float row = (float(k) + 0.5) / 8.0;
            vec3 m = vec3(texture(mTone, vec2(at(clamp(t.r, 0.0, 1.0)), row)).r, texture(mTone, vec2(at(clamp(t.g, 0.0, 1.0)), row)).g, texture(mTone, vec2(at(clamp(t.b, 0.0, 1.0)), row)).b);
            if (mHasLut[k] > 0.5) {
                vec3 q = clamp(m, 0.0, 1.0);
                m = texture(mLut, vec3(q.r * (16.0 / 17.0) + 0.5 / 17.0, q.g * (16.0 / 17.0) + 0.5 / 17.0, (float(k) * 17.0 + q.b * 16.0 + 0.5) / 136.0)).rgb;
            }
            t = mix(t, m, w);
        }
    }
    if (hal.x != 0.0) {
        float k = hal.x * texture(glow, p / vec2(W, H)).r;
        t = 1.0 - (1.0 - t) * (1.0 - k * hal.yzw);
    }
    if (vig.x != 0.0) {
        vec2 e = (p / vec2(W, H) - 0.5) * 2.0;
        float d;
        if (vig.w >= 0.0) {
            float m = min(W, H) / 2.0;
            vec2 q = (p - vec2(W, H) / 2.0) / m;
            float te = length(e) / sqrt(2.0), tc = length(q) / length(vec2(W, H) / 2.0 / m);
            d = te + (tc - te) * vig.w;
        } else {
            float k = 2.0 - vig.w * 6.0;
            d = pow(pow(abs(e.x), k) + pow(abs(e.y), k), 1.0 / k) / pow(2.0, 1.0 / k);
        }
        float f = ss(vig.y - vig.z / 2.0, vig.y + vig.z / 2.0, d);
        if (vig.x < 0.0) t *= 1.0 + vig.x * f;
        else t += (1.0 - t) * vig.x * f;
    }
    if (grain.x != 0.0) {
        float cell = max(W, H) / grain.y;
        vec2 g = p / cell;
        float n = vnoise(g, 0u) - 0.5;
        float L = dot(t, vec3(0.2126, 0.7152, 0.0722));
        float k = grain.x * (0.4 + 2.4 * L * (1.0 - L));
        if (grain.z != 0.0) {
            vec3 cn = vec3(vnoise(g, 65537u), vnoise(g, 131074u), vnoise(g, 196611u)) - 0.5;
            t += (n * (1.0 - grain.z) + cn * grain.z) * k;
        } else {
            t += n * k;
        }
    }
    o = vec4(clamp(t, 0.0, 1.0), c.a);
}`,

    // A WebGL2 renderer on `canvas`, or null where there's none
    renderer(canvas) {
        let gl = null;
        try {
            gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
        } catch (e) { /* none */ }
        if (!gl) return null;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        let prog;
        try {
            prog = gl.createProgram();
            gl.attachShader(prog, sh(gl.VERTEX_SHADER, this.VERT));
            gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, this.FRAG));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        } catch (e) {
            console.warn('Develop: no WebGL2 shader:', e.message);
            return null;
        }
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'pos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const u = (n) => gl.getUniformLocation(prog, n);
        const tex = (unit, target) => {
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(target, t);
            gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            if (target === gl.TEXTURE_3D) gl.texParameteri(target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            return t;
        };
        const imgTex = tex(0, gl.TEXTURE_2D), toneTex = tex(1, gl.TEXTURE_2D), lutTex = tex(2, gl.TEXTURE_3D), glowTex = tex(3, gl.TEXTURE_2D);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
        const mToneTex = tex(4, gl.TEXTURE_2D), mLutTex = tex(5, gl.TEXTURE_3D), mBrushTex = [tex(6, gl.TEXTURE_2D), tex(7, gl.TEXTURE_2D)];
        for (const [unit, t] of [[6, mBrushTex[0]], [7, mBrushTex[1]]]) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        }
        gl.uniform1i(u('img'), 0);
        gl.uniform1i(u('tone'), 1);
        gl.uniform1i(u('lut'), 2);
        gl.uniform1i(u('glow'), 3);
        gl.uniform1i(u('mTone'), 4);
        gl.uniform1i(u('mLut'), 5);
        gl.uniform1i(u('mBrush0'), 6);
        gl.uniform1i(u('mBrush1'), 7);
        gl.uniform1i(u('mCount'), 0);
        let masksKey = null, brushMaps = null;
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        let tablesKey = null, lost = false;
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
        const R = {
            gl, canvas, max,
            w: 0, h: 0,
            get lost() { return lost || gl.isContextLost(); },
            // An ImageBitmap, canvas or ImageData
            setImage(src) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, imgTex);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
                R.w = src.width;
                R.h = src.height;
            },
            setTables(T) {
                if (T.key === tablesKey) return;
                tablesKey = T.key;
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, toneTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 1, 0, gl.RGBA, gl.FLOAT, T.channels);
                if (T.lut) {
                    gl.activeTexture(gl.TEXTURE2);
                    gl.bindTexture(gl.TEXTURE_3D, lutTex);
                    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, T.N, T.N, T.N, 0, gl.RGBA, gl.FLOAT, T.lut);
                }
                gl.uniform1i(u('useLut'), T.lut ? 1 : 0);
                gl.uniform1f(u('lutN'), T.N);
                const fx = T.fx || { vig: [0, 0, 1, 0], grain: [0, 1, 0], hal: [0, 0, 0, 0] };
                gl.uniform4f(u('vig'), ...fx.vig);
                gl.uniform3f(u('grain'), ...fx.grain);
                gl.uniform4f(u('hal'), ...fx.hal);
                R.setMasks(T.masks);
            },
            // Each mask's tables and shape
            setMasks(M) {
                const key = M ? M.key : null;
                if (key === masksKey) return;
                masksKey = key;
                const list = M ? M.list : [];
                gl.uniform1i(u('mCount'), list.length);
                if (!list.length) return;
                const N = Develop.MASK_LUT;
                const tone = new Float32Array(256 * 4 * 8), lut = new Float32Array(N * N * N * 8 * 4);
                const type = new Int32Array(8), inv = new Float32Array(8), has = new Float32Array(8), A = new Float32Array(32), B = new Float32Array(32);
                list.forEach((e, k) => {
                    tone.set(e.tone, k * 256 * 4);
                    if (e.lut) lut.set(e.lut, k * N * N * N * 4);
                    type[k] = e.type; inv[k] = e.inv; has[k] = e.lut ? 1 : 0;
                    A.set(e.A, k * 4);
                    B.set([e.B[0], e.B[1], e.type === 3 ? e.slot : 0, 0], k * 4);
                });
                gl.activeTexture(gl.TEXTURE4);
                gl.bindTexture(gl.TEXTURE_2D, mToneTex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 256, 8, 0, gl.RGBA, gl.FLOAT, tone);
                gl.activeTexture(gl.TEXTURE5);
                gl.bindTexture(gl.TEXTURE_3D, mLutTex);
                gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, N, N, N * 8, 0, gl.RGBA, gl.FLOAT, lut);
                gl.uniform1iv(u('mType'), type);
                gl.uniform1fv(u('mInv'), inv);
                gl.uniform1fv(u('mHasLut'), has);
                gl.uniform4fv(u('mA'), A);
                gl.uniform4fv(u('mB'), B);
            },
            // The brush masks' maps (brushMaps)
            setBrush(maps) {
                if (!maps || maps === brushMaps) return;
                brushMaps = maps;
                maps.forEach((m, i) => {
                    if (!m) return;
                    gl.activeTexture(gl.TEXTURE6 + i);
                    gl.bindTexture(gl.TEXTURE_2D, mBrushTex[i]);
                    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, m.w, m.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, m.data);
                });
            },
            // Halation's map (glowMap)
            setGlow(map) {
                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, glowTex);
                gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, map.w, map.h, 0, gl.RED, gl.FLOAT, map.data);
            },
            // The image, at w × h on the canvas. flip: rows top first, as
            // readPixels gives them back
            // frame: where it is in the whole picture (the effects need it)
            draw(w, h, { before = false, flip = false, frame = null } = {}) {
                if (canvas.width !== w) canvas.width = w;
                if (canvas.height !== h) canvas.height = h;
                gl.viewport(0, 0, w, h);
                gl.uniform1i(u('before'), before ? 1 : 0);
                gl.uniform1i(u('flip'), flip ? 1 : 0);
                const f = frame || { x: 0, y: 0, W: w, H: h };
                gl.uniform4f(u('frame'), f.x, f.y, f.W, f.H);
                const map = f.map || Develop.cropMap(null, f.W, f.H);
                gl.uniform3f(u('mapU'), map.m[0], map.m[1], map.m[2]);
                gl.uniform3f(u('mapV'), map.m[3], map.m[4], map.m[5]);
                gl.uniform1f(u('asp'), map.asp);
                gl.uniform1f(u('tileH'), h);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            },
            read(w, h) {
                const px = new Uint8ClampedArray(w * h * 4);
                gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
                return px;
            }
        };
        return R;
    },

    // The shared off-screen renderer (thumbnails, previews, saving)
    gpu() {
        if (this._gpu === undefined || (this._gpu && this._gpu.lost)) {
            this._gpu = (typeof document !== 'undefined' && !this.noGpu) ? this.renderer(document.createElement('canvas')) : null;
        }
        return this._gpu;
    },

    TILE: 2048,

    // The adjustments drawn onto a 2D canvas, in place (in tiles, so any
    // size works). True when something changed.
    // scale: this canvas's pixels to one of the photo's (detail is left
    // out below a half: it wouldn't show)
    // map: where the picture is on the photo (cropMap; masks need it)
    applyCanvas(canvas, adj, { scale = 1, map = null } = {}) {
        if (!this.active(adj)) return false;
        const T = this.tables(adj);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const R = this.gpu();
        const tile = R ? Math.min(this.TILE, R.max) : this.TILE;
        const glow = T.fx && T.fx.hal[0] ? this.canvasGlow(canvas, T) : null;
        if (glow && R && !R.lost) R.setGlow(glow);
        map = map || this.cropMap(null, canvas.width, canvas.height);
        const brush = this.brushFor(T.masks, map.asp);
        if (brush && R && !R.lost) R.setBrush(brush);
        const d = scale >= 0.5 ? this.detail(this.full(adj)) : null;
        // Detail reads round each block: from the picture as it was
        let source = null;
        if (d) {
            source = document.createElement('canvas');
            source.width = canvas.width;
            source.height = canvas.height;
            source.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0);
        }
        const sctx = source && source.getContext('2d');
        for (let y = 0; y < canvas.height; y += tile) {
            for (let x = 0; x < canvas.width; x += tile) {
                const w = Math.min(tile, canvas.width - x), h = Math.min(tile, canvas.height - y);
                const img = d
                    ? this.detailBlock((a, b, c, e) => sctx.getImageData(a, b, c, e), x, y, w, h, canvas.width, canvas.height, d, scale)
                    : ctx.getImageData(x, y, w, h);
                const frame = { x, y, w, W: canvas.width, H: canvas.height, glow, map, brush };
                let done = false;
                if (R && !R.lost) {
                    try {
                        R.setImage(img);
                        R.setTables(T);
                        R.draw(w, h, { flip: true, frame });
                        img.data.set(R.read(w, h));
                        done = !R.lost;
                    } catch (e) {
                        console.warn('Develop: GPU failed, using the CPU:', e);
                    }
                }
                if (!done) this.applyCPU(img.data, T, img.data, frame);
                ctx.putImageData(img, x, y);
            }
        }
        if (source) source.width = source.height = 0;
        return true;
    },

    // ---- Detail: sharpening and noise reduction ----
    //
    // On the photo before everything else, in brightness and colour
    // (Y, and the colour differences Cb, Cr), each a pass across then a
    // pass down:
    //   noise: an edge-keeping (bilateral) blur of the brightness
    //   colorNoise: a blur of the colour only, so blotches go and edges stay
    //   sharpen: an unsharp mask of the brightness (no colour fringes);
    //            Masking keeps it to the edges, off flat skin and sky
    // Sizes are in the photo's own pixels: `scale` is how many of this
    // picture's pixels there are to one of the photo's (a screen-sized
    // preview is 0.3 or so, where none of it shows: it's left out there).

    detail(a) {
        if (!a.sharpen && !a.noise && !a.colorNoise) return null;
        return { amount: a.sharpen / 100 * 1.5, radius: a.sharpRadius, mask: a.sharpMask / 100, noise: a.noise / 100, color: a.colorNoise / 100 };
    },

    detailSizes(d, s) {
        const sn = (0.6 + 1.6 * d.noise) * s, sc = (1 + 4 * d.color) * s, sb = d.radius * s;
        const rn = d.noise ? Math.min(6, Math.ceil(2 * sn)) : 0;
        const rc = d.color ? Math.min(10, Math.ceil(2 * sc)) : 0;
        const rb = d.amount ? Math.min(10, Math.ceil(2.5 * sb)) : 0;
        return { sn, sc, sb, rn, rc, rb, margin: Math.max(rn, rc) + rb + (d.amount ? 1 : 0) };
    },

    // RGBA bytes (w × h), in place
    applyDetail(px, w, h, d, s = 1) {
        const z = this.detailSizes(d, s);
        const n = w * h;
        let Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const r = px[i * 4] / 255, g = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            Y[i] = y; Cb[i] = b - y; Cr[i] = r - y;
        }
        const kernel = (sigma, r) => {
            const k = new Float32Array(2 * r + 1);
            for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * Math.max(1e-3, sigma * sigma)));
            return k;
        };
        // One pass across (or down): for each pixel, a weighted sum of its
        // neighbours along the line, k from -r to r, edges repeated; with
        // `range`, neighbours unlike it count less (edges are kept)
        const line = (src, dst, horiz, r, k, range) => {
            const len = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, next = horiz ? w : 1;
            for (let l = 0; l < lines; l++) {
                const o = l * next;
                for (let a = 0; a < len; a++) {
                    const c = o + a * step, yc = src[c];
                    let sum = 0, ws = 0;
                    if (range) {
                        for (let t = -r; t <= r; t++) {
                            let b = a + t;
                            if (b < 0) b = 0; else if (b >= len) b = len - 1;
                            const v = src[o + b * step];
                            const dv = v > yc ? v - yc : yc - v;
                            const q = dv * 1024 + 0.5 | 0;
                            const wt = k[t + r] * range[q > 1024 ? 1024 : q];
                            sum += v * wt; ws += wt;
                        }
                    } else if (a >= r && a < len - r) {
                        for (let t = -r; t <= r; t++) {
                            const wt = k[t + r];
                            sum += src[c + t * step] * wt; ws += wt;
                        }
                    } else {
                        for (let t = -r; t <= r; t++) {
                            let b = a + t;
                            if (b < 0) b = 0; else if (b >= len) b = len - 1;
                            const wt = k[t + r];
                            sum += src[o + b * step] * wt; ws += wt;
                        }
                    }
                    dst[c] = sum / ws;
                }
            }
        };
        // Brightness kept to its edges, colour blurred
        if (z.rn || z.rc) {
            const kn = kernel(z.sn, z.rn), kc = kernel(z.sc, z.rc);
            const sr = 0.015 + 0.1 * d.noise;
            const range = new Float32Array(1025);
            for (let i = 0; i <= 1024; i++) range[i] = Math.exp(-((i / 1024) ** 2) / (2 * sr * sr));
            const tmp = new Float32Array(n), out = new Float32Array(n);
            if (z.rn) { line(Y, tmp, true, z.rn, kn, range); line(tmp, out, false, z.rn, kn, range); Y = out.slice(); }
            if (z.rc) {
                line(Cb, tmp, true, z.rc, kc, null); line(tmp, out, false, z.rc, kc, null); Cb = out.slice();
                line(Cr, tmp, true, z.rc, kc, null); line(tmp, out, false, z.rc, kc, null); Cr = out.slice();
            }
        }
        if (z.rb) {
            const kb = kernel(z.sb, z.rb);
            const tmp = new Float32Array(n), B = new Float32Array(n);
            line(Y, tmp, true, z.rb, kb, null);
            line(tmp, B, false, z.rb, kb, null);
            const t = d.mask * 0.08;
            const Y2 = new Float32Array(n);
            for (let y = 0; y < h; y++) {
                const up = (y > 0 ? y - 1 : 0) * w, down = (y < h - 1 ? y + 1 : h - 1) * w, row = y * w;
                for (let x = 0; x < w; x++) {
                    const i = row + x;
                    let m = 1;
                    if (d.mask) {
                        const gx = (Y[row + (x < w - 1 ? x + 1 : x)] - Y[row + (x > 0 ? x - 1 : 0)]) / 2;
                        const gy = (Y[down + x] - Y[up + x]) / 2;
                        m = this.smooth(t, t + 0.04, Math.sqrt(gx * gx + gy * gy));
                    }
                    Y2[i] = Y[i] + d.amount * (Y[i] - B[i]) * m;
                }
            }
            Y = Y2;
        }
        for (let i = 0; i < n; i++) {
            const y = Y[i], r = y + Cr[i], b = y + Cb[i];
            const g = (y - 0.299 * r - 0.114 * b) / 0.587;
            px[i * 4] = Math.round(Math.min(1, Math.max(0, r)) * 255);
            px[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
            px[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
        }
        return px;
    },

    // A block of a picture (x, y, w, h of a W × H source read through
    // `read(x, y, w, h)` → ImageData) with its detail done: read with a
    // margin, so its edges have the pixels round them, as if the whole
    // picture were done at once
    detailBlock(read, x, y, w, h, W, H, d, s) {
        const m = this.detailSizes(d, s).margin;
        const x0 = Math.max(0, x - m), y0 = Math.max(0, y - m);
        const x1 = Math.min(W, x + w + m), y1 = Math.min(H, y + h + m);
        const big = read(x0, y0, x1 - x0, y1 - y0);
        this.applyDetail(big.data, big.width, big.height, d, s);
        const out = new ImageData(w, h);
        for (let r = 0; r < h; r++) {
            const from = ((y - y0 + r) * big.width + (x - x0)) * 4;
            out.data.set(big.data.subarray(from, from + w * 4), r * w * 4);
        }
        return out;
    },

    // An ImageBitmap with the adjustments (the crop editor's picture)
    async applyBitmap(bmp, adj, opts = {}) {
        if (!this.active(adj)) return bmp;
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        this.applyCanvas(c, adj, opts);
        const out = await createImageBitmap(c);
        c.width = c.height = 0;
        return out;
    }
};
