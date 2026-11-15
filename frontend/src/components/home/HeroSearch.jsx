import { Suspense, forwardRef, lazy, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';

import { navbarSearchQueries } from '../../api/queries/anime';

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
    const [debounced, setDebounced] = useState('');
    const [open, setOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [keyboardPicked, setKeyboardPicked] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        const id = setTimeout(() => setDebounced(query.trim()), 200);
        return () => clearTimeout(id);
    }, [query]);

    const { data: results = [], isFetching } = useQuery({
        ...navbarSearchQueries.results(debounced),
        enabled: debounced.length >= 2,
        placeholderData: keepPreviousData,
        staleTime: 60_000,
        retry: false,
    });
    const suggestions = debounced.length >= 2 ? results.slice(0, 8) : [];
    const showList = open && suggestions.length > 0;

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
        <div ref={wrapperRef} className="relative max-w-lg mb-5">
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
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder="Search anime by title"
                    autoComplete="off"
                    enterKeyHint="search"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showList}
                    aria-controls={showList ? `${ID}-listbox` : undefined}
                    aria-activedescendant={showList && selectedIndex >= 0 ? `${ID}-option-${selectedIndex}` : undefined}
                    aria-busy={isFetching}
                    className="w-full h-12 sm:h-[52px] rounded-xl bg-dark-100 pl-11 pr-28 text-[15px] text-white placeholder:text-gray-500 [&::-webkit-search-cancel-button]:appearance-none"
                />
                <button type="submit" className="btn-primary absolute right-1.5 top-1/2 -translate-y-1/2 h-9 sm:h-10 px-4 text-sm">
                    Search
                </button>
            </form>

            {showList && (
                <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-2xl border border-white/10 bg-dark-100 shadow-2xl shadow-black/50 animate-fade-in">
                    <Suspense fallback={null}>
                        <SearchSuggestionList
                            idPrefix={ID}
                            searchSuggestions={suggestions}
                            searchQuery={query.trim()}
                            selectedIndex={selectedIndex}
                            setSelectedIndex={(index) => {
                                setKeyboardPicked(false);
                                setSelectedIndex(index);
                            }}
                            handleSuggestionClick={goToAnime}
                            handleSearch={browseAll}
                        />
                    </Suspense>
                </div>
            )}
        </div>
    );
});

export default HeroSearch;
