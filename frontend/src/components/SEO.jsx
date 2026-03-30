import { Helmet } from 'react-helmet-async';

const defaultSEO = {
  title: 'AniShows - Discover & Track Anime | Anime Database & Community',
  description: 'AniShows is your ultimate anime discovery platform. Track your favorite anime, discover new series, write reviews, and join a passionate community of anime fans.',
  canonical: 'https://anishows.com',
  ogImage: 'https://anishows.com/icon.svg?v=2',
  ogType: 'website',
};

const pageSEO = {
  home: {
    title: 'AniShows - Discover & Track Anime | Anime Database & Community',
    description: 'Discover your next anime adventure. Explore thousands of anime series, track your favorites, write reviews, and join a community of passionate fans.',
  },
  browse: {
    title: 'Browse Anime | AniShows - Discover New Series',
    description: 'Browse through thousands of anime series. Filter by genre, season, year, and rating to find your next favorite show.',
  },
  schedule: {
    title: 'Anime Schedule | AniShows - Release Calendar',
    description: 'Check when the next episode of your favorite anime airs. Weekly anime release schedule and countdown timers.',
  },
  login: {
    title: 'Login | AniShows - Track Your Anime Journey',
    description: 'Sign in to AniShows to track your anime progress, manage your watchlist, and connect with other fans.',
  },
  register: {
    title: 'Create Account | AniShows - Join the Community',
    description: 'Join AniShows for free. Track your anime, rate shows, write reviews, and discover new series.',
  },
  settings: {
    title: 'Settings | AniShows - Manage Your Account',
    description: 'Manage your AniShows account settings, preferences, and profile information.',
  },
  notifications: {
    title: 'Notifications | AniShows',
    description: 'Stay updated with episode alerts, follows, replies, and platform activity.',
  },
  terms: {
    title: 'Terms of Service | AniShows',
    description: 'Read the terms and conditions for using AniShows anime tracking platform.',
  },
  privacy: {
    title: 'Privacy Policy | AniShows',
    description: 'Learn how AniShows protects your privacy and handles your personal information.',
  },
  notFound: {
    title: 'Page Not Found | AniShows',
    description: 'The page you are looking for could not be found. Explore our anime database instead.',
  },
};

export function SEO({ 
  page = 'home',
  customTitle,
  customDescription,
  canonical,
  noIndex = false,
  ogImage,
  ogType = 'website',
}) {
  const pageConfig = pageSEO[page] || pageSEO.home;
  const title = customTitle || pageConfig.title;
  const description = customDescription || pageConfig.description;
  const canonicalUrl = canonical || `${defaultSEO.canonical}/${page === 'home' ? '' : page}`;

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonicalUrl} />
      
      {noIndex && <meta name="robots" content="noindex, nofollow" />}
      
      {/* Open Graph */}
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImage || defaultSEO.ogImage} />
      
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage || defaultSEO.ogImage} />
    </Helmet>
  );
}

export default SEO;
