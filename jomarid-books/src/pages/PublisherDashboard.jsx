import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { fetchBookText, saveBookText } from '../bookText/bookText';
import BookTextField from '../components/BookTextField';
import ShortsStudio from '../components/ShortsStudio';
import { usePagedList } from '../browse/usePagedList';
import { LoadMore } from '../browse/BrowseParts';
import { cleanGenres, GENRES_PER_BOOK, GENRE_MAX_LENGTH } from '../browse/libraryModel';
import { DEFAULT_BOOK_PRICE } from '../constants/economy';
import {
  BarChart3, BookOpen, Check, Coins, Eye, EyeOff, Feather, Gift, Heart, Loader2, Pencil,
  PlusCircle, Search, ShieldCheck, Star, Trash2, TrendingDown, TrendingUp, Users, Wallet, X,
} from 'lucide-react';
import { t, formatNumber, formatDate as formatDateI18n, formatDateTime as formatDateTimeI18n } from '../i18n';
import { tk } from '../i18n/mark.js';

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------
const fmt = (n) => formatNumber(Math.round(Number(n) || 0));
const coinsText = (n) => `${fmt(n)} ${t.p(n, 'coin', 'coiny', 'coinů')}`;
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
const fmtDay = (iso) => formatDateI18n(`${iso}T00:00:00`, { day: 'numeric', month: 'numeric' });
const fmtDateTime = (iso) => formatDateTimeI18n(iso, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => (iso ? formatDateI18n(iso) : '—');

const RPC_ERRORS = {
  forbidden: tk('K téhle akci potřebuješ nakladatelský účet.'),
  book_not_found: tk('Kniha nebyla nalezena (nebo není tvoje).'),
  book_has_readers: tk('Knihu už mají čtenáři, takže ji nejde smazat. Stáhni ji z prodeje - kdo ji vlastní, čte ji dál.'),
};
const errText = (err, fallback = t('Akce se nezdařila.')) => {
  const m = String(err?.message || '');
  for (const [key, text] of Object.entries(RPC_ERRORS)) if (m.includes(key)) return text;
  return m || fallback;
};
const isMissingRpc = (err) => !!err && (err.code === 'PGRST202' || /could not find the function|does not exist/i.test(String(err.message || '')));

const PERIODS = [{ v: 7, l: tk('7 dní') }, { v: 30, l: tk('30 dní') }, { v: 90, l: tk('90 dní') }, { v: 365, l: tk('Rok') }];

const SORTS = {
  newest: { label: tk('Nejnovější'), fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  earned: { label: tk('Nejvíc vydělané'), fn: (a, b) => b.earned - a.earned },
  sales: { label: tk('Nejvíc prodané'), fn: (a, b) => b.sales - a.sales },
  readers: { label: tk('Nejvíc čtenářů'), fn: (a, b) => b.readers - a.readers },
  rating: { label: tk('Nejlépe hodnocené'), fn: (a, b) => (b.avg_rating - a.avg_rating) || (b.ratings - a.ratings) },
  price: { label: tk('Nejdražší'), fn: (a, b) => b.price - a.price },
  title: { label: tk('Podle názvu'), fn: (a, b) => a.title.localeCompare(b.title, 'cs') },
};

const STATUS_FILTERS = { all: tk('Všechny'), public: tk('Zveřejněné'), hidden: tk('Skryté'), free: tk('Zdarma') };

const cardStyle = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' };
const inputStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const mutedStyle = { color: 'var(--text-muted)' };
const primaryBtn = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };
const ghostBtn = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };

// ---------------------------------------------------------------------------
// Drobné stavební prvky
// ---------------------------------------------------------------------------
const Card = ({ children, className = '', ...rest }) => (
  <div {...rest} style={cardStyle} className={`border rounded-2xl p-4 sm:p-5 shadow-sm ${className}`}>{children}</div>
);

const Notice = ({ type = 'info', children, onClose }) => {
  const colors = type === 'error' ? { backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' }
    : type === 'success' ? { backgroundColor: 'rgba(16,185,129,0.14)', color: '#10b981' }
      : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' };
  return (
    <div role={type === 'error' ? 'alert' : 'status'} style={colors} className="text-xs font-bold rounded-xl px-4 py-3 leading-relaxed flex items-start justify-between gap-3">
      <span className="min-w-0">{children}</span>
      {onClose && <button type="button" onClick={onClose} aria-label={t('Zavřít zprávu')} className="bg-transparent border-none cursor-pointer text-current opacity-70 hover:opacity-100 p-0 shrink-0"><X size={14} /></button>}
    </div>
  );
};

const Delta = ({ current, previous }) => {
  if (!previous && !current) return <span style={mutedStyle} className="text-[0.625rem] font-bold">{t('beze změny')}</span>;
  if (!previous) return <span className="text-[0.625rem] font-black text-emerald-500 flex items-center gap-0.5"><TrendingUp size={11} /> {t('nové')}</span>;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return <span style={mutedStyle} className="text-[0.625rem] font-bold">{t('stejně jako předtím')}</span>;
  const up = change > 0;
  return (
    <span className={`text-[0.625rem] font-black flex items-center gap-0.5 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {t('{change} % oproti předchozímu období', { change: `${up ? '+' : ''}${change}` })}
    </span>
  );
};

const Kpi = ({ icon: Icon, label, value, sub, children, testId }) => (
  <Card className="flex flex-col gap-1.5 min-w-0" data-testid={testId}>
    <div className="flex items-center gap-2 min-w-0">
      <span style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--bg-primary)' }} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"><Icon size={16} /></span>
      <p style={mutedStyle} className="text-[0.625rem] font-black uppercase tracking-wider m-0 opacity-70 leading-tight min-w-0 break-words">{label}</p>
    </div>
    <p className="text-2xl font-black m-0 leading-none tabular-nums break-words">{value}</p>
    {sub && <p style={mutedStyle} className="text-[0.6875rem] m-0 opacity-80 leading-snug">{sub}</p>}
    {children}
  </Card>
);

const Pills = ({ options, value, onChange, ariaLabel }) => (
  <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1 flex-wrap">
    {options.map(({ v, l }) => {
      const active = value === v;
      return (
        <button key={v} type="button" role="radio" aria-checked={active} onClick={() => onChange(v)}
          style={active ? primaryBtn : ghostBtn}
          className="px-3 py-1.5 rounded-lg border text-[0.6875rem] font-black uppercase tracking-wide cursor-pointer">{t(l)}</button>
      );
    })}
  </div>
);

const DailyChart = ({ daily, height = 150, testId }) => {
  const [picked, setPicked] = useState(null);
  const n = daily.length;
  const max = Math.max(1, ...daily.map(d => d.coins));
  const total = daily.reduce((s, d) => s + d.coins, 0);
  const sales = daily.reduce((s, d) => s + d.sales, 0);
  const p = picked != null ? daily[picked] : null;

  // Graf je JEDEN ovladatelny prvek (ne desitky tlacitek): dotyk/tazeni prstem, najeti mysi, sipky na klavesnici.
  const indexAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !n) return null;
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const onPointer = (e) => {
    if (e.type === 'pointermove' && e.pointerType !== 'mouse' && e.buttons === 0) return;
    const i = indexAt(e);
    if (i != null) setPicked(i);
  };
  const onKeyDown = (e) => {
    const map = {
      ArrowRight: () => setPicked(v => (v == null ? 0 : Math.min(n - 1, v + 1))),
      ArrowLeft: () => setPicked(v => (v == null ? n - 1 : Math.max(0, v - 1))),
      Home: () => setPicked(0), End: () => setPicked(n - 1), Escape: () => setPicked(null),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };

  return (
    <div data-testid={testId}>
      <p aria-live="polite" style={mutedStyle} className="text-[0.6875rem] font-bold m-0 mb-2 min-h-[16px]">
        {p ? t('{day}: {sales}, {coins}', { day: fmtDay(p.day), sales: t.p(p.sales, '{n} prodej', '{n} prodeje', '{n} prodejů', { n: fmt(p.sales) }), coins: coinsText(p.coins) })
          : total > 0 ? t('Za celé období: {sales}, {coins}. Dotkni se grafu nebo po něm přejeď prstem pro detail dne.', { sales: t.p(sales, '{n} prodej', '{n} prodeje', '{n} prodejů', { n: fmt(sales) }), coins: coinsText(total) })
            : t('V tomhle období zatím žádný prodej.')}
      </p>
      <div role="group" tabIndex={0} aria-label={t('Graf výdělku po dnech, šipkami vlevo a vpravo vybereš den')} onKeyDown={onKeyDown}
        onPointerDown={onPointer} onPointerMove={onPointer} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPicked(null); }}
        style={{ height, touchAction: 'pan-y' }} className="flex items-end gap-px w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-1 select-none cursor-crosshair">
        {daily.map((d, i) => (
          <div key={d.day} data-testid="chart-bar" data-idx={i} className="flex-1 min-w-0 h-full flex items-end">
            <div style={{ height: `${d.coins > 0 ? Math.max(6, (100 * d.coins) / max) : 2}%`, backgroundColor: d.coins > 0 ? 'var(--bg-primary)' : 'var(--border-color)', opacity: picked != null && picked !== i ? 0.45 : 1 }}
              className="w-full rounded-t-sm" />
          </div>
        ))}
      </div>
      <div style={mutedStyle} className="flex justify-between text-[0.625rem] font-bold mt-1 opacity-70">
        <span>{n ? fmtDay(daily[0].day) : ''}</span>
        <span>{n ? fmtDay(daily[n - 1].day) : ''}</span>
      </div>
    </div>
  );
};

const BarRow = ({ label, value, total, tone, valueLabel }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-24 sm:w-32 shrink-0 font-bold truncate" title={label}>{label}</span>
    <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex-1 min-w-0 h-3 rounded-full overflow-hidden">
      <div style={{ width: `${pct(value, total)}%`, backgroundColor: tone || 'var(--bg-primary)' }} className="h-full rounded-full" />
    </div>
    <span style={mutedStyle} className="min-w-[4.5rem] text-right font-black tabular-nums shrink-0">{valueLabel ?? `${fmt(value)} (${pct(value, total)} %)`}</span>
  </div>
);

const Badge = ({ children, tone = 'muted' }) => {
  const style = tone === 'warn' ? { backgroundColor: 'rgba(245,158,11,0.15)', color: '#d97706' }
    : tone === 'good' ? { backgroundColor: 'rgba(16,185,129,0.14)', color: '#10b981' }
      : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' };
  return <span style={style} className="text-[0.625rem] font-black uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap">{children}</span>;
};

const MiniStat = ({ label, value }) => (
  <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="rounded-lg px-2.5 py-2 min-w-0">
    <p style={mutedStyle} className="text-[0.5625rem] font-black uppercase tracking-wider m-0 opacity-70 truncate">{label}</p>
    <p className="text-sm font-black m-0 tabular-nums truncate">{value}</p>
  </div>
);

// ---------------------------------------------------------------------------
// Řádek knihy v seznamu
// ---------------------------------------------------------------------------
const BookRow = ({ book, busy, onDetail, onEdit, onToggleHidden }) => (
  <Card data-testid="book-row" className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="font-black text-sm uppercase tracking-tight m-0 break-words">{book.title}</h4>
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          {book.hidden ? <Badge tone="warn">{t('Skrytá')}</Badge> : <Badge tone="good">{t('Zveřejněná')}</Badge>}
          <Badge>{book.price > 0 ? coinsText(book.price) : t('Zdarma')}</Badge>
          <Badge>{t('vydáno {date}', { date: fmtDate(book.created_at) })}</Badge>
          {(book.genres || []).slice(0, 3).map(g => <Badge key={g}>{g}</Badge>)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={() => onDetail(book)} aria-label={t('Detail a statistiky: {title}', { title: book.title })} title={t('Detail a statistiky')} style={ghostBtn}
          className="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center"><BarChart3 size={15} /></button>
        <button type="button" onClick={() => onEdit(book)} aria-label={t('Upravit: {title}', { title: book.title })} title={t('Upravit text, cenu, žánry, popis')} style={ghostBtn}
          className="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center"><Pencil size={15} /></button>
        <button type="button" onClick={() => onToggleHidden(book)} disabled={busy} aria-label={book.hidden ? t('Zveřejnit: {title}', { title: book.title }) : t('Stáhnout z prodeje: {title}', { title: book.title })}
          title={book.hidden ? t('Zveřejnit znovu') : t('Stáhnout z prodeje')} style={ghostBtn}
          className="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : book.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      </div>
    </div>
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
      <MiniStat label={t('Prodeje')} value={fmt(book.sales)} />
      <MiniStat label={t('Vyděláno')} value={fmt(book.earned)} />
      <MiniStat label={t('Čtenáři')} value={fmt(book.readers)} />
      <MiniStat label={t('Dočetlo')} value={book.readers > 0 ? `${pct(book.completed, book.readers)} %` : '—'} />
      <MiniStat label={t('Hodnocení')} value={book.ratings > 0 ? `${Number(book.avg_rating).toFixed(1)} ★` : '—'} />
      <MiniStat label={t('Lajky')} value={fmt(book.likes)} />
    </div>
    {book.sales_legacy > 0 && (
      <p style={mutedStyle} className="text-[0.6875rem] m-0 opacity-80">{t('Z {sales} prodejů je {legacy} starších (z doby před výplatami), za které coiny nepřišly.', { sales: fmt(book.sales), legacy: fmt(book.sales_legacy) })}</p>
    )}
  </Card>
);

// ---------------------------------------------------------------------------
// Detail knihy (okno): statistiky + správa
// ---------------------------------------------------------------------------
const PROGRESS_LABELS = [
  ['not_started', tk('Nezačali')], ['p1_24', tk('1-24 %')], ['p25_49', tk('25-49 %')], ['p50_74', tk('50-74 %')], ['p75_99', tk('75-99 %')], ['finished', tk('Dočetli')],
];

const BookDetail = ({ book, onClose, onChanged, onNotice, userId }) => {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [priceInput, setPriceInput] = useState(String(book.price));
  const [savingPrice, setSavingPrice] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error: err } = await supabase.rpc('publisher_book_detail', { p_book: book.id, p_days: 90 });
      if (!alive) return;
      if (err) setError(errText(err, t('Detail se nepodařilo načíst.'))); else setDetail(data);
    })();
    return () => { alive = false; };
  }, [book.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const newPrice = Math.max(0, Math.min(100000, parseInt(priceInput, 10) || 0));
  const priceChanged = String(newPrice) !== String(book.price) && priceInput !== '';

  const savePrice = async () => {
    setSavingPrice(true);
    const { error: err } = await supabase.from('books').update({ price_coins: newPrice }).eq('id', book.id).eq('author_id', userId);
    setSavingPrice(false);
    if (err) { onNotice('error', errText(err, t('Cenu se nepodařilo uložit.'))); return; }
    onNotice('success', t('Cena knihy „{title}“ je teď {price}. Platí pro další nákupy; kdo už knihu má, nic nedoplácí.', { title: book.title, price: newPrice > 0 ? coinsText(newPrice) : t('zdarma') }));
    await onChanged();
  };

  const toggleHidden = async () => {
    setBusy(true);
    const { error: err } = await supabase.rpc('publisher_set_book_hidden', { p_book: book.id, p_hidden: !book.hidden });
    setBusy(false);
    if (err) { onNotice('error', errText(err)); return; }
    onNotice('success', book.hidden ? t('Kniha „{title}“ je znovu v prodeji.', { title: book.title }) : t('Kniha „{title}“ je stažená z prodeje. Kdo ji už vlastní, čte ji dál.', { title: book.title }));
    await onChanged();
  };

  const remove = async () => {
    setBusy(true);
    const { error: err } = await supabase.rpc('publisher_delete_book', { p_book: book.id });
    setBusy(false);
    if (err) { onNotice('error', errText(err)); return; }
    onNotice('success', t('Kniha „{title}“ byla smazána.', { title: book.title }));
    await onChanged();
    onClose();
  };

  const progressTotal = detail ? PROGRESS_LABELS.reduce((s, [k]) => s + (detail.progress?.[k] || 0), 0) : 0;
  const ratingTotal = detail ? [1, 2, 3, 4, 5].reduce((s, k) => s + (detail.rating_distribution?.[k] || 0), 0) : 0;

  return (
    <div className="fixed inset-0 z-[120] flex justify-center items-end sm:items-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('Detail knihy {title}', { title: book.title })} onClick={(e) => e.stopPropagation()}
        style={{ ...cardStyle, color: 'var(--text-body)' }}
        className="border w-full sm:max-w-2xl max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div style={{ ...cardStyle, borderWidth: '0 0 1px 0' }} className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b">
          <div className="min-w-0">
            <h3 className="text-base font-black uppercase tracking-tight m-0 break-words">{book.title}</h3>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {book.hidden ? <Badge tone="warn">{t('Skrytá')}</Badge> : <Badge tone="good">{t('Zveřejněná')}</Badge>}
              <Badge>{book.price > 0 ? coinsText(book.price) : t('Zdarma')}</Badge>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Zavřít detail')} className="bg-transparent border-none cursor-pointer text-current opacity-60 hover:opacity-100 p-1 shrink-0"><X size={20} /></button>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label={t('Prodeje celkem')} value={fmt(book.sales)} />
            <MiniStat label={t('Vyděláno celkem')} value={coinsText(book.earned)} />
            <MiniStat label={t('Čtenáři s licencí')} value={fmt(book.readers)} />
            <MiniStat label={t('Dočetlo')} value={book.readers > 0 ? `${fmt(book.completed)} (${pct(book.completed, book.readers)} %)` : '—'} />
            <MiniStat label={t('Začalo číst')} value={fmt(book.started)} />
            <MiniStat label={t('Průměrný postup')} value={book.started > 0 ? `${Math.round(book.avg_progress)} %` : '—'} />
            <MiniStat label={t('Komentáře')} value={fmt(book.comments)} />
            <MiniStat label={t('Záložky / zvýraznění')} value={`${fmt(book.bookmarks)} / ${fmt(book.highlights)}`} />
          </div>
          {book.gifted > 0 && <p style={mutedStyle} className="text-xs m-0">{t.p(book.gifted, 'Knihu dostal darem {n} čtenář (bez platby).', 'Knihu dostali darem {n} čtenáři (bez platby).', 'Knihu dostalo darem {n} čtenářů (bez platby).', { n: fmt(book.gifted) })}</p>}
          {book.sales_legacy > 0 && <Notice>{t('Starších prodejů bez výplaty: {n}. Tyhle nákupy proběhly dřív, než se autorům začaly vyplácet coiny, proto nejsou v grafu ani ve výdělku.', { n: fmt(book.sales_legacy) })}</Notice>}

          {error && <Notice type="error">{error}</Notice>}
          {!detail && !error && <p style={mutedStyle} className="text-xs font-bold flex items-center gap-2 m-0"><Loader2 size={14} className="animate-spin" /> {t('Načítám statistiky...')}</p>}

          {detail && (
            <>
              <section className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider m-0">{t('Prodeje za posledních {n} dní', { n: detail.days })}</h4>
                <DailyChart daily={detail.daily} height={110} testId="detail-chart" />
                <p style={mutedStyle} className="text-[0.6875rem] m-0 opacity-80">
                  {t('První výplata: {first} · poslední: {last}', { first: fmtDate(detail.first_sale_at), last: fmtDate(detail.last_sale_at) })}
                </p>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider m-0">{t('Kde čtenáři končí')}</h4>
                {progressTotal === 0 ? <p style={mutedStyle} className="text-xs m-0">{t('Zatím nemá knihu nikdo kromě tebe.')}</p>
                  : PROGRESS_LABELS.map(([k, l]) => <BarRow key={k} label={t(l)} value={detail.progress?.[k] || 0} total={progressTotal} tone={k === 'finished' ? '#10b981' : undefined} />)}
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider m-0 flex items-center gap-1.5">{t('Hodnocení')} {book.ratings > 0 && <span style={mutedStyle} className="font-bold normal-case">Ø {Number(book.avg_rating).toFixed(2)} ★ z {fmt(book.ratings)}</span>}</h4>
                {ratingTotal === 0 ? <p style={mutedStyle} className="text-xs m-0">{t('Zatím bez hodnocení.')}</p>
                  : [5, 4, 3, 2, 1].map(k => <BarRow key={k} label={`${k} ${'★'.repeat(k)}`} value={detail.rating_distribution?.[k] || 0} total={ratingTotal} tone="#f59e0b" />)}
              </section>
            </>
          )}

          <section style={{ borderColor: 'var(--border-color)' }} className="border-t pt-4 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-wider m-0">{t('Správa knihy')}</h4>

            <div className="space-y-1.5">
              <label htmlFor="price-input" style={mutedStyle} className="text-[0.625rem] font-black uppercase tracking-wider block opacity-80">{t('Cena (coiny)')}</label>
              <div className="flex gap-2">
                <input id="price-input" type="number" min={0} max={100000} value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={inputStyle}
                  className="w-32 p-2.5 border rounded-lg text-sm font-bold outline-none" />
                <button type="button" onClick={savePrice} disabled={!priceChanged || savingPrice} style={primaryBtn}
                  className="px-4 rounded-lg border-none font-black uppercase text-[0.6875rem] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                  {savingPrice ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t('Uložit cenu')}
                </button>
              </div>
              <p style={mutedStyle} className="text-[0.6875rem] m-0 opacity-80">{t('Nová cena platí pro další nákupy. Kdo už knihu má, nic nedoplácí ani nedostává zpět.')}</p>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold m-0">{book.hidden ? t('Kniha je skrytá') : t('Kniha je v prodeji')}</p>
                <p style={mutedStyle} className="text-[0.6875rem] m-0 mt-0.5 opacity-80">
                  {book.hidden ? t('Novým čtenářům se v katalogu neukazuje a nemohou ji koupit. Kdo ji vlastní, čte ji dál.') : t('Stažení z prodeje je vratné: kniha zmizí z katalogu, ale kdo ji vlastní, čte ji dál.')}
                </p>
              </div>
              <button type="button" onClick={toggleHidden} disabled={busy} style={ghostBtn}
                className="shrink-0 px-3 py-2 rounded-lg border font-black uppercase text-[0.6875rem] cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
                {book.hidden ? <><Eye size={13} /> {t('Zveřejnit')}</> : <><EyeOff size={13} /> {t('Stáhnout z prodeje')}</>}
              </button>
            </div>

            <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
              <p className="text-sm font-black m-0 text-red-500 flex items-center gap-1.5"><Trash2 size={14} /> {t('Smazat knihu')}</p>
              {book.readers > 0 ? (
                <p style={mutedStyle} className="text-xs m-0 leading-relaxed">{t.p(book.readers, 'Knihu už má {n} čtenář, takže ji nejde smazat (přišel by o ni). Stáhni ji z prodeje.', 'Knihu už mají {n} čtenáři, takže ji nejde smazat (přišli by o ni). Stáhni ji z prodeje.', 'Knihu už má {n} čtenářů, takže ji nejde smazat (přišli by o ni). Stáhni ji z prodeje.', { n: fmt(book.readers) })}</p>
              ) : (
                <>
                  <p style={mutedStyle} className="text-xs m-0 leading-relaxed">{t('Smazání je nevratné - zmizí text, hodnocení, lajky i komentáře. Pro potvrzení opiš přesný název knihy.')}</p>
                  <input type="text" aria-label={t('Potvrzení názvem knihy')} placeholder={book.title} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} style={inputStyle}
                    className="w-full p-2.5 border rounded-lg text-sm font-bold outline-none" />
                  <button type="button" onClick={remove} disabled={busy || confirmText.trim() !== book.title.trim()}
                    style={{ backgroundColor: '#dc2626', color: '#fff' }}
                    className="px-4 py-2 rounded-lg border-none font-black uppercase text-[0.6875rem] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('Smazat natrvalo')}</button>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Hlavní panel
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'overview', label: tk('Přehled'), icon: BarChart3 },
  { id: 'books', label: tk('Moje knihy'), icon: BookOpen },
  { id: 'editor', label: tk('Vydat / upravit'), icon: PlusCircle },
  { id: 'shorts', label: tk('shortB'), icon: Feather },
  { id: 'licenses', label: tk('Licence a profil'), icon: Gift },
];

export const PublisherDashboard = () => {
  const { user, username: accountName } = useAuth();
  const [tab, setTab] = useState('overview');
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('newest');
  const [detailBookId, setDetailBookId] = useState(null);
  const [busyBookId, setBusyBookId] = useState(null);

  // formulář knihy
  const [title, setTitle] = useState('');
  const [bookContent, setBookContent] = useState('');
  const [priceCoins, setPriceCoins] = useState(DEFAULT_BOOK_PRICE);
  const [genresInput, setGenresInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [editingBookId, setEditingBookId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // darování licence
  const [grantBookId, setGrantBookId] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [granting, setGranting] = useState(false);

  // krycí jméno (jen ke čtení - mění se v Nastavení -> Profil)
  const [penName, setPenName] = useState('');

  const getUsername = useCallback((email) => accountName || (email ? email.split('@')[0] : ''), [accountName]);

  const showNotice = useCallback((type, text) => setNotice({ type, text, id: Date.now() }), []);
  useEffect(() => {
    if (!notice || notice.type === 'error') return undefined;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    const { data: d, error } = await supabase.rpc('publisher_dashboard', { p_days: days });
    if (error) setLoadError(isMissingRpc(error) ? 'MISSING' : errText(error, t('Statistiky se nepodařilo načíst.')));
    else { setData(d); setLoadError(''); }
    setLoading(false);
  }, [user, days]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prof, error } = await supabase.from('profiles').select('pen_name').eq('id', user.id).maybeSingle();
      if (!error && prof) setPenName(prof.pen_name || '');
    })();
  }, [user]);

  const books = useMemo(() => data?.books || [], [data]);
  const totals = data?.totals || {};
  const detailBook = books.find(b => b.id === detailBookId) || null;

  const visibleBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books
      .filter(b => (q ? b.title.toLowerCase().includes(q) : true))
      .filter(b => (statusFilter === 'public' ? !b.hidden : statusFilter === 'hidden' ? b.hidden : statusFilter === 'free' ? b.price === 0 : true))
      .sort(SORTS[sortKey].fn);
  }, [books, query, statusFilter, sortKey]);
  // Řádky knih jsou vysoké (statistiky), proto se ukazují po dvaceti a další přibývají při doscrollování.
  const pagedBooks = usePagedList(visibleBooks, { pageSize: 20, resetKey: `${query}|${statusFilter}|${sortKey}` });

  const topBooks = useMemo(() => [...books].filter(b => b.earned_period > 0).sort((a, b) => b.earned_period - a.earned_period).slice(0, 5), [books]);

  // ---- správa knih ----
  const toggleHidden = async (book) => {
    setBusyBookId(book.id);
    const { error } = await supabase.rpc('publisher_set_book_hidden', { p_book: book.id, p_hidden: !book.hidden });
    setBusyBookId(null);
    if (error) { showNotice('error', errText(error)); return; }
    showNotice('success', book.hidden ? t('Kniha „{title}“ je znovu v prodeji.', { title: book.title }) : t('Kniha „{title}“ je stažená z prodeje. Kdo ji už vlastní, čte ji dál.', { title: book.title }));
    await loadDashboard();
  };

  const resetForm = () => {
    setEditingBookId(null); setTitle(''); setBookContent(''); setPriceCoins(DEFAULT_BOOK_PRICE); setGenresInput(''); setDescriptionInput(''); setPublishNow(true);
  };

  const startEditBook = async (book) => {
    const [{ data: row, error }, { data: contentRow, error: contentErr }] = await Promise.all([
      supabase.from('books').select('price_coins, genres, description').eq('id', book.id).single(),
      fetchBookText(supabase, book.id).then((r) => ({ data: r, error: r.error })),
    ]);
    if (error || contentErr || !row) { showNotice('error', t('Nepodařilo se načíst knihu k úpravě.')); return; }
    setEditingBookId(book.id);
    setTitle(book.title);
    setBookContent(contentRow?.text || '');
    setPriceCoins(row.price_coins ?? DEFAULT_BOOK_PRICE);
    setGenresInput(Array.isArray(row.genres) ? row.genres.join(', ') : '');
    setDescriptionInput(row.description || '');
    setTab('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveBook = async (e) => {
    e.preventDefault();
    if (!title.trim() || !bookContent.trim()) { showNotice('error', t('Doplň název a text knihy.')); return; }
    setIsSubmitting(true);
    const price = Math.max(0, Math.min(100000, parseInt(priceCoins, 10) || 0));
    const genres = cleanGenres(genresInput.split(','));
    try {
      if (editingBookId) {
        const { error: bookError } = await supabase.from('books')
          .update({ title: title.trim(), price_coins: price, genres, description: descriptionInput || null })
          .eq('id', editingBookId).eq('author_id', user.id);
        if (bookError) throw bookError;
        const { error: contentError } = await saveBookText(supabase, editingBookId, bookContent);
        if (contentError) throw contentError;
        showNotice('success', t('Změny v knize jsou uložené.'));
      } else {
        const payload = {
          title: title.trim(),
          author: getUsername(user.email),
          author_id: user.id,
          author_display: penName || null,
          fake_likes: 0,
          // Výslovně false - nespoléhá se na výchozí hodnotu sloupce (nový svazek nesmí "zdědit" automatické přidělení).
          is_auto_assigned: false,
          price_coins: price,
          genres,
          description: descriptionInput || null,
        };
        // Koncept se vkládá rovnou jako skrytý. U vydané knihy se is_hidden neposílá a platí výchozí hodnota sloupce.
        if (!publishNow) payload.is_hidden = true;
        const { data: inserted, error: bookError } = await supabase.from('books').insert([payload]).select('id').single();
        if (bookError) throw bookError;
        const { error: contentError } = await saveBookText(supabase, inserted.id, bookContent);
        if (contentError) throw contentError;
        const { error: assignError } = await supabase.from('user_books').insert([{ user_id: user.id, book_id: inserted.id, status: 'active', is_read: false }]);
        if (assignError) console.warn('Kniha byla vytvořena, ale přidání do tvé knihovny selhalo:', assignError.message);
        showNotice('success', publishNow ? t('Kniha je vydaná a hned i v tvé knihovně.') : t('Kniha je uložená jako skrytá. Zveřejníš ji v Moje knihy.'));
      }
      resetForm();
      await loadDashboard();
      setTab('books');
    } catch (err) {
      console.error('Uložení knihy:', err);
      showNotice('error', friendlyError(err, t('Knihu se nepodařilo uložit. Zkus to znovu.')));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- darování licence ----
  const grantLicense = async (e) => {
    e.preventDefault();
    if (!grantBookId || !grantEmail.trim()) { showNotice('error', t('Vyber knihu a napiš e-mail čtenáře.')); return; }
    setGranting(true);
    const { data: res, error } = await supabase.rpc('publisher_grant_license', { p_book: grantBookId, p_email: grantEmail });
    setGranting(false);
    if (error) { showNotice('error', errText(error)); return; }
    if (res?.result === 'granted') { showNotice('success', t('Licence byla darována čtenáři {email}.', { email: grantEmail.trim() })); setGrantEmail(''); await loadDashboard(); }
    else if (res?.result === 'already_owned') showNotice('info', t('Tenhle čtenář už knihu má.'));
    else showNotice('error', t('Čtenář s tímhle e-mailem nebyl nalezen. Zkontroluj, že je to e-mail, kterým se registroval.'));
  };

  const startedBase = totals.started || 0;

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-5xl mx-auto py-8 sm:py-12 px-3 sm:px-4 space-y-5 sm:space-y-6">
      <div style={{ borderColor: 'var(--border-color)' }} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-5">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight m-0">{t('Nakladatelský panel')}</h2>
          <p style={mutedStyle} className="text-xs font-medium mt-1 opacity-70">{t('Prodeje, výdělek, čtenáři a správa tvých knih.')}</p>
        </div>
        <span style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="text-xs px-4 py-2 border rounded-xl font-bold uppercase flex items-center gap-2 max-w-full">
          <ShieldCheck size={14} style={{ color: 'var(--bg-primary)' }} className="shrink-0" />
          <span className="truncate">{t('Vydavatel: {name}', { name: penName || getUsername(user?.email) })}</span>
        </span>
      </div>

      {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <nav aria-label={t('Sekce panelu')} data-tour="publisher-tabs" className="flex gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={active ? 'page' : undefined} style={active ? primaryBtn : ghostBtn}
              className="shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider whitespace-nowrap">
              <Icon size={14} /> {t(label)}
            </button>
          );
        })}
      </nav>

      {loading && <p style={mutedStyle} className="text-xs font-bold flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('Načítám statistiky...')}</p>}

      {loadError === 'MISSING' && (
        <Notice type="error">
          {t('Statistiky a správa knih teď nejsou dostupné. Zkus stránku obnovit; vydávání a úprava knih funguje dál.')}
        </Notice>
      )}
      {loadError && loadError !== 'MISSING' && <Notice type="error">{loadError}</Notice>}

      {/* ============================ PŘEHLED ============================ */}
      {tab === 'overview' && data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-black uppercase tracking-tight m-0">{t('Přehled za období')}</h3>
            <Pills ariaLabel={t('Období')} options={PERIODS} value={days} onChange={setDays} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi testId="kpi-earned" icon={Coins} label={t('Vyděláno')} value={coinsText(totals.earned_period)} sub={`celkem ${coinsText(totals.earned)}`}>
              <Delta current={totals.earned_period} previous={totals.earned_prev} />
            </Kpi>
            <Kpi testId="kpi-sales" icon={TrendingUp} label={t('Prodeje')} value={fmt(totals.sales_period)} sub={`celkem ${fmt(totals.sales)} ${t.p(totals.sales, 'prodej', 'prodeje', 'prodejů')}`}>
              <Delta current={totals.sales_period} previous={totals.sales_prev} />
            </Kpi>
            <Kpi testId="kpi-readers" icon={Users} label={t('Čtenáři s licencí')} value={fmt(totals.readers)}
              sub={totals.gifted > 0 ? t('z toho {n} darem', { n: fmt(totals.gifted) }) : t('žádné darované licence')} />
            <Kpi testId="kpi-completed" icon={Check} label={t('Dočetlo')} value={fmt(totals.completed)}
              sub={startedBase > 0 ? t.p(startedBase, 'z {n} čtenáře, co začal číst ({pct} %)', 'z {n} čtenářů, co začali číst ({pct} %)', 'z {n} čtenářů, co začali číst ({pct} %)', { n: fmt(startedBase), pct: pct(totals.completed, startedBase) }) : t('zatím nikdo nezačal')} />
            <Kpi testId="kpi-rating" icon={Star} label={t('Hodnocení')} value={totals.ratings > 0 ? `${Number(totals.avg_rating).toFixed(1)} ★` : '—'}
              sub={totals.ratings > 0 ? t.p(totals.ratings, 'z {n} hodnocení', 'z {n} hodnocení', 'z {n} hodnocení', { n: fmt(totals.ratings) }) : t('zatím bez hodnocení')} />
            <Kpi testId="kpi-likes" icon={Heart} label={t('Lajky')} value={fmt(totals.likes)} sub={t.p(totals.comments, '{n} komentář', '{n} komentáře', '{n} komentářů', { n: fmt(totals.comments) })} />
            <Kpi testId="kpi-books" icon={BookOpen} label={t('Knihy')} value={fmt(totals.books)} sub={totals.hidden > 0 ? t('z toho {n} skrytých', { n: fmt(totals.hidden) }) : t('všechny v prodeji')} />
            <Kpi testId="kpi-wallet" icon={Wallet} label={t('Tvůj zůstatek')} value={coinsText(data.wallet?.coins)} sub={t('za celou dobu získáno {n}', { n: coinsText(data.wallet?.lifetime) })} />
          </div>

          {totals.sales_legacy > 0 && (
            <Notice>
              {t('Máš {sales} (zaplaceno celkem asi {coins}) z doby, kdy se autorům ještě nevyplácelo. Počítají se do prodejů, ale ne do výdělku a nejsou v grafu, protože nemají spolehlivé datum.', { sales: t.p(totals.sales_legacy, '{n} starší prodej', '{n} starší prodeje', '{n} starších prodejů', { n: fmt(totals.sales_legacy) }), coins: coinsText(totals.legacy_coins) })}
            </Notice>
          )}

          <Card>
            <h3 className="text-sm font-black uppercase tracking-tight m-0 mb-3 flex items-center gap-2"><Coins size={16} style={{ color: 'var(--bg-primary)' }} /> {t('Výdělek po dnech')}</h3>
            <DailyChart daily={data.daily || []} testId="overview-chart" />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <h3 className="text-sm font-black uppercase tracking-tight m-0 mb-3">{t('Nejlépe vydělávající v období')}</h3>
              {topBooks.length === 0 ? <p style={mutedStyle} className="text-xs m-0">{t('V tomhle období se nic neprodalo.')}</p> : (
                <div className="space-y-2">
                  {topBooks.map(b => (
                    <button key={b.id} type="button" onClick={() => setDetailBookId(b.id)} className="w-full text-left bg-transparent border-none cursor-pointer p-0 text-current">
                      <BarRow label={b.title} value={b.earned_period} total={Math.max(...topBooks.map(x => x.earned_period))} valueLabel={coinsText(b.earned_period)} />
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <h3 className="text-sm font-black uppercase tracking-tight m-0 mb-3">{t('Poslední výplaty')}</h3>
              {(data.recent || []).length === 0 ? <p style={mutedStyle} className="text-xs m-0">{t('Zatím nikdo nic nekoupil.')}</p> : (
                <ul className="m-0 p-0 list-none divide-y" style={{ borderColor: 'var(--border-color)' }}>
                  {data.recent.map((r, i) => (
                    <li key={`${r.at}-${i}`} style={{ borderColor: 'var(--border-color)' }} className="flex items-center justify-between gap-3 py-2 text-xs">
                      <span className="min-w-0"><b className="block truncate">{r.title}</b><span style={mutedStyle} className="opacity-70">{fmtDateTime(r.at)}</span></span>
                      <span className="font-black text-emerald-500 shrink-0 tabular-nums">+{fmt(r.coins)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ============================ MOJE KNIHY ============================ */}
      {tab === 'books' && data && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="relative flex-1 min-w-0">
              <span className="sr-only">{t('Hledat v knihách')}</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
              <input type="search" placeholder={t('Hledat podle názvu...')} value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle}
                className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm font-bold outline-none" />
            </label>
            <select aria-label={t('Filtr stavu')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle} className="p-2.5 border rounded-xl text-xs font-bold outline-none cursor-pointer">
              {Object.entries(STATUS_FILTERS).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
            <select aria-label={t('Řazení')} value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={inputStyle} className="p-2.5 border rounded-xl text-xs font-bold outline-none cursor-pointer">
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{t(s.label)}</option>)}
            </select>
          </div>
          <p style={mutedStyle} className="text-[0.6875rem] font-bold m-0 opacity-70">{visibleBooks.length} z {books.length} {t.p(books.length, 'knihy', 'knih', 'knih')}</p>

          {books.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-xs font-black uppercase opacity-60 m-0">{t('Zatím nemáš žádnou vydanou knihu.')}</p>
              <button type="button" onClick={() => setTab('editor')} style={primaryBtn} className="mt-4 px-5 py-2.5 rounded-xl border-none font-black uppercase text-xs cursor-pointer">{t('Vydat první knihu')}</button>
            </Card>
          ) : visibleBooks.length === 0 ? (
            <Card className="text-center py-8"><p className="text-xs font-bold opacity-60 m-0">{t('Nic neodpovídá hledání nebo filtru.')}</p></Card>
          ) : (
            <>
              <div className="space-y-3">
                {pagedBooks.items.map(b => <BookRow key={b.id} book={b} busy={busyBookId === b.id} onDetail={(x) => setDetailBookId(x.id)} onEdit={startEditBook} onToggleHidden={toggleHidden} />)}
              </div>
              <LoadMore paged={pagedBooks} />
            </>
          )}
        </div>
      )}

      {/* ============================ VYDAT / UPRAVIT ============================ */}
      {tab === 'editor' && (
        <Card className="max-w-4xl">
          <h3 className="font-black mb-4 text-base uppercase tracking-tight flex items-center gap-2">
            <PlusCircle size={18} style={{ color: 'var(--bg-primary)' }} /> {editingBookId ? t('Upravit knihu') : t('Vydat novou knihu')}
          </h3>
          <form onSubmit={saveBook} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="book-title" style={mutedStyle} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Název')}</label>
              <input id="book-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold outline-none text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="book-price" style={mutedStyle} className="text-[0.625rem] font-black uppercase tracking-wider pl-1 opacity-70 flex items-center gap-1"><Coins size={11} /> {t('Cena licence (coiny)')}</label>
              <input id="book-price" type="number" min={0} max={100000} value={priceCoins} onChange={(e) => setPriceCoins(Math.max(0, parseInt(e.target.value, 10) || 0))} style={inputStyle} className="w-full p-3 border rounded-xl font-bold outline-none text-sm" />
              <p style={mutedStyle} className="text-[0.6875rem] m-0 pl-1 opacity-80">{t('Z každého prodeje ti připadne cena knihy. Orientačně: krátké knihy kolem 150, střední 250-300, velké okolo 500. 0 = zdarma.')}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="book-genres" style={mutedStyle} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Žánry (oddělené čárkou)')}</label>
              <input id="book-genres" type="text" placeholder={t('např. Sci-Fi, Dobrodružství')} value={genresInput} onChange={(e) => setGenresInput(e.target.value)} style={inputStyle} className="w-full p-3 border rounded-xl font-bold outline-none text-sm" />
              <p style={mutedStyle} className="text-[0.6875rem] m-0 pl-1 opacity-80">{t('Nejvýš {genres}, každý nejvýš {chars}. Co je navíc, se při uložení zahodí.', { genres: t.p(GENRES_PER_BOOK, '{n} žánr', '{n} žánry', '{n} žánrů', { n: GENRES_PER_BOOK }), chars: t.p(GENRE_MAX_LENGTH, '{n} znak', '{n} znaky', '{n} znaků', { n: GENRE_MAX_LENGTH }) })}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="book-desc" style={mutedStyle} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Popis (zobrazí se v detailu knihy před koupí)')}</label>
              <textarea id="book-desc" rows={3} maxLength={2000} value={descriptionInput} onChange={(e) => setDescriptionInput(e.target.value)} placeholder={t('Krátký popis, co čtenáře čeká...')} style={inputStyle} className="w-full p-3 border rounded-xl font-bold outline-none text-sm resize-none" />
            </div>
            <BookTextField key={editingBookId || 'nova-kniha'} id="book-text" value={bookContent} onChange={setBookContent} required labelStyle={mutedStyle}
              placeholder={editingBookId ? t('Text knihy (ponech, nebo přepiš celý)...') : t('Sem vlož kompletní text knihy, nebo přetáhni soubor .txt / .md...')} />
            {!editingBookId && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} className="mt-1" style={{ accentColor: 'var(--bg-primary)' }} />
                <span className="text-xs font-bold leading-relaxed">{t('Zveřejnit hned')}<span style={mutedStyle} className="block font-medium opacity-80">{t('Když to odškrtneš, kniha se uloží jako skrytá (koncept) a zveřejníš ji později v Moje knihy.')}</span></span>
              </label>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={isSubmitting} style={primaryBtn} className="flex-1 py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : editingBookId ? <><Check size={14} /> {t('Uložit změny')}</> : <><BookOpen size={14} /> {publishNow ? t('Vydat knihu') : t('Uložit jako skrytou')}</>}
              </button>
              {editingBookId && <button type="button" onClick={() => { resetForm(); setTab('books'); }} style={ghostBtn} className="px-5 py-3.5 rounded-xl border font-black uppercase text-xs cursor-pointer">{t('Zrušit')}</button>}
            </div>
          </form>
        </Card>
      )}

      {/* ============================ SHORTB ============================ */}
      {tab === 'shorts' && <ShortsStudio />}

      {/* ============================ LICENCE A PROFIL ============================ */}
      {tab === 'licenses' && (
        <div className="space-y-5 max-w-2xl">
          <Card>
            <h3 className="font-black mb-1.5 text-sm uppercase tracking-tight flex items-center gap-2"><Gift size={16} style={{ color: 'var(--bg-primary)' }} /> {t('Darovat knihu čtenáři')}</h3>
            <p style={mutedStyle} className="text-xs mb-4 opacity-70">{t('Čtenář dostane tvou knihu zdarma. Zadej e-mail, kterým se zaregistroval. Dar se nepočítá do prodejů ani do výdělku.')}</p>
            <form onSubmit={grantLicense} className="space-y-3">
              <select aria-label={t('Kniha k darování')} value={grantBookId} onChange={(e) => setGrantBookId(e.target.value)} style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold text-xs outline-none cursor-pointer">
                <option value="">{t('-- Vyber svou knihu --')}</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
              <input type="email" aria-label={t('E-mail čtenáře')} placeholder={t('ctenar@example.cz')} value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold outline-none text-sm" />
              <button type="submit" disabled={granting} style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className="w-full py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                {granting ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />} {t('Darovat licenci')}
              </button>
            </form>
          </Card>

          <Card>
            <h3 className="font-black mb-1.5 text-sm uppercase tracking-tight flex items-center gap-2"><Feather size={16} style={{ color: 'var(--bg-primary)' }} /> {t('Jméno u tvých knih')}</h3>
            <p style={mutedStyle} className="text-xs mb-4 opacity-80">
              {t('Čtenářům se u tvých knih ukazuje')} <b data-testid="author-shown">{penName || getUsername(user?.email)}</b> ({penName ? t('tvoje krycí jméno') : t('tvoje uživatelské jméno')}). {t('Obojí se nastavuje v Nastavení → Profil.')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/settings/profile" style={primaryBtn} className="inline-block px-5 py-2.5 rounded-xl font-black uppercase text-xs no-underline">{t('Otevřít nastavení profilu')}</Link>
              {user?.id && <Link to={`/autor/${user.id}`} data-testid="author-page-link" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="inline-block px-5 py-2.5 rounded-xl font-black uppercase text-xs no-underline">{t('Moje stránka autora')}</Link>}
            </div>
          </Card>
        </div>
      )}

      {detailBook && (
        <BookDetail key={detailBook.id} book={detailBook} userId={user?.id} onClose={() => setDetailBookId(null)} onChanged={loadDashboard} onNotice={showNotice} />
      )}
    </div>
  );
};
