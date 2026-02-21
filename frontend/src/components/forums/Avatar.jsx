import React from 'react';

const Avatar = ({ user, size = 'md' }) => {
    const dims = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
    if (user?.avatar) {
        return (
            <img
                src={user.avatar}
                alt={user.username}
                className={`${dims} rounded-full object-cover`}
                loading="lazy"
            />
        );
    }
    return (
        <div className={`${dims} rounded-full bg-accent/15 flex items-center justify-center font-bold text-accent-light`}>
            {user?.username?.substring(0, 2).toUpperCase()}
        </div>
    );
};

export default Avatar;