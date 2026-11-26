import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import MarkdownRenderer from '../../common/MarkdownRenderer';
import AnimeMediaImage from '../../common/AnimeMediaImage';
import ProfileCard from './ProfileCard';
import { profileQueries } from '../../../api/queries/user';
import { profileScore } from '../profileStats';

/* ------------------------------------------------------------------ About */

// Folded, the bio shows whole blocks (paragraphs, lists) up to about this
// many characters: never a line cut in half, never a fade.
const ABOUT_FOLD_CHARS = 160;

/** The bio's first blocks, up to ABOUT_FOLD_CHARS; null when it all fits. */
function foldBio(bio) {
    const text = String(bio || '');
    const blocks = text.split(/\n\s*\n/);
    if (blocks.length < 2) return null;
    const kept = [];
    let length = 0;
    for (const block of blocks) {
        if (kept.length > 0 && length + block.length > ABOUT_FOLD_CHARS) break;
        kept.push(block);
        length += block.length;
    }
    // A short last block (a heading or a bold label like "How I rate") would
    // dangle above "Show more" with nothing under it: leave it for later.
    if (kept.length > 1 && kept[kept.length - 1].trim().length < 40) kept.pop();
    return kept.length < blocks.length ? kept.join('\n\n') : null;
}

/** The bio, folded to its first paragraphs behind "Show more". */
export function AboutCard({ bio, className = '' }) {
    const [open, setOpen] = useState(false);
    const folded = useMemo(() => foldBio(bio), [bio]);
    return (
        <ProfileCard title="About" className={`profile-about ${className}`}>
            <div className="text-[15px] text-[var(--text-2)]">
                <MarkdownRenderer content={folded && !open ? folded : bio} className="overview-about-markdown" />
            </div>
            {folded && (
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                    className="-mb-2 mt-1 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                >
                    {open ? 'Show less' : 'Show more'}
                    <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
            )}
        </ProfileCard>
    );
}

/* ------------------------------------------------------------------ Taste */

/**
 * Taste in words and one small chart: the top genres with how many shows
 * each, and how they score (ten columns, the most common score in their
 * colour).
 */
export function TasteCard({ summary, user, className = '' }) {
    const { mean, rated } = profileScore(user, summary);
    const genres = (summary?.top_genres || []).filter((genre) => genre?.name && genre.count > 0).slice(0, 6);
    const histogram = summary?.score_histogram || {};
    // Always the full 1-10 scale, so charts compare across profiles.
    const scores = Array.from({ length: 10 }, (_, index) => Number(histogram[String(index + 1)]) || 0);
    const maxScore = Math.max(...scores);
    if (genres.length === 0 && maxScore === 0) return null;

    return (
        <ProfileCard title="Taste" className={className}>
            {genres.length > 0 && (
                <ul className="grid grid-cols-2 gap-2">
                    {genres.map((genre) => (
                        <li key={genre.slug || genre.name} className="min-w-0">
                            <Link
                                to={genre.slug ? `/browse?genre=${encodeURIComponent(genre.slug)}` : '/browse'}
                                className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-white/[0.05] px-3 text-sm text-[var(--text-1)] transition-colors hover:bg-white/[0.09]"
                            >
                                {genre.name}
                                <span className="text-[var(--text-3)] tabular">{genre.count.toLocaleString()}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {maxScore > 0 && (
                <div className={genres.length > 0 ? 'mt-4 border-t border-[var(--line-1)] pt-4' : ''}>
                    <p className="mb-3 flex items-baseline justify-between gap-3 text-[13px] text-[var(--text-3)]">
                        Scores
                        {mean != null && (
                            <span className="tabular">
                                Mean <span className="font-semibold text-[var(--text-1)]">{mean}</span> of {rated.toLocaleString()}
                            </span>
                        )}
                    </p>
                    <div
                        role="img"
                        aria-label={`Scores: ${scores.map((count, index) => `${index + 1}: ${count}`).join(', ')}`}
                        className="flex h-14 items-end gap-1.5 border-b border-[var(--line-2)]"
                    >
                        {scores.map((count, index) => (
                            <span
                                key={index}
                                className="mx-auto w-full max-w-6 flex-1 rounded-t-[3px]"
                                style={{
                                    height: count ? `max(4px, ${(count / maxScore) * 100}%)` : '3px',
                                    backgroundColor: count === maxScore ? 'var(--pa)' : count ? '#505864' : '#2f3542',
                                }}
                            />
                        ))}
                    </div>
                    <div aria-hidden="true" className="mt-1.5 flex gap-1.5 text-center text-xs tabular">
                        {scores.map((_, index) => (
                            <span key={index} className="mx-auto w-full max-w-6 flex-1 text-[var(--text-3)]">{index + 1}</span>
                        ))}
                    </div>
                </div>
            )}
        </ProfileCard>
    );
}

/* ---------------------------------------------------------- Compatibility */

const LABELS = {
    super: 'Super match',
    high: 'High match',
    medium: 'Medium match',
    low: 'Low match',
    very_low: 'Very low match',
};

/**
 * Last.fm's taste-o-meter: how close the viewer's list is to this one, and
 * the shows they both watched. Signed-in viewers on someone else's profile.
 */
export function CompatibilityCard({ username, viewerHasList, className = '' }) {
    const { data, isPending, isError } = useQuery({
        ...profileQueries.compatibility(username),
        enabled: Boolean(username) && viewerHasList,
        staleTime: 5 * 60 * 1000,
    });

    if (!viewerHasList || isError) return null;
    if (isPending) {
        return <div aria-hidden="true" className={`profile-card h-40 ${className}`} />;
    }
    if (!data?.enough_data || !data.shared_count) {
        return (
            <ProfileCard title="You and them" className={className}>
                <p className="text-[15px] text-[var(--text-2)]">
                    No shows in common yet.
                </p>
            </ProfileCard>
        );
    }

    return (
        <ProfileCard title="You and them" className={className}>
            <p className="flex items-baseline gap-3">
                <span className="profile-stat-value tabular">{data.score}%</span>
                <span className="text-[15px] text-[var(--text-1)]">{LABELS[data.label] || 'Match'}</span>
            </p>
            <p className="mt-1 text-sm text-[var(--text-3)]">
                {data.shared_count.toLocaleString()} {data.shared_count === 1 ? 'show' : 'shows'} in common
            </p>
            {data.shared?.length > 0 && (
                <ul className="mt-4 grid grid-cols-5 gap-2" aria-label="Shows you both watched">
                    {data.shared.slice(0, 4).map((anime) => (
                        <li key={anime.id}>
                            <Link
                                to={`/anime/${anime.slug}`}
                                title={anime.title}
                                className="block aspect-[2/3] overflow-hidden rounded-[var(--radius-sm)] bg-[var(--ink-2)]"
                            >
                                <AnimeMediaImage anime={anime} kind="cover" size="small" alt={anime.title} className="h-full w-full object-cover" />
                            </Link>
                        </li>
                    ))}
                    {data.shared_count > 4 && (
                        <li>
                            <span className="flex aspect-[2/3] items-center justify-center rounded-[var(--radius-sm)] bg-[var(--ink-2)] text-sm font-medium text-[var(--text-2)] tabular">
                                +{(data.shared_count - 4).toLocaleString()}
                            </span>
                        </li>
                    )}
                </ul>
            )}
        </ProfileCard>
    );
}

/* ---------------------------------------------------------- Make it yours */

/**
 * The owner's nudge toward a fuller profile: what is still missing, each a
 * link to the setting. Gone once everything is there.
 */
export function MakeItYoursCard({ user, hasFavorites, className = '' }) {
    const steps = [
        { done: Boolean(user?.banner), label: 'Add a banner' },
        { done: Boolean(user?.avatar), label: 'Add a profile picture' },
        { done: Boolean(user?.status_text || user?.status_emoji), label: 'Set a status' },
        { done: Boolean(user?.bio), label: 'Write a short bio' },
        { done: Boolean(user?.display_name || user?.pronouns), label: 'Add a display name or pronouns' },
        { done: hasFavorites, label: 'Pick some favorites', to: '/browse?sort=trending' },
    ];
    const missing = steps.filter((step) => !step.done);
    if (missing.length === 0) return null;

    return (
        <section className={`profile-card ${className}`}>
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="profile-card-title">Make it yours</h2>
                <span className="text-sm text-[var(--text-3)] tabular">{steps.length - missing.length} of {steps.length}</span>
            </div>
            <ul className="-mx-2 mt-2">
                {missing.slice(0, 3).map((step) => (
                    <li key={step.label}>
                        <Link
                            to={step.to || '/settings'}
                            className="flex min-h-[2.75rem] items-center justify-between gap-3 rounded-lg px-2 text-[15px] text-[var(--text-2)] transition-colors hover:bg-white/[0.04] hover:text-[var(--text-1)]"
                        >
                            {step.label}
                            <ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--text-3)]" />
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}
