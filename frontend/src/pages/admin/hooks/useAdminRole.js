import { useAuth } from '../../../context/AuthContext';

/**
 * The signed-in admin's tier. Staff moderate; superusers also manage the
 * catalog, settings, logs and system jobs. Pages hide superuser-only actions
 * for staff (the API refuses them anyway).
 */
export default function useAdminRole() {
    const { user } = useAuth();
    const isSuperuser = Boolean(user?.is_superuser);
    return { isSuperuser, isStaff: isSuperuser || Boolean(user?.is_staff) };
}
