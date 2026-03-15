import { Link } from 'react-router-dom';
import { User, Link as LinkIcon } from 'lucide-react';

const TwitterIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);

const DiscordIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
);

const GitHubIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
);

const PlatformIcon = ({ platform }) => {
    const p = platform?.toLowerCase() || '';
    if (p.includes('twitter') || p === 'x') return <TwitterIcon />;
    if (p.includes('discord')) return <DiscordIcon />;
    if (p.includes('github')) return <GitHubIcon />;
    if (p.includes('youtube')) return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
    );
    if (p.includes('instagram')) return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
    );
    if (p.includes('buymeacoffee') || p.includes('coffee')) return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5.59 2.028A1.587 1.587 0 0 1 6.883 1h10.235c.608 0 1.147.352 1.411.891l.027.063 1.211 5.515a2.59 2.59 0 0 1-.208 1.643l-.006.013-.01.019a2.65 2.65 0 0 1-1.025 1.072l-.013.006-.013.008a3.768 3.768 0 0 1-.97.253l-.032.003H4.51l-.032-.003a3.768 3.768 0 0 1-.97-.253l-.013-.008-.013-.006a2.65 2.65 0 0 1-1.025-1.072l-.01-.019-.006-.013a2.59 2.59 0 0 1-.208-1.643l1.211-5.515.027-.063a1.587 1.587 0 0 1 1.17-.855l.035-.005zm.71 8.012h11.403l-.095.092a3.813 3.813 0 0 1-1.068.65l-.024.01-.024.01a4.63 4.63 0 0 1-1.12.251l-.032.004H6.86l-.032-.004a4.63 4.63 0 0 1-1.12-.251l-.024-.01-.024-.01a3.813 3.813 0 0 1-1.068-.65l-.095-.092zM4.504 12h15.001c.32 0 .593.204.697.487l.015.046.001.024c.002.018.002.037.002.057l-.001.056-.001.024-.015.046a.75.75 0 0 1-.697.487h-.006l-.002 4.5c0 .966-.405 1.84-1.055 2.46l-.015.014-.014.015A3.493 3.493 0 0 1 16.55 21H7.449a3.493 3.493 0 0 1-2.359-.808l-.014-.015-.015-.014A3.473 3.473 0 0 1 4.506 17.5V12h-.002z"/>
        </svg>
    );
    if (p.includes('telegram')) return (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
    );
    return <LinkIcon className="w-4 h-4" />;
};

const decodeHtmlEntities = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&');
};

export default function SocialLinks({ links = [] }) {
    if (!links || links.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-2 justify-center md:justify-start">
            {links.map((link, index) => {
                const url = link.url || link.value || '';
                const displayUrl = url.startsWith('http') ? url : `https://${url}`;
                const metadata = link.metadata || {};
                const favicon = metadata.favicon;

                return (
                    <a
                        key={index}
                        href={displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/5 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-all border border-white/5 text-xs"
                        title={metadata.title || link.platform}
                    >
                        {favicon ? (
                            <img
                                src={favicon}
                                alt=""
                                className="w-3.5 h-3.5 rounded-sm object-contain"
                                onError={(e) => {
                                    e.target.style.display = 'none';
                                    e.target.nextElementSibling.style.display = 'block';
                                }}
                            />
                        ) : null}
                        <span style={{ display: favicon ? 'none' : 'block' }}>
                            <PlatformIcon platform={link.platform} />
                        </span>
                        <span className="hidden sm:inline">{link.platform}</span>
                    </a>
                );
            })}
        </div>
    );
}

export { PlatformIcon, decodeHtmlEntities };
