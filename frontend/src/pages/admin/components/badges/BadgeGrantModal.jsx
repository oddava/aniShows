import { UserPlus } from 'lucide-react';

/** The grant-badge modal: user search, selected users and a reason. */
export default function BadgeGrantModal({
    selectedBadge,
    handleGrant,
    setIsGrantModalOpen,
    searchUserTerm,
    setSearchUserTerm,
    usersData,
    selectedUsers,
    setSelectedUsers,
    grantReason,
    setGrantReason,
    grantMutation,
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-dark-200 border border-dark-300 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-6 border-b border-dark-300 shrink-0">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <UserPlus className="w-5 h-5 text-accent" />
                        Grant: {selectedBadge.name}
                    </h2>
                    <button
                        onClick={() => {
                            setIsGrantModalOpen(false);
                            setSelectedUsers([]);
                        }}
                        className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors"
                    >
                        ✕
                    </button>
                </div>
                
                <form onSubmit={handleGrant} className="p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Search Users</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Type username..."
                                value={searchUserTerm}
                                onChange={(e) => setSearchUserTerm(e.target.value)}
                                className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                            />
                            
                            {searchUserTerm.length >= 2 && usersData?.data?.results && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-dark-100 border border-dark-300 rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                                    {usersData.data.results.map(u => (
                                        <button
                                            key={u.id}
                                            type="button"
                                            onClick={() => {
                                                if (!selectedUsers.find(su => su.id === u.id)) {
                                                    setSelectedUsers([...selectedUsers, u]);
                                                }
                                                setSearchUserTerm('');
                                            }}
                                            className="w-full text-left px-4 py-2 hover:bg-dark-300 text-white flex items-center gap-2"
                                        >
                                            {u.avatar ? (
                                                <img src={u.avatar} className="w-6 h-6 rounded-full object-cover" />
                                            ) : (
                                                <div className="w-6 h-6 rounded-full bg-dark-300 flex items-center justify-center">
                                                    <span className="text-xs">{u.username[0].toUpperCase()}</span>
                                                </div>
                                            )}
                                            {u.username}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    
                    {selectedUsers.length > 0 && (
                        <div className="bg-dark-100 rounded-lg p-3 border border-dark-300">
                            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Selected Users ({selectedUsers.length})</h4>
                            <div className="flex flex-wrap gap-2">
                                {selectedUsers.map(u => (
                                    <div key={u.id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-dark-300 rounded-md text-sm text-white">
                                        <span>{u.username}</span>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedUsers(selectedUsers.filter(su => su.id !== u.id))}
                                            className="text-gray-400 hover:text-red-400"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Reason (Optional)</label>
                        <input
                            type="text"
                            value={grantReason}
                            onChange={(e) => setGrantReason(e.target.value)}
                            placeholder="e.g. 'Site contributor'"
                            className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                        />
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t border-dark-300">
                        <button
                            type="button"
                            onClick={() => {
                                setIsGrantModalOpen(false);
                                setSelectedUsers([]);
                            }}
                            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={selectedUsers.length === 0 || grantMutation.isPending}
                            className="px-6 py-2 bg-accent hover:bg-accent-dark text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                            Grant to {selectedUsers.length} User(s)
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
