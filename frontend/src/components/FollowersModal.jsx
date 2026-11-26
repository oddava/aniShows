import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import toast from 'react-hot-toast';
import { followApi } from '../api/client';
import { AlertCircle, Loader2, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { followKeys, profileKeys } from '../api/queries/user';
import { friendsWatchingKeys, getCommunityErrorMessage } from '../api/queries/social';

const ITEM_HEIGHT = 60; // px per row — must match actual rendered height
const MIN_SEARCH_LENGTH = 2; // the server ignores shorter `?search=` values
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The dialog body mounts only while open, so `useFocusTrap` (which restores
 * focus when it unmounts) hands focus back to whatever opened the modal.
 */
export default function FollowersModal({ isOpen, ...props }) {
    if (!isOpen || typeof document === 'undefined') return null;
    // On <body>, above the site's bottom bar; the wrapper carries the
    // profile's colour (.profile-page) without adding a box.
    return createPortal(
        <div className="profile-page contents">
            <FollowersDialog {...props} />
        </div>,
        document.body,
    );
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
            className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4"
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-label={`${username}'s following and followers`}
        >
            <div className="sheet-panel modal-panel flex h-[min(34rem,85vh)] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-1)] ring-1 ring-white/[0.06]">
                {/* Header: whose network, and the two lists as one switch. */}
                <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
                    <h2 className="min-w-0 truncate text-[17px] font-semibold text-[var(--text-1)]">@{username}</h2>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-3)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-1)]"
                        aria-label="Close modal"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="px-5" role="tablist" aria-label="Following and followers">
                    <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] bg-[var(--ink-0)] p-1">
                        <TabButton
                            active={activeTab === 'following'}
                            onClick={() => handleTabChange('following')}
                            label="Following"
                            count={displayFollowingCount}
                        />
                        <TabButton
                            active={activeTab === 'followers'}
                            onClick={() => handleTabChange('followers')}
                            label="Followers"
                            count={displayFollowersCount}
                        />
                    </div>
                </div>

                {/* Search, once the list is long enough to need it (server-side, 2+ chars). */}
                {showSearch && (
                    <div className="px-5 pt-3">
                        <div className="relative">
                            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-3)]" />
                            <input
                                type="search"
                                placeholder="Search by username"
                                aria-label={`Search ${activeTab}`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="input h-10 w-full py-0 pl-9 pr-3 text-sm"
                            />
                        </div>
                    </div>
                )}

                {/* Virtualized user list */}
                <div
                    ref={scrollRef}
                    className="custom-scrollbar mt-2 flex-1 overflow-y-auto px-3 pb-3"
                >
                    {isLoading ? (
                        <LoadingState />
                    ) : isError ? (
                        <ErrorState tab={activeTab} onRetry={refetch} />
                    ) : filteredUsers.length === 0 ? (
                        isSearching ? (
                            <p className="px-2 py-10 text-center text-sm text-[var(--text-2)]">
                                No users matching "{debouncedSearch}"
                            </p>
                        ) : (
                            <EmptyState tab={activeTab} isOwn={viewer?.username === username} />
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
                                            className="flex items-center justify-center"
                                        >
                                            {isFetchingNextPage && (
                                                <Loader2 aria-label="Loading more" className="h-5 w-5 animate-spin text-[var(--text-3)]" />
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

/** One half of the Following / Followers switch; the current one is lifted and in the profile colour. */
function TabButton({ active, onClick, label, count }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-[calc(var(--radius-md)-4px)] px-3 text-sm font-medium transition-colors ${
                active
                    ? 'bg-[var(--ink-2)] text-[var(--text-1)]'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
            aria-selected={active}
            role="tab"
        >
            <span>{label}</span>
            {count !== undefined && count !== null && (
                <span className={`tabular ${active ? 'text-[var(--signature)]' : 'text-[var(--text-3)]'}`}>
                    {count.toLocaleString()}
                </span>
            )}
        </button>
    );
}

function LoadingState() {
    return (
        <div aria-busy="true" aria-label="Loading" className="space-y-1 py-1">
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex h-[60px] items-center gap-3 px-2">
                    <div className="h-10 w-10 shrink-0 rounded-full bg-[var(--ink-2)] animate-pulse" />
                    <div className="h-4 w-32 rounded bg-[var(--ink-2)] animate-pulse" />
                    <div className="ml-auto h-9 w-20 rounded-lg bg-[var(--ink-2)] animate-pulse" />
                </div>
            ))}
        </div>
    );
}

function ErrorState({ tab, onRetry }) {
    return (
        <div className="px-4 py-10 text-center">
            <AlertCircle aria-hidden="true" className="mx-auto h-6 w-6 text-[var(--text-3)]" />
            <p className="mt-3 text-[15px] font-medium text-[var(--text-1)]">
                {tab === 'followers' ? 'Followers' : 'Following'} couldn’t load
            </p>
            {onRetry && (
                <button type="button" onClick={onRetry} className="btn-secondary mt-4 px-4 text-sm">
                    Try again
                </button>
            )}
        </div>
    );
}

function EmptyState({ tab, isOwn }) {
    const title = tab === 'followers' ? 'No followers yet' : 'Not following anyone yet';
    const detail = tab === 'followers'
        ? (isOwn ? 'When someone follows you, they show up here.' : 'People who follow them show up here.')
        : (isOwn ? 'Follow people to see their lists and activity.' : 'People they follow show up here.');
    return (
        <div className="px-4 py-12 text-center">
            <p className="text-[15px] font-medium text-[var(--text-1)]">{title}</p>
            <p className="mt-1 text-sm text-[var(--text-3)]">{detail}</p>
        </div>
    );
}

function UserListItem({ user, onClose, isFollowing, isFollower, showFollowsYou, onFollowToggle }) {
    return (
        <div className="flex h-full items-center gap-3 px-2">
            <Link
                to={`/u/${user.username}`}
                onClick={onClose}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg"
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
                alt=""
                onError={() => setHasImageError(true)}
                className="h-10 w-10 shrink-0 rounded-full bg-[var(--ink-2)] object-cover"
                loading="lazy"
            />
        );
    }

    return (
        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--signature-soft)] text-sm font-semibold uppercase text-[var(--signature)]">
            {user.username?.charAt(0) || '?'}
        </div>
    );
}

function UserInfo({ user, isFollowing, isFollower, showFollowsYou }) {
    const isMutual = isFollowing && isFollower;
    const note = isMutual ? 'Follows each other' : (isFollower && showFollowsYou ? 'Follows you' : null);

    return (
        <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium text-[var(--text-1)] transition-colors group-hover:text-[var(--signature)]">
                {user.display_name?.trim() || user.username}
            </p>
            {(user.display_name?.trim() || note) && (
                <p className="truncate text-[13px] text-[var(--text-3)]">
                    {user.display_name?.trim() ? `@${user.username}` : null}
                    {user.display_name?.trim() && note ? ' · ' : null}
                    {note}
                </p>
            )}
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

    const label = isFriends ? 'Friends' : isFollowing ? 'Following' : isFollowBack ? 'Follow back' : 'Follow';
    // Following someone is the settled state: a quiet button. Following
    // (back) is the action: filled in the profile's colour.
    const filled = !isFollowing;

    return (
        <button
            type="button"
            onClick={handleClick}
            aria-disabled={isPending || undefined}
            aria-label={`${label} ${username}`}
            aria-pressed={Boolean(isFollowing)}
            aria-busy={isPending || undefined}
            title={isFollowing ? 'Unfollow' : label}
            className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors ${
                filled
                    ? 'bg-[var(--signature)] text-[var(--on-signature)] hover:bg-[var(--signature-hover)]'
                    : 'bg-white/[0.06] text-[var(--text-1)] hover:bg-white/[0.1]'
            }`}
        >
            {isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {label}
        </button>
    );
}
