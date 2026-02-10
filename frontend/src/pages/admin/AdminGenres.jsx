import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import BulkActions from './components/BulkActions';
import { toast } from 'react-hot-toast';

const AdminGenres = () => {
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGenre, setEditingGenre] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
  });

  const fetchGenres = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        ...(search && { search }),
      });

      const response = await api.get(`/admin/genres/?${params}`);
      setGenres(response.data.results);
      setTotalPages(Math.ceil(response.data.count / 20));
    } catch (err) {
      console.error('Failed to fetch genres:', err);
      toast.error('Failed to load genres');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchGenres();
  }, [fetchGenres]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchGenres();
  };

  const openCreateModal = () => {
    setEditingGenre(null);
    setFormData({ name: '', slug: '', description: '' });
    setIsModalOpen(true);
  };

  const openEditModal = (genre) => {
    setEditingGenre(genre);
    setFormData({
      name: genre.name,
      slug: genre.slug,
      description: genre.description || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingGenre(null);
    setFormData({ name: '', slug: '', description: '' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingGenre) {
        await api.put(`/admin/genres/${editingGenre.id}/`, formData);
        toast.success('Genre updated successfully');
      } else {
        await api.post('/admin/genres/', formData);
        toast.success('Genre created successfully');
      }
      closeModal();
      fetchGenres();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save genre');
    }
  };

  const handleDelete = async (genreId, genreName) => {
    if (!confirm(`Are you sure you want to delete "${genreName}"?`)) {
      return;
    }
    try {
      await api.delete(`/admin/genres/${genreId}/`);
      toast.success('Genre deleted successfully');
      fetchGenres();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete genre');
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedRows.length} genres?`)) {
      return;
    }
    try {
      await api.post('/admin/bulk/', {
        operation: 'delete',
        entity: 'genres',
        ids: selectedRows,
      });
      toast.success(`${selectedRows.length} genres deleted successfully`);
      setSelectedRows([]);
      fetchGenres();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete genres');
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
      key: 'slug',
      title: 'Slug',
      render: (item) => (
        <span className="text-white/60">{item.slug}</span>
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
      key: 'description',
      title: 'Description',
      render: (item) => (
        <span className="text-white/50 truncate max-w-xs block">
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
          <Link
            to={`/browse?genre=${item.slug}`}
            target="_blank"
            className="px-3 py-1.5 text-sm bg-white/10 text-white/80 rounded-lg hover:bg-white/20 transition-colors"
          >
            View
          </Link>
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
        <h1 className="text-2xl font-bold text-white">Genre Management</h1>
        <button
          onClick={openCreateModal}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2"
        >
          <span>+</span> Add Genre
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search genres..."
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

      {/* Bulk Actions */}
      <BulkActions
        selectedCount={selectedRows.length}
        actions={bulkActions}
        onClearSelection={() => setSelectedRows([])}
      />

      {/* Data Table */}
      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <DataTable
          columns={columns}
          data={genres}
          loading={loading}
          selectable={true}
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          emptyMessage="No genres found"
        />

        {/* Pagination */}
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

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingGenre ? 'Edit Genre' : 'Create Genre'}
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
              placeholder="e.g., Action"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Slug</label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
              placeholder="auto-generated if empty"
            />
            <p className="text-xs text-white/40 mt-1">URL-friendly identifier (auto-generated from name if empty)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500 resize-none"
              placeholder="Genre description..."
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
              {editingGenre ? 'Update Genre' : 'Create Genre'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default AdminGenres;
