import PropTypes from 'prop-types';
import SectionHeader from '../common/SectionHeader';
import AnimeCard, { AnimeCardSkeleton } from '../AnimeCard';

export default function CategoryRow({
    title,
    animeList,
    isLoading,
    viewAllLink,
    skeletonCount = 6,
    eagerCount = 0,
    titleLanguage = 'en',
}) {
    const handleViewAllClick = () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    return (
        <section className="pb-2 mb-8 md:mb-12">
            <div className="max-w-7xl mx-auto">
                <SectionHeader
                    title={title}
                    viewAllTo={viewAllLink}
                    onViewAllClick={handleViewAllClick}
                />

                <div className="flex md:grid md:grid-cols-3 lg:grid-cols-6 anime-card-row-gap overflow-x-auto md:overflow-visible scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 pb-4 md:pb-0 snap-x snap-mandatory md:snap-none scroll-px-4 overscroll-x-contain">
                    {isLoading ? (
                        Array(skeletonCount).fill(0).map((_, i) => (
                            <div key={i} className="flex-shrink-0 w-[140px] xs:w-[160px] md:w-auto h-full snap-start">
                                <AnimeCardSkeleton />
                            </div>
                        ))
                    ) : animeList?.length > 0 ? (
                        animeList.map((anime, index) => (
                            <div key={anime.id} className="flex-shrink-0 w-[140px] xs:w-[160px] md:w-auto h-full snap-start">
                                <AnimeCard
                                    anime={anime}
                                    titleLanguage={titleLanguage}
                                    index={index}
                                    priority={index < eagerCount}
                                    eagerFirstSix={false}
                                    showMeta
                                />
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
    skeletonCount: PropTypes.number,
    eagerCount: PropTypes.number,
    titleLanguage: PropTypes.oneOf(['en', 'jp']),
};
