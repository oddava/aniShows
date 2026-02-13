import React from 'react';

/**
 * Top loading progress bar component
 * Shows animated progress during loading states
 */
export function LoadingBar({ isLoading }) {
    if (!isLoading) return null;

    return (
        <div className="fixed top-0 left-0 right-0 h-1 z-[100] overflow-hidden">
            <div className="h-full animate-progress-bar" />
        </div>
    );
}

/**
 * Loading overlay with blur effect
 * Used during tab switches and major state changes
 */
export function LoadingOverlay({ isLoading, children, showSkeleton = false }) {
    return (
        <div className="relative">
            {/* Content with fade effect */}
            <div 
                className={`transition-all duration-300 ${isLoading ? 'opacity-40 scale-[0.995] blur-[1px]' : 'opacity-100 scale-100 blur-0'}`}
            >
                {children}
            </div>
            
            {/* Overlay skeleton during loading */}
            {isLoading && showSkeleton && (
                <div className="absolute inset-0 flex items-start justify-center pt-8 pointer-events-none tab-switch-overlay">
                    <div className="w-full max-w-6xl px-4">
                        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4 opacity-60">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div 
                                    key={i} 
                                    className="aspect-[2/3] rounded-xl bg-dark-100/80 skeleton-fade-in"
                                    style={{ animationDelay: `${i * 40}ms` }}
                                >
                                    <div className="w-full h-full skeleton-wave" />
                                </div>
                            ))}
                        </div>                    </div>
                </div>
            )}
        </div>
    );
}

export default LoadingBar;
