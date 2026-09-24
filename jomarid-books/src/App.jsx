import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { THEMES } from './theme';
import { ThemeContext, AuthProvider, ProtectedAdminRoute, ProtectedUserRoute } from './contexts/AuthContext';
import { Navbar } from './components/Navbar';
import { SettingsModal } from './components/SettingsModal';
import { SearchModal } from './components/SearchModal';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { UserLibrary } from './pages/UserLibrary';
import { ReaderPage } from './pages/ReaderPage';
import { PublisherDashboard } from './pages/PublisherDashboard';
import { UserStats } from './pages/UserStats';
import { GamesHub, GamePage } from './pages/Games';
import { AdminDashboard } from './pages/AdminDashboard';

export default function App() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => localStorage.getItem('jomarid-books-theme') || 'saas');

  useEffect(() => {
    const vars = THEMES[currentTheme] || THEMES.saas;
    const b = document.body;
    Object.keys(vars).forEach(k => b.style.setProperty(k, vars[k]));
  }, [currentTheme]);

  return (
    <AuthProvider>
      <ThemeContext.Provider value={{ currentTheme, changeTheme: (t) => { setCurrentTheme(t); localStorage.setItem('jomarid-books-theme', t); } }}>
        <Router>
          <div style={{ background: 'var(--bg-body)', color: 'var(--text-body)' }} className="min-h-screen flex flex-col font-sans antialiased transition-all duration-200">
            <Navbar onOpenSearch={() => setIsSearchOpen(true)} onOpenSettings={() => setIsSettingsOpen(true)} />

            <main className="flex-1">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />

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

            <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
            <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
          </div>
        </Router>
      </ThemeContext.Provider>
    </AuthProvider>
  );
}
