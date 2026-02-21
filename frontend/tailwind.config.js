/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                dark: {
                    DEFAULT: '#0f0f0f',
                    50: '#262626',
                    100: '#1a1a1a',
                    200: '#171717',
                    300: '#141414',
                    400: '#0f0f0f',
                },
                accent: {
                    DEFAULT: '#8b5cf6',
                    light: '#a78bfa',
                    dark: '#7c3aed',
                },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            },
            keyframes: {
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
                'heart-pulse': {
                    '0%': { transform: 'scale(1)' },
                    '50%': { transform: 'scale(1.2)' },
                    '100%': { transform: 'scale(1)' },
                },
            },
            animation: {
                shimmer: 'shimmer 3s infinite',
                'heart-pulse': 'heart-pulse 0.3s ease-in-out',
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
}
