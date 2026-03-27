import React, { useId } from 'react';

const Logo = ({ className = "w-10 h-10", showText = true, textClassName = "text-xl font-bold text-white", text = "AniShows" }) => {
    return (
        <div className="flex items-center gap-1 group">
            {showText && (
                <span className={textClassName}>
                    {text}
                </span>
            )}
        </div>
    );
};

export default Logo;
