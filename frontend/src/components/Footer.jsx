import { Github, Mail, Twitter } from 'lucide-react';
import { Link } from 'react-router-dom';

const linkClass = 'inline-flex min-h-11 items-center gap-1.5 text-[15px] text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]';

/**
 * Set like oddava.me's footer: one hairline, then a quiet row of text links
 * with small icons, and who made it.
 */
export default function Footer({ className = '' }) {
    return (
        <footer className={`pt-16 pb-10 md:pt-24 ${className}`}>
            <div className="page-container">
                <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                    <nav aria-label="Footer" className="flex flex-wrap gap-x-6">
                        <Link to="/browse" className={linkClass}>Browse</Link>
                        <Link to="/schedule" className={linkClass}>Schedule</Link>
                        <Link to="/import" className={linkClass}>Import</Link>
                        <Link to="/terms" className={linkClass}>Terms</Link>
                        <Link to="/privacy" className={linkClass}>Privacy</Link>
                    </nav>
                    <div className="flex flex-wrap items-center gap-x-6">
                        <a href="https://github.com/oddava" target="_blank" rel="noopener noreferrer" className={linkClass}>
                            <Github aria-hidden="true" className="h-4 w-4" />GitHub
                        </a>
                        <a href="https://twitter.com/oddava" target="_blank" rel="noopener noreferrer" className={linkClass}>
                            <Twitter aria-hidden="true" className="h-4 w-4" />X
                        </a>
                        <a href="mailto:oddava@proton.me" className={linkClass}>
                            <Mail aria-hidden="true" className="h-4 w-4" />Email
                        </a>
                        <a href="https://oddava.me" className={`${linkClass} text-[var(--text-3)]`}>
                            Made by <span className="text-[var(--text-1)]">oddava</span>
                        </a>
                    </div>
                </div>
            </div>
        </footer>
    );
}
