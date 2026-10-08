import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '../../components/ui';
import {
  BOOK_TEXT_BUCKET, countStoredTexts, listTableBookIds, migrateAllBookTexts, cleanupTableCopies, isBucketMissing,
} from '../../bookText/bookText';

const btn = 'px-3 py-2 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
const tones = {
  ghost: { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' },
  primary: { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' },
  danger: { backgroundColor: '#dc2626', color: '#fff' },
};
const Btn = ({ tone = 'ghost', busy, children, ...props }) => (
  <button type="button" {...props} disabled={props.disabled || busy} style={tones[tone]} className={btn}>
    {busy && <Loader2 size={12} className="animate-spin" />}{children}
  </button>
);

const MIGRATE_LABELS = { migrated: 'přesunuto', already: 'už tam bylo', conflict: 'jiný text ve Storage (přeskočeno)', empty: 'prázdné', verify_failed: 'nesouhlasí po ověření', error: 'chyba' };
const CLEAN_LABELS = { deleted: 'smazáno', kept: 'ponecháno (liší se nebo chybí ve Storage)', error: 'chyba' };
const describe = (counts, labels) => Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${n}× ${labels[k]}`).join(', ') || 'nic';

/** Správce: přesun textů knih ze staré tabulky book_contents do soukromého Storage bucketu. Nic se nemaže bez potvrzení. */
export default function BookTextStoragePanel({ client, onLog }) {
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [overview, setOverview] = useState(null);
  const [message, setMessage] = useState(null);
  const abortRef = useRef(null);

  const fail = (error) => setMessage({
    type: 'error',
    text: isBucketMissing(error)
      ? `Bucket „${BOOK_TEXT_BUCKET}“ ještě neexistuje. Nejdřív spusť SQL pro úložiště textů v Supabase (SQL Editor).`
      : `Nepovedlo se: ${error?.message || 'neznámá chyba'}`,
  });

  const check = async (keepMessage = false) => {
    setBusy('check'); if (keepMessage !== true) setMessage(null);
    const [table, stored] = await Promise.all([listTableBookIds(client), countStoredTexts(client)]);
    setBusy('');
    if (table.error) return fail(table.error);
    if (stored.error) return fail(stored.error);
    setOverview({ table: table.ids.length, stored: stored.count });
  };

  const run = async (kind) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(kind); setMessage(null); setProgress({ done: 0, total: 0 });
    const onProgress = (p) => setProgress({ done: p.done, total: p.total });
    const res = kind === 'migrate'
      ? await migrateAllBookTexts(client, { onProgress, signal: ctrl.signal })
      : await cleanupTableCopies(client, { onProgress, signal: ctrl.signal });
    abortRef.current = null;
    setBusy(''); setProgress(null);
    if (res.error) return fail(res.error);
    const labels = kind === 'migrate' ? MIGRATE_LABELS : CLEAN_LABELS;
    const bad = kind === 'migrate' ? res.counts.error + res.counts.verify_failed + res.counts.conflict : res.counts.error;
    const firstError = res.failures?.find((f) => f.message)?.message;
    setMessage({
      type: bad > 0 ? 'error' : 'success',
      text: `${res.aborted ? 'Přerušeno. ' : ''}Zpracováno ${res.total} knih: ${describe(res.counts, labels)}.${firstError ? ` První chyba: ${firstError}` : ''}`,
    });
    try { await onLog?.(bad > 0 ? 'WARNING' : 'SUCCESS', `Úložiště textů knih (${kind === 'migrate' ? 'přesun' : 'úklid staré tabulky'}): ${describe(res.counts, labels)}`); } catch { /* log nevadí */ }
    check(true); // přehled se obnoví, hlášení o výsledku zůstane
  };

  const cleanup = () => {
    if (confirm('Smazat ze staré tabulky jen ty texty, které jsou ve Storage znovu ověřené jako totožné?\n\nTexty, které se liší nebo ve Storage chybí, zůstanou. Tuto akci nejde vrátit.')) run('cleanup');
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const color = (t) => (t === 'error' ? '#ef4444' : '#10b981');

  return (
    <Card>
      <h3 className="text-sm font-black uppercase tracking-wider mb-1 m-0">Úložiště textů knih</h3>
      <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 mb-4 leading-relaxed">
        Texty knih se ukládají jako soubory <code>.txt</code> do soukromého úložiště (Supabase Storage) místo databáze, takže se vejde mnohem víc knih. Čtení i úpravy knih vypadají stejně. Přesun jen kopíruje a každý text ověří znak po znaku; nic nemaže. Stará tabulka slouží dál jako záloha, dokud ji sám nevyčistíš.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={check} busy={busy === 'check'} disabled={!!busy}>Zkontrolovat stav</Btn>
        <Btn tone="primary" onClick={() => run('migrate')} busy={busy === 'migrate'} disabled={!!busy}>Přesunout texty do úložiště</Btn>
        <Btn tone="danger" onClick={cleanup} busy={busy === 'cleanup'} disabled={!!busy}>Smazat staré kopie z databáze</Btn>
        {(busy === 'migrate' || busy === 'cleanup') && <Btn onClick={() => abortRef.current?.abort()}>Přerušit</Btn>}
      </div>
      {overview && (
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-3 mb-0">
          Ve staré tabulce: <strong>{overview.table}</strong> · V úložišti: <strong>{overview.stored}</strong>
        </p>
      )}
      {progress && (
        <div className="mt-3" role="status" aria-live="polite">
          <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="h-2 rounded-full overflow-hidden">
            <div style={{ width: `${pct}%`, backgroundColor: 'var(--bg-primary)' }} className="h-full transition-all" />
          </div>
          <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] mt-1 mb-0 tabular-nums">{progress.done} / {progress.total}</p>
        </div>
      )}
      {message && <p role={message.type === 'error' ? 'alert' : 'status'} style={{ color: color(message.type) }} className="text-xs font-bold mt-3 mb-0 leading-relaxed">{message.text}</p>}
    </Card>
  );
}
