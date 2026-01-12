export default function StatusDistribution({ distribution, accentColor }) {
    if (!distribution) return null;

    const statusConfig = {
        'Plan to Watch': { label: 'Plan', color: '#4ade80' },
        'Watching': { label: 'Watch', color: '#06b6d4' },
        'On Hold': { label: 'Hold', color: '#a855f7' },
        'Completed': { label: 'Done', color: '#f472b6' },
        'Dropped': { label: 'Drop', color: '#f43f5e' }
    };

    const order = ['Plan to Watch', 'Watching', 'On Hold', 'Completed', 'Dropped'];

    const data = order.map(status => ({
        status,
        label: statusConfig[status]?.label || status,
        count: distribution[status] || 0,
        color: statusConfig[status]?.color || '#6b7280'
    }));

    const total = data.reduce((acc, curr) => acc + curr.count, 0);

    return (
        <div className="flex flex-col gap-6 bg-dark-100/50 p-6 rounded-2xl border border-gray-800 shadow-xl">
            <h3
                className="text-white font-bold uppercase text-[10px] tracking-[0.2em]"
                style={{ color: accentColor ? `${accentColor}cc` : '#8b5cf6cc' }}
            >
                Status Distribution
            </h3>

            {/* 5-Column Grid with shorter labels */}
            <div className="grid grid-cols-5 gap-2">
                {data.map((item) => {
                    const isActive = item.count > 0;
                    return (
                        <div
                            key={item.status}
                            className="flex flex-col items-center justify-end text-center"
                        >
                            {/* Number */}
                            <span
                                className={`font-black leading-none ${isActive ? 'text-white text-xl' : 'text-gray-700 text-sm'
                                    }`}
                            >
                                {item.count}
                            </span>

                            {/* Label - shortened to prevent collision */}
                            <span
                                className="text-[9px] font-bold uppercase tracking-wide mt-1.5"
                                style={{
                                    color: isActive ? item.color : '#374151'
                                }}
                            >
                                {item.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Progress Bar matching page style */}
            <div className="relative h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                <div className="absolute inset-0 flex items-center gap-[1px]">
                    {total > 0 ? (
                        data.map((item) => {
                            const width = (item.count / total) * 100;
                            if (width === 0) return null;

                            return (
                                <div
                                    key={item.status}
                                    className="h-full first:rounded-l-full last:rounded-r-full"
                                    style={{
                                        width: `${width}%`,
                                        backgroundColor: item.color,
                                        borderRadius: total === item.count ? '999px' : undefined
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
