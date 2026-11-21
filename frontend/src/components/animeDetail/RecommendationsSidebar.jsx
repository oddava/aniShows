import SectionHeader from '../common/SectionHeader';
import { RelatedListRow, RelatedPosterCard } from './RelatedAnimeCards';

// Fewer than this and a poster row looks empty: show a list instead.
const MIN_POSTERS = 4;

/**
 * Recommendations under the main column (D3): a row of posters, or a short
 * list when there are only one to three.
 * `containerRef` lets the page fetch them only once this block nears the
 * viewport, so the container renders even before there is data.
 */
export default function RecommendationsSidebar({ anime, recommendations, containerRef }) {
    const items = Array.isArray(recommendations) ? recommendations.slice(0, 6) : [];
    const genre = anime.genres?.[0]?.slug;

    return (
        <section ref={containerRef} aria-labelledby={items.length > 0 ? 'recommendations-heading' : undefined} className={items.length > 0 ? 'panel mt-4' : undefined}>
            {items.length > 0 && (
                <>
                    <SectionHeader
                        id="recommendations-heading"
                        title="Recommendations"
                        viewAllTo={recommendations.length > 5 && genre ? `/browse?genre=${genre}` : undefined}
                        viewAllLabel="Find more like this"
                    />
                    {items.length < MIN_POSTERS ? (
                        <div className="grid grid-cols-1 gap-x-10 gap-y-1 lg:grid-cols-2">
                            {items.map((rel) => (
                                <RelatedListRow key={rel.id} anime={rel} />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 lg:gap-x-4">
                            {items.map((rel) => (
                                <RelatedPosterCard key={rel.id} anime={rel} />
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
