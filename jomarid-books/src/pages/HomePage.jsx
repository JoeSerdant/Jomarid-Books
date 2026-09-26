import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaqItem } from '../components/FaqItem';
import {
  Book, BookOpen, ChevronRight, Coins, Flame, Library, Phone,
  ShieldCheck, Sparkles, Zap, Footprints, Scroll,
  Rocket, Swords, Building2, Target, Crown, ArrowRight, RotateCcw, MessageCircle, Trophy,
  Type, Bookmark, Star, Feather, Calendar, Gamepad2
} from 'lucide-react';

// Reálné odznaky (stejná data jako v aplikaci) napříč čtyřmi z pěti
// skutečných kategorií (books/levels/monthly/special/streak), pro pestrost.
const SAMPLE_BADGES = [
  { icon: Footprints, title: 'První Průzkumník', description: 'Přečti svou úplně první knihu v knihovně.', coins: 50, xp: 100, category: 'Knihy' },
  { icon: Flame, title: 'Týdenní Plamen', description: 'Čti sedm dní v kuse bez jediného výpadku.', coins: 150, xp: 300, category: 'Streak' },
  { icon: Scroll, title: 'Průzkumník Svazků', description: 'Dosáhni čtenářské úrovně 4.', coins: 80, xp: 120, category: 'Úroveň' },
  { icon: Coins, title: 'Mincový Sběratel', description: 'Nashromáždi celkem 500 Jomarid Coinů.', coins: 150, xp: 300, category: 'Sběratelství' },
  { icon: Trophy, title: 'Mistr Odznaků', description: 'Odemkni 25 různých odznaků ze sbírky.', coins: 500, xp: 1000, category: 'Sběratelství' },
];

const GAMES_PREVIEW = [
  {
    icon: Rocket, title: 'Jomarid Rocket Game',
    tagline: 'Vesmírná arkádová střílečka s vlastními vylepšeními a postupem.',
    detail: 'Nepřátelé občas upustí bonusovou minci navíc k tomu, co si vyděláš jen za to, že si dnes zahraješ.'
  },
  {
    icon: Swords, title: 'Warroom: Frontlines',
    tagline: 'Velitelská taktická hra - řiď frontu, jednotky a zdroje.',
    detail: 'Rozhoduješ o nasazení jednotek a zdrojích z velitelského stanu, ne v přímé palbě.'
  },
  {
    icon: Building2, title: 'City Clicker',
    tagline: 'Vybuduj si vlastní město klikáním.',
    detail: 'Čtyři zcela odlišné vizuální styly na výběr - stejné město, jiná nálada.'
  },
  {
    icon: Target, title: 'Polygon aréna',
    tagline: 'Rozstřílej tvary a poskládej si vlastní stavbu tanku.',
    detail: 'Klasika, týmový mód, nebo klidné cvičiště bez tlaku - na výběr hned v menu.'
  },
  {
    icon: Crown, title: 'Chess League',
    tagline: 'Šachy proti pěti botům rostoucí obtížnosti.',
    detail: 'Vlastní XP, streaky a ligový postup - silnější soupeře si odemykáte postupně, výhrou za výhrou.'
  },
];

// Každá položka tady je ověřené reálné číslo z appky (RPC konstanty a
// konkrétní odznak), ne odhad - viz claim_daily_login_bonus, claim_game_bonus
// a odznak "První Průzkumník" v badges.js.
const COIN_SOURCES = [
  { label: 'Denní přihlášení', coins: 15, icon: Calendar },
  { label: 'Zahraná minihra dnes', coins: 20, icon: Gamepad2 },
  { label: 'Odznak „První Průzkumník"', coins: 50, icon: Footprints },
  { label: 'Splněný měsíční cíl', coins: 250, icon: Target },
];

const XP_PER_LEVEL = 120;
const XP_PER_CHAPTER = 35;

export const HomePage = () => {
  const navigate = useNavigate();

  const [demoXp, setDemoXp] = useState(0);
  const [justLeveled, setJustLeveled] = useState(false);
  const [activeBadge, setActiveBadge] = useState(0);
  const [activeGame, setActiveGame] = useState(0);
  const [checkedSources, setCheckedSources] = useState(() => COIN_SOURCES.map(() => false));
  const [demoFontSize, setDemoFontSize] = useState(18);

  const level = Math.floor(demoXp / XP_PER_LEVEL) + 1;
  const progressInLevel = demoXp % XP_PER_LEVEL;
  const progressPercent = Math.round((progressInLevel / XP_PER_LEVEL) * 100);

  const handleSimulateChapter = () => {
    setDemoXp(prev => {
      const next = prev + XP_PER_CHAPTER;
      const prevLevel = Math.floor(prev / XP_PER_LEVEL) + 1;
      const nextLevel = Math.floor(next / XP_PER_LEVEL) + 1;
      if (nextLevel > prevLevel) {
        setJustLeveled(true);
        setTimeout(() => setJustLeveled(false), 1600);
      }
      return next;
    });
  };

  const toggleSource = (idx) => {
    setCheckedSources(prev => prev.map((v, i) => i === idx ? !v : v));
  };

  const coinTotal = COIN_SOURCES.reduce((sum, src, idx) => sum + (checkedSources[idx] ? src.coins : 0), 0);

  const featuredBooks = [
    { title: "Hobin Rood: DÍL 1: JAK OŽEBRAČIT PRVNÍ VESNICI", category: "Dobrodružná satira", author: "Jomarid" },
    { title: "Šepot starých knihoven 1. část: Vězení pro příběhy", category: "Mysteriózní fantasy", author: "Alexandr Heryán" },
    { title: "Jomirad 1. část", category: "Superhrdinská sága", author: "Jomarid" },
  ];

  const activeBadgeData = SAMPLE_BADGES[activeBadge];
  const ActiveBadgeIcon = activeBadgeData.icon;
  const activeGameData = GAMES_PREVIEW[activeGame];
  const ActiveGameIcon = activeGameData.icon;

  return (
    <div style={{ color: 'var(--text-body)' }} className="font-sans">

      {/* ============================================================
          1. HERO - nadpis vlevo, živá XP demo napravo
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
              Otevřete knihu a sledujte, jak stoupá vaše úroveň
            </h1>

            <p style={{ color: 'var(--text-muted)' }} className="text-base md:text-lg max-w-lg mb-9 leading-relaxed">
              Tři originální knižní řady, přes 100 sběratelských odznaků a vlastní herní měna,
              kterou si vyděláte čtením - nebo si mezitím zahrajete jednu z pěti miniher.
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <button
                onClick={() => navigate('/app')}
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

          {/* ŽIVÁ DEMO: XP pruh, který můžete sami naplnit */}
          <div className="lg:col-span-2">
            <div
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-6 shadow-lg relative overflow-hidden"
            >
              {justLeveled && (
                <div
                  style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  className="absolute top-3 right-3 text-[10px] font-bold px-2.5 py-1 rounded-full animate-in zoom-in-75 fade-in duration-200"
                >
                  Level Up!
                </div>
              )}

              <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-semibold uppercase tracking-wide opacity-60 mb-1">
                Vyzkoušejte to hned teď
              </p>
              <h3 className="font-heading text-lg font-bold mb-5">Vaše čtenářská úroveň</h3>

              <div className="flex items-end justify-between mb-2">
                <span className="font-heading text-4xl font-extrabold tabular-nums" style={{ color: 'var(--bg-primary)' }}>
                  {level}
                </span>
                <span style={{ color: 'var(--text-muted)' }} className="text-xs font-medium mb-1">
                  {progressInLevel} / {XP_PER_LEVEL} XP do další úrovně
                </span>
              </div>

              <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="w-full h-3 rounded-full overflow-hidden mb-5">
                <div
                  style={{ backgroundColor: 'var(--bg-primary)', width: `${progressPercent}%` }}
                  className="h-full rounded-full transition-all duration-500 ease-out"
                />
              </div>

              <button
                onClick={handleSimulateChapter}
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}
                className="w-full py-3 rounded-xl font-bold text-sm border-none cursor-pointer hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <BookOpen size={15} /> Přečíst kapitolu (+{XP_PER_CHAPTER} XP)
              </button>

              {demoXp > 0 && (
                <button
                  onClick={() => { setDemoXp(0); setJustLeveled(false); }}
                  style={{ color: 'var(--text-muted)' }}
                  className="w-full mt-2 py-1.5 text-[11px] font-semibold bg-transparent border-none cursor-pointer hover:opacity-70 flex items-center justify-center gap-1"
                >
                  <RotateCcw size={11} /> Zkusit znovu
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          2. TITULY - pruh s tituly
         ============================================================ */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        <h2 style={{ color: 'var(--text-muted)' }} className="text-sm font-semibold mb-6 opacity-70">Hlavní tituly</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {featuredBooks.map((book, idx) => (
            <div
              key={idx}
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              className="group relative h-44 rounded-xl p-5 border flex flex-col justify-between text-left shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer overflow-hidden"
              onClick={() => navigate('/app')}
            >
              <div className="flex justify-between items-start w-full">
                <span style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="text-[9px] uppercase font-bold tracking-wide px-2 py-0.5 rounded">
                  {book.category}
                </span>
                <Book size={14} style={{ color: 'var(--text-muted)' }} className="opacity-50 group-hover:opacity-100 group-hover:rotate-12 transition-all duration-300" />
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-semibold opacity-70 block mb-1">{book.author}</span>
                <h4 className="font-heading font-bold text-sm leading-tight mb-2 line-clamp-2">{book.title}</h4>
                <span style={{ color: 'var(--bg-primary)' }} className="text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1">
                  Otevřít knihu <ChevronRight size={10} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================
          3. JAK TO FUNGUJE - jediná opravdová číslovaná sekvence
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
                <span
                  style={{ color: 'var(--border-color)' }}
                  className="font-heading text-5xl font-extrabold block mb-3 opacity-60"
                >
                  {step.n}
                </span>
                <h3 className="font-heading font-bold text-sm mb-2">{step.title}</h3>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          4. MINCE - interaktivní kalkulačka odměn
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-start">
          <div className="lg:col-span-2">
            <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">Odkud se berou Jomarid Coins</h2>
            <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-4">
              Zaškrtněte, co všechno byste dnes reálně stihli, a sledujte, kolik by vám to vyneslo.
              Mincemi pak v knihovně přímo platíte za další tituly, nebo si za 150 koupíte
              Streak Freeze - pojistku na jeden zmeškaný den bez ztráty série.
            </p>
          </div>

          <div className="lg:col-span-3">
            <div
              style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-6 shadow-sm"
            >
              <div className="space-y-2 mb-5">
                {COIN_SOURCES.map((src, idx) => {
                  const Icon = src.icon;
                  const checked = checkedSources[idx];
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleSource(idx)}
                      style={{
                        backgroundColor: checked ? 'var(--bg-badge)' : 'var(--bg-secondary)',
                        borderColor: checked ? 'var(--bg-primary)' : 'var(--border-color)',
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-150 text-left"
                    >
                      <span className="flex items-center gap-3">
                        <span
                          style={{ backgroundColor: checked ? 'var(--bg-primary)' : 'var(--bg-body)', color: checked ? 'var(--text-primary)' : 'var(--text-muted)' }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                        >
                          <Icon size={15} />
                        </span>
                        <span style={{ color: 'var(--text-body)' }} className="text-xs font-bold">{src.label}</span>
                      </span>
                      <span style={{ color: checked ? 'var(--text-badge)' : 'var(--text-muted)' }} className="text-xs font-bold shrink-0">
                        +{src.coins}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div style={{ borderColor: 'var(--border-color)' }} className="border-t pt-4 flex items-center justify-between">
                <span style={{ color: 'var(--text-muted)' }} className="text-xs font-semibold uppercase tracking-wide">Dnešní součet</span>
                <span className="font-heading text-3xl font-extrabold tabular-nums flex items-center gap-2" style={{ color: 'var(--bg-primary)' }}>
                  <Coins size={22} /> {coinTotal}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          5. ODZNAKY - interaktivní vitrína, klikací
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-6xl mx-auto px-4">
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
                    style={{
                      backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                      color: isActive ? 'var(--text-primary)' : 'var(--text-body)',
                    }}
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
                <div
                  style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }}
                  className="w-16 h-16 rounded-xl flex items-center justify-center shrink-0"
                >
                  <ActiveBadgeIcon size={30} />
                </div>
                <div className="min-w-0">
                  <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase tracking-wide opacity-60">
                    {activeBadgeData.category}
                  </span>
                  <h3 className="font-heading font-bold text-xl mb-1.5">{activeBadgeData.title}</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-4">
                    {activeBadgeData.description}
                  </p>
                  <div className="flex items-center gap-4">
                    <span style={{ color: 'var(--text-body)' }} className="text-xs font-bold flex items-center gap-1.5">
                      <Coins size={13} className="text-amber-500" /> +{activeBadgeData.coins} coinů
                    </span>
                    <span style={{ color: 'var(--text-body)' }} className="text-xs font-bold flex items-center gap-1.5">
                      <Zap size={13} className="text-violet-500" /> +{activeBadgeData.xp} XP
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>

      {/* ============================================================
          6. HRY - přepínací náhled pěti skutečných her
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 py-20">
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
                style={{
                  backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-body)',
                  borderColor: 'var(--border-color)',
                }}
                className="px-4 py-2.5 rounded-xl border-none cursor-pointer text-xs font-bold flex items-center gap-2 transition-all duration-200"
              >
                <Icon size={14} /> {game.title}
              </button>
            );
          })}
        </div>

        <div
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          className="border rounded-2xl p-8 flex items-start gap-5"
        >
          <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0">
            <ActiveGameIcon size={26} />
          </div>
          <div>
            <h3 className="font-heading font-bold text-lg mb-1">{activeGameData.title}</h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-2">{activeGameData.tagline}</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed opacity-75">{activeGameData.detail}</p>
          </div>
        </div>
      </section>

      {/* ============================================================
          7. ČTECÍ ZÁŽITEK - živá ukázka velikosti písma + zbytek
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-5xl mx-auto px-4">
          <h2 className="font-heading text-2xl md:text-3xl font-bold mb-4">Čtečka, která se přizpůsobí vám</h2>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed max-w-lg mb-10">
            Posuňte jezdec a vyzkoušejte si, jak si sami nastavíte velikost písma přímo při čtení.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div
              style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)' }}
              className="border rounded-2xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <span style={{ color: 'var(--text-muted)' }} className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5">
                  <Type size={13} /> Velikost písma
                </span>
                <span style={{ color: 'var(--bg-primary)' }} className="text-xs font-bold tabular-nums">{demoFontSize}px</span>
              </div>
              <input
                type="range"
                min={14}
                max={28}
                value={demoFontSize}
                onChange={(e) => setDemoFontSize(Number(e.target.value))}
                className="w-full mb-5 cursor-pointer accent-current"
                style={{ accentColor: 'var(--bg-primary)' }}
              />
              <p
                style={{ fontSize: `${demoFontSize}px`, color: 'var(--text-body)' }}
                className="font-serif leading-relaxed transition-all duration-100"
              >
                „A tak se Hobin Rood vydal do první vesnice, netuše, že z ní za týden nezbude jediná mince…"
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex gap-3">
                <Bookmark size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-heading font-bold text-sm mb-1">Pojmenované záložky</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Uložte si víc míst v jedné knize, ne jen tam, kde jste přestali.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <BookOpen size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-heading font-bold text-sm mb-1">Pozice napříč zařízeními</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Odložíte na počítači, otevřete na mobilu přesně na stejném místě.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Star size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-heading font-bold text-sm mb-1">Hvězdičkové hodnocení</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Ohodnoťte knihu po přečtení, ať vidíte i to, co si myslí ostatní.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <MessageCircle size={18} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-heading font-bold text-sm mb-1">Krátké komentáře</h3>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">Jedna stručná věta u knihy - vaše, nebo od ostatních čtenářů.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          8. PROČ ČÍST TADY
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 py-20">
        <h2 className="font-heading text-2xl md:text-3xl font-bold mb-12">Proč číst tady</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
          <div className="flex gap-4">
            <Zap size={20} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="font-heading font-bold text-sm mb-1.5">Bez stahování, bez čekání</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
                Text se načítá přímo v prohlížeči - na počítači, tabletu i telefonu. Žádné PDF, žádné instalace.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <ShieldCheck size={20} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="font-heading font-bold text-sm mb-1.5">Kurátorovaný fond</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
                Žádná masová knihovna plná balastu - jen původní tituly a edice, které jinde nenajdete.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Sparkles size={20} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="font-heading font-bold text-sm mb-1.5">Rozhraní bez reklam</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
                Vaše soustředění je priorita. Žádné bannery, žádné sociální sítě, jen text a váš postup.
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <Flame size={20} style={{ color: 'var(--bg-primary)' }} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="font-heading font-bold text-sm mb-1.5">Streak, co se dá zachránit</h3>
              <p style={{ color: 'var(--text-muted)' }} className="text-xs leading-relaxed">
                Zmeškaný den nemusí znamenat konec série - Streak Freeze ji na jeden den ochrání.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          9. STAŇTE SE NAKLADATELEM
         ============================================================ */}
      <section style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border-y py-20">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-8">
            <div
              style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0"
            >
              <Feather size={28} />
            </div>
            <div className="flex-1">
              <h2 className="font-heading text-xl md:text-2xl font-bold mb-2">Máte vlastní příběh?</h2>
              <p style={{ color: 'var(--text-muted)' }} className="text-sm leading-relaxed mb-4 max-w-2xl">
                Jomarid Books má i nakladatelský panel pro autory - vlastní katalog vydaných titulů,
                schvalování čtenářských žádostí a přehled reakcí na vaši práci. Přístup k roli
                nakladatele přiděluje tým Jomarid Books ručně, tak nám napište.
              </p>
              <a
                href="mailto:wwsigmamango@gmail.com"
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs no-underline hover:brightness-105 transition-all"
              >
                Napsat ohledně publikování <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          10. FAQ
         ============================================================ */}
      <section className="max-w-2xl mx-auto px-4 py-20">
        <h2 className="font-heading text-2xl md:text-3xl font-bold mb-8 text-center">Časté otázky</h2>
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 rounded-2xl border shadow-sm space-y-2">
          <FaqItem
            question="Jak funguje systém gamifikace a získávání odznaků?"
            answer="Aplikace na pozadí sleduje vaši čtenářskou aktivitu. Kdykoliv přečtete kapitolu, udržíte denní streak nebo splníte měsíční cíl, vyhodnotí se splnění podmínek automaticky. V profilu pak hned uvidíte nově odemčené odznaky z celkové sbírky přes 100 kousků."
          />
          <FaqItem
            question="Jak získám přístup ke konkrétním knihám?"
            answer="V knihovně vidíte celý katalog i knihy, které ještě nevlastníte. Klikem na knihu otevřete její detail s popisem, hodnocením a komentáři - a rovnou si ji tam koupíte za Jomarid Coins, které si mezitím vyděláte čtením, plněním odznáčků nebo hraním miniher. Přístup se odemkne okamžitě."
          />
          <FaqItem
            question="Co jsou ty minihry a musím je hrát?"
            answer="Vůbec ne - je to pět volitelných her v samostatné sekci appky, čistě pro zábavu mimo čtení. Když si zahrajete, dostanete jednou denně bonusové Jomarid Coins navrch."
          />
          <FaqItem
            question="Jak funguje Streak Freeze?"
            answer="Koupíte si ho v sekci Statistiky za 150 Jomarid Coins. Jakmile ho vlastníte, jeden zmeškaný den se automaticky počítá jako pokrytý a vaše série se nepřeruší."
          />
          <FaqItem
            question="Musím něco stahovat nebo instalovat?"
            answer="Vůbec nic. Jomarid Books funguje kompletně ve webovém prohlížeči na počítači, tabletu i telefonu."
          />
          <FaqItem
            question="Pamatuje si systém, kde jsem přestal číst?"
            answer="Ano. Vaše přesná pozice v otevřené knize se ukládá do cloudu, takže můžete plynule navázat na mobilu přesně tam, kde jste skončili na počítači."
          />
          <FaqItem
            question="Jak se stanu nakladatelem a publikuji vlastní knihu?"
            answer="Roli nakladatele přiděluje ručně tým Jomarid Books. Napište na kontaktní e-mail v patičce stránky a domluvíme se na dalším postupu."
          />
          <FaqItem
            question="Kolik stojí založení účtu?"
            answer="Založení profilu a přístup do základního rozhraní čítárny je úplně zdarma."
          />
        </div>
      </section>

      {/* ============================================================
          11. ZÁVĚREČNÁ CTA
         ============================================================ */}
      <section className="max-w-5xl mx-auto px-4 pb-20">
        <div
          style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }}
          className="rounded-2xl p-10 md:p-14 text-center shadow-xl relative overflow-hidden"
        >
          <div style={{ backgroundColor: 'var(--bg-primary)' }} className="absolute -right-16 -top-16 w-56 h-56 opacity-20 rounded-full blur-3xl" />
          <h3 className="font-heading relative text-2xl md:text-3xl font-bold mb-3">Vaše první úroveň čeká</h3>
          <p style={{ color: 'var(--bg-body)' }} className="relative text-sm max-w-md mx-auto mb-8 opacity-80">
            Založte si účet, otevřete první knihu a sledujte, jak se plní XP pruh - přesně jako v ukázce nahoře.
          </p>
          <button
            onClick={() => navigate('/app')}
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            className="relative px-8 py-3.5 border-none font-bold text-sm rounded-xl shadow-md hover:brightness-105 active:scale-[0.98] transition-all duration-150"
          >
            Spustit aplikaci
          </button>
        </div>
      </section>

      {/* ============================================================
          12. PATIČKA
         ============================================================ */}
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

    </div>
  );
};
