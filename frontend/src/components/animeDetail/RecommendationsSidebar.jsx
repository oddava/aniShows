import { Link } from 'react-router-dom';
import { MobileRelatedCard, RelatedAnimeCard } from './RelatedAnimeCards';

/** Column 3: recommendations (a list on large screens, a carousel below). */
export default function RecommendationsSidebar({ anime, recommendations, accentColor }) {
    return (
        <div className="space-y-6 lg:space-y-8 lg:pt-40">
            {recommendations && recommendations.length > 0 && (
                <div>
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em] mb-4 sm:mb-6">
                        Recommendations
                    </h2>
                    <div className="hidden lg:grid grid-cols-1 gap-4">
                        {recommendations.slice(0, 5).map((rel) => (
                            <RelatedAnimeCard
                                key={rel.id}
                                anime={rel}
                            />
                        ))}
                    </div>
                    <div className="lg:hidden flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory pl-0 sm:pl-0">
                        {recommendations.slice(0, 6).map((rel) => (
                            <MobileRelatedCard
                                key={rel.id}
                                anime={rel}
                            />
                        ))}
                    </div>
                    {recommendations.length > 5 && (
                        <Link
                            to={`/browse?genre=${anime.genres?.[0]?.slug || ''}`}
                            className="block text-center mt-4 sm:mt-6 text-xs font-bold hover:text-white transition-colors py-2 rounded-lg border"
                            style={{
                                color: accentColor || '#75698d',
                                backgroundColor: accentColor ? `${accentColor}10` : 'rgba(117,105,141,0.05)',
                                borderColor: accentColor ? `${accentColor}1a` : 'rgba(117,105,141,0.1)'
                            }}
                        >
                            FIND MORE TITLES LIKE THIS
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}
