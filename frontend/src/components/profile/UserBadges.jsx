import React from 'react';
import { Award, Shield, Star, Zap, Crown } from 'lucide-react';

const ICON_MAP = {
    'award': Award,
    'shield': Shield,
    'star': Star,
    'zap': Zap,
    'crown': Crown,
};

// Only the icon carries the badge's colour; the chip itself stays neutral.
const COLOR_MAP = {
    'blue': 'text-[var(--signature)]',
    'green': 'text-[var(--status-watching)]',
    'yellow': 'text-[var(--status-on-hold)]',
    'purple': 'text-[var(--status-completed)]',
    'amber': 'text-[var(--status-on-hold)]',
    'red': 'text-[var(--status-dropped)]',
};

export default function UserBadges({ user, className = '' }) {
    // Retired badges (is_active false) are never shown, even if a stale payload carries one.
    const badges = (user?.badges || []).filter((badge) => badge && badge.is_active !== false);
    if (badges.length === 0) return null;

    return (
        <div className={`flex flex-wrap items-center gap-2 ${className}`}>
            {badges.map((badge, index) => {
                const Icon = ICON_MAP[badge.icon] || Award;
                const colorClasses = COLOR_MAP[badge.color] || COLOR_MAP['blue'];

                return (
                    <div
                        key={badge.id || index}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-[13px] text-[var(--text-2)]"
                        title={badge.description}
                    >
                        {badge.image ? (
                            <img src={badge.image} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover" />
                        ) : (
                            <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${colorClasses}`} />
                        )}
                        <span className="whitespace-nowrap">{badge.name}</span>
                    </div>
                );
            })}
        </div>
    );
}
