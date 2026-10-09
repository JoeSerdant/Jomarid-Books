import { useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, Send } from 'lucide-react';
import { Card } from '../components/ui';
import { PUSH_KINDS, VAPID_SETTINGS_KEY } from './pushModel.js';
import { fetchVapidKey, sendTestPush } from './pushClient.js';
import { generateVapidKeys } from './vapid.js';

const btn = 'px-3 py-2 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50';
const mono = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };

const KeyBox = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ručně označit */ } };
  return (
    <div className="space-y-1">
      <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0">{label}</p>
      <div className="flex items-stretch gap-2">
        <code data-testid={`vapid-${label.includes('Soukromý') ? 'private' : 'public'}`} style={mono} className="flex-1 min-w-0 border rounded-lg px-2.5 py-2 text-xs break-all select-all">{value}</code>
        <button type="button" onClick={copy} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className={btn}><Copy size={12} /> {copied ? 'Zkopírováno' : 'Kopírovat'}</button>
      </div>
    </div>
  );
};

/** Správa -> Upozornění: klíče pro oznámení do zařízení (celý postup: db/push/README.md). */
export default function PushAdminCard({ client }) {
  const [saved, setSaved] = useState(null); // null = zjišťuje se, true/false
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState({ busy: '', text: '', tone: '' });

  const sendPreview = async (kind, label) => {
    setPreview({ busy: kind, text: '', tone: '' });
    const res = await sendTestPush(client, kind);
    setPreview({
      busy: '',
      tone: res.ok ? 'ok' : res.reason === 'too-many' ? 'info' : 'error',
      text: res.ok ? `Ukázka „${label}“ je odeslaná na tvoje zařízení s povolenými oznámeními.`
        : res.reason === 'too-many' ? 'Počkej pár vteřin před další ukázkou.'
        : res.reason === 'not-configured' ? 'Server pro oznámení ještě není nastavený (spusť db/push-notifications.sql).'
        : res.reason === 'forbidden' ? 'Ukázky smí posílat jen správce.' : 'Ukázku se nepodařilo odeslat.',
    });
  };

  useEffect(() => { let on = true; fetchVapidKey(client).then((r) => { if (on) setSaved(!r.error && !!r.key); }); return () => { on = false; }; }, [client]);

  const generate = async () => {
    if (saved && !confirm('Klíče už jsou nastavené. Když je vyměníš, všichni si musí oznámení v zařízení zapnout znovu. Pokračovat?')) return;
    setBusy(true); setError(''); setKeys(null);
    try {
      const pair = await generateVapidKeys();
      const { error: saveError } = await client.from('site_settings').upsert({ key: VAPID_SETTINGS_KEY, value: { key: pair.publicKey } }, { onConflict: 'key' });
      if (saveError) throw saveError;
      setKeys(pair); setSaved(true);
    } catch (e) {
      setError(`Klíče se nepodařilo vytvořit nebo uložit: ${e?.message || 'neznámá chyba'}`);
    }
    setBusy(false);
  };

  return (
    <Card>
      <h3 className="text-sm font-black uppercase tracking-wider mb-1 mt-0 flex items-center gap-2"><KeyRound size={15} /> Oznámení do telefonu</h3>
      <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 mb-3 leading-relaxed">
        Aby se oznámení z appky ukázala i v telefonu, potřebuje server pár klíčů. Veřejný se uloží sám, soukromý se ukáže jen jednou: vlož ho do Supabase
        (Edge Functions → Secrets jako <code>VAPID_PRIVATE_KEY</code>). Celý postup je v souboru <code>db/push/README.md</code> v repozitáři.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} disabled={busy || saved === null} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className={btn}>
          {busy && <Loader2 size={12} className="animate-spin" />}Vygenerovat klíče
        </button>
        <span data-testid="vapid-status" style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">{saved === null ? 'Zjišťuji...' : saved ? 'Veřejný klíč je uložený.' : 'Klíče zatím nejsou nastavené.'}</span>
      </div>
      {error && <p role="alert" className="text-xs font-bold mt-3 mb-0" style={{ color: '#ef4444' }}>{error}</p>}
      {keys && (
        <div className="mt-4 space-y-3">
          <p role="status" style={{ color: '#d97706' }} className="text-xs font-bold m-0 leading-relaxed">Soukromý klíč se ukáže jen teď. Zkopíruj ho do Supabase, než okno zavřeš.</p>
          <KeyBox label="Veřejný klíč (VAPID_PUBLIC_KEY)" value={keys.publicKey} />
          <KeyBox label="Soukromý klíč (VAPID_PRIVATE_KEY)" value={keys.privateKey} />
        </div>
      )}
      <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <h4 className="text-xs font-black uppercase tracking-wider m-0 mb-1">Ukázky motivačních oznámení</h4>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 mb-3 leading-relaxed">
          Čtenářům chodí nejvýš jedno oznámení denně podle toho, co se hodí (série, rozečtená kniha, cíl...). Tady si každý druh vyzkoušíš s ukázkovými údaji;
          přijde na tvoje zařízení, kde máš v Nastavení → Oznámení zapnutá oznámení. Texty se pokaždé losují z víc variant.
        </p>
        <div className="flex flex-wrap gap-2" data-testid="push-kinds">
          {PUSH_KINDS.map(({ kind, label }) => (
            <button key={kind} type="button" onClick={() => sendPreview(kind, label)} disabled={!!preview.busy || !saved} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', border: '1px solid var(--border-color)' }} className={btn}>
              {preview.busy === kind ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}{label}
            </button>
          ))}
        </div>
        {preview.text && <p role={preview.tone === 'error' ? 'alert' : 'status'} className="text-xs font-bold mt-3 mb-0" style={{ color: preview.tone === 'error' ? '#ef4444' : 'var(--text-muted)' }}>{preview.text}</p>}
      </div>
    </Card>
  );
}
