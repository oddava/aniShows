// Portrait image helpers shared by the detail tabs.

export const PROFILE_PLACEHOLDER = '/placeholder-avatar.png';

export const getPortraitUrl = (entity) => (
    entity?.image_small || entity?.image_medium || entity?.image || PROFILE_PLACEHOLDER
);

export const getPortraitSrcSet = (entity) => {
    const candidates = [
        entity?.image_small ? `${entity.image_small} 60w` : null,
        entity?.image_medium ? `${entity.image_medium} 150w` : null,
    ].filter(Boolean);

    return candidates.length > 0 ? candidates.join(', ') : undefined;
};
