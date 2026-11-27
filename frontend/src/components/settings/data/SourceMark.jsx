/**
 * A site's own logo (MyAnimeList, AniList) in a rounded tile, so the two are
 * told apart at a glance. Inline SVG: no request, crisp at any size.
 */
function MyAnimeListLogo() {
    return (
        <svg viewBox="0 0 192 192" className="h-full w-full" aria-hidden="true" focusable="false">
            <rect width="192" height="192" fill="#2f52a2" />
            <g fill="#fff">
                <polygon points="9.8 124.96 9.8 57.81 25.93 57.81 40.27 78.35 54.7 57.81 70.92 57.81 70.92 124.96 54.62 124.96 54.62 84.3 40.36 102.8 26.18 84.21 26.18 124.96 9.8 124.96" />
                <path d="M132,57.48h-14.13c-5.73,0-25.68,0-34.51,22.03-4.62,11.53-6.88,33.57,6.11,55.01l13.5-9.85s-5.35-7.64-7.55-22.24h20.2l.17,22.24h18.16v-50.76h-18v14.26l-17.15-.17s2.89-16.81,20.08-16.3h17.1l-3.99-14.22h0Z" />
                <polygon points="145.48 57.97 161.65 57.97 161.65 110.56 184.2 110.56 180.51 124.8 145.48 124.8 145.48 57.97" />
            </g>
        </svg>
    );
}

function AniListLogo() {
    return (
        <svg viewBox="0 0 172 172" className="h-full w-full" aria-hidden="true" focusable="false">
            <rect width="172" height="172" fill="#152232" />
            <path
                fill="#02a9ff"
                fillRule="evenodd"
                d="M111.322,111.157 L111.322,41.029 C111.322,37.010 109.105,34.792 105.086,34.792 L91.365,34.792 C87.346,34.792 85.128,37.010 85.128,41.029 C85.128,41.029 85.128,56.337 85.128,74.333 C85.128,75.271 94.165,79.626 94.401,80.547 C101.286,107.449 95.897,128.980 89.370,129.985 C100.042,130.513 101.216,135.644 93.267,132.138 C94.483,117.784 99.228,117.812 112.869,131.610 C112.986,131.729 115.666,137.351 115.833,137.351 C131.170,137.351 148.050,137.351 148.050,137.351 C152.069,137.351 154.286,135.134 154.286,131.115 L154.286,117.394 C154.286,113.375 152.069,111.157 148.050,111.157 L111.322,111.157 Z"
            />
            <path
                fill="#fefefe"
                fillRule="evenodd"
                d="M54.365,34.792 L18.331,137.351 L46.327,137.351 L52.425,119.611 L82.915,119.611 L88.875,137.351 L116.732,137.351 L80.836,34.792 L54.365,34.792 ZM58.800,96.882 L67.531,68.470 L77.094,96.882 L58.800,96.882 Z"
            />
        </svg>
    );
}

const LOGOS = { mal: MyAnimeListLogo, anilist: AniListLogo };

const SIZES = {
    md: 'h-10 w-10 rounded-[10px]',
    sm: 'h-8 w-8 rounded-lg',
    xs: 'h-[18px] w-[18px] rounded-[5px]',
};

export default function SourceMark({ source, size = 'md' }) {
    const Logo = LOGOS[source] ?? MyAnimeListLogo;
    return (
        <span aria-hidden="true" className={`inline-block shrink-0 overflow-hidden ${SIZES[size]}`}>
            <Logo />
        </span>
    );
}
