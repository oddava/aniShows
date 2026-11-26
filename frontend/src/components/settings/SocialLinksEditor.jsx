import { X } from 'lucide-react';
import SmartLinkInput from '../SmartLinkInput';
import { getSocialLinkDuplicateKey } from './settingsUtils';

/** Up to five social links, with duplicate and missing-platform warnings. */
export default function SocialLinksEditor({ socialLinks, setSocialLinks, isSavingProfile }) {
    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="section-title">Social links</h2>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-[var(--text-3)] tabular">{socialLinks.length}/5</span>
                    {socialLinks.length < 5 && (
                        <button
                            type="button"
                            onClick={() => setSocialLinks([...socialLinks, { platform: '', value: '' }])}
                            className="btn-secondary text-sm"
                        >
                            Add link
                        </button>
                    )}
                </div>
            </div>

            {socialLinks.length > 0 && (
                <div aria-hidden="true" className="mb-1.5 hidden gap-3 text-xs font-medium text-[var(--text-3)] sm:flex">
                    <span className="w-32 shrink-0">Platform</span>
                    <span>Link</span>
                </div>
            )}
            <div className="space-y-3">
                {socialLinks.length === 0 ? (
                    <p className="text-sm text-[var(--text-2)]">Links you add show under your name.</p>
                ) : (
                    socialLinks.map((link, index) => {
                        const currentKey = getSocialLinkDuplicateKey(link);
                        const isDuplicate = Boolean(currentKey) && socialLinks.some((l, i) =>
                            i !== index && getSocialLinkDuplicateKey(l) === currentKey
                        );
                        const isEmptyPlatform = !link.platform?.trim();

                        return (
                            <div key={index}>
                                <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                <SmartLinkInput
                                    labelClassName="mb-1.5 block text-xs font-medium text-[var(--text-3)] sm:sr-only"
                                    platform={link.platform}
                                    value={link.value}
                                    onChange={(newValue) => {
                                        const newLinks = [...socialLinks];
                                        newLinks[index].value = newValue;
                                        setSocialLinks(newLinks);
                                    }}
                                    onPlatformChange={(newPlatform) => {
                                        const newLinks = [...socialLinks];
                                        newLinks[index].platform = newPlatform;
                                        setSocialLinks(newLinks);
                                    }}
                                    disabled={isSavingProfile}
                                />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (confirm('Remove this link?')) {
                                            setSocialLinks(socialLinks.filter((_, i) => i !== index));
                                        }
                                    }}
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-3)] transition-colors hover:bg-white/[0.05] hover:text-[var(--danger)] max-sm:mt-6"
                                    aria-label={`Remove link ${index + 1}`}
                                    title="Remove link"
                                >
                                    <X aria-hidden="true" className="h-4 w-4" />
                                </button>
                                </div>

                                {isDuplicate && (
                                    <p className="mt-2 text-sm text-[var(--danger)]">Duplicate link detected</p>
                                )}
                                {isEmptyPlatform && (
                                    <p className="mt-2 text-sm text-[var(--text-2)]">Platform name is required</p>
                                )}
                            </div>
                        );
                    })
                )}

                {socialLinks.length >= 5 && (
                    <p className="text-sm text-[var(--text-3)]">
                        Maximum of 5 links reached. Remove a link to add a new one.
                    </p>
                )}
            </div>
        </div>
    );
}
