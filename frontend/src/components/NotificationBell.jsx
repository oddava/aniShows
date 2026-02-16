import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, CheckCheck, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { notificationApi } from '../api/client';
import { useAuth } from '../context/AuthContext';
import logger from '../utils/logger';

export const NotificationBell = () => {
    const { user } = useAuth();
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef(null);

    // Fetch unread count on mount and periodically
    useEffect(() => {
        if (!user) return;

        const fetchUnreadCount = async () => {
            try {
                const response = await notificationApi.getUnreadCount();
                setUnreadCount(response.data.count);
            } catch (error) {
                logger.error('Failed to fetch unread count:', error);
            }
        };

        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30000); // Check every 30 seconds

        return () => clearInterval(interval);
    }, [user]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchNotifications = async () => {
        setLoading(true);
        try {
            const response = await notificationApi.getAll({ is_read: false });
            setNotifications(response.data.results || []);
        } catch (error) {
            logger.error('Failed to fetch notifications:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleBellClick = () => {
        if (!isOpen) {
            fetchNotifications();
        }
        setIsOpen(!isOpen);
    };

    const handleMarkAsRead = async (notificationId, e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
            await notificationApi.markAsRead(notificationId);
            setNotifications(prev => prev.filter(n => n.id !== notificationId));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            logger.error('Failed to mark as read:', error);
        }
    };

    const handleMarkAllAsRead = async () => {
        try {
            await notificationApi.markAllAsRead();
            setNotifications([]);
            setUnreadCount(0);
        } catch (error) {
            logger.error('Failed to mark all as read:', error);
        }
    };

    const handleNotificationClick = async (notification) => {
        try {
            // Mark as read
            await notificationApi.markAsRead(notification.id);
            setNotifications(prev => prev.filter(n => n.id !== notification.id));
            setUnreadCount(prev => Math.max(0, prev - 1));
            setIsOpen(false);

            // Navigate to relevant page based on notification type
            if (notification.data?.anime_slug) {
                window.location.href = `/anime/${notification.data.anime_slug}`;
            } else if (notification.notification_type === 'new_follower' && notification.data?.follower_username) {
                window.location.href = `/profile/${notification.data.follower_username}`;
            }
        } catch (error) {
            logger.error('Failed to handle notification click:', error);
        }
    };

    if (!user) return null;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={handleBellClick}
                className="relative p-2.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                aria-label="Notifications"
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 py-2 bg-dark-100/95 backdrop-blur-xl 
                            rounded-xl border border-gray-700/50 shadow-xl shadow-black/20 animate-fade-in z-50">
                    <div className="px-4 py-3 border-b border-gray-700/50 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">Notifications</h3>
                        {notifications.length > 0 && (
                            <button
                                onClick={handleMarkAllAsRead}
                                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
                            >
                                <CheckCheck className="w-3.5 h-3.5" />
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-64 overflow-y-auto">
                        {loading ? (
                            <div className="py-8 text-center text-gray-400">
                                <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                                <p className="text-sm">Loading...</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="py-8 text-center text-gray-400">
                                <Bell className="w-10 h-10 mx-auto mb-3 text-gray-600" />
                                <p className="text-sm text-gray-300">No notifications yet</p>
                                <p className="text-xs mt-1 text-gray-500">You're all caught up!</p>
                            </div>
                        ) : (
                            notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    onClick={() => handleNotificationClick(notification)}
                                    className="flex items-start gap-3 px-4 py-3 hover:bg-dark-50 transition-colors cursor-pointer border-l-2 border-transparent hover:border-accent"
                                >
                                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-accent" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-white line-clamp-1">
                                            {notification.title}
                                        </p>
                                        <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">
                                            {notification.message}
                                        </p>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            {new Date(notification.created_at).toLocaleDateString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => handleMarkAsRead(notification.id, e)}
                                        className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="px-4 py-2 border-t border-gray-700/50">
                        <Link
                            to="/settings"
                            onClick={() => setIsOpen(false)}
                            className="flex items-center justify-center gap-2 text-sm text-accent hover:text-accent/80 transition-colors"
                        >
                            <Settings className="w-4 h-4" />
                            Manage notification settings
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
};
