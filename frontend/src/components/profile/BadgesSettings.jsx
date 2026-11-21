import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { badgeApi } from '../../api/client';
import { Award, Shield, Star, Zap, Crown, Check } from 'lucide-react';
import ErrorBoundary from '../ErrorBoundary';
import { useAuth } from '../../context/AuthContext';
import { formatDateInUserTimezone } from '../../utils/dateUtils';
import { badgeKeys, badgeQueries, userKeys } from '../../api/queries/user';
import { getApiErrorMessage } from '../../api/errors';

/** Server limit for featured badges (`badge_service.MAX_FEATURED_BADGES`). */
const MAX_FEATURED = 3;

/** Retired badges (`badge.is_active === false`) stay on the list but can't be featured. */
const isActiveBadge = (userBadge) => userBadge?.badge?.is_active !== false;

const ICON_MAP = {
    'award': Award,
    'shield': Shield,
    'star': Star,
    'zap': Zap,
    'crown': Crown,
};

const COLOR_MAP = {
    'blue': 'text-blue-400 bg-blue-500/20 border-blue-500/30',
    'green': 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30',
    'yellow': 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30',
    'purple': 'text-purple-400 bg-purple-500/20 border-purple-500/30',
    'amber': 'text-amber-400 bg-amber-500/20 border-amber-500/30',
    'red': 'text-red-400 bg-red-500/20 border-red-500/30',
};

export default function BadgesSettings() {
    const queryClient = useQueryClient();
    const { refreshProfile } = useAuth();
    const [selectedIds, setSelectedIds] = useState([]);

    const { data, isLoading } = useQuery({
        ...badgeQueries.mine(),
    });

    useEffect(() => {
        if (data?.data) {
            setSelectedIds(
                data.data
                    .filter(ub => ub.is_featured && isActiveBadge(ub))
                    .map(ub => ub.id)
            );
        }
    }, [data?.data]);

    const updateMutation = useMutation({
        mutationFn: (badgeIds) => badgeApi.updateFeatured(badgeIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: badgeKeys.mine });
            queryClient.invalidateQueries({ queryKey: userKeys.profileLegacy });
            // Refresh AuthContext user so featured badges are up-to-date across the app
            refreshProfile();
        }
    });

    const handleToggle = (id) => {
        let newIds = [];
        if (selectedIds.includes(id)) {
            newIds = selectedIds.filter(selectedId => selectedId !== id);
        } else {
            if (selectedIds.length < MAX_FEATURED) {
                newIds = [...selectedIds, id];
            } else {
                return; // Max 3
            }
        }
        updateMutation.reset();
        setSelectedIds(newIds);
    };

    const handleSave = () => {
        updateMutation.mutate(selectedIds);
    };

    if (isLoading) {
        return <div className="p-6 text-gray-400">Loading your badges...</div>;
    }

    const userBadges = data?.data || [];

    return (
        <ErrorBoundary>
            <div className="bg-dark-200 rounded-xl p-6 border border-dark-300">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Award className="w-5 h-5 text-accent" />
                            Featured Badges
                        </h2>
                        <p className="text-sm text-gray-400 mt-1">
                            Choose up to {MAX_FEATURED} badges to display on your public profile.
                            <span className="ml-2 font-medium text-accent">({selectedIds.length}/{MAX_FEATURED} selected)</span>
                        </p>
                    </div>
                    
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={updateMutation.isPending || userBadges.length === 0}
                        className="px-6 py-2 bg-accent-dark hover:bg-violet-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 shrink-0"
                    >
                        {updateMutation.isPending ? 'Saving...' : 'Save Badges'}
                    </button>
                </div>

                {updateMutation.isError && (
                    <div role="alert" className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                        {getApiErrorMessage(updateMutation.error, 'Failed to update featured badges. Please try again.')}
                    </div>
                )}

                {updateMutation.isSuccess && (
                    <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Featured badges updated successfully.
                    </div>
                )}
                
                {userBadges.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-dark-300 rounded-xl bg-dark-100/50">
                        <Award className="w-12 h-12 text-gray-500 mx-auto mb-4 opacity-50" />
                        <h3 className="text-lg font-medium text-gray-300 mb-2">No badges yet</h3>
                        <p className="text-sm text-gray-500">
                            Earn badges by participating in the community!
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {userBadges.map((userBadge) => {
                            const badge = userBadge.badge;
                            const isSelected = selectedIds.includes(userBadge.id);
                            const isRetired = !isActiveBadge(userBadge);
                            const isDisabled = !isSelected && (isRetired || selectedIds.length >= MAX_FEATURED);
                            const disabledReason = isRetired
                                ? "This badge is retired and can't be featured."
                                : isDisabled
                                    ? `You can feature up to ${MAX_FEATURED} badges.`
                                    : undefined;
                            
                            const Icon = ICON_MAP[badge.icon] || Award;
                            const colorClasses = COLOR_MAP[badge.color] || COLOR_MAP['blue'];
                            
                            return (
                                <div
                                    key={userBadge.id}
                                    role="checkbox"
                                    tabIndex={isDisabled ? -1 : 0}
                                    aria-checked={isSelected}
                                    aria-disabled={isDisabled || undefined}
                                    aria-label={`Feature ${badge.name}`}
                                    aria-describedby={isRetired ? `badge-retired-${userBadge.id}` : undefined}
                                    title={disabledReason}
                                    onClick={() => !isDisabled && handleToggle(userBadge.id)}
                                    onKeyDown={(e) => {
                                        if (e.key === ' ' || e.key === 'Enter') {
                                            e.preventDefault();
                                            if (!isDisabled) handleToggle(userBadge.id);
                                        }
                                    }}
                                    className={`
                                        relative p-4 rounded-xl border-2 transition-all cursor-pointer overflow-hidden group flex flex-col items-center text-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
                                        ${isSelected ? 'border-accent bg-dark-100' : 'border-dark-300 bg-dark-200'}
                                        ${isDisabled ? 'opacity-50 cursor-not-allowed grayscale-[50%]' : 'hover:border-accent/50'}
                                    `}
                                >
                                    {isSelected && (
                                        <div className="absolute top-2 right-2 w-6 h-6 bg-accent-dark rounded-full flex items-center justify-center shadow-lg transform scale-100 transition-transform">
                                            <Check className="w-4 h-4 text-white" />
                                        </div>
                                    )}
                                    
                                    <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${colorClasses}`}>
                                        {badge.image ? (
                                            <img src={badge.image} alt={badge.name} className="w-8 h-8 rounded-sm object-cover" />
                                        ) : (
                                            <Icon className="w-7 h-7" />
                                        )}
                                    </div>
                                    
                                    <div>
                                        <h3 className={`font-bold mb-1 ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                                            {badge.name}
                                        </h3>
                                        <p className="text-xs text-gray-400 line-clamp-2" title={badge.description}>
                                            {badge.description}
                                        </p>
                                        {isRetired && (
                                            <p id={`badge-retired-${userBadge.id}`} className="text-xs text-gray-500 mt-1">
                                                This badge is retired and can't be featured.
                                            </p>
                                        )}
                                    </div>
                                    
                                    <div className="text-xs text-gray-500 mt-auto font-medium pt-2 w-full ">
                                        Earned {formatDateInUserTimezone(userBadge.granted_at, { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </ErrorBoundary>
    );
}
