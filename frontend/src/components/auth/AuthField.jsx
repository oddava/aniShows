import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

const errorText = (error) => [].concat(error).filter(Boolean).join(' ');

/**
 * A labelled input for the auth pages: the label sits above the input and is
 * tied to it by id, phone keyboards neither capitalise nor autocorrect, and a
 * password field gets a show/hide toggle. No decorative icon inside the field.
 * Errors are announced with role="alert".
 */
export default function AuthField({
    id,
    label,
    // Accepted for older callers; the field no longer draws an icon.
    icon,
    type = 'text',
    error,
    hint,
    className = '',
    ...inputProps
}) {
    const [visible, setVisible] = useState(false);
    const isPassword = type === 'password';
    const message = error ? errorText(error) : '';
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const describedBy = message ? errorId : hint ? hintId : undefined;

    return (
        <div>
            <label htmlFor={id} className="mb-2 block text-[15px] font-medium text-[var(--text-1)]">
                {label}
            </label>
            <div className={`relative rounded-lg ${message ? '[&>input]:!bg-[rgb(242_135_143/0.1)]' : ''}`}>
                <input
                    id={id}
                    type={isPassword && visible ? 'text' : type}
                    inputMode={type === 'email' ? 'email' : undefined}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={describedBy}
                    className={`input min-h-[2.75rem] w-full text-[15px] ${isPassword ? '!pr-12' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
                    {...inputProps}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setVisible((value) => !value)}
                        aria-pressed={visible}
                        aria-label={visible ? 'Hide password' : 'Show password'}
                        className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                    >
                        {visible
                            ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                            : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
                    </button>
                )}
            </div>
            {message && <p id={errorId} role="alert" className="mt-1.5 text-sm text-red-300">{message}</p>}
            {!message && hint && <p id={hintId} className="mt-1.5 text-sm text-[var(--text-2)]">{hint}</p>}
        </div>
    );
}
