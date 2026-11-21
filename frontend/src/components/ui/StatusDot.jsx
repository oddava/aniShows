import { statusMeta } from '../../utils/listStatus';

/** The fixed-colour dot for a list status. Decorative unless `label` is set. */
export default function StatusDot({ status, size = 8, className = '', label = false }) {
    const meta = statusMeta(status);
    if (!meta) return null;
    return (
        <span
            className={`inline-block shrink-0 rounded-full ${className}`}
            style={{ width: size, height: size, backgroundColor: meta.color }}
            {...(label ? { role: 'img', 'aria-label': meta.label } : { 'aria-hidden': true })}
        />
    );
}
