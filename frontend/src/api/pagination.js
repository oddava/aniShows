export function getNextPageNumber(nextUrl) {
    if (!nextUrl) return undefined;

    try {
        // DRF usually returns absolute URLs, but relative links can still appear in tests/proxy setups.
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
        return new URL(nextUrl, baseUrl).searchParams.get('page') || undefined;
    } catch {
        return undefined;
    }
}
