import { humanize } from './format';

/*
 * Plain words for audit-log rows, shared by Logs and Analytics so an action
 * reads the same everywhere.
 */

/** "AdminPanelSettings" / "forum_thread" → "Admin panel settings" / "Forum thread". */
export const entityTypeLabel = (type = '') => humanize(String(type).replace(/([a-z])([A-Z])/g, '$1 $2'), type);

export const actionLabel = (action) => (action === 'BULK_ACTION' ? 'Bulk' : humanize(action));

const OPERATION_LABELS = {
    revoke_sessions: 'Sign out everywhere',
    notify: 'Notify members',
    send_password_reset: 'Password reset',
    clear_profile: 'Clear profile',
    cancel: 'Cancel job',
    mark_skipped: 'Mark skipped',
    set_ids_and_retry: 'Set ids and retry',
};

/** What an entry did: the specific operation when one was recorded ("Password reset"), else its action. */
export const entryLabel = (entry) => {
    const operation = entry?.metadata?.operation;
    if (operation && (entry.action === 'TRIGGER' || entry.action === 'CONTROL' || entry.action === 'UPDATE')) {
        return OPERATION_LABELS[operation] || humanize(operation);
    }
    return actionLabel(entry?.action);
};
