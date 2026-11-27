import { Link } from 'react-router-dom';
import Portrait from '../../ui/Portrait';

const GRID = 'grid grid-cols-3 gap-x-3 gap-y-4 xs:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8';

/** Everything an infinite favourites query has loaded, and its total. */
export const peopleFrom = (query) => {
    const pages = query.data?.pages ?? [];
    const items = pages.flatMap((page) => (Array.isArray(page) ? page : page?.results ?? []));
    const count = pages[0]?.count ?? items.length;
    return { items, count };
};

/**
 * One kind of favourite person (characters or voice actors) on the
 * Favorites tab: a grid of portraits with the name under each, and Load
 * more while the server has more. The switch above names the kind.
 */
export default function FavoritePeople({ label, query, itemKey, hrefBuilder }) {
    const { items } = peopleFrom(query);

    if (query.isError && !items.length) {
        return (
            <section aria-label={label}>
                <p className="text-[15px] text-[var(--text-2)]">
                    These couldn’t be loaded.{' '}
                    <button type="button" onClick={() => query.refetch()} className="text-link">Try again</button>
                </p>
            </section>
        );
    }
    if (!items.length) return null;

    return (
        <section aria-label={label}>
            <ul className={GRID}>
                {items.map((entry) => {
                    const person = entry[itemKey] || {};
                    return (
                        <li key={entry.id} className="min-w-0">
                            <Link to={hrefBuilder(person)} className="group block" title={person.name}>
                                <Portrait
                                    src={person.image}
                                    alt=""
                                    sizes="(min-width: 1024px) 12vw, 30vw"
                                    className="aspect-[3/4] w-full rounded-lg"
                                />
                                <span className="mt-1.5 line-clamp-2 text-sm leading-snug text-[var(--text-1)] transition-colors group-hover:text-[var(--signature)]">
                                    {person.name}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
            {query.hasNextPage && (
                <button
                    type="button"
                    onClick={() => query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                    className="btn-secondary mt-4 px-5 text-[15px]"
                >
                    {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
            )}
        </section>
    );
}
