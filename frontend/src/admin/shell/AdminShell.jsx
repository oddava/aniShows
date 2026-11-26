import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Home, LogOut, Menu as MenuIcon, Search, X } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import RouteProgress from '../../components/common/RouteProgress';
import useAdminFocusTrap from '../useFocusTrap';
import { useScrollLock } from '../ui/Overlay';
import { useModerationSummary, useRole } from '../hooks';
import { Avatar, PanelSkeleton } from '../ui';
import CommandPalette from './CommandPalette';
import { navFor } from './nav';
import '../admin.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

function useModerationCount() {
    const { data } = useModerationSummary();
    if (!data) return 0;
    return (data.open_reviews || 0) + (data.forums?.open || 0);
}

function matchItem(item, pathname) {
    if (item.external) return false;
    return item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * Marks which edges of a scroller hide content (data-fade-top / -bottom), so
 * admin.css can fade them: a nav taller than the screen visibly continues.
 */
function useVerticalFade() {
    const ref = useRef(null);
    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const update = () => {
            const top = node.scrollTop > 2;
            const bottom = node.scrollTop + node.clientHeight < node.scrollHeight - 2;
            node.toggleAttribute('data-fade-top', top);
            node.toggleAttribute('data-fade-bottom', bottom);
        };
        update();
        node.addEventListener('scroll', update, { passive: true });
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
        observer?.observe(node);
        return () => {
            node.removeEventListener('scroll', update);
            observer?.disconnect();
        };
    }, []);
    return ref;
}

function Sidebar({ sections, pathname, moderationCount, onOpenSearch, onNavigate, user, isSuperuser, onLogout }) {
    const navRef = useVerticalFade();
    // The current section stays in view when the nav is taller than the screen.
    useEffect(() => {
        // Centred, so the edge fade never dims it.
        navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'center' });
    }, [pathname, navRef]);
    return (
        <div className="flex h-full flex-col">
            <div className="flex h-16 shrink-0 items-center gap-2 px-5">
                <Link to="/admin" onClick={onNavigate} className="flex items-baseline gap-2 rounded-md">
                    <span className="text-[1.1875rem] font-semibold leading-none tracking-[-0.02em] text-[var(--text-1)]">AniShows</span>
                    <span className="text-sm font-medium text-[var(--text-3)]">Admin</span>
                </Link>
            </div>

            <div className="px-3 pb-2">
                <button
                    type="button"
                    onClick={onOpenSearch}
                    className="flex h-10 pointer-coarse:h-11 w-full items-center gap-2.5 rounded-lg bg-white/[0.06] px-3 text-sm text-[var(--text-3)] transition-colors hover:bg-white/[0.09] hover:text-[var(--text-2)]"
                >
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <span className="flex-1 text-left">Search</span>
                    <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-sans text-[0.6875rem] text-[var(--text-3)]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                </button>
            </div>

            <nav ref={navRef} aria-label="Admin" className="admin-nav-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2 custom-scrollbar">
                {sections.map((section) => (
                    <div key={section.title} className="mb-5 last:mb-0">
                        <h2 className="px-3 pb-1.5 text-xs font-medium text-[var(--text-3)]">{section.title}</h2>
                        <ul className="space-y-0.5">
                            {section.items.map((item) => {
                                const Icon = item.icon;
                                const active = matchItem(item, pathname);
                                const count = item.badge === 'moderation' ? moderationCount : 0;
                                const classes = `group flex min-h-10 pointer-coarse:min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                                    active
                                        ? 'bg-white/[0.07] text-[var(--text-1)]'
                                        : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'
                                }`;
                                const content = (
                                    <>
                                        <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-[var(--signature)]' : ''}`} aria-hidden="true" />
                                        <span className="flex-1 truncate">{item.label}</span>
                                        {item.external && <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-3)]" aria-hidden="true" />}
                                        {count > 0 && (
                                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--signature)] px-1.5 text-[0.6875rem] font-semibold tabular text-[var(--on-signature)]">
                                                <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
                                                <span className="sr-only">{`, ${count} open`}</span>
                                            </span>
                                        )}
                                    </>
                                );
                                return (
                                    <li key={item.to || item.href}>
                                        {item.external ? (
                                            <a href={item.href} className={classes}>{content}</a>
                                        ) : (
                                            <NavLink
                                                to={item.to}
                                                end={item.end}
                                                onClick={onNavigate}
                                                aria-current={active ? 'page' : undefined}
                                                className={classes}
                                            >
                                                {content}
                                            </NavLink>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>

            <div className="shrink-0 space-y-1 px-3 pb-4 pt-2">
                <Link
                    to="/"
                    className="flex min-h-10 pointer-coarse:min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--text-2)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-1)]"
                >
                    <Home className="h-[18px] w-[18px]" aria-hidden="true" />
                    Back to site
                </Link>
                <div className="flex items-center gap-3 rounded-lg px-3 py-2">
                    <Avatar src={user?.avatar} name={user?.username} size="sm" />
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-1)]">{user?.username}</p>
                        <p className="text-xs text-[var(--text-3)]">{isSuperuser ? 'Superuser' : 'Staff'}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onLogout}
                        aria-label="Sign out"
                        title="Sign out"
                        className="-mr-2 inline-flex h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-lg text-[var(--text-3)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                    >
                        <LogOut className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * The admin frame: a quiet sidebar on desktop, a top bar with a slide-in
 * sheet on smaller screens, and the page in a centred column. ⌘K / Ctrl K
 * (or "/") opens search from anywhere.
 */
export default function AdminShell() {
    const { logout } = useAuth();
    const { user, isSuperuser } = useRole();
    const navigate = useNavigate();
    const location = useLocation();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const menuButtonRef = useRef(null);
    const moderationCount = useModerationCount();
    const sections = navFor({ isSuperuser });

    const current = sections.flatMap((section) => section.items).find((item) => matchItem(item, location.pathname));

    useEffect(() => {
        document.title = `${current?.label || 'Admin'} · Admin · AniShows`;
    }, [current?.label]);

    useEffect(() => {
        setSheetOpen(false);
    }, [location.pathname]);

    const closeSheet = useCallback(() => setSheetOpen(false), []);

    // The phone sheet is modal: focus stays in it, Escape closes it, focus
    // returns to the menu button, and the page behind neither scrolls nor
    // takes focus (inert).
    const sheetRef = useAdminFocusTrap(sheetOpen, closeSheet);
    useScrollLock(sheetOpen);

    useEffect(() => {
        const onKey = (event) => {
            const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
            // Another modal owns the keyboard: "/" types there, it does not open search.
            const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]:not([inert])'));
            if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                setSheetOpen(false);
                setSearchOpen((open) => !open);
            } else if (event.key === '/' && !typing && !modalOpen && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                setSearchOpen(true);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    const sidebarProps = {
        sections,
        pathname: location.pathname,
        moderationCount,
        user,
        isSuperuser,
        onLogout: handleLogout,
    };

    return (
        <div className="admin-root">
            <a href="#admin-main" className="skip-link" inert={sheetOpen}>Skip to content</a>
            <RouteProgress />

            {/* Desktop sidebar */}
            <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--admin-sidebar)] bg-[var(--ink-0)] lg:block">
                <Sidebar {...sidebarProps} onOpenSearch={() => setSearchOpen(true)} />
            </aside>

            {/* Phone/tablet top bar */}
            <header inert={sheetOpen} className="sticky top-0 z-30 flex h-14 items-center gap-1 bg-[var(--color-navbar-bg)] px-2 backdrop-blur-md lg:hidden">
                <button
                    ref={menuButtonRef}
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    aria-label="Open admin menu"
                    aria-expanded={sheetOpen}
                    aria-controls="admin-sheet"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-2)] hover:bg-white/[0.06] hover:text-[var(--text-1)]"
                >
                    <MenuIcon className="h-5 w-5" aria-hidden="true" />
                </button>
                <Link to="/admin" className="flex min-w-0 flex-1 items-baseline gap-2 px-1">
                    <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-[var(--text-1)]">AniShows</span>
                    <span className="truncate text-sm font-medium text-[var(--text-3)]">{current?.label || 'Admin'}</span>
                </Link>
                <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    aria-label="Search the admin"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-2)] hover:bg-white/[0.06] hover:text-[var(--text-1)]"
                >
                    <Search className="h-5 w-5" aria-hidden="true" />
                </button>
            </header>

            {/* Phone/tablet sheet */}
            <div className={`fixed inset-0 z-40 lg:hidden ${sheetOpen ? '' : 'pointer-events-none'}`} aria-hidden={!sheetOpen}>
                <div
                    className={`absolute inset-0 bg-[rgb(8_10_13/0.68)] transition-opacity duration-200 motion-reduce:transition-none ${sheetOpen ? 'opacity-100' : 'opacity-0'}`}
                    onClick={closeSheet}
                />
                <div
                    id="admin-sheet"
                    ref={sheetRef}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Admin menu"
                    inert={!sheetOpen}
                    data-open={sheetOpen}
                    tabIndex={-1}
                    className={`admin-sidebar-sheet absolute outline-none inset-y-0 left-0 w-[min(18rem,86vw)] bg-[var(--ink-1)] shadow-[var(--shadow-pop)] ${sheetOpen ? 'visible translate-x-0' : 'invisible -translate-x-full'}`}
                >
                    <button
                        type="button"
                        onClick={closeSheet}
                        aria-label="Close admin menu"
                        className="absolute right-2 top-2.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-2)] hover:bg-white/[0.06]"
                    >
                        <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <Sidebar
                        {...sidebarProps}
                        onNavigate={() => setSheetOpen(false)}
                        onOpenSearch={() => {
                            setSheetOpen(false);
                            setSearchOpen(true);
                        }}
                    />
                </div>
            </div>

            <main id="admin-main" tabIndex={-1} inert={sheetOpen} className="min-w-0 outline-none lg:pl-[var(--admin-sidebar)]">
                <div className="mx-auto w-full max-w-[var(--admin-content-max)] px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-10">
                    <Suspense fallback={<div className="space-y-4" aria-busy="true"><PanelSkeleton lines={2} /><PanelSkeleton lines={8} /></div>}>
                        <div key={location.pathname} className="page-enter">
                            <Outlet />
                        </div>
                    </Suspense>
                </div>
            </main>

            <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        </div>
    );
}
