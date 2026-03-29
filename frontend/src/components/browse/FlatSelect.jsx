import { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { ChevronDown, Check } from 'lucide-react';

const defaultOptionToKey = (option) => String(option.value);

export default function FlatSelect({
  value,
  onChange,
  options,
  placeholder,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  optionClassName = '',
  align = 'left'
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  const selectedOption = useMemo(
    () => options.find((option) => String(option.value) === String(value)) || null,
    [options, value]
  );

  useEffect(() => {
    function handlePointerDown(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const menuAlignmentClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={`flat-control flex w-full items-center justify-between rounded-xl bg-dark-200 px-3 py-2.5 text-left text-sm text-gray-200 outline-none transition-colors focus:outline-none focus-visible:outline-none ${triggerClassName}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={`min-w-0 truncate ${selectedOption ? 'text-gray-200' : 'text-gray-400'}`}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown
          className={`ml-3 h-4 w-4 flex-shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-xl bg-dark-100 p-1.5 shadow-none ${menuAlignmentClass} ${menuClassName}`}
          role="listbox"
        >
          {options.map((option) => {
            const isSelected = String(option.value) === String(value);
            return (
              <button
                key={defaultOptionToKey(option)}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flat-control flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isSelected ? 'bg-dark-200 text-white' : 'bg-transparent text-gray-300 hover:bg-dark-200/85 hover:text-white'
                } ${optionClassName}`}
                role="option"
                aria-selected={isSelected}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && <Check className="ml-3 h-4 w-4 flex-shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

FlatSelect.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    label: PropTypes.string.isRequired
  })).isRequired,
  placeholder: PropTypes.string,
  className: PropTypes.string,
  triggerClassName: PropTypes.string,
  menuClassName: PropTypes.string,
  optionClassName: PropTypes.string,
  align: PropTypes.oneOf(['left', 'right'])
};

FlatSelect.defaultProps = {
  placeholder: 'Select',
  className: '',
  triggerClassName: '',
  menuClassName: '',
  optionClassName: '',
  align: 'left'
};
