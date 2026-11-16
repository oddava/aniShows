/*
 * Back-compat re-exports for the pre-split user API module. Each API object now
 * lives in the module of the group that owns it (see the feature-revamp overview):
 * favorites, reviews, social, badges (G5), lists, activity, imports (G3),
 * recommendations (G2), notifications (G4). Import from those; this file is
 * frozen and never needs editing.
 */
export * from './activity';
export * from './badges';
export * from './favorites';
export * from './imports';
export * from './lists';
export * from './notifications';
export * from './recommendations';
export * from './reviews';
export * from './social';
