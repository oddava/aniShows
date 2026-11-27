import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { ChevronDown } from 'lucide-react';

import { importExportApi } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { importJobQueries } from '../../../api/queries/importJobs';
import CoverThumb, { animeCoverSources } from '../../ui/CoverThumb';
import { formatDateTimeInUserTimezone } from '../../../utils/dateUtils';
import {
    OUTSIDE_CATALOG,
    RERUNNABLE_SOURCES,
    UNMATCHED_REASON_LABELS,
    changeDescription,
    isActiveJob,
    jobCounts,
    jobFailureMessage,
    jobOutcome,
    jobSourceLabel,
} from './importHelpers';

const COVERS_SHOWN = 12;
const EARLIER_SHOWN = 5;

/* What each part of the breakdown means, in the order the bar draws them. */
const PARTS = [
    { key: 'added', label: 'Added', color: 'var(--success)' },
    { key: 'updated', label: 'Updated', color: 'var(--signature)' },
    { key: 'changed', label: 'Added or updated', color: 'var(--signature)' },
    { key: 'skipped', label: 'Skipped', color: 'rgb(255 255 255 / 0.22)' },
    { key: 'notMatched', label: 'Not matched', color: 'var(--status-on-hold)' },
];

const ago = (iso) => {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return formatDistanceToNowStrict(date, { addSuffix: true });
};

const formatWhen = (iso) => formatDateTimeInUserTimezone(iso, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

/** The parts a job has, with their counts: added and updated apart when known. */
const partsOf = (counts) => PARTS
    .filter(({ key }) => (counts.split ? key !== 'changed' : key !== 'added' && key !== 'updated'))
    .map((part) => ({ ...part, count: counts[part.key] }))
    .filter((part) => part.count > 0);

/**
 * One bar split by what happened to each entry, the not-yet-read rest as an
 * empty track while the import runs, and a key with the counts.
 */
function Breakdown({ job, compact = false }) {
    const counts = jobCounts(job);
    const parts = partsOf(counts);
    const total = parts.reduce((sum, part) => sum + part.count, 0) + counts.remaining;
    if (!total) return null;

    return (
        <div className={compact ? 'mt-2' : 'mt-4'}>
            <div
                role="img"
                aria-label={parts.map((part) => `${part.label} ${part.count}`).join(', ') || 'Nothing read yet'}
                className={`flex gap-[3px] overflow-hidden rounded-full bg-white/[0.06] ${compact ? 'h-1.5' : 'h-2.5'}`}
            >
                {parts.map((part) => (
                    <span
                        key={part.key}
                        className="h-full transition-[flex-grow] duration-500 ease-[var(--ease-out)] first:rounded-l-full last:rounded-r-full motion-reduce:transition-none"
                        style={{ flexGrow: part.count, flexBasis: 0, minWidth: '6px', backgroundColor: part.color }}
                    />
                ))}
                {counts.remaining > 0 && <span className="h-full" style={{ flexGrow: counts.remaining, flexBasis: 0 }} />}
            </div>
            {!compact && parts.length > 0 && (
                <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
                    {parts.map((part) => (
                        <li key={part.key} className="inline-flex items-center gap-2 text-[13px] text-[var(--text-2)]">
                            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: part.color }} />
                            {part.label}
                            <span className="text-[var(--text-1)] tabular">{part.count.toLocaleString()}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ChangeCover({ item }) {
    const anime = item.anime;
    const added = item.kind === 'added';
    const dot = added ? 'var(--success)' : 'var(--signature)';
    return (
        <li className="min-w-0">
            <Link to={`/anime/${anime.slug}`} className="group block" title={anime.title}>
                <CoverThumb sources={animeCoverSources(anime)} className="aspect-[2/3] w-full rounded-lg" />
                <span className="mt-1.5 block truncate text-[13px] leading-snug text-[var(--text-1)] transition-colors group-hover:text-[var(--signature)]">
                    {anime.title}
                </span>
                <span className="mt-0.5 flex items-start gap-1.5 text-[12px] leading-snug text-[var(--text-2)]">
                    {/* The dot is the bar's colour for the kind: green added, blue updated. */}
                    <span aria-hidden="true" className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
                    <span className="sr-only">{added ? 'Added' : 'Updated'}: </span>
                    <span className="line-clamp-2">{changeDescription(item)}</span>
                </span>
            </Link>
        </li>
    );
}

/**
 * The titles a job touched: covers for what it added or updated (each with
 * what changed), plain rows for what it could not match or left out. A
 * filter per kind, the first dozen, then the rest on request.
 */
function Changes({ job, detail, detailPending }) {
    const [filter, setFilter] = useState('all');
    const [showAll, setShowAll] = useState(false);

    const items = detail?.changes?.items ?? [];
    const unmatched = Array.isArray(job.unmatched) ? job.unmatched : [];
    const groups = [
        { key: 'added', label: 'Added', entries: items.filter((item) => item.kind === 'added') },
        { key: 'updated', label: 'Updated', entries: items.filter((item) => item.kind === 'updated') },
        { key: 'not_matched', label: 'Not matched', entries: unmatched.filter((item) => item.reason !== OUTSIDE_CATALOG) },
        { key: 'left_out', label: 'Left out', entries: unmatched.filter((item) => item.reason === OUTSIDE_CATALOG) },
    ].filter((group) => group.entries.length);

    const expectCovers = jobCounts(job).changed > 0 && job.changes?.added !== undefined && job.changes?.added !== null;
    if (detailPending && expectCovers) {
        return (
            <ul aria-hidden="true" className="mt-6 grid grid-cols-3 gap-3 xs:grid-cols-4 sm:grid-cols-6">
                {Array.from({ length: 6 }, (_, index) => (
                    <li key={index}><span className="skeleton-shimmer block aspect-[2/3] rounded-lg" /></li>
                ))}
            </ul>
        );
    }
    if (!groups.length) return null;

    const active = groups.some((group) => group.key === filter) ? filter : 'all';
    const covers = active === 'all' ? items : (groups.find((group) => group.key === active && (group.key === 'added' || group.key === 'updated'))?.entries ?? []);
    const rows = active === 'all'
        ? groups.filter((group) => group.key === 'not_matched' || group.key === 'left_out')
        : groups.filter((group) => group.key === active && (group.key === 'not_matched' || group.key === 'left_out'));
    const shownCovers = showAll ? covers : covers.slice(0, COVERS_SHOWN);
    const totalAll = groups.reduce((sum, group) => sum + group.entries.length, 0);

    return (
        <div className="mt-6">
            {groups.length > 1 && (
                <div role="group" aria-label="Show" className="-mx-1 flex flex-wrap gap-1">
                    {[{ key: 'all', label: 'All', entries: { length: totalAll } }, ...groups].map((group) => (
                        <button
                            key={group.key}
                            type="button"
                            aria-pressed={active === group.key}
                            onClick={() => { setFilter(group.key); setShowAll(false); }}
                            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors
                            ${active === group.key ? 'bg-white/[0.08] text-[var(--text-1)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'}`}
                        >
                            {group.label}
                            <span className="text-[var(--text-3)] tabular">{group.entries.length}</span>
                        </button>
                    ))}
                </div>
            )}

            {shownCovers.length > 0 && (
                <ul className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 xs:grid-cols-4 sm:grid-cols-6">
                    {shownCovers.map((item) => <ChangeCover key={`${item.kind}-${item.anime_id}`} item={item} />)}
                </ul>
            )}
            {covers.length > COVERS_SHOWN && (
                <button type="button" onClick={() => setShowAll((on) => !on)} className="btn-ghost -ml-3 mt-2 text-sm">
                    {showAll ? 'Show fewer' : `Show all ${covers.length}`}
                </button>
            )}

            {rows.map((group) => (
                <div key={group.key} className="mt-5">
                    <p className="text-sm font-medium text-[var(--text-1)]">
                        {group.label}
                    </p>
                    {group.key === 'left_out' && (
                        <p className="text-sm text-[var(--text-3)]">AniShows lists Japanese anime, without music videos.</p>
                    )}
                    <ul className={`mt-1.5 grid gap-x-6 gap-y-1 text-sm ${group.key === 'left_out' ? 'sm:grid-cols-2' : ''}`}>
                        {group.entries.map((item, index) => (
                            <li key={`${item.anilist_id || item.mal_id || item.title}-${index}`} className="min-w-0 text-[var(--text-2)]">
                                {item.title || 'Untitled'}
                                {group.key === 'not_matched' && (
                                    <span className="text-[var(--text-3)]"> · {UNMATCHED_REASON_LABELS[item.reason] || item.reason}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

/** An earlier import: one line, a thin bar, and its changes when opened. */
function EarlierImport({ job, userId }) {
    const [open, setOpen] = useState(false);
    const detailQuery = useQuery({ ...importJobQueries.status(userId, job.id), enabled: open, staleTime: 5 * 60 * 1000 });
    const panelId = `import-job-${job.id}-changes`;

    return (
        <li className="py-3" data-testid={`import-job-${job.id}`}>
            <button
                type="button"
                onClick={() => setOpen((on) => !on)}
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                className="flex w-full items-center gap-3 text-left"
            >
                <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-4">
                        <span className="truncate text-[15px] text-[var(--text-1)]">{jobSourceLabel(job)}</span>
                        <span className="shrink-0 text-[13px] text-[var(--text-3)] tabular">{formatWhen(job.created_at)}</span>
                    </span>
                    <span className={`block truncate text-sm ${job.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>
                        {jobOutcome(job)}
                    </span>
                </span>
                <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--text-3)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div id={panelId}>
                    <Breakdown job={job} />
                    <Changes job={job} detail={detailQuery.data} detailPending={detailQuery.isPending} />
                </div>
            )}
        </li>
    );
}

/**
 * The latest import, large: where it came from, a live breakdown of what
 * happened to each entry, and the covers of what changed. Earlier imports
 * follow as one line each.
 */
export default function ImportActivity({ userId, imports, link, disabled }) {
    const [showAll, setShowAll] = useState(false);
    const [error, setError] = useState('');
    const { jobs, isError, retry, cancel, track } = imports;
    const latest = jobs[0];

    const detailQuery = useQuery({
        ...importJobQueries.status(userId, latest?.id),
        enabled: !!latest,
        staleTime: 0,
        retry: false,
    });
    // The polled copy is fresher than the list's while the job runs.
    const job = detailQuery.data?.id === latest?.id && detailQuery.data ? detailQuery.data : latest;

    const rerun = useMutation({
        mutationFn: (target) => (target.source === 'anilist'
            ? importExportApi.importAniList(target.source_identifier)
            : importExportApi.importMAL(target.source_identifier)),
        onSuccess: () => {
            setError('');
            track();
        },
        onError: (err) => setError(getApiErrorMessage(err, 'The import could not start.')),
    });

    if (isError) {
        return (
            <section className="panel">
                <h2 className="section-title">Latest import</h2>
                <p className="mt-2 text-sm text-[var(--text-2)]">
                    Your imports could not be loaded.{' '}
                    <button type="button" onClick={retry} className="font-medium text-[var(--signature)] hover:text-[var(--signature-hover)]">
                        Try again
                    </button>
                </p>
            </section>
        );
    }
    if (!job) return null;

    const running = isActiveJob(job);
    const canRunAgain = !running
        && RERUNNABLE_SOURCES.includes(job.source)
        && !!job.source_identifier
        && !(job.source === 'anilist' && link);
    const earlier = jobs.slice(1);
    const shownEarlier = showAll ? earlier : earlier.slice(0, EARLIER_SHOWN);
    const progress = Math.min(Math.max(Number(job.progress_percentage) || 0, 0), 100);

    return (
        <section className="panel" aria-labelledby="latest-import-title">
            <div className="flex items-center gap-3" data-testid={`import-job-${job.id}`}>
                <div className="min-w-0 flex-1">
                    <h2 id="latest-import-title" className="section-title">{running ? 'Importing now' : 'Latest import'}</h2>
                    <p className="truncate text-sm text-[var(--text-2)]">
                        {jobSourceLabel(job)}
                        <span className="text-[var(--text-3)]"> · {running ? `started ${ago(job.started_at || job.created_at)}` : ago(job.completed_at || job.created_at)}</span>
                    </p>
                </div>
                {running ? (
                    <button
                        type="button"
                        onClick={() => cancel.mutate(job.id, {
                            onError: (err) => setError(getApiErrorMessage(err, 'The import could not be cancelled.')),
                        })}
                        disabled={cancel.isPending}
                        className="btn-ghost -mr-3 shrink-0 text-sm"
                    >
                        {cancel.isPending ? 'Cancelling...' : 'Cancel'}
                    </button>
                ) : canRunAgain && (
                    <button
                        type="button"
                        onClick={() => rerun.mutate(job)}
                        disabled={disabled || rerun.isPending}
                        className="btn-secondary shrink-0 text-sm"
                    >
                        {rerun.isPending ? 'Starting...' : (job.status === 'failed' ? 'Try again' : 'Import again')}
                    </button>
                )}
            </div>

            {running && (
                <div className="mt-4" aria-live="polite">
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                        <span className="text-[var(--text-1)]">{jobOutcome(job)}</span>
                        <span className="text-[var(--text-3)] tabular">{progress}%</span>
                    </div>
                    <div
                        className="sr-only"
                        role="progressbar"
                        aria-label="Import progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                    />
                </div>
            )}
            {!running && (job.status === 'failed' || job.status === 'cancelled') && (
                <p className={`mt-4 text-sm ${job.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>
                    {job.status === 'failed' ? jobFailureMessage(job) : 'Cancelled. What it changed before that is kept.'}
                </p>
            )}
            {!running && job.status === 'completed' && jobCounts(job).changed === 0 && (
                <p className="mt-4 text-sm text-[var(--text-2)]">
                    {job.mode === 'incremental' ? 'Already up to date. Nothing changed on AniList since the last sync.' : 'Nothing new: your list already had all of it.'}
                </p>
            )}

            <Breakdown job={job} />
            <Changes job={job} detail={detailQuery.data?.id === job.id ? detailQuery.data : null} detailPending={detailQuery.isPending} />

            <div aria-live="polite">
                {error && <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
            </div>

            {earlier.length > 0 && (
                <div className="mt-8">
                    <h3 className="text-[15px] font-medium text-[var(--text-1)]">Earlier imports</h3>
                    <ul className="mt-1 divide-y divide-white/[0.06]">
                        {shownEarlier.map((item) => <EarlierImport key={item.id} job={item} userId={userId} />)}
                    </ul>
                    {earlier.length > EARLIER_SHOWN && (
                        <button type="button" onClick={() => setShowAll((on) => !on)} className="btn-ghost -ml-3 text-sm">
                            {showAll ? 'Show fewer' : `Show all ${earlier.length}`}
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
