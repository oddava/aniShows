import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from './components/DataTable';
import BulkActions from './components/BulkActions';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';

const AdminUserLists = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState([]);
  const [filters, setFilters] = useState({
    user: '',
    anime: '',
    status: '',
  });

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        ...(filters.user && { user: filters.user }),
        ...(filters.anime && { anime: filters.anime }),
        ...(filters.status && { status: filters.status }),
      });

      const response = await api.get(`/admin/user-lists/?${params}`);
      setEntries(response.data.results);
      setTotalPages(Math.ceil(response.data.count / 20));
    } catch (err) {
      logger.error('Failed to fetch entries:', err);
      toast.error('Failed to load list entries');
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleDelete = async (entryId) => {
    if (!confirm('Are you sure you want to delete this list entry?')) {
      return;
    }
    try {
      await api.delete(`/admin/user-lists/${entryId}/`);
      toast.success('List entry deleted successfully');
      fetchEntries();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete entry');
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedRows.length} list entries?`)) {
      return;
    }
    try {
      await api.post('/admin/user-lists/bulk_delete/', { ids: selectedRows });
      toast.success(`${selectedRows.length} list entries deleted successfully`);
      setSelectedRows([]);
      fetchEntries();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete entries');
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'Watching': 'bg-blue-500/20 text-blue-400',
      'Completed': 'bg-green-500/20 text-green-400',
      'On Hold': 'bg-yellow-500/20 text-yellow-400',
      'Dropped': 'bg-red-500/20 text-red-400',
      'Plan to Watch': 'bg-purple-500/20 text-purple-400',
    };
    return colors[status] || 'bg-gray-500/20 text-gray-400';
  };

  const columns = [
    {
      key: 'user',
      title: 'User',
      render: (item) => (
        <Link to={`/u/${item.user.username}`} className="text-violet-400 hover:text-violet-300">
          {item.user.username}
        </Link>
      ),
    },
    {
      key: 'anime',
      title: 'Anime',
      render: (item) => (
        <Link to={`/anime/${item.anime.slug}`} className="text-violet-400 hover:text-violet-300">
          {item.anime.title}
        </Link>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (item) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(item.status)}`}>
          {item.status}
        </span>
      ),
    },
    {
      key: 'score',
      title: 'Score',
      render: (item) => (
        <span className="text-white/80">
          {item.score > 0 ? `${item.score}/10` : '-'}
        </span>
      ),
    },
    {
      key: 'episodes_watched',
      title: 'Episodes',
      render: (item) => (
        <span className="text-white/60">{item.episodes_watched}</span>
      ),
    },
    {
      key: 'updated_at',
      title: 'Last Updated',
      render: (item) => (
        <span className="text-white/50 text-sm">
          {new Date(item.updated_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      sortable: false,
      render: (item) => (
        <button
          onClick={() => handleDelete(item.id)}
          className="px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
        >
          Delete
        </button>
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
      <h1 className="text-2xl font-bold text-white mb-6">User List Entries</h1>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Filter by user ID..."
            value={filters.user}
            onChange={(e) => setFilters({ ...filters, user: e.target.value })}
            className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
          />
          <input
            type="text"
            placeholder="Filter by anime ID..."
            value={filters.anime}
            onChange={(e) => setFilters({ ...filters, anime: e.target.value })}
            className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
          >
            <option value="" className="bg-gray-800">All Statuses</option>
            <option value="Watching" className="bg-gray-800">Watching</option>
            <option value="Completed" className="bg-gray-800">Completed</option>
            <option value="On Hold" className="bg-gray-800">On Hold</option>
            <option value="Dropped" className="bg-gray-800">Dropped</option>
            <option value="Plan to Watch" className="bg-gray-800">Plan to Watch</option>
          </select>
          <button
            onClick={() => { setPage(1); fetchEntries(); }}
            className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            Apply Filters
          </button>
        </div>
      </div>

      <BulkActions
        selectedCount={selectedRows.length}
        actions={bulkActions}
        onClearSelection={() => setSelectedRows([])}
      />

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        <DataTable
          columns={columns}
          data={entries}
          loading={loading}
          selectable={true}
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          emptyMessage="No list entries found"
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
    </div>
  );
};

export default AdminUserLists;
