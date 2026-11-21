import { describe, expect, it } from 'vitest';
import { pickKeyStaff, roleToSentence } from './format';

let nextId = 1;
const credit = (role, name, extra = {}) => ({ id: nextId++, role, staff: { id: name, name, ...extra } });
const roles = (list) => list.map((c) => `${c.role}: ${c.staff.name}`);

describe('pickKeyStaff', () => {
    it('leads with director, series composition, character design and music, dropping producers', () => {
        // Overgeared's first page: producers listed first, the key crew later.
        const staff = [
            credit('Producer', 'Fujishiro'),
            credit('Producer', 'Kawakami'),
            credit('Producer', 'Kim'),
            credit('Assistant Producer', 'Lee'),
            credit('Director', 'Kouno'),
            credit('Sound Director', 'Iwanami'),
            credit('Series Composition', 'Ihara'),
            credit('Music', 'Fujisawa'),
            credit('Character Design', 'LIRAN'),
            credit('Character Design', 'Maeda'),
        ];

        expect(roles(pickKeyStaff(staff))).toEqual([
            'Director: Kouno',
            'Series Composition: Ihara',
            'Character Design: LIRAN',
            'Music: Fujisawa',
        ]);
    });

    it('fills with other crew before per-episode credits, one credit per person', () => {
        // One Piece's first page: producers, then directors who also board episodes.
        const staff = [
            credit('Producer', 'Akahori'),
            credit('Production Manager', 'Akahori'),
            credit('Publicity', 'Ito'),
            credit('Director', 'Fukazawa'),
            credit('Episode Director', 'Fukazawa'),
            credit('Storyboard', 'Fukazawa'),
            credit('Episode Director', 'Ishitani'),
            credit('Art Director', 'Tanaka'),
            credit('Director', 'Uda'),
        ];

        expect(roles(pickKeyStaff(staff))).toEqual([
            'Director: Fukazawa',
            'Director: Uda',
            'Art Director: Tanaka',
            'Episode Director: Ishitani',
        ]);
    });

    it('puts people with a photo first within a role', () => {
        const staff = [
            credit('Director', 'No photo'),
            credit('Director', 'Photo', { image: '/a.jpg' }),
        ];

        expect(roles(pickKeyStaff(staff, { hasPortrait: (person) => Boolean(person.image) }))).toEqual([
            'Director: Photo',
            'Director: No photo',
        ]);
    });

    it('keeps producers only when nobody else is credited, and returns nothing for no staff', () => {
        expect(roles(pickKeyStaff([credit('Producer', 'Solo')]))).toEqual(['Producer: Solo']);
        expect(pickKeyStaff([])).toEqual([]);
        expect(pickKeyStaff(undefined)).toEqual([]);
        expect(pickKeyStaff([{ id: 1, role: 'Director', staff: null }])).toEqual([]);
    });
});

describe('roleToSentence', () => {
    it('lowers Title Case words after the first but keeps acronyms', () => {
        expect(roleToSentence('Series Composition')).toBe('Series composition');
        expect(roleToSentence('ADR Director')).toBe('ADR director');
        expect(roleToSentence('Director of Photography')).toBe('Director of photography');
        expect(roleToSentence('3D CG Director')).toBe('3D CG director');
        expect(roleToSentence('MUSIC')).toBe('Music');
        expect(roleToSentence('')).toBe('');
    });
});
