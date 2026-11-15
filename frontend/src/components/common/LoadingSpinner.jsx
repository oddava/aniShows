import React from 'react';

const LoadingSpinner = ({ size = 24, className = "", label = "Loading" }) => {
    return (
        <div role="status" className={`flex items-center justify-center w-full min-h-[100px] ${className}`}>
            <div
                aria-hidden="true"
                className="border-2 border-gray-700 border-t-accent rounded-full animate-spin"
                style={{ width: size, height: size }}
            />
            <span className="sr-only">{label}</span>
        </div>
    );
};

export default LoadingSpinner;
