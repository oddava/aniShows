import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import BulkActions from './components/BulkActions';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';

const DEFAULT_FORM = {
  name: '',
  name_native: '',
  description: '',
  anilist_id: '',
  image_url: '',
};

const AdminStaff = () => {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [formData, setFormData] = useState(DEFAULT_FORM);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        ...(search && { search }),
      });
      const response = await api.get(`/admin/staff/?${params}`);
      setStaffList(response.data.results || []);
      setTotalPages(Math.ceil((response.data.count || 0) / 20) || 1);
    } catch (err) {
      logger.error('Failed to fetch staff:', err);
      toast.error('Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const handleSearch = (event) => {
    event.preventDefault();
    setPage(1);
    fetchStaff();
  };

  const openCreateModal = () => {
    setEditingStaff(null);
    setFormData(DEFAULT_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (staff) => {
    setEditingStaff(staff);
    setFormData({
      name: staff.name || '',
      name_native: staff.name_native || '',
      description: staff.description || '',
      anilist_id: staff.anilist_id || '',
      image_url: staff.image_url || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingStaff(null);
    setFormData(DEFAULT_FORM);
  };

  const saveStaff = async (event) => {
    event.preventDefault();
    const payload = {
      ...formData,
      anilist_id: formData.anilist_id ? Number(formData.anilist_id) : null,
    };

    try {
      if (editingStaff) {
        await api.put(`/admin/staff/${editingStaff.id}/`, payload);
        toast.success('Staff updated');
      } else {
        await api.post('/admin/staff/', payload);
        toast.success('Staff created');
      }
      closeModal();
      fetchStaff();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save staff');
    }
  };

  const deleteStaff = async (id) => {
    if (!confirm('Delete this staff record?')) return;
    try {
      await api.delete(`/admin/staff/${id}/`);
      toast.success('Staff deleted');
      fetchStaff();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete staff');
    }
  };

  const bulkDeleteStaff = async () => {
    if (!selectedRows.length) return;
    if (!confirm(`Delete ${selectedRows.length} staff records?`)) return;
    try {
      await api.post('/admin/bulk/', {
        operation: 'delete',
        entity: 'staff',
        ids: selectedRows,
      });
      toast.success('Selected staff deleted');
      setSelectedRows([]);
      fetchStaff();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete selected staff');
    }
  };

  const columns = [
    {
      key: 'name',
      title: 'Staff Member',
      render: (item) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-14 rounded bg-white/10 overflow-hidden flex-shrink-0">
            {item.image ? (
              <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">N/A</div>
            )}
          </div>
          <div>
            <div className="font-medium text-white">{item.name}</div>
            <div className="text-xs text-white/50">{item.name_native || 'No native name'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'anilist_id',
      title: 'AniList ID',
      render: (item) => <span className="text-white/70">{item.anilist_id || '-'}</span>,
    },
    {
      key: 'anime_count',
      title: 'Credits',
      render: (item) => <span className="text-violet-400 font-medium">{item.anime_count || 0}</span>,
    },
    {
      key: 'description',
      title: 'Description',
      render: (item) => (
        <span className="text-white/60 text-sm line-clamp-2 max-w-md">
          {item.description || 'No description'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      sortable: false,
      render: (item) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEditModal(item)}
            className="px-3 py-1.5 text-sm bg-violet-500/20 text-violet-400 rounded-lg hover:bg-violet-500/30 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => deleteStaff(item.id)}
            className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Staff Management</h1>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
        >
          + Add Staff
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <form onSubmit={handleSearch} className="flex gap-3">
          <input
            type="text"
            placeholder="Search staff..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      <BulkActions
        selectedCount={selectedRows.length}
        actions={[
          {
            label: 'Delete Selected',
            icon: '🗑️',
            variant: 'danger',
            onClick: bulkDeleteStaff,
          },
        ]}
        onClearSelection={() => setSelectedRows([])}
      />

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <DataTable
          columns={columns}
          data={staffList}
          loading={loading}
          selectable
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          emptyMessage="No staff records found"
        />

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
            <span className="text-sm text-white/50">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50"
              >
                ← Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingStaff ? 'Edit Staff' : 'Add Staff'}
      >
        <form onSubmit={saveStaff} className="space-y-4">
          <input
            type="text"
            placeholder="Staff Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
            required
          />
          <input
            type="text"
            placeholder="Native Name"
            value={formData.name_native}
            onChange={(e) => setFormData({ ...formData, name_native: e.target.value })}
            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          />
          <input
            type="number"
            placeholder="AniList ID"
            value={formData.anilist_id}
            onChange={(e) => setFormData({ ...formData, anilist_id: e.target.value })}
            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          />
          <input
            type="url"
            placeholder="Image URL"
            value={formData.image_url}
            onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          />
          <textarea
            placeholder="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={4}
            className="w-full px-4 py-2.5 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 resize-none"
          />
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
            >
              {editingStaff ? 'Update Staff' : 'Create Staff'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default AdminStaff;
