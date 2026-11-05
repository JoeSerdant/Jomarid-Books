import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { BOOK_BADGES } from '../constants/badges';
import { countGameBadges } from '../gameRecords/catalog';
import { EMPTY_LEADERBOARDS, EMPTY_STATS, loadLeaderboards, loadMyStats } from '../stats/loadStats';
import { FROZEN_ICON_COLOR, FROZEN_LABEL, boardRowStyle, isFrozenRow } from '../stats/boardRow';
import { CountUp } from '../lively/CountUp';
import { calculateGoalMultiplier, DEFAULT_MONTHLY_GOAL } from '../constants/leveling';
import { STREAK_FREEZE_PRICE } from '../constants/economy';
import { titleLabel } from '../shop/catalog';
import { Award, Calendar, CheckCircle, ChevronRight, Coins, Flame, Loader2, Lock, Shield, ShieldCheck, ShieldOff, Snowflake, Sparkles, TrendingUp, Trophy, Users } from 'lucide-react';
import { t, formatNumber } from '../i18n';

export const UserStats = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);
  const [buyingFreeze, setBuyingFreeze] = useState(false);
  // Koupené a nasazené zboží z obchůdku (tady jen kvůli titulu u jména); null, dokud se nenačte nebo když v databázi obchůdek ještě není.
  const [cosmetics, setCosmetics] = useState(null);
  
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState(String(DEFAULT_MONTHLY_GOAL));
  const [goalError, setGoalError] = useState('');
  const [activeTab, setActiveTab] = useState('streak');

  const [stats, setStats] = useState(EMPTY_STATS);

  const [leaderboards, setLeaderboards] = useState(EMPTY_LEADERBOARDS);

  const fetchFullStats = async () => {
    if (!user) return;

    try {
      setLoading(true);
      // Výpočet statistik (úroveň, XP, odemykání odznaků) je ve sdíleném modulu: stejný ho používá i stránka Odznaky.
      const mine = await loadMyStats(supabase, user);
      setCosmetics(mine.cosmetics);
      setStats(mine.stats);

      const boards = await loadLeaderboards(supabase, user, mine.stats);
      if (boards) setLeaderboards(boards);
    } catch (error) {
      console.error("Kritická chyba při výpočtu statistik:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFullStats();
  }, [user]);

  const togglePrivacy = async () => {
    if (!user || isUpdatingPrivacy) return;
    setIsUpdatingPrivacy(true);
    const newValue = !stats.showInLeaderboard;
    try {
      await supabase.from('profiles').update({ show_in_leaderboard: newValue }).eq('id', user.id);
      setStats(prev => ({ ...prev, showInLeaderboard: newValue }));
      fetchFullStats();
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdatingPrivacy(false);
    }
  };

  const handleBuyStreakFreeze = async () => {
    if (!user || buyingFreeze) return;
    setBuyingFreeze(true);
    try {
      const { data, error } = await supabase.rpc('buy_streak_freeze');
      if (error) throw error;
      setStats(prev => ({
        ...prev,
        jomaridCoins: data?.new_balance ?? prev.jomaridCoins,
        streakFreezes: data?.streak_freezes ?? prev.streakFreezes,
      }));
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('insufficient_coins')) {
        // Zůstatek v místním stavu mohl mezitím zestárnout (např. utraceno
        // jinde bez obnovení téhle stránky) - než ukážeme "kolik máš", radši
        // se zeptáme serveru na skutečné aktuální číslo, ať hláška neukazuje
        // hodnotu, která už neodpovídá realitě.
        let realBalance = stats.jomaridCoins;
        try {
          const { data: freshProfile } = await supabase.from('profiles').select('coins').eq('id', user.id).maybeSingle();
          if (freshProfile) {
            realBalance = freshProfile.coins ?? realBalance;
            setStats(prev => ({ ...prev, jomaridCoins: realBalance }));
          }
        } catch (refreshErr) {
          console.error('Nepodařilo se ověřit aktuální zůstatek:', refreshErr);
        }
        alert(t('Nemáš dost Jomarid Coinů. Streak Freeze stojí {price}, ty máš {balance}.', { price: STREAK_FREEZE_PRICE, balance: realBalance }));
      } else {
        console.error('Streak Freeze:', err);
        alert(friendlyError(err, t('Nákup se nezdařil. Zkus to znovu.')));
      }
    } finally {
      setBuyingFreeze(false);
    }
  };

  const handleSaveGoal = async () => {
    const goalNum = parseInt(newGoalInput, 10);
    setGoalError('');
    if (isNaN(goalNum) || goalNum < 1) return setGoalError(t('Zadej platné číslo.'));
    if (goalNum > 500) return setGoalError(t('Nejvýš 500 knih.'));
    // Jakmile je dosaženo aspoň poloviny současného cíle v tomhle měsíci, cíl
    // už nejde změnit vůbec (ani nahoru, ani dolů) - server (trigger) totéž
    // vynucuje nezávisle na téhle kontrole, tohle je jen rychlejší zpětná vazba.
    if (stats.goalLockedCompletely) {
      return setGoalError(t('Cíl už nejde změnit - máš splněno {done} z {goal} (aspoň polovina). Zkus to zas příští měsíc.', { done: stats.goalProgress, goal: stats.monthlyGoal }));
    }
    // Jinak lze zvýšit vždy. Snížit jen pokud tenhle měsíc ještě nebyl cíl měněný.
    if (goalNum < stats.monthlyGoal && stats.goalLocked) {
      return setGoalError(t('Tento měsíc lze cíl už jen zvýšit, ne snížit.'));
    }

    try {
      const { error } = await supabase.from('profiles').update({ 
        monthly_goal: goalNum, 
        last_goal_change_date: new Date().toISOString() 
      }).eq('id', user.id);
      if (error) throw error;
      localStorage.setItem(`monthly_goal_${user.id}`, goalNum);
      setIsEditingGoal(false);
      fetchFullStats();
    } catch (err) {
      console.error('Měsíční cíl:', err);
      setGoalError(friendlyError(err, t('Cíl se nepodařilo uložit. Zkus to znovu.')));
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div style={{ borderTopColor: 'transparent', borderLeftColor: 'var(--bg-primary)' }} className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"></div>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold opacity-60 animate-pulse">{t('Sestavuji tvůj kompletní přehled a síň slávy...')}</p>
      </div>
    );
  }

  const progressPercent = Math.min(100, Math.round((stats.monthlyRead / stats.monthlyGoal) * 100));
  const xpPercent = Math.min(100, Math.round((stats.xp / stats.xpNeededForNext) * 100));
  const myTitle = titleLabel(cosmetics?.equipped?.title);
  const categories = [
    { id: 'streak', label: t('Plamínky 🔥'), icon: Flame, suffix: n => t.p(n, 'den', 'dny', 'dní') },
    { id: 'level', label: t('Úroveň 🏆'), icon: Trophy, suffix: 'lvl' },
    { id: 'totalRead', label: t('Celkem knih 📚'), icon: CheckCircle, suffix: n => t.p(n, 'kniha', 'knihy', 'knih') },
    { id: 'monthlyRead', label: t('Tento měsíc 📅'), icon: Calendar, suffix: n => t.p(n, 'kniha', 'knihy', 'knih') },
    { id: 'xp', label: t('Celkové XP ⭐'), icon: Sparkles, suffix: 'XP' }
  ];

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-4xl mx-auto px-4 py-12 animate-in fade-in duration-300">
      
      {/* SOUKROMÍ */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-4 mb-6 flex flex-col sm:flex-row justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center gap-3 text-left">
          {stats.showInLeaderboard ? <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg"><Shield size={20} /></div> : <div className="p-2 bg-red-500/10 text-red-500 rounded-lg"><ShieldOff size={20} /></div>}
          <div>
            <h4 className="text-sm font-black m-0">{t('Zveřejnění v Síni slávy')}</h4>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{stats.showInLeaderboard ? t('Ostatní čtenáři tě vidí v žebříčcích.') : t('Tvůj profil je skrytý. Výsledky vidíš pouze ty.')}</p>
          </div>
        </div>
        <button onClick={togglePrivacy} disabled={isUpdatingPrivacy} style={{ backgroundColor: stats.showInLeaderboard ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-primary)', color: stats.showInLeaderboard ? '#ef4444' : 'var(--text-primary)' }} className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer border-none shadow-sm hover:opacity-90 transition-all">
          {isUpdatingPrivacy ? t('Aktualizuji...') : stats.showInLeaderboard ? t('Skrýt výsledky 🔒') : t('Chci soutěžit! 🌍')}
        </button>
      </div>

     {/* HLAVNÍ PROFILOVÁ HLAVIČKA (TMAVÝ KONZISTENTNÍ VZHLED) */}
<div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-2xl p-6 md:p-8 shadow-sm mb-8 relative overflow-hidden">
  <div style={{ backgroundColor: 'var(--bg-primary)' }} className="absolute -right-10 -top-10 w-40 h-40 opacity-10 rounded-full blur-2xl"></div>
  
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
    <div className="text-left">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-3 py-1 rounded-full font-black uppercase tracking-wider inline-block ${stats.levelBadgeClass}`}>
          {t(stats.levelName)}
        </span>
        <span className="text-xs px-3 py-1 rounded-full font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 flex items-center gap-1">
          <Coins size={12} /> <CountUp value={stats.jomaridCoins} /> {t('Coins')}
        </span>
        {myTitle && (
          <span data-testid="own-title" style={{ borderColor: 'var(--bg-primary)', color: 'var(--text-body)' }} className="text-xs px-3 py-1 rounded-full font-black uppercase tracking-wider border">
            {myTitle}
          </span>
        )}
      </div>
      <h1 className="text-3xl font-black tracking-tight mb-1" style={{ color: 'var(--text-body)' }}>{t('Moje Statistiky')}</h1>
      <p style={{ color: 'var(--text-muted)' }} className="text-sm font-medium opacity-80">{t('XP dostáváš za dočtené knihy (víc při splněných vyšších cílech), za denní sérii a za odznaky. Odznaky se vyhodnotí, když otevřeš tuhle stránku nebo stránku Odznaky.')}</p>
    </div>
    
    {/* LEVEL BAR */}
    <div style={{ backgroundColor: 'var(--bg-badge)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-4 flex items-center gap-4 min-w-[250px]">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black shadow-lg transition-all duration-300 ${stats.levelBoxClass}`}>
        <CountUp value={stats.level} />
      </div>
      <div className="flex-1 space-y-1 text-left">
        <div className="flex justify-between text-[0.625rem] font-black uppercase tracking-wider opacity-60" style={{ color: 'var(--text-body)' }}>
          <span>{t('Úroveň čtenáře')}</span>
          <span><CountUp value={stats.xp} /> / {stats.xpNeededForNext} {t('XP')}</span>
        </div>
        <div className="w-full bg-black/20 dark:bg-white/10 h-2 rounded-full overflow-hidden">
          <div data-lv-grow className="h-full rounded-full transition-all duration-500" style={{ width: `${xpPercent}%`, backgroundColor: 'var(--bg-primary)' }}></div>
        </div>
      </div>
    </div>
  </div>
</div> 

    
      {/* METRIKY */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        
        {/* Streak */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="space-y-1 text-left">
              <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider">{t('Aktuální Streak')}</h3>
              <p className="text-4xl font-black text-amber-600 flex items-baseline gap-1 m-0"><CountUp value={stats.streak} /> <span style={{ color: 'var(--text-muted)' }} className="text-xs uppercase font-bold opacity-60">{t.p(stats.streak, 'den', 'dny', 'dní')}</span></p>
            </div>
            <div className="p-3 bg-amber-500/10 text-amber-600 rounded-xl"><Flame size={24} className={stats.streak > 0 ? "fill-amber-500" : ""} /></div>
          </div>
          <div style={{ borderColor: 'var(--border-color)' }} className="mt-2 pt-2 border-t text-left text-[0.625rem] space-y-0.5">
            <div className={`flex justify-between ${stats.streak < 10 ? 'font-black text-amber-600' : 'opacity-60'}`}><span>{t('0-9 dní série:')}</span><span>{t('streak * 10 XP')}</span></div>
            <div className={`flex justify-between ${stats.streak >= 10 && stats.streak < 50 ? 'font-black text-indigo-500' : 'opacity-60'}`}><span>{t('10-49 dní 🔥:')}</span><span>{t('streak * 25 XP')}</span></div>
            <div className={`flex justify-between ${stats.streak >= 50 ? 'font-black text-emerald-500 animate-pulse' : 'opacity-60'}`}><span>{t('50+ dní 👑:')}</span><span>{t('streak * 50 XP')}</span></div>
          </div>
        </div>

        {/* Měsíční cíl */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <div className="space-y-1 text-left">
                <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider">{t('Výzva na {month}', { month: stats.currentMonthName })}</h3>
                <p style={{ color: 'var(--text-badge)' }} className="text-4xl font-black m-0"><CountUp value={stats.monthlyRead} /> <span style={{ color: 'var(--text-muted)' }} className="text-xs uppercase font-bold opacity-60">z {stats.monthlyGoal}</span></p>
              </div>
              <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="p-3 rounded-xl"><Calendar size={24} /></div>
            </div>
            <div className="space-y-1">
              <div className="w-full bg-black/5 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div data-lv-grow className="h-full rounded-full transition-all duration-500" style={{ width: `${progressPercent}%`, backgroundColor: 'var(--bg-primary)' }}></div>
              </div>
              <div style={{ color: 'var(--text-muted)' }} className="flex justify-between text-[0.625rem] font-black uppercase opacity-80">
                <span>{t('{pct}% splněno', { pct: progressPercent })}</span><span>{stats.daysRemainingInMonth === 0 ? t('Poslední den!') : t.p(stats.daysRemainingInMonth, 'Zbývá {n} den', 'Zbývají {n} dny', 'Zbývá {n} dní', { n: stats.daysRemainingInMonth })}</span>
              </div>
            </div>
          </div>
          <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-3 border-t flex flex-col gap-1 text-xs font-bold">
            {isEditingGoal ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 w-full">
                  <input type="number" min={stats.goalLocked ? stats.monthlyGoal : 1} max="500" disabled={stats.goalLockedCompletely} value={newGoalInput} onChange={(e) => setNewGoalInput(e.target.value)} style={{ backgroundColor: 'var(--bg-body)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} className="w-16 px-2 py-1 border rounded-md outline-none text-sm font-bold text-center disabled:opacity-50" />
                  <button disabled={stats.goalLockedCompletely} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} onClick={handleSaveGoal} className="px-2 py-1 rounded font-black uppercase text-[0.625rem] cursor-pointer border-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{t('Uložit')}</button>
                  <button style={{ color: 'var(--text-muted)' }} onClick={() => { setIsEditingGoal(false); setGoalError(''); }} className="px-1 py-1 font-bold cursor-pointer bg-transparent border-none">{t('Zrušit')}</button>
                </div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-70">
                  {stats.goalLockedCompletely ? (
                    t('Cíl už nejde měnit - máš splněno {done} z {goal} (aspoň polovina). Zas příští měsíc.', { done: stats.goalProgress, goal: stats.monthlyGoal })
                  ) : (() => {
                    const n = parseInt(newGoalInput, 10);
                    const cur = Math.round(calculateGoalMultiplier(stats.highestGoalCompleted) * 100);
                    if (!isNaN(n) && n > stats.highestGoalCompleted) {
                      const after = Math.round(calculateGoalMultiplier(n) * 100);
                      return t('Bonus XP dostaneš až SPLNĚNÍM cíle: přečteš-li {n} knih za měsíc, budeš mít natrvalo {after}% tempa (teď {cur}%). Za nesplněný cíl nic. Po dosažení poloviny nejde měnit.', { n, after, cur });
                    }
                    return t('Teď máš {cur}% XP tempa (nejvyšší splněný cíl: {goal}). Po dosažení poloviny cíle už nejde měnit.', { cur, goal: stats.highestGoalCompleted });
                  })()}
                </span>
                {goalError && <span className="text-red-500 text-[0.625rem]">{goalError}</span>}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-muted)' }} className="opacity-70 flex items-center gap-1">
                  {t('Měsíční cíl:')}
                  {stats.goalLockedCompletely && <Lock size={12} className="text-red-500" title={t('Uzamčeno - dosaženo {done} z {goal}', { done: stats.goalProgress, goal: stats.monthlyGoal })} />}
                  {stats.goalLocked && !stats.goalLockedCompletely && <Lock size={12} className="text-amber-500" title={t('Tento měsíc lze cíl už jen zvýšit')} />}
                </span>
                <button onClick={() => { setIsEditingGoal(true); setNewGoalInput(stats.monthlyGoal.toString()); }} style={{ color: stats.goalLockedCompletely ? 'var(--text-muted)' : 'var(--text-badge)' }} className="font-black uppercase tracking-wider p-0 bg-transparent border-none cursor-pointer text-[0.625rem]">
                  {stats.goalLockedCompletely ? t('Uzamčeno') : stats.goalLocked ? t('Zvýšit Cíl') : t('Změnit Cíl')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Celková knihovna */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="space-y-1 text-left">
              <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider">{t('Celková knihovna')}</h3>
              <p style={{ color: 'var(--text-body)' }} className="text-4xl font-black m-0"><CountUp value={stats.totalRead} /> <span style={{ color: 'var(--text-muted)' }} className="text-xs uppercase font-bold opacity-60">{t.p(stats.totalRead, 'kniha', 'knihy', 'knih')}</span></p>
            </div>
            <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="p-3 rounded-xl"><CheckCircle size={24} /></div>
          </div>
          <p style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }} className="text-xs font-medium mt-4 pt-3 border-t text-left flex items-center gap-1">
            <Sparkles size={12} style={{ color: 'var(--bg-primary)' }} /> {t('Všechna přečtená díla od začátku.')}
          </p>
        </div>
      </div>

      {/* TÝDENNÍ AKTIVITA */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
        <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider mb-4 text-left flex items-center gap-1.5"><TrendingUp size={14} /> {t('Tvoje aktivita')}</h3>
        <div className="grid grid-cols-7 gap-2 md:gap-4 text-center">
          {stats.weeklyActivity.map((day, idx) => (
            <div key={idx} style={{ borderColor: day.isToday ? 'var(--bg-primary)' : 'transparent', backgroundColor: day.isToday ? 'var(--bg-badge)' : 'transparent' }} className="p-3 rounded-xl flex flex-col items-center gap-2 border">
              <span style={{ color: day.isToday ? 'var(--text-badge)' : 'var(--text-muted)' }} className={`text-xs font-black uppercase ${!day.isToday && 'opacity-60'}`}>{day.dayLabel}</span>
              <div style={{ backgroundColor: day.isActive ? (day.isFrozen ? 'rgba(56, 189, 248, 1)' : 'rgba(245, 158, 11, 1)') : 'rgba(0,0,0,0.05)', color: day.isActive ? '#ffffff' : 'var(--text-muted)' }} className="w-8 h-8 rounded-full flex items-center justify-center shadow-sm" title={day.isFrozen ? t('Zachráněno Streak Freezem') : undefined}>
                {day.isFrozen ? <ShieldCheck size={16} className="text-white" /> : day.isActive ? <Flame size={16} className="fill-white text-white" /> : <div style={{ backgroundColor: 'currentColor' }} className="w-1.5 h-1.5 rounded-full opacity-40"></div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TREND ČTENÍ (POSLEDNÍCH 6 MĚSÍCŮ) */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
        <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider mb-4 text-left flex items-center gap-1.5"><TrendingUp size={14} /> {t('Trend čtení (posledních 6 měsíců)')}</h3>
        {(() => {
          const maxCount = Math.max(1, ...stats.readingTrend.map(m => m.count));
          const barW = 40, gap = 24, chartH = 90, topPad = 18;
          const totalW = stats.readingTrend.length * (barW + gap) - gap;
          return (
            <svg viewBox={`0 0 ${totalW} ${chartH + topPad + 20}`} width="100%" style={{ maxHeight: 160 }} preserveAspectRatio="xMidYMid meet">
              {stats.readingTrend.map((m, i) => {
                const h = m.count > 0 ? Math.max(4, (m.count / maxCount) * chartH) : 2;
                const x = i * (barW + gap);
                const y = topPad + (chartH - h);
                return (
                  <g key={i}>
                    {m.count > 0 && (
                      <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="12" fontWeight="900" fill="var(--bg-primary)">{m.count}</text>
                    )}
                    <rect x={x} y={y} width={barW} height={h} rx="6" fill="var(--bg-primary)" opacity={m.count > 0 ? 1 : 0.15} />
                    <text x={x + barW / 2} y={chartH + topPad + 16} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-muted)" opacity="0.7">{m.label}</text>
                  </g>
                );
              })}
            </svg>
          );
        })()}
      </div>

      {/* STREAK FREEZE */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-left">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-cyan-400 flex items-center justify-center text-white shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h4 className="font-black text-sm uppercase m-0">{t('Streak Freeze — {n} k dispozici', { n: stats.streakFreezes })}</h4>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">{t('Zmeškaný den nezlomí sérii, pokud máš aspoň jednu pojistku.')}</p>
          </div>
        </div>
        <button
          onClick={handleBuyStreakFreeze}
          disabled={buyingFreeze || stats.jomaridCoins < STREAK_FREEZE_PRICE}
          style={{ backgroundColor: stats.jomaridCoins < STREAK_FREEZE_PRICE ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: stats.jomaridCoins < STREAK_FREEZE_PRICE ? 'var(--text-muted)' : 'var(--text-primary)' }}
          className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer border-none shadow-sm whitespace-nowrap disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {buyingFreeze ? <Loader2 size={14} className="animate-spin" /> : <>{t('Koupit za {n}', { n: STREAK_FREEZE_PRICE })} <Coins size={12} /></>}
        </button>
      </div>

      {/* SÍŇ SLÁVY */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider m-0 flex items-center gap-1.5"><Users size={16} style={{ color: 'var(--bg-primary)' }} /> {t('Globální Síň Slávy Jomarid Books')}</h3>
          {!stats.showInLeaderboard && <span className="text-[0.625rem] font-bold bg-red-500/10 text-red-400 px-2.5 py-1 rounded-md uppercase">{t('Režim inkognito 🔒')}</span>}
        </div>
        <div className="flex flex-wrap gap-2 mb-6 border-b pb-4" style={{ borderColor: 'var(--border-color)' }}>
          {categories.map(cat => (
            <button key={cat.id} onClick={() => setActiveTab(cat.id)} style={{ backgroundColor: activeTab === cat.id ? 'var(--bg-primary)' : 'var(--bg-badge)', color: activeTab === cat.id ? 'var(--text-primary)' : 'var(--text-badge)' }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black uppercase tracking-wider border-none cursor-pointer transition-all shadow-sm">
              <cat.icon size={14} /> {cat.label}
            </button>
          ))}
        </div>
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
          {leaderboards[activeTab]?.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold text-center py-6 opacity-60">{t('V této kategorii zatím nikdo nesoutěží.')}</p>
          ) : (
            leaderboards[activeTab].map((row, index) => {
              const cat = categories.find(c => c.id === activeTab);
              const rank = row.rank || index + 1;
              let medalStyle = rank === 1 ? "text-xl w-6 text-center animate-bounce" : rank === 2 ? "text-lg w-6 text-center" : rank === 3 ? "text-md w-6 text-center" : "text-xs font-black opacity-40 w-6 text-center";
              const featuredBadgeDef = row.featuredBadge ? BOOK_BADGES.find(b => b.id === row.featuredBadge) : null;
              const FeaturedIcon = featuredBadgeDef?.icon;
              const rowTitle = row.isMe ? myTitle : row.title;
              const frozenRow = isFrozenRow(row, activeTab);
              return (
                <div key={`${activeTab}-${index}`} data-testid={row.isMe ? 'lb-me' : undefined} data-frozen={frozenRow ? 'true' : undefined} style={{ marginTop: index === 10 ? '1rem' : undefined, ...boardRowStyle(row, activeTab) }} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${row.isMe && 'font-bold shadow-sm'}`}>
                  <div className="flex items-center gap-4 text-left">
                    <span className={medalStyle}>{rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`}</span>
                    {FeaturedIcon && (
                      <span title={t(featuredBadgeDef.title)} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        <FeaturedIcon size={12} />
                      </span>
                    )}
                    <span className="text-sm tracking-wide truncate max-w-[200px] sm:max-w-[350px]">{row.email} {row.isMe && <span className="text-[0.625rem] bg-[var(--bg-primary)] text-[var(--text-primary)] px-1.5 py-0.5 rounded ml-1 uppercase font-black">{t('Ty')}</span>}</span>
                    {rowTitle && <span data-testid="lb-title" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }} className="text-[0.625rem] font-black uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0">{rowTitle}</span>}
                  </div>
                  <div className="text-right font-black text-sm flex items-center gap-1">
                    {frozenRow && <Snowflake size={14} role="img" aria-label={t(FROZEN_LABEL)} data-testid="lb-frozen" style={{ color: FROZEN_ICON_COLOR }} className="shrink-0"><title>{t(FROZEN_LABEL)}</title></Snowflake>}
                    <span><CountUp value={row[activeTab]} format={(n) => formatNumber(n)} delay={400} /></span>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-bold uppercase opacity-60">{typeof cat?.suffix === 'function' ? cat.suffix(row[activeTab]) : cat?.suffix}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {activeTab === 'streak' && leaderboards.streak?.some(r => isFrozenRow(r, 'streak')) && (
          <p data-testid="lb-frozen-legend" style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-3 flex items-center gap-1.5">
            <Snowflake size={12} aria-hidden="true" style={{ color: FROZEN_ICON_COLOR }} className="shrink-0" />
            {t('Modrý řádek: sérii drží pojistka (Streak Freeze), takže neskončila.')}
          </p>
        )}
      </div>

      {/* ODKAZ NA ODZNAKY, TITULY A VZHLED HER (mají vlastní stránku) */}
      <Link
        to="/badges"
        data-testid="badges-link"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="border rounded-2xl p-6 shadow-sm mb-8 flex items-center gap-4 no-underline"
      >
        <span style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center"><Award size={20} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span style={{ color: 'var(--text-muted)' }} className="block text-xs font-black uppercase tracking-wider">{t('Odznaky, tituly a vzhled her')}</span>
          <span style={{ color: 'var(--text-muted)' }} className="block text-xs mt-1 opacity-70">
            {t('Odznaky knih: {a} z {b}. Odznaky her: {c} z {d}.', { a: stats.unlockedBadges.length, b: BOOK_BADGES.length, c: countGameBadges(stats.gameProgress?.unlocked).unlocked, d: countGameBadges(stats.gameProgress?.unlocked).total })}
          </span>
        </span>
        <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
      </Link>

      {/* TLAČÍTKO ZPĚT */}
      <div className="flex justify-end">
        <Link to="/app" className="no-underline">
          <button style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="flex items-center gap-1 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider hover:opacity-90 transition-opacity border-none cursor-pointer shadow-md">
            {t('Zpět do knihovny')} <ChevronRight size={14} />
          </button>
        </Link>
      </div>

    </div>
  );
};


