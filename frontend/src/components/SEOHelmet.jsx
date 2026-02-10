import { useEffect } from 'react';

export default function SEOHelmet({ anime }) {
    useEffect(() => {
        if (!anime) return;

        // Update document title
        document.title = `${anime.title} - AniShows`;

        // Update meta description
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
            metaDesc.setAttribute('content', anime.meta_description || anime.synopsis?.slice(0, 160) || `${anime.title} - Watch on AniShows`);
        }

        // Add Open Graph tags
        const ogTitle = document.querySelector('meta[property="og:title"]') || document.createElement('meta');
        ogTitle.setAttribute('property', 'og:title');
        ogTitle.setAttribute('content', anime.title);
        if (!document.querySelector('meta[property="og:title"]')) {
            ogTitle.setAttribute('property', 'og:title');
            document.head.appendChild(ogTitle);
        }

        const ogDesc = document.querySelector('meta[property="og:description"]') || document.createElement('meta');
        ogDesc.setAttribute('property', 'og:description');
        ogDesc.setAttribute('content', anime.synopsis?.slice(0, 200) || '');
        if (!document.querySelector('meta[property="og:description"]')) {
            document.head.appendChild(ogDesc);
        }

        const ogImage = document.querySelector('meta[property="og:image"]') || document.createElement('meta');
        ogImage.setAttribute('property', 'og:image');
        ogImage.setAttribute('content', anime.cover_image || '');
        if (!document.querySelector('meta[property="og:image"]')) {
            document.head.appendChild(ogImage);
        }

        // Add JSON-LD structured data
        let script = document.getElementById('anime-jsonld');
        if (!script) {
            script = document.createElement('script');
            script.id = 'anime-jsonld';
            script.type = 'application/ld+json';
            document.head.appendChild(script);
        }

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'TVSeries',
            name: anime.title,
            description: anime.synopsis,
            image: anime.cover_image,
            datePublished: anime.release_date,
            aggregateRating: anime.rating ? {
                '@type': 'AggregateRating',
                ratingValue: anime.rating,
                bestRating: 10,
            } : undefined,
            genre: anime.genres?.map(g => g.name),
        };

        script.textContent = JSON.stringify(jsonLd);

        return () => {
            // Cleanup: Remove the script on unmount
            const scriptToRemove = document.getElementById('anime-jsonld');
            if (scriptToRemove) {
                scriptToRemove.remove();
            }
        };
    }, [anime]);

    return null;
}
