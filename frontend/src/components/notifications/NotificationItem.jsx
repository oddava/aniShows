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
    getFollowerDisplayName,
    getFollowerInitials,
    getNotificationThumbnail,
    isFollowerNotification,
} from './notificationDisplay';

/**
 * One row of the notifications page: thumbnail (or follower initials), the
 * message with the actor and entity as links, and the relative time.
 */
export default function NotificationItem({
    notification,
    index,
    coverBySlug,
    followerAvatarByUsername,
    brokenThumbIds,
    setBrokenThumbIds,
    handleNotificationOpen,
    markNotificationRead,
    setActionError,
    navigate,
}) {
    const thumbnail = getNotificationThumbnail(notification, coverBySlug, followerAvatarByUsername);
    const { displayText, entity: highlightEntity, startIndex: highlightStart } = getHighlightEntityData(notification);
    const { username: actorUsername, startIndex: actorStart } = getActorUsernameData(notification);
    const hasHighlightedChunk = highlightStart >= 0;
    const target = getNotificationTarget(notification);
    const followerNotification = isFollowerNotification(notification);
    const followerName = getFollowerDisplayName(notification);
    const brokenFollowerThumb = followerNotification && brokenThumbIds.has(notification.id);
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
        notification?.data?.anime_title || notification?.data?.follower_username || 'Notification'
    );

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
                {(thumbnail || followerNotification) && (
                    <div
                        className={`flex-shrink-0 ${followerNotification
                            ? 'w-14 self-stretch sm:self-auto sm:w-16 sm:h-16'
                            : 'w-14 h-20 sm:w-16 sm:h-24 bg-dark-50 flex items-center justify-center'
                            }`}
                    >
                        {followerNotification ? (
                            brokenFollowerThumb || !thumbnail ? (
                                <div
                                    className="w-full h-full bg-accent/15 flex items-center justify-center font-semibold text-accent-light"
                                    aria-label={`${followerName} avatar fallback`}
                                    title={followerName}
                                >
                                    {getFollowerInitials(followerName)}
                                </div>
                            ) : (
                                <img
                                    src={thumbnail}
                                    alt={`${followerName} profile picture`}
                                    onError={() => {
                                        setBrokenThumbIds((prev) => {
                                            const next = new Set(prev);
                                            next.add(notification.id);
                                            return next;
                                        });
                                    }}
                                    className="w-full h-full object-cover"
                                    loading={index < 8 ? 'eager' : 'lazy'}
                                    decoding="async"
                                />
                            )
                        ) : (
                            <img
                                src={thumbnail}
                                alt={thumbnailAlt}
                                onError={(event) => applyImageFallback(event, thumbnailFallback)}
                                className="w-14 h-20 sm:w-16 sm:h-24 object-cover"
                                loading={index < 8 ? 'eager' : 'lazy'}
                                decoding="async"
                            />
                        )}
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
            </div>
        </div>
    );
}
