import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { THEMES, initMotionPref } from './theme';
import { ThemeContext, AuthProvider, ProtectedAdminRoute, ProtectedUserRoute, useAuth } from './contexts/AuthContext';
import { Navbar } from './components/Navbar';
import { SettingsPage } from './components/SettingsModal';
import { SearchModal } from './components/SearchModal';
import { HomePage } from './pages/HomePage';
import { LoginPage, ResetPasswordPage } from './pages/LoginPage';
import { UserLibrary } from './pages/UserLibrary';
import { ReaderPage } from './pages/ReaderPage';
import { PublisherDashboard } from './pages/PublisherDashboard';
import { UserStats } from './pages/UserStats';
import { GamesHub, GamePage } from './pages/Games';
import { AdminDashboard } from './pages/AdminDashboard';

// Po kliknutí na odkaz "obnova hesla" musí uživatel skončit na stránce pro nové heslo,
// i kdyby ho Supabase (kvůli nepovolené redirect URL) vrátil na úvodní stránku.
export const RecoveryRedirect = () => {
  const { recoveryMode } = useAuth();
  const location = useLocation();
  if (recoveryMode && location.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />;
  return null;
};

// Motivy, ktere maji tmave pozadi - podle toho se nastavi color-scheme (nativni posuvniky, formularove prvky).
const DARK_THEMES = ['dark', 'emerald'];

export default function App() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('jomarid-books-theme') || 'saas');

  useEffect(() => initMotionPref(), []); // omezení pohybu (Nastavení -> Vzhled, nebo nastavení zařízení)

  useEffect(() => {
    const vars = THEMES[currentTheme] || THEMES.saas;
    // Promenne patri na <html>, ne na <body>: pozadi <html> je to, co vidi uzivatel mimo obsah
    // (oddaleni na mobilu, pretazeni). Na body by ho <html> nevidelo a zustalo by svetle.
    const root = document.documentElement;
    Object.keys(vars).forEach(k => root.style.setProperty(k, vars[k]));
    root.style.colorScheme = DARK_THEMES.includes(currentTheme) ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg-body']);
  }, [currentTheme]);

  return (
    <AuthProvider>
      <ThemeContext.Provider value={{ currentTheme, changeTheme: (t) => { setCurrentTheme(t); localStorage.setItem('jomarid-books-theme', t); } }}>
        <Router>
          <div style={{ background: 'var(--bg-body)', color: 'var(--text-body)' }} className="min-h-screen flex flex-col font-sans antialiased transition-all duration-200">
            <RecoveryRedirect />
            <Navbar onOpenSearch={() => setIsSearchOpen(true)} />

            <main className="flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

                {/* Nastavení - veřejné (Vzhled a Čtečka jdou i bez účtu); záložky účtu se odhlášenému nezobrazí */}
                <Route path="/settings/:tab?" element={<SettingsPage />} />

                {/* Chráněné uživatelské sekce */}
                <Route path="/app" element={<ProtectedUserRoute><UserLibrary /></ProtectedUserRoute>} />
                <Route path="/read/:id" element={<ProtectedUserRoute><ReaderPage /></ProtectedUserRoute>} />
                <Route path="/publisher" element={<ProtectedUserRoute><PublisherDashboard /></ProtectedUserRoute>} />

                {/* Statistiky */}
                <Route path="/stats" element={<ProtectedUserRoute><UserStats /></ProtectedUserRoute>} />

                {/* Mini-hry */}
                <Route path="/games" element={<ProtectedUserRoute><GamesHub /></ProtectedUserRoute>} />
                <Route path="/games/:gameId" element={<ProtectedUserRoute><GamePage /></ProtectedUserRoute>} />

                {/* Administrace */}
                <Route path="/admin" element={<ProtectedAdminRoute><AdminDashboard /></ProtectedAdminRoute>} />
              </Routes>
            </main>

            <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
          </div>
        </Router>
      </ThemeContext.Provider>
    </AuthProvider>
  );
}
