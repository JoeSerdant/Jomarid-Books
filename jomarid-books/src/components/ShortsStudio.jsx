import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Feather, Heart, Loader2, Pencil, PlusCircle, Trash2, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { plural } from '../lib/plural';
import { SHORT_LIMITS, countChars, validateShort, parseGenresInput, paginate } from '../shorts/shortsModel';
import { loadMyShorts, saveShort, setShortHidden, deleteShort } from '../shorts/shortsApi';

const nf = new Intl.NumberFormat('cs-CZ');
const fmt = (n) => nf.format(Math.round(Number(n) || 0));
const cardStyle = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' };
const inputStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const mutedStyle = { color: 'var(--text-muted)' };
const primaryBtn = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };
const ghostBtn = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const labelCls = 'text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70';
const fieldCls = 'w-full p-3 border rounded-xl font-bold outline-none text-sm';

const EMPTY_FORM = { id: null, title: '', body: '', genresText: '', seriesName: '', seriesPart: '', hidden: false, publishNow: true };

// Psaní a správa shortB (krátkých knih do 6 000 znaků). Nakladatel vidí a upravuje jen svoje, správce (all) všechny a smí je skrývat a mazat.
// Čtenáři shortB prochází na stránce /shorts; tady se píšou a sleduje se, kolik lidí je čte.
export const ShortsStudio = ({ all = false }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [form, setForm] = useState(null); // null = jen seznam
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    const res = await loadMyShorts(supabase, all);
    setItems(res.items);
    setUnavailable(res.unavailable);
    setLoading(false);
  }, [all]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const startNew = () => { setErrors({}); setNotice(null); setForm({ ...EMPTY_FORM }); };
  const startEdit = (s) => {
    setErrors({}); setNotice(null);
    setForm({ id: s.id, title: s.title, body: s.body, genresText: s.genres.join(', '), seriesName: s.seriesName || '', seriesPart: s.seriesPart ?? '', hidden: s.isHidden, publishNow: !s.isHidden });
  };
  const cancel = () => { setForm(null); setErrors({}); };

  const submit = async (e) => {
    e.preventDefault();
    const v = validateShort({ title: form.title, body: form.body, genres: parseGenresInput(form.genresText), seriesName: form.seriesName, seriesPart: form.seriesPart });
    setErrors(v.errors);
    if (!v.ok) return;
    setBusy(true);
    const res = await saveShort(supabase, { id: form.id, ...v.clean, hidden: form.id ? form.hidden : !form.publishNow });
    setBusy(false);
    if (res.error) { setNotice({ type: 'error', text: res.error }); return; }
    setNotice({ type: 'success', text: form.id ? 'Změny v shortB jsou uložené.' : form.publishNow ? 'ShortB je zveřejněný a čtenáři ho uvidí ve feedu.' : 'ShortB je uložený jako skrytý. Zveřejníš ho v seznamu.' });
    setForm(null);
    refresh();
  };

  const toggleHidden = async (s) => {
    const res = await setShortHidden(supabase, s.id, !s.isHidden);
    if (res.error) setNotice({ type: 'error', text: res.error });
    else setNotice({ type: 'success', text: s.isHidden ? 'ShortB je zase ve feedu.' : 'ShortB je skrytý, čtenáři ho nevidí.' });
    refresh();
  };

  const remove = async (s) => {
    if (!window.confirm(`Opravdu smazat shortB „${s.title}“? Smaže se i postup čtenářů u něj a jde to jen jednou.`)) return;
    const res = await deleteShort(supabase, s.id);
    if (res.error) setNotice({ type: 'error', text: res.error });
    else setNotice({ type: 'success', text: 'ShortB je smazaný.' });
    refresh();
  };

  const chars = form ? countChars(form.body) : 0;
  const over = chars > SHORT_LIMITS.body;
  const pageCount = useMemo(() => (form ? paginate(form.body).length : 0), [form]);

  if (loading) return <p style={mutedStyle} className="text-xs font-bold flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Načítám shortB...</p>;

  return (
    <div className="space-y-5 max-w-4xl" data-testid="shorts-studio">
      {notice && (
        <div role={notice.type === 'error' ? 'alert' : 'status'} data-testid="shorts-notice" style={{ color: notice.type === 'error' ? '#ef4444' : 'var(--text-body)', ...cardStyle }} className="border rounded-xl px-4 py-3 text-xs font-bold flex items-start justify-between gap-3">
          <span>{notice.text}</span>
          <button type="button" aria-label="Zavřít oznámení" onClick={() => setNotice(null)} style={{ color: 'inherit' }} className="bg-transparent border-none cursor-pointer p-0"><X size={14} /></button>
        </div>
      )}

      {unavailable && (
        <div role="alert" style={{ color: 'var(--text-body)', ...cardStyle }} className="border rounded-xl px-4 py-3 text-xs font-bold">
          ShortB zatím nejsou v databázi nastavené{all ? ' (spusť soubor db/shorts.sql v Supabase SQL Editoru)' : ', zkus to později'}.
        </div>
      )}

      {!form && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-black m-0 text-base uppercase tracking-tight flex items-center gap-2"><Feather size={18} style={{ color: 'var(--bg-primary)' }} /> {all ? 'Všechny shortB' : 'Moje shortB'}</h3>
              <p style={mutedStyle} className="text-xs m-0 mt-1 opacity-80">Krátké knihy do {fmt(SHORT_LIMITS.body)} znaků. Čtenáři je listují ve feedu: stránky do strany, po dočtení dolů na další. Bez limitu a zdarma.</p>
            </div>
            {!unavailable && <button type="button" onClick={startNew} data-testid="shorts-new" style={primaryBtn} className="px-4 py-2.5 rounded-xl border-none font-black uppercase text-xs cursor-pointer flex items-center gap-2"><PlusCircle size={14} /> Nový shortB</button>}
          </div>

          {items.length === 0 && !unavailable && (
            <div style={cardStyle} className="border rounded-2xl p-8 text-center text-xs font-bold">
              <p style={mutedStyle} className="m-0">Zatím tu nic není. Napiš první shortB.</p>
            </div>
          )}

          <ul className="list-none m-0 p-0 space-y-3" data-testid="shorts-list">
            {items.map((s) => (
              <li key={s.id} data-testid="shorts-item" style={cardStyle} className="border rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 font-black text-sm break-words">{s.title}</p>
                    <p style={mutedStyle} className="m-0 mt-0.5 text-[0.6875rem] font-bold">
                      {all && <>{s.authorName} · </>}
                      {s.seriesName ? <>{s.seriesName}, díl {s.seriesPart} · </> : null}
                      {fmt(countChars(s.body))} {plural(countChars(s.body), 'znak', 'znaky', 'znaků')}
                      {s.genres.length ? ` · ${s.genres.join(', ')}` : ''}
                    </p>
                  </div>
                  {s.isHidden && <span style={ghostBtn} className="border rounded-lg px-2 py-1 text-[0.625rem] font-black uppercase tracking-wider flex items-center gap-1"><EyeOff size={11} /> Skrytý</span>}
                </div>
                <div style={mutedStyle} className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] font-bold">
                  <span className="flex items-center gap-1"><Users size={12} /> {fmt(s.readers)} {plural(s.readers, 'čtenář', 'čtenáři', 'čtenářů')}</span>
                  <span className="flex items-center gap-1"><Check size={12} /> {fmt(s.finished)}× dočteno</span>
                  <span className="flex items-center gap-1"><Heart size={12} /> {fmt(s.likes)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEdit(s)} style={ghostBtn} className="px-3 py-2 rounded-xl border font-black uppercase text-[0.625rem] tracking-wider cursor-pointer flex items-center gap-1.5"><Pencil size={12} /> Upravit</button>
                  <button type="button" onClick={() => toggleHidden(s)} style={ghostBtn} className="px-3 py-2 rounded-xl border font-black uppercase text-[0.625rem] tracking-wider cursor-pointer flex items-center gap-1.5">
                    {s.isHidden ? <><Eye size={12} /> Zveřejnit</> : <><EyeOff size={12} /> Skrýt</>}
                  </button>
                  <button type="button" onClick={() => remove(s)} style={{ ...ghostBtn, color: '#ef4444' }} className="px-3 py-2 rounded-xl border font-black uppercase text-[0.625rem] tracking-wider cursor-pointer flex items-center gap-1.5"><Trash2 size={12} /> Smazat</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {form && (
        <form onSubmit={submit} noValidate style={cardStyle} className="border rounded-2xl p-5 space-y-4" data-testid="shorts-form">
          <h3 className="font-black m-0 text-base uppercase tracking-tight flex items-center gap-2"><Feather size={18} style={{ color: 'var(--bg-primary)' }} /> {form.id ? 'Upravit shortB' : 'Nový shortB'}</h3>

          <div className="space-y-1">
            <label htmlFor="short-title" style={mutedStyle} className={labelCls}>Název</label>
            <input id="short-title" type="text" value={form.title} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'short-title-err' : undefined} style={inputStyle} className={fieldCls} />
            {errors.title && <p id="short-title-err" role="alert" className="text-[0.6875rem] font-bold m-0 pl-1" style={{ color: '#ef4444' }}>{errors.title}</p>}
          </div>

          <div className="space-y-1">
            <label htmlFor="short-body" style={mutedStyle} className={labelCls}>Text</label>
            <textarea id="short-body" rows={14} value={form.body} onChange={(e) => set({ body: e.target.value })} aria-invalid={!!errors.body} aria-describedby="short-body-count"
              placeholder="Sem napiš nebo vlož text. Odstavce odděluj prázdným řádkem, na kartě se z nich skládají stránky."
              style={{ ...inputStyle, borderColor: over ? '#ef4444' : 'var(--border-color)' }} className={`${fieldCls} font-medium leading-relaxed resize-y`} />
            <p id="short-body-count" data-testid="shorts-count" aria-live="polite" className="text-[0.6875rem] font-bold m-0 pl-1" style={over ? { color: '#ef4444' } : mutedStyle}>
              {fmt(chars)} / {fmt(SHORT_LIMITS.body)} znaků{pageCount > 0 ? ` · ve feedu ${pageCount} ${plural(pageCount, 'stránka', 'stránky', 'stránek')}` : ''}
            </p>
            {errors.body && <p role="alert" className="text-[0.6875rem] font-bold m-0 pl-1" style={{ color: '#ef4444' }}>{errors.body}</p>}
          </div>

          <div className="space-y-1">
            <label htmlFor="short-genres" style={mutedStyle} className={labelCls}>Žánry (oddělené čárkou)</label>
            <input id="short-genres" type="text" placeholder="např. Horor, Povídka" value={form.genresText} onChange={(e) => set({ genresText: e.target.value })} style={inputStyle} className={fieldCls} />
            <p style={mutedStyle} className="text-[0.6875rem] m-0 pl-1 opacity-80">Podle žánrů se shortB nabízí čtenářům, kteří je mají rádi. Nejvýš {SHORT_LIMITS.genres} žánrů.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem] gap-3">
            <div className="space-y-1">
              <label htmlFor="short-series" style={mutedStyle} className={labelCls}>Série (nepovinné)</label>
              <input id="short-series" type="text" placeholder="např. Lesní kronika" value={form.seriesName} onChange={(e) => set({ seriesName: e.target.value })} aria-invalid={!!errors.series} style={inputStyle} className={fieldCls} />
            </div>
            <div className="space-y-1">
              <label htmlFor="short-part" style={mutedStyle} className={labelCls}>Díl</label>
              <input id="short-part" type="number" min={1} max={SHORT_LIMITS.seriesPartMax} inputMode="numeric" value={form.seriesPart} onChange={(e) => set({ seriesPart: e.target.value })} aria-invalid={!!errors.series} style={inputStyle} className={fieldCls} />
            </div>
            {errors.series && <p role="alert" className="text-[0.6875rem] font-bold m-0 pl-1 sm:col-span-2" style={{ color: '#ef4444' }}>{errors.series}</p>}
          </div>
          <p style={mutedStyle} className="text-[0.6875rem] m-0 pl-1 opacity-80 -mt-2">Kdo dočte jeden díl, dostane ve feedu další. Díly číslují od 1.</p>

          {!form.id && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={form.publishNow} onChange={(e) => set({ publishNow: e.target.checked })} className="mt-1" style={{ accentColor: 'var(--bg-primary)' }} />
              <span className="text-xs font-bold leading-relaxed">Zveřejnit hned<span style={mutedStyle} className="block font-medium opacity-80">Když to odškrtneš, shortB se uloží jako skrytý a zveřejníš ho později v seznamu.</span></span>
            </label>
          )}

          <div className="flex gap-2">
            <button type="submit" disabled={busy} data-testid="shorts-save" style={primaryBtn} className="flex-1 py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {form.id ? 'Uložit změny' : form.publishNow ? 'Zveřejnit shortB' : 'Uložit jako skrytý'}
            </button>
            <button type="button" onClick={cancel} style={ghostBtn} className="px-5 py-3.5 rounded-xl border font-black uppercase text-xs cursor-pointer">Zrušit</button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ShortsStudio;
