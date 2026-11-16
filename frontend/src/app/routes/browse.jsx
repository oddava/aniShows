// Routes owned by G2 Browse & discover. Composed by app/routes.jsx; only G2 edits this file.
import React from 'react';
import { Navigate, Route } from 'react-router-dom';

import lazyWithRetry from '../lazyWithRetry';

const Home = lazyWithRetry(() => import('../../pages/Home'));
const Browse = lazyWithRetry(() => import('../../pages/Browse'));
const AnimeDetail = lazyWithRetry(() => import('../../pages/AnimeDetail'));
const CharacterDetail = lazyWithRetry(() => import('../../pages/CharacterDetail'));
const Schedule = lazyWithRetry(() => import('../../pages/Schedule'));
const VoiceActorDetail = lazyWithRetry(() => import('../../pages/VoiceActorDetail'));

export const browseRoutes = (
    <>
        <Route index element={<Home />} />
        <Route path="browse" element={<Browse />} />
        <Route path="seasonal" element={<Navigate to="/browse" replace />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="anime/:slug/*" element={<AnimeDetail />} />
        <Route path="character/:id" element={<CharacterDetail />} />
        <Route path="staff/:id" element={<VoiceActorDetail />} />
    </>
);
