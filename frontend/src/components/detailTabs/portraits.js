// Portrait image helpers shared by the detail tabs.

/** The best small picture for a person or character, or '' (ui/Portrait draws a silhouette). */
export const getPortraitUrl = (entity) => (
    entity?.image_small || entity?.image_medium || entity?.image || ''
);

export const getPortraitSrcSet = (entity) => {
    const candidates = [
        entity?.image_small ? `${entity.image_small} 60w` : null,
        entity?.image_medium ? `${entity.image_medium} 150w` : null,
    ].filter(Boolean);

    return candidates.length > 0 ? candidates.join(', ') : undefined;
};
