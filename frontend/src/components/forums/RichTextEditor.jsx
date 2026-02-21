import React, { useState, useRef, useId, useEffect } from 'react';
import MarkdownRenderer from '../common/MarkdownRenderer';
import TextareaAutosize from 'react-textarea-autosize';
import {
    Bold, Italic, Strikethrough, Link as LinkIcon, List, ListOrdered,
    Heading1, Heading2, Heading3, Code, Quote, Minus, Image, Eye, Edit3, AtSign,
    Youtube, EyeOff
} from 'lucide-react';

const UrlModal = ({ isOpen, type, onClose, onSubmit }) => {
    const [url, setUrl] = useState('');
    const [text, setText] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current.focus(), 50);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        onSubmit(url, text);
        setUrl('');
        setText('');
    };

    const handleClose = () => {
        onClose();
        setUrl('');
        setText('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="bg-dark-100 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative">
                <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
                    {type === 'link' ? <LinkIcon size={18} className="text-accent" /> :
                        type === 'youtube' ? <Youtube size={18} className="text-red-500" /> :
                            <Image size={18} className="text-accent" />}
                    Insert {type === 'link' ? 'Link' : type === 'youtube' ? 'YouTube Video' : 'Image'}
                </h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-wider">{type === 'youtube' ? 'YouTube URL' : 'URL'}</label>
                        <input
                            ref={inputRef}
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://..."
                            className="w-full px-4 py-2.5 bg-dark border border-gray-700 rounded-xl focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 text-white text-sm transition-all"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1.5 uppercase tracking-wider">
                            {type === 'link' ? 'Link Text (Optional)' : type === 'youtube' ? 'Video Title (Optional)' : 'Alt Text (Optional)'}
                        </label>
                        <input
                            type="text"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder={type === 'link' ? "Click here" : "Image description"}
                            className="w-full px-4 py-2.5 bg-dark border border-gray-700 rounded-xl focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 text-white text-sm transition-all"
                        />
                    </div>
                    <div className="flex items-center justify-end gap-3 pt-4 mt-2">
                        <button type="button" onClick={handleClose} className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors">
                            Cancel
                        </button>
                        <button type="button" onClick={handleSubmit} className="btn-primary px-5 py-2 text-sm font-bold rounded-xl">
                            Insert
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RichTextEditor = ({ value, onChange, placeholder = "Write something...", className = "", hideDesktopPreview = false }) => {
    const [modalConfig, setModalConfig] = useState({ isOpen: false, type: 'link' });
    const [activeTab, setActiveTab] = useState('write');
    const editorId = useId();
    const textareaRef = useRef(null);

    const insertText = (before, after = '', newLine = false) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = value.substring(start, end);
        const prefix = newLine && start > 0 && value[start - 1] !== '\n' ? '\n' : '';
        const newText = value.substring(0, start) + prefix + before + selectedText + after + value.substring(end);
        onChange(newText);
        setTimeout(() => {
            textarea.focus();
            const offset = prefix.length + before.length;
            textarea.setSelectionRange(start + offset, start + offset + selectedText.length);
        }, 0);
    };

    const handleModalSubmit = (url, text) => {
        const type = modalConfig.type;
        setModalConfig({ isOpen: false, type: 'link' });

        const display = text.trim() || url;
        if (type === 'link') {
            insertText(`[${display}](`, `${url})`);
        } else if (type === 'youtube') {
            insertText(`@[youtube](`, `${url})`);
        } else {
            insertText(`![${display}](`, `${url})`);
        }
    };

    const tools = [
        { icon: Bold, label: 'Bold (Ctrl/Cmd+B)', action: () => insertText('**', '**'), group: 'format' },
        { icon: Italic, label: 'Italic (Ctrl/Cmd+I)', action: () => insertText('*', '*'), group: 'format' },
        { icon: Strikethrough, label: 'Strikethrough', action: () => insertText('~~', '~~'), group: 'format' },
        { icon: Code, label: 'Inline Code', action: () => insertText('`', '`'), group: 'format' },
        { icon: Heading1, label: 'Heading 1', action: () => insertText('# ', '', true), group: 'heading' },
        { icon: Heading2, label: 'Heading 2', action: () => insertText('## ', '', true), group: 'heading' },
        { icon: Heading3, label: 'Heading 3', action: () => insertText('### ', '', true), group: 'heading' },
        { icon: List, label: 'Bullet List', action: () => insertText('- ', '', true), group: 'block' },
        { icon: ListOrdered, label: 'Numbered List', action: () => insertText('1. ', '', true), group: 'block' },
        { icon: Quote, label: 'Blockquote', action: () => insertText('> ', '', true), group: 'block' },
        { icon: Minus, label: 'Horizontal Rule', action: () => insertText('\n---\n', '', true), group: 'block' },
        {
            icon: LinkIcon,
            label: 'Link',
            action: () => setModalConfig({ isOpen: true, type: 'link' }),
            group: 'insert'
        },
        {
            icon: Image,
            label: 'Image',
            action: () => setModalConfig({ isOpen: true, type: 'image' }),
            group: 'insert'
        },
        {
            icon: Youtube,
            label: 'YouTube Video',
            action: () => setModalConfig({ isOpen: true, type: 'youtube' }),
            group: 'insert'
        },
        {
            icon: ({ size, ...props }) => <span {...props} style={{ fontSize: size, fontFamily: 'monospace', fontWeight: 700, lineHeight: 1 }}>```</span>,
            label: 'Code Block',
            action: () => insertText('\n```\n', '\n```\n', true),
            group: 'insert'
        },
        { icon: AtSign, label: 'Mention User', action: () => insertText('@'), group: 'insert' },
        { icon: EyeOff, label: 'Spoiler', action: () => insertText('||', '||'), group: 'insert' },
    ];

    const handleKeyDown = (e) => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'b') { e.preventDefault(); insertText('**', '**'); }
            if (e.key === 'i') { e.preventDefault(); insertText('*', '*'); }
            if (e.key === 'k') { e.preventDefault(); setModalConfig({ isOpen: true, type: 'link' }); }
        }
        // Tab inserts 2 spaces
        if (e.key === 'Tab') {
            e.preventDefault();
            insertText('  ');
        }
    };

    return (
        <div className={`flex flex-col rounded-2xl overflow-hidden bg-[#141414] transition-all ${className}`}>
            <UrlModal
                isOpen={modalConfig.isOpen}
                type={modalConfig.type}
                onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
                onSubmit={handleModalSubmit}
            />

            {/* Mobile Tabs & Toolbar Wrapper */}
            <div className="bg-dark/50">
                {/* Mobile Tabs (hidden on md+) */}
                <div className="flex md:hidden px-4 pt-3 gap-6">
                    <button
                        type="button"
                        onClick={() => setActiveTab('write')}
                        className={`pb-2.5 text-sm font-medium transition-colors relative ${activeTab === 'write' ? 'text-accent' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <Edit3 size={16} className="inline-block mr-1" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('preview')}
                        className={`pb-2.5 text-sm font-medium transition-colors relative ${activeTab === 'preview' ? 'text-accent' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <Eye size={16} className="inline-block mr-1" />
                    </button>
                </div>

                {/* Toolbar: Visible if desktop OR (mobile AND write tab is active) */}
                <div className={`md:block ${activeTab === 'write' ? 'block' : 'hidden'}`}>
                    <div className="flex items-center gap-1 flex-wrap p-2">
                        {tools.map((tool, idx) => (
                            <button
                                key={idx}
                                type="button"
                                onClick={tool.action}
                                title={tool.label}
                                aria-label={tool.label}
                                className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 transition-all rounded-lg active:scale-95"
                            >
                                <tool.icon size={15} />
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Split Editor/Preview area */}
            <div className={`flex flex-col min-h-[300px] ${hideDesktopPreview ? 'md:flex-col' : 'md:flex-row'}`}>

                {/* Editor (Left): Visible if desktop OR (mobile AND write tab is active) */}
                <div className={`w-full p-4 relative group md:block ${activeTab === 'write' ? 'block' : 'hidden'} ${hideDesktopPreview ? 'md:w-full' : 'md:w-1/2'}`}>
                    <TextareaAutosize
                        ref={textareaRef}
                        id={`richtext-editor-${editorId}`}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        minRows={10}
                        className="w-full bg-transparent text-gray-200 placeholder-gray-500 focus:outline-none resize-none font-sans text-[15px] leading-relaxed"
                    />
                    {!value && (
                        <div className="absolute inset-0 pointer-events-none p-4 text-gray-500 italic lg:hidden group-focus-within:hidden"></div>
                    )}
                </div>

                {/* Preview (Right): Visible if desktop (unless hidden) OR (mobile AND preview tab is active) */}
                <div className={`w-full p-4 bg-dark-100/20 overflow-y-auto border-l border-white/[0.03] ${activeTab === 'preview' ? 'block' : 'hidden'} ${hideDesktopPreview ? 'md:hidden' : 'md:w-1/2 md:block'}`} style={{ maxHeight: '600px' }}>
                    {value ? (
                        <MarkdownRenderer content={value} className="text-[15px]" />
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 italic text-sm py-12">
                            <Eye className="w-8 h-8 mb-3 opacity-20" />
                            Live preview...
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Status Bar: hidden on mobile if in preview mode (to save space), visible on desktop */}
            <div className={`px-4 py-2 text-xs text-gray-500 flex justify-between items-center md:flex ${activeTab === 'write' ? 'flex' : 'hidden'}`}>
                <span>{value.length} chars</span>
            </div>
        </div>
    );
};

export default RichTextEditor;
