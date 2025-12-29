import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export default function Privacy() {
    return (
        <div className="min-h-screen py-12 px-4">
            <div className="max-w-3xl mx-auto">
                <Link to="/" className="inline-flex items-center text-gray-400 hover:text-white mb-8 transition-colors">
                    <ChevronLeft className="w-5 h-5 mr-1" />
                    Back to Home
                </Link>

                <div className="prose prose-invert max-w-none">
                    <h1 className="text-4xl font-bold mb-8 text-white">Privacy Policy</h1>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">1. Information We Collect</h2>
                        <p className="text-gray-300">
                            We collect information you provide directly to us, such as when you create an account, update your profile, or communicate with us.
                            This may include your username, email address, profile picture, and banner image.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">2. How We Use Your Information</h2>
                        <p className="text-gray-300">
                            We use the information we collect to provide, maintain, and improve our services, including to:
                        </p>
                        <ul className="list-disc pl-5 text-gray-300 mt-2 space-y-1">
                            <li>Provide and deliver the products and services you request.</li>
                            <li>Send you technical notices, updates, security alerts, and support messages.</li>
                            <li>Personalize and improve the Service.</li>
                        </ul>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">3. Data Security</h2>
                        <p className="text-gray-300">
                            We take reasonable measures to help protect information about you from loss, theft, misuse and unauthorized access, disclosure, alteration and destruction.
                        </p>
                    </section>

                    <section className="mb-8">
                        <h2 className="text-2xl font-semibold mb-4 text-white">4. Contact Us</h2>
                        <p className="text-gray-300">
                            If you have any questions about this Privacy Policy, please contact us at <a href="mailto:oddava@proton.me" className="text-accent hover:underline">oddava@proton.me</a>.
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
