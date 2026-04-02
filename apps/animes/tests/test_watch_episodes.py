from unittest.mock import AsyncMock, patch

import httpx
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.animes.models import Anime
from apps.animes.services.watch_episodes import AnimeWatchEpisodeService


class AnimeWatchEpisodeServiceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.anime = Anime.objects.create(
            title='Frieren',
            slug='frieren',
            synopsis='Elf mage.',
            anime_type='TV',
            status='Finished',
            mal_id=52991,
            anilist_id=154587,
        )
        self.service = AnimeWatchEpisodeService()

    def _jikan_response(self, payload, status_code=200):
        return httpx.Response(
            status_code=status_code,
            json=payload,
            request=httpx.Request('GET', f'https://api.jikan.moe/v4/anime/{self.anime.mal_id}/episodes'),
        )

    @patch(
        'apps.animes.services.watch_episodes.AniListService.get_streaming_episodes_for_anime',
        new_callable=AsyncMock,
    )
    @patch('apps.animes.services.watch_episodes.httpx.AsyncClient.get', new_callable=AsyncMock)
    def test_merges_jikan_episodes_with_anilist_crunchyroll_links(self, mock_jikan_get, mock_streams):
        mock_streams.return_value = {
            'idMal': self.anime.mal_id,
            'streamingEpisodes': [
                {
                    'title': 'Episode 1 - The Journey Begins',
                    'thumbnail': 'https://img.anilist.co/episode-1.jpg',
                    'url': 'https://www.crunchyroll.com/watch/G62PE001',
                    'site': 'Crunchyroll',
                },
                {
                    'title': 'Episode 2 - Other Service',
                    'thumbnail': 'https://img.anilist.co/episode-2.jpg',
                    'url': 'https://www.netflix.com/watch/123',
                    'site': 'Netflix',
                },
            ],
        }
        mock_jikan_get.return_value = self._jikan_response(
            {
                'pagination': {'has_next_page': False},
                'data': [
                    {
                        'mal_id': 1,
                        'url': 'https://myanimelist.net/anime/52991/frieren/episode/1',
                        'title': 'The Journey Begins',
                        'aired': '2024-01-12T00:00:00+00:00',
                    },
                    {
                        'mal_id': 2,
                        'url': 'https://myanimelist.net/anime/52991/frieren/episode/2',
                        'title': 'A Normal Day',
                        'aired': '2024-01-19T00:00:00+00:00',
                    },
                ],
            }
        )

        episodes = self.service.get_for_anime(self.anime)

        self.assertEqual(len(episodes), 2)
        self.assertEqual(episodes[0]['number'], 1)
        self.assertEqual(episodes[0]['title'], 'The Journey Begins')
        self.assertEqual(episodes[0]['aired'], '2024-01-12')
        self.assertEqual(episodes[0]['thumbnail'], 'https://img.anilist.co/episode-1.jpg')
        self.assertEqual(
            episodes[0]['crunchyroll_url'],
            'https://www.crunchyroll.com/watch/G62PE001',
        )
        self.assertTrue(episodes[0]['has_real_crunchyroll_url'])

        self.assertEqual(episodes[1]['number'], 2)
        self.assertEqual(episodes[1]['title'], 'A Normal Day')
        self.assertEqual(
            episodes[1]['crunchyroll_url'],
            'https://www.crunchyroll.com/search?q=Frieren+episode+2',
        )
        self.assertFalse(episodes[1]['has_real_crunchyroll_url'])

    @patch(
        'apps.animes.services.watch_episodes.AniListService.get_streaming_episodes_for_anime',
        new_callable=AsyncMock,
    )
    @patch('apps.animes.services.watch_episodes.httpx.AsyncClient.get', new_callable=AsyncMock)
    def test_caches_merged_episode_payload(self, mock_jikan_get, mock_streams):
        mock_streams.return_value = {'idMal': self.anime.mal_id, 'streamingEpisodes': []}
        mock_jikan_get.return_value = self._jikan_response(
            {
                'pagination': {'has_next_page': False},
                'data': [
                    {
                        'mal_id': 1,
                        'url': 'https://myanimelist.net/anime/52991/frieren/episode/1',
                        'title': 'The Journey Begins',
                        'aired': '2024-01-12T00:00:00+00:00',
                    }
                ],
            }
        )

        first = self.service.get_for_anime(self.anime)
        second = self.service.get_for_anime(self.anime)

        self.assertEqual(first, second)
        mock_streams.assert_awaited_once()
        mock_jikan_get.assert_awaited_once()


class AnimeWatchEpisodesEndpointTests(APITestCase):
    @patch('apps.animes.signals.enrich_metadata.delay')
    @patch('apps.animes.views.anime.AnimeWatchEpisodeService.get_for_anime')
    def test_watch_episodes_endpoint_returns_paginated_results(self, mock_get_for_anime, _mock_delay):
        anime = Anime.objects.create(
            title='Delicious in Dungeon',
            slug='delicious-in-dungeon',
            synopsis='Cooking in a dungeon.',
            anime_type='TV',
            status='Finished',
        )
        mock_get_for_anime.return_value = [
            {
                'number': index,
                'title': f'Episode {index}',
                'aired': '2024-01-04',
                'thumbnail': 'https://img.anilist.co/dungeon-meshi-1.jpg',
                'crunchyroll_url': 'https://www.crunchyroll.com/watch/GEXAMPLE',
                'has_real_crunchyroll_url': True,
            }
            for index in range(1, 55)
        ]

        response = self.client.get(
            reverse('anime-watch-episodes', args=[anime.slug]),
            {'page': 2, 'page_size': 20},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 54)
        self.assertEqual(len(response.data['results']), 20)
        self.assertEqual(response.data['results'][0]['number'], 21)
        self.assertEqual(response.data['results'][0]['title'], 'Episode 21')
