import { describe, expect, it } from 'vitest';
import { isActiveElementEditable, isKeyboardEditableTarget } from './dom';

describe('dom keyboard target helpers', () => {
    it('returns false for null and non-elements', () => {
        expect(isKeyboardEditableTarget(null)).toBe(false);
        expect(isKeyboardEditableTarget(document)).toBe(false);
    });

    it('detects editable form controls and contenteditable elements', () => {
        const input = document.createElement('input');
        const textarea = document.createElement('textarea');
        const select = document.createElement('select');
        const contentEditable = document.createElement('div');
        contentEditable.contentEditable = 'true';
        const textboxRole = document.createElement('div');
        textboxRole.setAttribute('role', 'textbox');
        const plainDiv = document.createElement('div');

        expect(isKeyboardEditableTarget(input)).toBe(true);
        expect(isKeyboardEditableTarget(textarea)).toBe(true);
        expect(isKeyboardEditableTarget(select)).toBe(true);
        expect(isKeyboardEditableTarget(contentEditable)).toBe(true);
        expect(isKeyboardEditableTarget(textboxRole)).toBe(true);
        expect(isKeyboardEditableTarget(plainDiv)).toBe(false);
    });

    it('treats a missing active element as non-editable', () => {
        expect(isActiveElementEditable({ activeElement: null })).toBe(false);
    });
});
