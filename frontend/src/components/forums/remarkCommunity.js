/**
 * Community markdown syntax as small local remark plugins (MarkdownRenderer mode="markdown").
 *
 * Everything here produces mdast nodes with `data.hName` / `data.hProperties`; nothing builds HTML
 * strings and raw HTML is never parsed (see `remarkNoRawHtml`). Supported syntax, matching what the
 * forum toolbar (RichTextEditor) inserts:
 *   - spoilers `||x||` (single line) and `>!x!<` (may span lines, as in reviews)
 *   - mentions `@name`, with the server's rule: `@` at the start or after a character that is not
 *     `[A-Za-z0-9-_.]` (apps/forums/services/interactions.py); never inside links or code
 *   - YouTube `@[label](url)`: an embed for a valid 11-character id, otherwise a plain link
 *   - sized/aligned images `![alt](url|width|l|c|r)`, https only (others become a text link)
 *   - plain domains (`example.com`) become links, like the legacy renderer
 * Alignment blocks (`<p align="center">…</p>`) are split out of the source by `splitAlignedBlocks`
 * before parsing, because their inner text is itself markdown.
 */

const SKIP_DESCENT = new Set([
    'link', 'linkReference', 'inlineCode', 'code', 'html', 'definition',
    'image', 'imageReference', 'youtube', 'mention', 'math', 'inlineMath',
]);

// Server: (?<=^|(?<=[^a-zA-Z0-9-_\.]))@([A-Za-z0-9_]+)
export const MENTION_PATTERN = /(?<![A-Za-z0-9_.-])@([A-Za-z0-9_]+)/g;

const PLAIN_DOMAIN_PATTERN = /(^|[\s>(])((?:https?:\/\/|www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s<]*)?)/gi;

const YOUTUBE_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
]);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const IMAGE_ALIGN = { l: 'left', c: 'center', r: 'right' };

const text = (value) => ({ type: 'text', value });

const parseUrl = (url) => {
    try {
        return new URL(url);
    } catch {
        return null;
    }
};

export const isYouTubeUrl = (url) => {
    const parsed = typeof url === 'string' ? parseUrl(url.trim()) : null;
    return Boolean(parsed && /^https?:$/.test(parsed.protocol) && YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase()));
};

/** The 11-character video id of a YouTube URL, or null. */
export const extractYouTubeVideoId = (url) => {
    if (!isYouTubeUrl(url)) return null;
    const parsed = parseUrl(url.trim());
    const host = parsed.hostname.toLowerCase();
    let id = null;
    if (host.endsWith('youtu.be')) {
        id = parsed.pathname.split('/')[1] || null;
    } else {
        id = parsed.searchParams.get('v');
        if (!id) {
            const match = parsed.pathname.match(/^\/(?:embed|v|shorts|live)\/([^/]+)/);
            id = match ? match[1] : null;
        }
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
};

/* ------------------------------------------------------------------ source helpers */

/** [start, end) offsets of fenced code blocks (``` or ~~~), so source rewrites can skip them. */
export const fencedCodeRanges = (source = '') => {
    const ranges = [];
    let offset = 0;
    let open = null;
    for (const line of source.split('\n')) {
        const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
        if (open) {
            if (fence && fence[1][0] === open.char && fence[1].length >= open.length && /^ {0,3}(`+|~+)\s*$/.test(line)) {
                ranges.push([open.start, offset + line.length]);
                open = null;
            }
        } else if (fence && !(fence[1][0] === '`' && line.slice(fence[0].length).includes('`'))) {
            open = { char: fence[1][0], length: fence[1].length, start: offset };
        }
        offset += line.length + 1;
    }
    if (open) ranges.push([open.start, source.length]);
    return ranges;
};

/** Whether `index` falls in one of the sorted, non-overlapping `ranges` (binary search). */
const inRanges = (ranges, index) => {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const [start, end] = ranges[mid];
        if (index < start) high = mid - 1;
        else if (index >= end) low = mid + 1;
        else return true;
    }
    return false;
};

const isDigit = (char) => char !== undefined && char >= '0' && char <= '9';
const BULLET_MARKERS = new Set(['>', '-', '*', '+']);

/**
 * Offset of a `>!` that follows only container markers (`>`, `-`, `*`, `+`, `1.`/`1)`, each with up to
 * three leading spaces and one trailing space) at the start of `line`, or -1. One forward scan where
 * every step consumes at least one character, so hostile lines stay linear (no regex backtracking).
 */
const lineStartSpoilerOffset = (line) => {
    let index = 0;
    for (;;) {
        let spaces = 0;
        while (line[index] === ' ' && spaces < 3) {
            index += 1;
            spaces += 1;
        }
        if (line[index] === '>' && line[index + 1] === '!') return index;
        let markerEnd = -1;
        if (BULLET_MARKERS.has(line[index])) {
            markerEnd = index + 1;
        } else if (isDigit(line[index])) {
            let end = index;
            while (end - index < 9 && isDigit(line[end])) end += 1;
            if (line[end] === '.' || line[end] === ')') markerEnd = end + 1;
        }
        if (markerEnd === -1) return -1;
        index = line[markerEnd] === ' ' ? markerEnd + 1 : markerEnd;
    }
};

/**
 * How deeply a line can nest containers, mirroring `apps/forums/services/nesting.py`: half its leading
 * indentation in columns (a list level needs at least two columns to continue) plus every container
 * marker (`>`, a `-`/`*`/`+` bullet followed by whitespace, `1.`/`1)`) with any whitespace between them.
 * Fenced code is counted too: guessing fences differently from the parser would open a bypass.
 *
 * Deep nesting overflows the parser's stack or makes it quadratic, and parse time grows with the
 * total number of markers, so text past either limit is shown as plain text (the server refuses it).
 * Both counts are linear in the length.
 */
export const MAX_CONTAINER_NESTING = 16;
export const MAX_CONTAINER_MARKERS = 1_500;

const isSpaceOrTab = (char) => char === ' ' || char === '\t';

const containerMarkerEnd = (source, index, end) => {
    const char = index < end ? source[index] : '';
    if (char === '>') return index + 1;
    if (char === '-' || char === '*' || char === '+') {
        return index + 1 >= end || isSpaceOrTab(source[index + 1]) ? index + 1 : -1;
    }
    if (!isDigit(char)) return -1;
    let digitsEnd = index;
    while (digitsEnd < end && digitsEnd - index < 9 && isDigit(source[digitsEnd])) digitsEnd += 1;
    return digitsEnd < end && (source[digitsEnd] === '.' || source[digitsEnd] === ')') ? digitsEnd + 1 : -1;
};

const lineContainerNesting = (source, start, end) => {
    let columns = 0;
    let index = start;
    while (index < end && isSpaceOrTab(source[index])) {
        columns += source[index] === '\t' ? 4 - (columns % 4) : 1;
        index += 1;
    }
    let markers = 0;
    for (;;) {
        const markerEnd = containerMarkerEnd(source, index, end);
        if (markerEnd === -1) break;
        markers += 1;
        index = markerEnd;
        while (index < end && isSpaceOrTab(source[index])) index += 1;
    }
    return { depth: Math.floor(columns / 2) + markers, markers };
};

/** `{ depth, markers }`: the deepest line's nesting and the text's total container markers. */
export const containerStats = (source = '') => {
    let depth = 0;
    let markers = 0;
    let start = 0;
    while (start <= source.length) {
        const newline = source.indexOf('\n', start);
        const end = newline === -1 ? source.length : newline;
        const line = lineContainerNesting(source, start, end);
        depth = Math.max(depth, line.depth);
        markers += line.markers;
        start = end + 1;
    }
    return { depth, markers };
};

export const maxContainerNesting = (source = '') => containerStats(source).depth;

/** Whether `source` is past what the markdown parser renders quickly and safely. */
export const exceedsContainerLimits = (source = '') => {
    const { depth, markers } = containerStats(source);
    return depth > MAX_CONTAINER_NESTING || markers > MAX_CONTAINER_MARKERS;
};

/**
 * A line starting with `>!` would parse as a blockquote; when a `!<` follows it is a spoiler, so the
 * `>` is backslash-escaped (outside fenced code).
 */
export const escapeLineStartSpoilers = (source = '') => {
    if (!source.includes('>!')) return source;
    const fences = fencedCodeRanges(source);
    // A spoiler needs a `!<` somewhere after its `>!`: one lookup instead of a scan per line.
    let lastClose = source.lastIndexOf('!<');
    // A `!<` inside fenced code closes nothing: walk back to the last one outside fences.
    while (lastClose !== -1 && inRanges(fences, lastClose)) lastClose = source.lastIndexOf('!<', lastClose - 1);
    let offset = 0;
    return source
        .split('\n')
        .map((line) => {
            const lineStart = offset;
            offset += line.length + 1;
            const markerAt = lineStartSpoilerOffset(line);
            if (markerAt === -1 || inRanges(fences, lineStart)) return line;
            if (lastClose < lineStart + markerAt + 2) return line;
            return `${line.slice(0, markerAt)}\\${line.slice(markerAt)}`;
        })
        .join('\n');
};

/**
 * Split `<p|div align="left|center|right">…</p|div>` blocks (outside fenced code) out of the source.
 * Returns `[{ content }, { align, content }, …]`; aligned content is trimmed, other segments are kept as is.
 */
export const splitAlignedBlocks = (source = '') => {
    const segments = [];
    const fences = fencedCodeRanges(source);
    const opener = /<(p|div)\s+align=["'](left|center|right)["']\s*>/gi;
    // Once a tag has no closer after some opener, no later opener of that tag can find one;
    // remembering it keeps unclosed openers from rescanning the rest of the text each time.
    const unclosed = new Set();
    let cursor = 0;
    let match;
    while ((match = opener.exec(source))) {
        const tag = match[1].toLowerCase();
        if (unclosed.has(tag) || inRanges(fences, match.index)) continue;
        const closer = new RegExp(`</${tag}\\s*>`, 'gi');
        closer.lastIndex = match.index + match[0].length;
        let close = closer.exec(source);
        while (close && inRanges(fences, close.index)) close = closer.exec(source);
        if (!close) {
            unclosed.add(tag);
            continue;
        }
        if (match.index > cursor) segments.push({ content: source.slice(cursor, match.index) });
        segments.push({
            align: match[2].toLowerCase(),
            content: source.slice(match.index + match[0].length, close.index).trim(),
        });
        cursor = close.index + close[0].length;
        opener.lastIndex = cursor;
    }
    if (cursor < source.length) segments.push({ content: source.slice(cursor) });
    return segments;
};

/* ------------------------------------------------------------------ mdast transforms */

/**
 * Where `close` ends the spoiler opened in `children[startIndex]` at `from`: `{ index, at }`, `null` when a
 * line break (or an empty `||||`) stops it, or `false` when no `close` follows at all (then no later
 * opener in these children can close either, so the caller stops: keeps hostile input linear).
 */
const findClose = (children, startIndex, from, close, allowNewline) => {
    for (let j = startIndex; j < children.length; j += 1) {
        const node = children[j];
        if (node.type === 'text') {
            const searchFrom = j === startIndex ? from : 0;
            const closeAt = node.value.indexOf(close, searchFrom);
            const newlineAt = allowNewline ? -1 : node.value.indexOf('\n', searchFrom);
            if (closeAt !== -1 && (newlineAt === -1 || closeAt < newlineAt)) {
                // `||||` is not a spoiler.
                if (j === startIndex && closeAt === from) return null;
                return { index: j, at: closeAt };
            }
            if (newlineAt !== -1) return null;
        } else if (node.type === 'break' && !allowNewline) {
            return null;
        }
    }
    return false;
};

/** Wrap `open … close` (possibly spanning sibling inline nodes) in spoiler nodes. */
const wrapSpoilers = (parent, open, close, allowNewline) => {
    const { children } = parent;
    for (let i = 0; i < children.length; i += 1) {
        const start = children[i];
        if (start.type !== 'text') continue;
        let openAt = start.value.indexOf(open);
        while (openAt !== -1) {
            const from = openAt + open.length;
            const found = findClose(children, i, from, close, allowNewline);
            if (found === false) return;
            if (found) {
                const end = children[found.index];
                const before = start.value.slice(0, openAt);
                const after = end.value.slice(found.at + close.length);
                let inner;
                if (found.index === i) {
                    inner = [text(start.value.slice(from, found.at))];
                } else {
                    inner = [
                        text(start.value.slice(from)),
                        ...children.slice(i + 1, found.index),
                        text(end.value.slice(0, found.at)),
                    ].filter((node) => node.type !== 'text' || node.value);
                }
                const spoiler = { type: 'spoiler', data: { hName: 'spoiler' }, children: inner };
                const replacement = [before && text(before), spoiler, after && text(after)].filter(Boolean);
                children.splice(i, found.index - i + 1, ...replacement);
                if (before) i += 1; // the outer loop then continues with `after`
                break;
            }
            openAt = start.value.indexOf(open, openAt + 1);
        }
    }
};

/** `@` + link to YouTube → embed (valid id) or the plain link. Other `@[x](url)` stay as typed. */
const convertYouTube = (parent) => {
    const { children } = parent;
    for (let i = 1; i < children.length; i += 1) {
        const link = children[i];
        const prev = children[i - 1];
        if (link.type !== 'link' || prev.type !== 'text' || !prev.value.endsWith('@')) continue;
        if (!isYouTubeUrl(link.url)) continue;
        prev.value = prev.value.slice(0, -1);
        const videoId = extractYouTubeVideoId(link.url);
        if (videoId) {
            children[i] = { type: 'youtube', data: { hName: 'youtube', hProperties: { dataVideoId: videoId } } };
        }
        if (!prev.value) {
            children.splice(i - 1, 1);
            i -= 1;
        }
    }
};

/** Replace each text child with the nodes `split(value)` returns (or keep it when it returns null). */
const splitTextChildren = (parent, split) => {
    const next = [];
    for (const node of parent.children) {
        const parts = node.type === 'text' ? split(node.value) : null;
        if (parts) next.push(...parts);
        else next.push(node);
    }
    parent.children = next;
};

const linkPlainDomains = (value) => {
    PLAIN_DOMAIN_PATTERN.lastIndex = 0;
    const parts = [];
    let cursor = 0;
    let match;
    while ((match = PLAIN_DOMAIN_PATTERN.exec(value))) {
        const [, prefix, rawUrl] = match;
        let url = rawUrl;
        while (/[),.!?:;]$/.test(url)) url = url.slice(0, -1);
        const host = url.replace(/^https?:\/\//i, '').split('/')[0];
        const tld = host.split('.').pop();
        // Needs a real-looking TLD so "e.g" or "v1.2" stay text.
        if (!url.includes('.') || !/^[a-z]{2,}$/i.test(tld)) continue;
        const start = match.index + prefix.length;
        if (start > cursor) parts.push(text(value.slice(cursor, start)));
        const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        parts.push({ type: 'link', url: href, title: null, children: [text(url)] });
        cursor = start + url.length;
        PLAIN_DOMAIN_PATTERN.lastIndex = cursor;
    }
    if (!parts.length) return null;
    if (cursor < value.length) parts.push(text(value.slice(cursor)));
    return parts;
};

const linkMentions = (value) => {
    if (!value.includes('@')) return null;
    const parts = [];
    let cursor = 0;
    for (const match of value.matchAll(MENTION_PATTERN)) {
        if (match.index > cursor) parts.push(text(value.slice(cursor, match.index)));
        parts.push({ type: 'mention', data: { hName: 'mention', hProperties: { username: match[1] } } });
        cursor = match.index + match[0].length;
    }
    if (!parts.length) return null;
    if (cursor < value.length) parts.push(text(value.slice(cursor)));
    return parts;
};

const parseImageUrl = (url = '') => {
    const match = /^([^|]+?)(?:\|(\d+)(px|%|p|x)?)?(?:\|([LlCcRr]))?$/.exec(url.trim());
    if (!match) return { src: url.trim() };
    const [, src, width, unit, align] = match;
    return {
        src,
        width: width ? `${width}${unit === '%' ? '%' : 'px'}` : undefined,
        align: align ? IMAGE_ALIGN[align.toLowerCase()] : undefined,
    };
};

/** https images keep their size/alignment; anything else becomes a text link (never an <img>). */
const convertImage = (node, definitions) => {
    const rawUrl = node.type === 'imageReference'
        ? definitions.get(node.identifier)?.url || ''
        : node.url || '';
    const { src, width, align } = parseImageUrl(rawUrl);
    if (!/^https:\/\/[^/]/i.test(src)) {
        return { type: 'link', url: src, title: null, children: [text(node.alt || src)] };
    }
    const hProperties = {};
    if (width) hProperties.dataWidth = width;
    if (align) hProperties.dataAlign = align;
    return { type: 'image', url: src, alt: node.alt || '', title: node.title ?? null, data: { hProperties } };
};

const transformChildren = (parent, definitions) => {
    parent.children = parent.children.map((child) =>
        child.type === 'image' || child.type === 'imageReference' ? convertImage(child, definitions) : child,
    );
    wrapSpoilers(parent, '||', '||', false);
    wrapSpoilers(parent, '>!', '!<', true);
    convertYouTube(parent);
    splitTextChildren(parent, linkPlainDomains);
    splitTextChildren(parent, linkMentions);
};

const walk = (node, definitions) => {
    if (!Array.isArray(node.children)) return;
    transformChildren(node, definitions);
    for (const child of node.children) {
        if (!SKIP_DESCENT.has(child.type)) walk(child, definitions);
    }
};

const collectDefinitions = (node, definitions = new Map()) => {
    if (node.type === 'definition') definitions.set(node.identifier, node);
    if (Array.isArray(node.children)) node.children.forEach((child) => collectDefinitions(child, definitions));
    return definitions;
};

/** remark plugin: spoilers, mentions, YouTube embeds, sized https images, plain-domain links. */
export default function remarkCommunity() {
    return (tree) => {
        walk(tree, collectDefinitions(tree));
    };
}

/**
 * remark plugin: no raw HTML (`<b>` stays literal text) and no entity decoding (`&amp;` stays
 * literal text): forum text is stored and shown exactly as typed.
 */
export function remarkNoRawHtml() {
    const data = this.data();
    const extensions = data.micromarkExtensions || (data.micromarkExtensions = []);
    extensions.push({ disable: { null: ['htmlFlow', 'htmlText', 'characterReference'] } });
}
