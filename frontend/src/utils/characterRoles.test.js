import { describe, expect, it } from 'vitest';
import {
    getUniqueCharacterRoleCount,
    getUniqueCharacterRoles,
    groupRolesByAnime,
    markupToPlainText,
    toSafeHttpUrl,
} from './characterRoles';

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

    it('collapses comma-ordered character and voice actor names', () => {
        const roles = [
            makeRole({
                id: 1,
                characterName: 'Subaru Natsuki',
                role: 'MAIN',
                voiceActorName: 'Yuusuke Kobayashi',
            }),
            makeRole({
                id: 2,
                characterName: 'Natsuki, Subaru',
                role: 'MAIN',
                voiceActorName: 'Kobayashi, Yuusuke',
            }),
            makeRole({
                id: 3,
                characterName: 'Beatrice',
                role: 'MAIN',
                voiceActorName: 'Satomi Arai',
            }),
            makeRole({
                id: 4,
                characterName: 'Beatrice',
                role: 'SUPPORTING',
                voiceActorName: 'Arai, Satomi',
            }),
        ];

        const uniqueRoles = getUniqueCharacterRoles(roles);

        expect(uniqueRoles).toHaveLength(2);
        expect(uniqueRoles[0].character.name).toBe('Subaru Natsuki');
        expect(uniqueRoles[0].voice_actor.name).toBe('Yuusuke Kobayashi');
        expect(uniqueRoles[1].character.name).toBe('Beatrice');
        expect(uniqueRoles[1].voice_actor.name).toBe('Satomi Arai');
        expect(getUniqueCharacterRoleCount(roles)).toBe(2);
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

describe('groupRolesByAnime', () => {
    const anime = (id) => ({ id, slug: `anime-${id}`, title: `Anime ${id}` });

    it('lists each anime once with its distinct people and roles, in first-seen order', () => {
        const groups = groupRolesByAnime([
            { id: 1, anime: anime(2), role: 'MAIN', voice_actor: { id: 7, name: 'Atsumi Tanezaki' } },
            { id: 2, anime: anime(1), role: 'MAIN', voice_actor: { id: 7, name: 'Atsumi Tanezaki' } },
            { id: 3, anime: anime(2), role: 'MAIN', voice_actor: { id: 8, name: 'Mallorie Rodak' } },
            { id: 4, anime: anime(2), role: 'MAIN', voice_actor: { id: 7, name: 'Atsumi Tanezaki' } },
            { id: 5, anime: anime(1), role: 'SUPPORTING', voice_actor: null },
        ], { personField: 'voice_actor' });

        expect(groups.map((group) => group.anime.id)).toEqual([2, 1]);
        expect(groups[0].people.map((person) => person.id)).toEqual([7, 8]);
        expect(groups[0].roles).toEqual(['MAIN']);
        expect(groups[1].people.map((person) => person.id)).toEqual([7]);
        expect(groups[1].roles).toEqual(['MAIN', 'SUPPORTING']);
    });

    it('returns an empty list for missing roles', () => {
        expect(groupRolesByAnime(undefined)).toEqual([]);
    });
});

describe('toSafeHttpUrl', () => {
    it('accepts absolute http(s) links only', () => {
        expect(toSafeHttpUrl('https://anilist.co/character/1')).toBe('https://anilist.co/character/1');
        expect(toSafeHttpUrl('http://example.com/a')).toBe('http://example.com/a');
        expect(toSafeHttpUrl('javascript:alert(1)')).toBeNull();
        expect(toSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
        expect(toSafeHttpUrl('/relative/path')).toBeNull();
        expect(toSafeHttpUrl('vbscript:x')).toBeNull();
        expect(toSafeHttpUrl('')).toBeNull();
    });
});

describe('markupToPlainText', () => {
    it('drops spoilers, tags, link targets and emphasis markers', () => {
        expect(markupToPlainText('__Height:__ 160 cm<br>She is [Fern](https://anilist.co/character/2)\'s **teacher**. ~!She dies.!~ End'))
            .toBe("Height: 160 cm She is Fern's teacher. End");
    });

    it('cuts to the requested length', () => {
        expect(markupToPlainText('a'.repeat(300))).toHaveLength(160);
    });
});
