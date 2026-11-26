import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, RefreshCw } from 'lucide-react';

import { adminApi, adminKeys, errorMessage } from '../api';
import { notifyError } from '../../components/ui/toast';
import { useAdminQuery, useRole } from '../hooks';
import { formatNumber, formatRelative, plural } from '../format';
import {
    AnimeCell, BarList, Button, Chip, ErrorState, PageHeader, Panel, PanelSkeleton, Skeleton, StatCard, StatGrid, TrendChart, UserCell,
} from '../ui';

const DASHBOARD_KEY = adminKeys.view('dashboard');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One row per day for the last `days` days; days with no rows count 0. Days
 * are UTC, like the server's TruncDate, so "today" never shows a false zero.
 */
export function fillDays(rows = [], days = 30, key = 'count', now = Date.now()) {
    const byDate = new Map(rows.map((row) => [String(row.date).slice(0, 10), Number(row[key]) || 0]));
    return Array.from({ length: days }, (_, index) => {
        const date = new Date(now - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10);
        return { date, [key]: byDate.get(date) || 0 };
    });
}

const sum = (rows, key = 'count') => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

/** The "needs you" list: each open item links to where it is handled. */
function attentionItems(attention = {}, { isSuperuser }) {
    return [
        {
            key: 'reports',
            count: attention.open_reviews ?? attention.open_reports,
            label: (n) => `${n === 1 ? 'review is' : 'reviews are'} reported`,
            detail: attention.open_reports ? plural(attention.open_reports, 'open report') : null,
            to: '/admin/moderation',
            tone: 'warning',
        },
        {
            key: 'failed-tasks',
            count: attention.failed_tasks_24h,
            label: (n) => `background ${n === 1 ? 'task' : 'tasks'} failed today`,
            to: isSuperuser ? '/admin/tasks?status=FAILURE' : '/admin/system',
            tone: 'danger',
        },
        {
            key: 'catalog',
            count: attention.failed_catalog_runs_24h,
            label: (n) => `catalog ${n === 1 ? 'sync' : 'syncs'} failed today`,
            to: '/admin/catalog-sync?status=failed',
            tone: 'warning',
        },
        {
            key: 'imports',
            count: attention.failed_user_imports_24h,
            label: (n) => `list ${n === 1 ? 'import' : 'imports'} failed today`,
            to: '/admin/list-imports?status=failed',
            tone: 'danger',
        },
        {
            key: 'suspended',
            count: attention.suspended_users,
            label: (n) => `${n === 1 ? 'account is' : 'accounts are'} suspended`,
            to: '/admin/users?is_active=false',
            tone: 'neutral',
            quiet: true,
        },
    ].filter((item) => Number(item.count) > 0);
}

function NeedsAttention({ attention, loading }) {
    const { isSuperuser } = useRole();
    const items = attentionItems(attention, { isSuperuser });
    const urgent = items.filter((item) => !item.quiet);

    return (
        <Panel
            title="Needs attention"
            description={loading ? 'Checking…' : urgent.length ? 'Open items across the site, newest problems first.' : 'Nothing is waiting on you.'}
        >
            {loading ? (
                <div className="h-12" aria-hidden="true" />
            ) : items.length === 0 ? (
                <p className="text-sm text-[var(--text-2)]">No reports, failed jobs or stuck syncs. All clear.</p>
            ) : (
                <ul className="-mx-2 space-y-0.5">
                    {items.map((item) => (
                        <li key={item.key}>
                            <Link
                                to={item.to}
                                className="group flex min-h-12 items-center gap-3 rounded-[var(--radius-md)] px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
                            >
                                <Chip tone={item.tone} className="min-w-10 justify-center tabular">{formatNumber(item.count)}</Chip>
                                <span className="min-w-0 flex-1 text-sm text-[var(--text-1)]">
                                    {item.label(Number(item.count))}
                                    {item.detail && <span className="ml-2 text-[var(--text-3)]">{item.detail}</span>}
                                </span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-3)] transition-colors group-hover:text-[var(--text-1)]" aria-hidden="true" />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    );
}

function RecentList({ title, to, linkLabel, children, empty, isEmpty }) {
    return (
        <Panel
            title={title}
            actions={to && <Link to={to} className="text-link !min-h-9 text-sm">{linkLabel}</Link>}
            className="flex flex-col"
        >
            {isEmpty ? <p className="text-sm text-[var(--text-3)]">{empty}</p> : <ul className="space-y-3">{children}</ul>}
        </Panel>
    );
}

export default function Dashboard() {
    const queryClient = useQueryClient();
    const dashboard = useAdminQuery(DASHBOARD_KEY, ({ signal }) => adminApi.get('dashboard', undefined, { signal }), { staleTime: 30_000 });

    const refresh = async () => {
        try {
            await queryClient.fetchQuery({
                queryKey: DASHBOARD_KEY,
                queryFn: () => adminApi.get('dashboard', { refresh: 1 }),
                staleTime: 0,
            });
        } catch (error) {
            notifyError(errorMessage(error, 'Could not refresh the dashboard.'));
        }
    };

    const data = dashboard.data;
    const stats = data?.statistics;
    const loading = dashboard.isLoading;
    const signups = fillDays(data?.charts?.user_growth, 30);
    const reviews = fillDays(data?.charts?.reviews_30d, 30);
    const hasReviewTrend = Array.isArray(data?.charts?.reviews_30d);

    if (dashboard.error && !data) {
        return (
            <>
                <PageHeader title="Dashboard" />
                <Panel><ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} /></Panel>
            </>
        );
    }

    return (
        <>
            <PageHeader
                title="Dashboard"
                description="What needs you today, and how the site is doing."
                actions={(
                    <Button
                        variant="ghost"
                        icon={RefreshCw}
                        onClick={refresh}
                        loading={dashboard.isFetching && !loading}
                    >
                        Refresh
                    </Button>
                )}
            />

            <div className="space-y-4 sm:space-y-5">
                <NeedsAttention attention={data?.attention} loading={loading} />

                <StatGrid columns={4}>
                    <StatCard
                        label="Members"
                        value={stats?.users?.total}
                        hint={stats ? `${formatNumber(stats.users.new_7d)} joined this week` : null}
                        to="/admin/users"
                        loading={loading}
                    />
                    <StatCard
                        label="Active this week"
                        value={stats?.users?.active_7d ?? stats?.users?.verified}
                        hint={stats?.users?.active_7d !== undefined ? 'Signed in or tracked something' : 'Verified emails'}
                        loading={loading}
                    />
                    <StatCard
                        label="Reviews"
                        value={stats?.content?.total_reviews}
                        hint={stats ? `${formatNumber(stats.content.new_reviews_7d)} this week` : null}
                        to="/admin/reviews"
                        loading={loading}
                    />
                    <StatCard
                        label="Anime"
                        value={stats?.content?.total_anime}
                        hint={stats ? `${formatNumber(stats.content.airing_anime)} airing now` : null}
                        to="/admin/anime"
                        loading={loading}
                    />
                </StatGrid>

                <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
                    <Panel
                        title="Sign-ups"
                        description={loading ? ' ' : `${plural(sum(signups), 'new member')} in the last 30 days`}
                    >
                        {loading ? <Skeleton className="h-[220px] w-full" rounded="rounded-[var(--radius-md)]" /> : (
                            <TrendChart data={signups} series={[{ key: 'count', name: 'Sign-ups' }]} label="Sign-ups per day, last 30 days" />
                        )}
                    </Panel>
                    <Panel
                        title="Reviews written"
                        description={loading ? ' ' : hasReviewTrend ? `${plural(sum(reviews), 'review')} in the last 30 days` : 'Engagement over time'}
                    >
                        {loading ? <Skeleton className="h-[220px] w-full" rounded="rounded-[var(--radius-md)]" /> : hasReviewTrend ? (
                            <TrendChart data={reviews} series={[{ key: 'count', name: 'Reviews', color: '#b8a5ff' }]} label="Reviews per day, last 30 days" />
                        ) : (
                            <div className="grid h-[220px] grid-cols-2 content-center gap-3">
                                <StatCard compact label="List entries" value={stats?.engagement?.total_list_entries} />
                                <StatCard compact label="Favorites" value={stats?.engagement?.total_favorites} />
                            </div>
                        )}
                    </Panel>
                </div>

                {loading ? (
                    <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
                        <PanelSkeleton lines={5} />
                        <PanelSkeleton lines={5} />
                        <PanelSkeleton lines={5} />
                    </div>
                ) : (
                    <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
                        <RecentList
                            title="New members"
                            to="/admin/users"
                            linkLabel="All users"
                            isEmpty={!data?.recent_users?.length}
                            empty="No one has joined yet."
                        >
                            {data?.recent_users?.map((user) => (
                                <li key={user.id} className="flex items-center justify-between gap-3">
                                    <UserCell user={user} secondary={formatRelative(user.date_joined)} />
                                    {!user.is_active && <Chip tone="danger">Suspended</Chip>}
                                </li>
                            ))}
                        </RecentList>

                        <RecentList
                            title="Latest reviews"
                            to="/admin/reviews"
                            linkLabel="All reviews"
                            isEmpty={!data?.recent_reviews?.length}
                            empty="No reviews yet."
                        >
                            {data?.recent_reviews?.map((review) => (
                                <li key={review.id} className="flex items-start justify-between gap-3">
                                    <span className="min-w-0 text-sm">
                                        <Link to={`/admin/reviews?open=${review.id}`} className="line-clamp-1 font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                                            {review.anime}
                                        </Link>
                                        <span className="block truncate text-xs text-[var(--text-3)]">
                                            {review.user} · {formatRelative(review.created_at)}
                                            {review.has_spoilers && ' · spoilers'}
                                        </span>
                                    </span>
                                    <span className="shrink-0 text-sm font-semibold tabular text-[var(--text-1)]">
                                        {review.rating}
                                        <span className="font-normal text-[var(--text-3)]">/10</span>
                                    </span>
                                </li>
                            ))}
                        </RecentList>

                        <Panel title="Most favorited" actions={<Link to="/admin/analytics?tab=engagement" className="text-link !min-h-9 text-sm">Analytics</Link>}>
                            {data?.popular_anime?.length ? (
                                <ul className="space-y-3">
                                    {data.popular_anime.map((anime) => (
                                        <li key={anime.id} className="flex items-center justify-between gap-3">
                                            <AnimeCell anime={anime} />
                                            <span className="shrink-0 text-sm tabular text-[var(--text-2)]">{formatNumber(anime.favorite_count)}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <BarList items={[]} empty="No favorites yet." />
                            )}
                        </Panel>
                    </div>
                )}
            </div>
        </>
    );
}
