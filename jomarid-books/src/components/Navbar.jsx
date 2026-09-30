import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BarChart3, Coins, Compass, Gamepad2, Library, LogOut, Search, Settings, Shield } from 'lucide-react';

export const Navbar = ({ onOpenSearch, onOpenSettings }) => {
  const { user, logout, role } = useAuth();
  const navigate = useNavigate();
  const [coins, setCoins] = useState(0);

  const username = user?.email ? user.email.split('@')[0] : 'Čtenář';

  useEffect(() => {
    if (!user?.id) return;

    // 1. Načtení mincí z DB při načtení
    const fetchUserCoins = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('coins')
          .eq('id', user.id)
          .maybeSingle();

        if (!error && data) {
          setCoins(data.coins || 0);
        }
      } catch (err) {
        console.error("Chyba při načítání mincí v Navbaru:", err);
      }
    };

    fetchUserCoins();

    // 2. Realtime posluchač – okamžitě aktualizuje mince v liště při změně v DB
    const channel = supabase
      .channel('navbar-coins-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`
        },
        (payload) => {
          if (payload.new && payload.new.coins !== undefined) {
            setCoins(payload.new.coins);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Vyska navigace se predava zbytku appky pres --navbar-h (napr. ctecka tim vi, kolik mista ma).
  const navRef = useRef(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--navbar-h', `${el.getBoundingClientRect().height}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const renderRoleBadge = () => {
    if (role === 'správce') {
      return (
        <span className="text-[9px] font-black uppercase text-amber-500 tracking-wider flex items-center justify-end gap-1">
          <Shield size={10} /> Správce
        </span>
      );
    }
    if (role === 'nakladatel') {
      return (
        <span className="text-[9px] font-black uppercase text-emerald-500 tracking-wider flex items-center justify-end gap-1">
          <Compass size={10} /> Nakladatel
        </span>
      );
    }
    return (
      <span style={{ color: 'var(--text-muted)' }} className="text-[9px] font-bold uppercase opacity-60">
        Čtenář
      </span>
    );
  };

  return (
    <nav 
      ref={navRef}
      style={{ 
        backgroundColor: 'var(--bg-card)', 
        borderColor: 'var(--border-color)',
        backdropFilter: 'blur(8px)'
      }} 
      className="sticky top-0 z-40 w-full border-b transition-all duration-200"
    >
      <div className="max-w-6xl mx-auto px-3 sm:px-4 grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 sm:gap-x-4">
        
        {/* LOGO + ODKAZY (na telefonu druhý řádek pod logem a účtem) */}
        <>
          <Link 
            to="/" 
            className="col-start-1 row-start-1 h-14 sm:h-16 no-underline flex items-center gap-2 group"
          >
            <div className="w-8 h-8 rounded-lg bg-[var(--bg-primary)] flex items-center justify-center text-white font-black shadow-sm group-hover:scale-105 transition-transform">
              J
            </div>
            <span 
              style={{ color: 'var(--text-body)' }} 
              className="font-black uppercase tracking-wider text-xs hidden sm:block"
            >
              Jomarid <span className="opacity-50">Books</span>
            </span>
          </Link>

          {/* ODKAZY */}
          {user && (
            <div style={{ borderColor: 'var(--border-color)' }} className="col-span-2 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 min-w-0 flex items-stretch sm:items-center justify-around sm:justify-start gap-1 sm:gap-2 border-t sm:border-t-0 py-1 sm:py-0">
              <Link 
                to="/app" 
                style={{ color: 'var(--text-body)' }}
                className="flex-1 sm:flex-none min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider no-underline hover:bg-black/5 dark:hover:bg-white/5 transition-all"
              >
                <Library size={14} className="opacity-70" />
                <span className="text-[9px] leading-none sm:hidden md:inline md:text-xs md:leading-normal">Knihovna</span>
              </Link>
              
              <Link 
                to="/stats" 
                style={{ color: 'var(--text-body)' }}
                className="flex-1 sm:flex-none min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider no-underline hover:bg-black/5 dark:hover:bg-white/5 transition-all"
              >
                <BarChart3 size={14} className="opacity-70" />
                <span className="text-[9px] leading-none sm:hidden md:inline md:text-xs md:leading-normal">Statistiky</span>
              </Link>

              <Link 
                to="/games" 
                style={{ color: 'var(--text-body)' }}
                className="flex-1 sm:flex-none min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider no-underline hover:bg-black/5 dark:hover:bg-white/5 transition-all text-purple-600 dark:text-purple-400"
              >
                <Gamepad2 size={14} className="opacity-80 animate-pulse" />
                <span className="text-[9px] leading-none sm:hidden md:inline md:text-xs md:leading-normal">Hry</span>
              </Link>

              {role === 'nakladatel' && (
                <Link 
                  to="/publisher" 
                  style={{ color: 'var(--text-body)' }}
                  className="flex-1 sm:flex-none min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider no-underline hover:bg-black/5 dark:hover:bg-white/5 transition-all text-emerald-600 dark:text-emerald-400"
                >
                  <Compass size={14} className="opacity-80" />
                  <span className="text-[9px] leading-none sm:hidden md:inline md:text-xs md:leading-normal">Studio</span>
                </Link>
              )}

              {role === 'správce' && (
                <Link 
                  to="/admin" 
                  style={{ color: 'var(--text-body)' }}
                  className="flex-1 sm:flex-none min-w-0 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-1.5 sm:py-2 rounded-xl text-xs font-black uppercase tracking-wider no-underline hover:bg-black/5 dark:hover:bg-white/5 transition-all text-amber-600 dark:text-amber-400"
                >
                  <Shield size={14} className="opacity-80" />
                  <span className="text-[9px] leading-none sm:hidden md:inline md:text-xs md:leading-normal">Admin</span>
                </Link>
              )}
            </div>
          )}
        </>

        {/* PRAVÁ STRANA */}
        <div className="col-start-2 sm:col-start-3 row-start-1 justify-self-end h-14 sm:h-16 flex items-center gap-1.5 sm:gap-2">
          {user && (
            <div 
              style={{ 
                backgroundColor: 'var(--bg-badge)', 
                borderColor: 'var(--border-color)', 
                color: 'var(--text-badge)' 
              }}
              className="shrink-0 flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-xl border text-xs font-black shadow-sm"
              title="Tvoje Jomarid Coins"
            >
              <Coins size={14} className="text-amber-500 fill-amber-500/20" />
              <span>{coins.toLocaleString()}</span>
            </div>
          )}

          {user && (
            <button
              onClick={onOpenSearch}
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
              className="p-2 border rounded-xl cursor-pointer hover:brightness-95 active:scale-95 transition-all flex items-center justify-center"
              title="Hledat knihy"
            >
              <Search size={16} />
            </button>
          )}

          <button
            onClick={onOpenSettings}
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
            className="p-2 border rounded-xl cursor-pointer hover:brightness-95 active:scale-95 transition-all flex items-center justify-center"
            title="Nastavení vzhledu"
          >
            <Settings size={16} />
          </button>

          {user ? (
            <div className="flex items-center gap-2 pl-2 border-l" style={{ borderColor: 'var(--border-color)' }}>
              <div className="hidden lg:block text-right">
                <div className="text-[10px] font-black uppercase tracking-tight line-clamp-1">
                  {username}
                </div>
                {renderRoleBadge()}
              </div>
              
              <button
                onClick={logout}
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                className="p-2 border rounded-xl cursor-pointer hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 active:scale-95 transition-all flex items-center justify-center sm:gap-2 sm:px-3 sm:py-2"
              >
                <LogOut size={14} />
                <span className="text-[10px] font-black uppercase tracking-wider hidden sm:inline">Ven</span>
              </button>
            </div>
          ) : (
            <Link to="/login" className="no-underline">
              <button
                style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }}
                className="px-4 py-2 border-none rounded-xl font-black text-xs uppercase tracking-wider cursor-pointer active:scale-95 hover:opacity-90 transition-all shadow-sm"
              >
                Přihlásit se
              </button>
            </Link>
          )}

        </div>
      </div>
    </nav>
  );
};
