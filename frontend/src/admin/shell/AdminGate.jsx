import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import PageLoader from '../../components/common/PageLoader';

/**
 * Only staff get past this. Signed-out visitors go to sign in (and come back
 * here after); signed-in members go to the home page.
 */
export default function AdminGate({ children }) {
    const { user, loading, isAuthenticated } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div className="min-h-screen bg-[var(--ink-0)]">
                <PageLoader />
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    if (!user?.is_staff && !user?.is_superuser) {
        return <Navigate to="/" replace />;
    }

    return children;
}
