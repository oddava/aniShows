import { urlAttributes } from 'html-url-attributes';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import remarkCommunity, { escapeLineStartSpoilers, remarkNoRawHtml, splitAlignedBlocks } from './remarkCommunity';

/*
 * Community markdown (mode="markdown") as a plain hast tree: markdown only, no raw HTML, community
 * syntax from remarkCommunity, links limited to http(s)/mailto/relative. No React here, so the same
 * code runs on the main thread (short text) and in the parse worker (long text, under a time budget).
 * The tree is plain data (positions dropped), so it survives postMessage.
 */

const ALIGN_CLASS_NAMES = { left: 'text-left', center: 'text-center', right: 'text-right' };
const SAFE_PROTOCOL = /^(https?|mailto)$/i;

const processor = unified()
    .use(remarkParse)
    .use(remarkNoRawHtml)
    .use(remarkGfm)
    .use(remarkCommunity)
    .use(remarkBreaks)
    .use(remarkRehype);

/** react-markdown's defaultUrlTransform, limited to http(s)/mailto (plus relative URLs). */
export const communityUrlTransform = (value = '') => {
    const colon = value.indexOf(':');
    const questionMark = value.indexOf('?');
    const numberSign = value.indexOf('#');
    const slash = value.indexOf('/');
    if (
        colon === -1
        || (slash !== -1 && colon > slash)
        || (questionMark !== -1 && colon > questionMark)
        || (numberSign !== -1 && colon > numberSign)
        || SAFE_PROTOCOL.test(value.slice(0, colon))
    ) {
        return value;
    }
    return '';
};

/** What react-markdown does to the tree before rendering: safe URLs, raw HTML as text, no positions. */
const sanitize = (node) => {
    delete node.position;
    if (node.type === 'raw') {
        node.type = 'text';
    } else if (node.type === 'element' && node.properties) {
        for (const [key, tagNames] of Object.entries(urlAttributes)) {
            if (key in node.properties && (tagNames === null || tagNames.includes(node.tagName))) {
                node.properties[key] = communityUrlTransform(String(node.properties[key] ?? ''));
            }
        }
    }
    node.children?.forEach(sanitize);
};

const segmentNodes = (source) => splitAlignedBlocks(source).flatMap((segment) => {
    if (segment.align) {
        return [{
            type: 'element',
            tagName: 'div',
            properties: { className: ['my-4', ALIGN_CLASS_NAMES[segment.align] || ALIGN_CLASS_NAMES.left] },
            children: segmentNodes(segment.content),
        }];
    }
    if (!segment.content.trim()) return [];
    return processor.runSync(processor.parse(escapeLineStartSpoilers(segment.content))).children;
});

/** The hast root for community markdown `source` (as typed: no entity decoding). */
export function buildCommunityTree(source = '') {
    const tree = { type: 'root', children: segmentNodes(source) };
    sanitize(tree);
    return tree;
}
