import { describe, expect, it } from 'vitest';

import * as activityModule from '../modules/activity';
import * as badgesModule from '../modules/badges';
import * as favoritesModule from '../modules/favorites';
import * as importsModule from '../modules/imports';
import * as listsModule from '../modules/lists';
import * as notificationsModule from '../modules/notifications';
import * as recommendationsModule from '../modules/recommendations';
import * as reviewsModule from '../modules/reviews';
import * as socialModule from '../modules/social';
import * as userModulesShim from '../modules/user';
import * as badgesQueries from '../queries/badges';
import * as favoritesQueries from '../queries/favorites';
import * as listsQueries from '../queries/lists';
import * as profileQueries from '../queries/profile';
import * as recommendationsQueries from '../queries/recommendations';
import * as reviewsQueries from '../queries/reviews';
import * as socialQueries from '../queries/social';
import * as userQueriesShim from '../queries/user';

/*
 * Guards for the feature-revamp seams (integrator-owned). `export *` silently drops a
 * name exported by two modules, so the per-group modules behind each shim must never
 * share an export name, and the shim must expose every one of them.
 */
const checkShim = (shim, modules) => {
    const seen = new Map();
    Object.entries(modules).forEach(([moduleName, mod]) => {
        Object.keys(mod).forEach((name) => {
            expect(seen.has(name), `${name} exported by ${seen.get(name)} and ${moduleName}`).toBe(false);
            seen.set(name, moduleName);
            expect(shim[name], `${name} missing from the shim`).toBe(mod[name]);
        });
    });
    expect(Object.keys(shim).sort()).toEqual([...seen.keys()].sort());
};

describe('seams shims', () => {
    it('api/modules/user re-exports every group module without collisions', () => {
        checkShim(userModulesShim, {
            activityModule, badgesModule, favoritesModule, importsModule, listsModule,
            notificationsModule, recommendationsModule, reviewsModule, socialModule,
        });
    });

    it('api/queries/user re-exports every group module without collisions', () => {
        checkShim(userQueriesShim, {
            badgesQueries, favoritesQueries, listsQueries, profileQueries,
            recommendationsQueries, reviewsQueries, socialQueries,
        });
    });
});
