import { AlertCircle } from 'lucide-react';
import SmartLinkInput from '../SmartLinkInput';
import { getSocialLinkDuplicateKey } from './settingsUtils';

/** Up to five social links, with duplicate and missing-platform warnings. */
export default function SocialLinksEditor({ socialLinks, setSocialLinks, isSavingProfile }) {
    return (
        <div className="pt-4 border-t border-gray-800">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-medium text-white">Social Links</h3>
                    <span className={`text-sm font-medium ${socialLinks.length >= 5 ? 'text-red-400' : 'text-gray-400'
                        }`}>
                        {socialLinks.length}/5
                    </span>
                </div>
                {socialLinks.length < 5 && (
                    <button
                        type="button"
                        onClick={() => setSocialLinks([...socialLinks, { platform: '', value: '' }])}
                        className="text-xs font-medium text-accent hover:text-accent/80 transition-colors flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 rounded-lg hover:bg-accent/20"
                    >
                        Add Link
                    </button>
                )}
            </div>

            <div className="space-y-4 max-w-2xl">
                {socialLinks.length === 0 ? (
                    <div className="p-6 bg-dark-100 rounded-xl text-center">
                        <p className="text-gray-500 mb-2">No social links added yet.</p>
                        <p className="text-xs text-gray-600">Add up to 5 links to your profile</p>
                    </div>
                ) : (
                    <>
                        {socialLinks.map((link, index) => {
                            // Check for duplicates
                            const currentKey = getSocialLinkDuplicateKey(link);
                            const isDuplicate = Boolean(currentKey) && socialLinks.some((l, i) =>
                                i !== index && getSocialLinkDuplicateKey(l) === currentKey
                            );

                            // Check for empty platform
                            const isEmptyPlatform = !link.platform?.trim();

                            return (
                                <div
                                    key={index}
                                    className={`relative rounded-xl p-4 transition-colors ${isDuplicate
                                        ? 'bg-red-500/5'
                                        : isEmptyPlatform
                                            ? 'bg-yellow-500/[0.05]'
                                            : 'bg-dark-100'
                                        }`}
                                >
                                    {/* Header with index and remove button */}
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-xs font-medium text-gray-500">
                                            Link {index + 1}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (confirm('Remove this link?')) {
                                                    setSocialLinks(socialLinks.filter((_, i) => i !== index));
                                                }
                                            }}
                                            className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                            title="Remove link"
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

                                    {/* Warnings */}
                                    {isDuplicate && (
                                        <div className="flex items-center gap-1.5 mt-2 text-red-400 text-xs">
                                            <AlertCircle className="w-3.5 h-3.5" />
                                            <span>Duplicate link detected</span>
                                        </div>
                                    )}
                                    {isEmptyPlatform && (
                                        <div className="flex items-center gap-1.5 mt-2 text-yellow-400 text-xs">
                                            <AlertCircle className="w-3.5 h-3.5" />
                                            <span>Platform name is required</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </>
                )}

                {socialLinks.length >= 5 && (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                        <p className="text-xs text-yellow-400 text-center">
                            Maximum of 5 links reached. Remove a link to add a new one.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
