import { Link } from 'react-router-dom';

const AdminCharacters = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-6">Character Management</h1>
      
      <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
        <div className="text-6xl mb-4">👤</div>
        <h2 className="text-2xl font-bold text-white mb-2">Coming Soon</h2>
        <p className="text-white/60 mb-6 max-w-md mx-auto">
          Character management features are under development. This module will allow you to add, edit, and manage anime characters.
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
          <div className="text-3xl mb-3">📝</div>
          <h3 className="text-lg font-semibold text-white mb-2">Add Characters</h3>
          <p className="text-white/50 text-sm">
            Create detailed character profiles with biographical information and relationships.
          </p>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">🔗</div>
          <h3 className="text-lg font-semibold text-white mb-2">Link to Anime</h3>
          <p className="text-white/50 text-sm">
            Associate characters with their respective anime series and episodes.
          </p>
        </div>
        
        <div className="bg-white/5 border border-white/10 rounded-xl p-6">
          <div className="text-3xl mb-3">🎭</div>
          <h3 className="text-lg font-semibold text-white mb-2">Voice Actors</h3>
          <p className="text-white/50 text-sm">
            Connect characters with their voice actors and seiyuu information.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdminCharacters;
