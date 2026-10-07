import { Component, lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { resolveTheme, withAccent, loadAccent, saveAccent, applyUiPrefs, applyMotionPref, isDarkTheme, saveCustomColors, loadCustomColors, seedCustomColors, CUSTOM_THEME_KEY, THEME_KEY, initMotionPref } from './theme';
import { SettingsSyncRunner } from './settings/SettingsSyncRunner';
import { SETTINGS_APPLIED, notifySettingsChanged } from './settings/settingsEvents';
import { ThemeContext, AuthProvider, ProtectedAdminRoute, ProtectedUserRoute, useAuth } from './contexts/AuthContext';
import { Navbar } from './components/Navbar';
import { SettingsPage } from './components/SettingsModal';
import { TourProvider } from './tour/TourProvider';
import { SearchModal } from './components/SearchModal';
import { HomePage } from './pages/HomePage';
import { LoginPage, ResetPasswordPage } from './pages/LoginPage';
import { UserLibrary, AuthorPage } from './pages/UserLibrary';

// Těžší stránky, které většina čtenářů nikdy neotevře (administrace, nakladatelský panel, hry, statistiky, čtečka),
// se stahují až při prvním otevření. Úvodní načtení je tak výrazně menší.
// Po nasazení nové verze už staré názvy souborů neexistují - stránka se jednou sama obnoví a načte nové.
export const lazyPage = (load, name, reload = () => window.location.reload()) => lazy(async () => {
  const KEY = 'jomarid-chunk-retry';
  try {
    const mod = await load();
    try { sessionStorage.removeItem(KEY); } catch { /* soukromý režim */ }
    return { default: mod[name] };
  } catch (err) {
    let already = true;
    try { already = sessionStorage.getItem(KEY) === '1'; if (!already) sessionStorage.setItem(KEY, '1'); } catch { /* bez úložiště nezkoušet znovu */ }
    if (!already) { reload(); return new Promise(() => {}); }
    throw err;
  }
});
const ReaderPage = lazyPage(() => import('./pages/ReaderPage'), 'ReaderPage');
const PublisherDashboard = lazyPage(() => import('./pages/PublisherDashboard'), 'PublisherDashboard');
const UserStats = lazyPage(() => import('./pages/UserStats'), 'UserStats');
const GamesHub = lazyPage(() => import('./pages/Games'), 'GamesHub');
const GamePage = lazyPage(() => import('./pages/Games'), 'GamePage');
const AdminDashboard = lazyPage(() => import('./pages/AdminDashboard'), 'AdminDashboard');

// Selhání načtení části aplikace (např. výpadek sítě) nesmí skončit bílou obrazovkou.
export class PageErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ color: 'var(--text-body)' }} className="max-w-sm mx-auto py-24 px-4 text-center">
        <p className="text-sm font-bold m-0 mb-4">Tuhle stránku se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.</p>
        <button type="button" onClick={() => window.location.reload()} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-5 py-2.5 rounded-xl border-none cursor-pointer text-xs font-black uppercase tracking-wider">Načíst znovu</button>
      </div>
    );
  }
}
export const PageLoading = () => (
  <div role="status" style={{ color: 'var(--text-muted)' }} className="flex items-center justify-center min-h-[50vh] text-xs font-bold">Načítám...</div>
);

// Po kliknutí na odkaz "obnova hesla" musí uživatel skončit na stránce pro nové heslo,
// i kdyby ho Supabase (kvůli nepovolené redirect URL) vrátil na úvodní stránku.
export const RecoveryRedirect = () => {
  const { recoveryMode } = useAuth();
  const location = useLocation();
  if (recoveryMode && location.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />;
  return null;
};

// Úložiště prohlížeče může být zablokované (přísná ochrana soukromí, některé spravované prohlížeče) - pak přístup k němu
// vyhazuje chybu. Bez těchhle obalů by při čtení motivu spadlo celé vykreslování a stránka by zůstala prázdná.
const readStored = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* nevadí, motiv platí aspoň do zavření stránky */ } };

export default function App() {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState(() => readStored(THEME_KEY) || 'saas');
  const [customColors, setCustomColors] = useState(loadCustomColors); // jen pro motiv „Vlastní“
  const [accent, setAccent] = useState(loadAccent); // akcentní barva hotových motivů

  useEffect(() => initMotionPref(), []); // omezení pohybu (Nastavení -> Vzhled, nebo nastavení zařízení)
  useEffect(() => { applyUiPrefs(); }, []); // velikost a hustota rozhraní (index.html je použije ještě před vykreslením)

  // Po stažení nastavení z účtu (nové zařízení, změna na jiném zařízení) si appka všechno přečte znovu.
  useEffect(() => {
    const reread = () => {
      setCurrentTheme(readStored(THEME_KEY) || 'saas');
      setCustomColors(loadCustomColors());
      setAccent(loadAccent());
      applyUiPrefs();
      applyMotionPref();
    };
    window.addEventListener(SETTINGS_APPLIED, reread);
    return () => window.removeEventListener(SETTINGS_APPLIED, reread);
  }, []);

  useEffect(() => {
    const base = resolveTheme(currentTheme);
    const vars = currentTheme === CUSTOM_THEME_KEY ? base : withAccent(base, accent);
    // Promenne patri na <html>, ne na <body>: pozadi <html> je to, co vidi uzivatel mimo obsah
    // (oddaleni na mobilu, pretazeni). Na body by ho <html> nevidelo a zustalo by svetle.
    const root = document.documentElement;
    Object.keys(vars).forEach(k => root.style.setProperty(k, vars[k]));
    root.style.colorScheme = isDarkTheme(currentTheme, vars) ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg-body']);
  }, [currentTheme, customColors, accent]);

  return (
    <AuthProvider>
      <ThemeContext.Provider value={{
        currentTheme, customColors, accent,
        changeAccent: (a) => { saveAccent(a); setAccent(loadAccent()); },
        changeTheme: (t) => {
          // První přepnutí na „Vlastní“ začne od barev, které uživatel právě vidí, ne od výchozí tyrkysové.
          if (t === CUSTOM_THEME_KEY) setCustomColors(seedCustomColors(currentTheme));
          setCurrentTheme(t); writeStored(THEME_KEY, t); notifySettingsChanged();
        },
        changeCustomColors: (c) => { saveCustomColors(c); setCustomColors(loadCustomColors()); setCurrentTheme(CUSTOM_THEME_KEY); writeStored(THEME_KEY, CUSTOM_THEME_KEY); notifySettingsChanged(); },
      }}>
        <SettingsSyncRunner />
        <Router>
          <TourProvider blocked={isSearchOpen}>
          <div style={{ background: 'var(--bg-body)', color: 'var(--text-body)' }} className="min-h-screen flex flex-col font-sans antialiased transition-all duration-200">
            <RecoveryRedirect />
            <Navbar onOpenSearch={() => setIsSearchOpen(true)} />

            <main className="flex-1">
              <PageErrorBoundary>
              <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

                {/* Nastavení - veřejné (Vzhled a Čtečka jdou i bez účtu); záložky účtu se odhlášenému nezobrazí */}
                <Route path="/settings/:tab?" element={<SettingsPage />} />

                {/* Chráněné uživatelské sekce */}
                <Route path="/app" element={<ProtectedUserRoute><UserLibrary /></ProtectedUserRoute>} />
                <Route path="/autor/:id" element={<ProtectedUserRoute><AuthorPage /></ProtectedUserRoute>} />
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
              </Suspense>
              </PageErrorBoundary>
            </main>

            <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
          </div>
          </TourProvider>
        </Router>
      </ThemeContext.Provider>
    </AuthProvider>
  );
}
