import { Star, Heart, Clock, Tv, Flame, MessageSquare, Target } from 'lucide-react';

const MeanScoreBadge = ({ score }) => {
    let tone = 'text-gray-300 border-gray-600 bg-dark-50';

    if (score >= 8) {
        tone = 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    } else if (score >= 5) {
        tone = 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10';
    } else if (score > 0) {
        tone = 'text-red-400 border-red-500/40 bg-red-500/10';
    }

    return (
        <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold ${tone}`}>
            <Star className="h-3.5 w-3.5 fill-current" />
            <span>{score > 0 ? score : '-'}</span>
        </div>
    );
};

function StatsSkeleton() {
    return (
        <div className="mb-8 space-y-4">
            <div className="ui-card animate-pulse">
                <div className="mb-5 h-4 w-32 rounded bg-dark-200" />
                <div className="grid gap-3 sm:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="rounded-lg border border-gray-800 bg-dark-200 p-4">
                            <div className="h-3 w-20 rounded bg-dark-300" />
                            <div className="mt-3 h-7 w-16 rounded bg-dark-300" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="ui-card animate-pulse">
                <div className="mb-5 h-4 w-28 rounded bg-dark-200" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="rounded-lg border border-gray-800 bg-dark-200 p-4">
                            <div className="h-3 w-16 rounded bg-dark-300" />
                            <div className="mt-3 h-6 w-12 rounded bg-dark-300" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatTile({ icon: Icon, label, value, tone = 'text-accent' }) {
    return (
        <div className="rounded-lg border border-gray-800 bg-dark-200 p-4">
            <div className="mb-3 flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-dark-50 text-gray-300">
                    <Icon className="h-4 w-4" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
            </div>
            <div className={`text-2xl font-bold leading-none ${tone}`}>{value}</div>
        </div>
    );
}

export default function ProfileStats({ user, isLoading }) {
    if (isLoading) return <StatsSkeleton />;
    if (!user) return null;

    return (
        <div className="mb-8 space-y-4">
            <div className="ui-card">
                <div className="mb-4 flex items-center gap-2">
                    <Target className="h-4 w-4 text-accent" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Watching Summary</h3>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-gray-800 bg-dark-200 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Anime Watched</p>
                        <p className="mt-2 text-3xl font-bold text-white">{user?.anime_count || 0}</p>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-dark-200 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Days Watched</p>
                        <p className="mt-2 text-3xl font-bold text-white">{user?.days_watched || 0}</p>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-dark-200 p-4">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Mean Score</p>
                        <MeanScoreBadge score={user?.mean_score || 0} />
                    </div>
                </div>
            </div>

            <div className="ui-card">
                <div className="mb-4 flex items-center gap-2">
                    <Tv className="h-4 w-4 text-accent" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Quick Stats</h3>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatTile icon={Flame} label="Points" value={user?.points || 0} tone="text-yellow-400" />
                    <StatTile icon={Heart} label="Favorites" value={user?.favorites_count || 0} tone="text-pink-400" />
                    <StatTile icon={MessageSquare} label="Reviews" value={user?.reviews_count || 0} tone="text-blue-400" />
                    <StatTile icon={Clock} label="Hours" value={Math.round((user?.days_watched || 0) * 24)} tone="text-accent" />
                </div>
            </div>
        </div>
    );
}

export { MeanScoreBadge };
