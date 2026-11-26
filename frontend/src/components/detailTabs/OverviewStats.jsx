import { statusMeta } from '../../utils/listStatus';
import {
    formatCompactCount,
    getStatusDistributionTotal,
    normalizeStatusDistribution,
} from '../../utils/statusDistribution';

const STATUSES = [
    { key: 'watching', status: 'Watching' },
    { key: 'plan_to_watch', status: 'Plan to Watch' },
    { key: 'completed', status: 'Completed' },
    { key: 'on_hold', status: 'On Hold' },
    { key: 'dropped', status: 'Dropped' },
].map(({ key, status }) => {
    const meta = statusMeta(status);
    return { key, label: meta?.label || status, color: meta?.color || 'var(--text-3)' };
});

const SCORES = Array.from({ length: 10 }, (_, i) => i + 1);

// Low scores red, high scores green, through amber: the scale people read
// without a legend.
const scoreColor = (score) => `hsl(${Math.round(((score - 1) / 9) * 120)} 70% 52%)`;

/**
 * Which status counts to show: AniList's when the catalog has them (far more
 * people), otherwise AniShows' own lists.
 */
function pickStatusSource(anime) {
    const anilist = normalizeStatusDistribution(anime?.status_distribution);
    if (getStatusDistributionTotal(anilist) > 0) return { counts: anilist };
    const site = normalizeStatusDistribution(anime?.site_status_distribution);
    if (getStatusDistributionTotal(site) > 0) return { counts: site };
    return null;
}

function StatusPanel({ counts }) {
    const total = getStatusDistributionTotal(counts);
    // Largest first, each as a bar on a shared track: lengths compare at a
    // glance, the exact numbers sit at the end of each row.
    const rows = STATUSES.filter(({ key }) => counts[key] > 0).sort((a, b) => counts[b.key] - counts[a.key]);
    const top = counts[rows[0].key];
    return (
        <section className="panel min-w-0" aria-labelledby="overview-status-title">
            <h2 id="overview-status-title" className="section-title mb-4">Status distribution</h2>
            <dl className="space-y-2.5">
                {rows.map(({ key, label, color }) => (
                    <div key={key} className="grid grid-cols-[5.75rem_minmax(0,1fr)_auto] items-center gap-3">
                        <dt className="text-sm text-[var(--text-2)]">{label}</dt>
                        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-[var(--ink-3)]">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (counts[key] / top) * 100)}%`, backgroundColor: color }} />
                        </div>
                        <dd className="min-w-[5.5rem] text-right text-sm tabular text-[var(--text-1)]">
                            {formatCompactCount(counts[key])}
                            <span className="ml-1.5 inline-block w-9 text-[var(--text-3)]">{Math.round((counts[key] / total) * 100)}%</span>
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

function ScorePanel({ scores }) {
    const values = SCORES.map((score) => Number(scores?.[String(score)] || 0));
    const max = Math.max(...values, 1);
    return (
        <section className="group/scores panel min-w-0" aria-labelledby="overview-score-title">
            <h2 id="overview-score-title" className="section-title mb-4">Score distribution</h2>
            <ol className="flex h-28 items-end gap-1.5 sm:gap-2" aria-label="Scores from 1 to 10">
                {SCORES.map((score, i) => {
                    const count = values[i];
                    return (
                        <li key={score} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                            <span className="sr-only">Score {score}: {count} {count === 1 ? 'person' : 'people'}</span>
                            {/* With a pointer every count shows while the panel is hovered;
                                touch screens always show them. Empty scores stay blank. */}
                            <span
                                aria-hidden="true"
                                className={`text-xs font-medium text-[var(--text-1)] tabular transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/scores:opacity-100 ${count === 0 ? 'invisible' : ''}`}
                            >
                                {formatCompactCount(count)}
                            </span>
                            <span
                                aria-hidden="true"
                                className="w-full max-w-5 rounded-full"
                                style={{
                                    height: count > 0 ? `${Math.max(8, (count / max) * 100)}%` : '4px',
                                    backgroundColor: count > 0 ? scoreColor(score) : 'var(--ink-3)',
                                }}
                            />
                            <span aria-hidden="true" className="text-xs text-[var(--text-2)] tabular">{score}</span>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

/**
 * The AniList-style stats row on Overview: who has the show on their list,
 * and how AniShows members scored it. Each half shows only when it has data.
 */
export default function OverviewStats({ anime }) {
    const status = pickStatusSource(anime);
    const scores = anime?.site_score_distribution;
    const hasScores = scores && Object.values(scores).some((n) => Number(n) > 0);
    if (!status && !hasScores) return null;
    return (
        <div className={`grid grid-cols-1 gap-4 ${status && hasScores ? 'lg:grid-cols-2' : ''}`}>
            {status && <StatusPanel {...status} />}
            {hasScores && <ScorePanel scores={scores} />}
        </div>
    );
}
