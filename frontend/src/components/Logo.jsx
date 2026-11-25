import React from 'react';

const Logo = ({ showText = true, textClassName = 'text-[var(--text-1)]', text = 'AniShows' }) => (
    showText ? (
        <span className="inline-flex items-center gap-2">
            <img src="/anishows-mark.png" alt="" width="20" height="20" className="shrink-0" />
            <span className={`text-[1.1875rem] font-semibold leading-none tracking-[-0.02em] ${textClassName}`}>
                {text}
            </span>
        </span>
    ) : null
);

export default Logo;
