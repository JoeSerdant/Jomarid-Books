import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BarChart3, BookOpen, Check, Coins, Eye, EyeOff, Feather, Gift, Heart, Loader2, MessageSquare, Pencil,
  PlusCircle, Search, ShieldCheck, Star, Trash2, TrendingDown, TrendingUp, Users, Wallet, X,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------
const nf = new Intl.NumberFormat('cs-CZ');
const fmt = (n) => nf.format(Math.round(Number(n) || 0));
const plural = (n, one, few, many) => { const a = Math.abs(Number(n) || 0); return a === 1 ? one : a >= 2 && a <= 4 ? few : many; };
const coinsText = (n) => `${fmt(n)} ${plural(n, 'coin', 'coiny', 'coinů')}`;
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('cs-CZ') : '—');

const RPC_ERRORS = {
  forbidden: 'K téhle akci potřebuješ nakladatelský účet.',
  book_not_found: 'Kniha nebyla nalezena (nebo není tvoje).',
  book_has_readers: 'Knihu už mají čtenáři, takže ji nejde smazat. Stáhni ji z prodeje - kdo ji vlastní, čte ji dál.',
};
const errText = (err, fallback = 'Akce se nezdařila.') => {
  const m = String(err?.message || '');
  for (const [key, text] of Object.entries(RPC_ERRORS)) if (m.includes(key)) return text;
  return m || fallback;
};
const isMissingRpc = (err) => !!err && (err.code === 'PGRST202' || /could not find the function|does not exist/i.test(String(err.message || '')));

const PERIODS = [{ v: 7, l: '7 dní' }, { v: 30, l: '30 dní' }, { v: 90, l: '90 dní' }, { v: 365, l: 'Rok' }];

const SORTS = {
  newest: { label: 'Nejnovější', fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  earned: { label: 'Nejvíc vydělané', fn: (a, b) => b.earned - a.earned },
  sales: { label: 'Nejvíc prodané', fn: (a, b) => b.sales - a.sales },
  readers: { label: 'Nejvíc čtenářů', fn: (a, b) => b.readers - a.readers },
  rating: { label: 'Nejlépe hodnocené', fn: (a, b) => (b.avg_rating - a.avg_rating) || (b.ratings - a.ratings) },
  price: { label: 'Nejdražší', fn: (a, b) => b.price - a.price },
  title: { label: 'Podle názvu', fn: (a, b) => a.title.localeCompare(b.title, 'cs') },
};

const STATUS_FILTERS = { all: 'Všechny', public: 'Zveřejněné', hidden: 'Skryté', free: 'Zdarma' };

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
      {onClose && <button type="button" onClick={onClose} aria-label="Zavřít zprávu" className="bg-transparent border-none cursor-pointer text-current opacity-70 hover:opacity-100 p-0 shrink-0"><X size={14} /></button>}
    </div>
  );
};

const Delta = ({ current, previous }) => {
  if (!previous && !current) return <span style={mutedStyle} className="text-[10px] font-bold">beze změny</span>;
  if (!previous) return <span className="text-[10px] font-black text-emerald-500 flex items-center gap-0.5"><TrendingUp size={11} /> nové</span>;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return <span style={mutedStyle} className="text-[10px] font-bold">stejně jako předtím</span>;
  const up = change > 0;
  return (
    <span className={`text-[10px] font-black flex items-center gap-0.5 ${up ? 'text-emerald-500' : 'text-red-500'}`}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />} {up ? '+' : ''}{change} % oproti předchozímu období
    </span>
  );
};

const Kpi = ({ icon: Icon, label, value, sub, children, testId }) => (
  <Card className="flex flex-col gap-1.5 min-w-0" data-testid={testId}>
    <div className="flex items-center gap-2">
      <span style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--bg-primary)' }} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"><Icon size={16} /></span>
      <p style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider m-0 opacity-70 leading-tight">{label}</p>
    </div>
    <p className="text-2xl font-black m-0 leading-none tabular-nums break-words">{value}</p>
    {sub && <p style={mutedStyle} className="text-[11px] m-0 opacity-80 leading-snug">{sub}</p>}
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
          className="px-3 py-1.5 rounded-lg border text-[11px] font-black uppercase tracking-wide cursor-pointer">{l}</button>
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
      <p aria-live="polite" style={mutedStyle} className="text-[11px] font-bold m-0 mb-2 min-h-[16px]">
        {p ? `${fmtDay(p.day)}: ${fmt(p.sales)} ${plural(p.sales, 'prodej', 'prodeje', 'prodejů')}, ${coinsText(p.coins)}`
          : total > 0 ? `Za celé období: ${fmt(sales)} ${plural(sales, 'prodej', 'prodeje', 'prodejů')}, ${coinsText(total)}. Dotkni se grafu nebo po něm přejeď prstem pro detail dne.`
            : 'V tomhle období zatím žádný prodej.'}
      </p>
      <div role="group" tabIndex={0} aria-label="Graf výdělku po dnech, šipkami vlevo a vpravo vybereš den" onKeyDown={onKeyDown}
        onPointerDown={onPointer} onPointerMove={onPointer} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setPicked(null); }}
        style={{ height, touchAction: 'pan-y' }} className="flex items-end gap-px w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-1 select-none cursor-crosshair">
        {daily.map((d, i) => (
          <div key={d.day} data-testid="chart-bar" data-idx={i} className="flex-1 min-w-0 h-full flex items-end">
            <div style={{ height: `${d.coins > 0 ? Math.max(6, (100 * d.coins) / max) : 2}%`, backgroundColor: d.coins > 0 ? 'var(--bg-primary)' : 'var(--border-color)', opacity: picked != null && picked !== i ? 0.45 : 1 }}
              className="w-full rounded-t-sm" />
          </div>
        ))}
      </div>
      <div style={mutedStyle} className="flex justify-between text-[10px] font-bold mt-1 opacity-70">
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
  return <span style={style} className="text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap">{children}</span>;
};

const MiniStat = ({ label, value }) => (
  <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="rounded-lg px-2.5 py-2 min-w-0">
    <p style={mutedStyle} className="text-[9px] font-black uppercase tracking-wider m-0 opacity-70 truncate">{label}</p>
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
          {book.hidden ? <Badge tone="warn">Skrytá</Badge> : <Badge tone="good">Zveřejněná</Badge>}
          <Badge>{book.price > 0 ? coinsText(book.price) : 'Zdarma'}</Badge>
          <Badge>vydáno {fmtDate(book.created_at)}</Badge>
          {(book.genres || []).slice(0, 3).map(g => <Badge key={g}>{g}</Badge>)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" onClick={() => onDetail(book)} aria-label={`Detail a statistiky: ${book.title}`} title="Detail a statistiky" style={ghostBtn}
          className="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center"><BarChart3 size={15} /></button>
        <button type="button" onClick={() => onEdit(book)} aria-label={`Upravit: ${book.title}`} title="Upravit text, cenu, žánry, popis" style={ghostBtn}
          className="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center"><Pencil size={15} /></button>
        <button type="button" onClick={() => onToggleHidden(book)} disabled={busy} aria-label={book.hidden ? `Zveřejnit: ${book.title}` : `Stáhnout z prodeje: ${book.title}`}
          title={book.hidden ? 'Zveřejnit znovu' : 'Stáhnout z prodeje'} style={ghostBtn}
          className="w-9 h-9 rounded-lg border cursor-pointer flex items-center justify-center disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : book.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      </div>
    </div>
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
      <MiniStat label="Prodeje" value={fmt(book.sales)} />
      <MiniStat label="Vyděláno" value={fmt(book.earned)} />
      <MiniStat label="Čtenáři" value={fmt(book.readers)} />
      <MiniStat label="Dočetlo" value={book.readers > 0 ? `${pct(book.completed, book.readers)} %` : '—'} />
      <MiniStat label="Hodnocení" value={book.ratings > 0 ? `${Number(book.avg_rating).toFixed(1)} ★` : '—'} />
      <MiniStat label="Lajky" value={fmt(book.likes)} />
    </div>
    {book.sales_legacy > 0 && (
      <p style={mutedStyle} className="text-[11px] m-0 opacity-80">Z {fmt(book.sales)} prodejů je {fmt(book.sales_legacy)} starších (z doby před výplatami), za které coiny nepřišly.</p>
    )}
  </Card>
);

// ---------------------------------------------------------------------------
// Detail knihy (okno): statistiky + správa
// ---------------------------------------------------------------------------
const PROGRESS_LABELS = [
  ['not_started', 'Nezačali'], ['p1_24', '1-24 %'], ['p25_49', '25-49 %'], ['p50_74', '50-74 %'], ['p75_99', '75-99 %'], ['finished', 'Dočetli'],
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
      if (err) setError(errText(err, 'Detail se nepodařilo načíst.')); else setDetail(data);
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
    if (err) { onNotice('error', errText(err, 'Cenu se nepodařilo uložit.')); return; }
    onNotice('success', `Cena knihy „${book.title}“ je teď ${newPrice > 0 ? coinsText(newPrice) : 'zdarma'}. Platí pro další nákupy; kdo už knihu má, nic nedoplácí.`);
    await onChanged();
  };

  const toggleHidden = async () => {
    setBusy(true);
    const { error: err } = await supabase.rpc('publisher_set_book_hidden', { p_book: book.id, p_hidden: !book.hidden });
    setBusy(false);
    if (err) { onNotice('error', errText(err)); return; }
    onNotice('success', book.hidden ? `Kniha „${book.title}“ je znovu v prodeji.` : `Kniha „${book.title}“ je stažená z prodeje. Kdo ji už vlastní, čte ji dál.`);
    await onChanged();
  };

  const remove = async () => {
    setBusy(true);
    const { error: err } = await supabase.rpc('publisher_delete_book', { p_book: book.id });
    setBusy(false);
    if (err) { onNotice('error', errText(err)); return; }
    onNotice('success', `Kniha „${book.title}“ byla smazána.`);
    await onChanged();
    onClose();
  };

  const progressTotal = detail ? PROGRESS_LABELS.reduce((s, [k]) => s + (detail.progress?.[k] || 0), 0) : 0;
  const ratingTotal = detail ? [1, 2, 3, 4, 5].reduce((s, k) => s + (detail.rating_distribution?.[k] || 0), 0) : 0;

  return (
    <div className="fixed inset-0 z-[120] flex justify-center items-end sm:items-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Detail knihy ${book.title}`} onClick={(e) => e.stopPropagation()}
        style={{ ...cardStyle, color: 'var(--text-body)' }}
        className="border w-full sm:max-w-2xl max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div style={{ ...cardStyle, borderWidth: '0 0 1px 0' }} className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b">
          <div className="min-w-0">
            <h3 className="text-base font-black uppercase tracking-tight m-0 break-words">{book.title}</h3>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {book.hidden ? <Badge tone="warn">Skrytá</Badge> : <Badge tone="good">Zveřejněná</Badge>}
              <Badge>{book.price > 0 ? coinsText(book.price) : 'Zdarma'}</Badge>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Zavřít detail" className="bg-transparent border-none cursor-pointer text-current opacity-60 hover:opacity-100 p-1 shrink-0"><X size={20} /></button>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Prodeje celkem" value={fmt(book.sales)} />
            <MiniStat label="Vyděláno celkem" value={coinsText(book.earned)} />
            <MiniStat label="Čtenáři s licencí" value={fmt(book.readers)} />
            <MiniStat label="Dočetlo" value={book.readers > 0 ? `${fmt(book.completed)} (${pct(book.completed, book.readers)} %)` : '—'} />
            <MiniStat label="Začalo číst" value={fmt(book.started)} />
            <MiniStat label="Průměrný postup" value={book.started > 0 ? `${Math.round(book.avg_progress)} %` : '—'} />
            <MiniStat label="Komentáře" value={fmt(book.comments)} />
            <MiniStat label="Záložky / zvýraznění" value={`${fmt(book.bookmarks)} / ${fmt(book.highlights)}`} />
          </div>
          {book.gifted > 0 && <p style={mutedStyle} className="text-xs m-0">Z čtenářů je {fmt(book.gifted)} {plural(book.gifted, 'dostal', 'dostali', 'dostalo')} knihu darem (bez platby).</p>}
          {book.sales_legacy > 0 && <Notice>Starších prodejů bez výplaty: {fmt(book.sales_legacy)}. Tyhle nákupy proběhly dřív, než se autorům začaly vyplácet coiny, proto nejsou v grafu ani ve výdělku.</Notice>}

          {error && <Notice type="error">{error}</Notice>}
          {!detail && !error && <p style={mutedStyle} className="text-xs font-bold flex items-center gap-2 m-0"><Loader2 size={14} className="animate-spin" /> Načítám statistiky...</p>}

          {detail && (
            <>
              <section className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider m-0">Prodeje za posledních {detail.days} dní</h4>
                <DailyChart daily={detail.daily} height={110} testId="detail-chart" />
                <p style={mutedStyle} className="text-[11px] m-0 opacity-80">
                  První výplata: {fmtDate(detail.first_sale_at)} · poslední: {fmtDate(detail.last_sale_at)}
                </p>
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider m-0">Kde čtenáři končí</h4>
                {progressTotal === 0 ? <p style={mutedStyle} className="text-xs m-0">Zatím nemá knihu nikdo kromě tebe.</p>
                  : PROGRESS_LABELS.map(([k, l]) => <BarRow key={k} label={l} value={detail.progress?.[k] || 0} total={progressTotal} tone={k === 'finished' ? '#10b981' : undefined} />)}
              </section>

              <section className="space-y-2">
                <h4 className="text-xs font-black uppercase tracking-wider m-0 flex items-center gap-1.5">Hodnocení {book.ratings > 0 && <span style={mutedStyle} className="font-bold normal-case">Ø {Number(book.avg_rating).toFixed(2)} ★ z {fmt(book.ratings)}</span>}</h4>
                {ratingTotal === 0 ? <p style={mutedStyle} className="text-xs m-0">Zatím bez hodnocení.</p>
                  : [5, 4, 3, 2, 1].map(k => <BarRow key={k} label={`${k} ${'★'.repeat(k)}`} value={detail.rating_distribution?.[k] || 0} total={ratingTotal} tone="#f59e0b" />)}
              </section>
            </>
          )}

          <section style={{ borderColor: 'var(--border-color)' }} className="border-t pt-4 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-wider m-0">Správa knihy</h4>

            <div className="space-y-1.5">
              <label htmlFor="price-input" style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider block opacity-80">Cena (coiny)</label>
              <div className="flex gap-2">
                <input id="price-input" type="number" min={0} max={100000} value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={inputStyle}
                  className="w-32 p-2.5 border rounded-lg text-sm font-bold outline-none" />
                <button type="button" onClick={savePrice} disabled={!priceChanged || savingPrice} style={primaryBtn}
                  className="px-4 rounded-lg border-none font-black uppercase text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                  {savingPrice ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Uložit cenu
                </button>
              </div>
              <p style={mutedStyle} className="text-[11px] m-0 opacity-80">Nová cena platí pro další nákupy. Kdo už knihu má, nic nedoplácí ani nedostává zpět.</p>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold m-0">{book.hidden ? 'Kniha je skrytá' : 'Kniha je v prodeji'}</p>
                <p style={mutedStyle} className="text-[11px] m-0 mt-0.5 opacity-80">
                  {book.hidden ? 'Nové čtenáře se v katalogu neukazuje a nejde koupit. Kdo ji vlastní, čte ji dál.' : 'Stažení z prodeje je vratné: kniha zmizí z katalogu, ale kdo ji vlastní, čte ji dál.'}
                </p>
              </div>
              <button type="button" onClick={toggleHidden} disabled={busy} style={ghostBtn}
                className="shrink-0 px-3 py-2 rounded-lg border font-black uppercase text-[11px] cursor-pointer flex items-center gap-1.5 disabled:opacity-50">
                {book.hidden ? <><Eye size={13} /> Zveřejnit</> : <><EyeOff size={13} /> Stáhnout z prodeje</>}
              </button>
            </div>

            <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
              <p className="text-sm font-black m-0 text-red-500 flex items-center gap-1.5"><Trash2 size={14} /> Smazat knihu</p>
              {book.readers > 0 ? (
                <p style={mutedStyle} className="text-xs m-0 leading-relaxed">Knihu už má {fmt(book.readers)} {plural(book.readers, 'čtenář', 'čtenáři', 'čtenářů')}, takže ji nejde smazat (přišli by o ni). Stáhni ji z prodeje.</p>
              ) : (
                <>
                  <p style={mutedStyle} className="text-xs m-0 leading-relaxed">Smazání je nevratné - zmizí text, hodnocení, lajky i komentáře. Pro potvrzení opiš přesný název knihy.</p>
                  <input type="text" aria-label="Potvrzení názvem knihy" placeholder={book.title} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} style={inputStyle}
                    className="w-full p-2.5 border rounded-lg text-sm font-bold outline-none" />
                  <button type="button" onClick={remove} disabled={busy || confirmText.trim() !== book.title.trim()}
                    style={{ backgroundColor: '#dc2626', color: '#fff' }}
                    className="px-4 py-2 rounded-lg border-none font-black uppercase text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Smazat natrvalo</button>
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
  { id: 'overview', label: 'Přehled', icon: BarChart3 },
  { id: 'books', label: 'Moje knihy', icon: BookOpen },
  { id: 'editor', label: 'Vydat / upravit', icon: PlusCircle },
  { id: 'licenses', label: 'Licence a profil', icon: Gift },
];

export const PublisherDashboard = () => {
  const { user } = useAuth();
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
  const [priceCoins, setPriceCoins] = useState(150);
  const [genresInput, setGenresInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [editingBookId, setEditingBookId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // darování licence
  const [grantBookId, setGrantBookId] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [granting, setGranting] = useState(false);

  // krycí jméno
  const [penName, setPenName] = useState('');
  const [penNameInput, setPenNameInput] = useState('');
  const [savingPenName, setSavingPenName] = useState(false);
  const [penNameError, setPenNameError] = useState('');

  const getUsername = useCallback((email) => (email ? email.split('@')[0] : ''), []);

  const showNotice = useCallback((type, text) => setNotice({ type, text, id: Date.now() }), []);
  useEffect(() => {
    if (!notice || notice.type === 'error') return undefined;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    const { data: d, error } = await supabase.rpc('publisher_dashboard', { p_days: days });
    if (error) setLoadError(isMissingRpc(error) ? 'MISSING' : errText(error, 'Statistiky se nepodařilo načíst.'));
    else { setData(d); setLoadError(''); }
    setLoading(false);
  }, [user, days]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prof, error } = await supabase.from('profiles').select('pen_name').eq('id', user.id).maybeSingle();
      if (!error && prof) { setPenName(prof.pen_name || ''); setPenNameInput(prof.pen_name || ''); }
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

  const topBooks = useMemo(() => [...books].filter(b => b.earned_period > 0).sort((a, b) => b.earned_period - a.earned_period).slice(0, 5), [books]);

  // ---- správa knih ----
  const toggleHidden = async (book) => {
    setBusyBookId(book.id);
    const { error } = await supabase.rpc('publisher_set_book_hidden', { p_book: book.id, p_hidden: !book.hidden });
    setBusyBookId(null);
    if (error) { showNotice('error', errText(error)); return; }
    showNotice('success', book.hidden ? `Kniha „${book.title}“ je znovu v prodeji.` : `Kniha „${book.title}“ je stažená z prodeje. Kdo ji už vlastní, čte ji dál.`);
    await loadDashboard();
  };

  const resetForm = () => {
    setEditingBookId(null); setTitle(''); setBookContent(''); setPriceCoins(150); setGenresInput(''); setDescriptionInput(''); setPublishNow(true);
  };

  const startEditBook = async (book) => {
    const [{ data: row, error }, { data: contentRow, error: contentErr }] = await Promise.all([
      supabase.from('books').select('price_coins, genres, description').eq('id', book.id).single(),
      supabase.from('book_contents').select('content').eq('book_id', book.id).maybeSingle(),
    ]);
    if (error || contentErr || !row) { showNotice('error', 'Nepodařilo se načíst knihu k úpravě.'); return; }
    setEditingBookId(book.id);
    setTitle(book.title);
    setBookContent(contentRow?.content || '');
    setPriceCoins(row.price_coins ?? 150);
    setGenresInput(Array.isArray(row.genres) ? row.genres.join(', ') : '');
    setDescriptionInput(row.description || '');
    setTab('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveBook = async (e) => {
    e.preventDefault();
    if (!title.trim() || !bookContent.trim()) { showNotice('error', 'Doplň název a text knihy.'); return; }
    setIsSubmitting(true);
    const price = Math.max(0, Math.min(100000, parseInt(priceCoins, 10) || 0));
    const genres = genresInput.split(',').map(g => g.trim()).filter(Boolean);
    try {
      if (editingBookId) {
        const { error: bookError } = await supabase.from('books')
          .update({ title: title.trim(), price_coins: price, genres, description: descriptionInput || null })
          .eq('id', editingBookId).eq('author_id', user.id);
        if (bookError) throw bookError;
        const { error: contentError } = await supabase.from('book_contents').upsert({ book_id: editingBookId, content: bookContent });
        if (contentError) throw contentError;
        showNotice('success', 'Změny v knize jsou uložené.');
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
        // is_hidden se posílá jen u konceptu, takže běžné vydání funguje i před spuštěním nejnovější migrace.
        if (!publishNow) payload.is_hidden = true;
        const { data: inserted, error: bookError } = await supabase.from('books').insert([payload]).select('id').single();
        if (bookError) throw bookError;
        const { error: contentError } = await supabase.from('book_contents').insert([{ book_id: inserted.id, content: bookContent }]);
        if (contentError) throw contentError;
        const { error: assignError } = await supabase.from('user_books').insert([{ user_id: user.id, book_id: inserted.id, status: 'active', is_read: false }]);
        if (assignError) console.warn('Kniha byla vytvořena, ale přidání do tvé knihovny selhalo:', assignError.message);
        showNotice('success', publishNow ? 'Kniha je vydaná a hned i v tvé knihovně.' : 'Kniha je uložená jako skrytá. Zveřejníš ji v Moje knihy.');
      }
      resetForm();
      await loadDashboard();
      setTab('books');
    } catch (err) {
      showNotice('error', `Chyba při ukládání: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- darování licence ----
  const grantLicense = async (e) => {
    e.preventDefault();
    if (!grantBookId || !grantEmail.trim()) { showNotice('error', 'Vyber knihu a napiš e-mail čtenáře.'); return; }
    setGranting(true);
    const { data: res, error } = await supabase.rpc('publisher_grant_license', { p_book: grantBookId, p_email: grantEmail });
    setGranting(false);
    if (error) { showNotice('error', errText(error)); return; }
    if (res?.result === 'granted') { showNotice('success', `Licence byla darována čtenáři ${grantEmail.trim()}.`); setGrantEmail(''); await loadDashboard(); }
    else if (res?.result === 'already_owned') showNotice('info', 'Tenhle čtenář už knihu má.');
    else showNotice('error', 'Čtenář s tímhle e-mailem nebyl nalezen. Zkontroluj, že je to e-mail, kterým se registroval.');
  };

  // ---- krycí jméno ----
  const handleSavePenName = async () => {
    setPenNameError(''); setSavingPenName(true);
    try {
      const { data: res, error } = await supabase.rpc('set_pen_name', { new_pen_name: penNameInput });
      if (error) throw error;
      setPenName(res?.pen_name || ''); setPenNameInput(res?.pen_name || '');
      showNotice('success', 'Krycí jméno je uložené a promítlo se do všech tvých knih.');
    } catch (err) { setPenNameError(err.message || 'Uložení selhalo.'); } finally { setSavingPenName(false); }
  };
  const handleClearPenName = async () => {
    setPenNameError(''); setSavingPenName(true);
    try {
      const { error } = await supabase.rpc('set_pen_name', { new_pen_name: null });
      if (error) throw error;
      setPenName(''); setPenNameInput('');
    } catch (err) { setPenNameError(err.message || 'Zrušení selhalo.'); } finally { setSavingPenName(false); }
  };

  const textStats = useMemo(() => {
    const t = bookContent.trim();
    const words = t ? t.split(/\s+/).length : 0;
    return { chars: bookContent.length, words, minutes: Math.max(1, Math.round(words / 200)) };
  }, [bookContent]);

  const startedBase = totals.started || 0;

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-5xl mx-auto py-8 sm:py-12 px-3 sm:px-4 space-y-5 sm:space-y-6">
      <div style={{ borderColor: 'var(--border-color)' }} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b pb-5">
        <div className="min-w-0">
          <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight m-0">Nakladatelský panel</h2>
          <p style={mutedStyle} className="text-xs font-medium mt-1 opacity-70">Prodeje, výdělek, čtenáři a správa tvých knih.</p>
        </div>
        <span style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="text-xs px-4 py-2 border rounded-xl font-bold uppercase flex items-center gap-2 max-w-full">
          <ShieldCheck size={14} style={{ color: 'var(--bg-primary)' }} className="shrink-0" />
          <span className="truncate">Vydavatel: {penName || getUsername(user?.email)}</span>
        </span>
      </div>

      {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      <nav aria-label="Sekce panelu" className="flex gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={active ? 'page' : undefined} style={active ? primaryBtn : ghostBtn}
              className="shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl border cursor-pointer text-[11px] font-black uppercase tracking-wider whitespace-nowrap">
              <Icon size={14} /> {label}
            </button>
          );
        })}
      </nav>

      {loading && <p style={mutedStyle} className="text-xs font-bold flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Načítám statistiky...</p>}

      {loadError === 'MISSING' && (
        <Notice type="error">
          Statistiky a správa knih potřebují novější databázi. Spusť v Supabase (SQL Editor) aktuální <b>full_migration.sql</b> (část R) a obnov stránku. Do té doby funguje jen vydávání a úprava knih.
        </Notice>
      )}
      {loadError && loadError !== 'MISSING' && <Notice type="error">{loadError}</Notice>}

      {/* ============================ PŘEHLED ============================ */}
      {tab === 'overview' && data && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-black uppercase tracking-tight m-0">Přehled za období</h3>
            <Pills ariaLabel="Období" options={PERIODS} value={days} onChange={setDays} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi testId="kpi-earned" icon={Coins} label="Vyděláno" value={coinsText(totals.earned_period)} sub={`celkem ${coinsText(totals.earned)}`}>
              <Delta current={totals.earned_period} previous={totals.earned_prev} />
            </Kpi>
            <Kpi testId="kpi-sales" icon={TrendingUp} label="Prodeje" value={fmt(totals.sales_period)} sub={`celkem ${fmt(totals.sales)} ${plural(totals.sales, 'prodej', 'prodeje', 'prodejů')}`}>
              <Delta current={totals.sales_period} previous={totals.sales_prev} />
            </Kpi>
            <Kpi testId="kpi-readers" icon={Users} label="Čtenáři s licencí" value={fmt(totals.readers)}
              sub={totals.gifted > 0 ? `z toho ${fmt(totals.gifted)} darem` : 'žádné darované licence'} />
            <Kpi testId="kpi-completed" icon={Check} label="Dočetlo" value={fmt(totals.completed)}
              sub={startedBase > 0 ? `z ${fmt(startedBase)} ${plural(startedBase, 'čtenáře', 'čtenářů', 'čtenářů')}, co začali číst (${pct(totals.completed, startedBase)} %)` : 'zatím nikdo nezačal'} />
            <Kpi testId="kpi-rating" icon={Star} label="Hodnocení" value={totals.ratings > 0 ? `${Number(totals.avg_rating).toFixed(1)} ★` : '—'}
              sub={totals.ratings > 0 ? `z ${fmt(totals.ratings)} ${plural(totals.ratings, 'hodnocení', 'hodnocení', 'hodnocení')}` : 'zatím bez hodnocení'} />
            <Kpi testId="kpi-likes" icon={Heart} label="Lajky" value={fmt(totals.likes)} sub={`${fmt(totals.comments)} ${plural(totals.comments, 'komentář', 'komentáře', 'komentářů')}`} />
            <Kpi testId="kpi-books" icon={BookOpen} label="Knihy" value={fmt(totals.books)} sub={totals.hidden > 0 ? `z toho ${fmt(totals.hidden)} skrytých` : 'všechny v prodeji'} />
            <Kpi testId="kpi-wallet" icon={Wallet} label="Tvůj zůstatek" value={coinsText(data.wallet?.coins)} sub={`za celou dobu získáno ${coinsText(data.wallet?.lifetime)}`} />
          </div>

          {totals.sales_legacy > 0 && (
            <Notice>
              Máš {fmt(totals.sales_legacy)} {plural(totals.sales_legacy, 'starší prodej', 'starší prodeje', 'starších prodejů')} (zaplaceno celkem asi {coinsText(totals.legacy_coins)}) z doby, kdy se autorům ještě nevyplácelo. Počítají se do prodejů, ale ne do výdělku a nejsou v grafu, protože nemají spolehlivé datum.
            </Notice>
          )}

          <Card>
            <h3 className="text-sm font-black uppercase tracking-tight m-0 mb-3 flex items-center gap-2"><Coins size={16} style={{ color: 'var(--bg-primary)' }} /> Výdělek po dnech</h3>
            <DailyChart daily={data.daily || []} testId="overview-chart" />
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <h3 className="text-sm font-black uppercase tracking-tight m-0 mb-3">Nejlépe vydělávající v období</h3>
              {topBooks.length === 0 ? <p style={mutedStyle} className="text-xs m-0">V tomhle období se nic neprodalo.</p> : (
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
              <h3 className="text-sm font-black uppercase tracking-tight m-0 mb-3">Poslední výplaty</h3>
              {(data.recent || []).length === 0 ? <p style={mutedStyle} className="text-xs m-0">Zatím nikdo nic nekoupil.</p> : (
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
              <span className="sr-only">Hledat v knihách</span>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
              <input type="search" placeholder="Hledat podle názvu..." value={query} onChange={(e) => setQuery(e.target.value)} style={inputStyle}
                className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm font-bold outline-none" />
            </label>
            <select aria-label="Filtr stavu" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle} className="p-2.5 border rounded-xl text-xs font-bold outline-none cursor-pointer">
              {Object.entries(STATUS_FILTERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Řazení" value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={inputStyle} className="p-2.5 border rounded-xl text-xs font-bold outline-none cursor-pointer">
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
          <p style={mutedStyle} className="text-[11px] font-bold m-0 opacity-70">{visibleBooks.length} z {books.length} {plural(books.length, 'knihy', 'knih', 'knih')}</p>

          {books.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-xs font-black uppercase opacity-60 m-0">Zatím jsi nevydal(a) žádnou knihu.</p>
              <button type="button" onClick={() => setTab('editor')} style={primaryBtn} className="mt-4 px-5 py-2.5 rounded-xl border-none font-black uppercase text-xs cursor-pointer">Vydat první knihu</button>
            </Card>
          ) : visibleBooks.length === 0 ? (
            <Card className="text-center py-8"><p className="text-xs font-bold opacity-60 m-0">Nic neodpovídá hledání nebo filtru.</p></Card>
          ) : (
            <div className="space-y-3">
              {visibleBooks.map(b => <BookRow key={b.id} book={b} busy={busyBookId === b.id} onDetail={(x) => setDetailBookId(x.id)} onEdit={startEditBook} onToggleHidden={toggleHidden} />)}
            </div>
          )}
        </div>
      )}

      {/* ============================ VYDAT / UPRAVIT ============================ */}
      {tab === 'editor' && (
        <Card className="max-w-2xl">
          <h3 className="font-black mb-4 text-base uppercase tracking-tight flex items-center gap-2">
            <PlusCircle size={18} style={{ color: 'var(--bg-primary)' }} /> {editingBookId ? 'Upravit knihu' : 'Vydat novou knihu'}
          </h3>
          <form onSubmit={saveBook} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="book-title" style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Název</label>
              <input id="book-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold outline-none text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="book-price" style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider pl-1 opacity-70 flex items-center gap-1"><Coins size={11} /> Cena licence (coiny)</label>
              <input id="book-price" type="number" min={0} max={100000} value={priceCoins} onChange={(e) => setPriceCoins(Math.max(0, parseInt(e.target.value, 10) || 0))} style={inputStyle} className="w-full p-3 border rounded-xl font-bold outline-none text-sm" />
              <p style={mutedStyle} className="text-[11px] m-0 pl-1 opacity-80">Z každého prodeje ti připadne cena knihy. Orientačně: krátké knihy kolem 150, střední 250-300, velké okolo 500. 0 = zdarma.</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="book-genres" style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Žánry (oddělené čárkou)</label>
              <input id="book-genres" type="text" placeholder="např. Sci-Fi, Dobrodružství" value={genresInput} onChange={(e) => setGenresInput(e.target.value)} style={inputStyle} className="w-full p-3 border rounded-xl font-bold outline-none text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="book-desc" style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Popis (zobrazí se v detailu knihy před koupí)</label>
              <textarea id="book-desc" rows={3} value={descriptionInput} onChange={(e) => setDescriptionInput(e.target.value)} placeholder="Krátký popis, co čtenáře čeká..." style={inputStyle} className="w-full p-3 border rounded-xl font-bold outline-none text-sm resize-none" />
            </div>
            <div className="space-y-1">
              <label htmlFor="book-text" style={mutedStyle} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Text knihy</label>
              <textarea id="book-text" rows={8} value={bookContent} onChange={(e) => setBookContent(e.target.value)} required
                placeholder={editingBookId ? 'Text knihy (ponech, nebo přepiš celý)...' : 'Sem vlož kompletní text knihy...'} style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold outline-none resize-y text-sm" />
              {textStats.words > 0 && <p data-testid="text-stats" style={mutedStyle} className="text-[11px] m-0 pl-1 opacity-80">{fmt(textStats.words)} slov · {fmt(textStats.chars)} znaků · čtení asi {fmt(textStats.minutes)} min</p>}
            </div>
            {!editingBookId && (
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} className="mt-1" style={{ accentColor: 'var(--bg-primary)' }} />
                <span className="text-xs font-bold leading-relaxed">Zveřejnit hned<span style={mutedStyle} className="block font-medium opacity-80">Když to odškrtneš, kniha se uloží jako skrytá (koncept) a zveřejníš ji později v Moje knihy.</span></span>
              </label>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={isSubmitting} style={primaryBtn} className="flex-1 py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : editingBookId ? <><Check size={14} /> Uložit změny</> : <><BookOpen size={14} /> {publishNow ? 'Vydat knihu' : 'Uložit jako skrytou'}</>}
              </button>
              {editingBookId && <button type="button" onClick={() => { resetForm(); setTab('books'); }} style={ghostBtn} className="px-5 py-3.5 rounded-xl border font-black uppercase text-xs cursor-pointer">Zrušit</button>}
            </div>
          </form>
        </Card>
      )}

      {/* ============================ LICENCE A PROFIL ============================ */}
      {tab === 'licenses' && (
        <div className="space-y-5 max-w-2xl">
          <Card>
            <h3 className="font-black mb-1.5 text-sm uppercase tracking-tight flex items-center gap-2"><Gift size={16} style={{ color: 'var(--bg-primary)' }} /> Darovat knihu čtenáři</h3>
            <p style={mutedStyle} className="text-xs mb-4 opacity-70">Čtenář dostane tvou knihu zdarma. Zadej e-mail, kterým se zaregistroval. Dar se nepočítá do prodejů ani do výdělku.</p>
            <form onSubmit={grantLicense} className="space-y-3">
              <select aria-label="Kniha k darování" value={grantBookId} onChange={(e) => setGrantBookId(e.target.value)} style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold text-xs outline-none cursor-pointer">
                <option value="">-- Vyber svou knihu --</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
              <input type="email" aria-label="E-mail čtenáře" placeholder="ctenar@example.cz" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} style={inputStyle} className="w-full p-3.5 border rounded-xl font-bold outline-none text-sm" />
              <button type="submit" disabled={granting} style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className="w-full py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
                {granting ? <Loader2 size={14} className="animate-spin" /> : <Gift size={14} />} Darovat licenci
              </button>
            </form>
          </Card>

          <Card>
            <h3 className="font-black mb-1.5 text-sm uppercase tracking-tight flex items-center gap-2"><Feather size={16} style={{ color: 'var(--bg-primary)' }} /> Krycí jméno</h3>
            <p style={mutedStyle} className="text-xs mb-4 opacity-70">Místo účtu {getUsername(user?.email)} se u tvých knih čtenářům zobrazuje jméno podle tvého výběru. Změna se rovnou promítne na všechny už vydané knihy.</p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input type="text" aria-label="Krycí jméno" placeholder={`Např. ${getUsername(user?.email)}`} value={penNameInput} onChange={(e) => setPenNameInput(e.target.value)} maxLength={50} style={inputStyle} className="flex-1 min-w-0 p-3 border rounded-xl font-bold outline-none text-sm" />
              <button type="button" onClick={handleSavePenName} disabled={savingPenName || penNameInput === penName} style={primaryBtn} className="px-5 py-3 rounded-xl font-black uppercase text-xs border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0">{savingPenName ? 'Ukládám...' : 'Uložit'}</button>
              {penName && <button type="button" onClick={handleClearPenName} disabled={savingPenName} style={mutedStyle} className="text-xs font-bold underline bg-transparent border-none cursor-pointer shrink-0 disabled:opacity-50">Zrušit krycí jméno</button>}
            </div>
            {penNameError && <p className="text-red-500 text-xs font-bold mt-2 m-0">{penNameError}</p>}
          </Card>
        </div>
      )}

      {detailBook && (
        <BookDetail key={detailBook.id} book={detailBook} userId={user?.id} onClose={() => setDetailBookId(null)} onChanged={loadDashboard} onNotice={showNotice} />
      )}
    </div>
  );
};
