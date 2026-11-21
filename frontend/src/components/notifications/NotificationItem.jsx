import { useState } from 'react';
import { X } from 'lucide-react';

import CoverThumb from '../ui/CoverThumb';
import logger from '../../utils/logger';
import { formatDateTimeInUserTimezone } from '../../utils/dateUtils';
import {
    getActorUsernameData,
    getHighlightEntityData,
    getNotificationTarget
} from '../../utils/notificationUtils';
import {
    formatRelativeTime,
    getFollowerInitials,
    getNotificationVisual,
} from './notificationDisplay';

const LINK_CLASS = 'cursor-pointer font-medium text-[var(--signature)] transition-colors duration-150 hover:text-[var(--signature-hover)]';

/**
 * One row of the notifications page: the anime cover or the actor's avatar
 * (initials when there is none), the message with the actor and entity as
 * links, the relative time (right-aligned on wide screens) and a delete
 * button. Unread rows sit on a soft fill. Images come from the API payload
 * only; a cover that fails to load leaves a quiet slot.
 */
export default function NotificationItem({
    notification,
    index,
    handleNotificationOpen,
    markNotificationRead,
    setActionError,
    navigate,
    onDelete,
    isDeleting = false,
}) {
    const visual = getNotificationVisual(notification);
    const [avatarState, setAvatarState] = useState('loading');
    const { displayText, entity: highlightEntity, startIndex: highlightStart } = getHighlightEntityData(notification);
    const { username: actorUsername, startIndex: actorStart } = getActorUsernameData(notification);
    const hasHighlightedChunk = highlightStart >= 0;
    const target = getNotificationTarget(notification);
    const exactTimestamp = formatDateTimeInUserTimezone(notification.created_at, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });
    const avatarName = visual.name || 'User';

    const handleEntityClick = async () => {
        await handleNotificationOpen(notification);
    };

    const handleActorClick = async () => {
        if (!actorUsername) return;
        setActionError('');
        try {
            await markNotificationRead(notification);
        } catch (error) {
            logger.error('Failed to mark notification as read:', error);
            setActionError('Could not update read status for this notification.');
        }
        navigate(`/u/${actorUsername}`);
    };

    const unread = !notification.is_read;
    const relativeTime = formatRelativeTime(notification.created_at);
    const imageLoading = index < 8 ? 'eager' : 'lazy';

    return (
        <div
            className={`flex items-start gap-4 rounded-[var(--radius-md)] px-3 py-3 transition-colors duration-150 ${unread ? 'bg-white/[0.04] hover:bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
        >
            {visual.kind === 'avatar' && (
                <span className="relative block h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--ink-3)]">
                    {avatarState === 'broken' || !visual.url ? (
                        <span
                            className="flex h-full w-full items-center justify-center text-sm font-semibold text-[var(--text-2)]"
                            aria-label={`${avatarName} avatar fallback`}
                            title={avatarName}
                        >
                            {getFollowerInitials(avatarName)}
                        </span>
                    ) : (
                        <img
                            src={visual.url}
                            alt={`${avatarName} profile picture`}
                            onLoad={() => setAvatarState('loaded')}
                            onError={() => setAvatarState('broken')}
                            data-loaded={avatarState === 'loaded'}
                            className="img-fade h-full w-full object-cover"
                            loading={imageLoading}
                            decoding="async"
                        />
                    )}
                </span>
            )}
            {visual.kind === 'cover' && (
                <CoverThumb
                    sources={[visual.url]}
                    loading={imageLoading}
                    className="h-[72px] w-12 shrink-0 rounded-[var(--radius-sm)]"
                />
            )}

            <div className="min-w-0 flex-1 self-center">
                <p className={`line-clamp-3 text-[15px] leading-snug ${unread ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}>
                    {(() => {
                        const segments = [];
                        const actorEnd = actorStart + (actorUsername?.length || 0);
                        const highlightEnd = hasHighlightedChunk
                            ? highlightStart + highlightEntity.length
                            : -1;
                        const hasOverlap = actorStart >= 0 && hasHighlightedChunk && !(
                            highlightEnd <= actorStart || actorEnd <= highlightStart
                        );

                        if (actorStart >= 0 && actorUsername) {
                            segments.push({
                                kind: 'actor',
                                start: actorStart,
                                end: actorEnd,
                                text: actorUsername,
                            });
                        }

                        if (hasHighlightedChunk && !hasOverlap) {
                            segments.push({
                                kind: 'entity',
                                start: highlightStart,
                                end: highlightEnd,
                                text: highlightEntity,
                            });
                        }

                        if (segments.length === 0) {
                            return (
                                <span>
                                    {displayText}
                                    {target && (
                                        <>
                                            {' '}
                                            <button
                                                type="button"
                                                onClick={handleEntityClick}
                                                className={LINK_CLASS}
                                            >
                                                Open
                                            </button>
                                        </>
                                    )}
                                </span>
                            );
                        }

                        const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
                        let cursor = 0;
                        const parts = [];

                        sortedSegments.forEach((segment, index) => {
                            if (segment.start > cursor) {
                                parts.push(
                                    <span key={`text-${notification.id}-${index}`}>
                                        {displayText.slice(cursor, segment.start)}
                                    </span>
                                );
                            }

                            if (segment.kind === 'actor') {
                                parts.push(
                                    <button
                                        key={`actor-${notification.id}-${index}`}
                                        type="button"
                                        onClick={handleActorClick}
                                        className={LINK_CLASS}
                                    >
                                        {segment.text}
                                    </button>
                                );
                            } else if (target) {
                                parts.push(
                                    <button
                                        key={`entity-${notification.id}-${index}`}
                                        type="button"
                                        onClick={handleEntityClick}
                                        className={LINK_CLASS}
                                    >
                                        {segment.text}
                                    </button>
                                );
                            } else {
                                parts.push(
                                    <span
                                        key={`entity-${notification.id}-${index}`}
                                        className="font-medium text-[var(--text-1)]"
                                    >
                                        {segment.text}
                                    </span>
                                );
                            }

                            cursor = segment.end;
                        });

                        if (cursor < displayText.length) {
                            parts.push(
                                <span key={`tail-${notification.id}`}>
                                    {displayText.slice(cursor)}
                                </span>
                            );
                        }

                        return <>{parts}</>;
                    })()}
                </p>
                <p className="mt-1 text-sm text-[var(--text-3)] sm:hidden" title={exactTimestamp}>
                    {relativeTime}
                </p>
            </div>
            <span className="hidden whitespace-nowrap pt-0.5 text-sm text-[var(--text-3)] sm:block" title={exactTimestamp}>
                {relativeTime}
            </span>
            {onDelete && (
                <button
                    type="button"
                    onClick={() => onDelete(notification)}
                    disabled={isDeleting}
                    aria-label={`Delete notification: ${displayText.slice(0, 80)}`}
                    title="Delete"
                    className="-my-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-3)] transition-colors duration-150 hover:bg-white/[0.06] hover:text-[var(--text-1)] disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:w-9"
                >
                    <X aria-hidden="true" className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}
