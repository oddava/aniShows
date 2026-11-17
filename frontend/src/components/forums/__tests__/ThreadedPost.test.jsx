import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThreadedPost, { canReplyToPost } from '../ThreadedPost';

vi.mock('../../common/MiniProfileHoverCard', () => ({
    default: ({ children }) => children,
}));

vi.mock('../../common/MarkdownRenderer', () => ({
    default: ({ content, mode }) => <div data-testid="markdown" data-mode={mode}>{content}</div>,
}));

const author = { id: 2, username: 'kiyo', avatar: null };

const makePost = (overrides = {}) => ({
    id: 11,
    parent: null,
    depth: 0,
    content: 'Hello there',
    author,
    created_at: '2026-01-01T00:00:00Z',
    edited_at: null,
    like_count: 3,
    is_liked_by_user: false,
    reply_count: 0,
    is_removed: false,
    removal: null,
    has_hidden_replies: false,
    can_reply: true,
    replies: [],
    ...overrides,
});

function renderPost(postOverrides = {}, props = {}) {
    const handlers = {
        onEdit: vi.fn(),
        onDelete: vi.fn(),
        onLike: vi.fn(),
        onReply: vi.fn(),
        onRemove: vi.fn(),
        onRestore: vi.fn(),
        setEditingPostId: vi.fn(),
        setEditPostContent: vi.fn(),
        setReplyTo: vi.fn(),
    };
    const utils = render(
        <MemoryRouter>
            <ThreadedPost
                post={makePost(postOverrides)}
                user={{ username: 'viewer', is_staff: false }}
                isOwner={(name) => name === 'viewer'}
                editingPostId={null}
                editPostContent=""
                replyTo={null}
                createPostMutation={{ mutate: vi.fn(), isPending: false }}
                threadId="5"
                focusedPostId={null}
                threadAuthorUsername="op"
                {...handlers}
                {...props}
            />
        </MemoryRouter>,
    );
    return { ...utils, handlers };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ThreadedPost', () => {
    it('renders content in markdown mode with an edited marker', () => {
        renderPost({ edited_at: '2026-01-02T10:00:00Z' });

        expect(screen.getByTestId('markdown')).toHaveAttribute('data-mode', 'markdown');
        const edited = screen.getByText('edited');
        expect(edited.tagName).toBe('TIME');
        expect(edited).toHaveAttribute('dateTime', '2026-01-02T10:00:00Z');
        expect(edited.getAttribute('title')).toMatch(/^Edited /);
    });

    it('shows Reply below the depth cap', () => {
        renderPost({ depth: 9, can_reply: true });
        expect(screen.getByRole('button', { name: /^Reply$/ })).toBeInTheDocument();
    });

    it('hides Reply when the server says can_reply is false', () => {
        renderPost({ depth: 3, can_reply: false });
        expect(screen.queryByRole('button', { name: /^Reply$/ })).not.toBeInTheDocument();
    });

    it('hides Reply at absolute depth 10 even when the visual depth restarts (focus mode)', () => {
        // No can_reply from the server: the absolute depth decides, not the visual one
        renderPost({ depth: 10, can_reply: undefined }, { depth: 0 });
        expect(screen.queryByRole('button', { name: /^Reply$/ })).not.toBeInTheDocument();
    });

    it('falls back to depth and lock state without can_reply', () => {
        expect(canReplyToPost({ depth: 9 })).toBe(true);
        expect(canReplyToPost({ depth: 10 })).toBe(false);
        expect(canReplyToPost({ depth: 2 }, { threadLocked: true })).toBe(false);
        expect(canReplyToPost({ depth: 2 }, { threadLocked: true, isStaff: true })).toBe(true);
        expect(canReplyToPost({ depth: 2, is_removed: true })).toBe(false);
    });

    it('labels the like button with its count and pressed state', async () => {
        const { handlers } = renderPost({ like_count: 1, is_liked_by_user: true });
        const like = screen.getByRole('button', { name: 'Like reply, 1 like' });

        expect(like).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(like);
        expect(handlers.onLike).toHaveBeenCalledWith(11, true);
    });

    it('tells guests to sign in to like', () => {
        renderPost({}, { user: null });
        const like = screen.getByRole('button', { name: 'Sign in to like' });
        expect(like).toBeDisabled();
        expect(like).not.toHaveAttribute('aria-pressed');
    });

    it('gives owner actions accessible names and keeps them visible on focus', () => {
        renderPost({ author: { ...author, username: 'viewer' } });

        const edit = screen.getByRole('button', { name: 'Edit reply by viewer' });
        const remove = screen.getByRole('button', { name: 'Delete reply' });
        expect(edit.parentElement.className).toContain('focus-within:opacity-100');
        expect(remove.parentElement).toBe(edit.parentElement);
    });

    it('shows the moderator placeholder without author or content for non-staff', () => {
        renderPost({ is_removed: true, removal: 'moderator', content: '', author: null });

        expect(screen.getByText('This reply was removed')).toBeInTheDocument();
        expect(screen.queryByTestId('markdown')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Like reply/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Reply$/ })).not.toBeInTheDocument();
    });

    it('shows [deleted] for an author-removed post and keeps its replies', () => {
        renderPost({
            is_removed: true,
            removal: 'author',
            content: '',
            author: null,
            replies: [makePost({ id: 12, parent: 11, depth: 1, content: 'child reply' })],
        });

        expect(screen.getByText('[deleted]')).toBeInTheDocument();
        expect(screen.getByText('child reply')).toBeInTheDocument();
    });

    it('offers the Moderate disclosure only to staff', async () => {
        renderPost();
        expect(screen.queryByRole('button', { name: 'Moderate' })).not.toBeInTheDocument();
    });

    it('lets staff remove a reply with an optional reason', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue('  spam  ');
        const { handlers } = renderPost({}, { user: { username: 'mod', is_staff: true }, isStaff: true });

        const toggle = screen.getByRole('button', { name: 'Moderate' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');

        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(handlers.onRemove).toHaveBeenCalledWith(11, 'spam');
    });

    it('does not remove when the moderator cancels the prompt', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue(null);
        const { handlers } = renderPost({}, { user: { username: 'mod', is_staff: true }, isStaff: true });

        await userEvent.click(screen.getByRole('button', { name: 'Moderate' }));
        await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
        expect(handlers.onRemove).not.toHaveBeenCalled();
    });

    it('shows staff the removed content with a notice and a Restore action', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { handlers } = renderPost(
            { is_removed: true, removal: 'moderator', removal_reason: 'spam' },
            { user: { username: 'mod', is_staff: true }, isStaff: true },
        );

        expect(screen.getByText('Hello there')).toBeInTheDocument();
        expect(screen.getByText(/Removed by a moderator: spam/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Moderate' }));
        await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
        expect(handlers.onRestore).toHaveBeenCalledWith(11);
    });

    it('offers "Continue this thread" at the visual cap and for hidden replies', () => {
        const child = makePost({ id: 12, parent: 11, depth: 9, content: 'too deep to show' });
        const { unmount } = renderPost({ depth: 8, replies: [child] }, { depth: 8, maxDepth: 8 });
        expect(screen.getByRole('button', { name: /Continue this thread/ })).toBeInTheDocument();
        expect(screen.queryByText('too deep to show')).not.toBeInTheDocument();
        unmount();

        renderPost({ hasHiddenReplies: true, has_hidden_replies: true, replies: [] });
        expect(screen.getByRole('button', { name: /Continue this thread/ })).toBeInTheDocument();
    });

    it('offers "More replies" when some replies are loaded and more were cut', () => {
        const child = makePost({ id: 12, parent: 11, depth: 1, content: 'loaded child' });
        renderPost({ hasHiddenReplies: true, replies: [child] });

        const replies = screen.getByText('loaded child').closest('.mt-6');
        expect(within(replies).getByRole('button', { name: /More replies/ })).toBeInTheDocument();
    });
});
