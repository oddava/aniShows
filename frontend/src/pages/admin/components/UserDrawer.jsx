import { useId } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

import api from '../../../api/client';
import ErrorState from '../../../components/common/ErrorState';
import useAdminFocusTrap from '../hooks/useAdminFocusTrap';
import { getAdminErrorMessage, useAdminQuery } from '../hooks/useAdminQuery';

export const userDetailKey = (id) => ['admin', 'users', 'detail', id];

const ACTION_LABELS = {
  SUSPEND: 'Suspended',
  RESTORE: 'Restored',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  BULK_ACTION: 'Bulk action',
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : 'Never');

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-white/50">{label}</dt>
      <dd className="text-white/85 text-right break-words min-w-0">{children}</dd>
    </div>
  );
}

Row.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node };

/**
 * Side panel with one user's basics, activity counts and moderation history.
 * Actions are rendered by the page (`renderActions`) so its confirm dialogs
 * stay outside the drawer; `paused` releases the focus trap while one is open.
 */
export default function UserDrawer({ userId, onClose, renderActions, paused = false }) {
  const titleId = useId();
  const containerRef = useAdminFocusTrap(!paused, onClose);
  const query = useAdminQuery({
    queryKey: userDetailKey(userId),
    queryFn: ({ signal }) => api.get(`/admin/users/${userId}/`, { signal }).then((res) => res.data),
    errorLog: 'Failed to fetch user details:',
  });
  const user = query.data;
  const history = user?.moderation_history || [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onMouseDown={(e) => { if (e.target === e.currentTarget && !paused) onClose(); }}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full sm:max-w-md h-full bg-dark-100 border-l border-white/10 flex flex-col"
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/5">
          <h2 id={titleId} className="text-lg font-semibold text-white truncate">
            {user?.username || 'User details'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
          {query.error && !user ? (
            <ErrorState
              title="Couldn’t load this user"
              message={getAdminErrorMessage(query.error, 'Failed to load user details')}
              onRetry={() => query.refetch()}
            />
          ) : !user ? (
            <p role="status" className="text-sm text-white/60">Loading...</p>
          ) : (
            <>
              <section aria-label="Profile">
                <dl className="space-y-2">
                  <Row label="Email">{user.email}</Row>
                  <Row label="Status">{user.is_active ? 'Active' : 'Suspended'}</Row>
                  <Row label="Role">{user.is_superuser ? 'Superuser' : user.is_staff ? 'Staff' : 'User'}</Row>
                  <Row label="Email verified">{user.email_verified ? 'Yes' : 'No'}</Row>
                  <Row label="Private profile">{user.is_private ? 'Yes' : 'No'}</Row>
                  <Row label="Joined">{formatDate(user.date_joined)}</Row>
                  <Row label="Last login">{formatDate(user.last_login)}</Row>
                </dl>
              </section>

              <section aria-label="Activity">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-2">Activity</h3>
                <dl className="grid grid-cols-3 gap-3 text-center">
                  {[
                    ['List entries', user.list_entries_count],
                    ['Reviews', user.reviews_count],
                    ['Favorites', user.favorites_count],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/10 py-3 flex flex-col-reverse">
                      <dt className="text-xs text-white/50">{label}</dt>
                      <dd className="text-lg font-semibold text-white">{value ?? 0}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {renderActions && (
                <section aria-label="Actions" className="flex flex-wrap gap-2">
                  {renderActions(user)}
                </section>
              )}

              <section aria-label="Moderation history">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white/50">Moderation history</h3>
                  <Link
                    to={`/admin/logs?tab=audit&entity_type=User&entity_id=${user.id}`}
                    className="text-xs text-violet-300 hover:text-violet-200"
                  >
                    All audit entries
                  </Link>
                </div>
                {history.length === 0 ? (
                  <p className="text-sm text-white/50">No moderation actions yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {history.map((entry) => (
                      <li key={entry.id} className="text-sm border-l-2 border-white/10 pl-3">
                        <p className="text-white">
                          {ACTION_LABELS[entry.action] || entry.action}
                          <span className="text-white/50"> by {entry.actor || 'system'}</span>
                        </p>
                        <p className="text-xs text-white/50">{formatDate(entry.timestamp)}</p>
                        {entry.reason && <p className="text-white/70 mt-0.5 break-words">{entry.reason}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

UserDrawer.propTypes = {
  userId: PropTypes.number.isRequired,
  onClose: PropTypes.func.isRequired,
  renderActions: PropTypes.func,
  paused: PropTypes.bool,
};
