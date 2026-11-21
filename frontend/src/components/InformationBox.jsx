import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    formatAiringTime,
    formatDate,
    formatRelativeTime,
} from '../utils/dateUtils';
import {
    formatCompactCount,
    getStatusDistributionTotal,
    normalizeStatusDistribution,
} from '../utils/statusDistribution';
import { capsToSentence } from './detailTabs/format';
import { airingState } from '../utils/episodes';

/**
 * A fact as a row: label left, value right; whitespace, no rules. A long
 * value (a date range) is `stacked`: label above, value below at full width,
 * so it never wraps into a ragged right-aligned pair of lines.
 */
const InfoRow = ({ label, value, stacked = false }) => (
    stacked ? (
        <div className="min-w-0 py-1.5">
            <dt className="text-sm text-[var(--text-2)]">{label}</dt>
            <dd className="mt-0.5 min-w-0 break-words text-[15px] text-[var(--text-1)]">{value}</dd>
        </div>
    ) : (
        <div className="flex min-w-0 items-baseline justify-between gap-4 py-1.5">
            <dt className="shrink-0 text-sm text-[var(--text-2)]">{label}</dt>
            <dd className="min-w-0 max-w-[65%] break-words text-right text-[15px] text-[var(--text-1)]">{value}</dd>
        </div>
    )
);

const DATE_OPTIONS = { day: 'numeric', month: 'short', year: 'numeric' };

/**
 * When it aired, short, day before month: "Since 2 Oct 2026" while it is
 * still running, "5 Jan – 30 Mar 2026" inside one year, "20 Oct 1999 –
 * 18 Dec 2026" across years (each date kept whole when the range wraps). `isRange` says
 * whether the value is a two-date range, which reads best stacked.
 */
export function getAiredValue(anime) {
    const start = formatDate(anime?.release_date, DATE_OPTIONS);
    if (!start) return { value: '', isRange: false };

    if (!anime.end_date) {
        return { value: anime.status === 'Airing' ? `Since ${start}` : start, isRange: false };
    }

    const end = formatDate(anime.end_date, DATE_OPTIONS);
    if (!end || end === start) return { value: start, isRange: false };

    const sameYear = start.slice(-4) === end.slice(-4);
    const from = sameYear ? formatDate(anime.release_date, { day: 'numeric', month: 'short' }) : start;
    return {
        value: (
            <>
                <span className="whitespace-nowrap">{from} –</span>{' '}
                <span className="whitespace-nowrap">{end}</span>
            </>
        ),
        isRange: !sameYear,
    };
}

/**
 * The next episode and when it airs. Its own export so the page can lift it
 * near the tracking controls on phones; hidden when nothing is scheduled.
 * Once the listed episode's time has passed it is out (the API moves on to
 * the following one at its next sync), and the panel says so.
 */
export function NextEpisodePanel({ anime, className = '' }) {
    if (!anime || anime.status === 'Finished' || !anime.next_airing_date) return null;
    const { justAired } = airingState(anime);
    const episode = anime.next_airing_episode;
    if (justAired) {
        return (
            <div className={`panel ${className}`}>
                <p className="text-sm text-[var(--signature)]">Latest episode</p>
                <p className="mt-1 text-[17px] font-semibold text-[var(--text-1)]">
                    {episode ? `Episode ${episode} is out` : 'A new episode is out'}
                </p>
                <p className="mt-0.5 text-sm text-[var(--text-3)] tabular">Aired {formatAiringTime(anime.next_airing_date)}</p>
            </div>
        );
    }
    return (
        <div className={`panel ${className}`}>
            <p className="text-sm text-[var(--signature)]">Next episode</p>
            <p className="mt-1 text-[17px] font-semibold text-[var(--text-1)]">
                Episode {episode ?? 'TBA'}
                <span className="font-normal text-[var(--text-2)]"> · {formatRelativeTime(anime.next_airing_date)}</span>
            </p>
            <p className="mt-0.5 text-sm text-[var(--text-3)] tabular">{formatAiringTime(anime.next_airing_date)}</p>
        </div>
    );
}

const getBrowseFilterHref = (key, value) => {
    const params = new URLSearchParams({ [key]: value });
    return `/browse?${params.toString()}`;
};

const chipClass = 'inline-flex min-h-9 items-center rounded-[var(--radius-sm)] bg-[var(--ink-2)] px-3 text-sm text-[var(--text-2)] transition-colors hover:bg-[var(--ink-3)] hover:text-[var(--text-1)]';

const TAG_PREVIEW_COUNT = 12;
const LINK_PREVIEW_COUNT = 8;

function GroupLabel({ children }) {
    return <p className="mb-3 text-sm text-[var(--text-2)]">{children}</p>;
}

export default function InformationBox({ anime, className = '', showNextEpisode = true }) {
    const [showAllTags, setShowAllTags] = useState(false);
    const [showAllLinks, setShowAllLinks] = useState(false);
    const tagCount = anime?.tags?.length || 0;
    const visibleTags = showAllTags ? anime?.tags || [] : (anime?.tags || []).slice(0, TAG_PREVIEW_COUNT);
    const links = anime?.external_links || [];
    const visibleLinks = showAllLinks ? links : links.slice(0, LINK_PREVIEW_COUNT);
    const totalMembers = getStatusDistributionTotal(
        normalizeStatusDistribution(anime?.status_distribution)
    );

    const aired = getAiredValue(anime);
    const season = [capsToSentence(anime.season), anime.season_year].filter(Boolean).join(' ');

    return (
        <div className={`flex min-w-0 flex-col gap-3 ${className}`}>
            {showNextEpisode && <NextEpisodePanel anime={anime} />}

            <section aria-labelledby={`info-${anime.id}`} className="panel">
                <h2 id={`info-${anime.id}`} className="section-title mb-3">Details</h2>
                <dl>
                    {anime.anime_type && <InfoRow label="Type" value={anime.anime_type} />}
                    <InfoRow label="Episodes" value={anime.episode_count || 'Unknown'} />
                    {anime.duration_minutes > 0 && (
                        <InfoRow label="Duration" value={`${anime.duration_minutes} min`} />
                    )}
                    {aired.value && <InfoRow label="Aired" value={aired.value} stacked={aired.isRange} />}
                    {season && <InfoRow label="Season" value={season} />}
                    {anime.source_material && <InfoRow label="Source" value={anime.source_material} />}
                    {anime.studio && <InfoRow label="Studio" value={anime.studio.name} />}
                    {totalMembers > 0 && (
                        <InfoRow label="Members" value={<span className="tabular">{formatCompactCount(totalMembers)}</span>} />
                    )}
                </dl>
            </section>

            {/* Genres, tags and links share one panel (hidden when all are empty). */}
            <div className="panel flex flex-col gap-6 empty:hidden">
            {anime.genres && anime.genres.length > 0 && (
                <div>
                    <GroupLabel>Genres</GroupLabel>
                    <div className="flex flex-wrap gap-2">
                        {anime.genres.map((genre) => (
                            <Link key={genre.id} to={getBrowseFilterHref('genre', genre.slug)} className={chipClass}>
                                {genre.name}
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {anime.tags && anime.tags.length > 0 && (
                <div>
                    <GroupLabel>Tags</GroupLabel>
                    <div id={`tags-${anime.id}`} className="flex flex-wrap gap-2">
                        {visibleTags.map((tag) => (
                            <Link key={tag} to={getBrowseFilterHref('tags', tag)} className={chipClass}>
                                {tag}
                            </Link>
                        ))}
                    </div>
                    {tagCount > TAG_PREVIEW_COUNT && (
                        <button
                            type="button"
                            onClick={() => setShowAllTags((value) => !value)}
                            aria-expanded={showAllTags}
                            aria-controls={`tags-${anime.id}`}
                            className="text-link mt-3 text-sm"
                        >
                            {showAllTags ? 'Show less' : `Show all ${tagCount}`}
                        </button>
                    )}
                </div>
            )}

            {links.length > 0 && (
                <div>
                    <GroupLabel>External links</GroupLabel>
                    <ul id={`links-${anime.id}`} className="flex flex-wrap gap-x-4 gap-y-2">
                        {visibleLinks.map((link, i) => (
                            <li key={`${link.site}-${i}`}>
                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-link text-sm">
                                    {link.site}
                                </a>
                            </li>
                        ))}
                    </ul>
                    {links.length > LINK_PREVIEW_COUNT && (
                        <button
                            type="button"
                            onClick={() => setShowAllLinks((value) => !value)}
                            aria-expanded={showAllLinks}
                            aria-controls={`links-${anime.id}`}
                            className="text-link mt-3 text-sm"
                        >
                            {showAllLinks ? 'Show less' : `Show all ${links.length}`}
                        </button>
                    )}
                </div>
            )}
            </div>
        </div>
    );
}
