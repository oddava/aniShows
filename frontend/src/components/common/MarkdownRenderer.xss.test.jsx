import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import MarkdownRenderer from './MarkdownRenderer';

const PAYLOADS = [
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click](  javascript:alert(1))',
    '<a href="javascript:alert(1)">click</a>',
    '<img src=x onerror="alert(1)">',
    '![x](javascript:alert(1))',
    '<youtube src="javascript:alert(1)"></youtube>',
    '<p align="center"><a href="javascript:alert(1)">c</a></p>',
    '<p align="center">[c](javascript:alert(1))</p>',
    '&lt;img src=x onerror=alert(1)&gt;',
    '<svg><script>alert(1)</script></svg>',
    '<iframe src="https://evil.example"></iframe>',
    '[c](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '<a href="vbscript:msgbox(1)">c</a>',
    // Used to throw during render and blank the page for every visitor.
    '<youtube></youtube>',
];

const renderMarkdown = async (content) => {
    const { container } = render(
        <MemoryRouter>
            <MarkdownRenderer content={content} />
        </MemoryRouter>,
    );
    // ReactMarkdown is lazy: wait until the Suspense fallback is gone.
    await waitFor(() => expect(container.textContent).not.toContain('Loading...'));
    return container;
};

describe('MarkdownRenderer XSS hardening', () => {
    it.each(PAYLOADS)('neutralises %s', async (payload) => {
        const container = await renderMarkdown(payload);
        for (const el of container.querySelectorAll('*')) {
            for (const attr of el.attributes) {
                expect(attr.name.startsWith('on')).toBe(false);
                if (['href', 'src', 'action', 'formaction'].includes(attr.name)) {
                    expect(attr.value.replace(/\s/g, '').toLowerCase()).not.toMatch(/^(javascript|vbscript|data):/);
                }
            }
        }
        expect(container.querySelector('script')).toBeNull();
        const frames = [...container.querySelectorAll('iframe')];
        for (const frame of frames) {
            expect(frame.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
        }
    });
});
