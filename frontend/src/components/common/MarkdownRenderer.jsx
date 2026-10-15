import React, { useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import DOMPurify from "dompurify";

const ReactMarkdown = lazy(() => import("react-markdown"));

const codeFencePlaceholderPrefix = "ANI_SHOWS_CODE_FENCE_";
const alignedBlockClassNames = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
};

const extractYouTubeId = (url) => {
    // User-authored <youtube> tags may arrive without a src (or with one the
    // sanitizer removed); a throw here would take down the whole page.
    if (typeof url !== "string") return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
};

const extractTextContent = (children) =>
    React.Children.toArray(children)
        .map((child) => {
            if (typeof child === "string" || typeof child === "number") {
                return String(child);
            }
            if (React.isValidElement(child)) {
                return extractTextContent(child.props.children);
            }
            return "";
        })
        .join("");

const encodeAlignedContent = (value = "") => encodeURIComponent(value);

const decodeAlignedContent = (value = "") => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

const protectCodeFences = (content = "") => {
    const codeFences = [];
    const protectedContent = content.replace(/```[\s\S]*?```/g, (match) => {
        const placeholder = `[[${codeFencePlaceholderPrefix}${codeFences.length}]]`;
        codeFences.push(match);
        return placeholder;
    });

    return { protectedContent, codeFences };
};

const restoreCodeFences = (content = "", codeFences = []) =>
    content.replace(
        new RegExp(`\\[\\[${codeFencePlaceholderPrefix}(\\d+)\\]\\]`, "g"),
        (match, index) => codeFences[Number(index)] || match,
    );

const autoLinkPattern = /(^|[\s>(])((?:https?:\/\/|www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s<]*)?)/gi;

const autoLinkPlainDomains = (content = "") => {
    const segments = content.split(/(<[^>]+>)/g);
    let isInsideAnchor = false;

    return segments
        .map((segment) => {
            const isTag = /^<[^>]+>$/.test(segment);
            if (isTag) {
                if (/^<a\b/i.test(segment)) isInsideAnchor = true;
                if (/^<\/a>/i.test(segment)) isInsideAnchor = false;
                return segment;
            }

            if (isInsideAnchor || !segment) return segment;

            return segment.replace(autoLinkPattern, (fullMatch, prefix, rawUrl, offset, originalText) => {
                const urlStart = offset + prefix.length;
                if (originalText.slice(Math.max(0, urlStart - 2), urlStart) === "](") {
                    return fullMatch;
                }

                let normalizedUrl = rawUrl;
                let trailingPunctuation = "";
                while (/[),.!?:;]$/.test(normalizedUrl)) {
                    trailingPunctuation = normalizedUrl.slice(-1) + trailingPunctuation;
                    normalizedUrl = normalizedUrl.slice(0, -1);
                }

                if (!normalizedUrl.includes(".")) {
                    return fullMatch;
                }

                const href = /^https?:\/\//i.test(normalizedUrl)
                    ? normalizedUrl
                    : `https://${normalizedUrl}`;

                return `${prefix}<a href="${href}">${normalizedUrl}</a>${trailingPunctuation}`;
            });
        })
        .join("");
};

const preprocessMarkdown = (content = "") => {
    let processedContent = decodeHtmlEntities(content || "");
    const { protectedContent, codeFences } = protectCodeFences(processedContent);
    processedContent = protectedContent;

    processedContent = processedContent.replace(
        /<(p|div)\s+align=["'](left|center|right)["']\s*>([\s\S]*?)<\/\1>/gi,
        (match, tagName, align, innerContent) => {
            const restoredInnerContent = restoreCodeFences(innerContent.trim(), codeFences);
            return `<alignedblock align="${align.toLowerCase()}" data-md="${encodeAlignedContent(restoredInnerContent)}"></alignedblock>`;
        },
    );

    processedContent = processedContent.replace(
        /\|\|(.*?)\|\|/g,
        '<span class="is-spoiler">$1</span>',
    );

    processedContent = processedContent.replace(
        /@([a-zA-Z0-9_]+)/g,
        '<mention username="$1"></mention>',
    );

    processedContent = processedContent.replace(
        /@\[[^\]]*\]\((.*?)\)/g,
        (match, url) => {
            if (url.includes("youtube.com") || url.includes("youtu.be")) {
                return `<youtube src="${url}"></youtube>`;
            }
            return match;
        },
    );

    processedContent = processedContent.replace(
        /!\[([^\]]*)\]\(([^|)]+)(?:\|(\d+[px%]?))?(?:\|([LlCcRr]))?\)/g,
        (match, alt, url, width, align) => {
            const attrs = [`src="${url}"`, `alt="${alt}"`];
            if (width) {
                const widthValue = width.match(/\d+/) ? (width.includes('%') ? width : width + 'px') : width;
                attrs.push(`data-width="${widthValue}"`);
            }
            if (align) {
                const alignUpper = align.toUpperCase();
                const alignMap = { 'L': 'left', 'C': 'center', 'R': 'right' };
                attrs.push(`data-align="${alignMap[alignUpper] || 'center'}"`);
            }
            return `<img ${attrs.join(' ')} />`;
        },
    );

    processedContent = autoLinkPlainDomains(processedContent);

    processedContent = restoreCodeFences(processedContent, codeFences);

    return DOMPurify.sanitize(processedContent, {
        ADD_TAGS: ['youtube', 'mention', 'alignedblock'],
        ADD_ATTR: ['src', 'username', 'data-align', 'data-width', 'align', 'data-md'],
    });
};

const MarkdownContent = ({ content }) => (
    <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={markdownComponents}
    >
        {content}
    </ReactMarkdown>
);

const AlignedBlock = ({ children, align = "left", sourceContent = "" }) => {
    const nestedContent = sourceContent || extractTextContent(children);
    const alignmentClassName = alignedBlockClassNames[align] || alignedBlockClassNames.left;

    return (
        <div className={`my-4 ${alignmentClassName}`}>
            <MarkdownContent content={preprocessMarkdown(nestedContent)} />
        </div>
    );
};

const Spoiler = ({ children }) => {
    const [revealed, setRevealed] = useState(false);
    return (
        <span
            onClick={() => setRevealed(true)}
            className={`cursor-pointer rounded px-2 py-0.5 mx-0.5 transition-all duration-300 ${revealed ? "bg-gray-800/80 text-gray-200" : "bg-[#1e1f22] text-[#1e1f22] select-none hover:bg-[#2b2d31] hover:text-[#2b2d31]"}`}
            title={revealed ? "" : "Click to reveal spoiler"}
        >
            {children}
        </span>
    );
};

const markdownRemarkPlugins = [remarkGfm, remarkBreaks];
const markdownRehypePlugins = [rehypeRaw];

const markdownComponents = {
    h1: ({ node, ...props }) => (
        <h1
            className="text-2xl font-bold mt-4 mb-2 text-white"
            {...props}
        />
    ),
    h2: ({ node, ...props }) => (
        <h2
            className="text-xl font-bold mt-3 mb-2 text-white"
            {...props}
        />
    ),
    h3: ({ node, ...props }) => (
        <h3 className="text-lg font-bold mt-2 mb-1 text-white" {...props} />
    ),
    a: ({ node, ...props }) => (
        <a
            className="text-accent-light hover:text-accent transition-colors"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
        />
    ),
    p: ({ node, children, ...props }) => {
        const hasAlignedBlockChild = React.Children.toArray(children).some(
            (child) =>
                React.isValidElement(child) &&
                ((typeof child.type === "string" && child.type.toLowerCase() === "alignedblock") ||
                    Object.prototype.hasOwnProperty.call(child.props || {}, "align")),
        );

        if (hasAlignedBlockChild) {
            return (
                <div className="mb-4 last:mb-0 text-gray-200 leading-relaxed" {...props}>
                    {children}
                </div>
            );
        }

        return (
            <p className="mb-4 last:mb-0 text-gray-200 leading-relaxed" {...props}>
                {children}
            </p>
        );
    },
    ul: ({ node, ...props }) => (
        <ul
            className="list-disc list-outside ml-6 mb-4 text-gray-200 space-y-1"
            {...props}
        />
    ),
    ol: ({ node, ...props }) => (
        <ol
            className="list-decimal list-outside ml-6 mb-4 text-gray-200 space-y-1"
            {...props}
        />
    ),
    li: ({ node, ...props }) => <li className="" {...props} />,
    blockquote: ({ node, ...props }) => (
        <blockquote
            className="border-l-4 border-accent/40 px-4 py-1.5 italic text-gray-300 my-4 bg-accent/5 rounded-r-lg inline-block [&>p]:mb-0"
            {...props}
        />
    ),
    pre: ({ node, ...props }) => (
        <pre
            className="inline-block bg-dark p-4 rounded-xl text-sm font-mono text-gray-200 overflow-x-auto border border-gray-800 my-4 max-w-full"
            {...props}
        />
    ),
    code: ({ node, inline, className, ...props }) => {
        if (inline) {
            return (
                <code
                    className="bg-dark text-accent-light px-1.5 py-1 rounded text-[13px] font-mono border border-gray-800"
                    {...props}
                />
            );
        }
        return (
            <code
                className={className ? `${className} text-gray-200` : "text-gray-200"}
                {...props}
            />
        );
    },
    img: ({ node, ...props }) => {
        // Get align and width from data attributes
        const alignValue = props['data-align'] || node?.properties?.dataAlign;
        const widthValue = props['data-width'] || node?.properties?.dataWidth;

        // Clean up props to avoid React warnings about rendering custom data attributes
        const cleanProps = { ...props };
        delete cleanProps['data-align'];
        delete cleanProps['data-width'];

        const alignmentClasses = {
            left: 'mr-auto',
            center: 'mx-auto',
            right: 'ml-auto',
            default: ''
        };

        return (
            <img
                className={`max-w-full h-auto rounded-xl my-4 block ${alignmentClasses[alignValue] || alignmentClasses.default}`}
                style={widthValue ? { width: widthValue } : undefined}
                {...cleanProps}
            />
        );
    },
    hr: ({ node, ...props }) => (
        <hr className="border-gray-800 my-6" {...props} />
    ),
    strong: ({ node, ...props }) => (
        <strong className="font-bold text-white" {...props} />
    ),
    em: ({ node, ...props }) => (
        <em className="italic text-gray-200" {...props} />
    ),
    del: ({ node, ...props }) => (
        <del className="line-through text-gray-400" {...props} />
    ),
    span: ({ node, className, children, ...props }) => {
        if (className === "is-spoiler")
            return <Spoiler>{children}</Spoiler>;
        return (
            <span className={className} {...props}>
                {children}
            </span>
        );
    },
    youtube: ({ node, src, ...props }) => {
        const videoId = extractYouTubeId(src);
        if (!videoId) {
            if (!src) return null;
            return (
                <a href={src} className="text-accent-light">
                    {src}
                </a>
            );
        }
        return (
            <span className="block relative w-full max-w-3xl aspect-video rounded-xl overflow-hidden my-4 border border-gray-800">
                <iframe
                    src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                    title="YouTube video player"
                    allow="fullscreen"
                    allowFullScreen
                    className="absolute top-0 left-0 w-full h-full"
                ></iframe>
            </span>
        );
    },
    mention: ({ node, username, ...props }) => (
        <Link
            to={`/u/${username}`}
            className="text-accent-light hover:text-accent font-medium transition-colors"
        >
            @{username}
        </Link>
    ),
    alignedblock: ({ node, align, children, ...props }) => {
        const encodedContent = props['data-md'] || node?.properties?.['data-md'] || node?.properties?.dataMd || "";
        return <AlignedBlock align={align} sourceContent={decodeAlignedContent(encodedContent)}>{children}</AlignedBlock>;
    },
};

const decodeHtmlEntities = (text = "") => {
    if (!text || typeof text !== "string") return "";
    return text
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, "&");
};

const MarkdownRenderer = ({ content, className = "" }) => {
    const cleanContent = preprocessMarkdown(content || "");

    return (
        <div className={`markdown-preview max-w-none ${className}`}>
            <Suspense fallback={<div className="prose prose-invert"><p>Loading...</p></div>}>
                <MarkdownContent content={cleanContent} />
            </Suspense>
        </div>
    );
};

export default React.memo(MarkdownRenderer);
