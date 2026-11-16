import { Suspense, forwardRef, lazy, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import useMediaQuery from '../../hooks/useMediaQuery';
import useAnimeSearchSuggestions from '../navbar/useAnimeSearchSuggestions';
import { SearchNoMatches } from '../navbar/NavbarSearch';

const SearchSuggestionList = lazy(() => import('../navbar/SearchSuggestionList'));

const ID = 'home-search';

/**
 * The guest hero's search field: the same combobox and suggestion rows as the
 * navbar search (arrow keys, Enter, Escape), so the two behave identically.
 * Submitting without a highlighted suggestion opens Browse with the query.
 */
const HeroSearch = forwardRef(function HeroSearch(_props, formRef) {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [keyboardPicked, setKeyboardPicked] = useState(false);
    const wrapperRef = useRef(null);

    // The same server-side suggestions as the navbar (P1-1).
    const { results, isSearching, noMatches } = useAnimeSearchSuggestions(query);
    // Phones show fewer rows so the list fits above the tab bar and keyboard.
    const isPhone = useMediaQuery('(max-width: 639px)');
    const maxRows = isPhone ? 5 : 8;
    const suggestions = results.slice(0, maxRows);
    const showList = open && suggestions.length > 0;
    const showNoMatches = open && noMatches;

    // Fit the list in the space actually visible below the field (the soft
    // keyboard shrinks the visual viewport on phones).
    const [listMaxHeight, setListMaxHeight] = useState(null);
    const showPanel = showList || showNoMatches;
    useEffect(() => {
        if (!showPanel) return undefined;
        const viewport = window.visualViewport;
        const measure = () => {
            const field = wrapperRef.current?.querySelector('input');
            if (!field) return;
            const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
            const space = visibleBottom - field.getBoundingClientRect().bottom - 16;
            setListMaxHeight(Math.max(160, Math.min(space, window.innerHeight * 0.6)));
        };
        measure();
        viewport?.addEventListener('resize', measure);
        viewport?.addEventListener('scroll', measure);
        window.addEventListener('scroll', measure, { passive: true });
        return () => {
            viewport?.removeEventListener('resize', measure);
            viewport?.removeEventListener('scroll', measure);
            window.removeEventListener('scroll', measure);
        };
    }, [showPanel]);

    useEffect(() => {
        const onPointerDown = (event) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, []);

    const goToAnime = (slug) => {
        setOpen(false);
        navigate(`/anime/${slug}`);
    };

    const browseAll = (event) => {
        event?.preventDefault();
        const trimmed = query.trim();
        setOpen(false);
        navigate(trimmed ? `/browse?q=${encodeURIComponent(trimmed)}` : '/browse');
    };

    // Enter: open the suggestion picked with the arrow keys, else browse all.
    // (Hover highlights a row but never redirects an explicit "search" action.)
    const submit = (event) => {
        event?.preventDefault();
        if (showList && keyboardPicked && selectedIndex >= 0 && suggestions[selectedIndex]) {
            goToAnime(suggestions[selectedIndex].slug);
            return;
        }
        browseAll();
    };

    const onKeyDown = (event) => {
        if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setKeyboardPicked(true);
            setSelectedIndex((i) => (i + 1) % suggestions.length);
        } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setKeyboardPicked(true);
            setSelectedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        } else if (event.key === 'Escape') {
            setOpen(false);
            setSelectedIndex(-1);
        }
    };

    return (
        <div
            ref={wrapperRef}
            className="relative max-w-lg mb-5"
            onBlur={(event) => {
                // Close when keyboard focus leaves the field and its list, so the
                // list never covers whatever receives focus next.
                if (!wrapperRef.current?.contains(event.relatedTarget)) setOpen(false);
            }}
        >
            <form ref={formRef} role="search" onSubmit={submit} className="relative">
                <label htmlFor={ID} className="sr-only">Search anime</label>
                <Search aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-500 pointer-events-none" />
                <input
                    id={ID}
                    type="search"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setSelectedIndex(-1);
                        setKeyboardPicked(false);
                        setOpen(true);
                    }}
                    onFocus={(event) => {
                        setOpen(true);
                        // On phones, bring the field to the top so the list has room.
                        if (isPhone) {
                            event.currentTarget.scrollIntoView({ block: 'start' });
                        }
                    }}
                    onKeyDown={onKeyDown}
                    placeholder="Search anime by title"
                    autoComplete="off"
                    enterKeyHint="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showList}
                    aria-controls={showList ? `${ID}-listbox` : undefined}
                    aria-activedescendant={showList && selectedIndex >= 0 ? `${ID}-option-${selectedIndex}` : undefined}
                    aria-busy={isSearching}
                    className="w-full h-12 sm:h-[52px] scroll-mt-20 rounded-xl bg-dark-100 pl-11 pr-28 text-[15px] text-white placeholder:text-gray-500 [&::-webkit-search-cancel-button]:appearance-none"
                />
                <button type="submit" className="btn-primary absolute right-1.5 top-1/2 -translate-y-1/2 h-9 sm:h-10 px-4 text-sm">
                    Search
                </button>
            </form>

            {showPanel && (
                <div tabIndex={-1} style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined} className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-dark-100 shadow-2xl shadow-black/50 animate-fade-in">
                    {showList ? (
                        <Suspense fallback={null}>
                            <SearchSuggestionList
                                idPrefix={ID}
                                searchSuggestions={suggestions}
                                searchQuery={query.trim()}
                                selectedIndex={selectedIndex}
                                handleSuggestionClick={goToAnime}
                                handleSearch={browseAll}
                            />
                        </Suspense>
                    ) : (
                        <SearchNoMatches query={query.trim()} onSearchAll={browseAll} />
                    )}
                </div>
            )}
        </div>
    );
});

export default HeroSearch;
