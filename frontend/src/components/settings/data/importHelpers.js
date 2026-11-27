/* Pure helpers for the Import & export tab: input parsing, file checks, job wording. */
import { ACTIVE_IMPORT_STATUSES } from '../../../api/queries/importJobs';
import { statusLabel } from '../../../utils/listStatus';

export const MAX_XML_UPLOAD_BYTES = 10 * 1024 * 1024;
const XML_FILE_PATTERN = /\.(xml|xml\.gz|gz)$/i;

export const SOURCES = {
    mal: {
        label: 'MyAnimeList',
        hint: 'Public list or export file',
        exportUrl: 'https://myanimelist.net/panel.php?go=export',
    },
    anilist: {
        label: 'AniList',
        hint: 'Public list, kept in sync',
        profileUrl: (username) => `https://anilist.co/user/${encodeURIComponent(username)}/`,
    },
};

/** A job's site, as a SOURCES key. */
export const jobSite = (job) => (job?.source === 'anilist' ? 'anilist' : 'mal');

/** The username rule the server enforces (import_job_service.USERNAME_PATTERN). */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,50}$/;

const PROFILE_URLS = [
    { source: 'anilist', pattern: /anilist\.co\/user\/([^/?#\s]+)/i },
    { source: 'mal', pattern: /myanimelist\.net\/(?:profile|animelist)\/([^/?#\s]+)/i },
];

/**
 * What the person typed or pasted: a bare username, or a profile / list link
 * from either site. A link also says which site it is from.
 * Returns `{ source: 'mal' | 'anilist' | null, username }`.
 */
export const parseListInput = (raw) => {
    const value = (raw ?? '').trim();
    for (const { source, pattern } of PROFILE_URLS) {
        const match = value.match(pattern);
        if (match) return { source, username: decodeURIComponent(match[1]) };
    }
    return { source: null, username: value.replace(/^@/, '') };
};

/** Why `username` cannot be imported, or null when it can. */
export const usernameError = (username, sourceLabel) => {
    if (!username) return `Enter your ${sourceLabel} username.`;
    if (!USERNAME_PATTERN.test(username)) {
        return 'Usernames only have letters, numbers, underscores and hyphens.';
    }
    return null;
};

/** Why a picked file cannot be uploaded, or null when it can. */
export const validateXmlFile = (file) => {
    if (!file || !XML_FILE_PATTERN.test(file.name)) {
        return 'Choose a MyAnimeList export file (.xml or .xml.gz).';
    }
    if (file.size > MAX_XML_UPLOAD_BYTES) {
        return 'That file is over 10 MB.';
    }
    return null;
};

export const isActiveJob = (job) => ACTIVE_IMPORT_STATUSES.includes(job?.status);

/** The reason a job stopped: the fatal reason, else the last error recorded. */
export const jobFailureMessage = (job) => (
    job?.failure_reason || job?.errors?.[job.errors.length - 1] || 'Something went wrong.'
);

/** Titles left out on purpose: AniShows lists Japanese anime only, without music videos. */
export const OUTSIDE_CATALOG = 'outside_catalog';

export const UNMATCHED_REASON_LABELS = {
    not_in_catalog_yet: 'Not in the catalog yet. Importing again later can pick it up.',
    not_found: 'Not found on AniList',
    unknown_status: 'Unknown list status',
    invalid: 'Invalid entry',
};

/** Sources whose import can be started again from the username alone. */
export const RERUNNABLE_SOURCES = ['mal_api', 'anilist'];

/** "MyAnimeList · kiyo", "MyAnimeList file", "AniList sync · kiyo". */
export const jobSourceLabel = (job) => {
    if (job.source === 'mal_xml') return 'MyAnimeList file';
    const site = job.source === 'anilist' ? 'AniList' : 'MyAnimeList';
    const kind = job.mode === 'incremental' ? `${site} sync` : site;
    return job.source_identifier ? `${kind} · ${job.source_identifier}` : kind;
};

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * What a job did, as numbers. `split` says whether the job recorded added and
 * updated apart (jobs from before change records only have the sum).
 */
export const jobCounts = (job) => {
    const changes = job?.changes || {};
    const split = Number.isFinite(changes.added) && Number.isFinite(changes.updated);
    const changed = split ? changes.added + changes.updated : (job?.imported_entries || 0);
    return {
        split,
        added: split ? changes.added : 0,
        updated: split ? changes.updated : 0,
        changed,
        skipped: job?.skipped_entries || 0,
        notMatched: job?.failed_entries || 0,
        remaining: isActiveJob(job) ? Math.max((job.total_entries || 0) - (job.processed_entries || 0), 0) : 0,
    };
};

/** One line that says what a job did, in the words the person cares about. */
export const jobOutcome = (job) => {
    if (job.status === 'pending') return 'Waiting to start';
    if (job.status === 'processing') {
        return job.total_entries
            ? `${job.processed_entries} of ${job.total_entries} entries`
            : 'Reading your list';
    }
    if (job.status === 'failed') return jobFailureMessage(job);

    const counts = jobCounts(job);
    if (job.mode === 'incremental' && counts.changed === 0 && job.status === 'completed') {
        return 'Already up to date';
    }
    const parts = counts.split
        ? [`${counts.added} added`, `${counts.updated} updated`]
        : [`${plural(counts.changed, 'title', 'titles')} added or updated`];
    if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    if (counts.notMatched) parts.push(`${counts.notMatched} not matched`);
    const line = parts.join(' · ');
    return job.status === 'cancelled' ? `Cancelled. ${line}` : line;
};

/** How one recorded change reads under its cover: "Watching", "Ep 2 → 6". */
export const changeDescription = (item) => {
    if (item.kind === 'added') return statusLabel(item.status) || 'Added';
    const from = item.from || {};
    const parts = [];
    if ('status' in from) parts.push(`${statusLabel(from.status)} → ${statusLabel(item.status)}`);
    if ('episodes_watched' in from) parts.push(`Ep ${from.episodes_watched} → ${item.episodes_watched}`);
    if ('score' in from) parts.push(`Score ${from.score || '–'} → ${item.score || '–'}`);
    return parts.length ? parts.join(' · ') : 'Dates or notes';
};
