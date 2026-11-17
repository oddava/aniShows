/** "· edited" next to a timestamp, with the exact edit time as a tooltip. */
export default function EditedMarker({ editedAt }) {
    if (!editedAt) return null;
    const date = new Date(editedAt);
    if (Number.isNaN(date.getTime())) return null;
    return (
        <>
            <span aria-hidden="true">·</span>
            <time dateTime={editedAt} title={`Edited ${date.toLocaleString()}`}>edited</time>
        </>
    );
}
