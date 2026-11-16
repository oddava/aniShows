// Option lists and limits for the Browse filters.

export const RELEVANCE_SORT = 'relevance';

export const SORT_OPTIONS = [
  { value: RELEVANCE_SORT, label: 'Best match' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'trending', label: 'Trending' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'newest', label: 'Newest First' },
  { value: 'title', label: 'Title A-Z' },
];

/** The sorts to offer: "Best match" only ranks something while there is a search. */
export const getSortOptions = (hasSearch) => (
  hasSearch ? SORT_OPTIONS : SORT_OPTIONS.filter((option) => option.value !== RELEVANCE_SORT)
);

export const TYPE_OPTIONS = [
  { value: 'TV', label: 'TV Series' },
  { value: 'Movie', label: 'Movie' },
  { value: 'ONA', label: 'ONA' },
  { value: 'OVA', label: 'OVA' },
  { value: 'Special', label: 'Special' },
  { value: 'Music', label: 'Music' },
];

export const STATUS_OPTIONS = [
  { value: 'Airing', label: 'Airing' },
  { value: 'Finished', label: 'Finished' },
  { value: 'Upcoming', label: 'Upcoming' },
];

export const SEASON_OPTIONS = [
  { value: 'winter', label: 'Winter' },
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
];

export const YEAR_OPTIONS = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);
export const MIN_YEAR_BOUND = 1980;
export const MAX_YEAR_BOUND = new Date().getFullYear() + 1;

/**
 * The season `direction` (+1/-1) steps away from `season` `year`, rolling the
 * year (fall -> winter of the next year), or null outside the year bounds or
 * for an unknown season. Seasons are in calendar order in SEASON_OPTIONS.
 */
export const stepSeason = (season, year, direction) => {
  const index = SEASON_OPTIONS.findIndex((option) => option.value === season);
  const yearNumber = Number.parseInt(year, 10);
  if (index < 0 || !Number.isFinite(yearNumber)) return null;
  const total = index + direction;
  const nextYear = yearNumber + Math.floor(total / SEASON_OPTIONS.length);
  if (nextYear < MIN_YEAR_BOUND || nextYear > MAX_YEAR_BOUND) return null;
  const nextIndex = ((total % SEASON_OPTIONS.length) + SEASON_OPTIONS.length) % SEASON_OPTIONS.length;
  return { season: SEASON_OPTIONS[nextIndex].value, year: String(nextYear) };
};

/** "Fall 2026" for a season and year, or '' when either is missing. */
export const formatSeasonLabel = (season, year) => {
  const label = SEASON_OPTIONS.find((option) => option.value === season)?.label;
  return label && year ? `${label} ${year}` : '';
};
export const FILTER_UPDATE_DEBOUNCE_MS = 250;
export const DEBOUNCED_FILTER_KEYS = new Set([
  'minRating',
  'maxRating',
  'minEpisodes',
  'maxEpisodes',
  'minDuration',
  'maxDuration',
  'minYear',
  'maxYear',
]);

export const SOURCE_OPTIONS = [
  { value: 'Original', label: 'Original' },
  { value: 'Manga', label: 'Manga' },
  { value: 'Light Novel', label: 'Light Novel' },
  { value: 'Visual Novel', label: 'Visual Novel' },
  { value: 'Game', label: 'Game' },
  { value: 'Web Manga', label: 'Web Manga' },
  { value: 'Novel', label: 'Novel' },
  { value: 'Music', label: 'Music' },
  { value: 'Mixed Media', label: 'Mixed Media' },
  { value: 'Picture Book', label: 'Picture Book' },
  { value: 'Card Game', label: 'Card Game' },
  { value: 'Other', label: 'Other' },
];

export const ADVANCED_TAG_GROUPS = [
  {
    title: 'Cast / Main Cast',
    tags: [
      'anti-hero',
      'ensemble cast',
      'female protagonist',
      'male protagonist',
      'primarily adult cast',
      'primarily teen cast',
    ],
  },
  {
    title: 'Theme / Fantasy',
    tags: [
      'isekai',
      'magic',
      'mythology',
      'super power',
      'youkai',
      'witch',
    ],
  },
  {
    title: 'Theme / Sci Fi',
    tags: [
      'cyberpunk',
      'space opera',
      'time loop',
      'time manipulation',
      'post-apocalyptic',
      'virtual world',
    ],
  },
  {
    title: 'Theme / Action',
    tags: ['martial arts', 'swordplay', 'guns', 'battle royale', 'espionage', 'samurai'],
  },
  {
    title: 'Theme / Drama',
    tags: ['revenge', 'coming of age', 'conspiracy', 'tragedy', 'war', 'class struggle'],
  },
];
