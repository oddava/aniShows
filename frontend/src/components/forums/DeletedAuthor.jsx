import Avatar from './Avatar';

/** What a deleted account's threads and posts show instead of its name (owner decision D-6). */
export const DELETED_AUTHOR_LABEL = 'deleted user';

/** A neutral avatar and "deleted user": no profile link, no hover card. */
export function DeletedAuthorAvatar({ size = 'md' }) {
    return <Avatar user={null} size={size} />;
}

export function DeletedAuthorName({ className = 'text-sm italic text-gray-500' }) {
    return <span className={className}>{DELETED_AUTHOR_LABEL}</span>;
}
