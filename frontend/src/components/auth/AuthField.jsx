import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

const errorText = (error) => [].concat(error).filter(Boolean).join(' ');

/**
 * A labelled input for the auth pages: the label is tied to the input by id,
 * phone keyboards neither capitalise nor autocorrect, and a password field
 * gets a show/hide toggle. Errors are announced with role="alert".
 */
export default function AuthField({
    id,
    label,
    icon: Icon,
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
            <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-2">
                {label}
            </label>
            <div className="relative group">
                {Icon && (
                    <Icon
                        aria-hidden="true"
                        className="absolute left-4 top-3.5 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors"
                    />
                )}
                <input
                    id={id}
                    type={isPassword && visible ? 'text' : type}
                    inputMode={type === 'email' ? 'email' : undefined}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={describedBy}
                    className={`input ${Icon ? '!pl-12' : ''} ${isPassword ? '!pr-12' : ''} w-full ${message ? '!border-red-500 focus:!ring-red-500/20' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
                    {...inputProps}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setVisible((value) => !value)}
                        aria-pressed={visible}
                        aria-label={visible ? 'Hide password' : 'Show password'}
                        className="absolute right-4 top-3.5 text-gray-500 hover:text-gray-300 transition-colors"
                    >
                        {visible
                            ? <EyeOff className="w-5 h-5" aria-hidden="true" />
                            : <Eye className="w-5 h-5" aria-hidden="true" />}
                    </button>
                )}
            </div>
            {message && <p id={errorId} role="alert" className="text-red-400 text-xs mt-1">{message}</p>}
            {!message && hint && <p id={hintId} className="text-gray-500 text-xs mt-1">{hint}</p>}
        </div>
    );
}
