import { useState } from 'react';
import {
    Ban, BadgeCheck, Eraser, ExternalLink, KeyRound, LogOut, RotateCcw, ShieldMinus, ShieldPlus, Trash2, UserRound,
} from 'lucide-react';

import { adminApi, adminKeys } from '../../api';
import { useAdminAction, useRole } from '../../hooks';
import {
    Button, CheckboxRow, ConfirmDialog, Dialog, Field, TextArea,
} from '../../ui';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/**
 * What the signed-in admin may do to `target`, mirroring the API's checks
 * (user_admin_service): nobody acts on themselves or on a superuser through
 * the moderation actions, and only superusers act on staff.
 */
export function userPermissions(target, { userId, isSuperuser }) {
    if (!target) return {};
    const isSelf = target.id === userId;
    const canModerate = !isSelf && !target.is_superuser && (!target.is_staff || isSuperuser);
    return {
        isSelf,
        canModerate,
        canSuspend: canModerate && target.is_active !== false,
        canRestore: canModerate && target.is_active === false,
        canRevokeSessions: canModerate,
        canSendReset: canModerate && target.is_active !== false && Boolean(target.email),
        canClearProfile: canModerate,
        canVerifyEmail: isSuperuser && !isSelf && !target.email_verified && !target.profile?.email_verified,
        canToggleStaff: isSuperuser && !isSelf && !target.is_superuser,
        canDelete: isSuperuser && !isSelf && !target.is_superuser,
    };
}

/** Drop dividers at the ends and doubled ones, left behind by hidden items. */
export function tidyDividers(items) {
    const result = [];
    items.forEach((item) => {
        if (item === 'divider' && (result.length === 0 || result[result.length - 1] === 'divider')) return;
        result.push(item);
    });
    while (result[result.length - 1] === 'divider') result.pop();
    return result;
}

const PROFILE_FIELDS = [
    { value: 'bio', label: 'Bio', description: 'The text on their profile.' },
    { value: 'avatar', label: 'Avatar', description: 'Their uploaded picture.' },
    { value: 'banner', label: 'Banner', description: 'The image across the top of their profile.' },
];

function ClearProfileDialog({ open, user, onClose, onConfirm, busy }) {
    const [fields, setFields] = useState(['bio']);
    const [reason, setReason] = useState('');
    const trimmed = reason.trim();
    const valid = fields.length > 0 && trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;

    const close = () => {
        if (busy) return;
        setFields(['bio']);
        setReason('');
        onClose();
    };

    return (
        <Dialog
            open={open}
            onClose={close}
            title={`Clear ${user?.username || 'this user'}’s profile content`}
            description="Use this for offensive or misleading profile content. Their account and activity stay as they are."
            footer={(
                <>
                    <Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button>
                    <Button
                        variant="danger-solid"
                        loading={busy}
                        disabled={!valid}
                        onClick={() => onConfirm({ fields, reason: trimmed })}
                    >
                        Clear content
                    </Button>
                </>
            )}
        >
            <fieldset className="pb-2">
                <legend className="mb-1 text-sm font-medium text-[var(--text-1)]">What to remove</legend>
                {PROFILE_FIELDS.map((field) => (
                    <CheckboxRow
                        key={field.value}
                        label={field.label}
                        description={field.description}
                        checked={fields.includes(field.value)}
                        onChange={(on) => setFields((current) => (
                            on ? [...new Set([...current, field.value])] : current.filter((value) => value !== field.value)
                        ))}
                    />
                ))}
            </fieldset>
            <Field label="Reason" hint={`${REASON_MIN}–${REASON_MAX} characters. Kept in the audit log.`} className="pb-2">
                {(id, aria) => (
                    <TextArea
                        id={id}
                        {...aria}
                        rows={3}
                        maxLength={REASON_MAX}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                    />
                )}
            </Field>
        </Dialog>
    );
}

/**
 * Every account action an admin can take on one user, as menu items plus the
 * confirm dialogs they open. Used by the Users list and the user page so both
 * offer the same actions with the same safeguards.
 *
 *   const actions = useUserActions({ onDeleted: () => navigate('/admin/users') });
 *   <Menu items={actions.itemsFor(user)} />
 *   {actions.dialogs}
 */
export function useUserActions({ onDeleted, includeOpen = false } = {}) {
    const role = useRole();
    const [pending, setPending] = useState(null); // { kind, user }
    const close = () => setPending(null);
    const invalidate = [adminKeys.resource('users')];

    const post = (path, payload) => adminApi.post(path, payload);
    const options = (success) => ({ invalidate, success, onSuccess: close });

    const suspend = useAdminAction(({ id, reason }) => post(`users/${id}/suspend`, { reason }), options((data) => data?.message || 'User suspended.'));
    const restore = useAdminAction(({ id, reason }) => post(`users/${id}/restore`, { reason }), options((data) => data?.message || 'User restored.'));
    const revoke = useAdminAction(({ id }) => post(`users/${id}/revoke_sessions`), options((data) => data?.message || 'Signed out of every session.'));
    const reset = useAdminAction(({ id }) => post(`users/${id}/send_password_reset`), options((data) => data?.message || 'Password reset email queued.'));
    const verify = useAdminAction(({ id }) => post(`users/${id}/verify_email`), options((data) => data?.message || 'Email marked as verified.'));
    const staff = useAdminAction(({ id, isStaff }) => post(`users/${id}/toggle_staff`, { is_staff: isStaff }), options((data) => data?.message || 'Staff access updated.'));
    const clear = useAdminAction(({ id, fields, reason }) => post(`users/${id}/clear_profile`, { fields, reason }), options((data) => data?.message || 'Profile content cleared.'));
    const remove = useAdminAction(({ id }) => adminApi.del(`users/${id}`), {
        invalidate,
        success: (data) => data?.message || 'User deleted.',
        onSuccess: () => {
            close();
            onDeleted?.();
        },
    });

    const open = (kind, user) => setPending({ kind, user });

    const itemsFor = (user) => {
        const can = userPermissions(user, role);
        const items = [
            includeOpen && { label: 'Open', icon: UserRound, to: `/admin/users/${user.id}` },
            { label: 'View public profile', icon: ExternalLink, onSelect: () => window.open(`/u/${encodeURIComponent(user.username)}`, '_blank', 'noopener') },
            'divider',
            { label: 'Suspend', icon: Ban, tone: 'danger', hidden: !can.canSuspend, onSelect: () => open('suspend', user) },
            { label: 'Restore', icon: RotateCcw, hidden: !can.canRestore, onSelect: () => open('restore', user) },
            { label: 'Sign out everywhere', icon: LogOut, hidden: !can.canRevokeSessions, onSelect: () => open('revoke', user) },
            { label: 'Send password reset', icon: KeyRound, hidden: !can.canSendReset, onSelect: () => open('reset', user) },
            { label: 'Clear profile content', icon: Eraser, hidden: !can.canClearProfile, onSelect: () => open('clear', user) },
            { label: 'Mark email verified', icon: BadgeCheck, hidden: !can.canVerifyEmail, onSelect: () => open('verify', user) },
            { label: user.is_staff ? 'Remove staff access' : 'Make staff', icon: user.is_staff ? ShieldMinus : ShieldPlus, hidden: !can.canToggleStaff, onSelect: () => open('staff', user) },
            'divider',
            { label: 'Delete account', icon: Trash2, tone: 'danger', hidden: !can.canDelete, onSelect: () => open('delete', user) },
        ].filter(Boolean).filter((item) => item === 'divider' || !item.hidden);
        return tidyDividers(items);
    };

    const target = pending?.user;
    const name = target?.username || 'this user';
    const is = (kind) => pending?.kind === kind;

    const dialogs = (
        <>
            <ConfirmDialog
                open={is('suspend')}
                onClose={close}
                title={`Suspend ${name}?`}
                tone="danger"
                confirmLabel="Suspend"
                reason={{ label: 'Reason', required: true, min: REASON_MIN, max: REASON_MAX, placeholder: 'What happened, for the audit log' }}
                busy={suspend.isPending}
                onConfirm={({ reason }) => suspend.mutate({ id: target.id, reason })}
            >
                They are signed out everywhere and cannot sign in until restored. Their content stays up.
            </ConfirmDialog>
            <ConfirmDialog
                open={is('restore')}
                onClose={close}
                title={`Restore ${name}?`}
                confirmLabel="Restore"
                reason={{ label: 'Reason', required: true, min: REASON_MIN, max: REASON_MAX }}
                busy={restore.isPending}
                onConfirm={({ reason }) => restore.mutate({ id: target.id, reason })}
            >
                They can sign in again straight away.
            </ConfirmDialog>
            <ConfirmDialog
                open={is('revoke')}
                onClose={close}
                title={`Sign ${name} out everywhere?`}
                confirmLabel="Sign out"
                busy={revoke.isPending}
                onConfirm={() => revoke.mutate({ id: target.id })}
            >
                Every session on every device ends. They can sign in again with their password.
            </ConfirmDialog>
            <ConfirmDialog
                open={is('reset')}
                onClose={close}
                title={`Send ${name} a password reset?`}
                confirmLabel="Send email"
                busy={reset.isPending}
                onConfirm={() => reset.mutate({ id: target.id })}
            >
                They get the usual reset link at {target?.email || 'their email address'}. Their current password keeps working until they change it.
            </ConfirmDialog>
            <ConfirmDialog
                open={is('verify')}
                onClose={close}
                title={`Mark ${name}’s email as verified?`}
                confirmLabel="Mark verified"
                busy={verify.isPending}
                onConfirm={() => verify.mutate({ id: target.id })}
            >
                Only do this when you know the address belongs to them. It unlocks writing reviews and posts.
            </ConfirmDialog>
            <ConfirmDialog
                open={is('staff')}
                onClose={close}
                title={target?.is_staff ? `Remove ${name}’s staff access?` : `Make ${name} staff?`}
                tone={target?.is_staff ? 'danger' : 'primary'}
                confirmLabel={target?.is_staff ? 'Remove access' : 'Make staff'}
                busy={staff.isPending}
                onConfirm={() => staff.mutate({ id: target.id, isStaff: !target.is_staff })}
            >
                {target?.is_staff
                    ? 'They lose the admin at once.'
                    : 'Staff can open the admin, moderate reviews and forums, and suspend members.'}
            </ConfirmDialog>
            <ConfirmDialog
                open={is('delete')}
                onClose={close}
                title={`Delete ${name}?`}
                tone="danger"
                confirmLabel="Delete account"
                confirmText={target?.username}
                busy={remove.isPending}
                onConfirm={() => remove.mutate({ id: target.id })}
            >
                This removes the account with its list, reviews, favorites, follows and badges. It cannot be undone.
                Forum threads and replies stay, shown as by a deleted user; remove any that break the rules from Forums
                first. Suspending keeps everything and can be reversed.
            </ConfirmDialog>
            <ClearProfileDialog
                key={target?.id || 'none'}
                open={is('clear')}
                user={target}
                onClose={close}
                busy={clear.isPending}
                onConfirm={({ fields, reason }) => clear.mutate({ id: target.id, fields, reason })}
            />
        </>
    );

    return { itemsFor, dialogs, open, permissions: (user) => userPermissions(user, role) };
}
