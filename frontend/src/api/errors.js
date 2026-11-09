/**
 * Human-readable message from an API error.
 *
 * Every backend error uses the envelope {detail, code, errors?}, where
 * `detail` already holds the first field error when there are several.
 */
export const getApiErrorMessage = (error, fallback) => {
    const detail = error?.response?.data?.detail;
    return typeof detail === 'string' && detail ? detail : fallback;
};

/** Field errors ({field: [messages]}) from a validation error, or {}. */
export const getApiFieldErrors = (error) => {
    const errors = error?.response?.data?.errors;
    return errors && typeof errors === 'object' && !Array.isArray(errors) ? errors : {};
};
