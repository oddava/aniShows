import { describe, expect, it } from 'vitest';
import { getUniqueCharacterRoleCount, getUniqueCharacterRoles } from './characterRoles';

const makeRole = ({ id, characterName, characterImage, role = 'SUPPORTING', voiceActorName, voiceActorImage }) => ({
    id,
    role,
    character: {
        id: id * 10,
        name: characterName,
        image: characterImage,
    },
    voice_actor: voiceActorName
        ? {
            id: id * 100,
            name: voiceActorName,
            image: voiceActorImage,
        }
        : null,
});

describe('character role dedupe', () => {
    it('collapses duplicate character and voice actor rows with different images or roles', () => {
        const roles = [
            makeRole({
                id: 1,
                characterName: 'Anya Forger',
                characterImage: '/old-character.jpg',
                role: 'SUPPORTING',
                voiceActorName: 'Atsumi Tanezaki',
                voiceActorImage: '/old-va.jpg',
            }),
            makeRole({
                id: 2,
                characterName: '  Anya   Forger ',
                characterImage: '/new-character.jpg',
                role: 'MAIN',
                voiceActorName: 'atsumi tanezaki',
                voiceActorImage: '/new-va.jpg',
            }),
        ];

        const uniqueRoles = getUniqueCharacterRoles(roles);

        expect(uniqueRoles).toHaveLength(1);
        expect(uniqueRoles[0].id).toBe(2);
        expect(getUniqueCharacterRoleCount(roles)).toBe(1);
    });

    it('keeps separate entries for the same character with different voice actors', () => {
        const roles = [
            makeRole({
                id: 1,
                characterName: 'Naruto Uzumaki',
                voiceActorName: 'Junko Takeuchi',
            }),
            makeRole({
                id: 2,
                characterName: 'Naruto Uzumaki',
                voiceActorName: 'Ema Kogure',
            }),
        ];

        expect(getUniqueCharacterRoles(roles)).toHaveLength(2);
    });

    it('can collapse preview rows by character only', () => {
        const roles = [
            makeRole({
                id: 1,
                characterName: 'Naruto Uzumaki',
                voiceActorName: 'Junko Takeuchi',
            }),
            makeRole({
                id: 2,
                characterName: 'Naruto Uzumaki',
                voiceActorName: 'Ema Kogure',
            }),
        ];

        expect(getUniqueCharacterRoles(roles, { includeVoiceActor: false })).toHaveLength(1);
    });
});
