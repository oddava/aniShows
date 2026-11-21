import { Star } from 'lucide-react';

/**
 * Small poster overlays and inline tags. `tone="overlay"` sits on cover art
 * (dark glass, always readable); `tone="muted"` sits on surfaces.
 */
export default function Badge({ children, tone = 'muted', className = '', title }) {
    const tones = {
        overlay: 'bg-[rgb(11_13_16/0.82)] text-white backdrop-blur-sm',
        muted: 'bg-white/[0.06] text-gray-300',
        signature: 'bg-[var(--signature)] text-[var(--on-signature)]',
    };
    return (
        <span
            title={title}
            className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 h-6 text-xs font-semibold tabular ${tones[tone] || tones.muted} ${className}`}
        >
            {children}
        </span>
    );
}

/** "★ 9": the viewer's own score. */
export function ScoreBadge({ score, tone = 'overlay', className = '' }) {
    if (!score) return null;
    return (
        <Badge tone={tone} className={className} title={`Your score: ${score}`}>
            <Star aria-hidden="true" className="h-3 w-3 fill-[var(--status-on-hold)] text-[var(--status-on-hold)]" />
            <span className="sr-only">Your score </span>
            {score}
        </Badge>
    );
}
