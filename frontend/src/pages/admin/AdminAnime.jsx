import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';

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
            console.error('Failed to fetch anime:', err);
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
            <div className="admin-empty">
                <div className="admin-empty-icon">⚠️</div>
                <h3 className="admin-empty-title">Error</h3>
                <p className="admin-empty-text">{error}</p>
            </div>
        );
    }

    const getStatusColor = (status) => {
        switch (status) {
            case 'Airing': return 'success';
            case 'Finished': return 'info';
            case 'Upcoming': return 'warning';
            default: return 'neutral';
        }
    };

    return (
        <div>
            <h1 className="admin-page-title" style={{ marginBottom: '1.5rem' }}>
                Anime Management
            </h1>

            <div className="admin-table-container">
                <div className="admin-table-header">
                    <div className="admin-table-actions" style={{ width: '100%', justifyContent: 'space-between' }}>
                        <form onSubmit={handleSearch} className="admin-search">
                            <span className="admin-search-icon">🔍</span>
                            <input
                                type="text"
                                placeholder="Search anime..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </form>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <select
                                value={filters.status}
                                onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
                                className="admin-btn admin-btn-secondary"
                                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(30,30,30,0.8)' }}
                            >
                                <option value="">All Status</option>
                                <option value="Airing">Airing</option>
                                <option value="Finished">Finished</option>
                                <option value="Upcoming">Upcoming</option>
                            </select>

                            <select
                                value={filters.type}
                                onChange={(e) => setFilters(f => ({ ...f, type: e.target.value }))}
                                className="admin-btn admin-btn-secondary"
                                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(30,30,30,0.8)' }}
                            >
                                <option value="">All Types</option>
                                <option value="TV">TV</option>
                                <option value="Movie">Movie</option>
                                <option value="OVA">OVA</option>
                                <option value="Special">Special</option>
                            </select>

                            <select
                                value={filters.ordering}
                                onChange={(e) => setFilters(f => ({ ...f, ordering: e.target.value }))}
                                className="admin-btn admin-btn-secondary"
                                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem', color: '#fff', background: 'rgba(30,30,30,0.8)' }}
                            >
                                <option value="-created_at">Newest First</option>
                                <option value="created_at">Oldest First</option>
                                <option value="-rating">Highest Rated</option>
                                <option value="title">A-Z</option>
                            </select>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="admin-loading">
                        <div className="admin-spinner"></div>
                        <p>Loading anime...</p>
                    </div>
                ) : (
                    <>
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Anime</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Rating</th>
                                    <th>Episodes</th>
                                    <th>Stats</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {animeList.map((anime) => (
                                    <tr key={anime.id}>
                                        <td>
                                            <div className="admin-table-user">
                                                <div className="admin-table-avatar" style={{ borderRadius: '6px', width: '48px', height: '64px' }}>
                                                    {anime.cover_image ? (
                                                        <img src={anime.cover_image} alt={anime.title} style={{ objectFit: 'cover' }} />
                                                    ) : (
                                                        '🎬'
                                                    )}
                                                </div>
                                                <div>
                                                    <Link to={`/anime/${anime.slug}`} style={{ fontWeight: '500', color: '#a78bfa', textDecoration: 'none' }}>
                                                        {anime.title.length > 30 ? anime.title.substring(0, 30) + '...' : anime.title}
                                                    </Link>
                                                    <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>
                                                        {anime.studio || 'Unknown Studio'}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span className="admin-badge neutral">{anime.anime_type}</span>
                                        </td>
                                        <td>
                                            <span className={`admin-badge ${getStatusColor(anime.status)}`}>
                                                {anime.status}
                                            </span>
                                        </td>
                                        <td>
                                            {anime.rating ? (
                                                <span style={{ color: '#fbbf24' }}>⭐ {anime.rating.toFixed(1)}</span>
                                            ) : (
                                                <span style={{ color: 'rgba(255,255,255,0.3)' }}>N/A</span>
                                            )}
                                        </td>
                                        <td style={{ color: 'rgba(255,255,255,0.7)' }}>
                                            {anime.episode_count || '?'}
                                        </td>
                                        <td>
                                            <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                                                <span title="Favorites">❤️ {anime.favorites_count}</span>
                                                <span style={{ marginLeft: '0.75rem' }} title="Reviews">💬 {anime.reviews_count}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <Link
                                                    to={`/anime/${anime.slug}`}
                                                    className="admin-btn admin-btn-icon"
                                                    title="View Anime"
                                                >
                                                    👁️
                                                </Link>
                                                <button
                                                    onClick={() => deleteAnime(anime.id, anime.title)}
                                                    className="admin-btn admin-btn-icon"
                                                    title="Delete Anime"
                                                    style={{ color: '#ef4444' }}
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {animeList.length === 0 && (
                                    <tr>
                                        <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'rgba(255,255,255,0.4)' }}>
                                            No anime found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>

                        {totalPages > 1 && (
                            <div className="admin-pagination">
                                <div className="admin-pagination-info">
                                    Page {page} of {totalPages}
                                </div>
                                <div className="admin-pagination-buttons">
                                    <button
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="admin-btn admin-btn-secondary"
                                        style={{ padding: '0.4rem 0.75rem' }}
                                    >
                                        ← Prev
                                    </button>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                        disabled={page === totalPages}
                                        className="admin-btn admin-btn-secondary"
                                        style={{ padding: '0.4rem 0.75rem' }}
                                    >
                                        Next →
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default AdminAnime;
