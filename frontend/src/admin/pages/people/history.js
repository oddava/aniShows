import { humanize } from '../../format';

const CHANGE_WORDS = {
    is_staff: (value) => (value ? 'Made staff' : 'Staff access removed'),
    is_active: (value) => (value ? 'Restored' : 'Suspended'),
    email_verified: (value) => (value ? 'Email marked verified' : 'Email marked unverified'),
};

const ACTION_WORDS = {
    SUSPEND: 'Suspended',
    RESTORE: 'Restored',
    DELETE: 'Account deleted',
    BULK_ACTION: 'Changed in a bulk action',
    CREATE: 'Created',
    LOGOUT: 'Signed out everywhere',
    CONTROL: 'Account action',
    EXPORT: 'Exported',
};

const OPERATION_WORDS = {
    revoke_sessions: () => 'Signed out everywhere',
    send_password_reset: () => 'Password reset email queued',
    clear_profile: (fields) => {
        const names = fields.map(([field]) => field).join(', ');
        return names ? `${names.charAt(0).toUpperCase()}${names.slice(1)} cleared` : 'Profile content cleared';
    },
};

function changedFields(changes) {
    if (!changes || typeof changes !== 'object') return [];
    return Object.entries(changes).map(([field, change]) => {
        const next = change && typeof change === 'object' && 'new' in change ? change.new : change;
        return [field, next];
    });
}

/** One moderation-history row in plain words: "Suspended", "Made staff", "Bio, avatar cleared". */
export function describeHistoryEntry(entry) {
    if (!entry) return '';
    const fields = changedFields(entry.changes);
    if (OPERATION_WORDS[entry.operation]) return OPERATION_WORDS[entry.operation](fields);
    const known = fields.find(([field]) => CHANGE_WORDS[field]);
    if (entry.action !== 'BULK_ACTION' && known) return CHANGE_WORDS[known[0]](known[1]);
    if (ACTION_WORDS[entry.action]) return ACTION_WORDS[entry.action];
    if (entry.action === 'UPDATE' && fields.length) {
        const names = fields.map(([field]) => humanize(field).toLowerCase());
        const text = names.join(', ');
        return `${text.charAt(0).toUpperCase()}${text.slice(1)} changed`;
    }
    return humanize(entry.action);
}
