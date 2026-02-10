import { Link } from 'react-router-dom';

const AdminReviewReports = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Review Reports</h1>
      
      <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
        <div className="text-6xl mb-4">🚩</div>
        <h2 className="text-2xl font-bold text-white mb-2">Coming Soon</h2>
        <p className="text-white/60 mb-6 max-w-md mx-auto">
          Review reporting and moderation features are under development. This module will allow you to manage reported reviews and moderate user-generated content.
        </p>
        
        <div className="flex items-center justify-center gap-4">
          <Link
            to="/admin/reviews"
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            Manage Reviews
          </Link>
          <Link
            to="/admin/dashboard"
            className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>

      {/* Feature Preview */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">📊</div>
          <h3 className="text-lg font-semibold text-white mb-2">Report Queue</h3>
          <p className="text-white/50 text-sm">
            View and manage user-submitted reports for inappropriate reviews and content.
          </p>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">🔍</div>
          <h3 className="text-lg font-semibold text-white mb-2">Content Review</h3>
          <p className="text-white/50 text-sm">
            Examine reported content with context and take appropriate moderation actions.
          </p>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">⚡</div>
          <h3 className="text-lg font-semibold text-white mb-2">Quick Actions</h3>
          <p className="text-white/50 text-sm">
            Approve, hide, or remove reviews with a single click. Ban users when necessary.
          </p>
        </div>
      </div>

      {/* Stats Preview */}
      <div className="mt-8 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Report Statistics (Preview)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-white/5 rounded-lg">
            <div className="text-2xl font-bold text-violet-400">0</div>
            <div className="text-sm text-white/50">Pending Reports</div>
          </div>
          <div className="text-center p-4 bg-white/5 rounded-lg">
            <div className="text-2xl font-bold text-green-400">0</div>
            <div className="text-sm text-white/50">Resolved Today</div>
          </div>
          <div className="text-center p-4 bg-white/5 rounded-lg">
            <div className="text-2xl font-bold text-yellow-400">0</div>
            <div className="text-sm text-white/50">Under Review</div>
          </div>
          <div className="text-center p-4 bg-white/5 rounded-lg">
            <div className="text-2xl font-bold text-blue-400">0</div>
            <div className="text-sm text-white/50">False Reports</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminReviewReports;
