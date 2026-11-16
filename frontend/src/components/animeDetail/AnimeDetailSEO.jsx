import { Helmet } from 'react-helmet-async';
import SEO from '../SEO';
import { SITE_ORIGIN, absoluteMediaUrl, getOptimizedImageUrl } from '../../utils/imageUtils';

const DESCRIPTION_LENGTH = 160;

const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#039;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
};

/** Synopsis as plain text: tags stripped, common entities decoded, spaces collapsed. */
function synopsisToPlainText(synopsis) {
    return String(synopsis || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&(amp|lt|gt|quot|#0?39|apos|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
        .replace(/\s+/g, ' ')
        .trim();
}

function buildAnimeDescription(anime) {
    const text = synopsisToPlainText(anime?.synopsis);
    if (!text) return `${anime?.title || 'Anime'} on AniShows: episodes, characters, staff and reviews.`;
    return text.slice(0, DESCRIPTION_LENGTH).trim();
}

/**
 * Head tags for an anime detail page: title, description, canonical, og/twitter
 * tags (via the shared <SEO>) and JSON-LD (Movie or TVSeries).
 */
export default function AnimeDetailSEO({ anime }) {
    if (!anime) return null;

    const isMovie = anime.anime_type === 'Movie';
    const canonical = `${SITE_ORIGIN}/anime/${anime.slug}`;
    const description = buildAnimeDescription(anime);
    const image = absoluteMediaUrl(getOptimizedImageUrl(anime, 'cover', 'large'))
        || absoluteMediaUrl(anime.cover_image_external_url)
        || undefined;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': isMovie ? 'Movie' : 'TVSeries',
        name: anime.title,
        alternateName: anime.title_jp || undefined,
        description,
        url: canonical,
        image,
        datePublished: anime.release_date || undefined,
        genre: anime.genres?.length ? anime.genres.map((genre) => genre.name) : undefined,
        numberOfEpisodes: !isMovie && anime.episode_count ? anime.episode_count : undefined,
    };
    // "<" escaped so text from the synopsis can never close the script tag.
    const jsonLdText = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

    return (
        <>
            <SEO
                customTitle={`${anime.title} | AniShows`}
                customDescription={description}
                canonical={canonical}
                ogImage={image}
                ogType={isMovie ? 'video.movie' : 'video.tv_show'}
            />
            <Helmet>
                <script type="application/ld+json">{jsonLdText}</script>
            </Helmet>
        </>
    );
}
