import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import AnimeCard, { AnimeCardSkeleton } from '../AnimeCard';

export default function CategoryRow({ title, animeList, isLoading, viewAllLink, skeletonCount = 6 }) {
    const handleViewAllClick = () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    return (
        <section className="px-4 md:px-0 pb-2 mb-8 md:mb-12">
            <div className="max-w-7xl mx-auto">
                <div className="flex items-center justify-between mb-4 md:mb-6">
                    <div>
                        <h2 className="text-sm md:text-base font-bold text-gray-400 uppercase tracking-[0.12em]">{title}</h2>
                    </div>
                    {viewAllLink && (
                        <Link
                            to={viewAllLink}
                            onClick={handleViewAllClick}
                            className="flex items-center gap-1 text-sm font-bold text-gray-400 hover:text-accent transition-colors group uppercase tracking-widest"
                        >
                            VIEW ALL <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </Link>
                    )}
                </div>

                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 md:gap-5 overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-4 md:pb-0 touch-pan-x touch-pan-y overscroll-x-contain">
                    {isLoading ? (
                        Array(skeletonCount).fill(0).map((_, i) => (
                            <div key={i} className="flex-shrink-0 w-[140px] xs:w-[160px] md:w-auto h-full">
                                <AnimeCardSkeleton />
                            </div>
                        ))
                    ) : animeList?.length > 0 ? (
                        animeList.map((anime, index) => (
                            <div key={anime.id} className="flex-shrink-0 w-[140px] xs:w-[160px] md:w-auto h-full">
                                <AnimeCard anime={anime} priority={index < 6} />
                            </div>
                        ))
                    ) : (
                        <div className="w-full col-span-full text-center py-8 text-gray-500">No anime found</div>
                    )}
                </div>
            </div>
        </section>
    );
}

CategoryRow.propTypes = {
    title: PropTypes.string.isRequired,
    animeList: PropTypes.array,
    isLoading: PropTypes.bool,
    viewAllLink: PropTypes.string,
    skeletonCount: PropTypes.number
};
