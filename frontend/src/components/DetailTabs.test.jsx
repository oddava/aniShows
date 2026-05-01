import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CharactersTab } from './DetailTabs';

const makeRole = ({ id, characterName, characterImage, role = 'SUPPORTING', voiceActorName, voiceActorImage }) => ({
    id,
    role,
    character: {
        id: id * 10,
        name: characterName,
        image: characterImage,
    },
    voice_actor: {
        id: id * 100,
        name: voiceActorName,
        image: voiceActorImage,
    },
});

describe('CharactersTab', () => {
    it('renders one card for duplicate character and voice actor rows', () => {
        const anime = {
            characters: [
                makeRole({
                    id: 1,
                    characterName: 'Anya Forger',
                    characterImage: '/anya-old.jpg',
                    voiceActorName: 'Atsumi Tanezaki',
                    voiceActorImage: '/atsumi-old.jpg',
                }),
                makeRole({
                    id: 2,
                    characterName: 'Anya Forger',
                    characterImage: '/anya-new.jpg',
                    role: 'MAIN',
                    voiceActorName: 'Atsumi Tanezaki',
                    voiceActorImage: '/atsumi-new.jpg',
                }),
            ],
        };

        render(
            <MemoryRouter>
                <CharactersTab anime={anime} isLoading={false} />
            </MemoryRouter>
        );

        expect(screen.getAllByText('Anya Forger')).toHaveLength(1);
        expect(screen.getAllByText('Atsumi Tanezaki')).toHaveLength(1);
    });
});
