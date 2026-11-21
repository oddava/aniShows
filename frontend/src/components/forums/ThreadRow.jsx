import { memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import Avatar from './Avatar';
import MiniProfileHoverCard from '../common/MiniProfileHoverCard';
import { DeletedAuthorAvatar, DeletedAuthorName } from './DeletedAuthor';

// List items carry a server-made `excerpt` (markup and spoilers stripped); `content` is a fallback.
export const getThreadPreview = (thread) => {
    const plainText = (thread?.excerpt ?? thread?.content)?.replace(/[#*`]/g, '').replace(/\s+/g, ' ').trim() || '';
    if (!plainText) return '';
    return plainText.length > 180 ? `${plainText.substring(0, 180)}…` : plainText;
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** A soft-fill tab or chip (the active one is a lighter fill, never an accent pill). */
export const forumTabClass = (active) => (
    `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${active
        ? 'bg-white/[0.07] text-[var(--text-1)]'
        : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`
);

/** "Pinned", "Locked" and the thread's tags as quiet neutral chips. */
export function ThreadChips({ thread, showPinned = true }) {
    return (
        <>
            {showPinned && thread.is_pinned && <span className="forum-chip">Pinned</span>}
            {thread.is_locked && <span className="forum-chip">Locked</span>}
            {thread.tags?.map((tag) => (
                <span key={tag.id} className="forum-chip">{tag.name}</span>
            ))}
        </>
    );
}

/**
 * One thread in a list: title, a two-line excerpt and a meta line (author,
 * age, chips, reply and view counts). The whole row opens the thread; the
 * author link inside it keeps its own target.
 */
const ThreadRow = memo(({ thread, compact = false }) => {
    const navigate = useNavigate();
    const open = () => navigate(`/forums/thread/${thread.id}`);
    const preview = compact ? '' : getThreadPreview(thread);
    const replies = thread.reply_count ?? 0;
    const views = thread.view_count ?? 0;

    return (
        <div
            role="link"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    open();
                }
            }}
            className="forum-row"
        >
            <h3 className="line-clamp-2 text-[17px] font-semibold leading-snug text-[var(--text-1)]">
                {thread.title}
            </h3>
            {preview && (
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-[var(--text-2)]">{preview}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-[var(--text-3)]">
                {thread.author ? (
                    <MiniProfileHoverCard user={thread.author}>
                        <Link
                            to={`/u/${thread.author.username}`}
                            onClick={(e) => e.stopPropagation()}
                            className="relative inline-flex items-center gap-2 font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text-1)] after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']"
                        >
                            <Avatar user={thread.author} size="xs" />
                            {thread.author.username}
                        </Link>
                    </MiniProfileHoverCard>
                ) : (
                    <span className="inline-flex items-center gap-2">
                        <DeletedAuthorAvatar size="xs" />
                        <DeletedAuthorName className="italic text-[var(--text-3)]" />
                    </span>
                )}
                {thread.created_at && (
                    <>
                        <span aria-hidden="true">·</span>
                        <span className="whitespace-nowrap">
                            {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
                        </span>
                    </>
                )}
                <ThreadChips thread={thread} />
                <span className="tabular whitespace-nowrap sm:ml-auto">
                    {plural(replies, 'reply', 'replies')} · {plural(views, 'view', 'views')}
                </span>
            </div>
        </div>
    );
});
ThreadRow.displayName = 'ThreadRow';

export default ThreadRow;
