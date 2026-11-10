import { useCallback, useMemo } from 'react';

// Fuzzy search hook with better matching - defined OUTSIDE component
// Normalize text for better matching (remove punctuation, extra spaces)
export const normalizeText = (text) => {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[.:,;!?-]/g, ' ')  // Replace punctuation with spaces
        .replace(/\s+/g, ' ')         // Collapse multiple spaces
        .trim();
};

// Fuse is passed in once its lazily imported module has loaded (null before).
export default function useFuzzySearch(Fuse, data, options = {}) {
    // Pre-process data with normalized titles for better matching
    const processedData = useMemo(() => {
        return data.map(item => ({
            ...item,
            _normalizedTitle: normalizeText(item.title),
            _normalizedJp: normalizeText(item.title_jp)
        }));
    }, [data]);

    const fuse = useMemo(() => {
        if (!Fuse) return null;
        const defaultOptions = {
            keys: [
                { name: 'title', weight: 0.6 },
                { name: '_normalizedTitle', weight: 0.3 },
                { name: 'title_jp', weight: 0.05 },
                { name: '_normalizedJp', weight: 0.05 }
            ],
            threshold: 0.35,
            distance: 200,
            includeScore: true,
            minMatchCharLength: 1,
            shouldSort: true,
            ignoreLocation: true,
            findAllMatches: true,
            useExtendedSearch: true,
            ...options
        };
        return new Fuse(processedData, defaultOptions);
    }, [Fuse, processedData, options]);

    const search = useCallback((query) => {
        if (!query || query.trim().length < 1) return [];
        const normalizedQuery = normalizeText(query);

        // First, check for exact matches (including normalized)
        const exactMatches = processedData.filter(item => {
            const titleLower = item.title?.toLowerCase() || '';
            const normalizedTitle = item._normalizedTitle;
            const queryLower = query.toLowerCase();

            // Check original title
            if (titleLower.includes(queryLower)) return true;
            // Check normalized title
            if (normalizedTitle.includes(normalizedQuery)) return true;
            // Check word-by-word matching (for "Frieren Beyond" matching "Frieren: Beyond")
            const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);
            const titleWords = normalizedTitle.split(' ').filter(w => w.length > 0);
            if (queryWords.length > 1) {
                const allWordsMatch = queryWords.every(qw =>
                    titleWords.some(tw => tw.startsWith(qw) || tw.includes(qw))
                );
                if (allWordsMatch) return true;
            }
            return false;
        });

        // Get fuzzy results with extended search
        const fuzzyResults = fuse ? fuse.search(query.trim(), { limit: 10 }) : [];

        // Combine and deduplicate, prioritizing exact matches
        const seen = new Set();
        const combined = [];

        // Add exact matches first
        exactMatches.forEach(item => {
            if (!seen.has(item.id)) {
                seen.add(item.id);
                combined.push({ ...item, isExactMatch: true });
            }
        });

        // Add fuzzy results
        fuzzyResults.forEach(result => {
            if (!seen.has(result.item.id)) {
                seen.add(result.item.id);
                combined.push({ ...result.item, isFuzzyMatch: true, matchScore: result.score });
            }
        });

        return combined;
    }, [fuse, processedData]);

    return { search };
}
