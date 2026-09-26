import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BOOK_BADGES } from '../constants/badges';
import { calculateXpMultiplier, calculateLevelAndProgress, getLevelVisuals } from '../constants/leveling';
import { FaqItem } from '../components/FaqItem';
import {
  Book, BookOpen, ChevronRight, Coins, Flame, Library, Phone,
  ShieldCheck, Sparkles, Zap, Footprints, Scroll,
  Rocket, Swords, Building2, Target, Crown, ArrowRight, Feather, Calendar, Gamepad2,
  Type, Bookmark, Star, MessageCircle, Trophy, Loader2, TrendingUp, BarChart3,
} from 'lucide-react';

// ============================================================================
// Reálná, ověřená data (odznaky/hry) - nic tady není vymyšlené. Texty pro
// hero/podtitul/doporučené tituly/ukázku písma/"proč číst tady" naopak
// přichází ze site_settings (spravuje admin), s těmihle jako záložní
// hodnotou, kdyby se ještě nenačetly nebo admin nikdy nic neuložil.
// ============================================================================

const SAMPLE_BADGES = [
  { icon: Footprints, title: 'První Průzkumník', description: 'Přečti svou úplně první knihu v knihovně.', coins: 50, xp: 100, category: 'Knihy' },
  { icon: Flame, title: 'Týdenní Plamen', description: 'Čti sedm dní v kuse bez jediného výpadku.', coins: 150, xp: 300, category: 'Streak' },
  { icon: Scroll, title: 'Průzkumník Svazků', description: 'Dosáhni čtenářské úrovně 4.', coins: 80, xp: 120, category: 'Úroveň' },
  { icon: Coins, title: 'Mincový Sběratel', description: 'Nashromáždi celkem 500 Jomarid Coinů.', coins: 150, xp: 300, category: 'Sběratelství' },
  { icon: Trophy, title: 'Mistr Odznaků', description: 'Odemkni 25 různých odznaků ze sbírky.', coins: 500, xp: 1000, category: 'Sběratelství' },
];

const GAMES_PREVIEW = [
  { icon: Rocket, title: 'Jomarid Rocket Game', tagline: 'Vesmírná arkádová střílečka s vlastními vylepšeními a postupem.', detail: 'Nepřátelé občas upustí bonusovou minci navíc k tomu, co si vyděláš jen za to, že si dnes zahraješ.' },
  { icon: Swords, title: 'Warroom: Frontlines', tagline: 'Velitelská taktická hra - řiď frontu, jednotky a zdroje.', detail: 'Rozhoduješ o nasazení jednotek a zdrojích z velitelského stanu, ne v přímé palbě.' },
  { icon: Building2, title: 'City Clicker', tagline: 'Vybuduj si vlastní město klikáním.', detail: 'Čtyři zcela odlišné vizuální styly na výběr - stejné město, jiná nálada.' },
  { icon: Target, title: 'Polygon aréna', tagline: 'Rozstřílej tvary a poskládej si vlastní stavbu tanku.', detail: 'Klasika, týmový mód, nebo klidné cvičiště bez tlaku - na výběr hned v menu.' },
  { icon: Crown, title: 'Chess League', tagline: 'Šachy proti pěti botům rostoucí obtížnosti.', detail: 'Vlastní XP, streaky a ligový postup - silnější soupeře si odemykáte postupně, výhrou za výhrou.' },
];

const COIN_SOURCES = [
  { label: 'Denní přihlášení', coins: 15, icon: Calendar },
  { label: 'Zahraná minihra dnes', coins: 20, icon: Gamepad2 },
  { label: 'Odznak „První Průzkumník"', coins: 50, icon: Footprints },
  { label: 'Splněný měsíční cíl', coins: 250, icon: Target },
];

const THEMES = [
  { id: 'saas', name: 'Světlý', swatch: '#ffffff', accent: '#6366f1' },
  { id: 'dark', name: 'Tmavý', swatch: '#020617', accent: '#7c3aed' },
  { id: 'emerald', name: 'Zelená & Dřevo', swatch: '#2d1a10', accent: '#246b54' },
];

const DEFAULT_SETTINGS = {
  homepage_hero: {
    headline: 'Otevřete knihu a sledujte, jak stoupá vaše úroveň',
    subtitle: 'Tři originální knižní řady, přes 100 sběratelských odznaků a vlastní herní měna, kterou si vyděláte čtením - nebo si mezitím zahrajete jednu z pěti miniher.',
  },
  homepage_featured_books: { book_ids: [] },
  homepage_font_demo: {
    quote: 'A tak se Hobin Rood vydal do první vesnice, netuše, že z ní za týden nezbude jediná mince…',
    attribution: 'Hobin Rood: Díl 1',
  },
  homepage_why_read: {
    items: [
      { title: 'Bez stahování, bez čekání', description: 'Text se načítá přímo v prohlížeči - na počítači, tabletu i telefonu. Žádné PDF, žádné instalace.' },
      { title: 'Kurátorovaný fond', description: 'Žádná masová knihovna plná balastu - jen původní tituly a edice, které jinde nenajdete.' },
      { title: 'Rozhraní bez reklam', description: 'Vaše soustředění je priorita. Žádné bannery, žádné sociální sítě, jen text a váš postup.' },
      { title: 'Streak, co se dá zachránit', description: 'Zmeškaný den nemusí znamenat konec série - Streak Freeze ji na jeden den ochrání.' },
    ],
  },
};

const WHY_READ_ICONS = [Zap, ShieldCheck, Sparkles, Flame];

function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoUtcStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ============================================================================
// HLAVNÍ KOMPONENTA - načte veřejná nastavení (pro kohokoliv) a osobní data
// (jen pro přihlášené), pak vykreslí jednu ze dvou zcela odlišných variant.
// ============================================================================
export const HomePage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [featuredBooks, setFeaturedBooks] = useState([]);
  const [publicLoading, setPublicLoading] = useState(true);

  const [personal, setPersonal] = useState(null);
  const [personalLoading, setPersonalLoading] = useState(!!user);

  // Veřejná data - běží pro ÚPLNĚ KAŽDÉHO, i nepřihlášeného návštěvníka,
  // protože homepage je první věc, kterou kdokoliv vidí.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: settingsRows, error: settingsErr } = await supabase.from('site_settings').select('key, value');
        if (settingsErr) throw settingsErr;
        const merged = { ...DEFAULT_SETTINGS };
        (settingsRows || []).forEach(row => { merged[row.key] = row.value; });
        if (cancelled) return;
        setSettings(merged);

        const bookIds = merged.homepage_featured_books?.book_ids || [];
        if (bookIds.length > 0) {
          const { data: fb, error: fbErr } = await supabase
            .from('books')
            .select('id, title, author, genres, description, avg_rating')
            .in('id', bookIds);
          if (fbErr) throw fbErr;
          if (!cancelled) setFeaturedBooks(fb || []);
        }
      } catch (err) {
        console.error('Nepodařilo se načíst veřejný obsah domovské stránky:', err.message);
      } finally {
        if (!cancelled) setPublicLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Osobní data - jen když je někdo přihlášený. Homepage tady VŽDY jen ČTE
  // už uloženbuá data, nikdy sama neodemyká odznaky ani nepřipočítává XP -
  // to je výhradně práce Statistik (jediné místo, které to smí dělat), ať
  // nikdy nemůže dojít k tomu, že by dvě různé stránky nezávisle na sobě
  // zkoušely připsat stejnou odměnu dvakrát.
  useEffect(() => {
    if (!user) { setPersonal(null); setPersonalLoading(false); return; }
    // Čeká, až doběhnou veřejná nastavení (settings) - jinak by "doporučeno"
    // níž mohlo náhodně proběhnout dřív, než se stihnou načíst adminem
    // vybrané doporučené knihy, a ignorovat je čistě kvůli tomu, který
    // ze dvou nezávislých fetchů doběhl první.
    if (publicLoading) return;
    let cancelled = false;
    setPersonalLoading(true);
    (async () => {
      try {
        const [profileRes, userBooksRes, activityRes, allBooksRes] = await Promise.all([
          supabase.from('profiles').select('fake_xp, bonus_xp, unlocked_badges, coins, highest_goal_ever, featured_badge, frozen_dates').eq('id', user.id).maybeSingle(),
          supabase.from('user_books').select('book_id, is_read, status, scroll_position, updated_at').eq('user_id', user.id),
          supabase.from('user_daily_activity').select('activity_date').eq('user_id', user.id).order('activity_date', { ascending: false }),
          supabase.from('books').select('id, title, author, genres, description, price_coins, is_auto_assigned, avg_rating'),
        ]);
        if (cancelled) return;
        if (profileRes.error) throw profileRes.error;
        if (userBooksRes.error) throw userBooksRes.error;
        if (activityRes.error) throw activityRes.error;
        if (allBooksRes.error) throw allBooksRes.error;

        const profile = profileRes.data || {};
        const userBooks = userBooksRes.data || [];
        const activityDates = (activityRes.data || []).map(a => a.activity_date);
        const existingFrozenDates = profile.frozen_dates || [];
        const allBooks = allBooksRes.data || [];

        // --- Streak: JEN ČTENÍ, nikdy nekonzumuje novou pojistku (to je
        // výhradně práce Statistik) - dnešek se počítá jako pokrytý jen
        // přirozenou aktivitou nebo už dřív existující zmrazenou volbou.
        const isCoveredReadOnly = (d) => activityDates.includes(d) || existingFrozenDates.includes(d);
        const today = todayUtcStr();
        const yesterday = daysAgoUtcStr(1);
        let streak = 0;
        if (isCoveredReadOnly(today) || isCoveredReadOnly(yesterday)) {
          let cursor = isCoveredReadOnly(today) ? new Date() : new Date(Date.now() - 86400000);
          for (let i = 0; i < 3650; i++) {
            const dStr = cursor.toISOString().slice(0, 10);
            if (!isCoveredReadOnly(dStr)) break;
            streak++;
            cursor.setUTCDate(cursor.getUTCDate() - 1);
          }
        }
        const readToday = activityDates.includes(today);

        // --- XP/Level: stejný vzorec jako Statistiky, počítáno jen z dat,
        // která už reálně existují v DB (žádné nové odemykání tady).
        const totalRead = userBooks.filter(b => b.is_read).length;
        const goalEver = parseInt(profile.highest_goal_ever, 10) || 5;
        const goalMultiplier = goalEver > 5 ? 1 + (goalEver - 5) * 0.02 : 1;
        const baseXpFromBooks = Math.round(totalRead * 100 * goalMultiplier);
        const streakXpBonus = calculateXpMultiplier(streak);
        const unlockedBadgeIds = profile.unlocked_badges || [];
        const badgeBonusXp = unlockedBadgeIds.reduce((sum, id) => {
          const def = BOOK_BADGES.find(b => b.id === id);
          return sum + (def?.rewardXp || 0);
        }, 0);
        const totalXp = baseXpFromBooks + (parseInt(profile.fake_xp, 10) || 0) + (parseInt(profile.bonus_xp, 10) || 0) + streakXpBonus + badgeBonusXp;
        const { level, xpInCurrentLevel, xpNeededForNext } = calculateLevelAndProgress(totalXp);
        const visuals = getLevelVisuals(level);

        // --- Pokračovat ve čtení: nejnovější rozečtená (ale nedočtená) kniha.
        const inProgress = userBooks
          .filter(ub => ub.status === 'active' && !ub.is_read && (ub.scroll_position || 0) > 0)
          .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
        const continueBook = inProgress ? allBooks.find(b => b.id === inProgress.book_id) : null;

        // --- Doporučeno: kniha, kterou uživatel ještě vůbec nemá (není
        // v user_books a není automaticky přiřazená) - přednostně z těch,
        // co admin vybral jako doporučené na homepage.
        const ownedOrFreeIds = new Set([
          ...userBooks.map(ub => ub.book_id),
          ...allBooks.filter(b => b.is_auto_assigned).map(b => b.id),
        ]);
        const notOwned = allBooks.filter(b => !ownedOrFreeIds.has(b.id));
        const featuredIds = new Set(settings.homepage_featured_books?.book_ids || []);
        const bestRatedFirst = [...notOwned].sort((a, b) => (parseFloat(b.avg_rating) || 0) - (parseFloat(a.avg_rating) || 0));
        const recommended = bestRatedFirst.find(b => featuredIds.has(b.id)) || bestRatedFirst[0] || null;

        // --- Nejnovější odznak (pole se plní v pořadí odemčení, viz Statistiky).
        const latestBadgeId = unlockedBadgeIds[unlockedBadgeIds.length - 1];
        const latestBadge = latestBadgeId ? BOOK_BADGES.find(b => b.id === latestBadgeId) : null;

        if (!cancelled) {
          setPersonal({
            coins: parseInt(profile.coins, 10) || 0,
            level, xpInCurrentLevel, xpNeededForNext, visuals,
            streak, readToday,
            continueBook, continueProgress: inProgress ? Math.min(100, Math.round(inProgress.scroll_position)) : 0,
            recommended,
            latestBadge,
            totalBadges: unlockedBadgeIds.length,
          });
        }
      } catch (err) {
        console.error('Nepodařilo se načíst osobní data domovské stránky:', err.message);
        if (!cancelled) setPersonal(null);
      } finally {
        if (!cancelled) setPersonalLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, publicLoading]);

  if (user) {
    return (
      <LoggedInHome
        user={user}
        settings={settings}
        featuredBooks={featuredBooks}
        personal={personal}
        loading={personalLoading || publicLoading}
        navigate={navigate}
      />
    );
  }
  return <LoggedOutHome settings={settings} featuredBooks={featuredBooks} loading={publicLoading} navigate={navigate} />;
};

// ============================================================================
// VARIANTA PRO NEPŘIHLÁŠENÉ - marketingová stránka. Hlavní interaktivní
// prvek (hledání knihy podle žánru) skutečně filtruje REÁLNÉ doporučené
// knihy, ne jen kliká na tlačítko pro efekt.
// ============================================================================
const LoggedOutHome = ({ settings, featuredBooks, loading, navigate }) => {
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [activeBadge, setActiveBadge] = useState(0);
  const [activeGame, setActiveGame] = useState(0);
  const [demoFontSize, setDemoFontSize] = useState(18);

  const allGenres = useMemo(() => {
    const set = new Set();
    featuredBooks.forEach(b => (b.genres || []).forEach(g => set.add(g)));
    return Array.from(set).sort();
  }, [featuredBooks]);

  const visibleBooks = useMemo(() => {
    if (!selectedGenre) return featuredBooks;
    return featuredBooks.filter(b => (b.genres || []).includes(selectedGenre));
  }, [featuredBooks, selectedGenre]);

  const hero = settings.homepage_hero || DEFAULT_SETTINGS.homepage_hero;
  const fontDemo = settings.homepage_font_demo || DEFAULT_SETTINGS.homepage_font_demo;
  const whyRead = settings.homepage_why_read?.items || DEFAULT_SETTINGS.homepage_why_read.items;

  const activeBadgeData = SAMPLE_BADGES[activeBadge];
  const ActiveBadgeIcon = activeBadgeData.icon;
  const activeGameData = GAMES_PREVIEW[activeGame];
  const ActiveGameIcon = activeGameData.icon;

  return (
    <div style={{ color: 'var(--text-body)' }} className="font-sans">

      {/* ============================================================
          1. HERO - nadpis vlevo, hledání podle žánru napravo (SKUTEČNĚ
          filtruje reálné doporučené knihy níž, není to jen pro parádu)
         ============================================================ */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">

          <div className="lg:col-span-3">
            <div
              style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full font-semibold text-xs mb-8"
            >
              <Library size={13} /> Digitální čítárna s postupem
            </div>

            <h1 className="font-heading text-4xl md:text-[3.25rem] font-extrabold tracking-tight mb-6 leading-[1.08]">
              {hero.headline}
            </h1>

            <p style={{ color: 'var(--text-muted)' }} className="text-base md:text-lg max-w-lg mb-9 leading-relaxed">
              {hero.subtitle}
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <button
                onClick={() => navigate('/login')}
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                className="px-7 py-3.5 font-bold text-sm border-none rounded-xl shadow-md hover:shadow-lg hover:brightness-105 active:scale-[0.98] transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
              >
                Začít číst zdarma <ArrowRight size={16} />
              </button>
              <span style={{ color: 'var(--text-muted)' }} className="text-xs font-medium opacity-70">
                Účet si založíte přímo u vstupu, okamžitě a zdarma.
              </span>
            </div>
          </div>

          {/* HLEDÁNÍ PODLE ŽÁNRU: vybraný žánr skutečně mění, co se ukáže
              o pár řádků níž v sekci "Hlavní tituly" - žádná fingovaná animace. */}
          <div className="lg:col-span-2">
            <div
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-6 shadow-lg"
            >
              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide opacity-60 mb-1">
                Vyzkoušejte to hned teď
              </p>
              <h3 className="font-heading text-lg font-bold mb-4">Co vás dnes láká?</h3>

              {allGenres.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed opacity-70">
                  Žánry se právě načítají z katalogu…
                </p>
              ) : (
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    onClick={() => setSelectedGenre(null)}
                    style={{
                      backgroundColor: !selectedGenre ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                      color: !selectedGenre ? 'var(--text-primary)' : 'var(--text-body)',
                    }}
                    className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-xs font-bold transition-all"
                  >
                    Vše
                  </button>
                  {allGenres.map(g => (
                    <button
                      key={g}
                      onClick={() => setSelectedGenre(g)}
                      style={{
                        backgroundColor: selectedGenre === g ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                        color: selectedGenre === g ? 'var(--text-primary)' : 'var(--text-body)',
                      }}
                      className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-xs font-bold transition-all"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}

              <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
                {selectedGenre
                  ? `Sekce "Hlavní tituly" níž teď ukazuje jen tituly v žánru ${selectedGenre}.`
                  : 'Vyberte žánr a podívejte se, co z aktuální nabídky sedí přesně vám - sekce níž se rovnou přizpůsobí.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          2. TITULY - reálné knihy z katalogu, vybrané adminem, filtrovatelné
          podle žánru zvoleného výš
         ============================================================ */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        <h2 style={{ color: 'var(--text-muted)' }} className="text-sm font-semibold mb-6 opacity-70">
          Hlavní tituly {selectedGenre ? `· ${selectedGenre}` : ''}
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin opacity-40" />
          </div>
        ) : visibleBooks.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-sm opacity-70 py-8">
            {featuredBooks.length === 0
              ? 'Admin zatím nevybral doporučené tituly - zatím tu není co zobrazit.'
              : 'V tomhle žánru zrovna nic doporučeného nemáme - zkuste jiný, nebo se podívejte na "Vše".'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {visibleBooks.map((book) => (
              <div
                key={book.id}
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                className="group relative h-48 rounded-xl p-5 border flex flex-col justify-between text-left shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden"
                onClick={() => {
                  try { sessionStorage.setItem('library_open_book_id', book.id); } catch (e) { /* storage unavailable, ignore */ }
                  navigate('/login');
                }}
              >
                <div className="flex justify-between items-start w-full gap-2">
                  <div className="flex flex-wrap gap-1">
                    {(book.genres || []).slice(0, 2).map(g => (
                      <span key={g} style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="text-[9px] uppercase font-bold tracking-wide px-2 py-0.5 rounded shrink-0">
                        {g}
                      </span>
                    ))}
                  </div>
                  <Book size={14} style={{ color: 'var(--text-muted)' }} className="opacity-50 group-hover:opacity-100 group-hover:rotate-12 transition-all duration-300 shrink-0" />
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-semibold opacity-70 block mb-1">{book.author}</span>
                  <h4 className="font-heading font-bold text-sm leading-tight mb-1.5 line-clamp-2">{book.title}</h4>
                  {book.description && (
                    <p style={{ color: 'var(--text-muted)' }} className="text-[11px] leading-snug line-clamp-2 opacity-75 mb-2">{book.description}</p>
                  )}
                  <span style={{ color: 'var(--bg-primary)' }} className="text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1">
                    Otevřít knihu <ChevronRight size={10} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============================================================
          3. JAK TO FUNGUJE
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="font-heading text-2xl md:text-3xl font-bold mb-14 max-w-md">Jak to celé funguje</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-6">
            {[
              { n: '1', title: 'Vyberte si knihu', text: 'Procházejte katalog, přečtěte si popis a hodnocení od ostatních čtenářů přímo u knihy.' },
              { n: '2', title: 'Čtěte a vydělávejte', text: 'Za přečtené stránky získáváte XP. Za odznaky, denní přihlášení a minihry sbíráte Jomarid Coins.' },
              { n: '3', title: 'Odemykejte další', text: 'Mincemi si v knihovně rovnou kupujete přístup k dalším titulům - žádné čekání na schválení.' },
              { n: '4', title: 'Postupujte a sbírejte', text: 'Levely, denní streak, měsíční cíle a přes 100 odznaků drží motivaci i po týdnech čtení.' },
            ].map((step) => (
              <div key={step.n} className="relative">
                <span style={{ color: 'var(--border-color)' }} className="font-heading text-5xl font-extrabold block mb-3 opacity-60">{step.n}</span>
                <h3 className="font-heading font-bold text-sm mb-2">{step.title}</h3>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          4. ODZNAKY
         ============================================================ */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-start">
          <div className="lg:col-span-2">
            <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">100 odznaků čeká na odemknutí</h2>
            <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-6">
              Rozdělené do pěti kategorií - od prvního přečtení přes streaky až po sběratelství
              samo o sobě. Klikněte na kterýkoliv z pěti níže a podívejte se, co obnáší.
            </p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_BADGES.map((badge, idx) => {
                const Icon = badge.icon;
                const isActive = idx === activeBadge;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveBadge(idx)}
                    style={{ backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: isActive ? 'var(--text-primary)' : 'var(--text-body)' }}
                    className="w-12 h-12 rounded-xl border-none cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-105"
                  >
                    <Icon size={20} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div
              style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-8 shadow-sm min-h-[220px] flex flex-col justify-center"
            >
              <div className="flex items-start gap-5">
                <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0">
                  <ActiveBadgeIcon size={30} />
                </div>
                <div className="min-w-0">
                  <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">{activeBadgeData.category}</span>
                  <h3 className="font-heading font-bold text-xl mb-1.5">{activeBadgeData.title}</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-4">{activeBadgeData.description}</p>
                  <div className="flex items-center gap-4">
                    <span style={{ color: 'var(--text-body)' }} className="text-xs font-bold flex items-center gap-1.5"><Coins size={13} className="text-amber-500" /> +{activeBadgeData.coins} coinů</span>
                    <span style={{ color: 'var(--text-body)' }} className="text-xs font-bold flex items-center gap-1.5"><Zap size={13} className="text-violet-500" /> +{activeBadgeData.xp} XP</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          5. HRY
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">Pět miniher, jedna herní měna</h2>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed max-w-lg mb-10">
            Odskočte si od čtení, kdykoliv budete chtít. Za zahrání si navíc jednou denně připíšete
            bonusové Jomarid Coins - stejné mince, za které kupujete knihy.
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {GAMES_PREVIEW.map((game, idx) => {
              const Icon = game.icon;
              const isActive = idx === activeGame;
              return (
                <button
                  key={idx}
                  onClick={() => setActiveGame(idx)}
                  style={{ backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: isActive ? 'var(--text-primary)' : 'var(--text-body)' }}
                  className="px-4 py-2.5 rounded-xl border-none cursor-pointer text-xs font-bold flex items-center gap-2 transition-all duration-200"
                >
                  <Icon size={14} /> {game.title}
                </button>
              );
            })}
          </div>
          <div style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-8 flex items-start gap-5">
            <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0">
              <ActiveGameIcon size={26} />
            </div>
            <div>
              <h3 className="font-heading font-bold text-lg mb-1">{activeGameData.title}</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-2">{activeGameData.tagline}</p>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed opacity-75">{activeGameData.detail}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          6. ČTECÍ ZÁŽITEK
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">Čtečka, která se přizpůsobí vám</h2>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed max-w-lg mb-10">
          Posuňte jezdec a vyzkoušejte si, jak si sami nastavíte velikost písma přímo při čtení -
          ukázka je přímo z jednoho z našich titulů.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <span style={{ color: 'var(--text-muted)' }} className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5"><Type size={13} /> Velikost písma</span>
              <span style={{ color: 'var(--bg-primary)' }} className="text-xs font-bold tabular-nums">{demoFontSize}px</span>
            </div>
            <input
              type="range" min={14} max={28} value={demoFontSize}
              onChange={(e) => setDemoFontSize(Number(e.target.value))}
              className="w-full mb-5 cursor-pointer"
              style={{ accentColor: 'var(--bg-primary)' }}
            />
            <p style={{ fontSize: `${demoFontSize}px`, color: 'var(--text-body)' }} className="font-serif leading-relaxed transition-all duration-100 mb-2">
              „{fontDemo.quote}"
            </p>
            {fontDemo.attribution && (
              <span style={{ color: 'var(--text-muted)' }} className="text-[11px] opacity-60">— {fontDemo.attribution}</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex gap-3">
              <Bookmark size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
              <div><h3 className="font-heading font-bold text-sm mb-1">Pojmenované záložky</h3><p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Uložte si víc míst v jedné knize, ne jen tam, kde jste přestali.</p></div>
            </div>
            <div className="flex gap-3">
              <BookOpen size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
              <div><h3 className="font-heading font-bold text-sm mb-1">Pozice napříč zařízeními</h3><p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Odložíte na počítači, otevřete na mobilu přesně na stejném místě.</p></div>
            </div>
            <div className="flex gap-3">
              <Star size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
              <div><h3 className="font-heading font-bold text-sm mb-1">Hvězdičkové hodnocení</h3><p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Ohodnoťte knihu po přečtení, ať vidíte i to, co si myslí ostatní.</p></div>
            </div>
            <div className="flex gap-3">
              <MessageCircle size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
              <div><h3 className="font-heading font-bold text-sm mb-1">Krátké komentáře</h3><p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Jedna stručná věta u knihy - vaše, nebo od ostatních čtenářů.</p></div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          7. VZHLED APLIKACE
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">Tři vzhledy, jeden switch</h2>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed max-w-lg mb-10">
            V nastavení si kdykoliv přepnete vzhled celé appky - platí okamžitě a všude, od knihovny přes čtečku až po minihry.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {THEMES.map(t => (
              <div key={t.id} style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-5 flex items-center gap-4">
                <div style={{ backgroundColor: t.swatch, borderColor: t.accent }} className="w-12 h-12 rounded-xl border-2 shrink-0" />
                <div>
                  <h3 className="font-heading font-bold text-sm">{t.name}</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-[11px] opacity-70">Přepnutelné v Nastavení</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          8. PROČ ČÍST TADY (admin-editovatelné)
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <h2 className="font-heading text-2xl md:text-3xl font-bold mb-12">Proč číst tady</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
          {whyRead.map((item, idx) => {
            const Icon = WHY_READ_ICONS[idx] || Sparkles;
            return (
              <div key={idx} className="flex gap-4">
                <Icon size={20} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-heading font-bold text-sm mb-1.5">{item.title}</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============================================================
          9. JOMARID COINS - čistý přehled (bez klikacího hraní na sčítání)
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">Odkud se berou Jomarid Coins</h2>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed max-w-lg mb-8">
            Mincemi v knihovně přímo platíte za další tituly, nebo si za 150 koupíte
            Streak Freeze - pojistku na jeden zmeškaný den bez ztráty série.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {COIN_SOURCES.map((src, idx) => {
              const Icon = src.icon;
              return (
                <div key={idx} style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-4 flex items-center gap-3">
                  <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"><Icon size={17} /></div>
                  <span style={{ color: 'var(--text-body)' }} className="text-sm font-bold flex-1">{src.label}</span>
                  <span style={{ color: 'var(--bg-primary)' }} className="text-sm font-black shrink-0">+{src.coins}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ============================================================
          10. STAŇTE SE NAKLADATELEM
         ============================================================ */}
      <section className="max-w-4xl mx-auto px-4 py-20">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
          <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0"><Feather size={28} /></div>
          <div className="flex-1">
            <h2 className="font-heading text-xl md:text-2xl font-bold mb-2">Máte vlastní příběh?</h2>
            <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-4 max-w-2xl">
              Jomarid Books má i nakladatelský panel pro autory - vlastní katalog vydaných titulů,
              schvalování čtenářských žádostí a přehled reakcí na vaši práci. Přístup k roli
              nakladatele přiděluje tým Jomarid Books ručně, tak nám napište.
            </p>
            <a href="mailto:wwsigmamango@gmail.com" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs no-underline hover:brightness-105 transition-all">
              Napsat ohledně publikování <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </section>

      {/* ============================================================
          11. FAQ
         ============================================================ */}
      <section className="max-w-2xl mx-auto px-4 py-20">
        <h2 className="font-heading text-2xl md:text-3xl font-bold mb-8 text-center">Časté otázky</h2>
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 rounded-2xl border shadow-sm space-y-2">
          <FaqItem question="Jak funguje systém gamifikace a získávání odznaků?" answer="Aplikace na pozadí sleduje vaši čtenářskou aktivitu. Kdykoliv přečtete kapitolu, udržíte denní streak nebo splníte měsíční cíl, vyhodnotí se splnění podmínek automaticky. V profilu pak hned uvidíte nově odemčené odznaky z celkové sbírky přes 100 kousků." />
          <FaqItem question="Jak získám přístup ke konkrétním knihám?" answer="V knihovně vidíte celý katalog i knihy, které ještě nevlastníte. Klikem na knihu otevřete její detail s popisem, hodnocením a komentáři - a rovnou si ji tam koupíte za Jomarid Coins. Přístup se odemkne okamžitě." />
          <FaqItem question="Co jsou ty minihry a musím je hrát?" answer="Vůbec ne - je to pět volitelných her v samostatné sekci appky, čistě pro zábavu mimo čtení. Když si zahrajete alespoň chvilku, dostanete jednou denně bonusové Jomarid Coins navrch." />
          <FaqItem question="Jak funguje Streak Freeze?" answer="Koupíte si ho v sekci Statistiky za 150 Jomarid Coins. Jakmile ho vlastníte, jeden zmeškaný den se automaticky počítá jako pokrytý a vaše série se nepřeruší." />
          <FaqItem question="Musím něco stahovat nebo instalovat?" answer="Vůbec nic. Jomarid Books funguje kompletně ve webovém prohlížeči na počítači, tabletu i telefonu." />
          <FaqItem question="Pamatuje si systém, kde jsem přestal číst?" answer="Ano. Vaše přesná pozice v otevřené knize se ukládá do cloudu, takže můžete plynule navázat na mobilu přesně tam, kde jste skončili na počítači." />
          <FaqItem question="Jak se stanu nakladatelem a publikuji vlastní knihu?" answer="Roli nakladatele přiděluje ručně tým Jomarid Books. Napište na kontaktní e-mail v patičce stránky a domluvíme se na dalším postupu." />
          <FaqItem question="Kolik stojí založení účtu?" answer="Založení profilu a přístup do základního rozhraní čítárny je úplně zdarma." />
        </div>
      </section>

      {/* ============================================================
          12. ZÁVĚREČNÁ CTA
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <div style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className="rounded-2xl p-10 md:p-14 text-center shadow-xl relative overflow-hidden">
          <div style={{ backgroundColor: 'var(--bg-primary)' }} className="absolute -right-16 -top-16 w-56 h-56 opacity-20 rounded-full blur-3xl" />
          <h3 className="font-heading relative text-2xl md:text-3xl font-bold mb-3">Vaše první úroveň čeká</h3>
          <p style={{ color: 'var(--bg-body)' }} className="relative text-sm max-w-md mx-auto mb-8 opacity-80">Založte si účet, otevřete první knihu a začněte sbírat XP.</p>
          <button onClick={() => navigate('/login')} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="relative px-8 py-3.5 border-none font-bold text-sm rounded-xl shadow-md hover:brightness-105 active:scale-[0.98] transition-all duration-150">
            Spustit aplikaci
          </button>
        </div>
      </section>

      <Footer />
    </div>
  );
};

// ============================================================================
// VARIANTA PRO PŘIHLÁŠENÉ - osobní přehled ze skutečných dat účtu. Nic tady
// není demo - "pokračovat ve čtení" vede do rozečtené knihy, streak je
// opravdový, doporučená kniha je opravdu nevlastněná kniha z katalogu.
// ============================================================================
const LoggedInHome = ({ user, personal, loading, navigate }) => {
  const username = user.email ? user.email.split('@')[0] : 'čtenáři';

  if (loading || !personal) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 flex flex-col items-center justify-center gap-3">
        <Loader2 size={28} className="animate-spin opacity-40" />
        <p style={{ color: 'var(--text-muted)' }} className="text-xs opacity-60">Připravuji váš přehled…</p>
      </div>
    );
  }

  const { level, xpInCurrentLevel, xpNeededForNext, visuals, streak, readToday, coins, continueBook, continueProgress, recommended, latestBadge, totalBadges } = personal;
  const progressPct = xpNeededForNext > 0 ? Math.min(100, Math.round((xpInCurrentLevel / xpNeededForNext) * 100)) : 100;

  return (
    <div style={{ color: 'var(--text-body)' }} className="font-sans">

      {/* ============================================================
          1. OSOBNÍ PŘEHLED - skutečný level, streak, mince
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 pt-14 pb-10">
        <h1 className="font-heading text-2xl md:text-3xl font-extrabold tracking-tight mb-1">Vítej zpátky, {username}</h1>
        <p style={{ color: 'var(--text-muted)' }} className="text-sm mb-8">{visuals.name}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">Úroveň</span>
              <TrendingUp size={14} style={{ color: 'var(--bg-primary)' }} />
            </div>
            <div className="flex items-end justify-between mb-2">
              <span className="font-heading text-3xl font-extrabold tabular-nums" style={{ color: 'var(--bg-primary)' }}>{level}</span>
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-medium mb-1">{xpInCurrentLevel}/{xpNeededForNext} XP</span>
            </div>
            <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="w-full h-2 rounded-full overflow-hidden">
              <div style={{ backgroundColor: 'var(--bg-primary)', width: `${progressPct}%` }} className="h-full rounded-full transition-all duration-500" />
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">Streak</span>
              <Flame size={14} className="text-orange-500" />
            </div>
            <span className="font-heading text-3xl font-extrabold tabular-nums block mb-1">{streak} {streak === 1 ? 'den' : streak >= 2 && streak <= 4 ? 'dny' : 'dní'}</span>
            <span style={{ color: readToday ? '#22c55e' : '#f59e0b' }} className="text-[11px] font-bold">
              {readToday ? '✓ Dnes už splněno' : streak > 0 ? '⚠ Ještě jste dnes nečetli' : 'Začněte dnes svou sérii'}
            </span>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">Jomarid Coins</span>
              <Coins size={14} className="text-amber-500" />
            </div>
            <span className="font-heading text-3xl font-extrabold tabular-nums block mb-1">{coins}</span>
            <span style={{ color: 'var(--text-muted)' }} className="text-[11px] opacity-70">{totalBadges} odznaků odemčeno</span>
          </div>
        </div>

        {!readToday && streak > 0 && (
          <div style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', borderColor: '#f59e0b' }} className="border rounded-xl p-4 flex items-center gap-3 mb-2">
            <Flame size={18} className="text-amber-500 shrink-0" />
            <p className="text-xs font-bold flex-1" style={{ color: 'var(--text-body)' }}>
              Vaše {streak}denní série ještě dnes čeká na pokrytí. Přečtěte alespoň kousek, ať nepřijdete o postup.
            </p>
          </div>
        )}
      </section>

      {/* ============================================================
          2. POKRAČOVAT VE ČTENÍ + DOPORUČENO
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {continueBook ? (
            <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60 block mb-2">Pokračovat ve čtení</span>
                <h3 className="font-heading font-bold text-lg mb-1">{continueBook.title}</h3>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4">{continueBook.author}</p>
                <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="w-full h-2 rounded-full overflow-hidden mb-2">
                  <div style={{ backgroundColor: 'var(--bg-primary)', width: `${continueProgress}%` }} className="h-full rounded-full" />
                </div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[11px] opacity-70">{continueProgress}% přečteno</span>
              </div>
              <button
                onClick={() => navigate(`/read/${continueBook.id}`)}
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                className="mt-5 w-full py-3 rounded-xl font-bold text-sm border-none cursor-pointer hover:brightness-105 transition-all flex items-center justify-center gap-2"
              >
                <BookOpen size={15} /> Pokračovat
              </button>
            </div>
          ) : (
            <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 flex flex-col justify-center items-center text-center">
              <BookOpen size={28} style={{ color: 'var(--text-muted)' }} className="opacity-40 mb-3" />
              <p style={{ color: 'var(--text-muted)' }} className="text-sm mb-4">Zrovna nemáte žádnou rozečtenou knihu.</p>
              <button onClick={() => navigate('/app')} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-5 py-2.5 rounded-xl font-bold text-xs border-none cursor-pointer hover:brightness-105 transition-all">
                Otevřít knihovnu
              </button>
            </div>
          )}

          {recommended ? (
            <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60 block mb-2">Doporučeno pro vás</span>
                <h3 className="font-heading font-bold text-lg mb-1">{recommended.title}</h3>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-3">{recommended.author}</p>
                {recommended.description && (
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed opacity-80 line-clamp-3">{recommended.description}</p>
                )}
              </div>
              <button
                onClick={() => {
                  try { sessionStorage.setItem('library_open_book_id', recommended.id); } catch (e) { /* storage unavailable, ignore */ }
                  navigate('/app');
                }}
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}
                className="mt-5 w-full py-3 rounded-xl font-bold text-sm border-none cursor-pointer hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <Coins size={15} /> {recommended.price_coins ?? 150} mincí v knihovně
              </button>
            </div>
          ) : (
            <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 flex flex-col justify-center items-center text-center">
              <Sparkles size={28} style={{ color: 'var(--text-muted)' }} className="opacity-40 mb-3" />
              <p style={{ color: 'var(--text-muted)' }} className="text-sm">Zatím vlastníte celý dostupný katalog. Sledujte novinky!</p>
            </div>
          )}
        </div>
      </section>

      {/* ============================================================
          3. ODZNAKY + RYCHLÁ NAVIGACE
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-16">
        <div className="max-w-5xl mx-auto px-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div
              style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-6 lg:col-span-2 flex items-center gap-5"
            >
              {latestBadge ? (
                <>
                  <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0">
                    <Trophy size={28} />
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">Naposledy odemčeno</span>
                    <h3 className="font-heading font-bold text-lg">{latestBadge.title}</h3>
                    <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">{latestBadge.description}</p>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0">
                    <Footprints size={28} />
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">Váš první odznak čeká</span>
                    <h3 className="font-heading font-bold text-lg">První Průzkumník</h3>
                    <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Přečtěte svou první knihu a odemkněte ho.</p>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => navigate('/stats')}
              style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              className="rounded-2xl p-6 border-none cursor-pointer hover:brightness-105 transition-all flex flex-col items-center justify-center gap-2"
            >
              <BarChart3 size={24} />
              <span className="font-bold text-sm">Zobrazit statistiky</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <button onClick={() => navigate('/app')} style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-xl p-4 cursor-pointer hover:opacity-80 transition-all flex flex-col items-center gap-2 text-xs font-bold">
              <Library size={18} /> Knihovna
            </button>
            <button onClick={() => navigate('/games')} style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-xl p-4 cursor-pointer hover:opacity-80 transition-all flex flex-col items-center gap-2 text-xs font-bold">
              <Gamepad2 size={18} /> Minihry
            </button>
            <button onClick={() => navigate('/stats')} style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-xl p-4 cursor-pointer hover:opacity-80 transition-all flex flex-col items-center gap-2 text-xs font-bold">
              <Trophy size={18} /> Odznaky
            </button>
            <a href="mailto:wwsigmamango@gmail.com" style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="border rounded-xl p-4 no-underline hover:opacity-80 transition-all flex flex-col items-center gap-2 text-xs font-bold">
              <Phone size={18} /> Podpora
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

const Footer = () => (
  <footer style={{ borderColor: 'var(--border-color)' }} className="max-w-6xl mx-auto px-4 pt-8 pb-12 border-t flex flex-col sm:flex-row items-center justify-between text-xs gap-4">
    <div style={{ color: 'var(--text-muted)' }} className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 opacity-70">
      <span className="font-semibold">© {new Date().getFullYear()} Jomarid Books</span>
      <span className="hidden sm:inline opacity-40">·</span>
      <span>Digitální čítárna s postupem</span>
    </div>
    <a
      href="mailto:wwsigmamango@gmail.com"
      style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }}
      className="flex items-center gap-2 no-underline hover:opacity-85 px-3 py-1.5 rounded-md transition-all font-semibold"
    >
      <Phone size={11} /> wwsigmamango@gmail.com
    </a>
  </footer>
);
