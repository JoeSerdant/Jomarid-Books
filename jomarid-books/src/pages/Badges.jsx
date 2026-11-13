import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award, Coins, Gamepad2, Store } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BadgesSection } from '../components/BadgesSection';
import { GamesProgress } from '../components/GamesProgress';
import { Shop } from '../components/Shop';
import { EMPTY_PROGRESS } from '../gameRecords/api';
import { EMPTY_STATS, loadMyStats } from '../stats/loadStats';
import { t, tx } from '../i18n';
import { tk } from '../i18n/mark.js';

// Záložky stránky. Obchůdek (tituly a vzhled her) se ukáže jen tehdy, když je v databázi; jinak záložka chybí.
export const BADGE_TABS = [
  { id: 'books', label: tk('Odznaky knih'), icon: Award },
  { id: 'games', label: tk('Odznaky her'), icon: Gamepad2 },
  { id: 'shop', label: tk('Tituly a vzhled her'), icon: Store },
];
export const tabPath = (id) => (id === BADGE_TABS[0].id ? '/badges' : `/badges/${id}`);

// Odznaky knih a her, tituly a vzhledy her. Dřív byly dole ve Statistikách, kde bylo moc věcí najednou.
// Načítá stejný výpočet jako Statistiky (src/stats/loadStats.js), takže se nově splněné odznaky knih odemknou i tady.
export const BadgesPage = () => {
  const { user } = useAuth();
  const { tab } = useParams();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState(EMPTY_STATS);
  // Koupené a nasazené zboží; null, dokud se nenačte nebo když v databázi obchůdek ještě není.
  const [cosmetics, setCosmetics] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    loadMyStats(supabase, user)
      .then((mine) => {
        if (cancelled) return;
        setStats(mine.stats);
        setCosmetics(mine.cosmetics);
      })
      .catch((error) => {
        console.error('Odznaky se nepodařilo načíst:', error);
        if (!cancelled) setFailed(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <div role="status" className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div style={{ borderTopColor: 'transparent', borderLeftColor: 'var(--bg-primary)' }} className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"></div>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold opacity-60 animate-pulse">{t('Načítám odznaky...')}</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div role="alert" style={{ color: 'var(--text-body)' }} className="max-w-sm mx-auto py-24 px-4 text-center">
        <p className="text-sm font-bold m-0 mb-4">{t('Odznaky se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.')}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-5 py-2.5 rounded-xl border-none cursor-pointer text-xs font-black uppercase tracking-wider">{t('Načíst znovu')}</button>
      </div>
    );
  }

  const tabs = cosmetics ? BADGE_TABS : BADGE_TABS.filter((t) => t.id !== 'shop');
  const active = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-4xl mx-auto px-4 py-12 animate-in fade-in duration-300" data-testid="badges-page">
      <div className="mb-6">
        <h1 className="text-xl font-black m-0 flex items-center gap-2">
          <Award size={22} style={{ color: 'var(--bg-primary)' }} aria-hidden="true" /> {t('Odznaky a vzhled')}
        </h1>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 m-0 opacity-80">
          {tx(cosmetics ? 'Odznaky za čtení i za hry, tituly u tvého jména a vzhledy her. Máš {coins} {icon} Jomarid Coins.' : 'Odznaky za čtení i za hry. Máš {coins} {icon} Jomarid Coins.', { coins: <span data-testid="badges-coins">{stats.jomaridCoins}</span>, icon: <Coins size={11} className="inline text-amber-500 -mt-0.5" aria-hidden="true" /> })}
        </p>
      </div>

      <nav aria-label={t('Sekce odznaků')} data-tour="badges-tabs" className="flex flex-wrap gap-2 mb-6">
        {tabs.map((tb) => {
          const on = tb.id === active;
          const Icon = tb.icon;
          return (
            <Link
              key={tb.id}
              to={tabPath(tb.id)}
              replace
              aria-current={on ? 'page' : undefined}
              data-testid={`badges-tab-${tb.id}`}
              style={{ backgroundColor: on ? 'var(--bg-primary)' : 'var(--bg-card)', color: on ? 'var(--text-primary)' : 'var(--text-body)', borderColor: 'var(--border-color)' }}
              className="px-3.5 py-2 rounded-xl border text-[0.6875rem] font-black uppercase tracking-wider no-underline inline-flex items-center gap-1.5"
            >
              <Icon size={14} aria-hidden="true" /> {t(tb.label)}
            </Link>
          );
        })}
      </nav>

      {active === 'books' && <BadgesSection stats={stats} />}
      {active === 'games' && <GamesProgress progress={stats.gameProgress || EMPTY_PROGRESS} userId={user?.id} />}
      {active === 'shop' && cosmetics && (
        <Shop
          cosmetics={cosmetics}
          coins={stats.jomaridCoins}
          unlocked={stats.gameProgress?.unlocked || []}
          onCosmetics={setCosmetics}
          onBalance={(balance) => setStats((prev) => ({ ...prev, jomaridCoins: balance }))}
        />
      )}
    </div>
  );
};
