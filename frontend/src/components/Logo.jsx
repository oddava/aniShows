import React from 'react';

/** The wordmark, set like oddava.me's header: plain DM Sans, no badge. */
const Logo = ({ showText = true, textClassName = 'text-[var(--text-1)]', text = 'AniShows' }) => (
    showText ? (
        <span className={`text-[1.1875rem] font-semibold leading-none tracking-[-0.02em] ${textClassName}`}>
            {text}
        </span>
    ) : null
);

export default Logo;
