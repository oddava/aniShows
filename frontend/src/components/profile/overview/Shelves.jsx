import { Link } from 'react-router-dom';
import AnimeMediaImage from '../../common/AnimeMediaImage';
import Portrait from '../../ui/Portrait';
import { knownEpisodeTotal } from '../../../utils/episodes';

/*
 * The overview's picture rows: one row of whole covers, never a cut-off
 * one. Six across from sm up; phones show the first three ("See all" has
 * the rest). No overlays, badges or bars on the art, and hovering leaves
 * the art alone: the title lights in the profile's colour instead.
 */
const ROW = 'grid grid-cols-3 gap-3 sm:grid-cols-6 sm:gap-4 max-sm:[&>li:nth-child(n+4)]:hidden';

function Cover({ anime, children, reserveTwoLines = false }) {
    return (
        <Link to={`/anime/${anime.slug}`} className="group block" title={anime.title}>
            <span className="block aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] bg-[var(--ink-2)]">
                <AnimeMediaImage
                    anime={anime}
                    kind="cover"
                    size="medium"
                    alt={anime.title}
                    className="h-full w-full object-cover"
                />
            </span>
            {/* With counts under the titles, two lines are reserved so the counts line up. */}
            <span className={`mt-2 line-clamp-2 text-[13px] font-medium leading-5 text-[var(--text-1)] transition-colors duration-200 group-hover:text-[var(--signature)] sm:text-sm ${reserveTwoLines ? 'min-h-[2.5rem]' : ''}`}>
                {anime.title}
            </span>
            {children}
        </Link>
    );
}

/** What they are watching: covers, with "7 of 12" under the title. */
export function WatchingShelf({ entries }) {
    return (
        <ul className={`${ROW} sm:grid-cols-6`}>
            {entries.map((entry) => {
                const anime = entry.anime || {};
                const watched = Number(entry.episodes_watched) || 0;
                const total = knownEpisodeTotal(anime);
                return (
                    <li key={entry.id} className="min-w-0">
                        <Cover anime={anime} reserveTwoLines>
                            <span className="mt-0.5 block text-[13px] text-[var(--text-3)] tabular">
                                {total ? `${watched} of ${total}` : `${watched} watched`}
                            </span>
                        </Cover>
                    </li>
                );
            })}
        </ul>
    );
}

/** Favorites as a showcase (Letterboxd's top four, made six), in the order the person set. */
export function FavoritesShowcase({ favorites }) {
    return (
        <ul className={`${ROW} sm:grid-cols-6`}>
            {favorites.map((fav) => (
                <li key={fav.id} className="min-w-0">
                    <Cover anime={fav.anime || {}} />
                </li>
            ))}
        </ul>
    );
}

/**
 * Favourite characters or voice actors: two columns of rows, a small
 * portrait and the whole name beside it (two lines if it needs them).
 */
export function PeopleList({ items, itemKey, hrefBuilder }) {
    return (
        <ul className="-mx-2 grid grid-cols-2 gap-x-1">
            {items.map((entry) => {
                const person = entry[itemKey] || {};
                return (
                    <li key={entry.id} className="min-w-0">
                        <Link
                            to={hrefBuilder(person)}
                            className="group flex min-h-12 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04] sm:gap-2.5"
                            title={person.name}
                        >
                            <Portrait src={person.image} alt="" sizes="40px" className="h-8 w-8 shrink-0 rounded-full sm:h-9 sm:w-9" />
                            <span className="min-w-0 truncate text-[13px] leading-tight text-[var(--text-1)] sm:line-clamp-2 sm:whitespace-normal sm:text-sm">{person.name}</span>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
