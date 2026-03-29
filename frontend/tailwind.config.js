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
                    DEFAULT: 'var(--color-dark)',
                    50: 'var(--color-dark-50)',
                    100: 'var(--color-dark-100)',
                    200: 'var(--color-dark-200)',
                    300: 'var(--color-dark-300)',
                    400: 'var(--color-dark-400)',
                },
                accent: {
                    DEFAULT: 'var(--color-accent)',
                    light: 'var(--color-accent-light)',
                    dark: 'var(--color-accent-dark)',
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
