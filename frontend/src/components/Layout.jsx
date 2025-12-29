import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';

export default function Layout() {
    return (
        <div className="min-h-screen bg-dark flex flex-col">
            <Navbar />
            <main className="pt-16 flex-grow">
                <Outlet />
            </main>
            <Footer />
        </div>
    );
}
