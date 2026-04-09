import { Github, Twitter, Coffee, Mail, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function Footer({ className = '' }) {
    return (
        <footer className={`bg-dark-50 pt-8 md:pt-16 pb-24 md:pb-8 ${className}`}>
            <div className="max-w-7xl mx-auto px-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                    {/* Brand */}
                    <div className="col-span-1 md:col-span-2">
                        <Link to="/" className="inline-block mb-4">
                            <Logo textClassName="text-2xl font-bold text-white" />
                        </Link>
                        <p className="text-gray-400 mb-6 max-w-sm">
                            Discover, track, and share your favorite anime series.
                            Join our community of passionate fans.
                        </p>
                        <div className="flex gap-3">
                            <a
                                href="https://github.com/oddava"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-icon-button rounded-full"
                                aria-label="Github"
                            >
                                <Github className="w-5 h-5" />
                            </a>
                            <a
                                href="https://twitter.com/oddava"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-icon-button rounded-full"
                                aria-label="Twitter"
                            >
                                <Twitter className="w-5 h-5" />
                            </a>
                            <a
                                href="https://buymeacoffee.com/oddava"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-icon-button rounded-full"
                                aria-label="Buy Me A Coffee"
                            >
                                <Coffee className="w-5 h-5" />
                            </a>
                            <a
                                href="mailto:oddava@proton.me"
                                className="ui-icon-button rounded-full"
                                aria-label="Email"
                            >
                                <Mail className="w-5 h-5" />
                            </a>
                        </div>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h3 className="font-bold text-white mb-6">Quick Links</h3>
                        <ul className="space-y-4">
                            <li>
                                <Link to="/browse" className="text-gray-400 hover:text-accent transition-colors">
                                    Browse Anime
                                </Link>
                            </li>
                            <li>
                                <Link to="/forums" className="text-gray-400 hover:text-accent transition-colors">
                                    Forums
                                </Link>
                            </li>
                            <li>
                                <Link to="/browse?sort=popular" className="text-gray-400 hover:text-accent transition-colors">
                                    Trending Now
                                </Link>
                            </li>
                            <li>
                                <Link to="/browse?sort=rating" className="text-gray-400 hover:text-accent transition-colors">
                                    Top Rated
                                </Link>
                            </li>
                        </ul>
                    </div>

                    {/* Legal */}
                    <div>
                        <h3 className="font-bold text-white mb-6">Legal</h3>
                        <ul className="space-y-4">
                            <li>
                                <Link to="/terms" className="text-gray-400 hover:text-accent transition-colors">
                                    Terms of Service
                                </Link>
                            </li>
                            <li>
                                <Link to="/privacy" className="text-gray-400 hover:text-accent transition-colors">
                                    Privacy Policy
                                </Link>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-gray-400 text-sm">
                        © {new Date().getFullYear()} aniShows. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}
