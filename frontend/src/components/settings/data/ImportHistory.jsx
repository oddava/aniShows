import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { importExportApi } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { formatDateTimeInUserTimezone } from '../../../utils/dateUtils';
import {
    OUTSIDE_CATALOG,
    RERUNNABLE_SOURCES,
    UNMATCHED_REASON_LABELS,
    isActiveJob,
    jobOutcome,
    jobSourceLabel,
} from './importHelpers';

const SHOWN = 3;

const formatWhen = (iso) => formatDateTimeInUserTimezone(iso, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

const itemKey = (item, index) => `${item.anilist_id || item.mal_id || item.title}-${index}`;

/** What a finished job left behind: titles not matched, titles left out, errors. */
const jobLeftovers = (job) => {
    const all = Array.isArray(job.unmatched) ? job.unmatched : [];
    return {
        unmatched: all.filter((item) => item.reason !== OUTSIDE_CATALOG),
        leftOut: all.filter((item) => item.reason === OUTSIDE_CATALOG),
        // A failed job's reason is already its outcome line.
        errors: job.status === 'failed' ? [] : (job.errors ?? []),
    };
};

function JobDetails({ id, unmatched, leftOut, errors }) {
    return (
        <div id={id} className="mt-2 space-y-4 text-sm">
            {unmatched.length > 0 && (
                <div>
                    <p className="font-medium text-[var(--text-1)]">Not matched</p>
                    <ul className="mt-1 space-y-0.5">
                        {unmatched.map((item, index) => (
                            <li key={itemKey(item, index)} className="text-[var(--text-2)]">
                                {item.title || 'Untitled'}
                                <span className="text-[var(--text-3)]"> · {UNMATCHED_REASON_LABELS[item.reason] || item.reason}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {leftOut.length > 0 && (
                <div>
                    <p className="font-medium text-[var(--text-1)]">Left out</p>
                    <p className="text-[var(--text-3)]">
                        AniShows lists Japanese anime, without music videos, so these were skipped.
                    </p>
                    <ul className="mt-1 space-y-0.5">
                        {leftOut.map((item, index) => (
                            <li key={itemKey(item, index)} className="text-[var(--text-2)]">{item.title || 'Untitled'}</li>
                        ))}
                    </ul>
                </div>
            )}
            {errors.length > 0 && (
                <div>
                    <p className="font-medium text-[var(--text-1)]">Errors</p>
                    <ul className="mt-1 space-y-0.5 text-[var(--text-2)]">
                        {errors.slice(0, 5).map((err, index) => <li key={index}>{err}</li>)}
                        {errors.length > 5 && <li>...and {errors.length - 5} more</li>}
                    </ul>
                </div>
            )}
        </div>
    );
}

function JobRow({ job, canRunAgain, disabled, onRunAgain, runningAgain, onCancel, cancelling }) {
    const [open, setOpen] = useState(false);
    const active = isActiveJob(job);
    const progress = Math.min(Math.max(Number(job.progress_percentage) || 0, 0), 100);
    const leftovers = jobLeftovers(job);
    const hasDetails = !active && (leftovers.unmatched.length + leftovers.leftOut.length + leftovers.errors.length) > 0;
    const detailsId = `import-job-${job.id}-details`;

    return (
        <li className="py-3" data-testid={`import-job-${job.id}`}>
            <div className="flex items-baseline justify-between gap-4">
                <p className="min-w-0 truncate text-[15px] text-[var(--text-1)]">{jobSourceLabel(job)}</p>
                <p className="shrink-0 text-sm text-[var(--text-3)] tabular">{formatWhen(job.created_at)}</p>
            </div>
            <p className={`text-sm ${job.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>
                {jobOutcome(job)}
            </p>

            {active && (
                <div
                    className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"
                    role="progressbar"
                    aria-label="Import progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                >
                    <div className="progress-fill h-full bg-[var(--signature)]" style={{ '--progress': progress / 100 }} />
                </div>
            )}

            {(active || canRunAgain || hasDetails) && (
                <div className="-ml-3 mt-1 flex flex-wrap items-center">
                    {active && (
                        <button type="button" onClick={onCancel} disabled={cancelling} className="btn-ghost text-sm">
                            {cancelling ? 'Cancelling...' : 'Cancel'}
                        </button>
                    )}
                    {canRunAgain && (
                        <button type="button" onClick={onRunAgain} disabled={disabled} className="btn-ghost text-sm">
                            {runningAgain ? 'Starting...' : (job.status === 'failed' ? 'Try again' : 'Import again')}
                        </button>
                    )}
                    {hasDetails && (
                        <button
                            type="button"
                            onClick={() => setOpen((on) => !on)}
                            aria-expanded={open}
                            aria-controls={open ? detailsId : undefined}
                            className="btn-ghost text-sm"
                        >
                            {open ? 'Hide details' : 'Details'}
                        </button>
                    )}
                </div>
            )}

            {open && hasDetails && <JobDetails id={detailsId} {...leftovers} />}
        </li>
    );
}

/**
 * Past and running imports, newest first: the latest few, then the rest on
 * request. A running job shows its progress and can be cancelled; the newest
 * username import can be run again (AniList only while not linked: a linked
 * account uses Sync now).
 */
export default function ImportHistory({ imports, link, disabled, onStarted, onError }) {
    const [showAll, setShowAll] = useState(false);
    const { jobs, isError, retry, cancel } = imports;

    const rerun = useMutation({
        mutationFn: (job) => (job.source === 'anilist'
            ? importExportApi.importAniList(job.source_identifier)
            : importExportApi.importMAL(job.source_identifier)),
        onSuccess: onStarted,
        onError: (err) => onError(getApiErrorMessage(err, 'The import could not start.')),
    });

    if (isError) {
        return (
            <div className="mt-8">
                <h3 className="text-[15px] font-medium text-[var(--text-1)]">Recent imports</h3>
                <p className="mt-1 text-sm text-[var(--text-2)]">
                    Your import history could not be loaded.{' '}
                    <button type="button" onClick={retry} className="font-medium text-[var(--signature)] hover:text-[var(--signature-hover)]">
                        Try again
                    </button>
                </p>
            </div>
        );
    }
    if (!jobs.length) return null;

    const visible = showAll ? jobs : jobs.slice(0, SHOWN);
    const canRunAgain = (job) => (
        RERUNNABLE_SOURCES.includes(job.source)
        && !!job.source_identifier
        && !isActiveJob(job)
        && !(job.source === 'anilist' && link)
    );

    return (
        <div className="mt-8">
            <h3 className="text-[15px] font-medium text-[var(--text-1)]">Recent imports</h3>
            <ul className="mt-1 divide-y divide-white/[0.06]">
                {visible.map((job, index) => (
                    <JobRow
                        key={job.id}
                        job={job}
                        // Only the newest: older rows are a record, not a menu.
                        canRunAgain={index === 0 && canRunAgain(job)}
                        disabled={disabled || rerun.isPending}
                        onRunAgain={() => rerun.mutate(job)}
                        runningAgain={rerun.isPending && rerun.variables?.id === job.id}
                        onCancel={() => cancel.mutate(job.id, {
                            onError: (err) => onError(getApiErrorMessage(err, 'The import could not be cancelled.')),
                        })}
                        cancelling={cancel.isPending && cancel.variables === job.id}
                    />
                ))}
            </ul>
            {jobs.length > SHOWN && (
                <button type="button" onClick={() => setShowAll((on) => !on)} className="btn-ghost -ml-3 text-sm">
                    {showAll ? 'Show fewer' : `Show all ${jobs.length}`}
                </button>
            )}
        </div>
    );
}
