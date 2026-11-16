import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';

import { adminQueries } from '../../api/queries/admin';
import CustomSelect from '../../components/common/CustomSelect';
import AdminPagination from './components/AdminPagination';
import Modal from './components/Modal';
import { useAdminList, useAdminQuery } from './hooks/useAdminQuery';
import useAdminRole from './hooks/useAdminRole';
import useDebouncedValue from './hooks/useDebouncedValue';

export const LIVE_INTERVAL_MS = 30000;

const LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
const LOG_TYPES = ['SYSTEM', 'REQUEST', 'AUTH', 'ADMIN', 'ERROR', 'SECURITY'];
export const AUDIT_ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'BULK_ACTION',
  'SUSPEND', 'RESTORE', 'RESOLVE', 'DISMISS', 'TRIGGER', 'CONTROL',
];

const EMPTY_STATS = { by_level: {}, total: 0 };
const INPUT = 'w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500';
const SELECT_TRIGGER = 'px-4 py-2.5 bg-white/10 rounded-lg focus-visible:ring-violet-500/50';

const LEVEL_CLASSES = {
  DEBUG: 'text-gray-400 border-gray-500/30',
  INFO: 'text-blue-400 border-blue-500/30',
  WARNING: 'text-yellow-400 border-yellow-500/30',
  ERROR: 'text-red-400 border-red-500/30',
  CRITICAL: 'text-purple-300 border-purple-500/30',
};

const statusClass = (code) => (code < 400 ? 'text-green-400' : code < 500 ? 'text-yellow-400' : 'text-red-400');
const formatTime = (value) => new Date(value).toLocaleString();
const pretty = (value) => JSON.stringify(value ?? {}, null, 2);
const isEmpty = (value) => !value || (typeof value === 'object' && Object.keys(value).length === 0);

function SearchInput({ value, onChange, label }) {
  return (
    <div className="relative">
      <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
      <input
        type="search"
        aria-label={label}
        placeholder={`${label}...`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} pl-9`}
      />
    </div>
  );
}

SearchInput.propTypes = { value: PropTypes.string.isRequired, onChange: PropTypes.func.isRequired, label: PropTypes.string.isRequired };

function JsonBlock({ title, value }) {
  if (isEmpty(value)) return null;
  return (
    <div>
      <h3 className="text-sm text-white/50 mb-1">{title}</h3>
      <pre className="text-xs text-white/80 bg-white/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">{pretty(value)}</pre>
    </div>
  );
}

JsonBlock.propTypes = { title: PropTypes.string.isRequired, value: PropTypes.any };

function Field({ label, children }) {
  if (children == null || children === '') return null;
  return (
    <div>
      <dt className="text-sm text-white/50">{label}</dt>
      <dd className="text-white break-words">{children}</dd>
    </div>
  );
}

Field.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node };

const useFilters = (initial) => {
  const [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1);
  const update = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const clear = () => {
    setFilters(Object.fromEntries(Object.keys(initial).map((key) => [key, ''])));
    setPage(1);
  };
  const active = Object.values(filters).some((v) => v !== '');
  return { filters, update, clear, active, page, setPage };
};

const compact = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));

/** Request/system logs. They hold IPs and user agents, so only superusers see them. */
function RequestLogs() {
  const { filters, update, clear, active, page, setPage } = useFilters({
    level: '', log_type: '', search: '', user: '', start_date: '', end_date: '',
  });
  const search = useDebouncedValue(filters.search.trim());
  const user = useDebouncedValue(filters.user.trim());
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState(null);
  const liveId = useId();

  const polling = live ? { refetchInterval: LIVE_INTERVAL_MS, refetchIntervalInBackground: false } : {};
  const logsQuery = useAdminList({
    resource: 'logs',
    params: compact({ page, ...filters, search, user }),
    page,
    setPage,
    ...polling,
    errorLog: 'Failed to fetch logs:',
    errorToast: 'Failed to load logs',
  });
  const statsQuery = useAdminQuery({
    ...adminQueries.stats('logs'),
    ...polling,
    errorLog: 'Failed to fetch stats:',
  });

  const { items: logs, totalPages } = logsQuery;
  const stats = statsQuery.data || EMPTY_STATS;
  const loading = logsQuery.isPending || logsQuery.isPlaceholderData;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-white/50">
          {stats.window === '24h' ? 'Counts cover the last 24 hours.' : stats.window === 'filtered' ? 'Counts match the filters.' : ''}
        </p>
        <label htmlFor={liveId} className="flex items-center gap-2 text-sm text-white/70 min-h-[44px]">
          <input
            id={liveId}
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-violet-500"
          />
          Live (every 30s)
        </label>
        <span className="sr-only" aria-live="polite">{live ? 'Live updates on' : 'Live updates off'}</span>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SearchInput value={filters.search} onChange={(v) => update('search', v)} label="Search logs" />
          <CustomSelect
            value={filters.level}
            onChange={(v) => update('level', v)}
            options={[{ value: '', label: 'All levels' }, ...LEVELS.map((l) => ({ value: l, label: l }))]}
            triggerClassName={SELECT_TRIGGER}
            ariaLabel="Filter logs by level"
          />
          <CustomSelect
            value={filters.log_type}
            onChange={(v) => update('log_type', v)}
            options={[{ value: '', label: 'All types' }, ...LOG_TYPES.map((t) => ({ value: t, label: t }))]}
            triggerClassName={SELECT_TRIGGER}
            ariaLabel="Filter logs by type"
          />
          <input
            type="text"
            inputMode="numeric"
            aria-label="User ID"
            placeholder="User ID..."
            value={filters.user}
            onChange={(e) => update('user', e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <input type="date" aria-label="From date" value={filters.start_date} onChange={(e) => update('start_date', e.target.value)} className={INPUT} />
            <span className="text-white/50">to</span>
            <input type="date" aria-label="To date" value={filters.end_date} onChange={(e) => update('end_date', e.target.value)} className={INPUT} />
          </div>
          {active && (
            <button type="button" onClick={clear} className="px-4 py-2 min-h-[44px] text-white/70 hover:text-white">Clear filters</button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {LEVELS.map((level) => (
          <div key={level} className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col-reverse">
            <dt className={`text-xs font-medium uppercase tracking-wider mt-1 ${(LEVEL_CLASSES[level] || '').split(' ')[0]}`}>{level}</dt>
            <dd className="text-2xl font-bold text-white">{stats.by_level?.[level] || 0}</dd>
          </div>
        ))}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col-reverse">
          <dt className="text-xs font-medium text-white/50 uppercase tracking-wider mt-1">Total</dt>
          <dd className="text-2xl font-bold text-white">{stats.total || 0}</dd>
        </div>
      </dl>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <p role="status" className="p-12 text-center text-white/50">Loading logs...</p>
        ) : logs.length === 0 ? (
          <p className="p-12 text-center text-white/50">No logs found matching your criteria</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {logs.map((log) => (
              <li key={log.id} className="p-4 flex items-start gap-4">
                <span className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold border ${LEVEL_CLASSES[log.level] || 'text-white/60 border-white/20'}`}>
                  {log.level}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white/90 break-words">{log.message}</p>
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-white/50">
                    <span>{log.log_type}</span>
                    {(log.username || log.user) && <span>{log.username || `User #${log.user}`}</span>}
                    {log.method && <span className="font-mono break-all">{log.method} {log.path}</span>}
                    {log.status_code && <span className={statusClass(log.status_code)}>{log.status_code}</span>}
                    <span>{formatTime(log.timestamp)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(log)}
                  className="px-3 py-1.5 min-h-[44px] sm:min-h-0 text-sm bg-white/10 text-white/80 rounded-lg hover:bg-white/20 flex-shrink-0"
                >
                  Details
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && <AdminPagination page={page} totalPages={totalPages} onPageChange={setPage} />}
      </div>

      <Modal isOpen={selected !== null} onClose={() => setSelected(null)} title="Log details" size="large">
        {selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Level">{selected.level}</Field>
              <Field label="Time">{formatTime(selected.timestamp)}</Field>
              <Field label="Type">{selected.log_type}</Field>
              <Field label="User">{selected.user ? `${selected.username || 'Unknown'} (ID: ${selected.user})` : null}</Field>
              <Field label="IP address">{selected.user_ip}</Field>
              <Field label="Method">{selected.method}</Field>
              <Field label="Path">{selected.path ? <span className="font-mono text-sm">{selected.path}</span> : null}</Field>
              <Field label="Status">{selected.status_code}</Field>
              <Field label="Duration">{selected.duration_ms != null ? `${selected.duration_ms}ms` : null}</Field>
            </dl>
            <Field label="Message">{selected.message}</Field>
            <JsonBlock title="Details" value={selected.details} />
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Admin audit trail; staff can read it. */
function AuditLogs({ initial }) {
  const { filters, update, clear, active, page, setPage } = useFilters(initial);
  const search = useDebouncedValue(filters.search.trim());
  const user = useDebouncedValue(filters.user.trim());
  const [selected, setSelected] = useState(null);

  const auditQuery = useAdminList({
    resource: 'audit-logs',
    params: compact({ page, ...filters, search, user }),
    page,
    setPage,
    errorLog: 'Failed to fetch audit logs:',
    errorToast: 'Failed to load audit logs',
  });
  const { items: entries, totalPages } = auditQuery;
  const loading = auditQuery.isPending || auditQuery.isPlaceholderData;

  return (
    <div className="space-y-6">
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SearchInput value={filters.search} onChange={(v) => update('search', v)} label="Search audit log" />
          <CustomSelect
            value={filters.action}
            onChange={(v) => update('action', v)}
            options={[{ value: '', label: 'All actions' }, ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a.replace('_', ' ') }))]}
            triggerClassName={SELECT_TRIGGER}
            ariaLabel="Filter by action"
          />
          <input
            type="text"
            aria-label="Entity type"
            placeholder="Entity type (e.g. User)..."
            value={filters.entity_type}
            onChange={(e) => update('entity_type', e.target.value)}
            className={INPUT}
          />
          <input
            type="text"
            inputMode="numeric"
            aria-label="Actor user ID"
            placeholder="Actor user ID..."
            value={filters.user}
            onChange={(e) => update('user', e.target.value)}
            className={INPUT}
          />
        </div>
        {(filters.entity_id || active) && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {filters.entity_id ? (
              <p className="text-sm text-white/70">
                Showing entries for {filters.entity_type || 'entity'} #{filters.entity_id}
              </p>
            ) : <span />}
            <button type="button" onClick={clear} className="px-4 py-2 min-h-[44px] text-white/70 hover:text-white">Clear filters</button>
          </div>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <p role="status" className="p-12 text-center text-white/50">Loading audit log...</p>
        ) : entries.length === 0 ? (
          <p className="p-12 text-center text-white/50">No audit entries found</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {entries.map((entry) => (
              <li key={entry.id} className="p-4 flex items-start gap-4">
                <span className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold border border-white/10 text-white/80">
                  {entry.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white/90 break-words">
                    {entry.entity_type}{entry.entity_id ? ` #${entry.entity_id}` : ''}
                    {entry.entity_repr && <span className="text-white/60"> · {entry.entity_repr}</span>}
                  </p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-white/50">
                    <span>{entry.username || 'System'}</span>
                    <span>{formatTime(entry.timestamp)}</span>
                    {entry.metadata?.reason && <span className="text-white/70">Reason: {entry.metadata.reason}</span>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="px-3 py-1.5 min-h-[44px] sm:min-h-0 text-sm bg-white/10 text-white/80 rounded-lg hover:bg-white/20 flex-shrink-0"
                >
                  Details
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && <AdminPagination page={page} totalPages={totalPages} onPageChange={setPage} />}
      </div>

      <Modal isOpen={selected !== null} onClose={() => setSelected(null)} title="Audit entry" size="large">
        {selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Action">{selected.action}</Field>
              <Field label="Time">{formatTime(selected.timestamp)}</Field>
              <Field label="Actor">{selected.username || 'System'}</Field>
              <Field label="IP address">{selected.user_ip}</Field>
              <Field label="Entity">{`${selected.entity_type}${selected.entity_id ? ` #${selected.entity_id}` : ''}`}</Field>
              <Field label="Description">{selected.entity_repr}</Field>
            </dl>
            <JsonBlock title="Changes" value={selected.changes} />
            <JsonBlock title="Metadata" value={selected.metadata} />
          </div>
        )}
      </Modal>
    </div>
  );
}

AuditLogs.propTypes = { initial: PropTypes.object.isRequired };

const AdminLogs = () => {
  const { isSuperuser } = useAdminRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const tab = !isSuperuser || requested === 'audit' ? 'audit' : 'requests';
  const auditInitial = {
    search: '',
    action: searchParams.get('action') || '',
    entity_type: searchParams.get('entity_type') || '',
    entity_id: searchParams.get('entity_id') || '',
    user: searchParams.get('user') || '',
  };

  const tabs = [
    ...(isSuperuser ? [{ id: 'requests', label: 'Requests' }] : []),
    { id: 'audit', label: 'Audit' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Logs</h1>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Log type" className="flex gap-2 border-b border-white/10">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setSearchParams(t.id === 'audit' ? { tab: 'audit' } : {})}
              className={`px-4 py-2 min-h-[44px] text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id
                ? 'border-violet-500 text-white'
                : 'border-transparent text-white/60 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'audit'
        ? <AuditLogs key={searchParams.toString()} initial={auditInitial} />
        : <RequestLogs />}
    </div>
  );
};

export default AdminLogs;
