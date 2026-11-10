import BadgesSettings from '../profile/BadgesSettings';

/** The Badges tab (only offered when the user has badges). */
export default function BadgesTab() {
    return (
        <div className="animate-fade-in">
            <BadgesSettings />
        </div>
    );
}
