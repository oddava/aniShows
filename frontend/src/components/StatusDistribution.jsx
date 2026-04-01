
const STATUSES = [
    { key: 'Plan to Watch', label: 'Plan', color: '#4ade80' },
    { key: 'Watching', label: 'Watch', color: '#06b6d4' },
    { key: 'On Hold', label: 'Hold', color: '#a855f7' },
    { key: 'Completed', label: 'Done', color: '#f472b6' },
    { key: 'Dropped', label: 'Drop', color: '#f43f5e' },
];

export default function StatusDistribution({ anime, className = "" }) {
    const distribution = anime?.status_distribution || {};
    const totalMembers = Object.values(distribution).reduce((a, b) => a + b, 0);

    return (
        <div className={`bg-dark-100/50 rounded-2xl p-6 border border-gray-800 ${className}`}>

            
            <div className="grid grid-cols-5 gap-2 mb-4">
                {STATUSES.map(({ key, label, color }) => {
                    const count = distribution[key] || 0;
                    const isActive = count > 0;
                    return (
                        <div key={key} className="flex flex-col items-center text-center">
                            <span className={`font-black leading-none ${isActive ? 'text-white text-xl' : 'text-gray-700 text-sm'}`}>
                                {count}
                            </span>
                            <span 
                                className="text-[9px] font-bold uppercase tracking-wide mt-1.5"
                                style={{ color: isActive ? color : '#374151' }}
                            >
                                {label}
                            </span>
                        </div>
                    );
                })}
            </div>
            
            <div className="relative h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                <div className="absolute inset-0 flex items-center gap-[1px]">
                    {totalMembers > 0 ? (
                        STATUSES.map(({ key, color }) => {
                            const count = distribution[key] || 0;
                            const width = (count / totalMembers) * 100;
                            if (width === 0) return null;
                            return (
                                <div
                                    key={key}
                                    className="h-full first:rounded-l-full last:rounded-r-full"
                                    style={{
                                        width: `${width}%`,
                                        backgroundColor: color,
                                        borderRadius: totalMembers === count ? '999px' : undefined
                                    }}
                                />
                            );
                        })
                    ) : (
                        <div className="h-full w-full bg-gray-700 rounded-full" />
                    )}
                </div>
            </div>
        </div>
    );
}
