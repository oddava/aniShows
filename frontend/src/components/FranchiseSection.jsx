import { Film } from 'lucide-react';

export default function FranchiseSection({ relations, accentColor }) {
    if (!relations || relations.length === 0) return null;

    // Sort relations: show sequels/prequels first, then others
    const priorityOrder = ['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY'];
    const sortedRelations = [...relations].sort((a, b) => {
        const aPriority = priorityOrder.indexOf(a.type);
        const bPriority = priorityOrder.indexOf(b.type);
        if (aPriority === -1 && bPriority === -1) return 0;
        if (aPriority === -1) return 1;
        if (bPriority === -1) return -1;
        return aPriority - bPriority;
    });

    // Take only first 6 most relevant
    const displayRelations = sortedRelations.slice(0, 6);

    const relationLabels = {
        PREQUEL: 'Prequel',
        SEQUEL: 'Sequel',
        PARENT: 'Parent',
        SIDE_STORY: 'Side Story',
        CHARACTER: 'Character',
        SUMMARY: 'Summary',
        ALTERNATIVE: 'Alt.',
        SPIN_OFF: 'Spin-off',
        OTHER: 'Related',
    };

    return (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <div className="w-1 h-5 rounded-full" style={{ backgroundColor: accentColor || '#8b5cf6' }} />
                    Franchise
                    {relations.length > 6 && (
                        <span className="text-xs font-normal text-gray-500">({relations.length} total)</span>
                    )}
                </h2>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide snap-x snap-mandatory pl-0 sm:pl-0">
                {displayRelations.map((rel) => (
                    <div
                        key={rel.id}
                        className="relative flex-shrink-0 w-28 snap-start cursor-default"
                    >
                        <div className="aspect-[2/3] rounded-lg overflow-hidden border border-gray-800 bg-dark-200">
                            {rel.cover ? (
                                <img
                                    src={rel.cover}
                                    alt={rel.title}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-700 bg-dark-300">
                                    <Film className="w-8 h-8" />
                                </div>
                            )}

                            {/* Relation type badge */}
                            <div className="absolute top-1.5 left-1.5">
                                <span
                                    className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-black/60 text-white backdrop-blur-sm"
                                >
                                    {relationLabels[rel.type] || 'Related'}
                                </span>
                            </div>
                        </div>

                        <h4 className="text-xs font-bold text-gray-300 line-clamp-2 leading-tight mt-1.5">
                            {rel.title}
                        </h4>
                    </div>
                ))}
            </div>
        </div>
    );
}
