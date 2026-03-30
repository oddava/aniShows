const DEFAULT_PROFILE_PRIMARY_COLOR = '#8b5cf6';

export function normalizeProfilePrimaryColor(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_PROFILE_PRIMARY_COLOR;
}

export function adjustHexBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const red = Math.min(255, Math.max(0, (num >> 16) + amt));
    const green = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
    const blue = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
    return `#${(0x1000000 + red * 0x10000 + green * 0x100 + blue).toString(16).slice(1)}`;
}

function hexToRgb(hex) {
    const normalized = normalizeProfilePrimaryColor(hex).replace('#', '');
    return {
        red: parseInt(normalized.slice(0, 2), 16) / 255,
        green: parseInt(normalized.slice(2, 4), 16) / 255,
        blue: parseInt(normalized.slice(4, 6), 16) / 255,
    };
}

function rgbToHsl({ red, green, blue }) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;

    if (max === min) {
        return { hue: 0, saturation: 0, lightness };
    }

    const delta = max - min;
    const saturation = lightness > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min);

    let hue;
    switch (max) {
        case red:
            hue = (green - blue) / delta + (green < blue ? 6 : 0);
            break;
        case green:
            hue = (blue - red) / delta + 2;
            break;
        default:
            hue = (red - green) / delta + 4;
            break;
    }

    return { hue: hue / 6, saturation, lightness };
}

function hueToRgb(p, q, t) {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
}

function hslToHex({ hue, saturation, lightness }) {
    let red;
    let green;
    let blue;

    if (saturation === 0) {
        red = lightness;
        green = lightness;
        blue = lightness;
    } else {
        const q = lightness < 0.5
            ? lightness * (1 + saturation)
            : lightness + saturation - lightness * saturation;
        const p = 2 * lightness - q;
        red = hueToRgb(p, q, hue + 1 / 3);
        green = hueToRgb(p, q, hue);
        blue = hueToRgb(p, q, hue - 1 / 3);
    }

    const toHex = (channel) => Math.round(channel * 255).toString(16).padStart(2, '0');
    return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function toneProfileAccentColor(value) {
    const normalized = normalizeProfilePrimaryColor(value);
    const hsl = rgbToHsl(hexToRgb(normalized));

    const toned = {
        hue: hsl.hue,
        saturation: Math.min(hsl.saturation, 0.82),
        lightness: Math.min(hsl.lightness, 0.64),
    };

    return hslToHex(toned);
}

export function getProfileAccentTheme(value) {
    const baseColor = toneProfileAccentColor(value);
    return {
        baseColor,
        lightColor: adjustHexBrightness(baseColor, 18),
        darkColor: adjustHexBrightness(baseColor, -18),
    };
}

export { DEFAULT_PROFILE_PRIMARY_COLOR };
