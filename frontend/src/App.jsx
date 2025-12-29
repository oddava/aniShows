
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';
import Browse from './pages/Browse';
import AnimeDetail from './pages/AnimeDetail';
import Profile from './pages/Profile';
import { Login, Register } from './pages/Auth';
import VerifyEmail from './pages/VerifyEmail';
import PasswordReset from './pages/PasswordReset';
import PasswordResetConfirm from './pages/PasswordResetConfirm';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="browse" element={<Browse />} />
              <Route path="anime/:slug" element={<AnimeDetail />} />
              <Route path="profile" element={<Profile />} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
              <Route path="verify-email/:uid/:token" element={<VerifyEmail />} />
              <Route path="forgot-password" element={<PasswordReset />} />
              <Route path="reset-password/:uid/:token" element={<PasswordResetConfirm />} />
              <Route path="terms" element={<Terms />} />
              <Route path="privacy" element={<Privacy />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
