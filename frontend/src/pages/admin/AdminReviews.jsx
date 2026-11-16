import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { AlertTriangle, Search, Star, Trash2 } from 'lucide-react';

import api from '../../api/client';
import { adminKeys } from '../../api/queries/admin';
import CustomSelect from '../../components/common/CustomSelect';
import ErrorState from '../../components/common/ErrorState';
import AdminPagination from './components/AdminPagination';
import { useConfirm } from './components/ConfirmDialog';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import { getAdminErrorMessage, useAdminList, useAdminMutation } from './hooks/useAdminQuery';
import useDebouncedValue from './hooks/useDebouncedValue';

const ratingClass = (rating) => (rating >= 8 ? 'text-emerald-400' : rating >= 5 ? 'text-amber-300' : 'text-red-400');
const truncate = (text, length) => (text && text.length > length ? `${text.slice(0, length)}…` : text);

/** All reviews, for staff moderation. Reported ones are handled in the moderation queue. */
const AdminReviews = () => {
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebouncedValue(search.trim());
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({ has_spoilers: '', min_rating: '' });
    const [ordering, setOrdering] = useState('-created_at');
    const [selectedReview, setSelectedReview] = useState(null);
    const [confirm, confirmDialog] = useConfirm();

    const list = useAdminList({
        resource: 'reviews',
        params: {
            page,
            ...(debouncedSearch && { search: debouncedSearch }),
            ...(filters.has_spoilers && { has_spoilers: filters.has_spoilers }),
            ...(filters.min_rating && { min_rating: filters.min_rating }),
            ordering,
        },
        page,
        setPage,
        errorLog: 'Failed to fetch reviews:',
    });

    const deleteMutation = useAdminMutation(
        (reviewId) => api.delete(`/admin/reviews/${reviewId}/`),
        { invalidate: [adminKeys.resource('reviews'), adminKeys.moderation()] },
    );

    const changeFilter = (key, value) => {
        setFilters((f) => ({ ...f, [key]: value }));
        setPage(1);
    };

    const deleteReview = async (review) => {
        setSelectedReview(null);
        const ok = await confirm({
            title: 'Delete this review?',
            message: `${review.user?.username}'s review of ${review.anime?.title} is removed for everyone. This cannot be undone.`,
            confirmLabel: 'Delete review',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteMutation.mutateAsync(review.id);
            toast.success('Review deleted');
        } catch (err) {
            toast.error(getAdminErrorMessage(err, 'Failed to delete review'));
        }
    };

    const columns = [
        {
            key: 'user',
            title: 'User',
            render: (review) => (
                <Link to={`/u/${review.user.username}`} className="text-violet-300 hover:text-violet-200 font-medium">
                    {review.user.username}
                </Link>
            ),
        },
        {
            key: 'anime',
            title: 'Anime',
            render: (review) => (
                <Link to={`/anime/${review.anime.slug}`} className="text-white/80 hover:text-white">
                    {truncate(review.anime.title, 30)}
                </Link>
            ),
        },
        {
            key: 'rating',
            title: 'Rating',
            sortable: true,
            render: (review) => (
                <span className={`inline-flex items-center gap-1 ${ratingClass(review.rating)}`}>
                    <Star size={12} aria-hidden="true" /> {review.rating}/10
                </span>
            ),
        },
        {
            key: 'text',
            title: 'Preview',
            render: (review) => (review.text
                ? <span className="text-white/60 text-sm">{truncate(review.text, 60)}</span>
                : <span className="text-white/40 italic">No text</span>),
        },
        {
            key: 'has_spoilers',
            title: 'Flags',
            render: (review) => (review.has_spoilers ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                    <AlertTriangle size={12} aria-hidden="true" /> Spoilers
                </span>
            ) : null),
        },
        {
            key: 'created_at',
            title: 'Date',
            sortable: true,
            render: (review) => <span className="text-white/50 text-sm">{new Date(review.created_at).toLocaleDateString()}</span>,
        },
        {
            key: 'actions',
            title: 'Actions',
            render: (review) => (
                <button
                    type="button"
                    onClick={() => deleteReview(review)}
                    aria-label={`Delete review by ${review.user.username}`}
                    className="inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg bg-white/5 text-gray-300 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                    <Trash2 size={16} aria-hidden="true" />
                </button>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-white">Reviews</h1>
                <p className="text-sm text-white/50 mt-1">
                    Every review on the site. Reported reviews wait in the <Link to="/admin/moderation" className="text-violet-300 hover:text-violet-200">moderation queue</Link>.
                </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
                <div className="relative w-full md:w-96">
                    <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                        type="search"
                        aria-label="Search reviews"
                        placeholder="Search reviews..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        className="w-full pl-9 pr-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
                    />
                </div>
                <div className="flex gap-3">
                    <CustomSelect
                        value={filters.has_spoilers}
                        onChange={(next) => changeFilter('has_spoilers', next)}
                        options={[
                            { value: '', label: 'All reviews' },
                            { value: 'true', label: 'With spoilers' },
                            { value: 'false', label: 'No spoilers' },
                        ]}
                        triggerClassName="bg-white/5 py-2 pl-3 pr-3 text-sm"
                        ariaLabel="Filter reviews by spoiler"
                    />
                    <CustomSelect
                        value={filters.min_rating}
                        onChange={(next) => changeFilter('min_rating', next)}
                        options={[
                            { value: '', label: 'Any rating' },
                            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rating) => ({ value: String(rating), label: `${rating}+` })),
                        ]}
                        triggerClassName="bg-white/5 py-2 pl-3 pr-3 text-sm"
                        ariaLabel="Minimum review rating"
                    />
                </div>
            </div>

            {list.error && !list.isFetching ? (
                <ErrorState
                    title="Couldn’t load reviews"
                    message={getAdminErrorMessage(list.error, 'Failed to load reviews')}
                    onRetry={() => list.refetch()}
                />
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    <DataTable
                        columns={columns}
                        data={list.items}
                        loading={list.isFetching && list.items.length === 0}
                        ordering={ordering}
                        onSort={(next) => { setOrdering(next); setPage(1); }}
                        onView={setSelectedReview}
                        rowLabel={(review) => `review by ${review.user.username}`}
                        emptyMessage="No reviews found"
                    />
                    <AdminPagination page={page} totalPages={list.totalPages} onPageChange={setPage} />
                </div>
            )}

            <Modal isOpen={selectedReview !== null} onClose={() => setSelectedReview(null)} title="Review details">
                {selectedReview && (
                    <div className="space-y-4">
                        <dl className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <dt className="text-white/50">User</dt>
                                <dd className="text-white">{selectedReview.user.username}</dd>
                            </div>
                            <div>
                                <dt className="text-white/50">Anime</dt>
                                <dd><Link to={`/anime/${selectedReview.anime.slug}`} className="text-violet-300 hover:text-violet-200">{selectedReview.anime.title}</Link></dd>
                            </div>
                            <div>
                                <dt className="text-white/50">Rating</dt>
                                <dd className={ratingClass(selectedReview.rating)}>{selectedReview.rating}/10{selectedReview.has_spoilers ? ' · contains spoilers' : ''}</dd>
                            </div>
                            <div>
                                <dt className="text-white/50">Posted</dt>
                                <dd className="text-white/80">{new Date(selectedReview.created_at).toLocaleString()}</dd>
                            </div>
                        </dl>
                        <div className="bg-black/30 rounded-lg p-4 text-white/85 max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm">
                            {selectedReview.text || 'No review text provided.'}
                        </div>
                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={() => setSelectedReview(null)} className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20">
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={() => deleteReview(selectedReview)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
                            >
                                <Trash2 size={16} aria-hidden="true" /> Delete review
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {confirmDialog}
        </div>
    );
};

export default AdminReviews;
