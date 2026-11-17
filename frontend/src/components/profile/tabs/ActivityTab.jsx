// Profile "Activity" tab body (G3 Lists). Rendered by the ProfileContent shell (G1),
// which wraps it in the section error boundary and Suspense fallback.
import { lazy } from 'react';

const ActivityTab = lazy(() => import('../ActivityFeed'));

export default ActivityTab;
