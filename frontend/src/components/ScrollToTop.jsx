import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// /u/<name>[/<tab>] or /profile[/<tab>]: switching a profile's tab keeps
// the reader where they are (the profile places its own tab bar).
const getProfileKey = (pathname) => {
    const normalizedPath = pathname.replace(/\/+$/, '') || '/';
    const user = normalizedPath.match(/^\/u\/([^/]+)(?:\/[^/]+)?$/);
    if (user) return `u:${user[1].toLowerCase()}`;
    return /^\/profile(?:\/[^/]+)?$/.test(normalizedPath) ? 'own' : null;
};

const getAnimeDetailSlug = (pathname) => {
    const normalizedPath = pathname.replace(/\/+$/, '') || '/';
    const match = normalizedPath.match(/^\/anime\/([^/]+)(?:\/.*)?$/);
    return match?.[1] || null;
};

export default function ScrollToTop() {
    const { pathname } = useLocation();
    const previousPathRef = useRef(null);

    useEffect(() => {
        const previousPath = previousPathRef.current;
        const previousAnimeSlug = previousPath ? getAnimeDetailSlug(previousPath) : null;
        const currentAnimeSlug = getAnimeDetailSlug(pathname);

        previousPathRef.current = pathname;

        if (previousAnimeSlug && previousAnimeSlug === currentAnimeSlug) {
            return;
        }

        const previousProfile = previousPath ? getProfileKey(previousPath) : null;
        if (previousProfile && previousProfile === getProfileKey(pathname)) {
            return;
        }

        window.scrollTo(0, 0);
    }, [pathname]);

    return null;
}
