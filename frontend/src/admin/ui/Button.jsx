import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
    // The site's own button classes (index.css), so admin buttons match exactly.
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    // Destructive: a soft rose fill inline, solid only where it confirms.
    danger: 'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-medium min-h-11 bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[rgb(242_135_143/0.2)] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    'danger-solid': 'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 font-semibold min-h-11 bg-[var(--danger)] text-[var(--on-signature)] hover:bg-[#f59ca3] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
};

const SIZES = {
    md: 'text-sm',
    // Compact rows and toolbars: still a 40 px target, padded to 44 by the gap around it.
    sm: '!min-h-10 !px-3.5 !py-1.5 text-sm',
};

/**
 * A button in the site's style. `to` renders a router link, `href` a plain
 * link; `loading` shows a spinner and blocks clicks.
 */
const Button = forwardRef(function Button({
    variant = 'secondary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    disabled,
    to,
    href,
    className = '',
    children,
    type = 'button',
    ...rest
}, ref) {
    const classes = `${VARIANTS[variant] || VARIANTS.secondary} ${SIZES[size] || ''} whitespace-nowrap ${className}`;
    const content = (
        <>
            {loading
                ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                : Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {children}
            {IconRight && <IconRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
        </>
    );

    if (to) {
        return <Link ref={ref} to={to} className={classes} {...rest}>{content}</Link>;
    }
    if (href) {
        return <a ref={ref} href={href} className={classes} {...rest}>{content}</a>;
    }
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={classes}
            {...rest}
        >
            {content}
        </button>
    );
});

export default Button;

const ICON_TONES = {
    neutral: 'text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-white/[0.06]',
    danger: 'text-[var(--text-2)] hover:text-[var(--danger)] hover:bg-[var(--danger-soft)]',
    accent: 'text-[var(--signature)] hover:bg-[var(--signature-soft)]',
};

/** A 44 px icon-only button. `label` is required: it is the accessible name and the tooltip. */
export const IconButton = forwardRef(function IconButton({
    icon: Icon,
    label,
    tone = 'neutral',
    size = 'md',
    className = '',
    to,
    type = 'button',
    ...rest
}, ref) {
    const dimension = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
    const classes = `inline-flex ${dimension} shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ICON_TONES[tone] || ICON_TONES.neutral} ${className}`;
    const icon = <Icon className="h-[18px] w-[18px]" aria-hidden="true" />;
    if (to) {
        return <Link ref={ref} to={to} aria-label={label} title={label} className={classes} {...rest}>{icon}</Link>;
    }
    return (
        <button ref={ref} type={type} aria-label={label} title={label} className={classes} {...rest}>
            {icon}
        </button>
    );
});
