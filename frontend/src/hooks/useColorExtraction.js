import { useMemo, useEffect, useState } from 'react';

/**
 * Custom hook to extract dominant colors from an image URL
 * Uses Canvas API to sample colors and find the dominant palette
 * @param {string} imageUrl - The URL of the image to extract colors from
 * @returns {Object} - { colors, isLoading, error }
 */
export default function useColorExtraction(imageUrl) {
    const [colors, setColors] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!imageUrl) {
            setColors(null);
            return;
        }

        const extractColors = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const img = new Image();
                img.crossOrigin = 'anonymous';

                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = imageUrl;
                });

                // Create canvas and draw image
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const sampleSize = 50; // Sample a 50x50 area for performance

                canvas.width = sampleSize;
                canvas.height = sampleSize;
                ctx.drawImage(img, 0, 0, sampleSize, sampleSize);

                // Get image data
                const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
                const pixels = imageData.data;

                // Simple color averaging with weighted sampling
                const colorCounts = {};

                for (let i = 0; i < pixels.length; i += 4) {
                    const r = pixels[i];
                    const g = pixels[i + 1];
                    const b = pixels[i + 2];
                    const a = pixels[i + 3];

                    // Skip transparent pixels
                    if (a < 128) continue;

                    // Skip very dark or very light pixels
                    const brightness = (r + g + b) / 3;
                    if (brightness < 30 || brightness > 225) continue;

                    // Quantize colors to reduce variations
                    const key = `${Math.round(r / 32) * 32},${Math.round(g / 32) * 32},${Math.round(b / 32) * 32}`;
                    colorCounts[key] = (colorCounts[key] || 0) + 1;
                }

                // Sort colors by frequency and extract top colors
                const sortedColors = Object.entries(colorCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([color]) => {
                        const [r, g, b] = color.split(',').map(Number);
                        return { r, g, b, hex: rgbToHex(r, g, b), hsl: rgbToHsl(r, g, b) };
                    });

                if (sortedColors.length > 0) {
                    // Find the most vibrant color (highest saturation)
                    const vibrantColor = sortedColors.reduce((prev, curr) =>
                        curr.hsl.s > prev.hsl.s ? curr : prev
                    );

                    setColors({
                        primary: vibrantColor.hex,
                        secondary: sortedColors[1]?.hex || vibrantColor.hex,
                        accent: adjustBrightness(vibrantColor.hex, 20),
                        palette: sortedColors.map(c => c.hex)
                    });
                } else {
                    // Fallback to default purple
                    setColors({
                        primary: '#8b5cf6',
                        secondary: '#a855f7',
                        accent: '#a78bfa',
                        palette: ['#8b5cf6', '#a855f7', '#ec4899']
                    });
                }
            } catch (err) {
                console.warn('Color extraction failed:', err);
                setError(err);
                // Fallback to default theme
                setColors({
                    primary: '#8b5cf6',
                    secondary: '#a855f7',
                    accent: '#a78bfa',
                    palette: ['#8b5cf6', '#a855f7', '#ec4899']
                });
            } finally {
                setIsLoading(false);
            }
        };

        extractColors();
    }, [imageUrl]);

    return { colors, isLoading, error };
}

// Helper: RGB to Hex
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Helper: RGB to HSL
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

// Helper: Adjust brightness of hex color
function adjustBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, Math.max(0, (num >> 16) + amt));
    const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
    const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}
