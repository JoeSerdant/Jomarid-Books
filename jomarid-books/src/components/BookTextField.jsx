import { useEffect, useRef, useState } from 'react';
import { FileText, Maximize2, Minimize2, Upload } from 'lucide-react';
import { readTextFile, mergeImported } from '../bookText/importText';

const nf = new Intl.NumberFormat('cs-CZ');
const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

/**
 * Pole pro text knihy: velké, s přetažením souboru .txt/.md (nebo výběrem souboru), počítadlem a režimem přes celou
 * obrazovku. Psaní, vkládání (Ctrl+V) i přetažení označeného textu fungují jako v běžném poli.
 */
export default function BookTextField({ id, value, onChange, placeholder, required, labelStyle, style }) {
  const [over, setOver] = useState(false);
  const [full, setFull] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null); // { name, text } čeká na volbu nahradit / připojit
  const area = useRef(null);
  const picker = useRef(null);
  const depth = useRef(0);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    area.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const take = async (file) => {
    setError('');
    const res = await readTextFile(file);
    if (res.error) { setError(res.error); return; }
    if (!value.trim()) onChange(res.text); else setPending({ name: file.name, text: res.text });
  };
  const apply = (mode) => { onChange(mergeImported(value, pending.text, mode)); setPending(null); };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.round(words / 200));

  const onDrop = (e) => {
    depth.current = 0; setOver(false);
    if (!hasFiles(e)) return; // označený text se vloží tak, jak to dělá prohlížeč
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) take(file);
  };

  const box = full
    ? 'fixed inset-0 z-[60] flex flex-col gap-2 p-3 sm:p-5'
    : 'space-y-1';
  const area_h = full ? 'flex-1 min-h-0' : 'h-[45vh] min-h-[16rem] sm:h-[60vh] sm:min-h-[22rem]';

  return (
    <div className={box} style={full ? { backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' } : undefined}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} style={labelStyle} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">Text knihy</label>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => picker.current?.click()} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="px-2.5 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-black uppercase tracking-wider inline-flex items-center gap-1.5">
            <Upload size={12} /> Načíst ze souboru
          </button>
          <button type="button" onClick={() => setFull((f) => !f)} aria-pressed={full} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="px-2.5 py-1.5 rounded-lg border-none cursor-pointer text-[0.625rem] font-black uppercase tracking-wider inline-flex items-center gap-1.5">
            {full ? <><Minimize2 size={12} /> Zavřít celou obrazovku</> : <><Maximize2 size={12} /> Celá obrazovka</>}
          </button>
        </div>
        <input ref={picker} type="file" accept=".txt,.text,.md,.markdown,text/plain,text/markdown" className="hidden" data-testid="book-text-file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) take(f); }} />
      </div>

      <div
        className={`relative ${full ? 'flex-1 min-h-0 flex flex-col' : ''}`}
        onDragEnter={(e) => { if (hasFiles(e)) { depth.current += 1; setOver(true); } }}
        onDragLeave={(e) => { if (hasFiles(e)) { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); } }}
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={onDrop}
      >
        <textarea
          id={id} ref={area} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder}
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: over ? 'var(--bg-primary)' : 'var(--border-color)', color: 'var(--text-body)', ...style }}
          className={`w-full p-3.5 border rounded-xl font-medium outline-none resize-y text-sm leading-relaxed placeholder:opacity-40 ${area_h}`}
        />
        {over && (
          <div className="absolute inset-0 rounded-xl flex items-center justify-center pointer-events-none text-xs font-black uppercase tracking-wider" style={{ backgroundColor: 'var(--bg-card)', opacity: 0.92, border: '2px dashed var(--bg-primary)', color: 'var(--text-body)' }}>
            <FileText size={16} className="mr-2" /> Pusť soubor .txt nebo .md sem
          </div>
        )}
      </div>

      {pending && (
        <div role="alertdialog" aria-label="Vložit soubor" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="rounded-xl p-3 text-xs font-bold flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[12rem]">Soubor „{pending.name}“ ({nf.format(pending.text.length)} znaků). V poli už text je:</span>
          <button type="button" onClick={() => apply('replace')} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase">Nahradit</button>
          <button type="button" onClick={() => apply('append')} style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)' }} className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase">Připojit na konec</button>
          <button type="button" onClick={() => setPending(null)} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)' }} className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase">Zrušit</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs font-bold m-0 pl-1" style={{ color: '#ef4444' }}>{error}</p>}
      <p data-testid="text-stats" style={labelStyle} className="text-[0.6875rem] m-0 pl-1 opacity-80">
        {words > 0 ? `${nf.format(words)} slov · ${nf.format(value.length)} znaků · čtení asi ${nf.format(minutes)} min` : 'Napiš text, vlož ho (Ctrl+V), nebo sem přetáhni soubor .txt / .md.'}
      </p>
    </div>
  );
}
