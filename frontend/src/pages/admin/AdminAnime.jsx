import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    Search, Filter, Play, CheckCircle2, Clock,
    Trash2, ChevronLeft, ChevronRight, Eye,
    Star, Heart, MessageSquare, LayoutGrid, XCircle
} from 'lucide-react';
import api from '../../api/client';
import logger from '../../utils/logger';
import AnimeMediaImage from '../../components/common/AnimeMediaImage';
import CustomSelect from '../../components/common/CustomSelect';

const AdminAnime = () => {
    const [animeList, setAnimeList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [filters, setFilters] = useState({
        status: '',
        type: '',
        ordering: '-created_at',
    });

    const fetchAnime = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page,
                ...(search && { search }),
                ...(filters.status && { status: filters.status }),
                ...(filters.type && { type: filters.type }),
                ordering: filters.ordering,
            });

            const response = await api.get(`/admin/anime/?${params}`);
            setAnimeList(response.data.results);
            setTotalPages(Math.ceil(response.data.count / 20));
        } catch (err) {
            logger.error('Failed to fetch anime:', err);
            setError(err.response?.data?.detail || 'Failed to load anime');
        } finally {
            setLoading(false);
        }
    }, [page, search, filters]);

    useEffect(() => {
        fetchAnime();
    }, [fetchAnime]);

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(1);
        fetchAnime();
    };

    const deleteAnime = async (animeId, title) => {
        if (!confirm(`Are you sure you want to delete "${title}"? This will also delete all related favorites, reviews, and list entries.`)) {
            return;
        }
        try {
            await api.delete(`/admin/anime/${animeId}/`);
            fetchAnime();
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to delete anime');
        }
    };

    if (error && !loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mb-4">
                    <XCircle size={32} />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Error Loading Anime</h3>
                <p className="text-gray-400">{error}</p>
            </div>
        );
    }

    const getStatusStyle = (status) => {
        switch (status) {
            case 'Airing': return { border: 'border-emerald-500/20', text: 'text-emerald-400', icon: <Play size={12} /> };
            case 'Finished': return { border: 'border-blue-500/20', text: 'text-blue-400', icon: <CheckCircle2 size={12} /> };
            case 'Upcoming': return { border: 'border-amber-500/20', text: 'text-amber-400', icon: <Clock size={12} /> };
            default: return { border: 'border-white/10', text: 'text-gray-400', icon: null };
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Anime Library</h1>
                    <p className="text-gray-400 mt-1">Manage shows, movies, and catalog data.</p>
                </div>
            </div>

            {/* Table Controls (Search & Filters) */}
            <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row gap-4 justify-between items-center shadow-lg">
                <form onSubmit={handleSearch} className="relative w-full md:w-96 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-purple-400 transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="Search anime titles..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 transition-all"
                    />
                </form>

                <div className="flex w-full md:w-auto gap-3 flex-wrap md:flex-nowrap">
                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.status}
                            onChange={(nextValue) => setFilters((f) => ({ ...f, status: nextValue }))}
                            options={[
                                { value: '', label: 'All Statuses' },
                                { value: 'Airing', label: 'Airing' },
                                { value: 'Finished', label: 'Finished' },
                                { value: 'Upcoming', label: 'Upcoming' },
                            ]}
                            startIcon={Filter}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm focus-visible:ring-purple-500/50"
                            ariaLabel="Filter anime by status"
                        />
                    </div>

                    <div className="flex-1 md:flex-none">
                        <CustomSelect
                            value={filters.type}
                            onChange={(nextValue) => setFilters((f) => ({ ...f, type: nextValue }))}
                            options={[
                                { value: '', label: 'All Types' },
                                { value: 'TV', label: 'TV Show' },
                                { value: 'Movie', label: 'Movie' },
                                { value: 'OVA', label: 'OVA' },
                                { value: 'Special', label: 'Special' },
                            ]}
                            startIcon={LayoutGrid}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm focus-visible:ring-purple-500/50"
                            ariaLabel="Filter anime by type"
                        />
                    </div>

                    <div className="w-full md:w-auto md:flex-none">
                        <CustomSelect
                            value={filters.ordering}
                            onChange={(nextValue) => setFilters((f) => ({ ...f, ordering: nextValue }))}
                            options={[
                                { value: '-created_at', label: 'Newest First' },
                                { value: 'created_at', label: 'Oldest First' },
                                { value: '-rating', label: 'Highest Rated' },
                                { value: 'title', label: 'A-Z Title' },
                            ]}
                            startIcon={Clock}
                            triggerClassName="w-full bg-white/5 py-2 pl-3 pr-3 text-sm focus-visible:ring-purple-500/50"
                            ariaLabel="Sort anime list"
                        />
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-dark/80 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl relative min-h-[400px]">
                {loading && (
                    <div className="absolute inset-0 z-10 bg-dark/50 backdrop-blur-sm flex items-center justify-center">
                        <div className="flex flex-col items-center">
                            <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-3" />
                            <p className="text-sm font-medium text-purple-400">Loading Library...</p>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse whitespace-nowrap">
                        <thead>
                            <tr className="bg-white/[0.02] border-b border-white/5">
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Title & Info</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Status</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Format</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400">Engagement</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-gray-400 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {animeList.map((anime) => {
                                const statusStyle = getStatusStyle(anime.status);
                                return (
                                    <tr key={anime.id} className="hover:bg-white/5 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                                <div className="w-14 h-20 rounded-lg bg-white/5 flex items-center justify-center text-2xl overflow-hidden shadow-lg flex-shrink-0 border border-white/5">
                                                    {anime.cover_image ? (
                                                        <AnimeMediaImage
                                                            anime={anime}
                                                            kind="cover"
                                                            size="small"
                                                            alt={anime.title}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        '🎬'
                                                    )}
                                                </div>
                                                <div className="flex flex-col max-w-sm">
                                                    <Link to={`/anime/${anime.slug}`} className="font-bold text-white group-hover:text-purple-400 transition-colors truncate block" title={anime.title}>
                                                        {anime.title}
                                                    </Link>
                                                    <span className="text-xs text-gray-500 mt-1 truncate block">
                                                        Studio: {anime.studio?.name || 'Unknown'}
                                                    </span>
                                                    <div className="flex items-center gap-3 mt-1.5">
                                                        <span className="flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20">
                                                            <Star fill="currentColor" size={10} />
                                                            {anime.rating ? Number(anime.rating).toFixed(1) : '—'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] tracking-wide uppercase font-bold ${statusStyle.border} ${statusStyle.text}`}>
                                                {statusStyle.icon}
                                                {anime.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1 items-start">
                                                <span className="inline-flex px-2 py-0.5 text-gray-300 rounded border border-white/10 text-[10px] tracking-wide uppercase font-bold mt-1">
                                                    {anime.anime_type}
                                                </span>
                                                <span className="text-xs text-gray-500 font-medium">
                                                    {anime.episode_count ? `${anime.episode_count} Episodes` : 'Ongoing'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1.5 align-start">
                                                <div className="flex items-center gap-2 text-xs text-gray-400 font-medium" title="Favorites">
                                                    <Heart size={12} className="text-gray-400" />
                                                    {anime.favorites_count?.toLocaleString() || 0} saves
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-gray-400 font-medium" title="Reviews">
                                                    <MessageSquare size={12} className="text-gray-400" />
                                                    {anime.reviews_count?.toLocaleString() || 0} reviews
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                <Link
                                                    to={`/anime/${anime.slug}`}
                                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors group/btn"
                                                    title="View Anime"
                                                >
                                                    <Eye size={16} className="group-hover/btn:text-purple-400" />
                                                </Link>

                                                <button
                                                    onClick={() => deleteAnime(anime.id, anime.title)}
                                                    className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                                                    title="Delete Anime from Database"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}

                            {animeList.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search size={32} className="opacity-20 mb-2" />
                                            <p className="text-sm">No anime found matching your criteria.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-white/5 bg-white/[0.02] flex items-center justify-between">
                        <span className="text-sm text-gray-400">
                            Showing page <span className="font-semibold text-white">{page}</span> of <span className="font-semibold text-white">{totalPages}</span>
                        </span>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                <ChevronLeft size={16} /> Prev
                            </button>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                                Next <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminAnime;
