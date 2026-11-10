/** The tab bar at the top of the Settings page. */
export default function SettingsTabs({ user, activeTab, setActiveTab }) {
    return (
        <div className="flex gap-1 sm:gap-4 mb-8 border-b border-gray-800 overflow-x-auto scrollbar-hide whitespace-nowrap touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0">
            <button
                onClick={() => setActiveTab('profile')}
                className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                ${activeTab === 'profile' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
            >
                Profile
                <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                ${activeTab === 'profile' ? 'scale-x-100' : 'scale-x-0'}`} />
            </button>
            {user?.total_badges_count > 0 && (
                <button
                    onClick={() => setActiveTab('badges')}
                    className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                    ${activeTab === 'badges' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                >
                    Badges
                    <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                    ${activeTab === 'badges' ? 'scale-x-100' : 'scale-x-0'}`} />
                </button>
            )}
            <button
                onClick={() => setActiveTab('account')}
                className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                ${activeTab === 'account' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
            >
                Account
                <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                ${activeTab === 'account' ? 'scale-x-100' : 'scale-x-0'}`} />
            </button>
            <button
                onClick={() => setActiveTab('notifications')}
                className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                ${activeTab === 'notifications' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
            >
                Notifications
                <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent transition-transform duration-300 origin-left
                ${activeTab === 'notifications' ? 'scale-x-100' : 'scale-x-0'}`} />
            </button>
        </div>
    );
}
