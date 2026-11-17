/*
 * Imported first by the parse worker. The markdown parser's entity decoder
 * (decode-named-character-reference) resolves to its DOM build in Vite, which calls
 * `document.createElement` when it loads, and a worker has no `document`. This element never
 * decodes a reference (it reads back what was written), which matches how community text is
 * shown anyway: as typed, with no entity decoding.
 */
if (typeof self.document === 'undefined') {
    self.document = {
        createElement: () => {
            let html = '';
            return {
                set innerHTML(value) {
                    html = value;
                },
                get textContent() {
                    return html;
                },
            };
        },
    };
}
