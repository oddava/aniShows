import React, { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminBadgeApi } from '../../api/client';
import api from '../../api/client';
import { Search, Plus, Edit2, Trash2, Award, UserPlus, UserMinus, Shield, Star, Zap, Crown, Users, ChevronLeft, ChevronRight } from 'lucide-react';
import ErrorBoundary from '../../components/ErrorBoundary';
import CustomSelect from '../../components/common/CustomSelect';

const AVAILABLE_ICONS = [
    { name: 'award', icon: Award },
    { name: 'shield', icon: Shield },
    { name: 'star', icon: Star },
    { name: 'zap', icon: Zap },
    { name: 'crown', icon: Crown },
];

const AVAILABLE_COLORS = [
    { value: 'blue', label: 'Blue', class: 'text-blue-400 bg-blue-500/20 border-blue-500/30' },
    { value: 'green', label: 'Green', class: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30' },
    { value: 'yellow', label: 'Yellow', class: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30' },
    { value: 'purple', label: 'Purple', class: 'text-purple-400 bg-purple-500/20 border-purple-500/30' },
    { value: 'amber', label: 'Amber', class: 'text-amber-400 bg-amber-500/20 border-amber-500/30' },
    { value: 'red', label: 'Red', class: 'text-red-400 bg-red-500/20 border-red-500/30' },
];

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
        queryKey: ['adminBadges', page, searchTerm],
        queryFn: () => adminBadgeApi.getAll({ page, search: searchTerm }),
        placeholderData: keepPreviousData,
    });

    const { data: usersData } = useQuery({
        queryKey: ['adminUsersSearch', searchUserTerm],
        queryFn: () => api.get('/admin/users/', { params: { search: searchUserTerm, page_size: 5 } }),
        enabled: searchUserTerm.length >= 2,
    });

    const [formError, setFormError] = useState(null);

    const createMutation = useMutation({
        mutationFn: (formData) => adminBadgeApi.create(formData),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['adminBadges'] });
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
            queryClient.invalidateQueries({ queryKey: ['adminBadges'] });
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
            queryClient.invalidateQueries({ queryKey: ['adminBadges'] });
        },
        onError: (error) => {
            alert(error.response?.data?.detail || 'Failed to delete badge');
        }
    });

    const grantMutation = useMutation({
        mutationFn: ({ id, userIds, reason }) => adminBadgeApi.grant(id, userIds, reason),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['adminBadges'] });
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
        queryKey: ['adminBadgeHolders', selectedBadge?.id, holdersPage],
        queryFn: () => adminBadgeApi.getHolders(selectedBadge.id, { page: holdersPage }),
        enabled: isHoldersModalOpen && !!selectedBadge,
        placeholderData: keepPreviousData,
    });

    const revokeMutation = useMutation({
        mutationFn: ({ badgeId, userIds }) => adminBadgeApi.revoke(badgeId, userIds),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['adminBadges'] });
            queryClient.invalidateQueries({ queryKey: ['adminBadgeHolders', selectedBadge?.id] });
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
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="w-full max-w-lg bg-dark-200 border border-dark-300 rounded-xl shadow-2xl overflow-hidden">
                            <div className="flex items-center justify-between p-6 border-b border-dark-300">
                                <h2 className="text-xl font-bold text-white">
                                    {editingBadge ? 'Edit Badge' : 'Create Badge'}
                                </h2>
                                <button
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setFormError(null);
                                    }}
                                    className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                            
                            <form onSubmit={handleSave} className="p-6 space-y-4">
                                {formError && (
                                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                                        {formError}
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Name *</label>
                                    <input
                                        name="name"
                                        type="text"
                                        required
                                        defaultValue={editingBadge?.name}
                                        className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                                    />
                                </div>
                                
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Description *</label>
                                    <textarea
                                        name="description"
                                        required
                                        rows={3}
                                        defaultValue={editingBadge?.description}
                                        className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none resize-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-1">Icon</label>
                                        <CustomSelect
                                            name="icon"
                                            defaultValue={editingBadge?.icon || 'award'}
                                            options={AVAILABLE_ICONS.map((item) => ({
                                                value: item.name,
                                                label: item.name,
                                            }))}
                                            triggerClassName="w-full bg-dark-100 border-dark-300 rounded-lg px-4 py-2"
                                            ariaLabel="Badge icon"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-1">Color Scheme</label>
                                        <CustomSelect
                                            name="color"
                                            defaultValue={editingBadge?.color || 'blue'}
                                            options={AVAILABLE_COLORS.map((item) => ({
                                                value: item.value,
                                                label: item.label,
                                            }))}
                                            triggerClassName="w-full bg-dark-100 border-dark-300 rounded-lg px-4 py-2"
                                            ariaLabel="Badge color scheme"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Custom Image (Optional)</label>
                                    <input
                                        name="image"
                                        type="file"
                                        accept="image/*"
                                        className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-dark-300 file:text-white hover:file:bg-dark-100 cursor-pointer"
                                    />
                                    <p className="mt-1 text-xs text-gray-500">Overrides the Lucide icon if provided.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Priority (Higher = shows first)</label>
                                    <input
                                        name="priority"
                                        type="number"
                                        defaultValue={editingBadge?.priority || 0}
                                        className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                                    />
                                </div>

                                {editingBadge && (
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            id="is_active"
                                            name="is_active"
                                            defaultChecked={editingBadge?.is_active !== false}
                                            className="w-4 h-4 rounded border-dark-300 bg-dark-100 text-accent focus:ring-accent"
                                        />
                                        <label htmlFor="is_active" className="text-sm text-gray-300 cursor-pointer">
                                            Active (can be granted to new users)
                                        </label>
                                    </div>
                                )}

                                <div className="pt-4 flex justify-end gap-3 border-t border-dark-300">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsModalOpen(false);
                                            setFormError(null);
                                        }}
                                        className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={createMutation.isPending || updateMutation.isPending}
                                        className="px-6 py-2 bg-accent hover:bg-accent-dark text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        {editingBadge ? 'Update Badge' : 'Create Badge'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Grant Modal */}
                {isGrantModalOpen && selectedBadge && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="w-full max-w-lg bg-dark-200 border border-dark-300 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between p-6 border-b border-dark-300 shrink-0">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <UserPlus className="w-5 h-5 text-accent" />
                                    Grant: {selectedBadge.name}
                                </h2>
                                <button
                                    onClick={() => {
                                        setIsGrantModalOpen(false);
                                        setSelectedUsers([]);
                                    }}
                                    className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                            
                            <form onSubmit={handleGrant} className="p-6 space-y-4 overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Search Users</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Type username..."
                                            value={searchUserTerm}
                                            onChange={(e) => setSearchUserTerm(e.target.value)}
                                            className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                                        />
                                        
                                        {searchUserTerm.length >= 2 && usersData?.data?.results && (
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-dark-100 border border-dark-300 rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                                                {usersData.data.results.map(u => (
                                                    <button
                                                        key={u.id}
                                                        type="button"
                                                        onClick={() => {
                                                            if (!selectedUsers.find(su => su.id === u.id)) {
                                                                setSelectedUsers([...selectedUsers, u]);
                                                            }
                                                            setSearchUserTerm('');
                                                        }}
                                                        className="w-full text-left px-4 py-2 hover:bg-dark-300 text-white flex items-center gap-2"
                                                    >
                                                        {u.avatar ? (
                                                            <img src={u.avatar} className="w-6 h-6 rounded-full object-cover" />
                                                        ) : (
                                                            <div className="w-6 h-6 rounded-full bg-dark-300 flex items-center justify-center">
                                                                <span className="text-xs">{u.username[0].toUpperCase()}</span>
                                                            </div>
                                                        )}
                                                        {u.username}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                {selectedUsers.length > 0 && (
                                    <div className="bg-dark-100 rounded-lg p-3 border border-dark-300">
                                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Selected Users ({selectedUsers.length})</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedUsers.map(u => (
                                                <div key={u.id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-dark-300 rounded-md text-sm text-white">
                                                    <span>{u.username}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedUsers(selectedUsers.filter(su => su.id !== u.id))}
                                                        className="text-gray-400 hover:text-red-400"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-gray-300 mb-1">Reason (Optional)</label>
                                    <input
                                        type="text"
                                        value={grantReason}
                                        onChange={(e) => setGrantReason(e.target.value)}
                                        placeholder="e.g. 'Site contributor'"
                                        className="w-full bg-dark-100 border border-dark-300 rounded-lg px-4 py-2 text-white focus:border-accent outline-none"
                                    />
                                </div>

                                <div className="pt-4 flex justify-end gap-3 border-t border-dark-300">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsGrantModalOpen(false);
                                            setSelectedUsers([]);
                                        }}
                                        className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={selectedUsers.length === 0 || grantMutation.isPending}
                                        className="px-6 py-2 bg-accent hover:bg-accent-dark text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        Grant to {selectedUsers.length} User(s)
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* Holders Modal */}
                {isHoldersModalOpen && selectedBadge && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <div className="w-full max-w-2xl bg-dark-200 border border-dark-300 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between p-6 border-b border-dark-300 shrink-0">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Users className="w-5 h-5 text-accent" />
                                    Holders: {selectedBadge.name}
                                </h2>
                                <button
                                    onClick={() => {
                                        setIsHoldersModalOpen(false);
                                        setSelectedBadge(null);
                                        setRevokingUserIds(new Set());
                                    }}
                                    className="p-2 text-gray-400 hover:text-white rounded-lg transition-colors"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6">
                                {holdersLoading ? (
                                    <div className="text-center text-gray-400 py-8">Loading holders...</div>
                                ) : !holdersData?.data?.results?.length ? (
                                    <div className="text-center text-gray-400 py-8">No one holds this badge yet.</div>
                                ) : (
                                    <div className="space-y-2">
                                        {holdersData.data.results.map((holder) => (
                                            <div
                                                key={holder.id}
                                                className="flex items-center gap-3 p-3 bg-dark-100 border border-dark-300 rounded-lg group"
                                            >
                                                {holder.user.avatar ? (
                                                    <img
                                                        src={holder.user.avatar}
                                                        alt={holder.user.username}
                                                        className="w-9 h-9 rounded-full object-cover shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-full bg-dark-300 flex items-center justify-center shrink-0">
                                                        <span className="text-sm text-gray-300">
                                                            {holder.user.username[0].toUpperCase()}
                                                        </span>
                                                    </div>
                                                )}

                                                <div className="flex-1 min-w-0">
                                                    <div className="text-white font-medium truncate">
                                                        {holder.user.username}
                                                    </div>
                                                    <div className="text-xs text-gray-400 flex items-center gap-2 flex-wrap">
                                                        <span>
                                                            Granted {new Date(holder.granted_at).toLocaleDateString()}
                                                        </span>
                                                        {holder.granted_by && (
                                                            <span>by {holder.granted_by.username}</span>
                                                        )}
                                                        {holder.reason && (
                                                            <span className="text-gray-500">— {holder.reason}</span>
                                                        )}
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => {
                                                        if (window.confirm(`Revoke "${selectedBadge.name}" from ${holder.user.username}?`)) {
                                                            setRevokingUserIds(prev => new Set([...prev, holder.user.id]));
                                                            revokeMutation.mutate({
                                                                badgeId: selectedBadge.id,
                                                                userIds: [holder.user.id],
                                                            });
                                                        }
                                                    }}
                                                    disabled={revokingUserIds.has(holder.user.id) || revokeMutation.isPending}
                                                    className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50 shrink-0"
                                                    title={`Revoke from ${holder.user.username}`}
                                                >
                                                    <UserMinus className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Pagination */}
                            {holdersData?.data && (holdersData.data.next || holdersData.data.previous) && (
                                <div className="flex items-center justify-between p-4 border-t border-dark-300 shrink-0">
                                    <button
                                        onClick={() => setHoldersPage(p => Math.max(1, p - 1))}
                                        disabled={!holdersData.data.previous}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                        Previous
                                    </button>
                                    <span className="text-sm text-gray-400">
                                        Page {holdersPage} — {holdersData.data.count} holder{holdersData.data.count !== 1 ? 's' : ''} total
                                    </span>
                                    <button
                                        onClick={() => setHoldersPage(p => p + 1)}
                                        disabled={!holdersData.data.next}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Next
                                        <ChevronRight className="w-4 h-4" />
                                    </button>
                                </div>
                            )}

                            {revokeMutation.isError && (
                                <div className="px-6 pb-4">
                                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
                                        Failed to revoke badge. Please try again.
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </ErrorBoundary>
        </div>
    );
}
