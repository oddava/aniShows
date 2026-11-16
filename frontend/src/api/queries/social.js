// Query keys and options owned by G5 Community (feature-revamp seams).

/*
 * Query keys for users, profiles, lists, favourites, reviews and activity.
 *
 * The first element of each key is what invalidation matches on, so it is
 * kept exactly as it was: e.g. invalidating `listKeys.all` (['lists']) still
 * covers every `listKeys.byStatus(...)` and `listKeys.overview(...)` entry,
 * and `profileKeys.all` (['profile']) covers every `profileKeys.byUsername(...)`.
 */

export const followKeys = {
    all: ['follows'],
    list: (username, tab) => ['follows', username, tab],
};

export const friendKeys = {
    list: (username) => ['friends-infinite', username],
};
