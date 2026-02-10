import { Link } from 'react-router-dom';

const AdminStaff = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Staff Management</h1>
      
      <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
        <div className="text-6xl mb-4">🎬</div>
        <h2 className="text-2xl font-bold text-white mb-2">Coming Soon</h2>
        <p className="text-white/60 mb-6 max-w-md mx-auto">
          Staff management features are under development. This module will allow you to manage anime staff members including directors, writers, and animators.
        </p>
        
        <div className="flex items-center justify-center gap-4">
          <Link
            to="/admin/anime"
            className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors"
          >
            Manage Anime
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
          <div className="text-3xl mb-3">🎨</div>
          <h3 className="text-lg font-semibold text-white mb-2">Staff Profiles</h3>
          <p className="text-white/50 text-sm">
            Create and manage comprehensive profiles for directors, producers, and animators.
          </p>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">📋</div>
          <h3 className="text-lg font-semibold text-white mb-2">Role Assignment</h3>
          <p className="text-white/50 text-sm">
            Assign staff members to specific roles and positions for each anime production.
          </p>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">🌟</div>
          <h3 className="text-lg font-semibold text-white mb-2">Filmography</h3>
          <p className="text-white/50 text-sm">
            Track complete filmographies and career histories of staff members.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminStaff;
