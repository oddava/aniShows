import React from 'react';

const LoadingSpinner = ({ size = 24, className = "" }) => {
    return (
        <div className={`flex items-center justify-center w-full min-h-[100px] ${className}`}>
            <div 
                className="border-2 border-gray-700 border-t-purple-500 rounded-full"
                style={{ width: size, height: size }}
            />
        </div>
    );
};

export default LoadingSpinner;
