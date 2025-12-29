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
        },
    },
    plugins: [],
}
