import { Award, Crown, Shield, Star, Zap } from 'lucide-react';

import { getImageUrl } from '../../../utils/imageUtils';

/** The icons and colour keys the site's badge renderer knows (components/profile/UserBadges.jsx). */
export const BADGE_ICONS = { award: Award, shield: Shield, star: Star, zap: Zap, crown: Crown };

export const BADGE_COLORS = {
    blue: { label: 'Blue', fg: '#8db1ff', bg: 'rgb(141 177 255 / 0.14)' },
    green: { label: 'Green', fg: '#86cc90', bg: 'rgb(134 204 144 / 0.14)' },
    yellow: { label: 'Yellow', fg: '#e9d56a', bg: 'rgb(233 213 106 / 0.14)' },
    purple: { label: 'Purple', fg: '#b8a5ff', bg: 'rgb(184 165 255 / 0.14)' },
    amber: { label: 'Amber', fg: '#e9b46a', bg: 'rgb(233 180 106 / 0.14)' },
    red: { label: 'Red', fg: '#f2878f', bg: 'rgb(242 135 143 / 0.14)' },
};

export const badgeColor = (key) => BADGE_COLORS[key] || BADGE_COLORS.blue;

/** The badge's own mark: its uploaded image, else its icon on its colour. */
export function BadgeMark({ badge, size = 'md', src }) {
    const Icon = BADGE_ICONS[badge?.icon] || Award;
    const color = badgeColor(badge?.color);
    const dimension = size === 'lg' ? 'h-12 w-12' : size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
    const iconSize = size === 'lg' ? 'h-6 w-6' : size === 'sm' ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]';
    const image = src || badge?.image;
    return (
        <span
            aria-hidden="true"
            className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] ${dimension}`}
            style={{ background: color.bg, color: color.fg }}
        >
            {image ? <img src={src || getImageUrl(image)} alt="" className="h-full w-full object-cover" /> : <Icon className={iconSize} />}
        </span>
    );
}

/** The badge as members see it: a small pill with its mark and name. */
export function BadgePill({ badge, src }) {
    const Icon = BADGE_ICONS[badge?.icon] || Award;
    const color = badgeColor(badge?.color);
    const image = src || badge?.image;
    return (
        <span
            className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium"
            style={{ background: color.bg, color: color.fg }}
        >
            {image ? <img src={src || getImageUrl(image)} alt="" className="h-3.5 w-3.5 rounded-sm object-cover" /> : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="truncate">{badge?.name || 'Badge name'}</span>
        </span>
    );
}
