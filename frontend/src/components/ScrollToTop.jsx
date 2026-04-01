import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

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

        window.scrollTo(0, 0);
    }, [pathname]);

    return null;
}
