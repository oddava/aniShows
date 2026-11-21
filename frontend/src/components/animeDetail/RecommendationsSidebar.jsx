import SectionHeader from '../common/SectionHeader';
import { RelatedPosterCard } from './RelatedAnimeCards';

/**
 * Recommendations as a row of posters under the main column (D3).
 * `containerRef` lets the page fetch them only once this block nears the
 * viewport, so the container renders even before there is data.
 */
export default function RecommendationsSidebar({ anime, recommendations, containerRef }) {
    const items = Array.isArray(recommendations) ? recommendations.slice(0, 6) : [];
    const genre = anime.genres?.[0]?.slug;

    return (
        <section ref={containerRef} aria-labelledby={items.length > 0 ? 'recommendations-heading' : undefined} className={items.length > 0 ? 'mt-16' : undefined}>
            {items.length > 0 && (
                <>
                    <SectionHeader
                        id="recommendations-heading"
                        title="Recommendations"
                        viewAllTo={recommendations.length > 5 && genre ? `/browse?genre=${genre}` : undefined}
                        viewAllLabel="Find more like this"
                    />
                    <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 lg:gap-x-4">
                        {items.map((rel) => (
                            <RelatedPosterCard key={rel.id} anime={rel} />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}
