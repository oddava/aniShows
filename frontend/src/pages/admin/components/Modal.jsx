import { useEffect, useId } from 'react';
import PropTypes from 'prop-types';
import { X } from 'lucide-react';

import { useFocusTrap } from '../../../hooks/useFocusTrap';

const SIZE_CLASSES = {
  small: 'max-w-md',
  medium: 'max-w-lg',
  large: 'max-w-2xl',
  xlarge: 'max-w-4xl',
  full: 'max-w-[90vw]',
};

function ModalPanel({ onClose, title, children, size }) {
  const titleId = useId();
  const containerRef = useFocusTrap(true, onClose);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        className={`${SIZE_CLASSES[size] || SIZE_CLASSES.medium} w-full bg-dark-100 border border-white/10 rounded-2xl max-h-[90vh] overflow-hidden flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          {title ? (
            <h2 id={titleId} className="text-xl font-semibold text-white">{title}</h2>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

ModalPanel.propTypes = {
  onClose: PropTypes.func.isRequired,
  title: PropTypes.node,
  children: PropTypes.node,
  size: PropTypes.oneOf(Object.keys(SIZE_CLASSES)),
};

/**
 * Admin dialog: `role="dialog"`, labelled by its title, focus trapped while
 * open and restored to the opener on close, Escape and backdrop close it.
 */
const Modal = ({ isOpen, size = 'medium', ...props }) => {
  if (!isOpen) return null;
  return <ModalPanel size={size} {...props} />;
};

Modal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  ...ModalPanel.propTypes,
};

export default Modal;
