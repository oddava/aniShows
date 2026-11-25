import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { animeQueries } from '../../api/queries/anime';
import { registerDataPrefetch } from '../../app/routePrefetch';
import { getImageSrcSet, getOptimizedImageUrl } from '../../utils/imageUtils';
import {
    DETAIL_RELATION_PAGE_SIZE,
    WATCH_TAB_PAGE_SIZE,
} from '../animeDetail/animeDetailTabs';

// Same freshness the anime page asks for, so a prefetched page renders from
// cache without a second request.
const DETAIL_STALE_MS = 300000;
const ANIME_PATH = /^\/anime\/([^/]+)(?:\/([^/]+))?\/?$/;

// A tab link warms that tab's first page (same options as the tab's query).
const TAB_QUERIES = {
    characters: (slug) => ({ ...animeQueries.characters(slug, DETAIL_RELATION_PAGE_SIZE), staleTime: Infinity }),
    staff: (slug) => ({ ...animeQueries.staff(slug, DETAIL_RELATION_PAGE_SIZE), staleTime: Infinity }),
    watch: (slug) => ({ ...animeQueries.watchEpisodes(slug, WATCH_TAB_PAGE_SIZE), staleTime: DETAIL_STALE_MS }),
};

// Same freshness as the episode-ratings query in useAnimeDetailTabData.
const EPISODE_RATINGS_STALE_MS = 60000;

const warmed = new Set();

/** Start the browser fetching an image the next page will show. */
function warmImage(src, srcSet, sizes) {
    if (!src || warmed.has(src)) return;
    warmed.add(src);
    const img = new Image();
    img.decoding = 'async';
    if (srcSet) {
        img.sizes = sizes;
        img.srcset = srcSet;
    }
    img.src = src;
}

/**
 * Pointing at a link to an anime page loads that page's data (and its poster
 * and banner) before the click, so the page opens filled in instead of on a
 * skeleton. Hover intent, focus and touch only: see app/routePrefetch.js.
 */
export default function DataPrefetch() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?.id;

    useEffect(() => {
        const connection = typeof navigator !== 'undefined' ? navigator.connection : null;
        if (connection?.saveData) return undefined;

        return registerDataPrefetch((path) => {
            const match = ANIME_PATH.exec(path);
            if (!match) return;
            const slug = decodeURIComponent(match[1]);
            const tabQuery = match[2] && TAB_QUERIES[match[2]];
            if (tabQuery) queryClient.prefetchInfiniteQuery(tabQuery(slug)).catch(() => {});
            if (match[2] === 'stats') {
                // The Stats tab's code (the same import() AnimeDetailTabContent
                // lazy-loads, so the same chunk) and its episode ratings, with
                // the key and options the tab uses.
                import('../StatsTab').catch(() => {});
                queryClient
                    .prefetchQuery({ ...animeQueries.episodeRatings(slug, viewerId), staleTime: EPISODE_RATINGS_STALE_MS })
                    .catch(() => {});
            }
            const options = animeQueries.detail(slug, viewerId);
            queryClient
                .prefetchQuery({ ...options, staleTime: DETAIL_STALE_MS })
                .then(() => {
                    const anime = queryClient.getQueryData(options.queryKey);
                    if (!anime) return;
                    warmImage(
                        getOptimizedImageUrl(anime, 'cover', 'large'),
                        getImageSrcSet(anime, 'cover'),
                        '(max-width: 768px) 192px, (max-width: 1024px) 256px, 280px',
                    );
                    warmImage(
                        getOptimizedImageUrl(anime, 'banner', 'large') || getOptimizedImageUrl(anime, 'cover', 'large'),
                        getImageSrcSet(anime, 'banner'),
                        '100vw',
                    );
                })
                .catch(() => {});
        });
    }, [queryClient, viewerId]);

    return null;
}
