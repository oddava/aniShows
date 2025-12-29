import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function Terms() {
    return (
        <div className="min-h-screen py-12 px-4">
            <div className="max-w-3xl mx-auto">
                <Link to="/" className="inline-flex items-center text-gray-400 hover:text-white mb-8 transition-colors">
                    <ChevronLeft className="w-5 h-5 mr-1" />
                    Back to Home
                </Link>

                <div className="prose prose-invert max-w-none">
                    <h1 className="text-4xl font-bold mb-8 text-white">Terms of Service</h1>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">1. Acceptance of Terms</h2>
                        <p className="text-gray-300">
                            By accessing and using aniShows ("the Service"), you accept and agree to be bound by the terms and provision of this agreement.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">2. Use License</h2>
                        <p className="text-gray-300">
                            Permission is granted to temporarily view the materials (information or software) on aniShows' website for personal, non-commercial transitory viewing only.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">3. User Account</h2>
                        <p className="text-gray-300">
                            You are responsible for maintaining the confidentiality of your account and password and for restricting access to your computer, and you agree to accept responsibility for all activities that occur under your account or password.
                        </p>
                        <p className="text-gray-300 mt-2">
                            You may change your username once every 14 days. We reserve the right to refuse service, terminate accounts, remove or edit content in our sole discretion.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">4. Disclaimer</h2>
                        <p className="text-gray-300">
                            The materials on aniShows' website are provided "as is". aniShows makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties, including without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
