import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    // Markdown-mode specific: community syntax carrying hostile URLs.
    '@[youtube](javascript:alert(1))',
    '@[youtube](https://www.youtube.com/watch?v="><script>alert(1)</script>)',
    '![x](javascript:alert(1)|200|c)',
    '![x][evil]\n\n[evil]: javascript:alert(1)',
    '[c][evil]\n\n[evil]: javascript:alert(1)',
    '||[c](javascript:alert(1))||',
    '<p align="center" onclick="alert(1)">x</p>',
    '[c](&#106;avascript:alert(1))',
    '&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;',
];

const MODES = ['legacy', 'markdown'];

const renderMarkdown = async (content, mode) => {
    const props = mode === undefined ? {} : { mode };
    const { container } = render(
        <MemoryRouter>
            <MarkdownRenderer content={content} {...props} />
        </MemoryRouter>,
    );
    // ReactMarkdown is lazy: wait until the Suspense fallback is gone.
    await waitFor(() => expect(container.textContent).not.toContain('Loading...'), { timeout: 5000 });
    return container;
};

describe.each(MODES)('MarkdownRenderer XSS hardening (mode=%s)', (mode) => {
    it.each(PAYLOADS)('neutralises %s', async (payload) => {
        const container = await renderMarkdown(payload, mode);
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
            expect(frame.getAttribute('src')).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}$/);
        }
    });
});

describe('MarkdownRenderer markdown mode: no raw HTML at all', () => {
    it.each(PAYLOADS)('renders no element a user could have typed as HTML: %s', async (payload) => {
        const container = await renderMarkdown(payload, 'markdown');
        for (const tag of ['script', 'svg', 'iframe', 'img', 'youtube', 'mention', 'alignedblock', 'spoiler']) {
            expect(container.querySelector(tag)).toBeNull();
        }
    });
});

/* -------------------------------------------------------------------------- legacy is frozen */

// Captured from the legacy renderer before mode="markdown" existed. Do not regenerate to make a
// failing test pass: a diff here means G1 bios (and old forum rows) render differently.
const LEGACY_PINS = {
    bio: "<div class=\"markdown-preview max-w-none \"><p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">Hi, I am <strong class=\"font-bold text-white\">Rin</strong> &amp; I like <em class=\"italic text-gray-200\">mecha</em>.</p><div class=\"my-4 text-center\"><p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">Centered <strong class=\"font-bold text-white\">bold</strong> text</p></div><ul class=\"list-disc list-outside ml-6 mb-4 text-gray-200 space-y-1\"><li class=\"\">one</li><li class=\"\">two</li></ul><a class=\"text-accent-light hover:text-accent transition-colors\" target=\"_blank\" rel=\"noopener noreferrer\" href=\"https://example.com\">site</a></div>",
    quote: "<div class=\"markdown-preview max-w-none \"><blockquote class=\"border-l-4 border-accent/40 px-4 py-1.5 italic text-gray-300 my-4 bg-accent/5 rounded-r-lg inline-block [&amp;>p]:mb-0\">\n<p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">a quote line</p>\n</blockquote>\n<p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">after</p></div>",
    spoiler: "<div class=\"markdown-preview max-w-none \"><p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">before <span class=\"cursor-pointer rounded px-2 py-0.5 mx-0.5 transition-all duration-300 bg-[#1e1f22] text-[#1e1f22] select-none hover:bg-[#2b2d31] hover:text-[#2b2d31]\" title=\"Click to reveal spoiler\">secret</span> after</p></div>",
    mixed: "<div class=\"markdown-preview max-w-none \"><p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">Hey <a class=\"text-accent-light hover:text-accent font-medium transition-colors\" href=\"/u/rin\" data-discover=\"true\">@rin</a> see <a class=\"text-accent-light hover:text-accent transition-colors\" target=\"_blank\" rel=\"noopener noreferrer\" href=\"https://example.com\">example.com</a> and <img class=\"max-w-full h-auto rounded-xl my-4 block mx-auto\" style=\"width: 200px;\" alt=\"pic\" src=\"https://img.example/a.png\"></p>\n<p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\"><span class=\"block relative w-full max-w-3xl aspect-video rounded-xl overflow-hidden my-4 border border-gray-800\"><iframe src=\"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ\" title=\"YouTube video player\" allow=\"fullscreen\" allowfullscreen=\"\" class=\"absolute top-0 left-0 w-full h-full\"></iframe></span></p>\n<pre class=\"inline-block bg-dark p-4 rounded-xl text-sm font-mono text-gray-200 overflow-x-auto border border-gray-800 my-4 max-w-full\"><code class=\"text-gray-200\">if (a &amp;lt; b) {}\n</code></pre></div>",
    escaped: "<div class=\"markdown-preview max-w-none \"><p class=\"mb-4 last:mb-0 text-gray-200 leading-relaxed\">escaped &amp; html</p></div>",
};

const LEGACY_INPUTS = {
    bio: '<p>Hi, I am <strong>Rin</strong> &amp; I like <em>mecha</em>.</p><p align="center">Centered **bold** text</p><ul><li>one</li><li>two</li></ul><a href="https://example.com">site</a>',
    quote: '> a quote line\n\nafter',
    spoiler: 'before ||secret|| after',
    mixed: 'Hey @rin see example.com and ![pic](https://img.example/a.png|200|c)\n\n@[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)\n\n```\nif (a < b) {}\n```',
    escaped: '&lt;p&gt;escaped &amp;amp; html&lt;/p&gt;',
};

describe('MarkdownRenderer legacy mode is byte-for-byte unchanged', () => {
    it.each(Object.keys(LEGACY_INPUTS))('%s (mode omitted)', async (key) => {
        const container = await renderMarkdown(LEGACY_INPUTS[key]);
        expect(container.innerHTML).toBe(LEGACY_PINS[key]);
    });

    it.each(Object.keys(LEGACY_INPUTS))('%s (mode="legacy")', async (key) => {
        const container = await renderMarkdown(LEGACY_INPUTS[key], 'legacy');
        expect(container.innerHTML).toBe(LEGACY_PINS[key]);
    });
});

/* -------------------------------------------------------------------------- markdown mode */

const md = (content) => renderMarkdown(content, 'markdown');

describe('MarkdownRenderer markdown mode rendering', () => {
    it('renders a line-start "> quote" as a blockquote with the legacy classes', async () => {
        const container = await md('> a quote line\n\nafter');
        const quote = container.querySelector('blockquote');
        expect(quote).not.toBeNull();
        expect(quote.textContent.trim()).toBe('a quote line');
        expect(quote.className).toContain('border-l-4 border-accent/40');
    });

    it('shows a typed "&gt; quote" as text, not a blockquote (text is shown as typed)', async () => {
        const container = await md('&gt; typed entity');
        expect(container.querySelector('blockquote')).toBeNull();
        expect(container.textContent).toBe('&gt; typed entity');
    });

    it('keeps < and & literal inside fenced code', async () => {
        const container = await md('```\nif (a < b && c) {}\n```');
        const code = container.querySelector('pre code');
        expect(code.textContent).toBe('if (a < b && c) {}\n');
    });

    it('keeps HTML inside fenced code as text', async () => {
        const container = await md('```html\n<b>bold</b>\n```');
        expect(container.querySelector('pre code').textContent).toBe('<b>bold</b>\n');
        expect(container.querySelector('b')).toBeNull();
    });

    it('keeps typed entities literal inside code', async () => {
        const container = await md('```\nif (a &lt; b) {}\n```');
        expect(container.querySelector('pre code').textContent).toBe('if (a &lt; b) {}\n');
    });

    it('shows & and typed entities exactly as typed (no decoding)', async () => {
        const container = await md('Tom & Jerry, AT&amp;T, 5 &amp;lt; 6');
        expect(container.textContent).toBe('Tom & Jerry, AT&amp;T, 5 &amp;lt; 6');
    });

    it('shows raw <b>x</b> literally', async () => {
        const container = await md('hello <b>x</b> and <div>block</div>');
        expect(container.querySelector('b')).toBeNull();
        expect(container.textContent).toContain('hello <b>x</b> and <div>block</div>');
    });

    it('shows entity-encoded HTML literally, not as markup', async () => {
        const container = await md('&lt;img src=x onerror=alert(1)&gt;');
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('renders basic markdown with the legacy classes', async () => {
        const container = await md('# Title\n\n**bold** *em* ~~del~~ `code`\n\n- one\n- two');
        expect(container.querySelector('h1').className).toBe('text-2xl font-bold mt-4 mb-2 text-white');
        expect(container.querySelector('strong').className).toBe('font-bold text-white');
        expect(container.querySelector('em').className).toBe('italic text-gray-200');
        expect(container.querySelector('del').className).toBe('line-through text-gray-400');
        expect(container.querySelectorAll('ul li')).toHaveLength(2);
        expect(container.querySelector('p').className).toBe('mb-4 last:mb-0 text-gray-200 leading-relaxed');
    });

    it('keeps single newlines as line breaks', async () => {
        const container = await md('line one\nline two');
        expect(container.querySelector('p br')).not.toBeNull();
    });

    it('opens links in a new tab with rel=noopener noreferrer', async () => {
        const container = await md('[site](https://example.com) and example.org');
        const links = [...container.querySelectorAll('a')];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com', 'https://example.org']);
        for (const link of links) {
            expect(link.getAttribute('target')).toBe('_blank');
            expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        }
    });

    it('allows mailto and relative links, drops other schemes', async () => {
        const container = await md('[m](mailto:a@b.co) [r](/forums/1) [x](xmpp:a@b.co) [i](ircs://x)');
        const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
        expect(hrefs).toEqual(['mailto:a@b.co', '/forums/1', '', '']);
    });

    describe('mentions', () => {
        it('links @name to the profile', async () => {
            const container = await md('hi @rin_2!');
            const link = screen.getByRole('link', { name: '@rin_2' });
            expect(link.getAttribute('href')).toBe('/u/rin_2');
            expect(container.textContent).toBe('hi @rin_2!');
        });

        it('is not a mention inside an email', async () => {
            const container = await md('mail me at someone@example.com');
            expect(container.querySelector('a[href^="/u/"]')).toBeNull();
            expect(container.querySelector('a[href="mailto:someone@example.com"]')).not.toBeNull();
        });

        it('is not a mention inside a URL (with or without a scheme)', async () => {
            const container = await md('https://x.com/@rin and x.com/@kai and www.x.com/@ami');
            expect(container.querySelector('a[href^="/u/"]')).toBeNull();
        });

        it('is not a mention after a word character, dot, dash or underscore', async () => {
            const container = await md('a@b x.@c y-@d z_@e');
            expect(container.querySelector('a[href^="/u/"]')).toBeNull();
        });

        it('is not a mention inside inline code, code blocks or link text', async () => {
            const container = await md('`@rin`\n\n```\n@kai\n```\n\n[@ami](https://example.com)');
            expect(container.querySelector('a[href^="/u/"]')).toBeNull();
        });

        it('matches after punctuation like the server does', async () => {
            await md('(@rin) "@kai"');
            expect(screen.getByRole('link', { name: '@rin' })).toBeInTheDocument();
            expect(screen.getByRole('link', { name: '@kai' })).toBeInTheDocument();
        });
    });

    describe('images', () => {
        it('renders https images with size and alignment', async () => {
            const container = await md('![pic](https://img.example/a.png|200|c)');
            const img = container.querySelector('img');
            expect(img.getAttribute('src')).toBe('https://img.example/a.png');
            expect(img.getAttribute('alt')).toBe('pic');
            expect(img.style.width).toBe('200px');
            expect(img.className).toBe('max-w-full h-auto rounded-xl my-4 block mx-auto');
        });

        it('supports percentage widths and the toolbar default "|200|l"', async () => {
            const container = await md('![](https://img.example/a.png|50%|r)\n\n![](https://img.example/b.png|200|l)');
            const [a, b] = container.querySelectorAll('img');
            expect(a.style.width).toBe('50%');
            expect(a.className).toContain('ml-auto');
            expect(b.className).toContain('mr-auto');
        });

        it('never renders a non-https image; it becomes a text link', async () => {
            const container = await md('![tracker](http://evil.example/p.png|200|c) ![rel](/media/x.png)');
            expect(container.querySelector('img')).toBeNull();
            const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
            expect(hrefs).toEqual(['http://evil.example/p.png', '/media/x.png']);
            expect(container.textContent).toContain('tracker');
        });
    });

    describe('youtube', () => {
        it('embeds a valid video id with the nocookie iframe', async () => {
            const container = await md('@[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)');
            const frame = container.querySelector('iframe');
            expect(frame.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
            expect(frame.getAttribute('title')).toBe('YouTube video player');
            expect(container.textContent).not.toContain('@');
        });

        it('embeds youtu.be links', async () => {
            const container = await md('@[clip](https://youtu.be/dQw4w9WgXcQ?t=3)');
            expect(container.querySelector('iframe').getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
        });

        it('falls back to a plain link for an invalid id', async () => {
            const container = await md('@[youtube](https://www.youtube.com/watch?v=short)');
            expect(container.querySelector('iframe')).toBeNull();
            expect(container.querySelector('a').getAttribute('href')).toBe('https://www.youtube.com/watch?v=short');
        });

        it('leaves @[x](url) for other hosts as typed', async () => {
            const container = await md('@[site](https://example.com)');
            expect(container.querySelector('iframe')).toBeNull();
            expect(container.textContent).toBe('@site');
        });
    });

    describe('spoilers', () => {
        it('renders ||x|| as the shared accessible spoiler, hidden until activated', async () => {
            const container = await md('before ||the twist|| after');
            const button = screen.getByRole('button', { name: 'Spoiler, activate to reveal' });
            expect(button).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByText('the twist')).toBeNull();
            expect(container.textContent).not.toContain('the twist');
            fireEvent.click(button);
            await waitFor(() => expect(screen.getByText('the twist')).toBeInTheDocument());
            expect(button).toHaveAttribute('aria-expanded', 'true');
        });

        it('renders >!x!< (reviews syntax), also at the start of a line', async () => {
            const container = await md('>!line start!<\n\nmid >!inline!< text');
            expect(container.querySelector('blockquote')).toBeNull();
            expect(screen.getAllByRole('button', { name: 'Spoiler, activate to reveal' })).toHaveLength(2);
            expect(container.textContent).not.toContain('line start');
            expect(container.textContent).not.toContain('inline');
        });

        it('does not turn a typed &gt;!x!&lt; into a spoiler', async () => {
            const container = await md('&gt;!typed!&lt;');
            expect(screen.queryByRole('button', { name: 'Spoiler, activate to reveal' })).toBeNull();
            expect(container.textContent).toBe('&gt;!typed!&lt;');
        });

        it('keeps formatting inside a spoiler', async () => {
            const container = await md('||**bold** twist||');
            fireEvent.click(screen.getByRole('button'));
            await waitFor(() => expect(container.querySelector('button strong')?.textContent).toBe('bold'));
        });

        it('does not treat || inside code as a spoiler', async () => {
            const container = await md('`a || b || c`');
            expect(screen.queryByRole('button')).toBeNull();
            expect(container.querySelector('code').textContent).toBe('a || b || c');
        });

        it('leaves a ">!" quote without a closing marker as a blockquote', async () => {
            const container = await md('>!important note');
            expect(container.querySelector('blockquote')).not.toBeNull();
        });
    });

    describe('alignment blocks', () => {
        it('renders <p align> as an aligned div with markdown inside and no raw HTML', async () => {
            const container = await md('<p align="center">Centered **bold** <i>x</i></p>');
            const block = container.querySelector('div.my-4.text-center');
            expect(block).not.toBeNull();
            expect(block.querySelector('strong').textContent).toBe('bold');
            expect(block.querySelector('i')).toBeNull();
            expect(block.textContent).toContain('<i>x</i>');
        });

        it('handles right/left alignment and leaves typed entities alone', async () => {
            const container = await md('<p align="right">to the right</p>\n\n<div align=\'left\'>left</div>\n\n&lt;p align="center"&gt;x&lt;/p&gt;');
            expect(container.querySelector('div.text-right').textContent).toBe('to the right');
            expect(container.querySelector('div.text-left').textContent).toBe('left');
            expect(container.querySelector('div.text-center')).toBeNull();
        });

        it('ignores alignment tags inside fenced code', async () => {
            const container = await md('```\n<p align="center">x</p>\n```');
            expect(container.querySelector('div.text-center')).toBeNull();
            expect(container.querySelector('pre code').textContent).toBe('<p align="center">x</p>\n');
        });
    });
});
