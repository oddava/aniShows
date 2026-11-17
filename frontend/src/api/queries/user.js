/*
 * Back-compat re-exports for the pre-split user query module. Keys and query
 * options now live in the module of the group that owns them (see the
 * feature-revamp overview): profile (G1), recommendations (G2), lists (G3),
 * favorites, reviews, social, badges (G5). Import from those; this file is frozen
 * and never needs editing. Key arrays are unchanged.
 */
export * from './badges';
export * from './favorites';
export * from './lists';
export * from './profile';
export * from './recommendations';
export * from './reviews';
export * from './social';
