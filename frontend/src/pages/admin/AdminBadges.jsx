import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminBadgeApi } from '../../api/client';
import { Search, Plus, Edit2, Trash2, UserPlus } from 'lucide-react';
import ErrorBoundary from '../../components/ErrorBoundary';
import { adminBadgeKeys, adminBadgeQueries } from '../../api/queries/admin';
import { AVAILABLE_COLORS, AVAILABLE_ICONS } from './components/badges/badgeOptions';
import BadgeFormModal from './components/badges/BadgeFormModal';
import BadgeGrantModal from './components/badges/BadgeGrantModal';
import BadgeHoldersModal from './components/badges/BadgeHoldersModal';

export default function AdminBadges() {
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState('');
    const [page] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isGrantModalOpen, setIsGrantModalOpen] = useState(false);
    const [editingBadge, setEditingBadge] = useState(null);
    const [selectedBadge, setSelectedBadge] = useState(null);
    const [searchUserTerm, setSearchUserTerm] = useState('');
    const [selectedUsers, setSelectedUsers] = useState([]);
    const [grantReason, setGrantReason] = useState('');
    const [isHoldersModalOpen, setIsHoldersModalOpen] = useState(false);
    const [holdersPage, setHoldersPage] = useState(1);
    const [revokingUserIds, setRevokingUserIds] = useState(new Set());

    const { data, isLoading } = useQuery({
        ...adminBadgeQueries.list(page, searchTerm),
        placeholderData: keepPreviousData,
    });

    const { data: usersData } = useQuery({
        ...adminBadgeQueries.userSearch(searchUserTerm),
        enabled: searchUserTerm.length >= 2,
    });

    const [formError, setFormError] = useState(null);

    const createMutation = useMutation({
        mutationFn: (formData) => adminBadgeApi.create(formData),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminBadgeKeys.all });
            setIsModalOpen(false);
            setEditingBadge(null);
            setFormError(null);
        },
        onError: (error) => {
            setFormError(error.response?.data?.detail || error.message || 'Failed to create badge');
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, formData }) => adminBadgeApi.update(id, formData),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminBadgeKeys.all });
            setIsModalOpen(false);
            setEditingBadge(null);
        },
        onError: (error) => {
            setFormError(error.response?.data?.detail || error.message || 'Failed to update badge');
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => adminBadgeApi.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminBadgeKeys.all });
        },
        onError: (error) => {
            alert(error.response?.data?.detail || 'Failed to delete badge');
        }
    });

    const grantMutation = useMutation({
        mutationFn: ({ id, userIds, reason }) => adminBadgeApi.grant(id, userIds, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminBadgeKeys.all });
            setIsGrantModalOpen(false);
            setSelectedUsers([]);
            setGrantReason('');
            setSelectedBadge(null);
        },
        onError: (error) => {
            alert(error.response?.data?.detail || 'Failed to grant badge');
        }
    });

    const { data: holdersData, isLoading: holdersLoading } = useQuery({
        ...adminBadgeQueries.holders(selectedBadge?.id, holdersPage),
        enabled: isHoldersModalOpen && !!selectedBadge,
        placeholderData: keepPreviousData,
    });

    const revokeMutation = useMutation({
        mutationFn: ({ badgeId, userIds }) => adminBadgeApi.revoke(badgeId, userIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: adminBadgeKeys.all });
            queryClient.invalidateQueries({ queryKey: adminBadgeKeys.holdersAll(selectedBadge?.id) });
        },
        // On failure too, or the holder's button stays disabled.
        onSettled: () => {
            setRevokingUserIds(new Set());
        }
    });

    const handleSave = (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        
        // Remove empty file fields to avoid issues with Django
        if (!formData.get('image') || formData.get('image').size === 0) {
            formData.delete('image');
        }

        // Explicitly handle is_active checkbox (unchecked checkboxes are not included in FormData)
        if (editingBadge) {
            const isActive = document.getElementById('is_active')?.checked ?? true;
            formData.set('is_active', isActive);
        }
        
        if (editingBadge) {
            updateMutation.mutate({ id: editingBadge.id, formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const handleGrant = (e) => {
        e.preventDefault();
        if (selectedUsers.length === 0) return;
        
        grantMutation.mutate({
            id: selectedBadge.id,
            userIds: selectedUsers.map(u => u.id),
            reason: grantReason
        });
    };

    const renderIcon = (badge) => {
        if (badge.image) {
            return <img src={badge.image} alt={badge.name} className="w-5 h-5 rounded-sm object-cover" />;
        }
        const iconDef = AVAILABLE_ICONS.find(i => i.name === badge.icon) || AVAILABLE_ICONS[0];
        const Icon = iconDef.icon;
        return <Icon className="w-4 h-4" />;
    };

    return (
        <div className="space-y-6">
            <ErrorBoundary>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h1 className="text-2xl font-bold text-white">Badges Management</h1>
                    
                    <div className="flex items-center gap-4 w-full sm:w-auto">
                        <div className="relative flex-1 sm:w-64">
                            <input
                                type="text"
                                placeholder="Search badges..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-dark-200 border border-dark-300 rounded-lg pl-10 pr-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                            />
                            <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-500" />
                        </div>
                        
                        <button
                            onClick={() => {
                                setEditingBadge(null);
                                setIsModalOpen(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg transition-colors shrink-0"
                        >
                            <Plus className="w-5 h-5" />
                            <span className="hidden sm:inline">Create Badge</span>
                        </button>
                    </div>
                </div>

                <div className="bg-dark-200 border border-dark-300 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-dark-300/50 border-b border-dark-300">
                                    <th className="px-6 py-4 text-sm font-semibold text-gray-300">Preview</th>
                                    <th className="px-6 py-4 text-sm font-semibold text-gray-300">Name & Desc</th>
                                    <th className="px-6 py-4 text-sm font-semibold text-gray-300 text-center">Priority</th>
                                    <th className="px-6 py-4 text-sm font-semibold text-gray-300 text-center">Holders</th>
                                    <th className="px-6 py-4 text-sm font-semibold text-gray-300 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-dark-300">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-8 text-center text-gray-400">Loading...</td>
                                    </tr>
                                ) : data?.data?.results?.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-8 text-center text-gray-400">No badges found</td>
                                    </tr>
                                ) : (
                                    data?.data?.results?.map((badge) => {
                                        const colorDef = AVAILABLE_COLORS.find(c => c.value === badge.color) || AVAILABLE_COLORS[0];
                                        return (
                                            <tr key={badge.id} className="hover:bg-dark-300/20 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border ${colorDef.class}`}>
                                                        {renderIcon(badge)}
                                                        <span>{badge.name}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="text-white font-medium">{badge.name}</div>
                                                    <div className="text-sm text-gray-400 truncate max-w-xs" title={badge.description}>
                                                        {badge.description}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className="inline-flex items-center justify-center min-w-[2rem] h-8 rounded bg-dark-300 text-gray-300 text-sm font-medium">
                                                        {badge.priority}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedBadge(badge);
                                                            setHoldersPage(1);
                                                            setRevokingUserIds(new Set());
                                                            setIsHoldersModalOpen(true);
                                                        }}
                                                        className="text-white font-semibold hover:text-accent transition-colors underline decoration-dotted underline-offset-4"
                                                        title="View holders"
                                                    >
                                                        {badge.holders_count?.toLocaleString() || 0}
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => {
                                                                setSelectedBadge(badge);
                                                                setIsGrantModalOpen(true);
                                                            }}
                                                            className="p-2 text-green-400 hover:bg-green-400/10 rounded transition-colors"
                                                            title="Grant Badge"
                                                        >
                                                            <UserPlus className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setEditingBadge(badge);
                                                                setIsModalOpen(true);
                                                            }}
                                                            className="p-2 text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                                                            title="Edit Badge"
                                                        >
                                                            <Edit2 className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (window.confirm('Are you sure you want to delete this badge? This will remove it from all users.')) {
                                                                    deleteMutation.mutate(badge.id);
                                                                }
                                                            }}
                                                            className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                                                            title="Delete Badge"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Create/Edit Modal */}
                {isModalOpen && (
                    <BadgeFormModal
                        editingBadge={editingBadge}
                        formError={formError}
                        setFormError={setFormError}
                        setIsModalOpen={setIsModalOpen}
                        handleSave={handleSave}
                        createMutation={createMutation}
                        updateMutation={updateMutation}
                    />
                )}

                {/* Grant Modal */}
                {isGrantModalOpen && selectedBadge && (
                    <BadgeGrantModal
                        selectedBadge={selectedBadge}
                        handleGrant={handleGrant}
                        setIsGrantModalOpen={setIsGrantModalOpen}
                        searchUserTerm={searchUserTerm}
                        setSearchUserTerm={setSearchUserTerm}
                        usersData={usersData}
                        selectedUsers={selectedUsers}
                        setSelectedUsers={setSelectedUsers}
                        grantReason={grantReason}
                        setGrantReason={setGrantReason}
                        grantMutation={grantMutation}
                    />
                )}

                {/* Holders Modal */}
                {isHoldersModalOpen && selectedBadge && (
                    <BadgeHoldersModal
                        selectedBadge={selectedBadge}
                        setSelectedBadge={setSelectedBadge}
                        setIsHoldersModalOpen={setIsHoldersModalOpen}
                        holdersData={holdersData}
                        holdersLoading={holdersLoading}
                        holdersPage={holdersPage}
                        setHoldersPage={setHoldersPage}
                        revokingUserIds={revokingUserIds}
                        setRevokingUserIds={setRevokingUserIds}
                        revokeMutation={revokeMutation}
                    />
                )}
            </ErrorBoundary>
        </div>
    );
}
