import { useState } from 'react';

/**
 * Inline spoiler shared by forum markdown (`||x||`, `>!x!<`) and review text.
 *
 * A real `<button aria-expanded>` so it is reachable with Tab and toggles with
 * Enter/Space. Until it is revealed the hidden text is not rendered at all, so it
 * never reaches the accessibility tree (or text selection, or copy). Colour changes
 * only; `motion-reduce` drops the transition.
 */
export default function Spoiler({ children, className = '' }) {
    const [revealed, setRevealed] = useState(false);

    const toggle = (event) => {
        // A spoiler inside a clickable card must not trigger the card.
        event.stopPropagation();
        setRevealed((value) => !value);
    };

    return (
        <button
            type="button"
            onClick={toggle}
            aria-expanded={revealed}
            aria-label={revealed ? undefined : 'Spoiler, activate to reveal'}
            className={`inline align-baseline rounded px-1 mx-0.5 text-left font-[inherit] text-[length:inherit] leading-[inherit] transition-colors duration-200 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                revealed
                    ? 'bg-gray-800/80 text-gray-200 cursor-text'
                    : 'bg-gray-800 text-gray-500 cursor-pointer hover:bg-gray-700'
            } ${className}`}
        >
            {revealed ? children : <span aria-hidden="true">Spoiler</span>}
        </button>
    );
}
