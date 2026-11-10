import CustomSelect from '../../../../components/common/CustomSelect';
import { AVAILABLE_COLORS, AVAILABLE_ICONS } from './badgeOptions';

/** The create/edit badge modal. */
export default function BadgeFormModal({
    editingBadge,
    formError,
    setFormError,
    setIsModalOpen,
    handleSave,
    createMutation,
    updateMutation,
}) {
    return (
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
    );
}
