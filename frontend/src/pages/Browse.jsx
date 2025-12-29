import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, ChevronDown, X } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import AnimeCard, { AnimeCardSkeleton } from '../components/AnimeCard';
import { animeApi, genreApi } from '../api/client';

const SORT_OPTIONS = [
    { value: 'popular', label: 'Most Popular' },
    { value: 'rating', label: 'Highest Rated' },
    { value: 'newest', label: 'Newest' },
    { value: 'title', label: 'A-Z' },
];

export default function Browse() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
    const [showSortMenu, setShowSortMenu] = useState(false);

    const currentGenre = searchParams.get('genre') || 'all';
    const currentSort = searchParams.get('sort') || 'popular';
    const currentSearch = searchParams.get('q') || '';

    // Fetch genres
    const { data: genres } = useQuery({
        queryKey: ['genres'],
        queryFn: () => genreApi.getAll().then(res => res.data),
        staleTime: 1000 * 60 * 30, // 30 minutes
    });

    // Fetch anime with infinite query
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError,
    } = useInfiniteQuery({
        queryKey: ['anime', 'list', currentGenre, currentSort, currentSearch],
        queryFn: ({ pageParam = 1 }) =>
            animeApi.getAll({
                page: pageParam,
                genre: currentGenre !== 'all' ? currentGenre : undefined,
                sort: currentSort,
                q: currentSearch || undefined,
            }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                const url = new URL(lastPage.next);
                return url.searchParams.get('page');
            }
            return undefined;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    // Infinite scroll
    const handleScroll = useCallback(() => {
        if (
            window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 500 &&
            hasNextPage &&
            !isFetchingNextPage
        ) {
            fetchNextPage();
        }
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    useEffect(() => {
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [handleScroll]);

    // Search debounce
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (searchInput !== currentSearch) {
                const newParams = new URLSearchParams(searchParams);
                if (searchInput) {
                    newParams.set('q', searchInput);
                } else {
                    newParams.delete('q');
                }
                setSearchParams(newParams);
            }
        }, 300);

        return () => clearTimeout(timeout);
    }, [searchInput]);

    const setGenre = (genre) => {
        // Reset to single genre or 'all'
        const newParams = new URLSearchParams(searchParams);
        if (genre === 'all') {
            newParams.delete('genre');
        } else {
            newParams.set('genre', genre);
        }
        setSearchParams(newParams);
    };

    const toggleGenre = (genreSlug) => {
        const newParams = new URLSearchParams(searchParams);
        let currentGenres = currentGenre === 'all' ? [] : currentGenre.split(',');

        if (currentGenres.includes(genreSlug)) {
            currentGenres = currentGenres.filter(g => g !== genreSlug);
        } else {
            currentGenres.push(genreSlug);
        }

        if (currentGenres.length === 0) {
            newParams.delete('genre');
        } else {
            newParams.set('genre', currentGenres.join(','));
        }
        setSearchParams(newParams);
    };

    const setSort = (sort) => {
        const newParams = new URLSearchParams(searchParams);
        newParams.set('sort', sort);
        setSearchParams(newParams);
        setShowSortMenu(false);
    };

    const allAnime = data?.pages.flatMap(page => page.results) || [];
    const totalCount = data?.pages[0]?.count || 0;

    return (
        <div className="min-h-screen py-8 px-4">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
                        Discover Anime
                    </h1>
                    <p className="text-gray-400 max-w-xl mx-auto">
                        Explore our collection of anime series and find your next favorite.
                    </p>
                </div>

                {/* Search Bar */}
                <div className="relative max-w-2xl mx-auto mb-8">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Search anime by title..."
                        className="input !pl-12 pr-10 py-4 text-lg"
                    />
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                    {searchInput && (
                        <button
                            onClick={() => setSearchInput('')}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {/* Genre Pills */}
                <div className="mb-8">
                    <div className="flex flex-wrap gap-2 justify-center">
                        <button
                            onClick={() => setGenre('all')}
                            className={`px-4 py-2 rounded-full font-medium whitespace-nowrap transition-all duration-200
                           ${currentGenre === 'all'
                                    ? 'bg-accent text-white'
                                    : 'bg-dark-100 text-gray-300 border border-gray-700 hover:border-accent'}`}
                        >
                            All Anime
                        </button>
                        {genres?.map((genre) => {
                            const isSelected = currentGenre.split(',').includes(genre.slug);
                            return (
                                <button
                                    key={genre.id}
                                    onClick={() => toggleGenre(genre.slug)}
                                    className={`px-4 py-2 rounded-full font-medium whitespace-nowrap transition-all duration-200
                             ${isSelected
                                            ? 'bg-accent text-white'
                                            : 'bg-dark-100 text-gray-300 border border-gray-700 hover:border-accent'}`}
                                >
                                    {genre.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Controls Bar */}
                <div className="flex items-center justify-between mb-8">
                    <p className="text-gray-400">
                        Showing <span className="text-accent font-semibold">{totalCount}</span> results
                    </p>

                    {/* Sort Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSortMenu(!showSortMenu)}
                            className="flex items-center gap-2 px-4 py-2 bg-dark-100 border border-gray-700 rounded-xl
                        text-gray-300 hover:border-accent transition-colors"
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                            <span>Sort: {SORT_OPTIONS.find(o => o.value === currentSort)?.label}</span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${showSortMenu ? 'rotate-180' : ''}`} />
                        </button>

                        {showSortMenu && (
                            <div className="absolute right-0 mt-2 w-48 bg-dark-100 border border-gray-700 rounded-xl 
                            shadow-xl z-20 overflow-hidden">
                                {SORT_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setSort(option.value)}
                                        className={`w-full px-4 py-3 text-left transition-colors
                               ${currentSort === option.value
                                                ? 'bg-accent text-white'
                                                : 'text-gray-300 hover:bg-dark-50'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Anime Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                    {isLoading ? (
                        Array(12).fill(0).map((_, i) => <AnimeCardSkeleton key={i} />)
                    ) : isError ? (
                        <div className="col-span-full text-center py-16">
                            <p className="text-red-400 mb-4">Failed to load anime</p>
                            <button onClick={() => window.location.reload()} className="btn-primary">
                                Reload
                            </button>
                        </div>
                    ) : allAnime.length === 0 ? (
                        <div className="col-span-full text-center py-16">
                            <p className="text-gray-400 mb-4">No anime found matching your criteria</p>
                            <button onClick={() => setSearchParams({})} className="btn-secondary">
                                Clear Filters
                            </button>
                        </div>
                    ) : (
                        allAnime.map((anime) => (
                            <AnimeCard key={anime.id} anime={anime} />
                        ))
                    )}
                </div>

                {/* Loading more */}
                {isFetchingNextPage && (
                    <div className="flex justify-center py-8">
                        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
            </div>
        </div>
    );
}
