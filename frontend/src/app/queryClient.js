import { QueryClient } from '@tanstack/react-query';
import { retryUnlessClientError } from '../api/queries/retry';

/**
 * The app's one query cache. Its own module so the boot code (app/bootData.js)
 * can start a page's first request before the app chunk has even loaded.
 */
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5,
            gcTime: 1000 * 60 * 30,
            retry: retryUnlessClientError,
            refetchOnWindowFocus: false,
        },
    },
});

export default queryClient;
