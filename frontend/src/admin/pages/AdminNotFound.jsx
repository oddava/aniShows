import { Button, EmptyState, PageHeader } from '../ui';

export default function AdminNotFound() {
    return (
        <>
            <PageHeader title="Page not found" />
            <EmptyState
                title="There is no admin page here"
                actions={<Button variant="primary" to="/admin">Back to the dashboard</Button>}
            >
                The link may be old. Search with Ctrl K, or pick a section from the menu.
            </EmptyState>
        </>
    );
}
