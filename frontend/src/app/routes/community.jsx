// Routes owned by G5 Community. Composed by app/routes.jsx; only G5 edits this file.
import React, { Suspense } from 'react';
import { Route } from 'react-router-dom';

import { ForumCategoryPageSkeleton } from '../../components/forums/ForumSkeletons';
import lazyWithRetry from '../lazyWithRetry';

const forumCategoryListImport = () => import('../../pages/forums/ForumCategoryList');
const forumThreadListImport = () => import('../../pages/forums/ForumThreadList');
const forumThreadDetailImport = () => import('../../pages/forums/ForumThreadDetail');
const createThreadImport = () => import('../../pages/forums/CreateThread');

const ForumCategoryList = lazyWithRetry(forumCategoryListImport);
const ForumThreadList = lazyWithRetry(forumThreadListImport);
const ForumThreadDetail = lazyWithRetry(forumThreadDetailImport);
const CreateThread = lazyWithRetry(createThreadImport);

export const preloadForumChunks = () => {
    forumCategoryListImport();
    forumThreadListImport();
    forumThreadDetailImport();
    createThreadImport();
};

export const communityRoutes = (
    <>
        <Route
            path="forums"
            element={(
                <Suspense fallback={<ForumCategoryPageSkeleton />}>
                    <ForumCategoryList />
                </Suspense>
            )}
        />
        <Route path="forums/create" element={<CreateThread />} />
        <Route path="forums/category/:slug" element={<ForumThreadList />} />
        <Route path="forums/category/:slug/create" element={<CreateThread />} />
        <Route path="forums/thread/:id" element={<ForumThreadDetail />} />
    </>
);
