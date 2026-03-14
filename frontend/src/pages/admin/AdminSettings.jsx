import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api/client';
import logger from '../../utils/logger';

const AdminSettings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      try {
        const response = await api.get('/admin/settings/');
        setSettings(response.data);
      } catch (err) {
        logger.error('Failed to load admin settings:', err);
        toast.error(err.response?.data?.detail || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleChange = (section, field, value) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      const response = await api.put('/admin/settings/', settings);
      setSettings(response.data.settings);
      toast.success('Settings saved successfully');
    } catch (err) {
      logger.error('Failed to save admin settings:', err);
      toast.error(err.response?.data?.detail || 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-white/60">
        <div className="w-10 h-10 border-4 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mb-3" />
        Loading settings...
      </div>
    );
  }

  const tabs = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'users', label: 'Users', icon: '👥' },
    { id: 'content', label: 'Content', icon: '📝' },
    { id: 'security', label: 'Security', icon: '🔒' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">System Settings</h1>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <span className="animate-spin">⏳</span>
              Saving...
            </>
          ) : (
            <>
              <span>💾</span>
              Save Settings
            </>
          )}
        </button>
      </div>

      <div className="flex gap-1 mb-6 bg-white/5 border border-white/10 rounded-xl p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-violet-600 text-white'
                : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-6">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white mb-4">General Settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Site Name</label>
                <input
                  type="text"
                  value={settings.general.siteName}
                  onChange={(e) => handleChange('general', 'siteName', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Timezone</label>
                <select
                  value={settings.general.timezone}
                  onChange={(e) => handleChange('general', 'timezone', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                >
                  <option value="UTC" className="bg-[#1a1a1a]">UTC</option>
                  <option value="America/New_York" className="bg-[#1a1a1a]">Eastern Time</option>
                  <option value="America/Los_Angeles" className="bg-[#1a1a1a]">Pacific Time</option>
                  <option value="Europe/London" className="bg-[#1a1a1a]">London</option>
                  <option value="Asia/Tokyo" className="bg-[#1a1a1a]">Tokyo</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-white/70 mb-2">Site Description</label>
                <textarea
                  value={settings.general.siteDescription}
                  onChange={(e) => handleChange('general', 'siteDescription', e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 resize-none"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6 pt-4 border-t border-white/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.general.maintenanceMode}
                  onChange={(e) => handleChange('general', 'maintenanceMode', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Maintenance Mode</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.general.allowRegistration}
                  onChange={(e) => handleChange('general', 'allowRegistration', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Allow Registrations</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white mb-4">User Settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Min Username Length</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={settings.users.minUsernameLength}
                  onChange={(e) => handleChange('users', 'minUsernameLength', Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Max Username Length</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.users.maxUsernameLength}
                  onChange={(e) => handleChange('users', 'maxUsernameLength', Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6 pt-4 border-t border-white/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.users.emailVerification}
                  onChange={(e) => handleChange('users', 'emailVerification', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Require Email Verification</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.users.allowUsernameChange}
                  onChange={(e) => handleChange('users', 'allowUsernameChange', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Allow Username Changes</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'content' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white mb-4">Content Settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Max Upload Size (MB)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.content.maxUploadSize}
                  onChange={(e) => handleChange('content', 'maxUploadSize', Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Allowed Image Types</label>
                <input
                  type="text"
                  value={settings.content.allowedImageTypes}
                  onChange={(e) => handleChange('content', 'allowedImageTypes', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6 pt-4 border-t border-white/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.content.enableReviews}
                  onChange={(e) => handleChange('content', 'enableReviews', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Enable Reviews</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.content.allowComments}
                  onChange={(e) => handleChange('content', 'allowComments', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Allow Comments</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white mb-4">Security Settings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Session Timeout (hours)</label>
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={settings.security.sessionTimeout}
                  onChange={(e) => handleChange('security', 'sessionTimeout', Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">API Rate Limit (requests/hour)</label>
                <input
                  type="number"
                  min="100"
                  max="10000"
                  value={settings.security.apiRateLimit}
                  onChange={(e) => handleChange('security', 'apiRateLimit', Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-6 pt-4 border-t border-white/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.security.requireStrongPassword}
                  onChange={(e) => handleChange('security', 'requireStrongPassword', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Require Strong Passwords</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.security.twoFactorAuth}
                  onChange={(e) => handleChange('security', 'twoFactorAuth', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Enable 2FA for Admin</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminSettings;
