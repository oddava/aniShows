import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import Pagination from '../../components/common/Pagination';
import ErrorState from '../../components/common/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Skeleton from '../../components/ui/Skeleton';
import { preloadForumChunks } from '../../app/routes/community';
import { getTotalPages } from '../../components/forums/buildPostTree';
import { ThreadListSkeleton } from '../../components/forums/ForumSkeletons';
import { useDelayedLoading } from '../../hooks/useDelayedLoading';
import ThreadRow, { forumTabClass } from '../../components/forums/ThreadRow';
import { forumQueries } from '../../api/queries/forums';

const ForumThreadList = () => {
    const { slug } = useParams();
    const { isAuthenticated } = useAuth();
    const [page, setPage] = useState(1);
    const [selectedTag, setSelectedTag] = useState('');

    useEffect(() => {
        preloadForumChunks();
    }, []);

    // Fetch category with placeholderData for smooth navigation
    const {
        data: category,
        isLoading: isCategoryLoading,
        isPlaceholderData: isCategoryPlaceholder
    } = useQuery({
        ...forumQueries.category(slug),
        staleTime: 5 * 60 * 1000, // 5 minutes
        placeholderData: keepPreviousData, // Keep showing previous category during load
    });

    const { data: tagsData } = useQuery({
        ...forumQueries.tags(),
        staleTime: 5 * 60 * 1000,
    });

    // Fetch threads with placeholderData for smooth pagination
    const {
        data: threadsData,
        isLoading: isThreadsLoading,
        isPlaceholderData: isThreadsPlaceholder,
        isFetching,
        error: threadsError,
        refetch: refetchThreads,
    } = useQuery({
        ...forumQueries.threads(slug, selectedTag, page),
        staleTime: 5 * 60 * 1000,
        placeholderData: keepPreviousData, // Keep showing previous threads during pagination
    });

    // Only show loading UI after 500ms delay AND when we're actually loading NEW data
    const showCategoryLoading = useDelayedLoading(isCategoryLoading && !isCategoryPlaceholder, 500);
    const showThreadsLoading = useDelayedLoading(isThreadsLoading && !isThreadsPlaceholder, 500);
    const showThreadsRefreshing = useDelayedLoading(
        isFetching && !isThreadsLoading && !isThreadsPlaceholder,
        300
    );

    const totalPages = typeof threadsData?.count !== 'undefined' ? Math.max(1, getTotalPages(threadsData, page)) : 0;

    // AniList-style loading pattern:
    // 1. If loading for 500ms+ with no cached data, show skeleton
    if (showCategoryLoading) {
        return (
            <div aria-hidden="true" className="forums-page">
                <div className="page-container pt-6 pb-16 md:pt-10">
                    <Skeleton className="h-4 w-24" />
                    <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                        <div>
                            <Skeleton className="h-10 w-56" />
                            <Skeleton className="mt-3 h-3.5 w-72" />
                        </div>
                        <Skeleton className="h-11 w-32" rounded="rounded-lg" />
                    </div>
                    <div className="mt-6 flex gap-1">
                        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-24" rounded="rounded-lg" />)}
                    </div>
                    <div className="mt-6 max-w-4xl">
                        <ThreadListSkeleton />
                    </div>
                </div>
            </div>
        );
    }

    // 2. If no data yet but still within 500ms delay, show nothing (prevents flash)
    if (!category) {
        return <div className="forums-page"></div>;
    }

    const results = threadsData?.results || [];
    const pinned = page === 1 ? results.filter((t) => t.is_pinned) : [];
    const regular = results.filter((t) => !t.is_pinned);
    const selectTag = (value) => {
        setSelectedTag(value);
        setPage(1);
    };
    const createPath = `/forums/category/${slug}/create`;

    // 3. Have data - render content immediately
    return (
        <div className="forums-page">
            <Helmet>
                <title>{category ? `${category.name}` : 'Category'} | AniShows Forums</title>
            </Helmet>

            <div className="page-container pt-6 pb-16 md:pt-10">
                <Link to="/forums" className="text-link -my-2.5 text-sm">All forums</Link>

                <header className="mt-2 flex flex-wrap items-end justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="page-title">{category?.name}</h1>
                        {category?.description && (
                            <p className="mt-1 max-w-2xl text-sm text-[var(--text-2)]">{category.description}</p>
                        )}
                    </div>
                    {isAuthenticated && (
                        <Link to={createPath} className="btn-primary text-sm">New thread</Link>
                    )}
                </header>

                {tagsData?.results?.length > 0 && (
                    <nav aria-label="Filter by tag" className="scroll-fade -mx-4 mt-6 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
                        <ul className="flex min-w-max gap-1">
                            <li>
                                <button
                                    type="button"
                                    onClick={() => selectTag('')}
                                    aria-pressed={selectedTag === ''}
                                    className={forumTabClass(selectedTag === '')}
                                >
                                    All
                                </button>
                            </li>
                            {tagsData.results.map((tag) => (
                                <li key={tag.id}>
                                    <button
                                        type="button"
                                        onClick={() => selectTag(tag.slug)}
                                        aria-pressed={selectedTag === tag.slug}
                                        className={forumTabClass(selectedTag === tag.slug)}
                                    >
                                        {tag.name}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </nav>
                )}

                <div className="relative mt-6 min-h-[400px] max-w-4xl">
                    {showThreadsLoading ? (
                        <ThreadListSkeleton />
                    ) : threadsError && !threadsData ? (
                        <ErrorState
                            title="Couldn't load threads"
                            onRetry={() => refetchThreads()}
                        />
                    ) : (
                        <>
                            {showThreadsRefreshing && (
                                <p className="mb-2 text-right text-sm text-[var(--text-3)]">Refreshing…</p>
                            )}

                            {/* Pinned threads first, page 1 only */}
                            {pinned.length > 0 && (
                                <section className="mb-8">
                                    <h2 className="mb-3 text-sm font-medium text-[var(--text-2)]">Pinned</h2>
                                    <div className="grid gap-2">
                                        {pinned.map((thread) => (
                                            <ThreadRow key={thread.id} thread={thread} compact />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {regular.length > 0 && (
                                <div className="grid gap-2">
                                    {regular.map((thread) => (
                                        <ThreadRow key={thread.id} thread={thread} />
                                    ))}
                                </div>
                            )}

                            {results.length === 0 && (
                                <EmptyState
                                    actions={isAuthenticated ? (
                                        <Link to={createPath} className="btn-primary text-sm">Start a thread</Link>
                                    ) : (
                                        <Link to="/login" className="btn-primary text-sm">Sign in to start a thread</Link>
                                    )}
                                >
                                    {selectedTag ? 'No threads with this tag yet.' : 'No threads here yet. Be the first to start one.'}
                                </EmptyState>
                            )}
                        </>
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="mt-8 flex max-w-4xl justify-center">
                        <Pagination
                            currentPage={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default ForumThreadList;
