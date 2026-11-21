import SmartLinkInput from '../SmartLinkInput';
import { getSocialLinkDuplicateKey } from './settingsUtils';

/** Up to five social links, with duplicate and missing-platform warnings. */
export default function SocialLinksEditor({ socialLinks, setSocialLinks, isSavingProfile }) {
    return (
        <div>
            <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-medium text-[var(--text-1)]">Social links</h3>
                    <span className="text-sm text-[var(--text-3)] tabular">
                        {socialLinks.length}/5
                    </span>
                </div>
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

            <div className="space-y-6 max-w-2xl">
                {socialLinks.length === 0 ? (
                    <p className="text-sm text-[var(--text-2)]">No social links added yet.</p>
                ) : (
                    socialLinks.map((link, index) => {
                        const currentKey = getSocialLinkDuplicateKey(link);
                        const isDuplicate = Boolean(currentKey) && socialLinks.some((l, i) =>
                            i !== index && getSocialLinkDuplicateKey(l) === currentKey
                        );
                        const isEmptyPlatform = !link.platform?.trim();

                        return (
                            <div key={index}>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm text-[var(--text-2)]">
                                        Link {index + 1}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (confirm('Remove this link?')) {
                                                setSocialLinks(socialLinks.filter((_, i) => i !== index));
                                            }
                                        }}
                                        className="btn-ghost -mr-3 text-sm"
                                        aria-label={`Remove link ${index + 1}`}
                                    >
                                        Remove
                                    </button>
                                </div>

                                <SmartLinkInput
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
