import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import toast from 'react-hot-toast';
import { followApi } from '../api/client';
import { X, Users, User, UserCheck, UserPlus, UserMinus, Loader2, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { followKeys, profileKeys } from '../api/queries/user';
import { friendsWatchingKeys, getCommunityErrorMessage } from '../api/queries/social';

const ITEM_HEIGHT = 68; // px per row — must match actual rendered height
const MIN_SEARCH_LENGTH = 2; // the server ignores shorter `?search=` values
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The dialog body mounts only while open, so `useFocusTrap` (which restores
 * focus when it unmounts) hands focus back to whatever opened the modal.
 */
export default function FollowersModal({ isOpen, ...props }) {
    if (!isOpen) return null;
    return <FollowersDialog {...props} />;
}

function FollowersDialog({
    username,
    type = 'followers',
    followersCount = 0,
    followingCount = 0,
    onClose
}) {
    const { user: viewer } = useAuth();
    const [activeTab, setActiveTab] = useState(type);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    // Last unfiltered total per tab, so a search doesn't change the tab counts
    // or hide the search box.
    const [baseCounts, setBaseCounts] = useState({});
    const scrollRef = useRef(null);
    const queryClient = useQueryClient();

    // Local follow-state overrides: { [username]: boolean }
    // Tracks which users the current viewer has toggled within this modal session.
    // When modal closes, this resets and real queries get invalidated.
    const [followOverrides, setFollowOverrides] = useState({});

    // Track whether any follow action happened so we know to invalidate on close
    const didMutateRef = useRef(false);

    // Sync active tab when `type` prop changes while open
    useEffect(() => {
        setActiveTab(type);
    }, [type]);

    // Reset overrides and search when tab changes
    useEffect(() => {
        setFollowOverrides({});
        setSearchQuery('');
        setDebouncedSearch('');
    }, [activeTab]);

    // Debounce the search box into the server-side `?search=` value.
    useEffect(() => {
        const trimmed = searchQuery.trim();
        const next = trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : '';
        if (next === debouncedSearch) return undefined;
        const timer = window.setTimeout(() => setDebouncedSearch(next), next ? SEARCH_DEBOUNCE_MS : 0);
        return () => window.clearTimeout(timer);
    }, [searchQuery, debouncedSearch]);

    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError,
        refetch
    } = useInfiniteQuery({
        queryKey: debouncedSearch
            ? followKeys.search(username, activeTab, debouncedSearch)
            : followKeys.list(username, activeTab),
        queryFn: async ({ pageParam }) => {
            const apiCall = activeTab === 'followers'
                ? followApi.getFollowers
                : followApi.getFollowing;
            const params = debouncedSearch
                ? { page: pageParam, search: debouncedSearch }
                : { page: pageParam };
            const response = await apiCall(username, params);
            return response.data;
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => {
            if (lastPage && lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch {
                    return undefined;
                }
            }
            return undefined;
        },
        staleTime: 0,
        refetchOnMount: true,
    });

    const filteredUsers = useMemo(
        () => data?.pages?.flatMap(page => page?.results || []) || [],
        [data]
    );
    const totalCount = data?.pages?.[0]?.count;

    useEffect(() => {
        if (!debouncedSearch && totalCount !== undefined) {
            setBaseCounts(prev => (prev[activeTab] === totalCount ? prev : { ...prev, [activeTab]: totalCount }));
        }
    }, [debouncedSearch, totalCount, activeTab]);

    // Virtualizer setup
    const virtualizer = useVirtualizer({
        count: filteredUsers.length + (isFetchingNextPage ? 1 : 0) + (hasNextPage && !isFetchingNextPage ? 1 : 0),
        getScrollElement: () => scrollRef.current,
        estimateSize: () => ITEM_HEIGHT,
        overscan: 10,
    });

    // Infinite scroll: trigger fetch when sentinel row is visible
    useEffect(() => {
        const items = virtualizer.getVirtualItems();
        if (items.length === 0) return;

        const lastItem = items[items.length - 1];
        if (
            lastItem &&
            lastItem.index >= filteredUsers.length - 1 &&
            hasNextPage &&
            !isFetchingNextPage
        ) {
            fetchNextPage();
        }
    }, [virtualizer, hasNextPage, isFetchingNextPage, fetchNextPage, filteredUsers.length]);

    // On close: invalidate queries so the profile page gets fresh data
    const handleClose = useCallback(() => {
        if (didMutateRef.current) {
            queryClient.invalidateQueries({ queryKey: profileKeys.byUsername(username) });
            queryClient.invalidateQueries({ queryKey: profileKeys.own });
            queryClient.invalidateQueries({ queryKey: profileKeys.me });
            queryClient.invalidateQueries({ queryKey: followKeys.all });
            queryClient.invalidateQueries({ queryKey: friendsWatchingKeys.all });
        }
        onClose();
    }, [onClose, queryClient, username]);

    // Tab stays inside the dialog, Escape closes it, focus returns on close.
    const dialogRef = useFocusTrap(true, handleClose);

    const handleBackdropClick = useCallback((e) => {
        if (e.target === e.currentTarget) handleClose();
    }, [handleClose]);

    // Lock page scroll while open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, []);

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    };

    // Callback for when a follow toggle happens inside the modal
    const handleFollowToggle = useCallback((targetUsername, newIsFollowing) => {
        didMutateRef.current = true;
        setFollowOverrides(prev => ({ ...prev, [targetUsername]: newIsFollowing }));
    }, []);

    const displayFollowersCount = baseCounts.followers ?? followersCount;
    const displayFollowingCount = baseCounts.following ?? followingCount;
    const activeBaseCount = activeTab === 'followers' ? displayFollowersCount : displayFollowingCount;
    const showSearch = activeBaseCount > 5 || searchQuery !== '';
    const isSearching = debouncedSearch !== '';
    // On your own followers tab every row follows you, so the chip would be noise.
    const showFollowsYou = !(activeTab === 'followers' && viewer?.username === username);

    return (
        <div
            ref={dialogRef}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-label={`${username}'s following and followers`}
        >
            <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-gray-800 bg-dark-100 shadow-xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 ">
                    <h2 className="text-lg font-bold text-white">@{username}</h2>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
                        aria-label="Close modal"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex " role="tablist">
                    <TabButton
                        active={activeTab === 'following'}
                        onClick={() => handleTabChange('following')}
                        icon={<UserCheck className="w-4 h-4" />}
                        label="Following"
                        count={displayFollowingCount}
                    />
                    <TabButton
                        active={activeTab === 'followers'}
                        onClick={() => handleTabChange('followers')}
                        icon={<Users className="w-4 h-4" />}
                        label="Followers"
                        count={displayFollowersCount}
                    />
                </div>

                {/* Search — show when there are enough items (server-side, 2+ chars) */}
                {showSearch && (
                    <div className="px-3 pt-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                                type="search"
                                placeholder="Search users..."
                                aria-label={`Search ${activeTab}`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 bg-dark-200 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-accent/50 transition-colors"
                            />
                        </div>
                    </div>
                )}

                {/* Virtualized User List */}
                <div
                    ref={scrollRef}
                    className="flex-1 overflow-y-auto p-2 custom-scrollbar"
                >
                    {isLoading ? (
                        <LoadingState />
                    ) : isError ? (
                        <ErrorState tab={activeTab} onRetry={refetch} />
                    ) : filteredUsers.length === 0 ? (
                        isSearching ? (
                            <div className="text-center py-8 text-gray-400">
                                <Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No users matching "{debouncedSearch}"</p>
                            </div>
                        ) : (
                            <EmptyState tab={activeTab} />
                        )
                    ) : (
                        <div
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                                width: '100%',
                                position: 'relative',
                            }}
                        >
                            {virtualizer.getVirtualItems().map((virtualRow) => {
                                // Loading indicator row
                                if (virtualRow.index >= filteredUsers.length) {
                                    return (
                                        <div
                                            key="loading-more"
                                            style={{
                                                position: 'absolute',
                                                top: 0,
                                                left: 0,
                                                width: '100%',
                                                height: `${virtualRow.size}px`,
                                                transform: `translateY(${virtualRow.start}px)`,
                                            }}
                                            className="flex justify-center items-center"
                                        >
                                            {isFetchingNextPage && (
                                                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                                            )}
                                        </div>
                                    );
                                }

                                const item = filteredUsers[virtualRow.index];
                                // Apply local override if user toggled follow in this session
                                const effectiveIsFollowing =
                                    item.user.username in followOverrides
                                        ? followOverrides[item.user.username]
                                        : item.is_following;

                                return (
                                    <div
                                        key={`${item.user.username}-${item.id}`}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                    >
                                        <UserListItem
                                            user={item.user}
                                            isFollowing={effectiveIsFollowing}
                                            isFollower={item.is_follower}
                                            showFollowsYou={showFollowsYou}
                                            onClose={handleClose}
                                            onFollowToggle={handleFollowToggle}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({ active, onClick, icon, label, count }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                active
                    ? 'text-accent border-b-2 border-accent'
                    : 'text-gray-400 hover:text-white'
            }`}
            aria-selected={active}
            role="tab"
        >
            {icon}
            <span>{label}</span>
            {count !== undefined && count !== null && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-accent/20 text-accent' : 'bg-gray-700 text-gray-400'
                }`}>
                    {count.toLocaleString()}
                </span>
            )}
        </button>
    );
}

function LoadingState() {
    return (
        <div className="space-y-3 py-4 px-2">
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
                    <div className="w-11 h-11 rounded-full bg-dark-200" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 w-24 bg-dark-200 rounded" />
                        <div className="h-3 w-16 bg-dark-200 rounded" />
                    </div>
                    <div className="h-8 w-20 bg-dark-200 rounded-lg" />
                </div>
            ))}
        </div>
    );
}

function ErrorState({ tab, onRetry }) {
    return (
        <div className="text-center py-8 text-gray-400">
            <p className="text-sm mb-3">Failed to load {tab}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="px-4 py-2 rounded-lg bg-dark-200 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-accent transition-colors"
                >
                    Try Again
                </button>
            )}
        </div>
    );
}

function EmptyState({ tab }) {
    return (
        <div className="text-center py-12 text-gray-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No {tab} yet</p>
            <p className="text-xs text-gray-500 mt-1">
                {tab === 'followers'
                    ? "When someone follows this user, they'll appear here"
                    : 'Users this account follows will appear here'}
            </p>
        </div>
    );
}

function UserListItem({ user, onClose, isFollowing, isFollower, showFollowsYou, onFollowToggle }) {
    return (
        <div className="group flex h-full items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-gray-800/50">
            <Link
                to={`/u/${user.username}`}
                onClick={onClose}
                className="flex items-center gap-3 flex-1 min-w-0"
            >
                <Avatar user={user} />
                <UserInfo user={user} isFollowing={isFollowing} isFollower={isFollower} showFollowsYou={showFollowsYou} />
            </Link>

            <ModalFollowButton
                username={user.username}
                isFollowing={isFollowing}
                isFollower={isFollower}
                onToggle={onFollowToggle}
            />
        </div>
    );
}

function Avatar({ user }) {
    const [hasImageError, setHasImageError] = useState(false);
    const showAvatarImage = Boolean(user.avatar) && !hasImageError;

    if (showAvatarImage) {
        return (
            <img
                src={user.avatar}
                alt={user.username}
                onError={() => setHasImageError(true)}
                className="w-11 h-11 rounded-xl object-cover border-2 border-gray-700 group-hover:border-accent/50 transition-colors shrink-0"
                loading="lazy"
            />
        );
    }

    return (
        <div className="ui-avatar-fallback h-11 w-11 shrink-0">
            <User className="w-6 h-6 text-gray-500/80" />
        </div>
    );
}

function UserInfo({ user, isFollowing, isFollower, showFollowsYou }) {
    const isMutual = isFollowing && isFollower;

    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
                <p className="font-medium text-white truncate group-hover:text-accent transition-colors text-sm">
                    {user.username}
                </p>
                {isMutual && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 font-medium">
                        Moot
                    </span>
                )}
                {!isMutual && isFollower && showFollowsYou && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400 font-medium">
                        Follows you
                    </span>
                )}
            </div>
        </div>
    );
}

/**
 * Lightweight follow button used only inside the modal.
 * Calls followApi.toggle directly and reports state changes to the parent
 * via onToggle(username, newIsFollowing). Does NOT invalidate React Query
 * caches — the modal handles that on close.
 */
function ModalFollowButton({ username, isFollowing, isFollower, onToggle }) {
    const { user } = useAuth();
    const [isPending, setIsPending] = useState(false);

    // Don't show for own profile or if not logged in
    if (!user || user.username === username) return null;

    const isFriends = isFollowing && isFollower;
    const isFollowBack = !isFollowing && isFollower;

    const handleClick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isPending) return;

        // Capture original state before optimistic flip
        const previousState = isFollowing;
        const newState = !previousState;
        onToggle(username, newState);
        setIsPending(true);

        try {
            const response = await followApi.toggle(username);
            // Reconcile with server truth
            const serverIsFollowing = response.data?.is_following ?? newState;
            if (serverIsFollowing !== newState) {
                onToggle(username, serverIsFollowing);
            }
        } catch (error) {
            // Revert on failure
            onToggle(username, previousState);
            toast.error(getCommunityErrorMessage(error, 'Could not update follow. Please try again.'));
        } finally {
            setIsPending(false);
        }
    };

    const getIcon = () => {
        if (isPending) return <Loader2 className="w-4 h-4 animate-spin" />;
        if (isFriends) return <Users className="w-4 h-4" />;
        if (isFollowing) return <UserMinus className="w-4 h-4" />;
        if (isFollowBack) return <UserCheck className="w-4 h-4" />;
        return <UserPlus className="w-4 h-4" />;
    };

    const getLabel = () => {
        if (isFriends) return 'Friends';
        if (isFollowing) return 'Following';
        if (isFollowBack) return 'Follow Back';
        return 'Follow';
    };

    const getStyles = () => {
        if (isFriends) {
            return 'bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50';
        }
        if (isFollowing) {
            return 'bg-gray-700/50 text-gray-300 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 border border-gray-600';
        }
        if (isFollowBack) {
            return 'bg-accent-dark/85 text-white hover:bg-accent-dark border border-accent';
        }
        return 'bg-accent-dark text-white hover:bg-accent-dark/85';
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={isPending}
            aria-label={`${getLabel()} ${username}`}
            aria-pressed={Boolean(isFollowing)}
            aria-busy={isPending || undefined}
            className={`
                flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium
                transition-colors shrink-0
                ${getStyles()}
                disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={isFriends ? 'Friends (click to unfollow)' : isFollowing ? 'Unfollow' : isFollowBack ? 'Follow Back' : 'Follow'}
        >
            {getIcon()}
            <span className="hidden sm:inline">{getLabel()}</span>
        </button>
    );
}
