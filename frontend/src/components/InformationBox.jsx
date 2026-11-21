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

/** A fact as a row: label left, value right; whitespace, no rules. */
const InfoRow = ({ label, value }) => (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-1.5">
        <dt className="shrink-0 text-sm text-[var(--text-2)]">{label}</dt>
        <dd className="min-w-0 max-w-[65%] break-words text-right text-[15px] text-[var(--text-1)]">{value}</dd>
    </div>
);

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

export default function InformationBox({ anime, className = '' }) {
    const [showAllTags, setShowAllTags] = useState(false);
    const [showAllLinks, setShowAllLinks] = useState(false);
    const tagCount = anime?.tags?.length || 0;
    const visibleTags = showAllTags ? anime?.tags || [] : (anime?.tags || []).slice(0, TAG_PREVIEW_COUNT);
    const links = anime?.external_links || [];
    const visibleLinks = showAllLinks ? links : links.slice(0, LINK_PREVIEW_COUNT);
    const totalMembers = getStatusDistributionTotal(
        normalizeStatusDistribution(anime?.status_distribution)
    );

    const formatDateRange = () => {
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const startStr = formatDate(anime.release_date, options);

        if (anime.status === 'Airing' && !anime.end_date) {
            return `${startStr} to now`;
        }

        if (anime.end_date) {
            const endStr = formatDate(anime.end_date, options);
            if (startStr === endStr) return startStr;
            return (
                <>
                    {startStr}
                    <br />
                    <span className="text-[var(--text-2)]">to</span> {endStr}
                </>
            );
        }

        return startStr;
    };

    const season = [capsToSentence(anime.season), anime.season_year].filter(Boolean).join(' ');

    return (
        <div className={`flex min-w-0 flex-col gap-8 ${className}`}>
            {anime.status !== 'Finished' && anime.next_airing_date && (
                <div>
                    <p className="text-sm text-[var(--signature)]">Next episode</p>
                    <p className="mt-1 text-[17px] font-semibold text-[var(--text-1)]">
                        Episode {anime.next_airing_episode ?? 'TBA'}
                        <span className="font-normal text-[var(--text-2)]"> · {formatRelativeTime(anime.next_airing_date)}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--text-3)]">{formatAiringTime(anime.next_airing_date)}</p>
                </div>
            )}

            <section aria-labelledby={`info-${anime.id}`}>
                <h2 id={`info-${anime.id}`} className="section-title mb-3">Details</h2>
                <dl>
                    {anime.anime_type && <InfoRow label="Type" value={anime.anime_type} />}
                    <InfoRow label="Episodes" value={anime.episode_count || 'Unknown'} />
                    {anime.duration_minutes > 0 && (
                        <InfoRow label="Duration" value={`${anime.duration_minutes} min`} />
                    )}
                    {anime.release_date && <InfoRow label="Aired" value={formatDateRange()} />}
                    {season && <InfoRow label="Season" value={season} />}
                    {anime.source_material && <InfoRow label="Source" value={anime.source_material} />}
                    {anime.studio && <InfoRow label="Studio" value={anime.studio.name} />}
                    {totalMembers > 0 && (
                        <InfoRow label="Members" value={<span className="tabular">{formatCompactCount(totalMembers)}</span>} />
                    )}
                </dl>
            </section>

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
    );
}
