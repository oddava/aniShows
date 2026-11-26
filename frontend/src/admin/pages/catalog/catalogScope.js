import { humanize } from '../../format';

let regionNames = null;
const countryName = (code) => {
    try {
        regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
        return regionNames.of(code) || code;
    } catch {
        return code;
    }
};

/**
 * Why a title is outside the catalog's scope, in words: "Made in China",
 * "Music video". Reasons come from the catalog engine (`country:CN`, `format:MUSIC`).
 */
export function exclusionLabel(reason) {
    if (!reason) return '';
    const [kind, value = ''] = String(reason).split(':');
    if (kind === 'country') return `Made in ${countryName(value)}`;
    if (kind === 'format') return value === 'MUSIC' ? 'Music video' : `${humanize(value.toLowerCase())} format`;
    if (reason === 'legacy:quarantined') return 'Held back by the old offline sync';
    return humanize(reason);
}
