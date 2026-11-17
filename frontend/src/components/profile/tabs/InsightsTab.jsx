// Profile "Insights" tab body (G3 Lists). Rendered by the ProfileContent shell (G1),
// which wraps it in the section error boundary and Suspense fallback.
// recharts is heavy; load it only when the Insights tab is opened.
import { lazy } from 'react';

const InsightsTab = lazy(() => import('../../ProfileInsights'));

export default InsightsTab;
