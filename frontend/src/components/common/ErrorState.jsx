import { useState } from 'react';
import { RotateCcw, WifiOff } from 'lucide-react';
import PropTypes from 'prop-types';

/**
 * A failed load, said plainly, with a retry that refetches in place (no page
 * reload). `onRetry` may return a promise; the button shows progress until it
 * settles.
 */
export default function ErrorState({
  title = 'Something went wrong',
  message = 'We couldn’t load this. Check your connection and try again.',
  onRetry,
  retryLabel = 'Retry',
  className = '',
  children,
}) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div role="alert" className={`ui-empty-state ${className}`}>
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-dark-200 mb-5">
        <WifiOff aria-hidden="true" className="w-6 h-6 text-gray-500" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">{message}</p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {onRetry && (
          <button type="button" onClick={handleRetry} disabled={retrying} className="btn-primary text-sm">
            <RotateCcw aria-hidden="true" className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Retrying…' : retryLabel}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

ErrorState.propTypes = {
  title: PropTypes.string,
  message: PropTypes.string,
  onRetry: PropTypes.func,
  retryLabel: PropTypes.string,
  className: PropTypes.string,
  children: PropTypes.node,
};
