import React, { useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import './SakuraAnimation.css';

const SakuraPetal = ({ style, id }) => (
    <svg
        className="sakura-petal"
        style={style}
        width="16"
        height="16"
        viewBox="0 0 30 30"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        <defs>
            <linearGradient id={`sakura-grad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffb7c5" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#ff8da1" stopOpacity="0.6" />
            </linearGradient>
        </defs>
        <path
            d="M15 0C20 0 26 5 26 12C26 21 16 26 15 30C14 26 4 21 4 12C4 5 10 0 15 0Z"
            fill={`url(#sakura-grad-${id})`}
        />
    </svg>
);

const SakuraAnimation = ({ count = 35 }) => {
    const petals = useMemo(() => {
        return Array.from({ length: count }).map((_, i) => {
            // Randomize size between 0.4 and 1x
            const size = Math.random() * 0.6 + 0.4;
            // Randomize horizontal start position
            const left = Math.random() * 100;
            // Setup animation durations
            const animationDurationFall = Math.random() * 10 + 10;
            const animationDurationSway = Math.random() * 4 + 4;
            // Start them all at different offset cycles so they don't fall as a line
            const animationDelayFall = Math.random() * -20;
            const animationDelaySway = Math.random() * -10;
            // Some sway left, some sway right
            const swayType = Math.random() > 0.5 ? 'sway-left' : 'sway-right';

            return {
                id: i,
                style: {
                    left: `${left}vw`,
                    transform: `scale(${size})`,
                    animationName: `fall, ${swayType}`,
                    animationDuration: `${animationDurationFall}s, ${animationDurationSway}s`,
                    animationDelay: `${animationDelayFall}s, ${animationDelaySway}s`,
                }
            };
        });
    }, [count]);

    return (
        <div className="sakura-container" aria-hidden="true">
            {petals.map(petal => (
                <SakuraPetal key={petal.id} id={petal.id} style={petal.style} />
            ))}
        </div>
    );
};

export default SakuraAnimation;
