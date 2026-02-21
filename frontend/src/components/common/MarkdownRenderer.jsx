import React, { useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import DOMPurify from "dompurify";

const extractYouTubeId = (url) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
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
    p: ({ node, ...props }) => (
        <p className="mb-4 last:mb-0 text-gray-200 leading-relaxed" {...props} />
    ),
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
    code: ({ node, inline, ...props }) =>
        inline ? (
            <code
                className="bg-dark text-accent-light px-1.5 py-1 rounded text-[13px] font-mono border border-gray-800"
                {...props}
            />
        ) : (
            <pre className="inline-block bg-dark p-4 rounded-xl text-sm font-mono text-gray-200 overflow-x-auto border border-gray-800 my-4 max-w-full">
                <code {...props} />
            </pre>
        ),
    img: ({ node, ...props }) => (
        <img
            className="max-w-full h-auto rounded-xl my-4 border border-gray-800"
            {...props}
        />
    ),
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
        if (!videoId)
            return (
                <a href={src} className="text-accent-light">
                    {src}
                </a>
            );
        return (
            <span className="block relative w-full max-w-3xl aspect-video rounded-xl overflow-hidden my-4 border border-gray-800">
                <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title="YouTube video player"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute top-0 left-0 w-full h-full"
                ></iframe>
            </span>
        );
    },
    mention: ({ node, username, ...props }) => (
        <Link
            to={`/profile/${username}`}
            className="text-accent-light hover:text-accent font-medium transition-colors"
        >
            @{username}
        </Link>
    ),
};

const MarkdownRenderer = ({ content, className = "" }) => {
    // Pre-process custom syntax
    let processedContent = content || "";

    // Process spoilers
    processedContent = processedContent.replace(
        /\|\|(.*?)\|\|/g,
        '<span class="is-spoiler">$1</span>',
    );

    // Process mentions: @username -> <mention username="username"></mention>
    processedContent = processedContent.replace(
        /@([a-zA-Z0-9_]+)/g,
        '<mention username="$1"></mention>',
    );

    // Process YouTube: @[youtube](url) -> <youtube url="url"></youtube>
    processedContent = processedContent.replace(
        /@\[[^\]]*\]\((.*?)\)/g,
        (match, url) => {
            if (url.includes("youtube.com") || url.includes("youtu.be")) {
                return `<youtube src="${url}"></youtube>`;
            }
            return match;
        },
    );

    const cleanContent = DOMPurify.sanitize(processedContent, {
        ADD_TAGS: ['youtube', 'mention'],
        ADD_ATTR: ['src', 'username'],
    });

    return (
        <div className={`markdown-preview max-w-none ${className}`}>
            <ReactMarkdown
                remarkPlugins={markdownRemarkPlugins}
                rehypePlugins={markdownRehypePlugins}
                components={markdownComponents}
            >
                {cleanContent}
            </ReactMarkdown>
        </div>
    );
};

export default React.memo(MarkdownRenderer);
