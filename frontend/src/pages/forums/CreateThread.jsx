import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ShieldAlert, Send, ArrowLeft, ChevronRight, ChevronDown, Eye, Hash } from 'lucide-react';
import toast from 'react-hot-toast';

import { forumsApi } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import RichTextEditor from '../../components/forums/RichTextEditor';
import MarkdownRenderer from '../../components/common/MarkdownRenderer';
import { preloadForumChunks } from '../../App';
import React, { memo } from 'react';

const CategorySelector = memo(({ allCategories, selectedCategoryId, onChange }) => (
    <div className="px-5 py-4">
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-3">Category</label>
        <div className="relative">
            <select
                value={selectedCategoryId || ''}
                onChange={(e) => onChange(parseInt(e.target.value) || null)}
                className="w-full px-4 py-2.5 bg-dark border border-white/[0.08] rounded-xl text-sm text-white focus:outline-none focus:border-gray-600 appearance-none cursor-pointer transition-colors"
                required
            >
                <option value="">Select a category...</option>
                {allCategories?.results?.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
            </select>
            <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
    </div>
));
CategorySelector.displayName = 'CategorySelector';

const CreateThread = () => {
    const { slug } = useParams();
    const navigate = useNavigate();
    const { user, isLoading: isAuthLoading } = useAuth();

    useEffect(() => {
        preloadForumChunks();
    }, []);

    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState(null);

    const { data: categoryFromSlug, isLoading: isCategoryLoading } = useQuery({
        queryKey: ['forumCategory', slug],
        queryFn: () => forumsApi.getCategory(slug),
        enabled: !!slug,
    });

    const { data: allCategories, isLoading: isCategoriesLoading } = useQuery({
        queryKey: ['forumCategories'],
        queryFn: forumsApi.getCategories,
    });

    const { data: tagsData } = useQuery({
        queryKey: ['forumTags'],
        queryFn: forumsApi.getTags,
    });

    const activeCategory = categoryFromSlug || allCategories?.results?.find(c => c.id === selectedCategoryId);
    const canSubmit = title.trim() && content.trim() && activeCategory;

    const createThreadMutation = useMutation({
        mutationFn: (data) => forumsApi.createThread({
            ...data,
            category: activeCategory?.id,
            tag_ids: selectedTags,
        }),
        onSuccess: (data) => {
            toast.success('Thread created!');
            navigate(`/forums/thread/${data.id}`);
        },
        onError: (error) => {
            toast.error(error.response?.data?.detail || 'Failed to create thread');
        },
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        createThreadMutation.mutate({ title, content });
    };

    const toggleTag = (id) => {
        setSelectedTags(prev =>
            prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
        );
    };

    if (isAuthLoading || (slug && isCategoryLoading) || isCategoriesLoading) return <LoadingSpinner />;

    if (!user) {
        return (
            <div className="max-w-md mx-auto px-4 py-24 text-center">
                <ShieldAlert className="w-12 h-12 mx-auto mb-5 text-gray-600" />
                <h2 className="text-xl font-bold text-white mb-2">Sign in to post</h2>
                <p className="text-sm text-gray-500 mb-6">You need to be logged in to create a new thread.</p>
                <div className="flex justify-center gap-3">
                    <Link to="/login" className="btn-primary px-5 py-2.5 text-sm font-bold rounded-xl">Sign In</Link>
                    <Link to="/forums" className="px-5 py-2.5 text-sm font-bold text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors">Go Back</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <Helmet>
                <title>Create Thread | aniShows Forums</title>
            </Helmet>

            <div className="max-w-[1440px] w-full mx-auto px-4 md:px-8 py-8">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-8">
                    <Link to="/forums" className="flex items-center gap-1.5 hover:text-white transition-colors">
                        <ArrowLeft size={13} /> Forums
                    </Link>
                    {slug && activeCategory && (
                        <>
                            <ChevronRight size={12} className="text-gray-700" />
                            <Link to={`/forums/category/${slug}`} className="hover:text-white transition-colors">{activeCategory.name}</Link>
                        </>
                    )}
                    <ChevronRight size={12} className="text-gray-700" />
                    <span className="text-gray-300 font-medium">New Thread</span>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="flex flex-col lg:flex-row gap-6 xl:gap-10 items-start">

                        {/* ── Left Column: Editor ─────────────────────────── */}
                        <div className="w-full lg:w-[60%] space-y-4">

                            {/* Title Input */}
                            <div className="rounded-2xl bg-dark-100 border border-white/[0.06] overflow-hidden relative">
                                <div className="flex items-center justify-between px-5 pt-4 pb-1">
                                    <label htmlFor="thread-title" className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">
                                        Thread Title
                                    </label>
                                    <span className={`text-[11px] font-semibold tabular-nums transition-colors ${title.length > 90 ? 'text-orange-400' : 'text-gray-600'}`}>
                                        {title.length} / 100
                                    </span>
                                </div>
                                <input
                                    type="text"
                                    id="thread-title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    className="w-full px-5 pb-5 pt-1 bg-transparent text-white text-xl font-semibold placeholder-gray-700 focus:outline-none"
                                    placeholder="What do you want to discuss?"
                                    required
                                    maxLength={100}
                                    autoFocus
                                />
                                {/* Character Limit Progress Bar */}
                                <div className="absolute bottom-0 left-0 h-[2px] bg-accent transition-all duration-300" style={{ width: `${(title.length / 100) * 100}%`, opacity: title.length > 0 ? 1 : 0 }} />
                            </div>

                            {/* Rich Text Editor */}
                            <div className="rounded-2xl bg-dark-100 border border-white/[0.06] overflow-hidden">
                                <div className="px-5 pt-4 pb-2">
                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Body</span>
                                </div>
                                <div className="px-2 pb-3">
                                    <RichTextEditor
                                        value={content}
                                        onChange={setContent}
                                        placeholder="Share your thoughts..."
                                        hideDesktopPreview={true}
                                    />
                                </div>
                            </div>

                            {/* Category + Tags */}
                            <div className="rounded-2xl bg-dark-100 border border-white/[0.06] divide-y divide-white/[0.04]">
                                {/* Category */}
                                {!slug && (
                                    <CategorySelector
                                        allCategories={allCategories}
                                        selectedCategoryId={selectedCategoryId}
                                        onChange={setSelectedCategoryId}
                                    />
                                )}

                                {/* Tags */}
                                {tagsData?.results?.length > 0 && (
                                    <div className="px-5 py-4">
                                        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                                            <Hash size={12} /> Tags <span className="text-gray-700 font-normal normal-case tracking-normal">(optional)</span>
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {tagsData.results.map(tag => (
                                                <button
                                                    key={tag.id}
                                                    type="button"
                                                    onClick={() => toggleTag(tag.id)}
                                                    className="px-3 py-1 text-xs font-bold rounded-full transition-all"
                                                    style={{
                                                        backgroundColor: selectedTags.includes(tag.id) ? tag.color : `${tag.color}18`,
                                                        color: selectedTags.includes(tag.id) ? '#fff' : tag.color,
                                                        boxShadow: selectedTags.includes(tag.id) ? `0 0 0 1.5px ${tag.color}` : 'none',
                                                    }}
                                                >
                                                    {tag.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Action Bar */}
                            <div className="flex items-center justify-between pt-1 pb-10">
                                <Link
                                    to="/forums"
                                    className="text-sm text-gray-500 hover:text-white transition-colors"
                                >
                                    ← Cancel
                                </Link>

                                <button
                                    type="submit"
                                    disabled={createThreadMutation.isPending || !canSubmit}
                                    className="btn-primary inline-flex items-center gap-2 px-7 py-2.5 font-bold text-sm rounded-xl disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-accent/15 transition-all"
                                >
                                    {createThreadMutation.isPending
                                        ? <><LoadingSpinner size={16} /> Posting...</>
                                        : <><Send size={14} /> Publish Thread</>
                                    }
                                </button>
                            </div>
                        </div>

                        {/* ── Right Column: Live Preview ───────────────────── */}
                        <div className="hidden lg:block lg:w-[40%]">
                            <div className="rounded-2xl bg-dark-100 border border-white/[0.06] overflow-hidden">
                                {/* Preview header */}
                                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-white/[0.04]">
                                    <Eye size={13} className="text-gray-500" />
                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Preview</span>
                                </div>

                                {/* Preview body */}
                                <div className="px-6 py-5">
                                    {!title && !content ? (
                                        <div className="flex flex-col items-center justify-center text-center py-16 gap-3 select-none">
                                            <Eye size={32} className="text-gray-700" />
                                            <p className="text-sm text-gray-600">Your thread preview will<br />appear here as you type</p>
                                        </div>
                                    ) : (
                                        <div>
                                            {title.trim() && (
                                                <h1 className="text-xl font-bold text-white mb-5 leading-snug break-words">{title}</h1>
                                            )}
                                            {activeCategory && (
                                                <div className="flex items-center gap-2 mb-5">
                                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/5">
                                                        {activeCategory.name}
                                                    </span>
                                                    {selectedTags.map(tid => {
                                                        const tag = tagsData?.results?.find(t => t.id === tid);
                                                        return tag ? (
                                                            <span key={tid} className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                                                                style={{ backgroundColor: `${tag.color}25`, color: tag.color }}>
                                                                {tag.name}
                                                            </span>
                                                        ) : null;
                                                    })}
                                                </div>
                                            )}
                                            {content ? (
                                                <MarkdownRenderer content={content} className="text-[15px] leading-relaxed opacity-90" />
                                            ) : (
                                                <p className="text-sm text-gray-600 italic">Start writing in the body field...</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateThread;
