import ExportSection from './ExportSection';
import ImportSection from './ImportSection';
import useImportJobs from './useImportJobs';

/** The Import & export tab: bring a list in, keep AniList in sync, take everything out. */
export default function DataTab({ user }) {
    const imports = useImportJobs(user.id);
    return (
        <div className="space-y-6">
            <ImportSection user={user} imports={imports} />
            <ExportSection user={user} />
        </div>
    );
}
