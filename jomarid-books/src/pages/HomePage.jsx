import { useNavigate } from 'react-router-dom';
import { FaqItem } from '../components/FaqItem';
import { Award, Book, BookOpen, ChevronRight, Coins, Flame, Gamepad2, Library, Phone, ShieldCheck, Sparkles, Target, Trophy, Zap } from 'lucide-react';

export const HomePage = () => {
  const navigate = useNavigate();

  // 🔥 AKTUALIZOVANÉ TITULY VČETNĚ HOBINA ROODA JAKO HLAVNÍHO MAGNETU
  const featuredBooks = [
    { 
      title: "Hobin Rood: DÍL 1: JAK OŽEBRAČIT PRVNÍ VESNICI", 
      category: "Dobrodružná satira", 
      author: "Jomarid"
    },
    { 
      title: "Šepot starých knihoven 1. část: Vězení pro příběhy", 
      category: "Mysteriózní fantasy", 
      author: "Alexandr Heryán"
    },
    { 
      title: "Jomirad 1. část", 
      category: "Superhrdinská sága", 
      author: "Jomarid"
    },
  ];

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-5xl mx-auto px-4 pt-24 pb-12 text-center animate-in fade-in duration-700 relative overflow-visible font-sans">
      
      {/* ====================================================
          🔥 PRÉMIOVÉ SBĚRATELSKÉ RAZÍTKO (VIZUÁLNÍ MAGNET)
         ==================================================== */}
      <div className="absolute top-6 right-4 sm:right-12 z-50 pointer-events-none md:scale-110 select-none animate-in zoom-in-50 duration-1000 delay-300">
        <div 
          style={{ 
            borderColor: 'var(--bg-primary)', 
            color: 'var(--bg-primary)',
            boxShadow: '0 0 15px rgba(0,0,0,0.05)'
          }} 
          className="border-[3px] border-dashed rounded-xl px-4 py-2 font-black text-[11px] sm:text-xs uppercase tracking-widest rotate-12 bg-white/5 backdrop-blur-xs flex flex-col items-center gap-0.5"
        >
          <span className="opacity-90 tracking-normal text-[9px] font-bold">Aplikace Ověřena</span>
          <span className="text-sm font-black tracking-tight">JOMARID BOOKS</span>
          <div className="w-full h-[1px] bg-current my-0.5 opacity-30" />
          <span className="text-[9px] tracking-wider">STABLE CORE v28.2</span>
        </div>
      </div>

      {/* 1. HERO SEKCE */}
      <section className="mb-20 relative">
        {/* Horní badge s pulzováním */}
        <div 
          style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} 
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs uppercase tracking-wider mb-6 animate-pulse"
        >
          <Library size={14} /> Výběrová digitální edice
        </div>
        
        {/* Hlavní nadpis s plynulým náběhem */}
        <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight mb-6 leading-tight animate-in slide-in-from-top-6 duration-500">
          Exkluzivní literární díla <br/>
          <span style={{ color: 'var(--bg-primary)' }} className="inline-block hover:scale-105 transition-transform duration-300">
            na dosah ruky
          </span>
        </h1>
        
        {/* Popisek */}
        <p style={{ color: 'var(--text-muted)' }} className="text-base md:text-lg font-medium max-w-2xl mx-auto mb-10 leading-relaxed opacity-90">
          Vítejte v privátním fondu Jomarid Books. Sledujte osudy hrdiny Hobina Rooda, odhalte skryté pravdy v ságách Jomirada a rozpleťte tajemství série Šepot starých knihoven prostřednictvím našeho Cloud-to-Screen rozhraní.
        </p>

        {/* Hlavní akční tlačítko */}
        <div className="max-w-md mx-auto space-y-4 mb-16 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
          <button 
            onClick={() => navigate('/app')} 
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            className="w-full py-4 uppercase font-black tracking-wider text-sm border-none rounded-xl shadow-lg hover:scale-[1.03] hover:shadow-xl active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer"
          >
            <BookOpen size={16} /> Odemknout digitální čítárnu
          </button>
          
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] font-bold uppercase opacity-50 tracking-wider">
            Nemáte účet? Zřídíte si ho okamžitě a zdarma přímo u vstupu.
          </p>
        </div>

        {/* SEKCE: NAŠE TITULY + KARTY */}
        <div className="max-w-3xl mx-auto mt-20">
          <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-widest opacity-50 mb-8 text-center">— NAŠE HLAVNÍ TITULY —</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            {featuredBooks.map((book, idx) => (
              <div 
                key={idx}
                style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
                className="group relative h-48 rounded-xl p-5 border flex flex-col justify-between text-left shadow-md hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 cursor-pointer overflow-hidden"
                onClick={() => navigate('/app')}
              >
                {/* Dynamické podbarvení pozadí při hoveru */}
                <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="absolute inset-0 opacity-0 group-hover:opacity-40 transition-opacity duration-300" />
                
                <div className="relative z-10 flex justify-between items-start w-full">
                  <span style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="text-[9px] uppercase font-black tracking-widest px-2 py-0.5 rounded shadow-xs">
                    {book.category}
                  </span>
                  <Book size={14} style={{ color: 'var(--text-muted)' }} className="opacity-60 group-hover:opacity-100 group-hover:rotate-12 transition-all duration-300" />
                </div>

                <div className="relative z-10">
                  <span style={{ color: 'var(--text-muted)' }} className="text-[9px] uppercase font-bold tracking-wider opacity-70 block mb-0.5">
                    {book.author}
                  </span>
                  <h4 style={{ color: 'var(--text-body)' }} className="font-black uppercase text-sm leading-tight mb-2 tracking-tight line-clamp-2 transition-colors group-hover:text-indigo-500">
                    {book.title}
                  </h4>
                  <span style={{ color: 'var(--bg-primary)' }} className="text-[10px] font-black tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1">
                    OTEVŘÍT KNIHU <ChevronRight size={10} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--border-color)' }} className="border-0 h-[1px] my-16 opacity-30" />

      {/* 2. STATISTIKY (Social Proof) */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center mb-24">
        {[
          { value: "100%", label: "Digitální formát" },
          { value: "0 ms", label: "Odezva při otáčení" },
          { value: "24/7", label: "Okamžitý přístup" },
          { value: "Cloud", label: "Synchronizace pozice" }
        ].map((stat, idx) => (
          <div 
            key={idx} 
            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} 
            className="p-4 rounded-xl border transition-all duration-300 hover:scale-[1.04] hover:shadow-md shadow-sm"
          >
            <p style={{ color: 'var(--text-body)' }} className="text-3xl font-black leading-none mb-1 tracking-tight">{stat.value}</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-[9px] font-black uppercase tracking-wider opacity-60">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* 3. SEKCE: GAMEFIKACE A PROGRESE */}
      <section className="mb-24 animate-in fade-in duration-1000">
        <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-widest opacity-50 mb-3 text-center">— ČTENÍ JAKO HRA —</h2>
        <h3 className="text-2xl md:text-3xl font-black uppercase tracking-tight mb-10 max-w-xl mx-auto leading-tight">
          Získávejte úrovně, plňte výzvy a odemykejte vzácné trofeje
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-left">
          {/* Prvek 1: Úrovně a XP */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div style={{ color: 'var(--bg-primary)' }} className="mb-4 transition-transform group-hover:scale-110 duration-300"><Award size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>Čtenářský Level</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Každá přečtená stránka vám generuje zkušenostní body (XP). Postupujte od Zapáleného začátečníka až na bájnou úroveň 100 – Avatar vědění.
            </p>
          </div>

          {/* Prvek 2: Daily Streak */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div className="mb-4 text-orange-500 transition-transform group-hover:scale-110 duration-300"><Flame size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>Denní plamínky</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Udržte si zvyk pravidelného čtení. Čtěte každý den, navyšujte svůj denní Streak a nenechte svůj literární oheň vyhasnout.
            </p>
          </div>

          {/* Prvek 3: Obří sbírka odznaků */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div className="mb-4 text-yellow-500 transition-transform group-hover:scale-110 duration-300"><Trophy size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>80+ Achievementů</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Odhalte skryté milníky rozdělené do 6 unikátních kategorií. Systém automaticky sleduje vaše statistiky a odměňuje vaše čtenářské úspěchy.
            </p>
          </div>

          {/* Prvek 4: Měsíční milníky */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div className="mb-4 text-cyan-500 transition-transform group-hover:scale-110 duration-300"><Target size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>Měsíční výzvy</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Stanovte si na začátku měsíce osobní knižní cíl. Zvládnete splnit plán na 100 %, nebo ho překonáte a získáte odznak Dvojitého zásahu?
            </p>
          </div>
        </div>
      </section>

      {/* 3.5 SEKCE: JOMARID COINS A MINI-HRY */}
      <section className="mb-24 animate-in fade-in duration-1000">
        <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-widest opacity-50 mb-3 text-center">— VLASTNÍ MĚNA A MINI-HRY —</h2>
        <h3 className="text-2xl md:text-3xl font-black uppercase tracking-tight mb-10 max-w-xl mx-auto leading-tight">
          Jomarid Coins otevírají knihy - a hrají se i mimo čtení
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div className="mb-4 text-amber-500 transition-transform group-hover:scale-110 duration-300"><Coins size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>Jomarid Coins</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Vydělávejte mince za odznáčky, denní přihlášení a hraní mini-her. V knihovně za ně rovnou kupujete přístup k jednotlivým knihám.
            </p>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div className="mb-4 text-sky-500 transition-transform group-hover:scale-110 duration-300"><ShieldCheck size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>Streak Freeze</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Zmeškaný den vás nemusí připravit o sérii. Kupte si pojistku za mince a udržte svůj čtenářský plamínek naživu.
            </p>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-5 rounded-xl border shadow-sm transition-all duration-300 hover:shadow-md group">
            <div className="mb-4 text-purple-500 transition-transform group-hover:scale-110 duration-300"><Gamepad2 size={24} /></div>
            <h4 className="text-sm font-black uppercase tracking-wider mb-2" style={{ color: 'var(--text-body)' }}>Mini-hry</h4>
            <p className="text-xs font-medium leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Odskočte si od čtení do herní sekce. Za pouhé zahrání si navíc jednou denně připíšete bonusové Jomarid Coins.
            </p>
          </div>
        </div>
      </section>

      {/* 4. VLASTNOSTI / VÝHODY (Features) */}
      <section className="mb-24">
        <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-widest opacity-50 mb-10 text-center">— PROČ ČÍST S JOMARID BOOKS —</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
          {/* Feature 1 */}
          <div style={{ borderColor: 'var(--border-color)' }} className="space-y-3 p-5 rounded-xl border border-transparent hover:bg-neutral-500/5 transition-all duration-300 group">
            <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:rotate-6">
              <Zap size={20} />
            </div>
            <h3 style={{ color: 'var(--text-body)' }} className="text-sm font-black uppercase tracking-wider">Bleskové Cloud-to-Screen</h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium leading-relaxed">
              Žádné stahování těžkých PDF nebo EPUB souborů. Naše technologie renderuje texty přímo ze šifrovaného cloudu do vašeho prohlížeče v reálnét čase.
            </p>
          </div>

          {/* Feature 2 */}
          <div style={{ borderColor: 'var(--border-color)' }} className="space-y-3 p-5 rounded-xl border border-transparent hover:bg-neutral-500/5 transition-all duration-300 group">
            <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:rotate-6">
              <ShieldCheck size={20} />
            </div>
            <h3 style={{ color: 'var(--text-body)' }} className="text-sm font-black uppercase tracking-wider">Privátní kurátorovaný fond</h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium leading-relaxed">
              Nejsme masová knihovna plná balastu. Zaměřujeme se výhradně na prémiové edice, odborné texty a exkluzivní edice, které jinde nenajdete.
            </p>
          </div>

          {/* Feature 3 */}
          <div style={{ borderColor: 'var(--border-color)' }} className="space-y-3 p-5 rounded-xl border border-transparent hover:bg-neutral-500/5 transition-all duration-300 group">
            <div style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-10 h-10 rounded-lg flex items-center justify-center transition-transform group-hover:rotate-6">
              <Sparkles size={20} />
            </div>
            <h3 style={{ color: 'var(--text-body)' }} className="text-sm font-black uppercase tracking-wider">Čisté prostředí bez reklam</h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium leading-relaxed">
              Vaše soustředění je pro nás prioritou. Rozhraní čítárny je absolutně minimalistické, bez rušivých prvků, sociálních sítí či otravných bannerů.
            </p>
          </div>
        </div>
      </section>

      {/* 5. ČASTO KLADENÉ OTÁZKY (FAQ) */}
      <section className="max-w-2xl mx-auto mb-24">
        <h2 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-widest opacity-50 mb-8 text-center">— ČASTO KLADENÉ OTÁZKY —</h2>
        
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 rounded-xl border shadow-sm">
          <div className="opacity-95 space-y-2">
            <FaqItem 
              question="Jak funguje systém gamifikace a získávání odznaků?" 
              answer="Aplikace na pozadí plně monitoruje vaši čtenářskou aktivitu. Kdykoliv přečtete kapitolu, udržíte denní sérii (streak) nebo splníte měsíční cíl, automaticky se vyhodnotí splnění podmínek. V profilu čtenáře pak okamžitě uvidíte nově odemčené barevné trofeje z celkové sbírky 80 jedinečných odznaků." 
            />
            <FaqItem 
              question="Jak získám přístup ke konkrétním knihám?" 
              answer="V knihovně vidíte celý katalog i knihy, které ještě nevlastníte. Klikem na knihu otevřete její detail s popisem, hodnocením a komentáři - a rovnou si ji tam koupíte za Jomarid Coins, které si mezitím vyděláte čtením, plněním odznáčků nebo hraním mini-her. Přístup se odemkne okamžitě." 
            />
            <FaqItem 
              question="Musím něco stahovat nebo instalovat?" 
              answer="Vůbec nic. Jomarid Books funguje kompletně ve vašem webovém prohlížeči (na počítači, tabletu i telefonu). Kód je optimalizovaný pro maximální rychlost a minimální spotřebu dat." 
            />
            <FaqItem 
              question="Pamatuje si systém, kde jsem přestal číst?" 
              answer="Ano. Naše cloudová architektura ukládá vaši přesnou pozici v otevřené knize, takže můžete plynule navázat na mobilu přesně tam, kde jste na počítači skončili." 
            />
            <FaqItem 
              question="Kolik stojí zřízení a vedení účtu?" 
              answer="Vytvoření profilu a přístup do základního rozhraní čítárny je kompletně zdarma. Přidělování specifických licencí podléhá interním pravidlům fondu Jomarid Books." 
            />
          </div>
        </div>
      </section>

      {/* 6. FINÁLNÍ CTA SEKCE */}
      <section style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className="rounded-2xl p-8 md:p-12 mb-16 text-center shadow-xl relative overflow-hidden group">
        <div style={{ backgroundColor: 'var(--bg-primary)' }} className="absolute -right-10 -top-10 w-40 h-40 opacity-10 rounded-full blur-2xl transition-all group-hover:scale-110 duration-500"></div>
        
        <h3 style={{ color: 'var(--bg-card)' }} className="text-2xl md:text-3xl font-black uppercase tracking-tight mb-3">Začněte číst ještě dnes</h3>
        <p style={{ color: 'var(--bg-body)' }} className="text-xs md:text-sm font-medium max-w-lg mx-auto mb-6 opacity-80">
          Vstupte do zabezpečeného literárního ekosystému a objevte digitální komfort nové generace doprovázený herními odměnami.
        </p>
        <div className="max-w-xs mx-auto relative z-10">
          <button 
            onClick={() => navigate('/app')}
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            className="w-full py-3 border-none font-black uppercase text-xs tracking-wider rounded-lg shadow-md cursor-pointer hover:opacity-95 hover:scale-[1.03] active:scale-[0.99] transition-all duration-200"
          >
            Spustit aplikaci
          </button>
        </div>
      </section>

      {/* 7. MODERNÍ KOMPLETNÍ PATIČKA */}
      <footer style={{ borderColor: 'var(--border-color)' }} className="mt-20 pt-8 border-t opacity-70 flex flex-col sm:flex-row items-center justify-between text-[11px] font-black uppercase tracking-wider gap-4">
        <div style={{ color: 'var(--text-muted)' }} className="flex flex-col sm:flex-row items-center gap-1 sm:gap-4">
          <span>© {new Date().getFullYear()} Jomarid Books Ltd.</span>
          <span className="hidden sm:inline opacity-30">|</span>
          <span className="font-medium normal-case opacity-70">Verze platformy v2.5 (Stable Core + Gamification)</span>
        </div>
        <div className="flex items-center gap-3">
          <a href="mailto:wwsigmamango@gmail.com" style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="flex items-center gap-2 no-underline hover:opacity-85 px-3 py-1.5 rounded-md transition-all shadow-xs">
            <Phone size={10} /> Podpora: wwsigmamango@gmail.com
          </a>
        </div>
      </footer>

    </div>
  );
};

