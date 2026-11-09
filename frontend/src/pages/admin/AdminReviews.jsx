import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import logger from '../../utils/logger';
import CustomSelect from '../../components/common/CustomSelect';

const AdminReviews = () => {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [filters, setFilters] = useState({
        has_spoilers: '',
        min_rating: '',
        max_rating: '',
        ordering: '-created_at',
    });
    const [selectedReview, setSelectedReview] = useState(null);

    const fetchReviews = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                page,
                ...(search && { search }),
                ...(filters.has_spoilers && { has_spoilers: filters.has_spoilers }),
                ...(filters.min_rating && { min_rating: filters.min_rating }),
                ...(filters.max_rating && { max_rating: filters.max_rating }),
                ordering: filters.ordering,
            });

            const response = await api.get(`/admin/reviews/?${params}`);
            setReviews(response.data.results);
            setTotalPages(Math.ceil(response.data.count / 20));
        } catch (err) {
            logger.error('Failed to fetch reviews:', err);
            if (err.response?.status === 404 && page > 1) {
                // The page no longer exists, e.g. after deleting its last row.
                setPage((current) => Math.max(1, current - 1));
                return;
            }
            setError(err.response?.data?.detail || 'Failed to load reviews');
        } finally {
            setLoading(false);
        }
    }, [page, search, filters]);

    useEffect(() => {
        fetchReviews();
    }, [fetchReviews]);

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(1);
        fetchReviews();
    };

    const deleteReview = async (reviewId) => {
        if (!confirm('Are you sure you want to delete this review?')) {
            return;
        }
        try {
            await api.delete(`/admin/reviews/${reviewId}/`);
            setSelectedReview(null);
            fetchReviews();
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to delete review');
        }
    };

    const viewReviewDetails = async (reviewId) => {
        try {
            const response = await api.get(`/admin/reviews/${reviewId}/`);
            setSelectedReview(response.data);
        } catch (err) {
            alert(err.response?.data?.detail || 'Failed to load review details');
        }
    };

    const getRatingColor = (rating) => {
        if (rating >= 8) return 'success';
        if (rating >= 5) return 'warning';
        return 'danger';
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

    return (
        <div>
            <h1 className="admin-page-title" style={{ marginBottom: '1.5rem' }}>
                Review Moderation
            </h1>

            <div className="admin-table-container">
                <div className="admin-table-header">
                    <div className="admin-table-actions" style={{ width: '100%', justifyContent: 'space-between' }}>
                        <form onSubmit={handleSearch} className="admin-search">
                            <span className="admin-search-icon">🔍</span>
                            <input
                                type="text"
                                placeholder="Search reviews..."
                                value={search}
                                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            />
                        </form>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <CustomSelect
                                value={filters.has_spoilers}
                                onChange={(nextValue) => { setFilters((f) => ({ ...f, has_spoilers: nextValue })); setPage(1); }}
                                options={[
                                    { value: '', label: 'All Reviews' },
                                    { value: 'true', label: 'With Spoilers' },
                                    { value: 'false', label: 'No Spoilers' },
                                ]}
                                triggerClassName="admin-btn admin-btn-secondary px-3 py-2 text-[0.85rem] bg-dark-100"
                                menuClassName="z-[280]"
                                ariaLabel="Filter reviews by spoiler"
                            />

                            <CustomSelect
                                value={filters.min_rating}
                                onChange={(nextValue) => { setFilters((f) => ({ ...f, min_rating: nextValue })); setPage(1); }}
                                options={[
                                    { value: '', label: 'Min Rating' },
                                    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rating) => ({
                                        value: String(rating),
                                        label: `>= ${rating}`,
                                    })),
                                ]}
                                triggerClassName="admin-btn admin-btn-secondary px-3 py-2 text-[0.85rem] bg-dark-100"
                                menuClassName="z-[280]"
                                ariaLabel="Minimum review rating"
                            />

                            <CustomSelect
                                value={filters.ordering}
                                onChange={(nextValue) => { setFilters((f) => ({ ...f, ordering: nextValue })); setPage(1); }}
                                options={[
                                    { value: '-created_at', label: 'Newest First' },
                                    { value: 'created_at', label: 'Oldest First' },
                                    { value: '-rating', label: 'Highest Rating' },
                                    { value: 'rating', label: 'Lowest Rating' },
                                ]}
                                triggerClassName="admin-btn admin-btn-secondary px-3 py-2 text-[0.85rem] bg-dark-100"
                                menuClassName="z-[280]"
                                ariaLabel="Sort reviews"
                            />
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="admin-loading">
                        <div className="admin-spinner"></div>
                        <p>Loading reviews...</p>
                    </div>
                ) : (
                    <>
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Anime</th>
                                    <th>Rating</th>
                                    <th>Preview</th>
                                    <th>Flags</th>
                                    <th>Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reviews.map((review) => (
                                    <tr key={review.id}>
                                        <td>
                                            <Link to={`/u/${review.user.username}`} style={{ color: 'var(--color-accent-light)', textDecoration: 'none', fontWeight: '500' }}>
                                                {review.user.username}
                                            </Link>
                                        </td>
                                        <td>
                                            <Link to={`/anime/${review.anime.slug}`} style={{ color: 'rgba(255,255,255,0.8)', textDecoration: 'none' }}>
                                                {review.anime.title.length > 25 ? review.anime.title.substring(0, 25) + '...' : review.anime.title}
                                            </Link>
                                        </td>
                                        <td>
                                            <span className={`admin-badge ${getRatingColor(review.rating)}`}>
                                                ⭐ {review.rating}/10
                                            </span>
                                        </td>
                                        <td style={{ maxWidth: '200px', color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>
                                            {review.text ? (
                                                review.text.length > 50 ? review.text.substring(0, 50) + '...' : review.text
                                            ) : (
                                                <span style={{ fontStyle: 'italic', opacity: 0.5 }}>No text</span>
                                            )}
                                        </td>
                                        <td>
                                            {review.has_spoilers && (
                                                <span className="admin-badge warning">⚠️ Spoilers</span>
                                            )}
                                        </td>
                                        <td style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                                            {new Date(review.created_at).toLocaleDateString()}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                <button
                                                    onClick={() => viewReviewDetails(review.id)}
                                                    className="admin-btn admin-btn-icon"
                                                    title="View Full Review"
                                                >
                                                    👁️
                                                </button>
                                                <button
                                                    onClick={() => deleteReview(review.id)}
                                                    className="admin-btn admin-btn-icon"
                                                    title="Delete Review"
                                                    style={{ color: '#ef4444' }}
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {reviews.length === 0 && (
                                    <tr>
                                        <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'rgba(255,255,255,0.4)' }}>
                                            No reviews found
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

            {/* Review Detail Modal */}
            {selectedReview && (
                <div className="admin-modal-overlay" onClick={() => setSelectedReview(null)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="admin-modal-header">
                            <h3 className="admin-modal-title">Review Details</h3>
                            <button
                                onClick={() => setSelectedReview(null)}
                                className="admin-btn admin-btn-icon"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="admin-modal-body">
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.25rem' }}>User</div>
                                <div style={{ fontWeight: '500' }}>{selectedReview.user.username}</div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.25rem' }}>Anime</div>
                                <Link to={`/anime/${selectedReview.anime.slug}`} style={{ color: 'var(--color-accent-light)', textDecoration: 'none' }}>
                                    {selectedReview.anime.title}
                                </Link>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.25rem' }}>Rating</div>
                                <span className={`admin-badge ${getRatingColor(selectedReview.rating)}`}>
                                    ⭐ {selectedReview.rating}/10
                                </span>
                                {selectedReview.has_spoilers && (
                                    <span className="admin-badge warning" style={{ marginLeft: '0.5rem' }}>⚠️ Contains Spoilers</span>
                                )}
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', marginBottom: '0.25rem' }}>Review Text</div>
                                <div style={{
                                    background: 'rgba(0,0,0,0.3)',
                                    padding: '1rem',
                                    borderRadius: '8px',
                                    color: 'rgba(255,255,255,0.85)',
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    whiteSpace: 'pre-wrap'
                                }}>
                                    {selectedReview.text || 'No review text provided.'}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
                                <span>Created: {new Date(selectedReview.created_at).toLocaleString()}</span>
                                <span>•</span>
                                <span>Updated: {new Date(selectedReview.updated_at).toLocaleString()}</span>
                            </div>
                        </div>
                        <div className="admin-modal-footer">
                            <button onClick={() => setSelectedReview(null)} className="admin-btn admin-btn-secondary">
                                Close
                            </button>
                            <button onClick={() => deleteReview(selectedReview.id)} className="admin-btn admin-btn-danger">
                                🗑️ Delete Review
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminReviews;
