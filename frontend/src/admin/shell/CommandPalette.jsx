import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, Search } from 'lucide-react';

import useAdminFocusTrap from '../useFocusTrap';
import { useScrollLock } from '../ui/Overlay';
import { adminApi, adminKeys } from '../api';
import { useDebouncedValue, useRole } from '../hooks';
import { animeTypeLabel, humanize } from '../format';
import { Avatar, Poster } from '../ui';
import { flatNav } from './nav';

const MIN_QUERY = 2;

/** Where each kind of search result opens in the admin. */
export const resultHref = {
    user: (item) => `/admin/users/${item.id}`,
    anime: (item) => `/admin/anime/${item.id}`,
    review: (item) => `/admin/reviews?open=${item.id}`,
    thread: (item) => `/admin/forums?tab=threads&open=${item.id}`,
};

function buildGroups(query, pages, data) {
    const term = query.trim().toLowerCase();
    const groups = [];
    const pageMatches = (term ? pages.filter((page) => page.label.toLowerCase().includes(term)) : pages).slice(0, term ? 5 : 8);
    if (pageMatches.length) {
        groups.push({
            key: 'pages',
            title: 'Go to',
            items: pageMatches.map((page) => ({ key: `page-${page.to}`, href: page.to, label: page.label, icon: page.icon, kind: 'page' })),
        });
    }
    if (!data) return groups;
    const add = (key, title, rows, toItem) => {
        if (rows?.length) groups.push({ key, title, items: rows.map(toItem) });
    };
    add('users', 'Users', data.users, (user) => ({
        key: `user-${user.id}`,
        href: resultHref.user(user),
        label: user.username,
        detail: [user.email, user.is_active === false ? 'suspended' : null, user.is_staff ? 'staff' : null].filter(Boolean).join(' · '),
        avatar: user,
        kind: 'user',
    }));
    add('anime', 'Anime', data.anime, (anime) => ({
        key: `anime-${anime.id}`,
        href: resultHref.anime(anime),
        label: anime.title,
        detail: [animeTypeLabel(anime.anime_type), humanize(anime.status, '')].filter(Boolean).join(' · '),
        poster: anime.poster,
        kind: 'anime',
    }));
    add('reviews', 'Reviews', data.reviews, (review) => ({
        key: `review-${review.id}`,
        href: resultHref.review(review),
        label: `${review.username} on ${review.anime_title}`,
        detail: review.snippet,
        kind: 'review',
    }));
    add('threads', 'Forum threads', data.threads, (thread) => ({
        key: `thread-${thread.id}`,
        href: resultHref.thread(thread),
        label: thread.title,
        detail: [thread.category, thread.author].filter(Boolean).join(' · '),
        kind: 'thread',
    }));
    return groups;
}

/**
 * Search everything an admin works with (⌘K / Ctrl K, "/"): pages by name,
 * and users, anime, reviews and threads from the API. Arrows move, Enter
 * opens, Escape closes.
 */
export default function CommandPalette({ open, onClose }) {
    const navigate = useNavigate();
    const { isSuperuser } = useRole();
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const debounced = useDebouncedValue(query.trim(), 200);
    const trapRef = useAdminFocusTrap(open, onClose);
    useScrollLock(open);
    const listId = useId();
    const inputRef = useRef(null);

    useEffect(() => {
        if (open) {
            setQuery('');
            setActive(0);
            window.setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);

    const search = useQuery({
        queryKey: adminKeys.view('search', { q: debounced }),
        queryFn: ({ signal }) => adminApi.get('search', { q: debounced }, { signal }),
        enabled: open && debounced.length >= MIN_QUERY,
        staleTime: 30_000,
        retry: false,
    });

    const pages = useMemo(() => flatNav({ isSuperuser }), [isSuperuser]);
    const groups = useMemo(
        () => buildGroups(query, pages, debounced.length >= MIN_QUERY ? search.data : null),
        [query, pages, debounced, search.data],
    );
    const flat = groups.flatMap((group) => group.items);

    useEffect(() => {
        setActive(0);
    }, [query, search.data]);

    // Keep the highlighted result on screen as the arrows move it.
    const activeKey = flat[active]?.key;
    useEffect(() => {
        if (!open || !activeKey) return;
        document.getElementById(`${listId}-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [open, activeKey, listId]);

    if (!open) return null;

    const go = (item) => {
        if (!item) return;
        onClose();
        navigate(item.href);
    };

    const onKeyDown = (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => (flat.length ? (index + 1) % flat.length : 0));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            go(flat[active]);
        }
    };

    const searching = debounced.length >= MIN_QUERY && search.isFetching;
    const noResults = debounced.length >= MIN_QUERY && !search.isFetching && flat.length === 0;
    let index = -1;

    return createPortal(
        <div className="fixed inset-0 z-[1050]">
            <div aria-hidden="true" className="admin-backdrop absolute inset-0 bg-[rgb(8_10_13/0.68)]" onClick={onClose} />
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-3 pt-[min(12vh,6rem)]">
                <div
                    ref={trapRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Search the admin"
                    className="admin-dialog pointer-events-auto flex max-h-[min(36rem,80dvh)] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-2)] shadow-[var(--shadow-pop)]"
                >
                    <div className="flex items-center gap-3 px-4">
                        <Search className="h-5 w-5 shrink-0 text-[var(--text-3)]" aria-hidden="true" />
                        <input
                            ref={inputRef}
                            type="text"
                            role="combobox"
                            aria-label="Search the admin"
                            aria-expanded="true"
                            aria-controls={listId}
                            aria-activedescendant={flat[active] ? `${listId}-${flat[active].key}` : undefined}
                            aria-autocomplete="list"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder="Search users, anime, reviews, threads or pages"
                            className="admin-bare-input h-14 min-w-0 flex-1 !bg-transparent text-base text-[var(--text-1)] placeholder:text-[var(--text-3)] focus-visible:!bg-transparent"
                        />
                        <kbd className="hidden rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.6875rem] text-[var(--text-3)] sm:inline">Esc</kbd>
                    </div>
                    <div id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 custom-scrollbar">
                        {groups.map((group) => (
                            <div key={group.key} role="group" aria-label={group.title} className="pt-2">
                                <p className="px-3 pb-1 pt-1 text-xs font-medium text-[var(--text-3)]">{group.title}</p>
                                {group.items.map((item) => {
                                    index += 1;
                                    const selected = index === active;
                                    const itemIndex = index;
                                    const Icon = item.icon;
                                    return (
                                        <div
                                            key={item.key}
                                            id={`${listId}-${item.key}`}
                                            role="option"
                                            aria-selected={selected}
                                            onMouseMove={() => setActive(itemIndex)}
                                            onClick={() => go(item)}
                                            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-sm ${selected ? 'bg-white/[0.07]' : ''}`}
                                        >
                                            {item.kind === 'user' && <Avatar src={item.avatar.avatar} name={item.avatar.username} size="xs" />}
                                            {item.kind === 'anime' && <Poster src={item.poster} size="xs" className="!h-8 !w-6" />}
                                            {Icon && <Icon className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />}
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium text-[var(--text-1)]">{item.label}</span>
                                                {item.detail && <span className="block truncate text-xs text-[var(--text-3)]">{item.detail}</span>}
                                            </span>
                                            {selected && <CornerDownLeft className="h-4 w-4 shrink-0 text-[var(--text-3)]" aria-hidden="true" />}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        <p className="px-3 py-3 text-sm text-[var(--text-3)]" aria-live="polite">
                            {searching && 'Searching…'}
                            {noResults && `Nothing matches “${debounced}”.`}
                            {search.isError && debounced.length >= MIN_QUERY && 'Search is not available right now.'}
                            {query.trim().length > 0 && query.trim().length < MIN_QUERY && 'Keep typing to search records.'}
                        </p>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
