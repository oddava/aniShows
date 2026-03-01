import { Star, Heart, Clock, Tv, Flame, MessageSquare, TrendingUp, Target } from 'lucide-react';

const MeanScoreBadge = ({ score }) => {
    let colorClass = 'text-gray-400';
    let bgClass = 'bg-gray-500/20';
    let borderClass = 'border-gray-500/30';

    if (score >= 8) {
        colorClass = 'text-emerald-400';
        bgClass = 'bg-emerald-500/20';
        borderClass = 'border-emerald-500/30';
    } else if (score >= 5) {
        colorClass = 'text-yellow-400';
        bgClass = 'bg-yellow-500/20';
        borderClass = 'border-yellow-500/30';
    } else if (score > 0) {
        colorClass = 'text-red-400';
        bgClass = 'bg-red-500/20';
        borderClass = 'border-red-500/30';
    }

    return (
        <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${bgClass} ${colorClass} border ${borderClass}`}>
            <Star className="w-3.5 h-3.5 fill-current" />
            <span>{score > 0 ? score : '-'}</span>
        </div>
    );
};

// Loading skeleton component
function StatsSkeleton() {
    return (
        <div className="mb-8">
            <div className="grid grid-cols-1 gap-4">
                {/* Impact Card Skeleton */}
                <div className="glass rounded-2xl p-6 h-full animate-pulse">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-5 h-5 bg-dark-200 rounded" />
                        <div className="h-4 w-16 bg-dark-200 rounded" />
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl bg-dark-200" />
                            <div>
                                <div className="h-8 w-16 bg-dark-200 rounded mb-1" />
                                <div className="h-4 w-24 bg-dark-200 rounded" />
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                            <div className="w-10 h-10 rounded-lg bg-dark-200" />
                            <div>
                                <div className="h-6 w-12 bg-dark-200 rounded mb-1" />
                                <div className="h-3 w-20 bg-dark-200 rounded" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Stats Skeleton */}
                <div className="glass rounded-2xl p-6 h-full animate-pulse">
                    <div className="flex items-center gap-2 mb-6">
                        <div className="w-5 h-5 bg-dark-200 rounded" />
                        <div className="h-4 w-20 bg-dark-200 rounded" />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
                        {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="bg-dark-100/50 rounded-xl p-4 border border-gray-800">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-8 h-8 rounded-lg bg-dark-200" />
                                    <div className="h-3 w-12 bg-dark-200 rounded" />
                                </div>
                                <div className="h-8 w-16 bg-dark-200 rounded" />
                                <div className="h-3 w-20 bg-dark-200 rounded mt-2" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ProfileStats({ user, isLoading }) {
    if (isLoading) {
        return <StatsSkeleton />;
    }

    if (!user) return null;

  return (
    <div className="mb-8">
      <div className="grid grid-cols-1 gap-4">
        <div className="glass rounded-2xl p-6 relative overflow-hidden group bg-white/60 border-[#b59ac9]/40">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#e85a9c]/10 rounded-full blur-3xl group-hover:bg-[#e85a9c]/20 transition-all duration-500" />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-[#e85a9c]" />
              <h3 className="text-xs font-bold text-[#7a6a8c] uppercase tracking-widest">Impact</h3>
            </div>

            <div className="flex flex-wrap items-center gap-8">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-[#e85a9c]/10 flex items-center justify-center border border-[#e85a9c]/20">
                  <Tv className="w-7 h-7 text-[#e85a9c]" />
                </div>
                <div>
                  <div className="text-3xl font-bold text-[#4a3a5c] leading-none mb-1">{user?.anime_count || 0}</div>
                  <div className="text-xs font-medium text-[#7a6a8c] uppercase tracking-wide">Anime Watched</div>
                </div>
              </div>

              <div className="flex items-center gap-4 p-3 bg-white/40 rounded-xl border border-[#b59ac9]/30">
                <div className="w-12 h-12 rounded-lg bg-[#e85a9c]/10 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-[#e85a9c]" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-[#4a3a5c] leading-none mb-1">{user?.days_watched || 0}</div>
                  <div className="text-xs font-medium text-[#7a6a8c] uppercase tracking-wide">Days Watched</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 bg-white/60 border-[#b59ac9]/40">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-5 h-5 text-[#e85a9c]" />
            <h3 className="text-xs font-bold text-[#7a6a8c] uppercase tracking-widest">Quick Stats</h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded-xl p-4 border border-yellow-500/30 hover:border-yellow-500/50 transition-all group">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                  <Flame className="w-4 h-4 text-yellow-600" />
                </div>
                <span className="text-[11px] uppercase tracking-wider text-[#7a6a8c] font-bold">Points</span>
              </div>
              <div className="text-2xl font-bold text-[#4a3a5c] group-hover:text-yellow-600 transition-colors">
                {user?.points || 0}
              </div>
              <div className="text-[10px] text-[#8a7a9c] mt-1 uppercase font-medium">Total earned</div>
            </div>

            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-xl p-4 border border-emerald-500/30 hover:border-emerald-500/50 transition-all">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Star className="w-4 h-4 text-emerald-600" />
                </div>
                <span className="text-[11px] uppercase tracking-wider text-[#7a6a8c] font-bold">Score</span>
              </div>
              <div className="flex items-center gap-2">
                <MeanScoreBadge score={user?.mean_score || 0} />
              </div>
              <div className="text-[10px] text-[#8a7a9c] mt-2 uppercase font-medium">Average</div>
            </div>

            <div className="bg-gradient-to-br from-pink-500/10 to-rose-500/10 rounded-xl p-4 border border-pink-500/30 hover:border-pink-500/50 transition-all">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                  <Heart className="w-4 h-4 text-pink-600" />
                </div>
                <span className="text-[11px] uppercase tracking-wider text-[#7a6a8c] font-bold">Favs</span>
              </div>
              <div className="text-2xl font-bold text-[#4a3a5c]">{user?.favorites_count || 0}</div>
              <div className="text-[10px] text-[#8a7a9c] mt-1 uppercase font-medium">Saved</div>
            </div>

            <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-xl p-4 border border-blue-500/30 hover:border-blue-500/50 transition-all">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-[11px] uppercase tracking-wider text-[#7a6a8c] font-bold">Reviews</span>
              </div>
              <div className="text-2xl font-bold text-[#4a3a5c]">{user?.reviews_count || 0}</div>
              <div className="text-[10px] text-[#8a7a9c] mt-1 uppercase font-medium">Written</div>
            </div>
          </div>
        </div>
            </div>
        </div>
    );
}

export { MeanScoreBadge };
