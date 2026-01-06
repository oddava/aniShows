import { Github, Twitter, Coffee, Mail, Heart } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Footer() {
    return (
        <footer className="bg-dark-100 border-t border-gray-800 pt-16 pb-8 mt-auto">
            <div className="max-w-7xl mx-auto px-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                    {/* Brand */}
                    <div className="col-span-1 md:col-span-2">
                        <Link to="/" className="text-2xl font-bold mb-4 inline-block">
                            aniShows
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
                                className="w-11 h-11 rounded-full bg-dark-50 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 hover:border-gray-600 transition-all border-2 border-gray-700 hover:scale-110"
                                aria-label="Github"
                            >
                                <Github className="w-5 h-5" />
                            </a>
                            <a
                                href="https://twitter.com/oddava"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-11 h-11 rounded-full bg-dark-50 flex items-center justify-center text-gray-400 hover:text-[#1DA1F2] hover:bg-[#1DA1F2]/10 hover:border-[#1DA1F2]/50 transition-all border-2 border-gray-700 hover:scale-110"
                                aria-label="Twitter"
                            >
                                <Twitter className="w-5 h-5" />
                            </a>
                            <a
                                href="https://buymeacoffee.com/oddava"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-11 h-11 rounded-full bg-dark-50 flex items-center justify-center text-gray-400 hover:text-[#FFDD00] hover:bg-[#FFDD00]/10 hover:border-[#FFDD00]/50 transition-all border-2 border-gray-700 hover:scale-110"
                                aria-label="Buy Me A Coffee"
                            >
                                <Coffee className="w-5 h-5" />
                            </a>
                            <a
                                href="mailto:oddava@proton.me"
                                className="w-11 h-11 rounded-full bg-dark-50 flex items-center justify-center text-gray-400 hover:text-accent hover:bg-accent/10 hover:border-accent/50 transition-all border-2 border-gray-700 hover:scale-110"
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

                <div className="border-t border-gray-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-gray-500 text-sm">
                        © {new Date().getFullYear()} aniShows. All rights reserved.
                    </p>
                    <p className="text-gray-500 text-sm flex items-center gap-1">
                        Made with <Heart className="w-4 h-4 text-red-500 fill-red-500" /> by oddava
                    </p>
                </div>
            </div>
        </footer>
    );
}
