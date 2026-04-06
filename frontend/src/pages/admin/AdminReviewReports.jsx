import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { toast } from 'react-hot-toast';
import logger from '../../utils/logger';
import CustomSelect from '../../components/common/CustomSelect';

const AdminReviewReports = () => {
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [minScore, setMinScore] = useState('1');

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        min_score: minScore,
      });
      const response = await api.get(`/admin/reviews/reports/?${params}`);
      setReports(response.data.results || []);
      setSummary(response.data.summary || null);
      setTotalPages(Math.ceil((response.data.count || 0) / 20) || 1);
    } catch (err) {
      logger.error('Failed to fetch review reports:', err);
      toast.error(err.response?.data?.detail || 'Failed to load review reports');
    } finally {
      setLoading(false);
    }
  }, [page, minScore]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const deleteReview = async (id) => {
    if (!confirm('Delete this review?')) return;
    try {
      await api.delete(`/admin/reviews/${id}/`);
      toast.success('Review deleted');
      fetchReports();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete review');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Review Reports</h1>
          <p className="text-white/60 mt-1">Automated moderation queue based on spoiler and low-quality signals.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-white/60">Min Score</label>
          <CustomSelect
            value={minScore}
            onChange={(nextValue) => {
              setMinScore(nextValue);
              setPage(1);
            }}
            options={[
              { value: '1', label: '1+' },
              { value: '2', label: '2+' },
              { value: '3', label: '3+' },
            ]}
            triggerClassName="px-3 py-2 bg-white/10 rounded-lg"
            ariaLabel="Minimum review report score"
          />
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/50 uppercase">Total Queue</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.total_reports || 0}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/50 uppercase">Spoiler Flags</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">{summary.spoiler_reports || 0}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/50 uppercase">Low Ratings</div>
            <div className="text-2xl font-bold text-orange-400 mt-1">{summary.low_rating_reports || 0}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/50 uppercase">No Text</div>
            <div className="text-2xl font-bold text-red-400 mt-1">{summary.textless_reports || 0}</div>
          </div>
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-white/60">Loading moderation queue...</div>
        ) : reports.length === 0 ? (
          <div className="p-10 text-center text-white/60">No review reports for current filters.</div>
        ) : (
          <div className="divide-y divide-white/10">
            {reports.map((report) => (
              <div key={report.id} className="p-4">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">
                        Score {report.report_score}
                      </span>
                      <span className="text-white/60 text-xs">
                        {new Date(report.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-white font-medium">
                      <Link to={`/u/${report.user.username}`} className="text-violet-400 hover:text-violet-300">
                        {report.user.username}
                      </Link>
                      {' '}on{' '}
                      <Link to={`/anime/${report.anime.slug}`} className="text-violet-400 hover:text-violet-300">
                        {report.anime.title}
                      </Link>
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {report.reasons.map((reason) => (
                        <span key={reason} className="px-2 py-1 rounded text-xs bg-white/10 text-white/70 border border-white/10">
                          {reason}
                        </span>
                      ))}
                      <span className="px-2 py-1 rounded text-xs bg-white/10 text-white/70 border border-white/10">
                        Rating {report.rating}/10
                      </span>
                      <span className="px-2 py-1 rounded text-xs bg-white/10 text-white/70 border border-white/10">
                        👍 {report.helpful_votes} / 👎 {report.unhelpful_votes}
                      </span>
                    </div>
                    <p className="text-sm text-white/70 mt-3 line-clamp-3">
                      {report.text || 'No review text provided.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to="/admin/reviews"
                      className="px-3 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors text-sm"
                    >
                      Open Reviews
                    </Link>
                    <button
                      onClick={() => deleteReview(report.id)}
                      className="px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && totalPages > 1 && (
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

export default AdminReviewReports;
