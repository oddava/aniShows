const BROWSE_REAL_GENRE_SLUGS = new Set([
  'action',
  'adventure',
  'comedy',
  'drama',
  'ecchi',
  'fantasy',
  'hentai',
  'horror',
  'mahou-shoujo',
  'mecha',
  'music',
  'mystery',
  'psychological',
  'romance',
  'sci-fi',
  'slice-of-life',
  'sports',
  'supernatural',
  'thriller',
]);

export function filterBrowseGenres(genres = []) {
  return genres.filter((genre) => BROWSE_REAL_GENRE_SLUGS.has(genre.slug));
}

export { BROWSE_REAL_GENRE_SLUGS };
