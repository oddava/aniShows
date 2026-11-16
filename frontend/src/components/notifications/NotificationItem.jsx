import { useState } from 'react';
import { X } from 'lucide-react';

import { applyImageFallback, getImageUrl } from '../../utils/imageUtils';
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

/**
 * One row of the notifications page: the anime cover or the actor's avatar
 * (initials when there is none), the message with the actor and entity as
 * links, the relative time and a delete button. Images come from the API
 * payload only.
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
    const [brokenAvatar, setBrokenAvatar] = useState(false);
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
    const thumbnailAlt = highlightEntity
        ? `${highlightEntity} notification image`
        : 'Notification image';
    const thumbnailFallback = getImageUrl(
        null,
        notification?.data?.anime_title || visual.name || 'Notification'
    );
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

    return (
        <div className="w-full">
            <div className="flex overflow-hidden rounded-md bg-dark-100/80">
                {visual.kind === 'avatar' && (
                    <div className="flex-shrink-0 w-14 self-stretch sm:self-auto sm:w-16 sm:h-16">
                        {brokenAvatar || !visual.url ? (
                            <div
                                className="w-full h-full bg-accent/15 flex items-center justify-center font-semibold text-accent-light"
                                aria-label={`${avatarName} avatar fallback`}
                                title={avatarName}
                            >
                                {getFollowerInitials(avatarName)}
                            </div>
                        ) : (
                            <img
                                src={visual.url}
                                alt={`${avatarName} profile picture`}
                                onError={() => setBrokenAvatar(true)}
                                className="w-full h-full object-cover"
                                loading={index < 8 ? 'eager' : 'lazy'}
                                decoding="async"
                            />
                        )}
                    </div>
                )}
                {visual.kind === 'cover' && (
                    <div className="flex-shrink-0 w-14 h-20 sm:w-16 sm:h-24 bg-dark-50 flex items-center justify-center">
                        <img
                            src={visual.url}
                            alt={thumbnailAlt}
                            onError={(event) => applyImageFallback(event, thumbnailFallback)}
                            className="w-14 h-20 sm:w-16 sm:h-24 object-cover"
                            loading={index < 8 ? 'eager' : 'lazy'}
                            decoding="async"
                        />
                    </div>
                )}

                <div className="min-w-0 flex-1 px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 sm:gap-2.5">
                    <p className="min-w-0 text-sm sm:text-base leading-snug text-gray-300 line-clamp-2 pr-1 sm:pr-2">
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
                                                    className="text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm cursor-pointer"
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
                                            className="text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm cursor-pointer"
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
                                            className="text-accent hover:text-accent/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 rounded-sm cursor-pointer"
                                        >
                                            {segment.text}
                                        </button>
                                    );
                                } else {
                                    parts.push(
                                        <span
                                            key={`entity-${notification.id}-${index}`}
                                            className="text-accent font-semibold"
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
                    <span
                        className="text-[11px] sm:text-[13px] text-gray-500 whitespace-nowrap self-end sm:self-auto sm:mt-0.5"
                        title={exactTimestamp}
                    >
                        {formatRelativeTime(notification.created_at)}
                    </span>
                </div>
                {onDelete && (
                    <button
                        type="button"
                        onClick={() => onDelete(notification)}
                        disabled={isDeleting}
                        aria-label={`Delete notification: ${displayText.slice(0, 80)}`}
                        title="Delete"
                        className="flex-shrink-0 self-start m-1.5 p-1.5 rounded-md text-gray-500 hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                        <X aria-hidden="true" className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
