import { useQuery, useQueryClient, useMutation, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Star, Heart, Play, Calendar, Clock, Tv, MessageSquare, Loader } from 'lucide-react';
import { useState, useEffect } from 'react';
import { animeApi, favoriteApi, reviewApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import AnimeCard from '../components/AnimeCard';
import StatusSelector from '../components/StatusSelector';
import ReviewCard from '../components/ReviewCard';
import ReviewForm from '../components/ReviewForm';

export default function AnimeDetail() {
    const { slug } = useParams();
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const [isFavorite, setIsFavorite] = useState(false);
    const [isWritingReview, setIsWritingReview] = useState(false);
    const [editingReview, setEditingReview] = useState(null);

    const { data: anime, isLoading, isError } = useQuery({
        queryKey: ['anime', slug],
        queryFn: () => animeApi.getBySlug(slug).then(res => res.data),
        refetchOnMount: 'always',
    });

    // Infinite Query for Pagination
    const {
        data: reviewsData,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading: reviewsLoading
    } = useInfiniteQuery({
        queryKey: ['reviews', slug],
        queryFn: ({ pageParam = 1 }) => reviewApi.getAll({ anime: slug, page: pageParam }).then(res => res.data),
        getNextPageParam: (lastPage) => {
            if (lastPage.next) {
                try {
                    const url = new URL(lastPage.next);
                    return url.searchParams.get('page');
                } catch (e) { return undefined; }
            }
            return undefined;
        },
        enabled: !!slug
    });

    const reviews = reviewsData?.pages.flatMap(page => {
        if (Array.isArray(page)) return page;
        return page.results || [];
    }) || [];

    const reviewCount = reviewsData?.pages[0]?.count ?? anime?.review_count ?? reviews.length;

    useEffect(() => {
        if (anime) {
            setIsFavorite(anime.is_favorite || false);
            document.title = `${anime.title} - AniShows`;
        }
    }, [anime]);

    const { data: related } = useQuery({
        queryKey: ['anime', slug, 'related'],
        queryFn: () => animeApi.getRelated(slug).then(res => res.data),
        enabled: !!anime,
    });

    const createReviewMutation = useMutation({
        mutationFn: (data) => reviewApi.create({ ...data, anime_slug: slug }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
            }
            setIsWritingReview(false);
        },
    });

    const updateReviewMutation = useMutation({
        mutationFn: ({ id, data }) => reviewApi.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
            setEditingReview(null);
        },
    });

    const deleteReviewMutation = useMutation({
        mutationFn: (id) => reviewApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reviews'] });
            queryClient.invalidateQueries({ queryKey: ['anime', slug] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
            }
        },
    });

    const handleFavorite = async () => {
        if (!isAuthenticated) return;
        try {
            const response = await favoriteApi.toggle(anime.id);
            setIsFavorite(response.data.is_favorite);
            // Invalidate profile and favorites to update counts/lists
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['profile', user.username] });
                queryClient.invalidateQueries({ queryKey: ['favorites', user.username] });
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
        }
    };

    const handleListUpdate = () => {
        queryClient.invalidateQueries({ queryKey: ['anime', slug] });
    };

    const handleReviewSubmit = async (data) => {
        if (editingReview) {
            await updateReviewMutation.mutateAsync({ id: editingReview.id, data });
        } else {
            await createReviewMutation.mutateAsync(data);
        }
    };

    const userReview = reviews.find(r => r.user?.username === user?.username);
    const canReview = isAuthenticated && anime?.user_list_status != null;

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (isError || !anime) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center">
                <p className="text-gray-400 mb-4">Anime not found</p>
                <Link to="/browse" className="btn-primary">Browse Anime</Link>
            </div>
        );
    }

    // Helper to handle image URLs and use proxy
    const getImageUrl = (url) => {
        if (!url) return null;
        let cleanUrl = url;
        if (cleanUrl.includes('localhost:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/localhost:8000/, '');
        }
        if (cleanUrl.includes('web:8000')) {
            cleanUrl = cleanUrl.replace(/^https?:\/\/web:8000/, '');
        }
        if (cleanUrl.startsWith('http')) return cleanUrl;
        if (!cleanUrl.startsWith('/')) {
            cleanUrl = `/${cleanUrl}`;
        }
        return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
    };

    const bannerUrl = getImageUrl(anime.banner_image) || getImageUrl(anime.cover_image) || `https://placehold.co/1920x600/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;
    const coverUrl = getImageUrl(anime.cover_image) || `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(anime.title)}`;

    return (
        <div className="min-h-screen">
            {/* Banner */}
            <div className="relative h-[40vh] min-h-[300px] overflow-hidden">
                <img
                    src={bannerUrl}
                    alt={anime.title}
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-dark/80 via-transparent to-transparent" />
            </div>

            {/* Content */}
            <div className="relative -mt-32 px-4 pb-16">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col md:flex-row gap-8">
                        {/* Cover Image */}
                        <div className="flex-shrink-0 mx-auto md:mx-0">
                            <img
                                src={coverUrl}
                                alt={anime.title}
                                className="w-48 md:w-64 rounded-2xl shadow-2xl border border-gray-800"
                            />
                        </div>

                        {/* Info */}
                        <div className="flex-1 text-center md:text-left">
                            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
                                {anime.title}
                            </h1>
                            {anime.title_jp && (
                                <p className="text-gray-400 mb-4">{anime.title_jp}</p>
                            )}

                            {/* Stats */}
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-6">
                                {anime.rating && (
                                    <div className="flex items-center gap-1.5 text-yellow-400">
                                        <Star className="w-5 h-5 fill-current" />
                                        <span className="font-semibold text-lg">{anime.rating}</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5 text-gray-400">
                                    <Tv className="w-4 h-4" />
                                    <span>{anime.anime_type}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-gray-400">
                                    <Clock className="w-4 h-4" />
                                    <span>{anime.episode_count} episodes</span>
                                </div>
                                {anime.release_date && (
                                    <div className="flex items-center gap-1.5 text-gray-400">
                                        <Calendar className="w-4 h-4" />
                                        <span>{new Date(anime.release_date).getFullYear()}</span>
                                    </div>
                                )}
                            </div>

                            {/* Genres */}
                            <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-6">
                                {anime.genres?.map((genre) => (
                                    <Link
                                        key={genre.id}
                                        to={`/browse?genre=${genre.slug}`}
                                        className="badge hover:bg-accent hover:text-white transition-colors"
                                    >
                                        {genre.name}
                                    </Link>
                                ))}
                            </div>

                            {/* Actions */}
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mb-8">
                                {isAuthenticated ? (
                                    <>
                                        <button
                                            onClick={handleFavorite}
                                            className={`btn-secondary flex items-center gap-2 ${isFavorite ? 'bg-red-500/20 border-red-500 text-red-400' : ''}`}
                                        >
                                            <Heart className={`w-5 h-5 ${isFavorite ? 'fill-current' : ''}`} />
                                            {isFavorite ? 'Favorited' : 'Add to Favorites'}
                                        </button>
                                        <StatusSelector
                                            animeId={anime.id}
                                            initialStatus={anime.user_list_status}
                                            onUpdate={handleListUpdate}
                                            totalEpisodes={anime.episode_count}
                                        />
                                    </>
                                ) : (
                                    <Link to="/login" className="btn-primary">
                                        Sign In to Track
                                    </Link>
                                )}
                            </div>

                            {/* Synopsis */}
                            <div className="mb-8">
                                <h2 className="text-xl font-semibold text-white mb-3">Synopsis</h2>
                                <p className="text-gray-400 leading-relaxed">{anime.synopsis}</p>
                            </div>

                            {/* Trailer Player */}
                            {anime.trailer_url && (() => {
                                const getYouTubeId = (url) => {
                                    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
                                    return match ? match[1] : null;
                                };
                                const videoId = getYouTubeId(anime.trailer_url);
                                if (!videoId) return null;
                                return (
                                    <div className="mb-8">
                                        <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2">
                                            <Play className="w-5 h-5 text-accent" /> Trailer
                                        </h2>
                                        <div className="relative rounded-xl overflow-hidden border border-gray-800 aspect-video max-w-2xl">
                                            <iframe
                                                src={`https://www.youtube.com/embed/${videoId}`}
                                                title="Trailer"
                                                frameBorder="0"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                                className="absolute inset-0 w-full h-full"
                                            />
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Studio */}
                            {anime.studio && (
                                <div className="mb-8">
                                    <h2 className="text-xl font-semibold text-white mb-3">Studio</h2>
                                    <p className="text-gray-400">{anime.studio.name}</p>
                                </div>
                            )}

                            {/* Reviews Section */}
                            <div className="mb-16">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                        <MessageSquare className="w-6 h-6 text-accent" />
                                        Reviews
                                        <span className="text-sm font-normal text-gray-400 bg-dark-50 px-3 py-1 rounded-full border border-gray-800">
                                            {reviewCount}
                                        </span>
                                    </h2>

                                    {isAuthenticated && !isWritingReview && !editingReview && !userReview && (
                                        canReview ? (
                                            <button
                                                onClick={() => setIsWritingReview(true)}
                                                className="btn-primary text-sm px-4 py-2"
                                            >
                                                Write a Review
                                            </button>
                                        ) : (
                                            <div className="text-xs text-gray-500 bg-dark-50 px-3 py-2 rounded-lg border border-gray-800">
                                                Add to list to review
                                            </div>
                                        )
                                    )}
                                </div>

                                {/* Review Form */}
                                {(isWritingReview || editingReview) && (
                                    <div className="mb-8">
                                        <ReviewForm
                                            initialData={editingReview}
                                            onSubmit={handleReviewSubmit}
                                            onCancel={() => {
                                                setIsWritingReview(false);
                                                setEditingReview(null);
                                            }}
                                            animeTitle={anime.title}
                                        />
                                    </div>
                                )}

                                {/* Reviews List */}
                                <div className="space-y-4">
                                    {reviewsLoading ? (
                                        <div className="text-center py-8">
                                            <Loader className="w-8 h-8 text-accent animate-spin mx-auto" />
                                        </div>
                                    ) : reviews.length > 0 ? (
                                        <>
                                            {reviews.map((review) => (
                                                <ReviewCard
                                                    key={review.id}
                                                    review={review}
                                                    onEdit={setEditingReview}
                                                    onDelete={deleteReviewMutation.mutate}
                                                />
                                            ))}

                                            {hasNextPage && (
                                                <div className="text-center mt-6">
                                                    <button
                                                        onClick={() => fetchNextPage()}
                                                        disabled={isFetchingNextPage}
                                                        className="btn-secondary text-sm px-6 py-2"
                                                    >
                                                        {isFetchingNextPage ? (
                                                            <Loader className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            'Load More Reviews'
                                                        )}
                                                    </button>
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        !isWritingReview && (
                                            <div className="text-center py-12 bg-dark-100 rounded-xl border border-gray-800 border-dashed">
                                                <p className="text-gray-400 mb-2">No reviews yet.</p>
                                                {canReview && (
                                                    <button
                                                        onClick={() => setIsWritingReview(true)}
                                                        className="text-accent hover:underline font-medium"
                                                    >
                                                        Be the first to share your thoughts!
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* Related Anime */}
                    {related && related.length > 0 && (
                        <div className="mt-8">
                            <h2 className="text-2xl font-bold text-white mb-6">Related Anime</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 md:gap-6">
                                {related.slice(0, 6).map((anime) => (
                                    <AnimeCard key={anime.id} anime={anime} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
