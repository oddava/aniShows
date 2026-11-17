import { useId, useState } from 'react';
import PropTypes from 'prop-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { Save } from 'lucide-react';

import api from '../../api/client';
import { adminKeys, adminQueries } from '../../api/queries/admin';
import ErrorState from '../../components/common/ErrorState';
import PageLoader from '../../components/common/PageLoader';
import logger from '../../utils/logger';
import ConfirmDialog from './components/ConfirmDialog';
import { getAdminErrorMessage, useAdminQuery } from './hooks/useAdminQuery';
import useAdminRole from './hooks/useAdminRole';

const settingLabel = (path) => {
  const [section, key] = path.split('.');
  const group = SETTINGS_SCHEMA.find((item) => item.section === section);
  return group?.fields.find((field) => field.key === key)?.label || group?.title || path;
};

/** "Minimum username length: Must be <= 50." for each field the API refused. */
export const describeSettingsErrors = (errors) => Object.entries(errors || {})
  .map(([path, message]) => `${settingLabel(path)}: ${message}`)
  .join(' ');

/** The settings the backend actually enforces; nothing else is shown or sent. */
export const SETTINGS_SCHEMA = [
  {
    section: 'general',
    title: 'Site',
    fields: [
      { key: 'maintenanceMode', label: 'Maintenance mode', type: 'bool', help: 'Visitors see a maintenance screen. Staff keep access.' },
      { key: 'allowRegistration', label: 'Allow new registrations', type: 'bool' },
    ],
  },
  {
    section: 'users',
    title: 'Accounts',
    fields: [
      { key: 'emailVerification', label: 'Require email verification', type: 'bool' },
      { key: 'allowUsernameChange', label: 'Allow username changes', type: 'bool' },
      { key: 'minUsernameLength', label: 'Minimum username length', type: 'int', min: 1, max: 50 },
      { key: 'maxUsernameLength', label: 'Maximum username length', type: 'int', min: 1, max: 100 },
    ],
  },
  {
    section: 'content',
    title: 'Content',
    fields: [{ key: 'enableReviews', label: 'Allow new reviews', type: 'bool' }],
  },
];

const pickEnforced = (settings) => Object.fromEntries(SETTINGS_SCHEMA.map(({ section, fields }) => [
  section,
  Object.fromEntries(fields.map(({ key }) => [key, settings?.[section]?.[key]])),
]));

function SettingField({ field, value, onChange, disabled }) {
  const id = useId();
  const helpId = useId();
  if (field.type === 'bool') {
    return (
      <div className="flex items-start gap-3 min-h-[44px]">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={field.help ? helpId : undefined}
          className="mt-0.5 w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500 disabled:opacity-50"
        />
        <div>
          <label htmlFor={id} className="text-white/85">{field.label}</label>
          {field.help && <p id={helpId} className="text-xs text-white/50 mt-0.5">{field.help}</p>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-white/70 mb-2">{field.label}</label>
      <input
        id={id}
        type="number"
        min={field.min}
        max={field.max}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 disabled:opacity-50"
      />
    </div>
  );
}

SettingField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.oneOfType([PropTypes.bool, PropTypes.number, PropTypes.string]),
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

const AdminSettings = () => {
  const { isSuperuser } = useAdminRole();
  const queryClient = useQueryClient();
  // Unsaved edits. Until the first edit the form shows the loaded settings.
  const [draft, setDraft] = useState(null);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  const query = useAdminQuery({
    ...adminQueries.settings(),
    errorLog: 'Failed to load admin settings:',
    errorToast: (err) => getAdminErrorMessage(err, 'Failed to load settings'),
  });
  const settings = draft ?? query.data ?? null;

  const saveMutation = useMutation({
    mutationFn: (nextSettings) => api.put('/admin/settings/', nextSettings),
    onSuccess: (response) => {
      queryClient.setQueryData(adminKeys.settings(), response.data.settings);
      setDraft(null);
    },
  });

  const setValue = (section, key, value) => {
    setDraft((prev) => {
      const base = prev ?? query.data;
      return { ...base, [section]: { ...base[section], [key]: value } };
    });
  };

  const handleChange = (section, key, value) => {
    if (section === 'general' && key === 'maintenanceMode' && value) {
      setConfirmMaintenance(true);
      return;
    }
    setValue(section, key, value);
  };

  const handleSave = async () => {
    if (!settings) return;
    try {
      await saveMutation.mutateAsync(pickEnforced(settings));
      toast.success('Settings saved successfully');
    } catch (err) {
      logger.error('Failed to save admin settings:', err);
      toast.error(describeSettingsErrors(err.response?.data?.errors)
        || getAdminErrorMessage(err, 'Failed to save settings'));
    }
  };

  if (query.isPending) return <PageLoader />;
  if (!settings) {
    return (
      <ErrorState
        title="Couldn’t load settings"
        message={getAdminErrorMessage(query.error, 'Failed to load settings')}
        onRetry={() => query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          {!isSuperuser && <p className="text-sm text-white/50 mt-1">Only superusers can change settings.</p>}
        </div>
        {isSuperuser && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saveMutation.isPending || draft === null}
            className="px-4 py-2 min-h-[44px] sm:min-h-0 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} aria-hidden="true" />
            {saveMutation.isPending ? 'Saving...' : 'Save settings'}
          </button>
        )}
      </div>

      {SETTINGS_SCHEMA.map(({ section, title, fields }) => (
        <section key={section} aria-label={title} className="bg-white/5 border border-white/10 rounded-xl p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {fields.map((field) => (
              <SettingField
                key={field.key}
                field={field}
                value={settings[section]?.[field.key]}
                disabled={!isSuperuser}
                onChange={(value) => handleChange(section, field.key, value)}
              />
            ))}
          </div>
        </section>
      ))}

      <ConfirmDialog
        isOpen={confirmMaintenance}
        title="Turn on maintenance mode?"
        message={(
          <>
            <p>After you save, visitors and regular users see the maintenance screen and the public API answers 503.</p>
            <p>Staff keep access to the site and the admin area.</p>
          </>
        )}
        confirmLabel="Turn on"
        onCancel={() => setConfirmMaintenance(false)}
        onConfirm={() => {
          setValue('general', 'maintenanceMode', true);
          setConfirmMaintenance(false);
        }}
      />
    </div>
  );
};

export default AdminSettings;
