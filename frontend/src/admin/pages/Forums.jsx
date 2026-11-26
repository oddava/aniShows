import { useSearchParams } from 'react-router-dom';

import { Button, PageHeader, Panel, Tabs } from '../ui';
import PostsTab from './community/PostsTab';
import { CategoriesTab, TagsTab } from './community/TaxonomyTabs';
import ThreadsTab from './community/ThreadsTab';

const TABS = [
    { value: 'threads', label: 'Threads', component: ThreadsTab },
    { value: 'posts', label: 'Replies', component: PostsTab },
    { value: 'categories', label: 'Categories', component: CategoriesTab },
    { value: 'tags', label: 'Tags', component: TagsTab },
];

/**
 * The forums from the staff side: threads and replies to pin, lock, move,
 * remove or restore, and the categories and tags they are filed under.
 * The tab lives in `?tab=`; switching tabs starts that tab unfiltered.
 */
export default function Forums() {
    const [searchParams, setSearchParams] = useSearchParams();
    const requested = searchParams.get('tab');
    const active = TABS.find((tab) => tab.value === requested) || TABS[0];
    const Active = active.component;

    return (
        <>
            <PageHeader
                title="Forums"
                description="Keep discussions in order: pin and lock threads, move them, and remove what breaks the rules."
                actions={<Button variant="secondary" to="/forums" target="_blank" rel="noopener">Open the forums</Button>}
            />
            {/* Tabs sit above the panel, as on every admin page with sections. */}
            <Tabs
                label="Forum sections"
                items={TABS}
                value={active.value}
                onChange={(value) => setSearchParams(value === 'threads' ? {} : { tab: value })}
                panelId="forums-panel"
                className="mb-4"
            />
            <Panel id="forums-panel" role="tabpanel">
                <Active key={active.value} />
            </Panel>
        </>
    );
}
