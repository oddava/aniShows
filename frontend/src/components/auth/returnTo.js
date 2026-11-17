/**
 * Where to go after signing in. Only same-origin paths are honoured, so a
 * crafted `?next=https://evil.example` or `//evil.example` cannot turn the
 * login page into an open redirect.
 */
export function safeReturnPath(candidate, fallback = '/browse') {
    if (typeof candidate !== 'string') return fallback;
    const path = candidate.trim();
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
    // Anything that parses to another origin (e.g. control characters) is refused too.
    try {
        const url = new URL(path, window.location.origin);
        if (url.origin !== window.location.origin) return fallback;
        return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        return fallback;
    }
}
