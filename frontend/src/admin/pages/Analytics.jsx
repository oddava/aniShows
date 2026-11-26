import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';

import { adminApi, adminKeys, errorMessage } from '../api';
import { useAdminQuery } from '../hooks';
import { formatNumber, formatRelative, humanize, plural } from '../format';
import { notify, notifyError } from '../../components/ui/toast';
import {
    BarList, BarsChart, Button, Chip, Donut, ErrorState, Meter, PageHeader, Panel, PanelSkeleton, Select,
    StatCard, StatGrid, STATUS_COLORS, Tabs, TrendChart, UserCell,
} from '../ui';
import { fillDays } from './Dashboard';
import { entityTypeLabel, entryLabel } from '../auditLabels';
import { downloadJson } from './ops/common';

const TABS = [
    { value: 'overview', label: 'Overview' },
    { value: 'users', label: 'Users' },
    { value: 'content', label: 'Content' },
    { value: 'engagement', label: 'Engagement' },
];

const PERIODS = [
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: '365', label: 'Last 12 months' },
];

const PANEL_ID = 'analytics-panel';

const reportKey = (type, days) => adminKeys.view('reports', { type, days });

/** List status values from the API → the site's one label for each. */
const STATUS_LABELS = { 'Plan to Watch': 'Planning', 'On Hold': 'On hold' };

const pointsText = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return null;
    return `${number > 0 ? '+' : '−'}${Math.abs(Math.round(number * 10) / 10)} pts`;
};

function Grid({ children, columns = 2 }) {
    const cols = columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2';
    return <div className={`grid gap-4 sm:gap-5 ${cols}`}>{children}</div>;
}

function OverviewTab({ data, days }) {
    const users = data.users || {};
    const content = data.content || {};
    const engagement = data.engagement || {};
    const signups = fillDays(users.growth_by_day, Number(days));
    const activity = data.recent_activity || [];
    return (
        <div className="space-y-4 sm:space-y-5">
            <StatGrid columns={4}>
                <StatCard label="Members" value={users.total} change={users.growth} hint={`${formatNumber(users.new)} new`} to="/admin/users" />
                <StatCard label="Active members" value={users.active} change={users.active_growth} hint="vs the period before" />
                <StatCard
                    label="Returning"
                    value={`${formatNumber(users.retention)}%`}
                    hint={[pointsText(users.retention_change), 'of active members joined earlier'].filter(Boolean).join(' · ')}
                />
                <StatCard label="Average review score" value={engagement.avg_rating ? `${engagement.avg_rating}/10` : '—'} hint="All reviews" />
            </StatGrid>

            <Panel title="Sign-ups" description={`${plural(users.new || 0, 'new member')} in this period`}>
                <TrendChart data={signups} series={[{ key: 'count', name: 'Sign-ups' }]} label="Sign-ups per day" />
            </Panel>

            <StatGrid columns={4}>
                <StatCard label="Favorites" value={engagement.favorites} change={engagement.favorites_growth} hint="added in period vs before" />
                <StatCard label="Reviews" value={engagement.reviews} change={engagement.reviews_growth} hint="written in period vs before" to="/admin/reviews" />
                <StatCard label="List entries" value={engagement.watchlists} change={engagement.watchlists_growth} hint="updated in period vs before" />
                <StatCard
                    label="Anime"
                    value={content.anime_total}
                    hint={`${formatNumber(content.episodes_total)} episodes · ${formatNumber(content.genres_total)} genres · ${formatNumber(content.studios_total)} studios`}
                    to="/admin/anime"
                />
            </StatGrid>

            <Panel
                title="Recent admin activity"
                actions={<Link to="/admin/logs" className="text-link !min-h-9 text-sm">Audit log</Link>}
            >
                {activity.length === 0 ? (
                    <p className="text-sm text-[var(--text-3)]">No admin actions recorded yet.</p>
                ) : (
                    <ul className="space-y-2.5">
                        {activity.map((item, index) => (
                            <li key={item.id ?? `${item.time}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                <Chip tone="neutral" className="min-w-[4.5rem] justify-center">
                                    {entryLabel({ action: item.type, metadata: { operation: item.operation } })}
                                </Chip>
                                <span className="min-w-0 flex-1 text-[var(--text-1)] [overflow-wrap:anywhere]">
                                    {item.actor ? (
                                        <>
                                            <span className="text-[var(--text-2)]">{item.actor}</span>
                                            <span aria-hidden="true" className="px-1.5 text-[var(--text-3)]">·</span>
                                            {item.id ? (
                                                <Link to={`/admin/logs?open=${item.id}`} className="hover:text-[var(--signature)]">
                                                    {item.entity_repr || `${entityTypeLabel(item.entity_type)}${item.entity_id ? ` #${item.entity_id}` : ''}`}
                                                </Link>
                                            ) : (item.entity_repr || entityTypeLabel(item.entity_type))}
                                        </>
                                    ) : item.text}
                                </span>
                                <span className="shrink-0 text-xs text-[var(--text-3)]" title={item.time}>{formatRelative(item.time)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>
        </div>
    );
}

function UsersTab({ data, days }) {
    const breakdown = data.user_breakdown || {};
    const trend = fillDays(data.registration_trend, Number(days));
    const active = data.active_users || [];
    return (
        <div className="space-y-4 sm:space-y-5">
            <StatGrid columns={4}>
                <StatCard label="Members" value={data.total_users} to="/admin/users" />
                <StatCard label="Joined" value={data.new_users} hint="in this period" />
                <StatCard label="Active" value={data.active_users_count} hint="used the site in this period" />
                <StatCard label="Returning" value={data.returning_users} hint="active and joined earlier" />
            </StatGrid>
            <Grid>
                <Panel title="Registrations" description={`${plural(data.new_users || 0, 'new member')} in this period`}>
                    <TrendChart data={trend} series={[{ key: 'count', name: 'Registrations' }]} label="Registrations per day" />
                </Panel>
                <Panel title="Accounts">
                    <BarList
                        items={[
                            { key: 'active', label: 'Active', value: breakdown.active, to: '/admin/users?is_active=true' },
                            { key: 'inactive', label: 'Suspended', value: breakdown.inactive, to: '/admin/users?is_active=false' },
                            { key: 'verified', label: 'Email verified', value: breakdown.verified, to: '/admin/users?email_verified=true' },
                            { key: 'unverified', label: 'Email not verified', value: breakdown.unverified, to: '/admin/users?email_verified=false' },
                            { key: 'staff', label: 'Staff', value: breakdown.staff, to: '/admin/users?role=staff' },
                        ]}
                        valueFormat={formatNumber}
                    />
                </Panel>
            </Grid>
            <Panel title="Most active members" description="List updates, reviews and favorites in this period">
                {active.length === 0 ? (
                    <p className="text-sm text-[var(--text-3)]">No member activity in this period.</p>
                ) : (
                    <ol className="space-y-3">
                        {active.map((user, index) => (
                            <li key={user.id} className="flex items-center gap-3">
                                <span className="w-5 shrink-0 text-right text-sm tabular text-[var(--text-3)]">{index + 1}</span>
                                <div className="min-w-0 flex-1">
                                    <UserCell
                                        user={user}
                                        secondary={`${plural(user.list_entries, 'list update')} · ${plural(user.reviews, 'review')} · ${plural(user.favorites, 'favorite')}`}
                                    />
                                </div>
                                <span className="shrink-0 text-sm font-semibold tabular text-[var(--text-1)]">
                                    {formatNumber((user.list_entries || 0) + (user.reviews || 0) + (user.favorites || 0))}
                                </span>
                            </li>
                        ))}
                    </ol>
                )}
            </Panel>
        </div>
    );
}

const MISSING_FIELDS = [
    { key: 'cover_image', label: 'No cover', filter: 'cover' },
    { key: 'synopsis', label: 'No synopsis', filter: 'synopsis' },
    { key: 'studio', label: 'No studio', filter: 'studio' },
    { key: 'rating', label: 'No score' },
];

const toItems = (map = {}, labels = {}) => Object.entries(map)
    .map(([key, value]) => ({ key, label: labels[key] || humanize(key), value }))
    .sort((a, b) => b.value - a.value);

function ContentTab({ data, days }) {
    const missing = data.missing_metadata || {};
    const trend = fillDays(data.content_trend, Number(days));
    return (
        <div className="space-y-4 sm:space-y-5">
            <StatGrid columns={4}>
                <StatCard label="Anime" value={data.total_anime} to="/admin/anime" />
                <StatCard label="Added" value={data.new_anime} hint="in this period" />
                <StatCard label="Metadata complete" value={`${formatNumber(missing.completeness ?? 100)}%`} hint="cover, synopsis, studio, score" />
                <StatCard
                    label="Missing a cover"
                    value={missing.cover_image}
                    tone={missing.cover_image ? 'warning' : undefined}
                    to={missing.cover_image ? '/admin/anime?missing=cover' : undefined}
                />
            </StatGrid>
            <Grid>
                <Panel title="By status">
                    <Donut items={toItems(data.by_status).map(({ label, value }) => ({ label, value }))} label="Anime by airing status" />
                </Panel>
                <Panel title="By format">
                    <BarList items={toItems(data.by_type, { TV: 'TV', OVA: 'OVA', ONA: 'ONA' })} valueFormat={formatNumber} />
                </Panel>
            </Grid>
            <Grid>
                <Panel title="Biggest genres" actions={<Link to="/admin/genres" className="text-link !min-h-9 text-sm">Genres</Link>}>
                    <BarList items={(data.top_genres || []).map((genre) => ({ key: genre.id, label: genre.name, value: genre.anime_count }))} valueFormat={formatNumber} />
                </Panel>
                <Panel title="Busiest studios" actions={<Link to="/admin/studios" className="text-link !min-h-9 text-sm">Studios</Link>}>
                    <BarList items={(data.top_studios || []).map((studio) => ({ key: studio.id, label: studio.name, value: studio.anime_count }))} valueFormat={formatNumber} />
                </Panel>
            </Grid>
            <Panel title="Added to the catalog" description={`${plural(data.new_anime || 0, 'anime', 'anime')} in this period`}>
                <TrendChart data={trend} series={[{ key: 'count', name: 'Anime added', color: '#86cc90' }]} label="Anime added per day" />
            </Panel>
            <Panel title="Missing metadata" description="Anime with a gap the next AniList refresh may fill">
                <ul className="space-y-4">
                    {MISSING_FIELDS.map((field) => (
                        <li key={field.key} className="flex items-end gap-4">
                            <div className="min-w-0 flex-1">
                                <Meter
                                    label={field.label}
                                    value={missing[field.key] || 0}
                                    max={missing.total || 0}
                                    tone={missing[field.key] ? 'warning' : 'success'}
                                />
                            </div>
                            {field.filter && missing[field.key] > 0 && (
                                <Link to={`/admin/anime?missing=${field.filter}`} className="text-link !min-h-9 shrink-0 text-sm">Show</Link>
                            )}
                        </li>
                    ))}
                </ul>
            </Panel>
        </div>
    );
}

function mergeTrends(reviews = [], favorites = [], days) {
    const reviewDays = fillDays(reviews, days);
    const favoriteDays = new Map(fillDays(favorites, days).map((row) => [row.date, row.count]));
    return reviewDays.map((row) => ({ date: row.date, reviews: row.count, favorites: favoriteDays.get(row.date) || 0 }));
}

function EngagementTab({ data, days }) {
    const votes = data.review_votes || {};
    const totalVotes = (votes.helpful || 0) + (votes.unhelpful || 0);
    const ratings = Array.from({ length: 10 }, (_, index) => {
        const score = index + 1;
        return { label: String(score), value: Number(data.reviews_by_rating?.[score] ?? data.reviews_by_rating?.[String(score)] ?? 0) };
    });
    const listStatus = Object.entries(data.list_by_status || {}).map(([status, value]) => ({
        label: STATUS_LABELS[status] || status,
        value,
        color: STATUS_COLORS[status],
    }));
    return (
        <div className="space-y-4 sm:space-y-5">
            <StatGrid columns={4}>
                <StatCard label="Reviews" value={data.total_reviews} to="/admin/reviews" />
                <StatCard label="Written" value={data.new_reviews} hint="in this period" />
                <StatCard label="Average score" value={data.avg_rating ? `${data.avg_rating}/10` : '—'} />
                <StatCard
                    label="Helpful votes"
                    value={totalVotes ? `${Math.round(((votes.helpful || 0) / totalVotes) * 100)}%` : '—'}
                    hint={`${formatNumber(votes.helpful || 0)} helpful · ${formatNumber(votes.unhelpful || 0)} not`}
                />
            </StatGrid>
            <Panel title="Reviews and favorites" description="Per day in this period">
                <TrendChart
                    data={mergeTrends(data.reviews_trend, data.favorites_trend, Number(days))}
                    series={[
                        { key: 'reviews', name: 'Reviews', color: '#b8a5ff' },
                        { key: 'favorites', name: 'Favorites', color: '#8db1ff' },
                    ]}
                    label="Reviews and favorites per day"
                />
            </Panel>
            <Grid>
                <Panel title="Review scores" description="How members score in reviews">
                    <BarsChart data={ratings} label="Number of reviews for each score from 1 to 10" />
                </Panel>
                <Panel title="Lists by status">
                    {listStatus.length ? <Donut items={listStatus} label="List entries by status" /> : <p className="text-sm text-[var(--text-3)]">No list entries yet.</p>}
                </Panel>
            </Grid>
            <Grid>
                <Panel title="Most reviewed">
                    <BarList
                        items={(data.most_reviewed || []).map((anime) => ({ key: anime.id, label: anime.title, value: anime.review_count, to: `/admin/anime/${anime.id}` }))}
                        valueFormat={formatNumber}
                        empty="No reviews yet."
                    />
                </Panel>
                <Panel title="Most favorited">
                    <BarList
                        items={(data.most_favorited || []).map((anime) => ({ key: anime.id, label: anime.title, value: anime.favorite_count, to: `/admin/anime/${anime.id}` }))}
                        valueFormat={formatNumber}
                        empty="No favorites yet."
                        color="var(--violet-soft)"
                    />
                </Panel>
            </Grid>
        </div>
    );
}

const TAB_VIEWS = { overview: OverviewTab, users: UsersTab, content: ContentTab, engagement: EngagementTab };

export default function Analytics() {
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const [exporting, setExporting] = useState(false);
    const tab = TAB_VIEWS[searchParams.get('tab')] ? searchParams.get('tab') : 'overview';
    const days = PERIODS.some((period) => period.value === searchParams.get('days')) ? searchParams.get('days') : '30';

    const report = useAdminQuery(
        reportKey(tab, days),
        ({ signal }) => adminApi.get('reports', { type: tab, days }, { signal }),
        { staleTime: 60_000, placeholderData: (previous, previousQuery) => (previousQuery?.queryKey?.[3]?.type === tab ? previous : undefined) },
    );

    const setParam = (key, value, fallback) => {
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            if (value === fallback) next.delete(key);
            else next.set(key, value);
            return next;
        }, { replace: true });
    };

    const refresh = () => queryClient.fetchQuery({
        queryKey: reportKey(tab, days),
        queryFn: () => adminApi.get('reports', { type: tab, days, refresh: 1 }),
        staleTime: 0,
    }).catch((error) => notifyError(errorMessage(error, 'Could not refresh the report.')));

    const exportStats = async () => {
        setExporting(true);
        try {
            const stats = await adminApi.get('stats/export');
            downloadJson(stats, `anishows-stats-${new Date().toISOString().slice(0, 10)}.json`);
            notify('Stats downloaded.');
        } catch (error) {
            notifyError(errorMessage(error, 'Could not export the stats.'));
        } finally {
            setExporting(false);
        }
    };

    const View = TAB_VIEWS[tab];
    const data = report.data;

    return (
        <>
            <PageHeader
                title="Analytics"
                description="How members, the catalog and engagement are changing."
                actions={(
                    <>
                        <Button variant="ghost" icon={Download} onClick={exportStats} loading={exporting}>Download stats</Button>
                        <Button variant="ghost" icon={RefreshCw} onClick={refresh} loading={report.isFetching && !report.isLoading}>Refresh</Button>
                    </>
                )}
            />
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <Tabs items={TABS} value={tab} onChange={(value) => setParam('tab', value, 'overview')} label="Report" panelId={PANEL_ID} />
                <Select
                    label="Period"
                    value={days}
                    onChange={(value) => setParam('days', value, '30')}
                    options={PERIODS}
                    className="!w-auto min-w-[10.5rem]"
                />
            </div>
            <div id={PANEL_ID} role="tabpanel" aria-busy={report.isFetching || undefined}>
                {report.error && !data ? (
                    <Panel><ErrorState error={report.error} onRetry={() => report.refetch()} /></Panel>
                ) : !data ? (
                    <div className="space-y-4 sm:space-y-5" aria-hidden="true">
                        <PanelSkeleton lines={2} />
                        <PanelSkeleton lines={7} />
                    </div>
                ) : (
                    <div className={report.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
                        <View data={data} days={days} />
                    </div>
                )}
            </div>
        </>
    );
}
