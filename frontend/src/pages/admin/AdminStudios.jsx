import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import BulkActions from './components/BulkActions';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';

const AdminStudios = () => {
  const [studios, setStudios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudio, setEditingStudio] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    founded_date: '',
    website: '',
  });

  const fetchStudios = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        ...(search && { search }),
      });

      const response = await api.get(`/admin/studios/?${params}`);
      setStudios(response.data.results);
      setTotalPages(Math.ceil(response.data.count / 20));
    } catch (err) {
      logger.error('Failed to fetch studios:', err);
      toast.error('Failed to load studios');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchStudios();
  }, [fetchStudios]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchStudios();
  };

  const openCreateModal = () => {
    setEditingStudio(null);
    setFormData({ name: '', founded_date: '', website: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (studio) => {
    setEditingStudio(studio);
    setFormData({
      name: studio.name,
      founded_date: studio.founded_date || '',
      website: studio.website || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingStudio(null);
    setFormData({ name: '', founded_date: '', website: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingStudio) {
        await api.put(`/admin/studios/${editingStudio.id}/`, formData);
        toast.success('Studio updated successfully');
      } else {
        await api.post('/admin/studios/', formData);
        toast.success('Studio created successfully');
      }
      closeModal();
      fetchStudios();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save studio');
    }
  };

  const handleDelete = async (studioId, studioName) => {
    if (!confirm(`Are you sure you want to delete "${studioName}"?`)) {
      return;
    }
    try {
      await api.delete(`/admin/studios/${studioId}/`);
      toast.success('Studio deleted successfully');
      fetchStudios();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete studio');
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedRows.length} studios?`)) {
      return;
    }
    try {
      await api.post('/admin/bulk/', {
        operation: 'delete',
        entity: 'studios',
        ids: selectedRows,
      });
      toast.success(`${selectedRows.length} studios deleted successfully`);
      setSelectedRows([]);
      fetchStudios();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete studios');
    }
  };

  const columns = [
    {
      key: 'name',
      title: 'Name',
      render: (item) => (
        <div className="font-medium text-white">{item.name}</div>
      ),
    },
    {
      key: 'founded_date',
      title: 'Founded',
      render: (item) => (
        <span className="text-white/60">
          {item.founded_date ? new Date(item.founded_date).getFullYear() : 'N/A'}
        </span>
      ),
    },
    {
      key: 'website',
      title: 'Website',
      render: (item) => (
        item.website ? (
          <a
            href={item.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:text-violet-300"
            onClick={(e) => e.stopPropagation()}
          >
            Visit
          </a>
        ) : (
          <span className="text-white/30">No website</span>
        )
      ),
    },
    {
      key: 'anime_count',
      title: 'Anime Count',
      render: (item) => (
        <span className="text-violet-400 font-medium">{item.anime_count}</span>
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
            onClick={() => handleDelete(item.id, item.name)}
            className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const bulkActions = [
    {
      label: 'Delete Selected',
      icon: '🗑️',
      variant: 'danger',
      onClick: handleBulkDelete,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Studio Management</h1>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
        >
          <span>+</span> Add Studio
        </button>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search studios..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      <BulkActions
        selectedCount={selectedRows.length}
        actions={bulkActions}
        onClearSelection={() => setSelectedRows([])}
      />

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <DataTable
          columns={columns}
          data={studios}
          loading={loading}
          selectable={true}
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          emptyMessage="No studios found"
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
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ← Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
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
        title={editingStudio ? 'Edit Studio' : 'Create Studio'}
        size="medium"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
              placeholder="e.g., Kyoto Animation"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Founded Date</label>
            <input
              type="date"
              value={formData.founded_date}
              onChange={(e) => setFormData({ ...formData, founded_date: e.target.value })}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Website</label>
            <input
              type="url"
              value={formData.website}
              onChange={(e) => setFormData({ ...formData, website: e.target.value })}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
              placeholder="https://..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
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
              {editingStudio ? 'Update Studio' : 'Create Studio'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default AdminStudios;
