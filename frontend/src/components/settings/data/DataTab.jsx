import { useQuery } from '@tanstack/react-query';

import { anilistLinkQueries } from '../../../api/queries/importJobs';
import ExportSection from './ExportSection';
import ImportActivity from './ImportActivity';
import ImportSection from './ImportSection';
import useImportJobs from './useImportJobs';

/** The Import & export tab: bring a list in, see what it changed, take everything out. */
export default function DataTab({ user }) {
    const imports = useImportJobs(user.id);
    const linkQuery = useQuery({ ...anilistLinkQueries.forUser(user.id), retry: false });
    const link = linkQuery.data?.linked ? linkQuery.data : null;
    return (
        <div className="space-y-6">
            <ImportSection user={user} imports={imports} />
            <ImportActivity
                userId={user.id}
                imports={imports}
                link={link}
                disabled={user.email_verified === false || !!imports.running}
            />
            <ExportSection user={user} />
        </div>
    );
}
