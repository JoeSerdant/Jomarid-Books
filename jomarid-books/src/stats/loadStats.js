// Načtení statistik přihlášeného čtenáře (profil, přečtené knihy, denní aktivita, streak, herní postup, obchůdek) a žebříčků.
// Používá je stránka Statistiky i stránka Odznaky: obě potřebují stejný výpočet (úroveň, XP, odemykání odznaků knih a jejich mince),
// takže se odznaky odemknou, ať čtenář otevře kteroukoli z nich. Klient (supabase) se předává zvenku, ať jde modul zkoušet bez prohlížeče.
import { BOOK_BADGES } from '../constants/badges.js';
import { loadGameProgress, loadGameXpTotals } from '../gameRecords/api.js';
import { calculateLevelAndProgress, getLevelVisuals, computeTotalXp, DEFAULT_MONTHLY_GOAL } from '../constants/leveling.js';
import { sumBadgeXp } from '../constants/badgeXp.js';
import { loadEquippedTitles, loadMyCosmetics } from '../shop/api.js';

// Prázdný stav, dokud se statistiky nenačtou (nebo když načtení selže).
export const EMPTY_STATS = {
  streak: 0,
  monthlyRead: 0,
  monthlyGoal: DEFAULT_MONTHLY_GOAL,
  totalRead: 0,
  weeklyActivity: [],
  readingTrend: [],
  xp: 0,
  totalXp: 0,
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
  streakFreezes: 0,
  frozenDates: [],
  highestGoalCompleted: DEFAULT_MONTHLY_GOAL,
  featuredBadge: null,
  goalLocked: false,
  goalLockedCompletely: false,
  goalProgress: 0
};

export const EMPTY_LEADERBOARDS = {
  streak: [],
  level: [],
  totalRead: [],
  monthlyRead: [],
  xp: []
};

// Vlastní statistiky a obchůdek: {stats, cosmetics}. Nově splněné odznaky knih se tady trvale odemknou na serveru (grant_badge_rewards).
export async function loadMyStats(client, user) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysRemainingInMonth = lastDayOfMonth - now.getDate();
  const monthNames = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
  const currentMonthName = monthNames[currentMonth];

  // Paralelní stažení profilu, knih, denní aktivity a vyřešení streaku
  // (resolve_streak() sám dožene libovolné množství uplynulých dní od
  // posledního vyřešení - klient historii sám neprochází).
  const [profileRes, booksRes, activityRes, streakRes, gameProgress, myCosmetics] = await Promise.all([
    client.from('profiles').select('fake_xp, bonus_xp, show_in_leaderboard, unlocked_badges, monthly_goal, last_goal_change_date, coins, lifetime_coins_earned, streak_freezes, frozen_dates, current_streak, highest_goal_completed, featured_badge').eq('id', user.id).maybeSingle(),
    client.from('user_books').select('updated_at, first_completed_at, is_read').eq('user_id', user.id).eq('is_read', true),
    client.from('user_daily_activity').select('activity_date').eq('user_id', user.id).order('activity_date', { ascending: false }),
    client.rpc('resolve_streak'),
    loadGameProgress(client),
    loadMyCosmetics(client),
  ]);

  const profileData = profileRes.data || {};
  const userBooks = booksRes.data || [];
  const activityData = activityRes.data || [];

  // 1. ZÁKLADNÍ METRIKY - měsíční postup i trend čtou first_completed_at
  // (kdy byla kniha SKUTEČNĚ poprvé dočtena), ne updated_at (to se
  // přepisuje při každé synchronizaci pozice, včetně OPAKOVANÉHO čtení
  // už jednou dočtené knihy - to by uměle nafouklo měsíční postup
  // i graf trendu, i když nepřibyla žádná nová kniha).
  const totalRead = userBooks.length;
  const monthlyRead = userBooks.filter(ub => {
    if (!ub.first_completed_at) return false;
    const d = new Date(ub.first_completed_at);
    return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
  }).length;

  // Trend čtení za posledních 6 měsíců - počítáno z dat, co už appka stejně
  // stahuje (user_books), žádný extra dotaz.
  const monthNamesShort = ["Led", "Úno", "Bře", "Dub", "Kvě", "Čvn", "Čvc", "Srp", "Zář", "Říj", "Lis", "Pro"];
  const readingTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentYear, currentMonth - i, 1);
    const count = userBooks.filter(ub => {
      if (!ub.first_completed_at) return false;
      const ubd = new Date(ub.first_completed_at);
      return ubd.getFullYear() === d.getFullYear() && ubd.getMonth() === d.getMonth();
    }).length;
    readingTrend.push({ label: monthNamesShort[d.getMonth()], count });
  }

  // 2. MĚSÍČNÍ CÍL A ZAMYKÁNÍ ZMĚNY
  // Cíl lze v appce zvýšit KDYKOLIV, dokud v tomhle měsíci nemáš
  // aspoň polovinu současného cíle - pak už se cíl nedá změnit vůbec
  // (ani nahoru, ani dolů) až do dalšího měsíce. Server (trigger)
  // vynucuje totéž, tohle je jen pro UI (zámek se ukáže ještě před
  // pokusem o změnu).
  const currentGoal = profileData.monthly_goal || parseInt(localStorage.getItem(`monthly_goal_${user.id}`), 10) || DEFAULT_MONTHLY_GOAL;
  // Nejvyšší cíl, který jsi SKUTEČNĚ SPLNIL - ne nejvyšší, který sis nastavil.
  const highestGoalCompleted = parseInt(profileData.highest_goal_completed, 10) || DEFAULT_MONTHLY_GOAL;
  const lastGoalChange = profileData.last_goal_change_date ? new Date(profileData.last_goal_change_date) : null;
  const isChangedThisMonth = lastGoalChange && lastGoalChange.getFullYear() === currentYear && lastGoalChange.getMonth() === currentMonth;
  const isLockedByProgress = profileData.monthly_goal != null && monthlyRead >= Math.ceil(profileData.monthly_goal / 2);
  const isGoalLocked = isChangedThisMonth || isLockedByProgress;
  // 3. STREAK - vyřešeno na serveru (resolve_streak(), zavoláno výš). Klient
  // historii sám neprochází ani nespotřebovává pojistky - jen
  // přečte, co server natrvalo rozhodl, a pro ZOBRAZENÍ připočte dnešek
  // (pokud se dnes už četlo), aniž by ho trvale zapisoval - to se stane samo
  // při příštím resolve_streak(), až dnešek jednou skutečně celý uplyne.
  const streakResult = streakRes?.data;
  if (streakRes?.error) console.error('Nepodařilo se vyhodnotit streak:', streakRes.error);
  const resolvedStreak = streakResult?.streak ?? (parseInt(profileData.current_streak, 10) || 0);
  let displayStreakFreezes = streakResult?.streak_freezes ?? (parseInt(profileData.streak_freezes, 10) || 0);
  let displayFrozenDates = streakResult?.frozen_dates || (Array.isArray(profileData.frozen_dates) ? profileData.frozen_dates : []);

  const activeDates = activityData.map(a => a.activity_date);
  const todayStr = new Date().toLocaleDateString('sv');
  const readToday = activeDates.includes(todayStr);
  let streak = resolvedStreak + (readToday ? 1 : 0);

  // Týdenní aktivita - čte přímo z už vyřešeného stavu, žádná nová simulace.
  const czechDays = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
  const weeklyActivityGenerated = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('sv');
    const isFrozen = !activeDates.includes(dateStr) && displayFrozenDates.includes(dateStr);
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
  // odznáčky z kategorie "levels". Bonus za cíl se počítá z NEJVYŠŠÍHO SPLNĚNÉHO
  // cíle (highestGoalCompleted), ne z nastaveného - jinak by stačilo si dát cíl
  // 500 a nikdy ho neplnit. Hodnotu zvedá jen server, ve chvíli, kdy dočteš knihu
  // a v měsíci dosáhneš cíle; jednou získaný bonus se pak už nesnižuje. Vzorec je
  // ve sdíleném leveling.js (computeTotalXp).
  // coins je skutečná utratitelná měna (nákup knih ji snižuje), proto se nesmí
  // přepisovat odvozenou hodnotou při každém načtení - to by smazalo utracené i
  // získané mince. lifetime_coins_earned je oddělený součet, který nikdy neklesá
  // (ani po utracení) a slouží jen k vyhodnocení odznáčků typu "nasbírej X mincí".
  const dbCoins = parseInt(profileData.coins, 10) || 0;
  const dbLifetimeCoins = parseInt(profileData.lifetime_coins_earned, 10) || 0;

  const xpBeforeBadges = computeTotalXp({
    totalRead,
    highestGoalCompleted,
    fakeXp: profileData.fake_xp,
    bonusXp: profileData.bonus_xp,
    streak,
    badgeXp: 0
  });
  const { level: levelBeforeBadges } = calculateLevelAndProgress(xpBeforeBadges);

  // evalContext nese level, mince (celoživotní součet) a už odemčené odznáčky, aby šlo
  // vyhodnotit i odznáčky kategorií "levels" a "special" (coins_*, badge_collector_*).
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
      // se vždy nanovo z CELÉHO seznamu odemknutých odznáčků. Bez této větve by
      // příspěvek starých odznáčků k XP při příštím načtení zmizel a level by
      // neprávem klesl.
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
  // XP z herních odznaků (server, db/game-records.sql) se přičítá až sem: do vyhodnocení odznaků z úrovně (výš) nevstupuje,
  // aby hry neodemykaly odznaky za úroveň a s nimi mince.
  const totalXp = xpBeforeBadges + badgeBonusXp + gameProgress.xp;
  const { level, xpInCurrentLevel, xpNeededForNext } = calculateLevelAndProgress(totalXp);
  const visuals = getLevelVisuals(level);

  // ODZNÁČKY + MINCE: klient na server jen POŠLE seznam id odznáčků, které
  // vyhodnotil jako nově splněné. grant_badge_rewards() na serveru sama dohledá,
  // kolik ten konkrétní odznak SKUTEČNĚ nese (z tabulky badge_rewards), a připíše
  // přesně tolik. Klient tak může nanejvýš "předstírat", že si zaslouží konkrétní
  // odznak, ale nikdy nepošle vlastní částku.
  let calculatedCoins = dbCoins;

  if (newlyUnlockedBadges.length > 0) {
    try {
      const { data: grantResult, error: grantError } = await client.rpc('grant_badge_rewards', {
        badge_ids: newlyUnlockedBadges.map(b => b.id)
      });
      if (grantError) throw grantError;
      if (grantResult) {
        savedUnlockedBadges = grantResult.unlocked_badges || savedUnlockedBadges;
        calculatedCoins = grantResult.coins ?? calculatedCoins;
      }
    } catch (grantErr) {
      console.error('Nepodařilo se připsat odměnu za odznáčky:', grantErr);
      // Zápis selhal - odznáčky se na serveru neodemkly, takže se příště
      // správně zkusí odemknout znovu. Pro zobrazení v TÉHLE session necháváme
      // savedUnlockedBadges tak, jak je (s nově odemknutými odznáčky lokálně),
      // aby uživatel aspoň hned viděl, co si vysloužil.
    }
  }


  return {
    stats: {
      streak, monthlyRead, monthlyGoal: currentGoal, totalRead, weeklyActivity: weeklyActivityGenerated, readingTrend,
      xp: xpInCurrentLevel, totalXp, level, levelName: visuals.name, levelBadgeClass: visuals.badge, levelBoxClass: visuals.box,
      xpNeededForNext, daysRemainingInMonth, currentMonthName, showInLeaderboard: profileData.show_in_leaderboard ?? true,
      gameProgress,
      unlockedBadges: savedUnlockedBadges, jomaridCoins: calculatedCoins, goalLocked: isGoalLocked, goalLockedCompletely: isLockedByProgress, goalProgress: monthlyRead,
      streakFreezes: displayStreakFreezes, frozenDates: displayFrozenDates, highestGoalCompleted, featuredBadge: profileData.featured_badge || null
    },
    cosmetics: myCosmetics
  };
}

// Server vrací najednou nejvýš 1000 řádků, žebříček ale potřebuje všechny knihy a všechny dny aktivity všech čtenářů: čte se po stránkách.
const PAGE_SIZE = 1000;
async function fetchAllRows(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) { console.error('Nepodařilo se načíst data do žebříčku:', error); break; }
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]);
    if (list) list.push(row); else map.set(row[key], [row]);
  }
  return map;
};

// Souhrny pro žebříček přicházejí ze serveru (db/security-hardening.sql): čtenář nesmí číst cizí řádky user_books ani user_daily_activity,
// server vrací jen počty přečtených knih a dny čtení těch, kdo smějí být v žebříčku. Dokud SQL v databázi neběží (funkce chybí),
// čtou se tabulky po staru; jakákoli jiná chyba žebříček neukáže radši vůbec, než aby ukázal špatná čísla.
const isMissingRpc = (err) => err?.code === 'PGRST202' || err?.code === '42883' || /could not find the function/i.test(err?.message || '');

// Map(id účtu -> {total: přečtené knihy, monthly: dočtené v měsíci [from, to)}).
async function loadBoardReads(client, from, to) {
  const { data, error } = await client.rpc('leaderboard_reads', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) {
    if (!isMissingRpc(error)) throw error;
    const rows = await fetchAllRows(() => client.from('user_books').select('user_id, updated_at, first_completed_at').eq('is_read', true).order('user_id').order('book_id'));
    const map = new Map();
    for (const [id, list] of groupBy(rows, 'user_id')) {
      map.set(id, { total: list.length, monthly: list.filter((b) => { if (!b.first_completed_at) return false; const d = new Date(b.first_completed_at); return d >= from && d < to; }).length });
    }
    return map;
  }
  const map = new Map();
  for (const row of Array.isArray(data) ? data : []) {
    if (row?.user_id) map.set(row.user_id, { total: Math.max(0, parseInt(row.total_read, 10) || 0), monthly: Math.max(0, parseInt(row.monthly_read, 10) || 0) });
  }
  return map;
}

// Map(id účtu -> Set dní čtení RRRR-MM-DD). Server dává jen posledních 60 dní: pro sérii stačí (dál do minulosti sahá série vyhodnocená serverem).
async function loadBoardActivity(client) {
  const { data, error } = await client.rpc('leaderboard_activity', { p_days: 60 });
  let rows;
  if (error) {
    if (!isMissingRpc(error)) throw error;
    rows = await fetchAllRows(() => client.from('user_daily_activity').select('user_id, activity_date').order('user_id').order('activity_date'));
  } else {
    rows = Array.isArray(data) ? data : [];
  }
  const map = new Map();
  for (const row of rows) {
    if (!row?.user_id) continue;
    const set = map.get(row.user_id);
    if (set) set.add(row.activity_date); else map.set(row.user_id, new Set([row.activity_date]));
  }
  return map;
}

// Série čtení všech čtenářů, jak je vyhodnotil server (db/leaderboard-streaks.sql): Map(id účtu -> {streak, frozen: Set dní zachráněných pojistkou, freezes: pojistky v zásobě}).
// null, dokud SQL v databázi neběží (nebo když volání selže): žebříček pak počítá sérii jen ze dnů čtení.
async function loadStreakBase(client) {
  try {
    const { data, error } = await client.rpc('leaderboard_streaks');
    if (error) throw error;
    const map = new Map();
    for (const row of Array.isArray(data) ? data : []) {
      if (!row?.user_id) continue;
      map.set(row.user_id, {
        streak: Math.max(0, parseInt(row.current_streak, 10) || 0),
        frozen: new Set(Array.isArray(row.frozen_dates) ? row.frozen_dates : []),
        freezes: Math.max(0, parseInt(row.streak_freezes, 10) || 0), // chybí, dokud se db/leaderboard-streaks.sql nespustí znovu: pak se bere 0
      });
    }
    return map;
  } catch (err) {
    console.warn('Série čtenářů se z databáze nepodařilo načíst, počítají se jen ze dnů čtení:', err?.message || err);
    return null;
  }
}

// Den před dnem zapsaným jako RRRR-MM-DD (počítá se v UTC, takže přechod na letní čas nic nepřeskočí ani nezdvojí).
const prevDay = (s) => new Date(Date.parse(`${s}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

// Série čtenáře do žebříčku stejně jako u vlastní série (loadMyStats): série vyhodnocená serverem (zmeškaný den zachráněný pojistkou ji nepřeruší)
// plus dnešek, pokud se dnes četlo. Série, která nedosahuje do včerejška (ani čtením, ani pojistkou), už skončila.
// Vrací i to, zda sérii právě drží pojistka (Streak Freeze), tedy dnes se ještě nečetlo a poslední den série byl zachráněn pojistkou:
// takový čtenář nemá nulu, v žebříčku se jeho řádek zbarví modře.
// Server (resolve_streak) pojistky spotřebuje až ve chvíli, kdy čtenář appku otevře. Kdo zmeškal den a appku ještě neotevřel, má
// v databázi dny nezachráněné, ale pojistky v zásobě (base.freezes): když zmeškaných dní není víc než pojistek, série drží i tak.
// Bez dat ze serveru (base null) se série počítá jen z po sobě jdoucích dnů čtení a nikdy není zmrzlá.
export function boardStreakInfo({ base, acts, todayStr, yestStr }) {
  const readToday = acts.has(todayStr);
  if (base) {
    if (readToday) return { streak: base.streak + 1, frozen: false };
    if (acts.has(yestStr)) return { streak: base.streak, frozen: false };
    const held = base.streak > 0;
    if (base.frozen.has(yestStr) || base.frozen.has(todayStr)) return { streak: base.streak, frozen: held };
    // zmeškané dny, které by pojistky v zásobě ještě pokryly (nejvýš tolik dní, kolik je pojistek)
    const covered = (d) => acts.has(d) || base.frozen.has(d);
    const freezes = Math.max(0, base.freezes | 0);
    let missed = 0;
    let day = yestStr;
    while (missed <= freezes && !covered(day)) { missed++; day = prevDay(day); }
    if (missed >= 1 && missed <= freezes && held) return { streak: base.streak, frozen: true };
    return { streak: 0, frozen: false };
  }
  let streak = 0;
  if (readToday || acts.has(yestStr)) {
    const chk = readToday ? new Date() : new Date(yestStr + 'T12:00:00');
    while (acts.has(chk.toLocaleDateString('sv'))) {
      streak++;
      chk.setDate(chk.getDate() - 1);
    }
  }
  return { streak, frozen: false };
}

export const boardStreak = (args) => boardStreakInfo(args).streak;

// Pořadí v kategorii: vyšší hodnota výš, při shodě víc XP, pak jméno (aby pořadí nezáleželo na tom, v jakém pořadí přišla data).
const rankBy = (users, key) => [...users].sort((a, b) => b[key] - a[key] || b.xp - a.xp || a.email.localeCompare(b.email, 'cs'));

// Deset nejlepších; kdo mezi nimi není, přibude pod nimi se svým skutečným pořadím (rank), ať vidí, kde stojí.
const topWithMe = (users, key) => {
  const ranked = rankBy(users, key).map((u, i) => ({ ...u, rank: i + 1 }));
  const top = ranked.slice(0, 10);
  const me = ranked.find((u) => u.isMe);
  return me && !top.includes(me) ? [...top, me] : top;
};

// Žebříčky (deset nejlepších v pěti kategoriích) a nasazené tituly; null, když žebříček nejde načíst nebo je prázdný.
// mine = vlastní statistiky z loadMyStats: řádek přihlášeného se bere z nich, ať souhlasí s tím, co čtenář vidí nahoře
// (série s pojistkami, XP z odznaků, které se právě odemkly), a ne z výpočtu z cizích dat.
export async function loadLeaderboards(client, user, mine = null) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  // 6. LEADERBOARDS
  // Žebříček bere server (leaderboard_profiles): jen uživatelské jméno a statistiky, žádné e-maily ostatních.
  let allProfiles = null;
  const [lbRes, gameXpTotals] = await Promise.all([client.rpc('leaderboard_profiles'), loadGameXpTotals(client)]);
  if (lbRes.error) console.error('Nepodařilo se načíst žebříček:', lbRes.error);
  else if (Array.isArray(lbRes.data)) allProfiles = lbRes.data;
  if (allProfiles && allProfiles.length > 0) {
    let readsByUser; let actsByUser; let boardTitles; let streakBase;
    try {
      [readsByUser, actsByUser, boardTitles, streakBase] = await Promise.all([
        loadBoardReads(client, new Date(currentYear, currentMonth, 1), new Date(currentYear, currentMonth + 1, 1)),
        loadBoardActivity(client),
        loadEquippedTitles(client, allProfiles.map(p => p.id)),
        loadStreakBase(client)
      ]);
    } catch (err) {
      console.error('Nepodařilo se načíst souhrny do žebříčku:', err);
      return null;
    }

    const todayStr = new Date().toLocaleDateString('sv');
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yestStr = yest.toLocaleDateString('sv');

    const mappedUsers = allProfiles.map(p => {
      const reads = readsByUser.get(p.id) || { total: 0, monthly: 0 };
      const uActs = actsByUser.get(p.id) || new Set();

      const streakInfo = boardStreakInfo({ base: streakBase?.get(p.id) || null, acts: uActs, todayStr, yestStr });
      const uStreak = streakInfo.streak;

      const uMRead = reads.monthly;

      // Stejný vzorec jako pro přihlášeného uživatele výš (včetně XP z odznáčků
      // a násobku za splněný cíl), aby žebříček podle XP/úrovně nepodhodnocoval
      // nikoho se sbírkou odznáčků nebo zvýšeným splněným cílem.
      const uXpTotal = computeTotalXp({
        totalRead: reads.total,
        highestGoalCompleted: p.highest_goal_completed,
        fakeXp: p.fake_xp,
        bonusXp: p.bonus_xp,
        streak: uStreak,
        badgeXp: sumBadgeXp(p.unlocked_badges),
        gameXp: gameXpTotals.get(p.id) || 0
      });
      const { level: uLvl } = calculateLevelAndProgress(uXpTotal);

      const isMe = p.id === user.id;
      const own = isMe && mine ? mine : null;
      // Vlastní řádek: série i pojistky přesně podle toho, co vidíš nahoře (server je právě vyhodnotil), ne podle cizí kopie.
      const ownFrozen = own ? boardStreakInfo({
        base: { streak: Math.max(0, (parseInt(own.streak, 10) || 0) - (uActs.has(todayStr) ? 1 : 0)), frozen: new Set(own.frozenDates || []), freezes: parseInt(own.streakFreezes, 10) || 0 },
        acts: uActs, todayStr, yestStr,
      }).frozen : false;
      return {
        email: p.username || 'Anonym',
        streak: own ? own.streak : uStreak,
        streakFrozen: own ? ownFrozen : streakInfo.frozen,
        level: own ? own.level : uLvl,
        totalRead: own ? own.totalRead : reads.total,
        monthlyRead: own ? own.monthlyRead : uMRead,
        xp: own ? own.totalXp : uXpTotal,
        featuredBadge: p.featured_badge || null,
        title: boardTitles.get(p.id) || null,
        isMe
      };
    });

    return {
      streak: topWithMe(mappedUsers, 'streak'),
      level: topWithMe(mappedUsers, 'level'),
      totalRead: topWithMe(mappedUsers, 'totalRead'),
      monthlyRead: topWithMe(mappedUsers, 'monthlyRead'),
      xp: topWithMe(mappedUsers, 'xp')
    };
  }
  return null;
}
