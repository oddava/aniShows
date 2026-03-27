import React from 'react';

const Logo = ({ showText = true, textClassName = "text-xl font-bold text-white", text = "AniShows" }) => {
    return (
        <div className="flex items-center group">
            {showText && (
                <span className={textClassName}>
                    {text}
                </span>
            )}
        </div>
    );
};

export default Logo;
