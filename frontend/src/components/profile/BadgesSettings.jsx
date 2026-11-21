import { useState, useEffect } from 'react';
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
        return <div className="panel text-sm text-[var(--text-2)]">Loading your badges...</div>;
    }

    const userBadges = data?.data || [];

    return (
        <ErrorBoundary>
            <section className="panel">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h2 className="section-title">Featured badges</h2>
                        <p className="text-sm text-[var(--text-2)] mt-1">
                            Choose up to {MAX_FEATURED} to show on your profile.
                            <span className="ml-2 text-[var(--text-3)] tabular">({selectedIds.length}/{MAX_FEATURED} selected)</span>
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={updateMutation.isPending || userBadges.length === 0}
                        className="btn-primary shrink-0"
                    >
                        {updateMutation.isPending ? 'Saving...' : 'Save badges'}
                    </button>
                </div>

                {updateMutation.isError && (
                    <p role="alert" className="mb-6 text-sm text-[var(--danger)]">
                        {getApiErrorMessage(updateMutation.error, 'Failed to update featured badges. Please try again.')}
                    </p>
                )}

                {updateMutation.isSuccess && (
                    <p role="status" className="mb-6 text-sm text-[var(--text-2)]">
                        Featured badges saved.
                    </p>
                )}

                {userBadges.length === 0 ? (
                    <p className="text-sm text-[var(--text-2)]">
                        No badges yet. You earn them by taking part in the community.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

                            // Selectable rows on a soft fill; the selected one is a
                            // shade lighter with a check (no borders or rings).
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
                                    className={`relative flex items-start gap-3 rounded-[var(--radius-md)] p-3 pr-10 transition-colors duration-150
                                        ${isSelected ? 'bg-white/[0.08]' : 'bg-white/[0.03]'}
                                        ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/[0.06]'}`}
                                >
                                    {isSelected && (
                                        <Check aria-hidden="true" className="absolute top-3 right-3 h-4 w-4 text-[var(--signature)]" />
                                    )}

                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--text-2)]">
                                        {badge.image ? (
                                            <img src={badge.image} alt="" className="h-8 w-8 rounded-sm object-cover" />
                                        ) : (
                                            <Icon aria-hidden="true" className="h-6 w-6" />
                                        )}
                                    </div>

                                    <div className="min-w-0">
                                        <h3 className="text-[15px] font-medium text-[var(--text-1)]">
                                            {badge.name}
                                        </h3>
                                        <p className="text-sm text-[var(--text-2)] line-clamp-2" title={badge.description}>
                                            {badge.description}
                                        </p>
                                        {isRetired && (
                                            <p id={`badge-retired-${userBadge.id}`} className="text-sm text-[var(--text-3)] mt-1">
                                                This badge is retired and can't be featured.
                                            </p>
                                        )}
                                        <p className="text-sm text-[var(--text-3)] mt-1">
                                            Earned {formatDateInUserTimezone(userBadge.granted_at, { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </ErrorBoundary>
    );
}
