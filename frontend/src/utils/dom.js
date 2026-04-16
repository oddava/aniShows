const EDITABLE_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isKeyboardEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    return (
        EDITABLE_TAG_NAMES.has(target.tagName)
        || target.isContentEditable
        || target.contentEditable === 'true'
        || target.getAttribute('contenteditable') === 'true'
        || target.getAttribute('role') === 'textbox'
    );
}

export function isActiveElementEditable(doc = document) {
    return isKeyboardEditableTarget(doc?.activeElement ?? null);
}
