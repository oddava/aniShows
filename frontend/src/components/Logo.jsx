import React, { useId } from 'react';

const Logo = ({ className = "w-10 h-10", showText = true, textClassName = "text-xl font-bold text-white", text = "AniShows" }) => {
    const logoId = useId().replace(/:/g, '');
    const neonGradientId = `${logoId}-neonPurple`;
    const darkGradientId = `${logoId}-darkPurple`;

    return (
        <div className="flex items-center gap-2.5 group">
            <svg
                viewBox="0 0 120 120"
                xmlns="http://www.w3.org/2000/svg"
                className={`${className} transition-all duration-300`}
            >
                <defs>
                    <linearGradient id={neonGradientId} x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#7B1FA2" />
                        <stop offset="50%" stopColor="#B388FF" />
                        <stop offset="100%" stopColor="#EA80FC" />
                    </linearGradient>

                    <linearGradient id={darkGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#4A148C" />
                        <stop offset="100%" stopColor="#210F40" />
                    </linearGradient>
                </defs>

                <g transform="translate(10, 5)">
                    <path d="M48 25 L22 85 L42 85 L68 25 Z" fill={`url(#${darkGradientId})`} />

                    <path d="M48 25 L88 85 L68 85 L36 40 Z" fill={`url(#${neonGradientId})`} />

                    <rect x="30" y="62" width="45" height="8" rx="4" fill="#311B92" />
                    <rect x="30" y="62" width="28" height="8" rx="4" fill="#EA80FC" />
                </g>
            </svg>
            {showText && (
                <span className={textClassName}>
                    {text}
                </span>
            )}
        </div>
    );
};

export default Logo;
