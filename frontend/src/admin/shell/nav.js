import {
    Activity, Award, BarChart3, Building2, ClipboardList, DatabaseZap, Film, Flag, History, LayoutDashboard,
    ListChecks, Megaphone, MessagesSquare, Mic, ScrollText, Settings, Star, Tags, Users, Users2,
} from 'lucide-react';

/**
 * The admin's sections. `superuserOnly` items are hidden from staff (the API
 * refuses them anyway). Labels are sentence case, like the rest of the site.
 */
export const NAV_SECTIONS = [
    {
        title: 'Overview',
        items: [
            { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
            { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
        ],
    },
    {
        title: 'Community',
        items: [
            { to: '/admin/moderation', label: 'Moderation', icon: Flag, badge: 'moderation' },
            { to: '/admin/reviews', label: 'Reviews', icon: Star },
            { to: '/admin/forums', label: 'Forums', icon: MessagesSquare },
            { to: '/admin/users', label: 'Users', icon: Users },
            { to: '/admin/badges', label: 'Badges', icon: Award },
            { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
        ],
    },
    {
        title: 'Catalog',
        items: [
            { to: '/admin/anime', label: 'Anime', icon: Film },
            { to: '/admin/genres', label: 'Genres', icon: Tags },
            { to: '/admin/studios', label: 'Studios', icon: Building2 },
            { to: '/admin/characters', label: 'Characters', icon: Users2 },
            { to: '/admin/people', label: 'People', icon: Mic },
        ],
    },
    {
        title: 'Data',
        items: [
            { to: '/admin/catalog-sync', label: 'Catalog sync', icon: DatabaseZap },
            { to: '/admin/list-imports', label: 'List imports', icon: ListChecks },
        ],
    },
    {
        title: 'System',
        items: [
            { to: '/admin/system', label: 'System', icon: Activity },
            { to: '/admin/tasks', label: 'Task history', icon: History, superuserOnly: true },
            { to: '/admin/logs', label: 'Logs', icon: ScrollText },
            { to: '/admin/settings', label: 'Settings', icon: Settings },
            { href: '/django-admin/', label: 'Django admin', icon: ClipboardList, superuserOnly: true, external: true },
        ],
    },
];

export function navFor({ isSuperuser }) {
    return NAV_SECTIONS
        .map((section) => ({ ...section, items: section.items.filter((item) => isSuperuser || !item.superuserOnly) }))
        .filter((section) => section.items.length > 0);
}

/** Every page reachable from the nav, flat (the command palette's "Go to"). */
export function flatNav({ isSuperuser }) {
    return navFor({ isSuperuser }).flatMap((section) => section.items.filter((item) => !item.external));
}
