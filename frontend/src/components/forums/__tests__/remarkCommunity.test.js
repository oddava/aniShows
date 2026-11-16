import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkCommunity, {
    MAX_CONTAINER_MARKERS,
    MAX_CONTAINER_NESTING,
    MENTION_PATTERN,
    containerStats,
    exceedsContainerLimits,
    escapeLineStartSpoilers,
    extractYouTubeVideoId,
    fencedCodeRanges,
    maxContainerNesting,
    remarkNoRawHtml,
    splitAlignedBlocks,
} from '../remarkCommunity';

const toTree = (source) => {
    const processor = unified().use(remarkParse).use(remarkNoRawHtml).use(remarkGfm).use(remarkCommunity);
    return processor.runSync(processor.parse(source));
};

const collect = (node, type, out = []) => {
    if (node.type === type) out.push(node);
    (node.children || []).forEach((child) => collect(child, type, out));
    return out;
};

const textOf = (node) =>
    node.type === 'text' || node.type === 'inlineCode' ? node.value : (node.children || []).map(textOf).join('');

const mentions = (value) => [...value.matchAll(MENTION_PATTERN)].map((match) => match[1]);

describe('MENTION_PATTERN (server lookbehind rule)', () => {
    it.each([
        ['@rin', ['rin']],
        ['hi @rin and @kai_2', ['rin', 'kai_2']],
        ['(@rin) "@kai" /@ami', ['rin', 'kai', 'ami']],
        ['line\n@rin', ['rin']],
        ['a@b.com', []],
        ['x.@c y-@d z_@e 9@f', []],
        ['@[youtube](url)', []],
    ])('%j -> %j', (value, expected) => {
        expect(mentions(value)).toEqual(expected);
    });
});

describe('extractYouTubeVideoId', () => {
    it.each([
        ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
        ['https://youtube.com/watch?feature=x&v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
        ['https://youtu.be/dQw4w9WgXcQ?t=3', 'dQw4w9WgXcQ'],
        ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
        ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
        ['https://www.youtube.com/watch?v=short', null],
        ['https://www.youtube.com/watch?v=dQw4w9WgXc"', null],
        ['https://evil.example/watch?v=dQw4w9WgXcQ', null],
        ['javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ', null],
        ['not a url', null],
        [undefined, null],
    ])('%s -> %s', (url, expected) => {
        expect(extractYouTubeVideoId(url)).toBe(expected);
    });
});

describe('source helpers', () => {
    it('finds fenced code ranges, including an unclosed fence', () => {
        const source = 'a\n```\ncode\n```\nb\n~~~\nopen';
        const ranges = fencedCodeRanges(source);
        expect(ranges).toHaveLength(2);
        expect(source.slice(...ranges[0])).toBe('```\ncode\n```');
        expect(source.slice(...ranges[1])).toBe('~~~\nopen');
    });

    it('escapes a line-start >! only when a closing !< follows, and never in code', () => {
        expect(escapeLineStartSpoilers('>!x!<')).toBe('\\>!x!<');
        expect(escapeLineStartSpoilers('> >!x!<')).toBe('> \\>!x!<');
        expect(escapeLineStartSpoilers('- >!x!<')).toBe('- \\>!x!<');
        expect(escapeLineStartSpoilers('>!no close')).toBe('>!no close');
        expect(escapeLineStartSpoilers('```\n>!x!<\n```')).toBe('```\n>!x!<\n```');
        expect(escapeLineStartSpoilers('mid >!x!<')).toBe('mid >!x!<');
    });

    it('splits alignment blocks outside fenced code', () => {
        expect(splitAlignedBlocks('a\n<p align="center"> **x** </p>\nb')).toEqual([
            { content: 'a\n' },
            { align: 'center', content: '**x**' },
            { content: '\nb' },
        ]);
        expect(splitAlignedBlocks("<DIV ALIGN='Right'>r</div>")).toEqual([{ align: 'right', content: 'r' }]);
        expect(splitAlignedBlocks('```\n<p align="left">x</p>\n```')).toEqual([{ content: '```\n<p align="left">x</p>\n```' }]);
        expect(splitAlignedBlocks('<p align="center">no close')).toEqual([{ content: '<p align="center">no close' }]);
        expect(splitAlignedBlocks('<p align="justify">x</p>')).toEqual([{ content: '<p align="justify">x</p>' }]);
    });

    it('does not close an alignment block on a </p> inside fenced code', () => {
        const source = '<p align="center">\n```\n</p>\n```\n</p>';
        const [segment] = splitAlignedBlocks(source);
        expect(segment.align).toBe('center');
        expect(segment.content).toBe('```\n</p>\n```');
    });
});

describe('remarkNoRawHtml', () => {
    it('produces no html nodes and leaves entities undecoded', () => {
        const tree = toTree('<b>x</b>\n\n<div>\nblock\n</div>\n\n&amp; &lt;');
        expect(collect(tree, 'html')).toHaveLength(0);
        expect(textOf(tree)).toContain('<b>x</b>');
        expect(textOf(tree)).toContain('&amp; &lt;');
    });
});

describe('remarkCommunity', () => {
    it('wraps ||x|| in a spoiler node rendered as <spoiler>', () => {
        const [spoiler] = collect(toTree('a ||b|| c'), 'spoiler');
        expect(spoiler.data.hName).toBe('spoiler');
        expect(textOf(spoiler)).toBe('b');
    });

    it('wraps a spoiler across inline formatting', () => {
        const [spoiler] = collect(toTree('||**bold** and *em*||'), 'spoiler');
        expect(spoiler.children.map((child) => child.type)).toEqual(['strong', 'text', 'emphasis']);
    });

    it('does not let ||x|| span lines but lets >!x!< span lines', () => {
        expect(collect(toTree('||a\nb||'), 'spoiler')).toHaveLength(0);
        const [spoiler] = collect(toTree('mid >!a\nb!< end'), 'spoiler');
        expect(textOf(spoiler)).toBe('a\nb');
    });

    it('finds several spoilers in one paragraph and ignores empty ones', () => {
        const tree = toTree('||a|| x ||b|| y >!c!< ||||');
        expect(collect(tree, 'spoiler').map(textOf)).toEqual(['a', 'b', 'c']);
        expect(textOf(tree)).toContain('||||');
    });

    it('creates mention nodes outside links and code only', () => {
        const tree = toTree('@rin `@code` [@link](https://x.y) https://x.com/@url a@b.com **@kai**');
        expect(collect(tree, 'mention').map((node) => node.data.hProperties.username)).toEqual(['rin', 'kai']);
    });

    it('links plain domains like the legacy renderer, but not e.g. or version numbers', () => {
        const tree = toTree('see example.com/path, e.g. v1.2 or 3.14 (docs.example.org)');
        expect(collect(tree, 'link').map((node) => node.url)).toEqual([
            'https://example.com/path',
            'https://docs.example.org',
        ]);
    });

    it('turns @[label](youtube) into a youtube node with only the video id', () => {
        const tree = toTree('watch @[youtube](https://youtu.be/dQw4w9WgXcQ) now');
        const [video] = collect(tree, 'youtube');
        expect(video.data).toEqual({ hName: 'youtube', hProperties: { dataVideoId: 'dQw4w9WgXcQ' } });
        expect(textOf(tree)).toBe('watch  now');
        expect(collect(tree, 'link')).toHaveLength(0);
    });

    it('keeps an invalid youtube id as a plain link without the @', () => {
        const tree = toTree('@[youtube](https://www.youtube.com/watch?v=nope)');
        expect(collect(tree, 'youtube')).toHaveLength(0);
        expect(collect(tree, 'link')[0].url).toBe('https://www.youtube.com/watch?v=nope');
        expect(textOf(tree)).toBe('youtube');
    });

    it('parses sized/aligned https images and turns other images into links', () => {
        const tree = toTree('![a](https://i.example/a.png|300|R) ![b](https://i.example/b.png) ![c](http://i.example/c.png|10|c) ![](data:image/png;base64,AA)');
        const images = collect(tree, 'image');
        expect(images.map((node) => [node.url, node.data.hProperties])).toEqual([
            ['https://i.example/a.png', { dataWidth: '300px', dataAlign: 'right' }],
            ['https://i.example/b.png', {}],
        ]);
        expect(collect(tree, 'link').map((node) => [node.url, textOf(node)])).toEqual([
            ['http://i.example/c.png', 'c'],
            ['data:image/png;base64,AA', 'data:image/png;base64,AA'],
        ]);
    });

    it('resolves image references with the same https rule', () => {
        const tree = toTree('![ok][a] ![bad][b]\n\n[a]: https://i.example/a.png\n[b]: http://i.example/b.png');
        expect(collect(tree, 'image').map((node) => node.url)).toEqual(['https://i.example/a.png']);
        expect(collect(tree, 'imageReference')).toHaveLength(0);
        expect(collect(tree, 'link').map((node) => node.url)).toEqual(['http://i.example/b.png']);
    });

    it('leaves code blocks and inline code untouched', () => {
        const tree = toTree('```\n||x|| @rin ![](https://i.example/a.png)\n```\n\n`||y||`');
        expect(collect(tree, 'spoiler')).toHaveLength(0);
        expect(collect(tree, 'mention')).toHaveLength(0);
        expect(collect(tree, 'image')).toHaveLength(0);
    });
});

// Forum text is hostile and every viewer's browser runs these helpers, so each must stay
// linear: these inputs took seconds to minutes with the earlier regex / rescanning code.
describe('hostile input stays fast', () => {
    const BUDGET_MS = 1500;
    const timed = (fn) => {
        const started = performance.now();
        fn();
        return performance.now() - started;
    };

    it('scans a line of 40 container markers before >! in linear time', () => {
        const source = `>!a!<\n${'> '.repeat(40)}x`;
        expect(timed(() => escapeLineStartSpoilers(source))).toBeLessThan(BUDGET_MS);
    });

    it('handles 100k lines starting with >! and one closer at the end', () => {
        const source = `${'>!x\n'.repeat(100_000)}!<`;
        let escaped;
        expect(timed(() => { escaped = escapeLineStartSpoilers(source); })).toBeLessThan(BUDGET_MS);
        expect(escaped.startsWith(String.raw`\>!x`)).toBe(true);
    });

    it('handles 50k unclosed alignment openers', () => {
        const source = '<p align="left">'.repeat(50_000);
        let segments;
        expect(timed(() => { segments = splitAlignedBlocks(source); })).toBeLessThan(BUDGET_MS);
        expect(segments).toEqual([{ content: source }]);
    });

    it('handles many code fences without a quadratic range lookup', () => {
        const source = '```\nx\n```\n>!y\n'.repeat(20_000);
        expect(timed(() => escapeLineStartSpoilers(`${source}!<`))).toBeLessThan(BUDGET_MS);
    });

    it('wraps spoilers in a paragraph of 20k unclosed >! openers quickly', () => {
        const source = 'a >! '.repeat(20_000);
        const processor = unified().use(remarkParse).use(remarkNoRawHtml).use(remarkCommunity);
        expect(timed(() => processor.runSync(processor.parse(source)))).toBeLessThan(BUDGET_MS * 2);
    });
});

describe('maxContainerNesting (mirrors apps/forums/services/nesting.py)', () => {
    it.each([
        ['plain', 0],
        ['> quote', 1],
        ['> > - 1. item', 4],
        ['>>>> x', 4],
        ['-----', 0],
        ['- - -', 3],
        // Indentation counts half its columns (tab = 4): it continues open list items.
        ['   > three spaces indent', 2],
        ['    > four spaces', 3],
        ['\t- tabbed', 3],
        // The round-3 bypasses: markers continued on an indented line all nest.
        [`- - a\n    ${'- '.repeat(100)}a`, 102],
        [`-\ta\n\t${'- '.repeat(100)}a`, 102],
        [`${' '.repeat(64)}${'- '.repeat(16)}a`, 48],
        ['a\n> b\n> > c', 2],
    ])('%j nests %i containers', (text, depth) => {
        expect(maxContainerNesting(text)).toBe(depth);
    });

    it('is linear on hostile lines', () => {
        const started = performance.now();
        expect(maxContainerNesting(`${'> '.repeat(10_000)}\n${'- '.repeat(10_000)}`)).toBe(10_000);
        expect(performance.now() - started).toBeLessThan(200);
        expect(MAX_CONTAINER_NESTING).toBe(16);
        expect(MAX_CONTAINER_MARKERS).toBe(1500);
    });
});

describe('escapeLineStartSpoilers and fenced code', () => {
    it('ignores a !< inside fenced code when deciding a line-start >! is a spoiler', () => {
        const source = '>! note\n\n```\n!<\n```';
        expect(escapeLineStartSpoilers(source)).toBe(source);
    });

    it('still escapes when a real closer follows outside the fence', () => {
        expect(escapeLineStartSpoilers('>! hidden !<\n```\n!<\n```').startsWith(String.raw`\>!`)).toBe(true);
    });
});

describe('container limits (mirror FORUM_MAX_CONTAINER_NESTING / _MARKERS)', () => {
    it('counts markers across lines', () => {
        expect(containerStats('- a\n- b\n> > c\nplain')).toEqual({ depth: 2, markers: 4 });
    });

    it.each([
        ['an indented-continuation bypass', `- - a\n    ${'- '.repeat(100)}a`],
        ['a tab-continuation bypass', `-\ta\n\t${'- '.repeat(100)}a`],
        ['too many markers in total', '- a\n'.repeat(1501)],
    ])('flags %s', (_name, source) => {
        expect(exceedsContainerLimits(source)).toBe(true);
    });

    it('accepts ordinary nested lists and quotes', () => {
        const list = Array.from({ length: 400 }, (_, i) => `${' '.repeat(2 * (i % 5))}- item ${i}`).join('\n');
        expect(exceedsContainerLimits(list)).toBe(false);
        expect(exceedsContainerLimits('> a\n> > b\n> > > c')).toBe(false);
    });

    it('keeps the worst accepted text fast to parse', () => {
        // At the limits: 1500 markers on lines of depth 15.
        const source = `${'- '.repeat(15)}a\n`.repeat(100);
        expect(exceedsContainerLimits(source)).toBe(false);
        const processor = unified().use(remarkParse).use(remarkNoRawHtml).use(remarkGfm).use(remarkCommunity);
        const started = performance.now();
        processor.runSync(processor.parse(source));
        expect(performance.now() - started).toBeLessThan(1500);
    });
});
