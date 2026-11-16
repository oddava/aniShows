import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PageLoader from './common/PageLoader';

/**
 * Route guard component that protects admin routes.
 * Redirects to login if not authenticated, or /browse if not admin.
 */
const AdminRoute = ({ children }) => {
    const { user, loading, isAuthenticated } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a]">
                <PageLoader />
            </div>
        );
    }

    // Not logged in -> redirect to login
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    // Logged in but not staff/admin -> redirect to browse
    if (!user?.is_staff && !user?.is_superuser) {
        return <Navigate to="/browse" replace />;
    }

    // User is authenticated and is staff/admin -> allow access
    return children;
};

export default AdminRoute;
