import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import DataTable from './components/DataTable';
import Modal from './components/Modal';
import BulkActions from './components/BulkActions';
import { toast } from 'react-hot-toast';

const AdminFavorites = () => {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [animeFilter, setAnimeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedRows, setSelectedRows] = useState([]);
  const [showStats, setShowStats] = useState(true);

  const fetchFavorites = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        ...(search && { search }),
        ...(userFilter && { user: userFilter }),
        ...(animeFilter && { anime: animeFilter }),
      });

      const response = await api.get(`/admin/favorites/?${params}`);
      setFavorites(response.data.results);
      setTotalPages(Math.ceil(response.data.count / 20));
    } catch (err) {
      console.error('Failed to fetch favorites:', err);
      toast.error('Failed to load favorites');
    } finally {
      setLoading(false);
    }
  }, [page, search, userFilter, animeFilter]);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const response = await api.get('/admin/favorites/stats/');
      setStats(response.data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchFavorites();
  };

  const handleDelete = async (favoriteId) => {
    if (!confirm('Are you sure you want to delete this favorite?')) {
      return;
    }
    try {
      await api.delete(`/admin/favorites/${favoriteId}/`);
      toast.success('Favorite deleted successfully');
      fetchFavorites();
      fetchStats();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete favorite');
    }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedRows.length} favorites?`)) {
      return;
    }
    try {
      await api.post('/admin/bulk/', {
        operation: 'delete',
        entity: 'favorites',
        ids: selectedRows,
      });
      toast.success(`${selectedRows.length} favorites deleted successfully`);
      setSelectedRows([]);
      fetchFavorites();
      fetchStats();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete favorites');
    }
  };

  const clearFilters = () => {
    setSearch('');
    setUserFilter('');
    setAnimeFilter('');
    setPage(1);
    fetchFavorites();
  };

  const columns = [
    {
      key: 'user',
      title: 'User',
      render: (item) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 text-sm font-medium">
            {item.user_username?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <span className="font-medium text-white">{item.user_username}</span>
        </div>
      ),
    },
    {
      key: 'anime',
      title: 'Anime',
      render: (item) => (
        <Link
          to={`/anime/${item.anime_slug}`}
          target="_blank"
          className="text-violet-400 hover:text-violet-300 font-medium"
          onClick={(e) => e.stopPropagation()}
        >
          {item.anime_title}
        </Link>
      ),
    },
    {
      key: 'created_at',
      title: 'Added On',
      render: (item) => (
        <span className="text-white/60">
          {new Date(item.created_at).toLocaleDateString()}
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
            onClick={() => handleDelete(item.id)}
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
        <h1 className="text-2xl font-bold text-white">Favorites Management</h1>
        <button
          onClick={() => setShowStats(!showStats)}
          className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
        >
          {showStats ? 'Hide Stats' : 'Show Stats'}
        </button>
      </div>

      {/* Stats Section */}
      {showStats && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-3 border-violet-500/20 border-t-violet-500 rounded-full animate-spin"></div>
            </div>
          ) : stats ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                <h3 className="text-sm font-medium text-white/60 mb-1">Total Favorites</h3>
                <p className="text-3xl font-bold text-white">{stats.total_favorites?.toLocaleString() || 0}</p>
              </div>
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                <h3 className="text-sm font-medium text-white/60 mb-1">Unique Users</h3>
                <p className="text-3xl font-bold text-white">{stats.unique_users?.toLocaleString() || 0}</p>
              </div>
              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                <h3 className="text-sm font-medium text-white/60 mb-1">Unique Anime</h3>
                <p className="text-3xl font-bold text-white">{stats.unique_anime?.toLocaleString() || 0}</p>
              </div>
              
              {/* Top Anime List */}
              <div className="md:col-span-3 mt-4">
                <h3 className="text-lg font-semibold text-white mb-4">Top Favorited Anime</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {stats.top_anime?.map((anime, index) => (
                    <div
                      key={anime.id}
                      className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg p-3"
                    >
                      <span className="text-2xl font-bold text-violet-400 w-8">#{index + 1}</span>
                      <img
                        src={anime.poster_small || anime.poster}
                        alt={anime.title}
                        className="w-12 h-16 object-cover rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/anime/${anime.slug}`}
                          target="_blank"
                          className="text-white font-medium truncate block hover:text-violet-400 transition-colors"
                        >
                          {anime.title}
                        </Link>
                        <span className="text-violet-400 text-sm">{anime.favorite_count} favorites</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search favorites..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div className="w-48">
            <input
              type="text"
              placeholder="Filter by user..."
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div className="w-48">
            <input
              type="text"
              placeholder="Filter by anime..."
              value={animeFilter}
              onChange={(e) => setAnimeFilter(e.target.value)}
              className="w-full px-4 py-2 bg-white/10 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-violet-500"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            Search
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="px-6 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            Clear
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
          data={favorites}
          loading={loading}
          selectable={true}
          selectedRows={selectedRows}
          onSelectionChange={setSelectedRows}
          emptyMessage="No favorites found"
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
    </div>
  );
};

export default AdminFavorites;
