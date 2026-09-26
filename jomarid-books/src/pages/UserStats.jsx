import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BOOK_BADGES } from '../constants/badges';
import { calculateXpMultiplier, calculateLevelAndProgress, getLevelVisuals } from '../constants/leveling';
import { BadgesSection } from '../components/BadgesSection';
import { Award, Calendar, CheckCircle, ChevronRight, Coins, Flame, Loader2, Lock, Shield, ShieldCheck, ShieldOff, Sparkles, TrendingUp, Trophy, Users } from 'lucide-react';

/**
 * POZOR: Tahle funkce se už NEPOUŽÍVÁ pro výpočet celkových mincí uživatele
 * (viz fetchFullStats v UserStats) - level/streak/goal/počet odznáčků už mají
 * vlastní odměnu přes BOOK_BADGES, takže sčítání obojího dvakrát počítalo stejné mince.
 * Necháno tu jen pro případné budoucí použití (např. jednorázový bonus mimo odznáčky).
 */
export const calculateUserCoins = (
  level = 1, 
  streak = 0, 
  unlockedBadges = [], 
  goalCompleted = false
) => {
  let coins = 0;

  // 100 mincí za každý postoupený level (Level 1 = 0 mincí)
  coins += Math.max(0, level - 1) * 100;

  // 50 mincí za každý dokončený týden sérií (7 dní = 50, 14 dní = 100, ...)
  coins += Math.floor(Math.max(0, streak) / 7) * 50;

  // 75 mincí za každý získaný odznak
  const badgesCount = Array.isArray(unlockedBadges) ? unlockedBadges.length : (unlockedBadges || 0);
  coins += Math.max(0, badgesCount) * 75;

  // Bonus 200 mincí za splněný měsíční cíl
  if (goalCompleted) {
    coins += 200;
  }

  return coins;
};

// ==========================================
// 3. HLAVNÍ KOMPONENTA USER STATS
// ==========================================
export const UserStats = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);
  const [buyingFreeze, setBuyingFreeze] = useState(false);
  
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState('25');
  const [goalError, setGoalError] = useState('');
  const [activeTab, setActiveTab] = useState('streak');

  const [stats, setStats] = useState({
    streak: 0,
    monthlyRead: 0,
    monthlyGoal: 25,
    totalRead: 0,
    weeklyActivity: [],
    readingTrend: [],
    xp: 0,
    level: 1,
    levelName: "Začínající čtenář 🌱",
    levelBadgeClass: "",
    levelBoxClass: "",
    xpNeededForNext: 100,
    daysRemainingInMonth: 0,
    currentMonthName: "",
    showInLeaderboard: true,
    unlockedBadges: [],
    jomaridCoins: 0,
    lifetimeCoins: 0,
    streakFreezes: 0,
    frozenDates: [],
    highestGoalEver: 5,
    featuredBadge: null,
    goalLocked: false
  });

  const [leaderboards, setLeaderboards] = useState({
    streak: [],
    level: [],
    totalRead: [],
    monthlyRead: [],
    xp: []
  });

  const fetchFullStats = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      const daysRemainingInMonth = lastDayOfMonth - now.getDate();
      const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
      const currentMonthName = monthNames[currentMonth];

      // Paralelní stažení profilu, knih a denní aktivity
      const [profileRes, booksRes, activityRes] = await Promise.all([
        supabase.from('profiles').select('fake_xp, bonus_xp, show_in_leaderboard, unlocked_badges, monthly_goal, last_goal_change_date, coins, lifetime_coins_earned, streak_freezes, frozen_dates, highest_goal_ever, featured_badge').eq('id', user.id).maybeSingle(),
        supabase.from('user_books').select('updated_at, is_read').eq('user_id', user.id).eq('is_read', true),
        supabase.from('user_daily_activity').select('activity_date').eq('user_id', user.id).order('activity_date', { ascending: false })
      ]);

      const profileData = profileRes.data || {};
      const userBooks = booksRes.data || [];
      const activityData = activityRes.data || [];

      // 1. ZÁKLADNÍ METRIKY
      const totalRead = userBooks.length;
      const monthlyRead = userBooks.filter(ub => {
        if (!ub.updated_at) return false;
        const d = new Date(ub.updated_at);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      }).length;

      // Trend čtení za posledních 6 měsíců - počítáno z dat, co už appka stejně
      // stahuje (user_books), žádný extra dotaz.
      const monthNamesShort = ["Led", "Úno", "Bře", "Dub", "Kvě", "Čvn", "Čvc", "Srp", "Zář", "Říj", "Lis", "Pro"];
      const readingTrend = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(currentYear, currentMonth - i, 1);
        const count = userBooks.filter(ub => {
          if (!ub.updated_at) return false;
          const ubd = new Date(ub.updated_at);
          return ubd.getFullYear() === d.getFullYear() && ubd.getMonth() === d.getMonth();
        }).length;
        readingTrend.push({ label: monthNamesShort[d.getMonth()], count });
      }

      // 2. MĚSÍČNÍ CÍL A ZAMYKÁNÍ SMĚRU ZMĚNY
      // Cíl lze v appce teď KDYKOLIV zvýšit (knihy na webu jsou krátké, 5 se dá
      // přečíst rychle) - "zamčené" je jen SNÍŽENÍ v rámci stejného kalendářního
      // měsíce (brání snížit si cíl těsně před koncem kvůli snadnému splnění
      // goal_* odznáčků). Server (trigger) vynucuje totéž, tohle je jen pro UI.
      const currentGoal = profileData.monthly_goal || parseInt(localStorage.getItem(`monthly_goal_${user.id}`), 10) || 25;
      const highestGoalEver = Math.max(parseInt(profileData.highest_goal_ever, 10) || 5, currentGoal);
      const lastGoalChange = profileData.last_goal_change_date ? new Date(profileData.last_goal_change_date) : null;
      const isChangedThisMonth = lastGoalChange && lastGoalChange.getFullYear() === currentYear && lastGoalChange.getMonth() === currentMonth;
      const isGoalLocked = isChangedThisMonth; // omezuje jen možnost SNÍŽIT, viz UI níže

      // 3. VÝPOČET STREAKU (s podporou Streak Freeze - zmeškaný den se počítá dál,
      // pokud ho appka může "zamrazit" pojistkou, kterou si uživatel koupil)
      let streak = 0;
      const activeDates = activityData.map(a => a.activity_date);
      const existingFrozenDates = Array.isArray(profileData.frozen_dates) ? profileData.frozen_dates : [];
      let availableFreezes = parseInt(profileData.streak_freezes, 10) || 0;
      const newlyFrozenDates = [];
      const resolvedThisPass = new Map();

      // Memoizované - stejné datum se v jednom průchodu nikdy nevyhodnotí (a
      // tedy nespotřebuje pojistku) dvakrát, i když se na něj appka zeptá vícekrát.
      const isCovered = (dateStr) => {
        if (resolvedThisPass.has(dateStr)) return resolvedThisPass.get(dateStr);
        let covered;
        if (activeDates.includes(dateStr) || existingFrozenDates.includes(dateStr)) {
          covered = true;
        } else if (availableFreezes > 0) {
          availableFreezes--;
          newlyFrozenDates.push(dateStr);
          covered = true;
        } else {
          covered = false;
        }
        resolvedThisPass.set(dateStr, covered);
        return covered;
      };

      const todayStr = new Date().toLocaleDateString('sv');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('sv');

      // Dnešek NESMÍ spotřebovat novou pojistku - den ještě neskončil, uživatel
      // ho může pokrýt přirozeně (přečtením), takže se na "dnes" ptáme jen na
      // přirozenou aktivitu nebo dřív už uloženou zmrazenou volbu, nikdy ne na
      // čerstvě spotřebovanou. Bez týhle výjimky by pouhá návštěva Statistik
      // před prvním přečtením dneška nevratně spotřebovala zaplacenou pojistku
      // na den, který ještě vůbec neskončil.
      const isTodayNaturallyCovered = activeDates.includes(todayStr) || existingFrozenDates.includes(todayStr);

      if (isTodayNaturallyCovered || isCovered(yesterdayStr)) {
        let checkDate = isTodayNaturallyCovered ? new Date() : yesterday;
        while (true) {
          const checkDateStr = checkDate.toLocaleDateString('sv');
          if (isCovered(checkDateStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
      }

      // Nově "utracené" pojistky (jen navrh klienta) se serverově ověří a
      // teprve pak trvale zapíšou - RPC je zdroj pravdy, ne tenhle výpočet.
      let displayStreakFreezes = availableFreezes + newlyFrozenDates.length;
      let displayFrozenDates = existingFrozenDates;
      if (newlyFrozenDates.length > 0) {
        try {
          const { data: freezeResult, error: freezeError } = await supabase.rpc('consume_streak_freezes', {
            freeze_dates: newlyFrozenDates
          });
          if (freezeError) throw freezeError;
          if (freezeResult) {
            displayStreakFreezes = freezeResult.streak_freezes ?? displayStreakFreezes;
            displayFrozenDates = freezeResult.frozen_dates || displayFrozenDates;
          }
        } catch (freezeErr) {
          console.error('Nepodařilo se zapsat spotřebu Streak Freeze:', freezeErr);
        }
      }

      // Týdenní aktivita
      const czechDays = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
      const weeklyActivityGenerated = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('sv');
        const isFrozen = !activeDates.includes(dateStr) && (existingFrozenDates.includes(dateStr) || newlyFrozenDates.includes(dateStr));
        weeklyActivityGenerated.push({
          dayLabel: czechDays[d.getDay()],
          isActive: activeDates.includes(dateStr) || isFrozen,
          isFrozen,
          isToday: i === 0
        });
      }

      // 4. TRVALÉ ODEMYKÁNÍ A ZAMYKÁNÍ ODZNÁČKŮ (BADGE LOCK-IN)
      let savedUnlockedBadges = Array.isArray(profileData.unlocked_badges) ? [...profileData.unlocked_badges] : [];
      let badgeBonusXp = 0;
      let newlyUnlockedBadges = [];

      // XP/level BEZ odznáčkového bonusu - potřeba dopředu, aby šlo vyhodnotit
      // odznáčky z kategorie "levels" (dřív se level do evalContextu vůbec nedostal).
      // Bonus se počítá z NEJVYŠŠÍHO cíle, jaký jsi kdy měl (highestGoalEver) -
      // jednou dosažený vyšší cíl už XP tempo nikdy nesníží, i když si cíl
      // později zase snížíš. Práh začíná už nad 5 (ne nad 25 jako dřív), protože
      // knihy na webu jsou krátké a 5 je snadné - vyšší cíl má hned znát.
      const goalMultiplier = highestGoalEver > 5 ? 1 + ((highestGoalEver - 5) * 0.02) : 1;
      const baseXpFromBooks = Math.round((totalRead * 100) * goalMultiplier);
      const streakXpBonus = calculateXpMultiplier(streak);
      const fakeXpFromDB = parseInt(profileData.fake_xp, 10) || 0;
      const bonusXpFromDB = parseInt(profileData.bonus_xp, 10) || 0;
      // POZOR: coins je teď SKUTEČNÁ utratitelná měna (nákup knih ji snižuje), takže se
      // s ní nesmí zacházet jako s odvozenou hodnotou, kterou lze při každém načtení přepsat -
      // to by smazalo utracené i nalogované mince. lifetime_coins_earned je oddělený součet,
      // který nikdy neklesá (i po utracení), a slouží jen k vyhodnocení odznáčků "nasbíral jsi X mincí".
      const dbCoins = parseInt(profileData.coins, 10) || 0;
      const dbLifetimeCoins = parseInt(profileData.lifetime_coins_earned, 10) || 0;

      const xpBeforeBadges = baseXpFromBooks + fakeXpFromDB + bonusXpFromDB + streakXpBonus;
      const { level: levelBeforeBadges } = calculateLevelAndProgress(xpBeforeBadges);

      // DŘÍV: evalContext neobsahoval level/jomaridCoins/unlockedBadges, takže odznáčky
      // kategorie "levels" a "special" (coins_*, badge_collector_*) nikdy nemohly splnit podmínku.
      const evalContext = {
        totalRead, streak, monthlyRead, monthlyGoal: currentGoal,
        level: levelBeforeBadges,
        jomaridCoins: dbLifetimeCoins,
        unlockedBadges: savedUnlockedBadges
      };

      BOOK_BADGES.forEach(badge => {
        const isAlreadyUnlocked = savedUnlockedBadges.includes(badge.id);

        if (isAlreadyUnlocked) {
          // XP se (na rozdíl od mincí) nikam neukládá jako běžící zůstatek - počítá
          // se vždy nanovo z CELÉHO seznamu odemknutých odznáčků. Bez týhle větve by
          // příspěvek starých odznáčků k XP při příštím načtení zmizel a level by
          // uživateli neprávem klesl zpátky dolů.
          badgeBonusXp += (badge.rewardXp || 0);
        } else if (badge.condition(evalContext)) {
          // Trvale odemknout nový odznak. Pole se mutuje na místě (push), takže
          // "special" odznáčky dál v poli hned vidí aktuální počet odemknutých odznáčků.
          savedUnlockedBadges.push(badge.id);
          badgeBonusXp += (badge.rewardXp || 0);
          newlyUnlockedBadges.push(badge);
        }
      });

      // 5. FINÁLNÍ HERNÍ MATEMATIKA (XP)
      const totalXp = xpBeforeBadges + badgeBonusXp;
      const { level, xpInCurrentLevel, xpNeededForNext } = calculateLevelAndProgress(totalXp);
      const visuals = getLevelVisuals(level);

      // ODZNÁČKY + MINCE: dřív appka sama počítala kolik mincí odznak nese a rovnou
      // to zapsala do profiles.coins - což mimo jiné znamenalo, že kdokoliv se
      // znalostí devtools mohl zavolat stejný update s libovolným číslem. Teď se jen
      // POŠLE seznam id odznáčků, které klient vyhodnotil jako nově splněné, a
      // grant_badge_rewards() na serveru sama dohledá, kolik ten konkrétní odznak
      // SKUTEČNĚ nese (z tabulky badge_rewards) a připíše přesně tolik - klient tedy
      // může nanejvýš "předstírat", že si zaslouží konkrétní odznak, ale nikdy už
      // nemůže poslat vlastní částku.
      let calculatedCoins = dbCoins;
      let calculatedLifetimeCoins = dbLifetimeCoins;

      if (newlyUnlockedBadges.length > 0) {
        try {
          const { data: grantResult, error: grantError } = await supabase.rpc('grant_badge_rewards', {
            badge_ids: newlyUnlockedBadges.map(b => b.id)
          });
          if (grantError) throw grantError;
          if (grantResult) {
            savedUnlockedBadges = grantResult.unlocked_badges || savedUnlockedBadges;
            calculatedCoins = grantResult.coins ?? calculatedCoins;
            calculatedLifetimeCoins = grantResult.lifetime_coins_earned ?? calculatedLifetimeCoins;
          }
        } catch (grantErr) {
          console.error('Nepodařilo se připsat odměnu za odznáčky:', grantErr);
          // Zápis selhal - odznáčky se v DB neodemkly, takže se příště (correctně)
          // zkusí odemknout znovu. Pro zobrazení v TÉHLE session necháváme
          // savedUnlockedBadges tak, jak je (s nově odemknutými odznáčky lokálně),
          // aby uživatel aspoň hned viděl, co si vysloužil.
        }
      }

      setStats({
        streak, monthlyRead, monthlyGoal: currentGoal, totalRead, weeklyActivity: weeklyActivityGenerated, readingTrend,
        xp: xpInCurrentLevel, level, levelName: visuals.name, levelBadgeClass: visuals.badge, levelBoxClass: visuals.box,
        xpNeededForNext, daysRemainingInMonth, currentMonthName, showInLeaderboard: profileData.show_in_leaderboard ?? true,
        unlockedBadges: savedUnlockedBadges, jomaridCoins: calculatedCoins, lifetimeCoins: calculatedLifetimeCoins, goalLocked: isGoalLocked,
        streakFreezes: displayStreakFreezes, frozenDates: displayFrozenDates, highestGoalEver, featuredBadge: profileData.featured_badge || null
      });

      // 6. LEADERBOARDS
      const { data: allProfiles } = await supabase.from('profiles').select('id, email, fake_xp, bonus_xp, unlocked_badges, featured_badge, highest_goal_ever').eq('show_in_leaderboard', true);
      if (allProfiles && allProfiles.length > 0) {
        const [allBooksRes, allActsRes] = await Promise.all([
          supabase.from('user_books').select('user_id, updated_at').eq('is_read', true),
          supabase.from('user_daily_activity').select('user_id, activity_date')
        ]);
        
        const allBooks = allBooksRes.data || [];
        const allActs = allActsRes.data || [];

        const mappedUsers = allProfiles.map(p => {
          const uBooks = allBooks.filter(b => b.user_id === p.id);
          const uActs = allActs.filter(a => a.user_id === p.id).map(a => a.activity_date);
          
          let uStreak = 0;
          if (uActs.length > 0) {
            const todayStr = new Date().toLocaleDateString('sv');
            const yest = new Date(); yest.setDate(yest.getDate() - 1);
            const yestStr = yest.toLocaleDateString('sv');
            
            if (uActs.includes(todayStr) || uActs.includes(yestStr)) {
              let chk = uActs.includes(todayStr) ? new Date() : yest;
              while (uActs.includes(chk.toLocaleDateString('sv'))) {
                uStreak++;
                chk.setDate(chk.getDate() - 1);
              }
            }
          }

          const uMRead = uBooks.filter(b => {
            if(!b.updated_at) return false;
            const d = new Date(b.updated_at);
            return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
          }).length;

          // Stejný vzorec jako pro přihlášeného uživatele výš (goalMultiplier +
          // XP z odznáčků) - jinak by žebříček podle XP/úrovně systematicky
          // podhodnocoval každého se sbírkou odznáčků nebo zvýšeným
          // highest_goal_ever, protože by to prostě nepočítal vůbec.
          const uGoalMultiplier = (parseInt(p.highest_goal_ever, 10) || 5) > 5
            ? 1 + (((parseInt(p.highest_goal_ever, 10) || 5) - 5) * 0.02)
            : 1;
          const uBadgeBonusXp = Array.isArray(p.unlocked_badges)
            ? p.unlocked_badges.reduce((sum, id) => {
                const badgeDef = BOOK_BADGES.find(bd => bd.id === id);
                return sum + (badgeDef?.rewardXp || 0);
              }, 0)
            : 0;

          const uXpTotal = Math.round(uBooks.length * 100 * uGoalMultiplier) + (parseInt(p.fake_xp, 10) || 0) + (parseInt(p.bonus_xp, 10) || 0) + calculateXpMultiplier(uStreak) + uBadgeBonusXp;
          const { level: uLvl } = calculateLevelAndProgress(uXpTotal);

          return {
            email: p.email ? p.email.split('@')[0] : 'Anonym',
            streak: uStreak,
            level: uLvl,
            totalRead: uBooks.length,
            monthlyRead: uMRead,
            xp: uXpTotal,
            featuredBadge: p.featured_badge || null,
            isMe: p.id === user.id
          };
        });

        setLeaderboards({
          streak: [...mappedUsers].sort((a, b) => b.streak - a.streak).slice(0, 10),
          level: [...mappedUsers].sort((a, b) => b.level - a.level).slice(0, 10),
          totalRead: [...mappedUsers].sort((a, b) => b.totalRead - a.totalRead).slice(0, 10),
          monthlyRead: [...mappedUsers].sort((a, b) => b.monthlyRead - a.monthlyRead).slice(0, 10),
          xp: [...mappedUsers].sort((a, b) => b.xp - a.xp).slice(0, 10)
        });
      }

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
        alert(`Nemáš dost Jomarid Coinů. Streak Freeze stojí 150, ty máš ${realBalance}.`);
      } else {
        alert('Nákup se nezdařil: ' + msg);
      }
    } finally {
      setBuyingFreeze(false);
    }
  };

  const handleSaveGoal = async () => {
    const goalNum = parseInt(newGoalInput, 10);
    setGoalError('');
    if (isNaN(goalNum) || goalNum < 1) return setGoalError('Zadej platné číslo.');
    if (goalNum > 500) return setGoalError('Nejvýš 500 knih.');
    // Zvýšit lze vždy. Snížit jen pokud tenhle měsíc ještě nebyl cíl měněný -
    // server (trigger) totéž vynucuje nezávisle na téhle kontrole.
    if (goalNum < stats.monthlyGoal && stats.goalLocked) {
      return setGoalError('Tento měsíc lze cíl už jen zvýšit, ne snížit.');
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
      setGoalError(err.message || 'Uložení selhalo.');
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div style={{ borderTopColor: 'transparent', borderLeftColor: 'var(--bg-primary)' }} className="w-10 h-10 border-4 rounded-full animate-spin mx-auto mb-4"></div>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold opacity-60 animate-pulse">Sestavuji tvůj kompletní přehled a síň slávy...</p>
      </div>
    );
  }

  const progressPercent = Math.min(100, Math.round((stats.monthlyRead / stats.monthlyGoal) * 100));
  const xpPercent = Math.min(100, Math.round((stats.xp / stats.xpNeededForNext) * 100));
  const categories = [
    { id: 'streak', label: 'Plamínky 🔥', icon: Flame, suffix: 'dní' },
    { id: 'level', label: 'Úroveň 🏆', icon: Trophy, suffix: 'lvl' },
    { id: 'totalRead', label: 'Celkem knih 📚', icon: CheckCircle, suffix: 'knih' },
    { id: 'monthlyRead', label: 'Tento měsíc 📅', icon: Calendar, suffix: 'knih' },
    { id: 'xp', label: 'Celkové XP ⭐', icon: Sparkles, suffix: 'XP' }
  ];

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-4xl mx-auto px-4 py-12 animate-in fade-in duration-300">
      
      {/* SOUKROMÍ */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-4 mb-6 flex flex-col sm:flex-row justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center gap-3 text-left">
          {stats.showInLeaderboard ? <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg"><Shield size={20} /></div> : <div className="p-2 bg-red-500/10 text-red-500 rounded-lg"><ShieldOff size={20} /></div>}
          <div>
            <h4 className="text-sm font-black m-0">Zveřejnění v Síni slávy</h4>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{stats.showInLeaderboard ? "Ostatní čtenáři tě vidí v žebříčcích." : "Tvůj profil je skrytý. Výsledky vidíš pouze ty."}</p>
          </div>
        </div>
        <button onClick={togglePrivacy} disabled={isUpdatingPrivacy} style={{ backgroundColor: stats.showInLeaderboard ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-primary)', color: stats.showInLeaderboard ? '#ef4444' : 'var(--text-primary)' }} className="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer border-none shadow-sm hover:opacity-90 transition-all">
          {isUpdatingPrivacy ? 'Aktualizuji...' : stats.showInLeaderboard ? 'Skrýt výsledky 🔒' : 'Chci soutěžit! 🌍'}
        </button>
      </div>

     {/* HLAVNÍ PROFILOVÁ HLAVIČKA (TMAVÝ KONZISTENTNÍ VZHLED) */}
<div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-3xl p-6 md:p-8 shadow-sm mb-8 relative overflow-hidden">
  <div style={{ backgroundColor: 'var(--bg-primary)' }} className="absolute -right-10 -top-10 w-40 h-40 opacity-10 rounded-full blur-2xl"></div>
  
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
    <div className="text-left">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs px-3 py-1 rounded-full font-black uppercase tracking-wider inline-block ${stats.levelBadgeClass}`}>
          {stats.levelName}
        </span>
        <span className="text-xs px-3 py-1 rounded-full font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 flex items-center gap-1">
          <Coins size={12} /> {stats.jomaridCoins} Coins
        </span>
      </div>
      <h1 className="text-3xl font-black tracking-tight mb-1" style={{ color: 'var(--text-body)' }}>Moje Statistiky</h1>
      <p style={{ color: 'var(--text-muted)' }} className="text-sm font-medium opacity-80">Každá přečtená kapitola tě posouvá v žebříčku.</p>
    </div>
    
    {/* LEVEL BAR */}
    <div style={{ backgroundColor: 'var(--bg-badge)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-4 flex items-center gap-4 min-w-[250px]">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black shadow-lg transition-all duration-300 ${stats.levelBoxClass}`}>
        {stats.level}
      </div>
      <div className="flex-1 space-y-1 text-left">
        <div className="flex justify-between text-[10px] font-black uppercase tracking-wider opacity-60" style={{ color: 'var(--text-body)' }}>
          <span>Úroveň čtenáře</span>
          <span>{stats.xp} / {stats.xpNeededForNext} XP</span>
        </div>
        <div className="w-full bg-black/20 dark:bg-white/10 h-2 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${xpPercent}%`, backgroundColor: 'var(--bg-primary)' }}></div>
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
              <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider">Aktuální Streak</h3>
              <p className="text-4xl font-black text-amber-600 flex items-baseline gap-1 m-0">{stats.streak} <span style={{ color: 'var(--text-muted)' }} className="text-xs uppercase font-bold opacity-60">dní</span></p>
            </div>
            <div className="p-3 bg-amber-500/10 text-amber-600 rounded-xl"><Flame size={24} className={stats.streak > 0 ? "fill-amber-500" : ""} /></div>
          </div>
          <div style={{ borderColor: 'var(--border-color)' }} className="mt-2 pt-2 border-t text-left text-[10px] space-y-0.5">
            <div className={`flex justify-between ${stats.streak < 10 ? 'font-black text-amber-600' : 'opacity-60'}`}><span>0-9 dní série:</span><span>streak * 10 XP</span></div>
            <div className={`flex justify-between ${stats.streak >= 10 && stats.streak < 50 ? 'font-black text-indigo-500' : 'opacity-60'}`}><span>10-49 dní 🔥:</span><span>streak * 25 XP</span></div>
            <div className={`flex justify-between ${stats.streak >= 50 ? 'font-black text-emerald-500 animate-pulse' : 'opacity-60'}`}><span>50+ dní 👑:</span><span>streak * 50 XP</span></div>
          </div>
        </div>

        {/* Měsíční cíl */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <div className="space-y-1 text-left">
                <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider">Výzva na {stats.currentMonthName}</h3>
                <p style={{ color: 'var(--text-badge)' }} className="text-4xl font-black m-0">{stats.monthlyRead} <span style={{ color: 'var(--text-muted)' }} className="text-xs uppercase font-bold opacity-60">z {stats.monthlyGoal}</span></p>
              </div>
              <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="p-3 rounded-xl"><Calendar size={24} /></div>
            </div>
            <div className="space-y-1">
              <div className="w-full bg-black/5 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progressPercent}%`, backgroundColor: 'var(--bg-primary)' }}></div>
              </div>
              <div style={{ color: 'var(--text-muted)' }} className="flex justify-between text-[10px] font-black uppercase opacity-80">
                <span>{progressPercent}% splněno</span><span>{stats.daysRemainingInMonth === 0 ? "Poslední den!" : `Zbývá ${stats.daysRemainingInMonth} dní`}</span>
              </div>
            </div>
          </div>
          <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-3 border-t flex flex-col gap-1 text-xs font-bold">
            {isEditingGoal ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 w-full">
                  <input type="number" min={stats.goalLocked ? stats.monthlyGoal : 1} max="500" value={newGoalInput} onChange={(e) => setNewGoalInput(e.target.value)} style={{ backgroundColor: 'var(--bg-body)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} className="w-16 px-2 py-1 border rounded-md outline-none text-sm font-bold text-center" />
                  <button style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} onClick={handleSaveGoal} className="px-2 py-1 rounded font-black uppercase text-[10px] cursor-pointer border-none shadow-sm">Uložit</button>
                  <button style={{ color: 'var(--text-muted)' }} onClick={() => { setIsEditingGoal(false); setGoalError(''); }} className="px-1 py-1 font-bold cursor-pointer bg-transparent border-none">Zrušit</button>
                </div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-70">
                  {(() => {
                    const n = parseInt(newGoalInput, 10);
                    const preview = !isNaN(n) && n > 5 ? Math.round((1 + (Math.max(n, stats.highestGoalEver) - 5) * 0.02) * 100) : 100;
                    return `Vyšší cíl = víc XP za knihu natrvalo (teď ${preview}% tempa). Snížit jde jen příští měsíc.`;
                  })()}
                </span>
                {goalError && <span className="text-red-500 text-[10px]">{goalError}</span>}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-muted)' }} className="opacity-70 flex items-center gap-1">Měsíční cíl: {stats.goalLocked && <Lock size={12} className="text-amber-500" title="Tento měsíc lze cíl už jen zvýšit" />}</span>
                <button onClick={() => { setIsEditingGoal(true); setNewGoalInput(stats.monthlyGoal.toString()); }} style={{ color: 'var(--text-badge)' }} className="font-black uppercase tracking-wider p-0 bg-transparent border-none cursor-pointer text-[10px]">
                  {stats.goalLocked ? 'Zvýšit Cíl' : 'Změnit Cíl'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Celková knihovna */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="space-y-1 text-left">
              <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider">Celková knihovna</h3>
              <p style={{ color: 'var(--text-body)' }} className="text-4xl font-black m-0">{stats.totalRead} <span style={{ color: 'var(--text-muted)' }} className="text-xs uppercase font-bold opacity-60">knih</span></p>
            </div>
            <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="p-3 rounded-xl"><CheckCircle size={24} /></div>
          </div>
          <p style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }} className="text-xs font-medium mt-4 pt-3 border-t text-left flex items-center gap-1">
            <Sparkles size={12} style={{ color: 'var(--bg-primary)' }} /> Všechna přečtená díla od začátku.
          </p>
        </div>
      </div>

      {/* TÝDENNÍ AKTIVITA */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
        <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider mb-4 text-left flex items-center gap-1.5"><TrendingUp size={14} /> Tvoje aktivita</h3>
        <div className="grid grid-cols-7 gap-2 md:gap-4 text-center">
          {stats.weeklyActivity.map((day, idx) => (
            <div key={idx} style={{ borderColor: day.isToday ? 'var(--bg-primary)' : 'transparent', backgroundColor: day.isToday ? 'var(--bg-badge)' : 'transparent' }} className="p-3 rounded-xl flex flex-col items-center gap-2 border">
              <span style={{ color: day.isToday ? 'var(--text-badge)' : 'var(--text-muted)' }} className={`text-xs font-black uppercase ${!day.isToday && 'opacity-60'}`}>{day.dayLabel}</span>
              <div style={{ backgroundColor: day.isActive ? (day.isFrozen ? 'rgba(56, 189, 248, 1)' : 'rgba(245, 158, 11, 1)') : 'rgba(0,0,0,0.05)', color: day.isActive ? '#ffffff' : 'var(--text-muted)' }} className="w-8 h-8 rounded-full flex items-center justify-center shadow-sm" title={day.isFrozen ? 'Zachráněno Streak Freezem' : undefined}>
                {day.isFrozen ? <ShieldCheck size={16} className="text-white" /> : day.isActive ? <Flame size={16} className="fill-white text-white" /> : <div style={{ backgroundColor: 'currentColor' }} className="w-1.5 h-1.5 rounded-full opacity-40"></div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* TREND ČTENÍ (POSLEDNÍCH 6 MĚSÍCŮ) */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
        <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider mb-4 text-left flex items-center gap-1.5"><TrendingUp size={14} /> Trend čtení (posledních 6 měsíců)</h3>
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
            <h4 className="font-black text-sm uppercase m-0">Streak Freeze — {stats.streakFreezes} k dispozici</h4>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">Zmeškaný den nezlomí sérii, pokud máš aspoň jednu pojistku.</p>
          </div>
        </div>
        <button
          onClick={handleBuyStreakFreeze}
          disabled={buyingFreeze || stats.jomaridCoins < 150}
          style={{ backgroundColor: stats.jomaridCoins < 150 ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: stats.jomaridCoins < 150 ? 'var(--text-muted)' : 'white' }}
          className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer border-none shadow-sm whitespace-nowrap disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {buyingFreeze ? <Loader2 size={14} className="animate-spin" /> : <>Koupit za 150 <Coins size={12} /></>}
        </button>
      </div>

      {/* SÍŇ SLÁVY */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider m-0 flex items-center gap-1.5"><Users size={16} style={{ color: 'var(--bg-primary)' }} /> Globální Síň Slávy Jomarid Books</h3>
          {!stats.showInLeaderboard && <span className="text-[10px] font-bold bg-red-500/10 text-red-400 px-2.5 py-1 rounded-md uppercase">Režim inkognito 🔒</span>}
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
            <p style={{ color: 'var(--text-muted)' }} className="text-sm font-bold text-center py-6 opacity-60">V této kategorii zatím nikdo nesoutěží.</p>
          ) : (
            leaderboards[activeTab].map((row, index) => {
              const cat = categories.find(c => c.id === activeTab);
              let medalStyle = index === 0 ? "text-xl w-6 text-center animate-bounce" : index === 1 ? "text-lg w-6 text-center" : index === 2 ? "text-md w-6 text-center" : "text-xs font-black opacity-40 w-6 text-center";
              const featuredBadgeDef = row.featuredBadge ? BOOK_BADGES.find(b => b.id === row.featuredBadge) : null;
              const FeaturedIcon = featuredBadgeDef?.icon;
              return (
                <div key={index} style={{ backgroundColor: row.isMe ? 'var(--bg-badge)' : 'rgba(0,0,0,0.02)', borderColor: row.isMe ? 'var(--bg-primary)' : 'transparent' }} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${row.isMe && 'font-bold shadow-sm'}`}>
                  <div className="flex items-center gap-4 text-left">
                    <span className={medalStyle}>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}</span>
                    {FeaturedIcon && (
                      <span title={featuredBadgeDef.title} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                        <FeaturedIcon size={12} />
                      </span>
                    )}
                    <span className="text-sm tracking-wide truncate max-w-[200px] sm:max-w-[350px]">{row.email} {row.isMe && <span className="text-[10px] bg-[var(--bg-primary)] text-[var(--text-primary)] px-1.5 py-0.5 rounded ml-1 uppercase font-black">Ty</span>}</span>
                  </div>
                  <div className="text-right font-black text-sm flex items-center gap-1">
                    <span>{row[activeTab].toLocaleString()}</span>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase opacity-60">{cat?.suffix}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ODZNÁČKY */}
      <BadgesSection stats={stats} />

      {/* TLAČÍTKO ZPĚT */}
      <div className="flex justify-end">
        <Link to="/app" className="no-underline">
          <button style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="flex items-center gap-1 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider hover:opacity-90 transition-opacity border-none cursor-pointer shadow-md">
            Zpět do knihovny <ChevronRight size={14} />
          </button>
        </Link>
      </div>

    </div>
  );
};


