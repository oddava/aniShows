export default function MusicSection({ anime, isCompact = false, itemLimit = null }) {
    const themeSongs = anime?.theme_songs || [];

    const openings = themeSongs.filter((t) => t.song_type === 'opening');
    const endings = themeSongs.filter((t) => t.song_type === 'ending');

    if (openings.length === 0 && endings.length === 0) {
        return null;
    }

    const limit = (list) => (Number.isFinite(itemLimit) ? list.slice(0, itemLimit) : list);

    return (
        <section className="panel animate-tab-content w-full min-w-0">
            <h2 className="section-title mb-5">Themes</h2>

            <div className={`grid min-w-0 w-full gap-x-10 gap-y-8 ${isCompact ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
                {openings.length > 0 && <ThemeList title="Openings" total={openings.length} themes={limit(openings)} />}
                {endings.length > 0 && <ThemeList title="Endings" total={endings.length} themes={limit(endings)} />}
            </div>
        </section>
    );
}

function ThemeList({ title, total, themes }) {
    return (
        <div className="min-w-0">
            <h3 className="mb-2 text-sm text-[var(--text-2)]">
                {title} <span className="tabular text-[var(--text-3)]">{total}</span>
            </h3>
            <ul className="space-y-1">
                {themes.map((theme) => (
                    <ThemeItem key={`${theme.song_type}-${theme.track_number}`} theme={theme} />
                ))}
            </ul>
        </div>
    );
}

function ThemeItem({ theme }) {
    const href = theme.youtube_url || theme.spotify_url;
    const Wrapper = href ? 'a' : 'div';

    return (
        <li>
            <Wrapper
                {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="group block min-w-0 py-2"
            >
                <p className={`truncate text-[15px] text-[var(--text-1)] ${href ? 'group-hover:text-[var(--signature)]' : ''}`}>{theme.title}</p>
                {(theme.artist || theme.episodes) && (
                    <p className="truncate text-sm text-[var(--text-3)]">
                        {theme.artist}
                        {theme.episodes && <span className="ml-2">({theme.episodes})</span>}
                    </p>
                )}
            </Wrapper>
        </li>
    );
}
