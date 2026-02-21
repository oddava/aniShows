import { Star, Award, Trophy, Zap } from 'lucide-react';

const getUserBadges = (user) => {
    const badges = [];

    if (user?.reviews_count >= 10) {
        badges.push({ icon: Star, label: 'Top Reviewer', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30' });
    }
    if (user?.anime_count >= 100) {
        badges.push({ icon: Zap, label: 'Power User', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/30' });
    }
    if (user?.anime_count >= 50) {
        badges.push({ icon: Trophy, label: 'Completionist', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' });
    }
    if (user?.is_early_adopter) {
        badges.push({ icon: Award, label: 'Early Adopter', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/30' });
    }

    return badges.slice(0, 3);
};

export default function UserBadges({ user }) {
    const badges = getUserBadges(user);

    if (badges.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
            {badges.map((badge, index) => {
                const Icon = badge.icon;
                return (
                    <div
                        key={index}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.color} border ${badge.border}`}
                        title={badge.label}
                    >
                        <Icon className="w-3 h-3" />
                        <span>{badge.label}</span>
                    </div>
                );
            })}
        </div>
    );
}

export { getUserBadges };
