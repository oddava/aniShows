// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * C-INT-7: the web-push worker (/service-worker.js) is the only service worker at scope `/`.
 * A Workbox/VitePWA worker there would replace it (one registration per scope) and turn push
 * off, and its old `api-cache` rule kept authenticated /api/v1 responses for 24 h past logout.
 */

const frontendRoot = fileURLToPath(new URL('../../../', import.meta.url));

const pluginNames = (plugins) => plugins.flat(Infinity).filter(Boolean).map((plugin) => plugin.name || '');

describe('vite config', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it.each(['false', 'true'])('generates no service worker (VITE_ENABLE_PWA=%s)', async (flag) => {
        vi.stubEnv('VITE_ENABLE_PWA', flag);
        const { default: defineConfigFn } = await import('../../../vite.config.js');
        const config = defineConfigFn({ mode: 'production', command: 'build' });
        const names = pluginNames(config.plugins);
        expect(names.some((name) => /pwa|workbox/i.test(name))).toBe(false);
        expect(JSON.stringify(config)).not.toContain('api-cache');
    });

    it('does not depend on vite-plugin-pwa', () => {
        const pkg = JSON.parse(readFileSync(`${frontendRoot}package.json`, 'utf8'));
        expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('vite-plugin-pwa');
    });
});

describe('public/boot.js', () => {
    const runBoot = ({ registrations, cacheKeys }) => {
        const unregistered = [];
        const deleted = [];
        const regs = registrations.map((scriptURL) => ({
            active: { scriptURL },
            unregister: () => {
                unregistered.push(scriptURL);
                return Promise.resolve(true);
            },
        }));
        const caches = {
            keys: () => Promise.resolve(cacheKeys),
            delete: (key) => {
                deleted.push(key);
                return Promise.resolve(true);
            },
        };
        const window = { caches, addEventListener: () => {} };
        const sandbox = {
            window,
            caches,
            navigator: { serviceWorker: { getRegistrations: () => Promise.resolve(regs) } },
            document: { querySelector: () => null, getElementById: () => null },
            setTimeout,
            Promise,
        };
        vm.runInNewContext(readFileSync(`${frontendRoot}public/boot.js`, 'utf8'), sandbox);
        return { unregistered, deleted };
    };

    it('keeps the push worker and removes any other worker and stale caches', async () => {
        const { unregistered, deleted } = runBoot({
            registrations: ['https://anishows.test/service-worker.js', 'https://anishows.test/sw.js'],
            cacheKeys: ['api-cache', 'images', 'workbox-precache-v2-https://anishows.test/', 'my-other-cache'],
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(unregistered).toEqual(['https://anishows.test/sw.js']);
        expect(deleted).toEqual(['api-cache', 'images', 'workbox-precache-v2-https://anishows.test/']);
    });

    it('runs the cleanup whatever the page says (there is no PWA switch any more)', async () => {
        const { unregistered } = runBoot({ registrations: ['https://anishows.test/sw.js'], cacheKeys: [] });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unregistered).toEqual(['https://anishows.test/sw.js']);
    });
});
