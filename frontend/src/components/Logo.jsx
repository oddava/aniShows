import React from 'react';

/**
 * The wordmark: AniShows in the display face, led by a small "on air" mark in
 * the signature colour (the light that says an episode is on tonight).
 */
const Logo = ({ showText = true, textClassName = 'text-white', text = 'AniShows' }) => (
    <span className="flex items-center gap-2 group">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px] bg-[var(--signature)] shadow-[0_0_0_3px_rgb(212_246_90/0.14)]" />
        {showText && (
            <span className={`font-display text-[1.55rem] font-extrabold uppercase leading-none tracking-[0.02em] ${textClassName}`}>
                {text}
            </span>
        )}
    </span>
);

export default Logo;
