// Portrait image helpers shared by the detail tabs.

// Catalog sources serve a stock "?" picture for people without a photo
// (MAL's questionmark gif, AniList's default.jpg). Treat those as missing so
// ui/Portrait draws its quiet silhouette instead of a white box.
const PLACEHOLDER_IMAGE = /questionmark|\/default\.(?:jpe?g|png|gif)(?:[?#]|$)|no_image|noimage/i;

const realImage = (url) => (url && !PLACEHOLDER_IMAGE.test(url) ? url : '');

/** The best small picture for a person or character, or '' (ui/Portrait draws a silhouette). */
export const getPortraitUrl = (entity) => (
    realImage(entity?.image_small) || realImage(entity?.image_medium) || realImage(entity?.image) || ''
);

export const getPortraitSrcSet = (entity) => {
    const small = realImage(entity?.image_small);
    const medium = realImage(entity?.image_medium);
    const candidates = [
        small ? `${small} 60w` : null,
        medium ? `${medium} 150w` : null,
    ].filter(Boolean);

    return candidates.length > 0 ? candidates.join(', ') : undefined;
};
