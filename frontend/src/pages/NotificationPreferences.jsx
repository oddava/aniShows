import React, { useState, useEffect } from 'react';
import { Mail, Bell, Tv, MessageCircle, Check, X, Loader2 } from 'lucide-react';
import { notificationApi } from '../api/client';
import { useAuth } from '../context/AuthContext';

const ToggleSwitch = ({ enabled, onToggle, loading }) => (
    <button
        onClick={onToggle}
        disabled={loading}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${
            enabled ? 'bg-accent' : 'bg-gray-600'
        } ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
    >
        <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-all duration-300 ${
                enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
        />
    </button>
);

const PreferenceItem = ({ icon: Icon, label, description, enabled, onToggle, loading }) => (
    <div className="flex items-center justify-between py-4 group">
        <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg transition-colors ${enabled ? 'bg-accent/20' : 'bg-gray-700/50'}`}>
                <Icon className={`w-5 h-5 ${enabled ? 'text-accent' : 'text-gray-400'}`} />
            </div>
            <div>
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="text-xs text-gray-500">{description}</p>
            </div>
        </div>
        <ToggleSwitch enabled={enabled} onToggle={onToggle} loading={loading} />
    </div>
);

const NotificationPreferences = () => {
    const { user } = useAuth();
    const [preferences, setPreferences] = useState({
        email_new_episodes: true,
        email_review_replies: true,
        push_new_episodes: true,
        push_review_replies: true,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!user) return;

        const fetchPreferences = async () => {
            try {
                const response = await notificationApi.getPreferences();
                setPreferences(response.data);
            } catch (error) {
                console.error('Failed to fetch preferences:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchPreferences();
    }, [user]);

    const handleToggle = async (key) => {
        const newPreferences = {
            ...preferences,
            [key]: !preferences[key],
        };

        setPreferences(newPreferences);
        setSaving(true);

        try {
            await notificationApi.updatePreferences(newPreferences);
            setMessage('Preferences saved successfully');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Failed to update preferences:', error);
            setPreferences(preferences); // Revert on error
            setMessage('Failed to save preferences');
        } finally {
            setSaving(false);
        }
    };

    if (!user) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-gray-400">
                <Bell className="w-16 h-16 mb-4 text-gray-600" />
                <p className="text-lg">Please log in to manage notification preferences</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center">
                <div className="w-12 h-12 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-400">Loading preferences...</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <div className="w-12 h-12 bg-accent/20 rounded-xl flex items-center justify-center">
                    <Bell className="w-6 h-6 text-accent" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-white">Notification Settings</h1>
                    <p className="text-gray-400">Manage how you receive notifications</p>
                </div>
            </div>

            {/* Success/Error Message */}
            {message && (
                <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 animate-fade-in ${
                    message.includes('success') 
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400' 
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}>
                    {message.includes('success') ? (
                        <Check className="w-5 h-5" />
                    ) : (
                        <X className="w-5 h-5" />
                    )}
                    <span className="text-sm font-medium">{message}</span>
                </div>
            )}

            {/* Email Notifications Section */}
            <div className="bg-dark-100/50 backdrop-blur-sm border border-gray-700/50 rounded-xl overflow-hidden mb-6">
                <div className="p-6 border-b border-gray-700/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                            <Mail className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">Email Notifications</h2>
                            <p className="text-sm text-gray-500">Get notified via email</p>
                        </div>
                    </div>
                </div>
                
                <div className="px-6">
                    <PreferenceItem
                        icon={Tv}
                        label="New Episode Alerts"
                        description="Notify me when a new episode airs for anime in my list"
                        enabled={preferences.email_new_episodes}
                        onToggle={() => handleToggle('email_new_episodes')}
                        loading={saving}
                    />
                    
                    <div className="border-t border-gray-700/30" />
                    
                    <PreferenceItem
                        icon={MessageCircle}
                        label="Review Replies"
                        description="Notify me when someone replies to my reviews"
                        enabled={preferences.email_review_replies}
                        onToggle={() => handleToggle('email_review_replies')}
                        loading={saving}
                    />
                </div>
            </div>

            {/* Push Notifications Section */}
            <div className="bg-dark-100/50 backdrop-blur-sm border border-gray-700/50 rounded-xl overflow-hidden">
                <div className="p-6 border-b border-gray-700/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                            <Bell className="w-5 h-5 text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">Push Notifications</h2>
                            <p className="text-sm text-gray-500">Get notified in your browser</p>
                        </div>
                    </div>
                </div>
                
                <div className="px-6">
                    <PreferenceItem
                        icon={Tv}
                        label="New Episode Alerts"
                        description="Send push notification when a new episode airs"
                        enabled={preferences.push_new_episodes}
                        onToggle={() => handleToggle('push_new_episodes')}
                        loading={saving}
                    />
                    
                    <div className="border-t border-gray-700/30" />
                    
                    <PreferenceItem
                        icon={MessageCircle}
                        label="Review Replies"
                        description="Send push notification when someone replies to my reviews"
                        enabled={preferences.push_review_replies}
                        onToggle={() => handleToggle('push_review_replies')}
                        loading={saving}
                    />
                </div>
            </div>

            {/* Info Section */}
            <div className="mt-8 p-4 bg-dark-50/50 rounded-xl border border-gray-700/30">
                <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-gray-700/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Bell className="w-4 h-4 text-gray-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-white mb-1">About Notifications</h3>
                        <p className="text-sm text-gray-500">
                            Notifications help you stay up to date with your anime. You'll receive alerts for new episodes 
                            of anime in your Watching or Plan to Watch lists, as well as replies to your reviews.
                        </p>
                    </div>
                </div>
            </div>

            {saving && (
                <div className="fixed bottom-6 right-6 flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg shadow-lg">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm font-medium">Saving...</span>
                </div>
            )}
        </div>
    );
};

export default NotificationPreferences;
