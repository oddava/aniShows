import { useEffect, useState } from 'react';
import { isSameOriginImageUrl } from '../utils/imageUtils';

const accentColorCache = new Map();

function extractImageColor(imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 1;
                canvas.height = 1;
                ctx.drawImage(img, 0, 0, 1, 1);
                const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                resolve({ r, g, b });
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
    });
}

function rgbToAccentColor({ r, g, b }) {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h = 0;
    let s = 0;
    let l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rNorm:
                h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
                break;
            case gNorm:
                h = (bNorm - rNorm) / d + 2;
                break;
            case bNorm:
                h = (rNorm - gNorm) / d + 4;
                break;
            default:
                break;
        }
        h /= 6;
    }

    const minLightness = 0.45;
    const maxLightness = 0.65;
    const minSaturation = 0.3;

    l = Math.max(minLightness, Math.min(maxLightness, l));
    if (s > 0) {
        s = Math.max(minSaturation, s);
    }

    let finalR;
    let finalG;
    let finalB;
    if (s === 0) {
        finalR = finalG = finalB = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        finalR = hue2rgb(p, q, h + 1 / 3);
        finalG = hue2rgb(p, q, h);
        finalB = hue2rgb(p, q, h - 1 / 3);
    }

    const toHex = (channel) => Math.round(channel * 255).toString(16).padStart(2, '0');
    return `#${toHex(finalR)}${toHex(finalG)}${toHex(finalB)}`;
}

export default function useAnimeAccentColor(...imageCandidates) {
    const cacheKey = JSON.stringify(imageCandidates.filter(isSameOriginImageUrl));
    const [accentColor, setAccentColor] = useState(null);

    useEffect(() => {
        const safeCandidates = JSON.parse(cacheKey);

        if (!safeCandidates.length) {
            setAccentColor(null);
            return;
        }

        let isCancelled = false;

        async function extractAccentColor() {
            for (const imageUrl of safeCandidates) {
                if (accentColorCache.has(imageUrl)) {
                    if (!isCancelled) {
                        setAccentColor(accentColorCache.get(imageUrl));
                    }
                    return;
                }

                try {
                    const color = rgbToAccentColor(await extractImageColor(imageUrl));
                    accentColorCache.set(imageUrl, color);
                    if (!isCancelled) {
                        setAccentColor(color);
                    }
                    return;
                } catch {
                    // Try the next candidate.
                }
            }

            if (!isCancelled) {
                setAccentColor(null);
            }
        }

        extractAccentColor();

        return () => {
            isCancelled = true;
        };
    }, [cacheKey]);

    return accentColor;
}
