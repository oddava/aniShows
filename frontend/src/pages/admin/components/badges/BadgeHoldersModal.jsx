import { ChevronLeft, ChevronRight, UserMinus, Users } from 'lucide-react';

/** The badge holders modal: paged list with per-holder revoke. */
export default function BadgeHoldersModal({
    selectedBadge,
    setSelectedBadge,
    setIsHoldersModalOpen,
    holdersData,
    holdersLoading,
    holdersPage,
    setHoldersPage,
    revokingUserIds,
    setRevokingUserIds,
    revokeMutation,
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-dark-200 border border-dark-300 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-6 border-b border-dark-300 shrink-0">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Users className="w-5 h-5 text-accent" />
                        Holders: {selectedBadge.name}
                    </h2>
                    <button
                        onClick={() => {
                            setIsHoldersModalOpen(false);
                            setSelectedBadge(null);
                            setRevokingUserIds(new Set());
                        }}
                        className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors"
                    >
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {holdersLoading ? (
                        <div className="text-center text-gray-400 py-8">Loading holders...</div>
                    ) : !holdersData?.data?.results?.length ? (
                        <div className="text-center text-gray-400 py-8">No one holds this badge yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {holdersData.data.results.map((holder) => (
                                <div
                                    key={holder.id}
                                    className="flex items-center gap-3 p-3 bg-dark-100 border border-dark-300 rounded-lg group"
                                >
                                    {holder.user.avatar ? (
                                        <img
                                            src={holder.user.avatar}
                                            alt={holder.user.username}
                                            className="w-9 h-9 rounded-full object-cover shrink-0"
                                        />
                                    ) : (
                                        <div className="w-9 h-9 rounded-full bg-dark-300 flex items-center justify-center shrink-0">
                                            <span className="text-sm text-gray-300">
                                                {holder.user.username[0].toUpperCase()}
                                            </span>
                                        </div>
                                    )}

                                    <div className="flex-1 min-w-0">
                                        <div className="text-white font-medium truncate">
                                            {holder.user.username}
                                        </div>
                                        <div className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                                            <span>
                                                Granted {new Date(holder.granted_at).toLocaleDateString()}
                                            </span>
                                            {holder.granted_by && (
                                                <span>by {holder.granted_by.username}</span>
                                            )}
                                            {holder.reason && (
                                                <span className="text-gray-500">— {holder.reason}</span>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            if (window.confirm(`Revoke "${selectedBadge.name}" from ${holder.user.username}?`)) {
                                                setRevokingUserIds(prev => new Set([...prev, holder.user.id]));
                                                revokeMutation.mutate({
                                                    badgeId: selectedBadge.id,
                                                    userIds: [holder.user.id],
                                                });
                                            }
                                        }}
                                        disabled={revokingUserIds.has(holder.user.id) || revokeMutation.isPending}
                                        className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 shrink-0"
                                        title={`Revoke from ${holder.user.username}`}
                                    >
                                        <UserMinus className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {holdersData?.data && (holdersData.data.next || holdersData.data.previous) && (
                    <div className="flex items-center justify-between p-4 border-t border-dark-300 shrink-0">
                        <button
                            onClick={() => setHoldersPage(p => Math.max(1, p - 1))}
                            disabled={!holdersData.data.previous}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            Previous
                        </button>
                        <span className="text-sm text-gray-400">
                            Page {holdersPage} — {holdersData.data.count} holder{holdersData.data.count !== 1 ? 's' : ''} total
                        </span>
                        <button
                            onClick={() => setHoldersPage(p => p + 1)}
                            disabled={!holdersData.data.next}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            Next
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {revokeMutation.isError && (
                    <div className="px-6 pb-4">
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                            Failed to revoke badge. Please try again.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
