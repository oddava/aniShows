import { Link, useNavigate, useParams } from 'react-router-dom';
import { Ban, ExternalLink, RotateCcw } from 'lucide-react';

import { adminApi, adminKeys } from '../api';
import { useAdminQuery, useRole } from '../hooks';
import { formatDate, formatDateTime, formatNumber, formatRelative, humanize } from '../format';
import {
    Avatar, Button, Chip, Donut, EmptyState, ErrorState, KeyValue, Menu, MetaLine, PageHeader, Panel, PanelSkeleton,
    StatCard, StatGrid, UserStateChips,
} from '../ui';
import { tidyDividers, useUserActions } from './people/userActions';
import { BadgeMark } from './people/badgeLook';
import { describeHistoryEntry } from './people/history';

const STATUS_ORDER = ['Watching', 'Completed', 'On Hold', 'Dropped', 'Plan to Watch'];
const STATUS_LABELS = { 'Plan to Watch': 'Planning', 'On Hold': 'On hold' };

const yesNo = (value) => (value ? 'Yes' : 'No');

function Section({ title, actions, children, empty, isEmpty }) {
    return (
        <Panel title={title} actions={actions}>
            {isEmpty ? <p className="text-sm text-[var(--text-3)]">{empty}</p> : children}
        </Panel>
    );
}

function History({ user }) {
    const entries = user.moderation_history || [];
    return (
        <Section
            title="Moderation history"
            actions={<Link to={`/admin/logs?tab=audit&entity_type=User&entity_id=${user.id}`} className="text-link !min-h-9 text-sm">Audit log</Link>}
            isEmpty={entries.length === 0}
            empty="No moderation actions on this account."
        >
            <ol className="space-y-4">
                {entries.map((entry) => (
                    <li key={entry.id} className="text-sm">
                        <p className="font-medium text-[var(--text-1)]">{describeHistoryEntry(entry)}</p>
                        <p className="mt-0.5 text-xs text-[var(--text-3)]">
                            {entry.actor ? `by ${entry.actor}` : 'by the system'} · <time dateTime={entry.timestamp} title={formatDateTime(entry.timestamp)}>{formatRelative(entry.timestamp)}</time>
                        </p>
                        {entry.reason && <p className="mt-1.5 rounded-md bg-white/[0.04] px-3 py-2 text-[var(--text-2)]">{entry.reason}</p>}
                    </li>
                ))}
            </ol>
        </Section>
    );
}

export default function UserDetail() {
    const { isSuperuser } = useRole();
    const { userId } = useParams();
    const navigate = useNavigate();
    const query = useAdminQuery(
        adminKeys.detail('users', userId),
        ({ signal }) => adminApi.get(`users/${userId}`, undefined, { signal }),
    );
    const actions = useUserActions({ onDeleted: () => navigate('/admin/users', { replace: true }) });
    const back = { to: '/admin/users', label: 'Users' };
    const user = query.data;

    if (query.isLoading) {
        return (
            <>
                <PageHeader title="Loading…" back={back} />
                <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
                    <PanelSkeleton className="lg:col-span-2" lines={6} />
                    <PanelSkeleton lines={6} />
                </div>
            </>
        );
    }

    if (query.error?.response?.status === 404) {
        return (
            <>
                <PageHeader title="User not found" back={back} />
                <Panel>
                    <EmptyState title="This account does not exist" actions={<Button variant="primary" to="/admin/users">Back to users</Button>}>
                        It may have been deleted, or the link is wrong.
                    </EmptyState>
                </Panel>
            </>
        );
    }

    if (!user) {
        return (
            <>
                <PageHeader title="User" back={back} />
                <Panel><ErrorState error={query.error} onRetry={() => query.refetch()} /></Panel>
            </>
        );
    }

    const profile = user.profile || {};
    const stats = user.stats || {};
    const can = actions.permissions(user);
    const emailVerified = profile.email_verified ?? user.email_verified;
    const breakdown = user.list_breakdown || {};
    const donutItems = [...STATUS_ORDER, ...Object.keys(breakdown).filter((key) => !STATUS_ORDER.includes(key))]
        .filter((status) => Number(breakdown[status]) > 0)
        .map((status) => ({ label: STATUS_LABELS[status] || status, value: Number(breakdown[status]) }));
    const providers = user.auth_providers || [];

    return (
        <>
            <PageHeader
                back={back}
                title={(
                    <span className="flex min-w-0 items-center gap-4">
                        <Avatar src={profile.avatar ?? user.avatar} name={user.username} size="lg" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{user.username}</span>
                    </span>
                )}
                meta={(
                    <>
                        <UserStateChips user={user} />
                        {!emailVerified && <Chip tone="warning">Email not verified</Chip>}
                        {(profile.is_private ?? user.is_private) && <Chip>Private profile</Chip>}
                        <MetaLine
                            className="basis-full"
                            items={[
                                `Joined ${formatDate(user.date_joined)}`,
                                user.last_login ? `last sign-in ${formatRelative(user.last_login)}` : 'never signed in',
                                profile.last_activity && `active ${formatRelative(profile.last_activity)}`,
                            ]}
                        />
                    </>
                )}
                actions={(
                    <>
                        <Button variant="ghost" icon={ExternalLink} href={`/u/${encodeURIComponent(user.username)}`} target="_blank" rel="noopener noreferrer">
                            Public profile
                        </Button>
                        {can.canSuspend && <Button variant="danger" icon={Ban} onClick={() => actions.open('suspend', user)}>Suspend</Button>}
                        {can.canRestore && <Button variant="primary" icon={RotateCcw} onClick={() => actions.open('restore', user)}>Restore</Button>}
                        <Menu label="More account actions" items={tidyDividers(actions.itemsFor(user).filter((item) => item === 'divider' || !['View public profile', 'Suspend', 'Restore'].includes(item.label)))} />
                    </>
                )}
            />

            <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
                <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
                    <Panel title="Account">
                        <KeyValue
                            items={[
                                { label: 'Email', value: user.email },
                                { label: 'Email verified', value: yesNo(emailVerified) },
                                { label: 'Pending email change', value: profile.pending_email, hidden: !profile.pending_email },
                                { label: 'Sign-in methods', value: [user.has_password !== false && 'Password', ...providers.map((provider) => humanize(provider))].filter(Boolean).join(', ') || 'None set up' },
                                { label: 'Private profile', value: yesNo(profile.is_private ?? user.is_private) },
                                { label: 'Time zone', value: profile.preferred_timezone },
                                { label: 'Points', value: profile.points !== undefined ? formatNumber(profile.points) : null },
                                { label: 'User id', value: <span className="admin-mono">{user.id}</span> },
                                { label: 'Bio', value: profile.bio ?? user.bio, wide: true },
                            ]}
                        />
                    </Panel>

                    <StatGrid columns={4}>
                        <StatCard compact label="On their list" value={stats.list_entries ?? user.list_entries_count ?? 0} hint={<Link to={`/admin/list-imports?user=${user.id}`} className="hover:text-[var(--signature)]">Their list imports</Link>} />
                        <StatCard compact label="Reviews" value={stats.reviews ?? user.reviews_count ?? 0} to={`/admin/reviews?user=${user.id}`} />
                        <StatCard compact label="Favorites" value={stats.favorites ?? user.favorites_count ?? 0} />
                        <StatCard compact label="Forum threads" value={stats.forum_threads ?? 0} to={`/admin/forums?tab=threads&author=${user.id}`} />
                        <StatCard compact label="Forum replies" value={stats.forum_posts ?? 0} to={`/admin/forums?tab=posts&author=${user.id}`} />
                        <StatCard compact label="Followers" value={stats.followers ?? 0} />
                        <StatCard compact label="Following" value={stats.following ?? 0} />
                        <StatCard compact label="Badges" value={stats.badges ?? user.badges?.length ?? 0} />
                    </StatGrid>

                    <Section
                        title="Recent reviews"
                        actions={<Link to={`/admin/reviews?user=${user.id}`} className="text-link !min-h-9 text-sm">All their reviews</Link>}
                        isEmpty={!user.recent_reviews?.length}
                        empty="They have not written a review."
                    >
                        <ul className="space-y-4">
                            {user.recent_reviews?.map((review) => (
                                <li key={review.id} className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 text-sm">
                                        <Link to={`/admin/reviews?open=${review.id}`} className="font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                                            {review.anime?.title || 'Review'}
                                        </Link>
                                        <p className="mt-0.5 line-clamp-2 text-[var(--text-2)]">{review.snippet || 'No written review.'}</p>
                                        <p className="mt-1 text-xs text-[var(--text-3)]">
                                            {formatRelative(review.created_at)}{review.has_spoilers && ' · spoilers'}
                                        </p>
                                    </div>
                                    <span className="shrink-0 text-sm font-semibold tabular text-[var(--text-1)]">
                                        {review.rating}<span className="font-normal text-[var(--text-3)]">/10</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Section>

                    <Section
                        title="Recent forum threads"
                        isEmpty={!user.recent_threads?.length}
                        empty="They have not started a thread."
                    >
                        <ul className="space-y-3">
                            {user.recent_threads?.map((thread) => (
                                <li key={thread.id} className="flex items-center justify-between gap-3 text-sm">
                                    <Link to={`/admin/forums?tab=threads&open=${thread.id}`} className="min-w-0 truncate font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                                        {thread.title}
                                    </Link>
                                    <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-3)]">
                                        {thread.is_removed && <Chip tone="danger">Removed</Chip>}
                                        {formatRelative(thread.created_at)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Section>
                </div>

                <div className="min-w-0 space-y-4 sm:space-y-5">
                    <Section title="Their list" isEmpty={donutItems.length === 0} empty="Nothing on their list yet.">
                        <Donut items={donutItems} label={`${user.username}'s list by status`} height={150} />
                    </Section>

                    <Section
                        title="Badges"
                        actions={isSuperuser && <Link to="/admin/badges" className="text-link !min-h-9 text-sm">Grant or revoke</Link>}
                        isEmpty={!user.badges?.length}
                        empty="No badges yet."
                    >
                        <ul className="space-y-3">
                            {user.badges?.map((badge) => (
                                <li key={badge.id} className="flex items-start gap-3 text-sm">
                                    <BadgeMark badge={badge} />
                                    <div className="min-w-0">
                                        <p className="font-medium text-[var(--text-1)]">{badge.name}</p>
                                        <p className="text-xs text-[var(--text-3)]">
                                            {badge.granted_at ? `Granted ${formatDate(badge.granted_at)}` : 'Granted'}
                                            {badge.reason && ` · ${badge.reason}`}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Section>

                    <History user={user} />
                </div>
            </div>

            {actions.dialogs}
        </>
    );
}
