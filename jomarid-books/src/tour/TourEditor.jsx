import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Compass, Loader2, Play, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui';
import { TOUR_CONFIG_EVENT, useTour } from './TourProvider';
import { ANCHORS, ANCHOR_KEYS, SET_KEYS, SET_LABELS, TOUR_LIMITS, TOUR_SETTINGS_KEY, defaultSteps, normalizeTour } from './tourModel';

// Editor prohlídky appky v administraci (záložka "Prohlídka appky"), podobně jako editor domovské stránky.
// Upravuje se rozpracovaná kopie; teprve při uložení (nebo náhledu) projde normalizeTour() - po každém stisku klávesy
// by se jinak nově přidaný prázdný krok hned zahodil. Uloží se do site_settings pod klíčem TOUR_SETTINGS_KEY.

const inputStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const labelCls = 'text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70';
const iconBtn = 'p-2 border rounded-lg cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center';

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const TourEditor = () => {
  const tour = useTour();
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [saved, setSaved] = useState(null);              // naposledy uložená (nebo načtená) podoba
  const [draft, setDraft] = useState(null);              // rozpracovaná podoba
  const [setKey, setSetKey] = useState('reader');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);          // { type: 'success' | 'error' | 'info', text }

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const { data, error } = await supabase.from('site_settings').select('value').eq('key', TOUR_SETTINGS_KEY).maybeSingle();
      if (error) throw error;
      const value = normalizeTour(data?.value);
      setSaved(value); setDraft(value); setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const normalizedDraft = useMemo(() => (draft ? normalizeTour(draft) : null), [draft]);
  const dirty = !!(normalizedDraft && saved && JSON.stringify(normalizedDraft) !== JSON.stringify(saved));

  if (loadState === 'loading') return <Card><p className="text-xs font-bold flex items-center gap-2 m-0"><Loader2 size={14} className="animate-spin" /> Načítám prohlídku...</p></Card>;
  if (loadState === 'error') {
    return (
      <Card>
        <p role="alert" className="text-xs font-bold m-0 mb-3">Uloženou prohlídku se nepodařilo načíst. Dokud se to nepovede, upravovat ji nejde (uložením by se přepsala výchozí).</p>
        <button type="button" onClick={load} style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="px-4 py-2 border rounded-lg font-black uppercase text-[11px] tracking-wider cursor-pointer">Zkusit znovu</button>
      </Card>
    );
  }

  const steps = draft.sets[setKey];
  const setField = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setSteps = (next) => setDraft((d) => ({ ...d, sets: { ...d.sets, [setKey]: next } }));
  const patchStep = (i, patch) => setSteps(steps.map((st, k) => (k === i ? { ...st, ...patch } : st)));
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= steps.length) return; const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; setSteps(next); };
  const remove = (i) => setSteps(steps.filter((_, k) => k !== i));
  const add = () => { if (steps.length < TOUR_LIMITS.maxSteps) setSteps([...steps, { id: newId(), enabled: true, anchor: 'none', title: '', text: '' }]); };
  const resetSteps = () => {
    if (!window.confirm(`Obnovit výchozí kroky pro roli „${SET_LABELS[setKey]}“? Tvoje úpravy téhle sady se přepíšou (uloží se až po kliknutí na Uložit).`)) return;
    setSteps(defaultSteps(setKey));
  };

  const preview = () => {
    const list = normalizeTour(draft).sets[setKey].filter((st) => st.enabled);
    if (list.length === 0) { setMessage({ type: 'error', text: 'Tahle sada nemá žádný zapnutý krok, není co ukázat.' }); return; }
    setMessage(null);
    tour?.start({ source: 'preview', steps: list });
  };

  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const value = normalizeTour(draft);
      const { error } = await supabase.from('site_settings').upsert([{ key: TOUR_SETTINGS_KEY, value }], { onConflict: 'key' });
      if (error) throw error;
      try { await supabase.from('system_logs').insert([{ log_type: 'SUCCESS', message: 'Aktualizována prohlídka appky.' }]); } catch { /* záznam do logu není podmínka */ }
      setSaved(value); setDraft(value);
      window.dispatchEvent(new Event(TOUR_CONFIG_EVENT));
      setMessage({ type: 'success', text: 'Prohlídka uložena.' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Uložení prohlídky selhalo: ' + (err?.message || 'neznámá chyba') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="tour-editor">
      <Card>
        <h3 className="text-sm font-black uppercase tracking-wider mb-2 flex items-center gap-2"><Compass size={16} /> Prohlídka appky</h3>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4 opacity-80 leading-relaxed">
          Interaktivní prohlídka, která novým uživatelům po prvním přihlášení ukáže, kde co najdou. Spustit ji může kdokoli i později v Nastavení.
          Kroky jsou zvlášť pro čtenáře, nakladatele a správce.
        </p>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => setField({ enabled: e.target.checked })} className="w-4 h-4 cursor-pointer" aria-label="Prohlídka zapnutá" />
            <span className="text-xs font-bold">Prohlídka je zapnutá</span>
          </label>
          <div className="space-y-1">
            <label htmlFor="tour-auto-days" style={{ color: 'var(--text-muted)' }} className={labelCls}>Spustit sama účtům mladším než (dní)</label>
            <input
              id="tour-auto-days" type="number" min={0} max={TOUR_LIMITS.maxAutoDays} value={draft.autoDays}
              onChange={(e) => setField({ autoDays: e.target.value })} style={inputStyle} className="w-32 p-2.5 border rounded-lg text-sm font-bold outline-none"
            />
            <p style={{ color: 'var(--text-muted)' }} className="text-[10px] m-0 pl-1 opacity-70 leading-relaxed">
              0 = jen ručně v Nastavení. Starší účty, které prohlídku nikdy neviděly, ji samy nedostanou, aby se nepřipomínala dlouholetým čtenářům.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold" data-testid="tour-version">Verze prohlídky: {normalizedDraft.version}</span>
            <button
              type="button"
              onClick={() => setField({ version: Math.min(TOUR_LIMITS.maxVersion, normalizedDraft.version + 1) })}
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
              className="px-3 py-2 border rounded-lg font-black uppercase text-[10px] tracking-wider cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw size={12} /> Zobrazit znovu všem
            </button>
            <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-70">Zvýšením verze (a uložením) uvidí prohlídku znovu i ti, kdo ji už viděli.</span>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Role">
          {SET_KEYS.map((k) => (
            <button
              key={k} type="button" onClick={() => setSetKey(k)} aria-pressed={setKey === k} data-testid={`tour-set-${k}`}
              style={setKey === k ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'transparent' } : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
              className="px-4 py-2 border rounded-xl font-black uppercase text-[11px] tracking-wider cursor-pointer"
            >
              {SET_LABELS[k]} <span className="opacity-70">({draft.sets[k].length})</span>
            </button>
          ))}
        </div>

        {steps.length === 0 && <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mb-3 opacity-80">Tahle role nemá žádné kroky, prohlídku nedostane. Přidej krok, nebo obnov výchozí.</p>}
        <div className="space-y-3">
          {steps.map((st, i) => (
            <div key={st.id} data-testid="tour-step-editor" style={{ borderColor: 'var(--border-color)', opacity: st.enabled ? 1 : 0.65 }} className="border rounded-xl p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider">Krok {i + 1}</span>
                <label className="flex items-center gap-1.5 text-[11px] font-bold cursor-pointer">
                  <input type="checkbox" checked={st.enabled !== false} onChange={(e) => patchStep(i, { enabled: e.target.checked })} className="w-4 h-4 cursor-pointer" aria-label={`Zobrazit krok ${i + 1}`} /> Zobrazit
                </label>
                <span className="flex-1" />
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Posunout krok ${i + 1} nahoru`} style={inputStyle} className={iconBtn}><ArrowUp size={14} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Posunout krok ${i + 1} dolů`} style={inputStyle} className={iconBtn}><ArrowDown size={14} /></button>
                <button type="button" onClick={() => remove(i)} aria-label={`Smazat krok ${i + 1}`} style={inputStyle} className={`${iconBtn} hover:text-red-500`}><Trash2 size={14} /></button>
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className={labelCls}>Titulek <span className="normal-case opacity-70">({(st.title || '').length}/{TOUR_LIMITS.title})</span></label>
                <input
                  type="text" value={st.title} maxLength={TOUR_LIMITS.title} aria-label={`Titulek kroku ${i + 1}`}
                  onChange={(e) => patchStep(i, { title: e.target.value })} style={inputStyle} className="w-full p-2.5 border rounded-lg text-sm font-bold outline-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className={labelCls}>Text <span className="normal-case opacity-70">({(st.text || '').length}/{TOUR_LIMITS.text})</span></label>
                <textarea
                  value={st.text} maxLength={TOUR_LIMITS.text} rows={3} aria-label={`Text kroku ${i + 1}`}
                  onChange={(e) => patchStep(i, { text: e.target.value })} style={inputStyle} className="w-full p-2.5 border rounded-lg text-sm font-medium outline-none resize-y"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className={labelCls}>Co se zvýrazní</label>
                <select
                  value={ANCHOR_KEYS.includes(st.anchor) ? st.anchor : 'none'} aria-label={`Zvýrazněný prvek kroku ${i + 1}`}
                  onChange={(e) => patchStep(i, { anchor: e.target.value })} style={inputStyle} className="w-full p-2.5 border rounded-lg text-sm font-bold outline-none cursor-pointer"
                >
                  {ANCHOR_KEYS.map((k) => <option key={k} value={k}>{ANCHORS[k].label}</option>)}
                </select>
                {ANCHORS[st.anchor]?.route && <p style={{ color: 'var(--text-muted)' }} className="text-[10px] m-0 pl-1 opacity-70">Prohlídka na tuhle stránku sama přejde ({ANCHORS[st.anchor].route}).</p>}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" onClick={add} disabled={steps.length >= TOUR_LIMITS.maxSteps} data-testid="tour-add-step" style={inputStyle} className="px-4 py-2.5 border rounded-lg font-black uppercase text-[11px] tracking-wider cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus size={13} /> Přidat krok
          </button>
          <button type="button" onClick={resetSteps} style={inputStyle} className="px-4 py-2.5 border rounded-lg font-black uppercase text-[11px] tracking-wider cursor-pointer flex items-center gap-1.5">
            <RotateCcw size={13} /> Obnovit výchozí kroky
          </button>
          <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-70 self-center">{steps.length}/{TOUR_LIMITS.maxSteps} kroků</span>
        </div>
      </Card>

      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'} data-testid="tour-message" style={{ backgroundColor: message.type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.14)', color: message.type === 'error' ? '#ef4444' : '#10b981' }} className="text-xs font-bold rounded-lg px-3 py-2 m-0">{message.text}</p>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button" onClick={preview} data-testid="tour-preview"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
          className="sm:w-auto px-5 py-3.5 border rounded-xl font-black uppercase text-xs tracking-wider cursor-pointer flex items-center justify-center gap-2"
        >
          <Play size={14} /> Vyzkoušet prohlídku ({SET_LABELS[setKey]})
        </button>
        <button
          type="button" onClick={save} disabled={saving} data-testid="tour-save"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
          className="flex-1 py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <><Loader2 size={14} className="animate-spin" /> Ukládám...</> : <><Save size={14} /> Uložit prohlídku{dirty ? ' (neuložené změny)' : ''}</>}
        </button>
      </div>
    </div>
  );
};
