import React from 'react';
import { Award, Shield, Star, Zap, Crown } from 'lucide-react';

const ICON_MAP = {
    'award': Award,
    'shield': Shield,
    'star': Star,
    'zap': Zap,
    'crown': Crown,
};

const COLOR_MAP = {
    'blue': 'text-blue-400 bg-blue-500/20 border-blue-500/30',
    'green': 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
    'yellow': 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30',
    'purple': 'text-purple-400 bg-purple-500/20 border-purple-500/30',
    'amber': 'text-amber-400 bg-amber-500/20 border-amber-500/30',
    'red': 'text-red-400 bg-red-500/20 border-red-500/30',
};

export default function UserBadges({ user }) {
    if (!user || !user.badges || user.badges.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
            {user.badges.map((badge, index) => {
                const Icon = ICON_MAP[badge.icon] || Award;
                const colorClasses = COLOR_MAP[badge.color] || COLOR_MAP['blue'];

                return (
                    <div
                        key={badge.id || index}
                        className={`inline-flex items-center shrink-0 gap-1.5 px-2 py-1 rounded-full text-xs font-medium border ${colorClasses}`}
                        title={badge.description}
                    >
                        {badge.image ? (
                            <img src={badge.image} alt={badge.name} className="w-3 h-3 rounded-sm object-cover shrink-0" />
                        ) : (
                            <Icon className="w-3 h-3 shrink-0" />
                        )}
                        <span className="whitespace-nowrap">{badge.name}</span>
                    </div>
                );
            })}
        </div>
    );
}
