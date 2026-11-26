// The dominant colour of a cover, tuned to be readable as text on the dark
// page. Cards use it to tint their title on hover.
//
// Sampling happens lazily (first hover or focus) from the <img> the card has
// already loaded, so a grid of covers costs nothing until someone points at
// one. Covers served from another origin without CORS taint the canvas; for
// those we try one anonymous CORS fetch and otherwise give up (null), and the
// card keeps its plain hover colour.

const SAMPLE_W = 24;
const SAMPLE_H = 36;
const HUE_BINS = 24;

// url -> '#rrggbb' | null (null: no usable colour, don't retry).
const cache = new Map();
const pending = new Map();

function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    return [h / 6, s, l];
}

function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
    return `#${toHex(hue2rgb(p, q, h + 1 / 3))}${toHex(hue2rgb(p, q, h))}${toHex(hue2rgb(p, q, h - 1 / 3))}`;
}

/**
 * The dominant colour of RGBA pixel data, lifted to a readable text colour
 * on a dark background. Picks the hue band with the most colourful pixels
 * (weighted by saturation), averages that band, then clamps lightness and
 * saturation. Returns null when the image is essentially greyscale.
 *
 * @param {Uint8ClampedArray|number[]} data RGBA bytes
 * @returns {string|null} '#rrggbb'
 */
export function dominantTextColor(data) {
    const weight = new Float64Array(HUE_BINS);
    const sumR = new Float64Array(HUE_BINS);
    const sumG = new Float64Array(HUE_BINS);
    const sumB = new Float64Array(HUE_BINS);
    let colourful = 0;
    let total = 0;

    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        total += 1;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const [h, s, l] = rgbToHsl(r, g, b);
        // Skip near-black, near-white and grey pixels: they are not "the colour".
        if (s < 0.22 || l < 0.12 || l > 0.9) continue;
        colourful += 1;
        const bin = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS));
        // Favour vivid mid-tones over washed-out or murky ones.
        const w = s * (1 - Math.abs(l - 0.5));
        weight[bin] += w;
        sumR[bin] += r * w;
        sumG[bin] += g * w;
        sumB[bin] += b * w;
    }

    // Too few coloured pixels: a monochrome cover. Let the card keep its default.
    if (!total || colourful / total < 0.04) return null;

    let best = 0;
    for (let i = 1; i < HUE_BINS; i += 1) {
        if (weight[i] > weight[best]) best = i;
    }
    // Merge the neighbouring bands so a hue on a bin edge isn't split in two.
    let w = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const off of [-1, 0, 1]) {
        const i = (best + off + HUE_BINS) % HUE_BINS;
        w += weight[i];
        r += sumR[i];
        g += sumG[i];
        b += sumB[i];
    }
    if (w <= 0) return null;

    const [h, s, l] = rgbToHsl(r / w, g / w, b / w);
    // Readable on the near-black page: light, but still clearly coloured.
    const outS = Math.min(0.9, Math.max(0.55, s));
    const outL = Math.min(0.8, Math.max(0.7, l));
    return hslToHex(h, outS, outL);
}

function sampleImage(img) {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
    // Throws a SecurityError when the image is cross-origin without CORS.
    return dominantTextColor(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
}

function loadWithCors(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('cover failed to load with CORS'));
        img.src = url;
    });
}

/** The cached colour for a cover key, or undefined when it hasn't been sampled yet. */
export function cachedCoverAccent(key) {
    return key ? cache.get(key) : undefined;
}

/**
 * Resolve the hover colour for a cover. Uses the already-loaded <img> when it
 * can, so there's no extra request in the common (same-origin) case.
 *
 * @param {HTMLImageElement|null} img the card's loaded cover
 * @param {string} [key] stable cache key for this cover (defaults to the
 *   image URL); cards pass their cover URL so the srcset pick doesn't matter
 * @returns {Promise<string|null>}
 */
export function coverAccent(img, key) {
    const url = img?.currentSrc || img?.src;
    const cacheKey = key || url;
    if (!url || typeof document === 'undefined') return Promise.resolve(null);
    if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
    if (pending.has(cacheKey)) return pending.get(cacheKey);

    const job = (async () => {
        let color = null;
        try {
            if (img.complete && img.naturalWidth > 0) {
                color = sampleImage(img);
            } else {
                color = sampleImage(await loadWithCors(url));
            }
        } catch {
            // Tainted canvas: try a CORS copy once. The browser cache usually
            // can't reuse the non-CORS response, so this is a real (small) fetch.
            try {
                color = sampleImage(await loadWithCors(url));
            } catch {
                color = null;
            }
        }
        cache.set(cacheKey, color);
        pending.delete(cacheKey);
        return color;
    })();
    pending.set(cacheKey, job);
    return job;
}
