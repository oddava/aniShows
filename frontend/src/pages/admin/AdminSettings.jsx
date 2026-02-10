import { useState } from 'react';
import { toast } from 'react-hot-toast';

const AdminSettings = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  
  const [settings, setSettings] = useState({
    general: {
      siteName: 'aniShows',
      siteDescription: 'Your Ultimate Anime Discovery Platform',
      maintenanceMode: false,
      allowRegistration: true,
      defaultLanguage: 'en',
      timezone: 'UTC',
    },
    users: {
      emailVerification: true,
      allowUsernameChange: true,
      minUsernameLength: 3,
      maxUsernameLength: 30,
      defaultUserRole: 'user',
      profileVisibility: 'public',
    },
    content: {
      enableReviews: true,
      requireApproval: false,
      allowComments: true,
      autoFetchMetadata: true,
      maxUploadSize: '10',
      allowedImageTypes: 'jpg,jpeg,png,webp',
    },
    security: {
      sessionTimeout: '24',
      maxLoginAttempts: 5,
      requireStrongPassword: true,
      twoFactorAuth: false,
      ipBlocking: false,
      apiRateLimit: '1000',
    },
  });

  const handleChange = (section, field, value) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    toast.success('Settings saved successfully!');
    setIsSaving(false);
  };

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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 border border-white/10 rounded-xl p-1">
        {tabs.map(tab => (
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

      {/* Settings Form */}
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
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Default Language</label>
                <select
                  value={settings.general.defaultLanguage}
                  onChange={(e) => handleChange('general', 'defaultLanguage', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="en" className="bg-[#1a1a1a]">English</option>
                  <option value="es" className="bg-[#1a1a1a]">Spanish</option>
                  <option value="fr" className="bg-[#1a1a1a]">French</option>
                  <option value="de" className="bg-[#1a1a1a]">German</option>
                  <option value="ja" className="bg-[#1a1a1a]">Japanese</option>
                </select>
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-white/70 mb-2">Site Description</label>
                <textarea
                  value={settings.general.siteDescription}
                  onChange={(e) => handleChange('general', 'siteDescription', e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors resize-none"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Timezone</label>
                <select
                  value={settings.general.timezone}
                  onChange={(e) => handleChange('general', 'timezone', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="UTC" className="bg-[#1a1a1a]">UTC</option>
                  <option value="America/New_York" className="bg-[#1a1a1a]">Eastern Time</option>
                  <option value="America/Chicago" className="bg-[#1a1a1a]">Central Time</option>
                  <option value="America/Denver" className="bg-[#1a1a1a]">Mountain Time</option>
                  <option value="America/Los_Angeles" className="bg-[#1a1a1a]">Pacific Time</option>
                  <option value="Europe/London" className="bg-[#1a1a1a]">London</option>
                  <option value="Europe/Paris" className="bg-[#1a1a1a]">Paris</option>
                  <option value="Asia/Tokyo" className="bg-[#1a1a1a]">Tokyo</option>
                </select>
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
                <span className="text-white/80">Enable Maintenance Mode</span>
              </label>
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.general.allowRegistration}
                  onChange={(e) => handleChange('general', 'allowRegistration', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Allow New Registrations</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold text-white mb-4">User Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Minimum Username Length</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={settings.users.minUsernameLength}
                  onChange={(e) => handleChange('users', 'minUsernameLength', parseInt(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Maximum Username Length</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={settings.users.maxUsernameLength}
                  onChange={(e) => handleChange('users', 'maxUsernameLength', parseInt(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Default User Role</label>
                <select
                  value={settings.users.defaultUserRole}
                  onChange={(e) => handleChange('users', 'defaultUserRole', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="user" className="bg-[#1a1a1a]">Regular User</option>
                  <option value="moderator" className="bg-[#1a1a1a]">Moderator</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Default Profile Visibility</label>
                <select
                  value={settings.users.profileVisibility}
                  onChange={(e) => handleChange('users', 'profileVisibility', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                >
                  <option value="public" className="bg-[#1a1a1a]">Public</option>
                  <option value="friends" className="bg-[#1a1a1a]">Friends Only</option>
                  <option value="private" className="bg-[#1a1a1a]">Private</option>
                </select>
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
                  onChange={(e) => handleChange('content', 'maxUploadSize', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Allowed Image Types</label>
                <input
                  type="text"
                  value={settings.content.allowedImageTypes}
                  onChange={(e) => handleChange('content', 'allowedImageTypes', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                  placeholder="jpg,jpeg,png,webp"
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
                  checked={settings.content.requireApproval}
                  onChange={(e) => handleChange('content', 'requireApproval', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Require Review Approval</span>
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
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.content.autoFetchMetadata}
                  onChange={(e) => handleChange('content', 'autoFetchMetadata', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Auto-fetch Metadata</span>
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
                  onChange={(e) => handleChange('security', 'sessionTimeout', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">Max Login Attempts</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.security.maxLoginAttempts}
                  onChange={(e) => handleChange('security', 'maxLoginAttempts', parseInt(e.target.value))}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">API Rate Limit (requests/hour)</label>
                <input
                  type="number"
                  min="100"
                  max="10000"
                  value={settings.security.apiRateLimit}
                  onChange={(e) => handleChange('security', 'apiRateLimit', e.target.value)}
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 transition-colors"
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
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.security.ipBlocking}
                  onChange={(e) => handleChange('security', 'ipBlocking', e.target.checked)}
                  className="w-5 h-5 rounded border-white/20 bg-white/10 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-white/80">Enable IP Blocking</span>
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 p-4 bg-violet-500/10 border border-violet-500/20 rounded-lg">
        <p className="text-sm text-white/70">
          <span className="text-violet-400 font-medium">Note:</span> Some settings may require a server restart to take full effect. Changes are saved to local state for demonstration purposes.
        </p>
      </div>
    </div>
  );
};

export default AdminSettings;
