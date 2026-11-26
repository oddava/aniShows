import queryClient from './queryClient';
import { animeQueries } from '../api/queries/anime';
import { hasSession } from '../api/httpClient';

const DETAIL_STALE_MS = 300000;
const ANIME_PATH = /^\/anime\/([^/]+)/;

/**
 * Starts the first page's main request at boot, in parallel with the app and
 * page code instead of after them (LCP, ANISHOWS-003). Signed-out visitors
 * only: a member's copy depends on who they are (their list status), which is
 * not known until the session is restored.
 */
export function startBootData(path) {
    if (hasSession()) return;
    const match = ANIME_PATH.exec(path || '');
    if (!match) return;
    const slug = decodeURIComponent(match[1]);
    queryClient
        .prefetchQuery({ ...animeQueries.detail(slug, undefined), staleTime: DETAIL_STALE_MS })
        .catch(() => {});
}
