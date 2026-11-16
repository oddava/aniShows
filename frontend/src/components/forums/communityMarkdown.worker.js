/* Parses long community markdown off the main thread (see useCommunityTree). */
// Must stay the first import: the parser's dependencies read `document` while loading.
import './workerDomShim';
import { buildCommunityTree } from './communityMarkdownTree';

self.onmessage = (event) => {
    const { id, source } = event.data;
    let reply;
    try {
        reply = { id, tree: buildCommunityTree(source) };
    } catch {
        // e.g. a stack overflow on pathological nesting: the post is shown as plain text.
        reply = { id, failed: true };
    }
    self.postMessage(reply);
};
