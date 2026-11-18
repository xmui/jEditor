// How far apart two colours look: CIEDE2000 (ΔE00), on sRGB pixels, in
// CIELAB under D65. Under 1 can't be seen; 2–3 is a near match; 10 and
// more is a different colour.

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

function lab(r, g, b) {
    const R = toLinear(r / 255), G = toLinear(g / 255), B = toLinear(b / 255);
    const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    const Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
    const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Sharma, Wu and Dalal (2005)'s statement of it
function de2000([L1, a1, b1], [L2, a2, b2]) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7))));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hp = (b, a) => { if (a === 0 && b === 0) return 0; const t = Math.atan2(b, a) * deg; return t >= 0 ? t : t + 360; };
    const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
    const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
    let hpm = h1p + h2p;
    if (C1p * C2p !== 0) {
        if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2;
        else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    }
    const T = 1 - 0.17 * Math.cos((hpm - 30) * rad) + 0.24 * Math.cos(2 * hpm * rad) + 0.32 * Math.cos((3 * hpm + 6) * rad) - 0.2 * Math.cos((4 * hpm - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hpm - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(Cpm, 7) / (Math.pow(Cpm, 7) + Math.pow(25, 7)));
    const SL = 1 + (0.015 * Math.pow(Lpm - 50, 2)) / Math.sqrt(20 + Math.pow(Lpm - 50, 2));
    const SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T;
    const RT = -Math.sin(2 * dTheta * rad) * RC;
    return Math.sqrt(Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2) + RT * (dCp / SC) * (dHp / SH));
}

// The mean ΔE00 between two pictures of the same size
function meanDE(a, b) {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
        s += de2000(lab(a[i], a[i + 1], a[i + 2]), lab(b[i], b[i + 1], b[i + 2]));
        n++;
    }
    return s / n;
}

module.exports = { lab, de2000, meanDE };
