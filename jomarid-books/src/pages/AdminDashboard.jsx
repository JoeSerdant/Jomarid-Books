import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Card } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { Award, Coins, Database, Filter, Heart, Layout, Plus, RefreshCw, Search, Shield, ShieldAlert, Sparkles, Terminal, Trash, UserCheck, Users, XCircle, LayoutDashboard, UserCog, Loader2, CheckCircle2, X, ChevronLeft, ChevronRight, Ban, KeyRound, Trash2, ShieldCheck, Bell, Copy, Flag, Eye, EyeOff, Download } from 'lucide-react';

// ============================================================================
// Admin: Přehled a správa účtů (pomocné prvky, záložka Přehled, záložka Účty)
// ============================================================================
const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString('cs-CZ') : '-');
const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }) : '-');
const formatNumber = (n) => Number(n || 0).toLocaleString('cs-CZ');

const relativeTime = (iso) => {
  if (!iso) return 'nikdy';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'před chvílí';
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'včera';
  if (days < 30) return `před ${days} dny`;
  const months = Math.floor(days / 30);
  if (months < 12) return `před ${months} měs.`;
  return `před ${Math.floor(months / 12)} r.`;
};

const ROLE_LABELS = { 'uživatel': 'Čtenář', nakladatel: 'Nakladatel', 'správce': 'Správce' };

// Zdroje mincí se ve coin_transactions poznají podle prefixu před dvojtečkou.
const SOURCE_LABELS = {
  badge: 'Odznaky',
  game_event: 'Události ve hrách',
  game_bonus: 'Denní bonus za hru',
  daily_login: 'Denní přihlášení',
  admin_grant: 'Přidělil admin',
  book_purchase: 'Nákupy knih',
  book_sale: 'Prodeje knih (autorům)',
  streak_freeze_purchase: 'Streak Freeze',
};
const sourceLabel = (sourceType) => {
  const key = String(sourceType || '').split(':')[0];
  return SOURCE_LABELS[key] || key || 'Jiné';
};

const ADMIN_ERRORS = {
  forbidden: 'K téhle akci nemáš oprávnění.',
  cannot_target_self: 'Tohle nejde provést na vlastním účtu.',
  cannot_target_admin: 'Účet správce nejde blokovat ani mazat - nejdřív mu změň roli.',
  has_published_books: 'Účet má vydané knihy - nejdřív je smaž nebo předej jinému autorovi.',
  user_not_found: 'Účet už neexistuje (mohl být mezitím smazán).',
  profile_not_found: 'Účet nemá profil - založí se při jeho příštím přihlášení.',
  invalid_role: 'Neplatná role.',
  cannot_reset_self: 'Heslo sobě vydat nejde - použij Supabase (Authentication -> Users) nebo druhého správce.',
  notification_not_found: 'Upozornění už neexistuje (mohlo být mezitím smazáno).',
  invalid_status: 'Neplatný stav upozornění.',
  already_handled: 'Tohle upozornění už bylo vyřízeno.',
  username_invalid: 'Neplatné uživatelské jméno (3-20 znaků, a-z, číslice, . _ -).',
  username_reserved: 'Tohle jméno je rezervované.',
  username_taken: 'Tohle jméno už někdo používá.',
};
const mapAdminError = (err) => {
  const msg = String(err?.message || '');
  const code = Object.keys(ADMIN_ERRORS).find(c => msg.includes(c));
  return code ? ADMIN_ERRORS[code] : 'Akce se nepovedla: ' + (msg || 'neznámá chyba');
};

const StatCard = ({ label, value, hint }) => (
  <div style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-4 min-w-0">
    <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0 opacity-80">{label}</p>
    <p className="text-2xl font-black m-0 mt-1 tabular-nums">{value}</p>
    {hint && <p style={{ color: 'var(--text-muted)' }} className="text-[11px] m-0 mt-1 opacity-80">{hint}</p>}
  </div>
);

const PILL_TONES = {
  muted: { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' },
  danger: { backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  warn: { backgroundColor: 'rgba(245,158,11,0.16)', color: '#d97706' },
  ok: { backgroundColor: 'rgba(16,185,129,0.15)', color: '#10b981' },
  accent: { backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' },
};
const Pill = ({ tone = 'muted', children }) => (
  <span style={PILL_TONES[tone]} className="inline-block text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap">{children}</span>
);

const InlineMessage = ({ type = 'info', children }) => {
  const style = type === 'error' ? PILL_TONES.danger : type === 'success' ? PILL_TONES.ok : PILL_TONES.muted;
  return <p role={type === 'error' ? 'alert' : 'status'} style={style} className="text-xs font-bold rounded-lg px-3 py-2 m-0 leading-relaxed">{children}</p>;
};

// Potvrzení, které nejde odkliknout bez čtení: tlačítko se odemkne až po opsání
// očekávaného textu (název knihy, e-mail účtu...). Používá se u nevratných akcí.
export const TypedConfirm = ({ open, title, description, expected, confirmLabel = 'Potvrdit', busy = false, error = '', onConfirm, onCancel }) => {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  const matches = typed.trim().toLowerCase() === String(expected || '').trim().toLowerCase() && typed.trim() !== '';
  return (
    <div className="fixed inset-0 z-[130] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'rgba(239,68,68,0.5)', color: 'var(--text-body)' }}
        className="border-2 rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-black uppercase tracking-wider m-0 text-red-500">{title}</h3>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{description}</p>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-wider block mb-1 opacity-80">Pro potvrzení napiš: <span className="normal-case tracking-normal select-all">{expected}</span></span>
          <input
            type="text"
            autoFocus
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
            className="w-full p-2.5 border rounded-lg text-sm font-semibold outline-none"
          />
        </label>
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} disabled={busy} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="px-4 py-2 rounded-lg border-none cursor-pointer text-[11px] font-black uppercase tracking-wider disabled:opacity-50">Zrušit</button>
          <button type="button" onClick={onConfirm} disabled={!matches || busy} style={{ backgroundColor: '#dc2626', color: '#fff' }} className="px-4 py-2 rounded-lg border-none cursor-pointer text-[11px] font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2">
            {busy && <Loader2 size={13} className="animate-spin" />}{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const MiniBars = ({ title, points, valueKey, color }) => {
  const values = points.map(p => Number(p[valueKey]) || 0);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] font-black uppercase tracking-wider m-0 opacity-80">{title}</p>
        <p className="text-sm font-black m-0 tabular-nums">{formatNumber(total)}</p>
      </div>
      <div className="flex items-end gap-[3px] h-16" role="img" aria-label={`${title}: ${total} za posledních 14 dní`}>
        {points.map((p, i) => (
          <div
            key={p.day}
            title={`${new Date(p.day).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' })}: ${formatNumber(values[i])}`}
            style={{ height: `${Math.max(values[i] > 0 ? 8 : 2, (values[i] / max) * 100)}%`, backgroundColor: color, opacity: values[i] > 0 ? 1 : 0.25 }}
            className="flex-1 rounded-sm"
          />
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="text-[10px] m-0 mt-1 opacity-70">posledních 14 dní</p>
    </div>
  );
};

const Chip = ({ onClick, tone = 'warn', children }) => (
  <button
    type="button"
    onClick={onClick}
    style={tone === 'danger' ? { backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444' } : { backgroundColor: 'rgba(245,158,11,0.16)', color: '#d97706' }}
    className="border-none rounded-full px-3 py-1.5 text-xs font-black cursor-pointer hover:opacity-80"
  >
    {children}
  </button>
);

export const OverviewTab = ({ onOpenAccounts, onOpenBooks }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data: result, error: rpcError } = await supabase.rpc('admin_overview');
    if (rpcError) setError(mapAdminError(rpcError));
    else setData(result);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!data && loading) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>;
  if (!data) {
    return (
      <div className="space-y-3">
        <InlineMessage type="error">{error || 'Přehled se nepodařilo načíst.'}</InlineMessage>
        <button type="button" onClick={load} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-4 py-2 rounded-lg border-none cursor-pointer text-xs font-black uppercase">Zkusit znovu</button>
      </div>
    );
  }

  const { users, books, reading, coins, daily } = data;
  const sources = coins.sources || [];
  const earned30 = sources.reduce((s, r) => s + Number(r.earned_30d), 0);
  const spent30 = sources.reduce((s, r) => s + Number(r.spent_30d), 0);
  const issues = [
    users.no_profile > 0 && { key: 'np', label: `${users.no_profile} účtů bez profilu`, onClick: () => onOpenAccounts({ role: 'bez_profilu' }) },
    users.banned > 0 && { key: 'ban', label: `${users.banned} zablokovaných`, onClick: () => onOpenAccounts({ status: 'banned' }) },
    users.unconfirmed > 0 && { key: 'unc', label: `${users.unconfirmed} nepotvrzených e-mailů`, onClick: () => onOpenAccounts({ status: 'unconfirmed' }) },
    books.missing_author > 0 && { key: 'ma', label: `${books.missing_author} knih bez propojeného autora`, onClick: onOpenBooks },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-80">Stav k {formatDateTime(data.generated_at)}</p>
        <button type="button" onClick={load} disabled={loading} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} className="border rounded-lg px-3 py-1.5 cursor-pointer text-xs font-black uppercase inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Obnovit
        </button>
      </div>
      {error && <InlineMessage type="error">{error}</InlineMessage>}

      <div className="flex items-center gap-2 flex-wrap" data-testid="issues">
        {issues.length === 0
          ? <span style={{ color: '#10b981' }} className="text-xs font-black inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> Žádné nalezené problémy</span>
          : issues.map(i => <Chip key={i.key} onClick={i.onClick}>{i.label}</Chip>)}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Účty" value={formatNumber(users.total)} hint={`+${users.new_7d} za 7 dní · +${users.new_30d} za 30 dní`} />
        <StatCard label="Aktivní" value={formatNumber(users.active_7d)} hint={`za 7 dní · ${users.active_30d} za 30 dní`} />
        <StatCard label="Dočtené knihy" value={formatNumber(reading.finished_total)} hint={`${reading.finished_7d} za 7 dní · ${reading.finished_30d} za 30 dní`} />
        <StatCard label="Mince v oběhu" value={formatNumber(coins.in_circulation)} hint={`průměr ${formatNumber(coins.avg_per_profile)} na profil`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniBars title="Nové účty" points={daily} valueKey="new_users" color="#6366f1" />
        <MiniBars title="Dočtené knihy" points={daily} valueKey="finished" color="#10b981" />
        <MiniBars title="Získané mince" points={daily} valueKey="coins_earned" color="#f59e0b" />
      </div>

      <Card>
        <h3 className="text-sm font-black uppercase tracking-wider mb-1">Ekonomika mincí podle zdroje</h3>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mb-3 opacity-80">
          Za posledních 30 dní přibylo {formatNumber(earned30)} a ubylo {formatNumber(spent30)} mincí (čistě {earned30 - spent30 >= 0 ? '+' : ''}{formatNumber(earned30 - spent30)}).
        </p>
        {sources.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">Zatím žádné transakce.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[520px]">
              <thead>
                <tr style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }} className="text-left border-b">
                  <th className="py-2 pr-3 font-black uppercase text-[10px]">Zdroj</th>
                  <th className="py-2 px-2 font-black uppercase text-[10px] text-right">Získáno 30 d</th>
                  <th className="py-2 px-2 font-black uppercase text-[10px] text-right">Utraceno 30 d</th>
                  <th className="py-2 px-2 font-black uppercase text-[10px] text-right">Získáno celkem</th>
                  <th className="py-2 px-2 font-black uppercase text-[10px] text-right">Utraceno celkem</th>
                  <th className="py-2 pl-2 font-black uppercase text-[10px] text-right">Počet</th>
                </tr>
              </thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.source} style={{ borderColor: 'var(--border-color)' }} className="border-b last:border-b-0">
                    <td className="py-2 pr-3 font-bold">{sourceLabel(s.source)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatNumber(s.earned_30d)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatNumber(s.spent_30d)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatNumber(s.earned_total)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{formatNumber(s.spent_total)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{formatNumber(s.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-sm font-black uppercase tracking-wider mb-3">Nejčtenější knihy</h3>
          {reading.top_books.length === 0 ? <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">Zatím nikdo nic nedočetl.</p> : (
            <ol className="m-0 pl-5 space-y-1.5 text-sm">
              {reading.top_books.map(b => <li key={b.id}><span className="font-bold">{b.title}</span> <span style={{ color: 'var(--text-muted)' }} className="text-xs">· {b.reads}×</span></li>)}
            </ol>
          )}
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] m-0 mt-3 opacity-70">Knih v katalogu: {books.total} ({books.paid} placených, {books.auto_assigned} zdarma pro všechny)</p>
        </Card>
        <Card>
          <h3 className="text-sm font-black uppercase tracking-wider mb-3">Nejvíc mincí</h3>
          <ol className="m-0 pl-5 space-y-1.5 text-sm">
            {coins.top_holders.map((h, i) => <li key={`${h.email}-${i}`} className="break-all"><span className="font-bold">{h.email}</span> <span style={{ color: 'var(--text-muted)' }} className="text-xs">· {formatNumber(h.coins)}</span></li>)}
          </ol>
          <p style={{ color: 'var(--text-muted)' }} className="text-[11px] m-0 mt-3 opacity-70">Hodnoty mimo běžný řád (např. testovací účty) tu snadno poznáš.</p>
        </Card>
      </div>
    </div>
  );
};

const PAGE_SIZE = 20;
const ROLE_FILTERS = [['all', 'Všechny role'], ['uživatel', 'Čtenáři'], ['nakladatel', 'Nakladatelé'], ['správce', 'Správci'], ['bez_profilu', 'Bez profilu']];
const STATUS_FILTERS = [['all', 'Jakýkoliv stav'], ['banned', 'Zablokovaní'], ['unconfirmed', 'Nepotvrzený e-mail'], ['inactive30', 'Neaktivní 30 dní']];
const SORTS = [['created_desc', 'Nejnovější'], ['created_asc', 'Nejstarší'], ['last_login_desc', 'Naposledy přihlášení'], ['coins_desc', 'Nejvíc mincí'], ['email_asc', 'E-mail A-Z']];

const selectStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const selectClass = 'p-2.5 border rounded-lg text-xs font-bold outline-none cursor-pointer';

const SmallButton = ({ tone = 'ghost', busy = false, disabled, children, ...props }) => {
  const style = tone === 'danger' ? { backgroundColor: '#dc2626', color: '#fff' } : tone === 'primary' ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' } : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' };
  return (
    <button {...props} disabled={disabled || busy} style={style} className="px-3 py-2 rounded-lg border-none cursor-pointer text-[11px] font-black uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
      {busy && <Loader2 size={12} className="animate-spin" />}{children}
    </button>
  );
};

const AccountDetail = ({ userId, currentUserId, onClose, onChanged }) => {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [roleDraft, setRoleDraft] = useState('');
  const [confirmBan, setConfirmBan] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [tempOpen, setTempOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_user_detail', { p_user_id: userId });
    if (rpcError) { setError(mapAdminError(rpcError)); return; }
    setError('');
    setDetail(data);
    setRoleDraft(data?.profile?.role || '');
    setNameDraft(data?.profile?.username || '');
  }, [userId]);
  useEffect(() => { setDetail(null); setMsg(null); setConfirmBan(false); load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !deleteOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, deleteOpen]);

  const run = async (call, okText) => {
    setBusy(true);
    setMsg(null);
    const { error: rpcError } = await call();
    setBusy(false);
    if (rpcError) { setMsg({ type: 'error', text: mapAdminError(rpcError) }); return false; }
    setMsg({ type: 'success', text: okText });
    await load();
    onChanged?.();
    return true;
  };

  const doDelete = async () => {
    setDeleteError('');
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('admin_delete_user', { p_user_id: userId });
    setBusy(false);
    if (rpcError) return setDeleteError(mapAdminError(rpcError));
    setDeleteOpen(false);
    onChanged?.();
    onClose();
  };

  const account = detail?.account;
  const profile = detail?.profile;
  const stats = detail?.stats;
  const isSelf = userId === currentUserId;
  const isAdminTarget = profile?.role === 'správce';
  const hasBooks = (stats?.published_books || 0) > 0;
  const isBanned = !!account?.is_banned;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Detail účtu"
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="h-full w-full max-w-md border-l shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-black uppercase tracking-widest m-0">Detail účtu</h3>
          <button type="button" onClick={onClose} aria-label="Zavřít detail" className="bg-transparent border-none cursor-pointer text-current opacity-60 hover:opacity-100 p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {error && <InlineMessage type="error">{error}</InlineMessage>}
          {!detail && !error && <div className="py-10 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>}

          {detail && (
            <>
              <div>
                <p className="text-base font-black m-0 break-all">{account.email}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Pill tone="accent">{profile ? ROLE_LABELS[profile.role] || profile.role : 'Bez profilu'}</Pill>
                  {isBanned && <Pill tone="danger">Zablokován</Pill>}
                  {!account.email_confirmed_at && <Pill tone="warn">E-mail nepotvrzen</Pill>}
                  {isSelf && <Pill tone="ok">Tohle jsi ty</Pill>}
                </div>
                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs mt-3 m-0">
                  <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Vytvořen</dt><dd className="m-0 font-semibold">{formatDate(account.created_at)}</dd>
                  <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Naposledy přihlášen</dt><dd className="m-0 font-semibold">{account.last_sign_in_at ? `${formatDateTime(account.last_sign_in_at)} (${relativeTime(account.last_sign_in_at)})` : 'nikdy'}</dd>
                  {profile && <><dt style={{ color: 'var(--text-muted)' }} className="font-bold">Mince</dt><dd className="m-0 font-semibold">{formatNumber(profile.coins)}</dd></>}
                  {profile && <><dt style={{ color: 'var(--text-muted)' }} className="font-bold">Série (streak)</dt><dd className="m-0 font-semibold">{profile.current_streak ?? 0} dní</dd></>}
                </dl>
                {!profile && <div className="mt-3"><InlineMessage>Účet zatím nemá profil - založí se, jakmile se poprvé přihlásí.</InlineMessage></div>}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[['Přečteno', stats.books_read], ['Zvýraznění', stats.highlights], ['Komentáře', stats.comments], ['Hodnocení', stats.ratings], ['Odemčené', stats.books_active], ['Vydané', stats.published_books]].map(([label, value]) => (
                  <div key={label} style={{ backgroundColor: 'var(--bg-secondary)' }} className="rounded-lg py-2">
                    <p className="text-lg font-black m-0 tabular-nums">{value}</p>
                    <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-bold uppercase m-0">{label}</p>
                  </div>
                ))}
              </div>

              <section className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider m-0">Akce</h4>
                {msg && <InlineMessage type={msg.type}>{msg.text}</InlineMessage>}
                {isSelf && <InlineMessage>Na vlastním účtu nejde měnit roli, blokovat, mazat ani vydat dočasné heslo - to může provést jiný správce.</InlineMessage>}

                {profile?.must_change_password && <InlineMessage>Čeká na změnu hesla: správce vydal dočasné heslo a uživatel si zatím nenastavil vlastní.</InlineMessage>}

                {profile && 'username' in profile && (
                  <div className="flex items-end gap-2 flex-wrap">
                    <label className="block flex-1 min-w-[140px]">
                      <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-1">Uživatelské jméno</span>
                      <input aria-label="Uživatelské jméno" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={20} autoCapitalize="none" spellCheck={false} disabled={busy} style={selectStyle} className="w-full p-2.5 border rounded-lg text-xs font-bold outline-none disabled:opacity-50" />
                    </label>
                    <SmallButton busy={busy} disabled={nameDraft.trim() === (profile.username || '') || nameDraft.trim().length < 3} onClick={() => run(() => supabase.rpc('admin_set_username', { p_user: userId, p_username: nameDraft.trim() }), 'Jméno přejmenováno.')}>
                      <UserCog size={13} /> Přejmenovat
                    </SmallButton>
                  </div>
                )}

                <div className="flex items-end gap-2 flex-wrap">
                  <label className="block flex-1 min-w-[140px]">
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-1">Role</span>
                    <select aria-label="Role" value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} disabled={isSelf || !profile || busy} style={selectStyle} className={`${selectClass} w-full disabled:opacity-50`}>
                      {!profile && <option value="">-</option>}
                      {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <SmallButton tone="primary" busy={busy} disabled={isSelf || !profile || roleDraft === profile?.role} onClick={() => run(() => supabase.rpc('admin_set_role', { p_user_id: userId, p_role: roleDraft }), 'Role změněna.')}>
                    <ShieldCheck size={13} /> Uložit roli
                  </SmallButton>
                </div>

                <div className="flex flex-wrap gap-2">
                  <SmallButton busy={busy} disabled={isSelf} onClick={() => setTempOpen(true)}><KeyRound size={13} /> Vydat dočasné heslo</SmallButton>
                  {isBanned ? (
                    <SmallButton busy={busy} disabled={isSelf} onClick={() => run(() => supabase.rpc('admin_set_user_banned', { p_user_id: userId, p_banned: false }), 'Účet odblokován.')}><Ban size={13} /> Odblokovat</SmallButton>
                  ) : !confirmBan ? (
                    <SmallButton busy={busy} disabled={isSelf || isAdminTarget} onClick={() => setConfirmBan(true)}><Ban size={13} /> Zablokovat</SmallButton>
                  ) : (
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold">Zablokovat a odhlásit?</span>
                      <SmallButton tone="danger" busy={busy} onClick={async () => { const ok = await run(() => supabase.rpc('admin_set_user_banned', { p_user_id: userId, p_banned: true }), 'Účet zablokován a odhlášen ze zařízení.'); if (ok) setConfirmBan(false); }}>Ano, zablokovat</SmallButton>
                      <SmallButton disabled={busy} onClick={() => setConfirmBan(false)}>Zrušit</SmallButton>
                    </span>
                  )}
                </div>
                {isAdminTarget && !isSelf && <p style={{ color: 'var(--text-muted)' }} className="text-[11px] m-0 opacity-80">Účet správce nejde blokovat ani mazat - nejdřív mu změň roli.</p>}

                <div style={{ borderColor: 'rgba(239,68,68,0.35)' }} className="border rounded-lg p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-wider text-red-500 m-0">Nebezpečná zóna</p>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">Nevratně smaže účet i všechna jeho data (rozečtené knihy, záložky, zvýraznění, hodnocení, komentáře, mince).</p>
                  {hasBooks && <p className="text-xs font-bold text-amber-600 m-0">Účet má vydané knihy ({stats.published_books}) - napřed je smaž nebo předej jinému autorovi.</p>}
                  <SmallButton tone="danger" disabled={isSelf || isAdminTarget || hasBooks} onClick={() => { setDeleteError(''); setDeleteOpen(true); }}><Trash2 size={13} /> Smazat účet</SmallButton>
                </div>
              </section>

              <section>
                <h4 className="text-xs font-black uppercase tracking-wider m-0 mb-2">Poslední pohyby mincí</h4>
                {detail.transactions.length === 0 ? <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">Žádné pohyby.</p> : (
                  <ul className="m-0 p-0 list-none space-y-1">
                    {detail.transactions.map((t, i) => (
                      <li key={i} style={{ borderColor: 'var(--border-color)' }} className="flex items-center justify-between gap-3 text-xs border-b last:border-b-0 py-1.5">
                        <span className="min-w-0"><span className="font-bold">{sourceLabel(t.source_type)}</span> <span style={{ color: 'var(--text-muted)' }} className="opacity-70">· {formatDateTime(t.created_at)}</span></span>
                        <span style={{ color: t.amount >= 0 ? '#10b981' : '#ef4444' }} className="font-black tabular-nums shrink-0">{t.amount > 0 ? '+' : ''}{t.amount}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      <TypedConfirm
        open={deleteOpen}
        title="Smazat účet natrvalo"
        description={`Smaže se účet ${account?.email || ''} i všechna jeho data. Zpět to nejde vzít.`}
        expected={account?.email || ''}
        confirmLabel="Smazat účet"
        busy={busy}
        error={deleteError}
        onConfirm={doDelete}
        onCancel={() => setDeleteOpen(false)}
      />

      {tempOpen && (
        <TempPasswordDialog
          target={{ id: userId, username: profile?.username || (account?.email || '').split('@')[0], email: account?.email }}
          onClose={() => setTempOpen(false)}
          onIssued={() => { load(); onChanged?.(); }}
        />
      )}
    </div>
  );
};

// ============================================================================
// Admin: Upozornění (žádosti o heslo...) a vydání dočasného hesla
// ============================================================================
// Dočasné heslo se ukáže JEDNOU hned po vydání (nikde se neukládá). Uživatel se odhlásí ze všech
// zařízení a při příštím přihlášení si musí nastavit vlastní heslo.
export const TempPasswordDialog = ({ target, onClose, onIssued }) => {
  const [step, setStep] = useState('confirm'); // 'confirm' | 'result'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const issue = async () => {
    setBusy(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('admin_issue_temp_password', { p_user: target.id, p_notification: target.notificationId || null });
    setBusy(false);
    if (rpcError) return setError(mapAdminError(rpcError));
    setResult(data);
    setStep('result');
    onIssued?.();
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(result.temp_password); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* schránka nemusí být dostupná */ }
  };

  return (
    <div className="fixed inset-0 z-[130] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Dočasné heslo"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[92dvh] overflow-y-auto"
      >
        {step === 'confirm' ? (
          <>
            <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><KeyRound size={18} /> Vydat dočasné heslo?</h3>
            <p className="text-sm m-0 leading-relaxed">Účet: <b className="break-all">{target.username || target.email}</b>{target.email && target.username ? <span style={{ color: 'var(--text-muted)' }} className="break-all"> ({target.email})</span> : null}</p>
            <ul style={{ color: 'var(--text-muted)' }} className="text-xs m-0 pl-4 space-y-1.5 leading-relaxed">
              <li>Staré heslo přestane platit a uživatel bude <b>odhlášen ze všech zařízení</b> (už přihlášená zařízení se odhlásí nejpozději do hodiny, než vyprší jejich přihlášení).</li>
              <li>Heslo se ti ukáže <b>jen jednou</b> a nikde se neukládá.</li>
              <li>Předej ho uživateli <b>mimo aplikaci</b> a nejdřív ověř, že žádá opravdu majitel účtu. Shoda e-mailu a jména to sama nedokazuje.</li>
              <li>Při přihlášení si uživatel musí hned nastavit vlastní heslo.</li>
            </ul>
            {error && <InlineMessage type="error">{error}</InlineMessage>}
            <div className="flex gap-2 justify-end">
              <SmallButton onClick={onClose} disabled={busy}>Zrušit</SmallButton>
              <SmallButton tone="danger" busy={busy} onClick={issue}><KeyRound size={13} /> Vydat heslo</SmallButton>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><CheckCircle2 size={18} style={{ color: '#10b981' }} /> Dočasné heslo je vydané</h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">Účet <b>{result?.username || target.username}</b>. Heslo se ukazuje jen teď - až dialog zavřeš, už ho neuvidíš (můžeš vydat nové).</p>
            <div style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <code data-testid="temp-password" className="min-w-0 text-lg font-black tracking-wider break-all select-all">{result?.temp_password}</code>
              <SmallButton onClick={copy}><Copy size={13} /> {copied ? 'Zkopírováno' : 'Kopírovat'}</SmallButton>
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">Předej ho uživateli mimo aplikaci. Ze všech zařízení se odhlásí (nejpozději do hodiny) a po přihlášení si musí nastavit vlastní heslo.</p>
            <div className="flex justify-end"><SmallButton tone="primary" onClick={onClose}>Hotovo</SmallButton></div>
          </>
        )}
      </div>
    </div>
  );
};

const NOTIF_STATUS = { open: ['Otevřené', 'warn'], done: ['Vyřízeno', 'ok'], dismissed: ['Zamítnuto', 'muted'] };
const NOTIF_FILTERS = [['open', 'Otevřené'], ['all', 'Vše']];
const REPORT_STATUS = { open: ['Otevřené', 'warn'], done: ['Smazáno', 'ok'], dismissed: ['Ponecháno', 'muted'] };
const REPORT_REASONS = { spam: 'spam', abuse: 'urážky', inappropriate: 'nevhodný obsah', other: 'jiný důvod' };

export const NotificationsTab = ({ onCountChange, currentUserId, onOpenAccount }) => {
  const [filter, setFilter] = useState('open');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [issueFor, setIssueFor] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_notifications_list', { p_status: filter });
    if (rpcError) {
      if (rpcError.code === 'PGRST202' || /could not find the function|does not exist/i.test(String(rpcError.message || ''))) setMissing(true);
      else setError(mapAdminError(rpcError));
      setItems([]);
      return;
    }
    setMissing(false);
    setError('');
    setItems(data || []);
    const { data: count } = await supabase.rpc('admin_open_notifications_count');
    if (typeof count === 'number') {
      onCountChange?.(count);
      window.dispatchEvent(new CustomEvent('jomarid-admin-notifications', { detail: count }));
    }
  }, [filter, onCountChange]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (n, status) => {
    setBusyId(n.id);
    setMsg(null);
    const { error: rpcError } = await supabase.rpc('admin_set_notification_status', { p_id: n.id, p_status: status });
    setBusyId(null);
    if (rpcError) return setMsg({ type: 'error', text: mapAdminError(rpcError) });
    await load();
  };

  // Nahlášený komentář: smazat, nebo ponechat (smazání chce druhé kliknutí).
  const resolveReport = async (n, del) => {
    setBusyId(n.id);
    setMsg(null);
    setConfirmDeleteId(null);
    const { data, error: rpcError } = await supabase.rpc('admin_resolve_comment_report', { p_notification: n.id, p_delete: del });
    setBusyId(null);
    if (rpcError) return setMsg({ type: 'error', text: mapAdminError(rpcError) });
    setMsg({ type: 'success', text: del ? (data?.deleted ? 'Komentář je smazaný.' : 'Komentář už byl dřív smazaný, upozornění je vyřízené.') : 'Komentář je ponechaný.' });
    await load();
  };

  const clearHandled = async () => {
    setMsg(null);
    const { data, error: rpcError } = await supabase.rpc('admin_clear_handled_notifications');
    if (rpcError) return setMsg({ type: 'error', text: mapAdminError(rpcError) });
    setMsg({ type: 'success', text: `Smazáno vyřízených upozornění: ${data?.deleted ?? 0}.` });
    await load();
  };

  if (missing) {
    return <InlineMessage type="error">Upozornění potřebují novější databázi. Spusť v Supabase (SQL Editor) skript <b>username_zadosti.sql</b> a obnov stránku.</InlineMessage>;
  }

  const hasHandled = (items || []).some(n => n.status !== 'open');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtr upozornění" className="flex gap-1">
          {NOTIF_FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              style={filter === value ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' } : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}
              className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[11px] font-black uppercase tracking-wider">{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <SmallButton onClick={load}><RefreshCw size={13} /> Obnovit</SmallButton>
          {filter === 'all' && hasHandled && <SmallButton onClick={clearHandled}><Trash2 size={13} /> Smazat vyřízená</SmallButton>}
        </div>
      </div>

      {msg && <InlineMessage type={msg.type}>{msg.text}</InlineMessage>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      {items === null && <p style={{ color: 'var(--text-muted)' }} className="text-xs font-bold flex items-center gap-2 m-0"><Loader2 size={14} className="animate-spin" /> Načítám...</p>}
      {items && items.length === 0 && !error && (
        <Card className="text-center py-10"><p style={{ color: 'var(--text-muted)' }} className="text-xs font-bold m-0">{filter === 'open' ? 'Žádná otevřená upozornění.' : 'Zatím žádná upozornění.'}</p></Card>
      )}

      {(items || []).map(n => {
        const isReport = n.kind === 'comment_report';
        const [statusLabel, statusTone] = (isReport ? REPORT_STATUS : NOTIF_STATUS)[n.status] || [n.status, 'muted'];
        const u = n.user;
        const isPassword = n.kind === 'password_request';
        return (
          <div key={n.id} data-testid="notification">
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-black uppercase tracking-tight m-0 flex items-center gap-2">{isReport ? <Flag size={15} /> : <KeyRound size={15} />} {n.title}</h4>
                <p style={{ color: 'var(--text-muted)' }} className="text-[11px] m-0 mt-1 opacity-80">{relativeTime(n.created_at)} · {formatDateTime(n.created_at)}{n.handled_at ? ` · vyřízeno ${formatDateTime(n.handled_at)}` : ''}</p>
              </div>
              <Pill tone={statusTone}>{statusLabel}</Pill>
            </div>

            {u ? (
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs m-0">
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Účet</dt><dd className="m-0 font-semibold break-all">{u.username || '-'} <span style={{ color: 'var(--text-muted)' }}>({ROLE_LABELS[u.role] || u.role})</span></dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">E-mail</dt><dd className="m-0 font-semibold break-all">{u.email}</dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Založen</dt><dd className="m-0 font-semibold">{formatDate(u.created_at)}</dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Poslední přihlášení</dt><dd className="m-0 font-semibold">{u.last_sign_in_at ? relativeTime(u.last_sign_in_at) : 'nikdy'}</dd>
              </dl>
            ) : <InlineMessage>Účet už neexistuje.</InlineMessage>}

            {isReport && (
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs m-0">
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Kniha</dt><dd className="m-0 font-semibold break-words">{n.payload?.book_title || '-'}</dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">Nahlášení</dt>
                <dd className="m-0 font-semibold">{n.payload?.reports || 1}× <span style={{ color: 'var(--text-muted)' }}>({Object.entries(n.payload?.reasons || {}).map(([k, v]) => `${REPORT_REASONS[k] || k} ${v}×`).join(', ')})</span></dd>
              </dl>
            )}

            {n.body && <p style={{ backgroundColor: 'var(--bg-secondary)' }} className="text-sm m-0 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap break-words">„{n.body}“</p>}
            {isPassword && <p style={{ color: 'var(--text-muted)' }} className="text-[11px] m-0 leading-relaxed opacity-90">{n.payload?.logged_in ? 'Žádost poslal přihlášený uživatel z Nastavení.' : 'Žádost poslal nepřihlášený člověk (zapomenuté heslo).'} E-mail i jméno sedí, ale to samo nedokazuje, že žádá majitel účtu - ověř to mimo aplikaci.</p>}

            <div className="flex flex-wrap gap-2">
              {u && onOpenAccount && <SmallButton onClick={() => onOpenAccount(u)}><UserCog size={13} /> Otevřít účet</SmallButton>}
              {n.status === 'open' && isReport ? (
                <>
                  {confirmDeleteId === n.id
                    ? <SmallButton tone="danger" busy={busyId === n.id} onClick={() => resolveReport(n, true)}><Trash2 size={13} /> Opravdu smazat</SmallButton>
                    : <SmallButton tone="danger" busy={busyId === n.id} onClick={() => setConfirmDeleteId(n.id)}><Trash2 size={13} /> Smazat komentář</SmallButton>}
                  <SmallButton busy={busyId === n.id} onClick={() => (confirmDeleteId === n.id ? setConfirmDeleteId(null) : resolveReport(n, false))}>
                    <CheckCircle2 size={13} /> {confirmDeleteId === n.id ? 'Zpět' : 'Ponechat komentář'}
                  </SmallButton>
                </>
              ) : n.status === 'open' ? (
                <>
                  {isPassword && u && <SmallButton tone="primary" disabled={u.id === currentUserId} onClick={() => setIssueFor({ id: u.id, username: u.username, email: u.email, notificationId: n.id })}><KeyRound size={13} /> Vydat dočasné heslo</SmallButton>}
                  <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'dismissed')}><XCircle size={13} /> Zamítnout</SmallButton>
                  <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'done')}><CheckCircle2 size={13} /> Vyřízeno</SmallButton>
                </>
              ) : (
                <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'open')}><RefreshCw size={13} /> Znovu otevřít</SmallButton>
              )}
            </div>
          </Card>
          </div>
        );
      })}

      {issueFor && <TempPasswordDialog target={issueFor} onClose={() => setIssueFor(null)} onIssued={load} />}
    </div>
  );
};

// ============================================================================
// Admin: Syslog (auditní log) - filtry na serveru, hledání, období, stránkování a export do CSV
// ============================================================================
const LOG_TYPES = ['INFO', 'SUCCESS', 'WARN', 'DANGER', 'ERROR'];
const LOG_PERIODS = [['24h', 'Posledních 24 h', 86400000], ['7d', 'Posledních 7 dní', 7 * 86400000], ['30d', 'Posledních 30 dní', 30 * 86400000], ['all', 'Celá historie', null]];
const LOG_PAGE = 50;
const LOG_EXPORT_PAGE = 1000;
const LOG_EXPORT_MAX = 5000;
const LOG_TYPE_COLORS = { INFO: 'text-sky-400', SUCCESS: 'text-emerald-400', WARN: 'text-yellow-400', DANGER: 'text-red-500 font-extrabold', ERROR: 'text-red-500 font-extrabold' };

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Buňka CSV: uvozovky se zdvojují a buňka začínající = + - @ se označí apostrofem (jinak by ji Excel vyhodnotil jako vzorec).
export const csvCell = (value) => {
  let text = value == null ? '' : String(value).replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
// Středník jako oddělovač a BOM na začátku: česká verze Excelu jinak špatně čte diakritiku i sloupce.
export const buildLogsCsv = (rows) => `\uFEFF${['"Čas"', '"Typ"', '"Zpráva"'].join(';')}\r\n${rows.map(r => [csvCell(r.created_at), csvCell(r.log_type || 'INFO'), csvCell(r.message)].join(';')).join('\r\n')}`;

export const downloadTextFile = (filename, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const buildLogQuery = ({ type, period, search }, from, to) => {
  let q = supabase.from('system_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  if (type !== 'all') q = q.eq('log_type', type);
  const span = LOG_PERIODS.find(p => p[0] === period)?.[2];
  if (span) q = q.gte('created_at', new Date(Date.now() - span).toISOString());
  const text = search.trim();
  if (text) q = q.ilike('message', `%${escapeLike(text)}%`);
  return q;
};

export const LogsTab = ({ download = downloadTextFile }) => {
  const [type, setType] = useState('all');
  const [period, setPeriod] = useState('7d');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState(null);
  const requestRef = useRef(0);
  const filtersRef = useRef({ type, period, search });
  filtersRef.current = { type, period, search };

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    const id = ++requestRef.current;
    setRows(null);
    setError('');
    const { data, error: rpcError, count } = await buildLogQuery({ type, period, search }, 0, LOG_PAGE - 1);
    if (id !== requestRef.current) return; // mezitím se změnil filtr: starou odpověď zahodit
    if (rpcError) { setError('Logy se nepodařilo načíst. Zkus to znovu.'); setRows([]); setTotal(0); setHasMore(false); return; }
    const list = data || [];
    setRows(list);
    setTotal(typeof count === 'number' ? count : list.length);
    setHasMore(typeof count === 'number' ? list.length < count : list.length === LOG_PAGE);
  }, [type, period, search]);

  useEffect(() => { load(); }, [load]);

  // Nové záznamy přicházejí živě - zobrazí se jen ty, které odpovídají aktuálním filtrům.
  useEffect(() => {
    const sub = supabase.channel('sys_logs_tab')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_logs' }, (payload) => {
        const row = payload?.new;
        if (!row) return;
        const f = filtersRef.current;
        if (f.type !== 'all' && row.log_type !== f.type) return;
        const needle = f.search.trim().toLowerCase();
        if (needle && !String(row.message || '').toLowerCase().includes(needle)) return;
        setRows(prev => (prev && !prev.some(r => r.id === row.id) ? [row, ...prev] : prev));
        setTotal(prev => (typeof prev === 'number' ? prev + 1 : prev));
      }).subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  const loadMore = async () => {
    if (!rows) return;
    setLoadingMore(true);
    const { data, error: rpcError, count } = await buildLogQuery(filtersRef.current, rows.length, rows.length + LOG_PAGE - 1);
    setLoadingMore(false);
    if (rpcError) return setError('Další záznamy se nepodařilo načíst.');
    const more = (data || []).filter(r => !rows.some(x => x.id === r.id));
    const next = [...rows, ...more];
    setRows(next);
    setHasMore(typeof count === 'number' ? next.length < count : (data || []).length === LOG_PAGE);
  };

  const exportCsv = async () => {
    setExporting(true);
    setMsg(null);
    const all = [];
    let truncated = false;
    for (let from = 0; from < LOG_EXPORT_MAX; from += LOG_EXPORT_PAGE) {
      const { data, error: rpcError } = await buildLogQuery(filtersRef.current, from, from + LOG_EXPORT_PAGE - 1);
      if (rpcError) { setExporting(false); return setMsg({ type: 'error', text: 'Export se nepodařil. Zkus to znovu.' }); }
      all.push(...(data || []));
      if (!data || data.length < LOG_EXPORT_PAGE) break;
      if (from + LOG_EXPORT_PAGE >= LOG_EXPORT_MAX) truncated = true;
    }
    download(`syslog_${new Date().toISOString().slice(0, 10)}.csv`, buildLogsCsv(all));
    // Export dat je sám citlivá akce: zapíše se do logu.
    await supabase.from('system_logs').insert([{ log_type: 'INFO', message: `Správce exportoval syslog do CSV (${all.length} záznamů).` }]);
    setMsg({ type: 'success', text: truncated ? `Exportováno ${all.length} nejnovějších záznamů (nejvýš ${LOG_EXPORT_MAX}). Zúžením filtru získáš starší.` : `Exportováno záznamů: ${all.length}.` });
    setExporting(false);
  };

  const filtered = type !== 'all' || period !== '7d' || search.trim() !== '';
  const inputCls = 'bg-slate-900 border border-slate-800 rounded-lg text-emerald-400 font-mono text-xs outline-none px-2.5 py-2 placeholder:text-slate-600';

  return (
    // Pevné tmavé pozadí (ne <Card>): ten si bere barvy z motivu, takže ve světlém motivu by světlé písmo terminálu zmizelo.
    <div data-testid="logs-panel" style={{ backgroundColor: '#020617', borderColor: '#0f172a' }} className="text-emerald-400 font-mono p-4 sm:p-5 border border-solid shadow-2xl rounded-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black uppercase tracking-widest pb-3 border-b border-solid border-slate-900">
        <span className="flex items-center gap-1.5 text-slate-400"><Terminal size={14} /> Systémový log</span>
        <span className="flex items-center gap-1.5 text-[10px] text-slate-500 normal-case tracking-normal font-bold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> živě</span>
      </div>

      <div className="space-y-3">
        <div role="group" aria-label="Typ záznamu" className="flex flex-wrap gap-1.5">
          {['all', ...LOG_TYPES].map(t => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-black uppercase tracking-wider cursor-pointer ${type === t ? 'bg-emerald-400 text-slate-950 border-emerald-400' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-emerald-400'}`}>
              {t === 'all' ? 'Vše' : t}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="search" aria-label="Hledat v logu" placeholder="Hledat ve zprávách..." value={searchInput} onChange={e => setSearchInput(e.target.value)} className={`${inputCls} flex-1 min-w-0`} />
          <select aria-label="Období" value={period} onChange={e => setPeriod(e.target.value)} className={`${inputCls} cursor-pointer`}>
            {LOG_PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-bold">
        <span data-testid="logs-count">{rows === null ? 'Načítám...' : `Zobrazeno ${rows.length}${typeof total === 'number' ? ` z ${total}` : ''}${filtered ? ' (podle filtru)' : ''}`}</span>
        <span className="flex gap-2">
          <button type="button" onClick={load} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2.5 py-1.5 cursor-pointer text-[10px] font-black uppercase tracking-wider hover:text-emerald-400"><RefreshCw size={11} /> Obnovit</button>
          <button type="button" onClick={exportCsv} disabled={exporting || !rows || rows.length === 0} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2.5 py-1.5 cursor-pointer text-[10px] font-black uppercase tracking-wider hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed">
            {exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} Export CSV
          </button>
        </span>
      </div>

      {msg && <p role={msg.type === 'error' ? 'alert' : 'status'} className={`text-[11px] font-bold m-0 ${msg.type === 'error' ? 'text-red-400' : 'text-emerald-300'}`}>{msg.text}</p>}
      {error && <p role="alert" className="text-[11px] font-bold m-0 text-red-400">{error}</p>}

      <div className="max-h-[500px] overflow-y-auto space-y-1.5 pr-2 text-xs">
        {rows === null ? (
          <p className="text-slate-500 text-center py-12 m-0 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Načítám...</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-500 italic text-center py-12 m-0">{filtered ? 'Žádný záznam neodpovídá filtru.' : 'Žádné systémové logy zatím nebyly zachyceny.'}</p>
        ) : (
          rows.map((log, index) => (
            <div key={log.id || index} data-testid="log-row" className="py-1.5 border-b border-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-1 hover:bg-slate-900/30 px-1 rounded transition-colors">
              <span className="break-words min-w-0">
                <span className={`inline-block w-20 uppercase font-black ${LOG_TYPE_COLORS[log.log_type] || 'text-slate-400'}`}>[{log.log_type || 'INFO'}]</span>
                <span className="text-slate-200">{log.message}</span>
              </span>
              <span className="text-[10px] text-slate-500 shrink-0 font-sans sm:font-mono">{log.created_at ? new Date(log.created_at).toLocaleString('cs-CZ') : 'Nyní'}</span>
            </div>
          ))
        )}
        {hasMore && rows && rows.length > 0 && (
          <div className="pt-2 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-4 py-2 cursor-pointer text-[10px] font-black uppercase tracking-wider hover:text-emerald-400 disabled:opacity-50">
              {loadingMore && <Loader2 size={11} className="animate-spin" />} Načíst starší
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const AccountsTab = ({ currentUserId, preset, onChanged }) => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('created_desc');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestSeq = useRef(0);

  // Přednastavený filtr z Přehledu (např. "účty bez profilu").
  useEffect(() => {
    if (!preset) return;
    setRole(preset.role || 'all');
    setStatus(preset.status || 'all');
    setSearchInput(preset.search || '');
    setSearch(preset.search || '');
    setPage(0);
    if (preset.openId) setSelectedId(preset.openId);
  }, [preset?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    // Pořadí odpovědí se nezaručuje: když uživatel píše rychle, pomalejší starší odpověď
    // nesmí přepsat novější výsledek.
    const seq = ++requestSeq.current;
    setLoading(true);
    (async () => {
      const { data, error: rpcError } = await supabase.rpc('admin_list_users', { p_search: search, p_role: role, p_status: status, p_sort: sort, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE });
      if (seq !== requestSeq.current) return;
      if (rpcError) setError(mapAdminError(rpcError));
      else { setError(''); setResult(data); }
      setLoading(false);
    })();
  }, [search, role, status, sort, page, reloadKey]);

  const changeFilter = (setter) => (e) => { setter(e.target.value); setPage(0); };
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const from = result.total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(result.total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
            <input type="search" aria-label="Hledat účet" placeholder="Hledat podle e-mailu nebo jména..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={selectStyle} className="w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm font-semibold outline-none" />
          </div>
          <select aria-label="Filtr role" value={role} onChange={changeFilter(setRole)} style={selectStyle} className={selectClass}>{ROLE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select aria-label="Filtr stavu" value={status} onChange={changeFilter(setStatus)} style={selectStyle} className={selectClass}>{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select aria-label="Řazení" value={sort} onChange={changeFilter(setSort)} style={selectStyle} className={selectClass}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </Card>

      {error && <InlineMessage type="error">{error}</InlineMessage>}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-wider m-0">Účty <span style={{ color: 'var(--text-muted)' }} className="font-bold normal-case tracking-normal">({formatNumber(result.total)})</span></p>
          {loading && <Loader2 size={14} className="animate-spin opacity-50" />}
        </div>

        {result.rows.length === 0 && !loading ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-sm m-0 py-6 text-center opacity-70">Žádný účet neodpovídá filtru.</p>
        ) : (
          <ul className="m-0 p-0 list-none divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {result.rows.map(r => (
              <li key={r.id}>
                <button type="button" data-testid="account-row" onClick={() => setSelectedId(r.id)} className="w-full text-left bg-transparent border-none cursor-pointer text-current py-3 px-1 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 hover:bg-black/5 rounded-lg">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold break-all">{r.email}</span>
                    {r.username && <span data-testid="account-username" style={{ color: 'var(--text-muted)' }} className="block text-xs font-semibold break-all">@{r.username}</span>}
                    <span className="flex flex-wrap gap-1 mt-1">
                      <Pill tone="accent">{r.has_profile ? ROLE_LABELS[r.role] || r.role : 'Bez profilu'}</Pill>
                      {r.is_banned && <Pill tone="danger">Zablokován</Pill>}
                      {!r.email_confirmed && <Pill tone="warn">Nepotvrzen</Pill>}
                    </span>
                  </span>
                  <span style={{ color: 'var(--text-muted)' }} className="text-xs flex sm:block gap-3 sm:text-right sm:w-40 shrink-0">
                    <span className="block">přihlášen {relativeTime(r.last_sign_in_at)}</span>
                    <span className="block opacity-80">{formatNumber(r.coins)} mincí · {r.books_read} přečteno</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">Zobrazeno {from}-{to} z {formatNumber(result.total)}</p>
          <div className="flex items-center gap-2">
            <SmallButton aria-label="Předchozí strana" disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></SmallButton>
            <span className="text-xs font-bold tabular-nums">{page + 1} / {pageCount}</span>
            <SmallButton aria-label="Další strana" disabled={page + 1 >= pageCount || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></SmallButton>
          </div>
        </div>
      </Card>

      {selectedId && (
        <AccountDetail
          userId={selectedId}
          currentUserId={currentUserId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { setReloadKey(k => k + 1); onChanged?.(); }}
        />
      )}
    </div>
  );
};

export const AdminDashboard = () => {
  // --- Základní stavy dat ---
  const [books, setBooks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [comments, setComments] = useState([]);
  
  // --- Stavy rozhraní (UX) ---
  const [activeTab, setActiveTab] = useState('overview'); // overview | notifications | accounts | books | homepage | users | logs
  const [pendingCount, setPendingCount] = useState(0); // otevrena upozorneni (odznak na zalozce)
  const [logCount, setLogCount] = useState(0); // pocet zaznamu v syslogu (karta v Prehledu)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('admin_open_notifications_count');
      if (!error && typeof data === 'number') setPendingCount(data);
    })();
  }, []);
  const { user: adminUser } = useAuth();
  const [accountsPreset, setAccountsPreset] = useState(null); // filtr předaný z Přehledu do záložky Účty
  const [bulkGrantOpen, setBulkGrantOpen] = useState(false); // potvrzení hromadného rozdání knihy
  const [globalLoading, setGlobalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  
  // --- Filtry & Vyhledávání ---
  const [searchBook, setSearchBook] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [filterRole, setFilterRole] = useState('all');

  // --- Formulářové stavy pro Knihy ---
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [fakeLikes, setFakeLikes] = useState(0); 
  const [isAutoAssigned, setIsAutoAssigned] = useState(false); 
  const [priceCoins, setPriceCoins] = useState(150); 
  const [genresInput, setGenresInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [editingBookId, setEditingBookId] = useState(null);
  
  // --- Správa konkrétního uživatele ---
  const [activeUser, setActiveUser] = useState(null);
  const [selectedBookId, setSelectedBookId] = useState('');
  const [userFakeXpInput, setUserFakeXpInput] = useState(0);
  const [coinGrantInput, setCoinGrantInput] = useState('');
  const [coinGrantReason, setCoinGrantReason] = useState('');

  // --- Nastavení domovské stránky ---
  const [hpHeadline, setHpHeadline] = useState('');
  const [hpSubtitle, setHpSubtitle] = useState('');
  const [hpFeaturedBookIds, setHpFeaturedBookIds] = useState([]);
  const [hpFontQuote, setHpFontQuote] = useState('');
  const [hpFontAttribution, setHpFontAttribution] = useState('');
  const [hpWhyRead, setHpWhyRead] = useState([
    { title: '', description: '' }, { title: '', description: '' },
    { title: '', description: '' }, { title: '', description: '' },
  ]);
  const [savingHomepage, setSavingHomepage] = useState(false);
  const [resolveAuthorSelections, setResolveAuthorSelections] = useState({});

  // Bezpečný zápis do systémových logů
  const safeLog = async (logType, message) => {
    try {
      await supabase.from('system_logs').insert([{ log_type: logType, message }]);
    } catch (err) {
      console.warn("Logování do DB selhalo (RLS/403):", message);
    }
  };

  // Hlavní funkce pro načtení všech dat ze systému
  const refreshData = async () => {
    setGlobalLoading(true);
    try {
      // 1. Načtení knih
      const { data: b } = await supabase
        .from('books')
        .select('id, title, author, author_display, author_id, fake_likes, is_auto_assigned, price_coins, book_likes(count)');

      // Skryté knihy zvlášť: kdyby sloupec is_hidden ještě neexistoval (starší databáze), jen se nezobrazí štítky.
      const { data: hiddenRows, error: hiddenErr } = await supabase.from('books').select('id, is_hidden');
      const hiddenMap = new Map((!hiddenErr && hiddenRows ? hiddenRows : []).map(r => [r.id, !!r.is_hidden]));
        
      // 2. Načtení profilů
      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      
      const { count: logsTotal } = await supabase.from('system_logs').select('id', { count: 'exact', head: true });
      setLogCount(typeof logsTotal === 'number' ? logsTotal : 0);

      // 4. Posledních 50 komentářů napříč knihami - pro moderaci (viz sekce Komentáře).
      const { data: c } = await supabase
        .from('book_comments')
        .select('id, content, author_name, book_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      // 5. Nastavení domovské stránky
      const { data: settings } = await supabase.from('site_settings').select('key, value');
      const settingsMap = {};
      (settings || []).forEach(row => { settingsMap[row.key] = row.value; });

      const hero = settingsMap.homepage_hero || {};
      setHpHeadline(hero.headline || '');
      setHpSubtitle(hero.subtitle || '');

      setHpFeaturedBookIds(settingsMap.homepage_featured_books?.book_ids || []);

      const fontDemo = settingsMap.homepage_font_demo || {};
      setHpFontQuote(fontDemo.quote || '');
      setHpFontAttribution(fontDemo.attribution || '');

      const whyReadItems = settingsMap.homepage_why_read?.items;
      if (Array.isArray(whyReadItems) && whyReadItems.length === 4) {
        setHpWhyRead(whyReadItems);
      }

      const booksWithLikes = b?.map(book => {
        const realLikes = book.book_likes?.[0]?.count || 0;
        const fikes = book.fake_likes || 0;
        return {
          id: book.id,
          title: book.title,
          author: book.author,
          authorDisplay: book.author_display || book.author,
          authorId: book.author_id || null,
          fake_likes: fikes,
          is_auto_assigned: book.is_auto_assigned || false,
          isHidden: hiddenMap.get(book.id) || false,
          price_coins: book.price_coins ?? 150,
          likesCount: realLikes + fikes 
        };
      }) || [];

      // Synchronizace rozpracovaného uživatele po refreshování dat
      if (activeUser) {
        const updatedActiveUser = p?.find(u => u.id === activeUser.id);
        if (updatedActiveUser) {
          setActiveUser(updatedActiveUser);
          setUserFakeXpInput(updatedActiveUser.fake_xp || 0);
        }
      }

      const mapovaneKomentare = c?.map(cm => ({
        ...cm,
        bookTitle: b?.find(k => k.id === cm.book_id)?.title || `Kniha ID: ${cm.book_id?.substring(0, 6)}...`
      })) || [];

      setBooks(booksWithLikes); 
      setProfiles(p || []); 
      setComments(mapovaneKomentare);
    } catch (err) {
      console.error("Chyba v refreshData:", err);
    } finally {
      setGlobalLoading(false);
    }
  };

  // Inicializace a real-time poslech na systémové logy
  useEffect(() => {
    refreshData();
  }, []);

  // --- Klientské vyhledávací a filtrační procesory (useMemo) ---
  const filteredBooks = useMemo(() => {
    return books.filter(b => 
      b.title.toLowerCase().includes(searchBook.toLowerCase()) || 
      b.author.toLowerCase().includes(searchBook.toLowerCase()) ||
      (b.authorDisplay && b.authorDisplay.toLowerCase().includes(searchBook.toLowerCase()))
    );
  }, [books, searchBook]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter(p => {
      const matchesSearch = p.email?.toLowerCase().includes(searchUser.toLowerCase());
      const matchesRole = filterRole === 'all' || (p.role || 'uživatel') === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [profiles, searchUser, filterRole]);


  // --- Handlery akcí ---
  const handleResolveAuthorId = async (bookId) => {
    const selectedProfileId = resolveAuthorSelections[bookId];
    if (!selectedProfileId) return;
    const selectedProfile = profiles.find(p => p.id === selectedProfileId);
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('books')
        .update({ author_id: selectedProfileId, author_display: selectedProfile?.pen_name || null })
        .eq('id', bookId);
      if (error) throw error;
      await safeLog('SUCCESS', `Kniha ID ${bookId} ručně propojena s účtem ${selectedProfile?.email || selectedProfileId}.`);
      setResolveAuthorSelections(prev => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
      refreshData();
    } catch (err) {
      alert('Přiřazení účtu selhalo: ' + (err.message || 'neznámá chyba'));
    } finally {
      setActionLoading(false);
    }
  };

  const saveBook = async (e) => {
    e.preventDefault();
    if (!title) return alert('Doplňte název knihy.');
    setActionLoading(true);

    // POZOR: 'content' už NENÍ sloupec v 'books' - text knihy žije v samostatné
    // tabulce 'book_contents', která má vlastní (přísnější) RLS. 'books' zůstává
    // volně čitelná pro procházení knihovny/nákup, ale bez samotného textu.
    // Kdyby autor uz ma nastavene kryci jmeno (viz Nakladatelský panel),
    // rovnou se pouzije i tady - jinak by kniha po preprirazeni admin em
    // ukazovala skutecne uzivatelske jmeno, dokud by ji nakladatel sam
    // znovu neulozil. author_id se hleda stejne opatrne jako jednorazovy
    // dopocet v migraci: jednoznacna shoda se rovnou pouzije, pri kolizi
    // (vic uctu se stejnou predponou e-mailu) se da prednost nakladatel/
    // správce roli, a kdyby bylo nejednoznacno i mezi nimi, radsi se nic
    // nehada a author_id zustane prazdne, nez aby se kniha omylem prirad
    // ila spatnemu uctu.
    const targetUsername = (author || '').trim();
    const matchingProfiles = profiles.filter(p => p.email && (p.username || p.email.split('@')[0]) === targetUsername);
    let resolvedProfile = null;
    if (matchingProfiles.length === 1) {
      resolvedProfile = matchingProfiles[0];
    } else if (matchingProfiles.length > 1) {
      const preferred = matchingProfiles.filter(p => p.role === 'nakladatel' || p.role === 'správce');
      if (preferred.length === 1) resolvedProfile = preferred[0];
      // jinak nejednoznacne i mezi preferovanymi rolemi - author_id zustane null
    }
    const payload = { 
      title, 
      author: author || 'Neznámý', 
      author_id: resolvedProfile?.id || null,
      author_display: resolvedProfile?.pen_name || null,
      fake_likes: parseInt(fakeLikes) || 0,
      is_auto_assigned: isAutoAssigned,
      price_coins: Math.max(0, parseInt(priceCoins, 10) || 0),
      genres: genresInput.split(',').map(g => g.trim()).filter(Boolean),
      description: descriptionInput || null
    };

    if (editingBookId) {
      const { error } = await supabase.from('books').update(payload).eq('id', editingBookId);
      if (!error) {
        const { error: contentErr } = await supabase
          .from('book_contents')
          .upsert({ book_id: editingBookId, content });
        if (contentErr) alert('Kniha uložena, ale text se nepodařilo uložit: ' + contentErr.message);
        await safeLog('SUCCESS', `Upravena kniha: ${title} (Auto-přiřazení: ${isAutoAssigned ? 'ANO' : 'NE'}, Cena: ${payload.price_coins} mincí)`);
        setEditingBookId(null);
        setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(150); setGenresInput(''); setDescriptionInput('');
        refreshData();
      } else {
        alert('Chyba při úpravě: ' + error.message);
      }
    } else {
      if (!content) { setActionLoading(false); return alert('Doplňte text knihy.'); }
      const { data: newBook, error } = await supabase.from('books').insert([payload]).select('id').single();
      if (!error && newBook) {
        const { error: contentErr } = await supabase
          .from('book_contents')
          .insert([{ book_id: newBook.id, content }]);
        if (contentErr) alert('Kniha vytvořena, ale text se nepodařilo uložit: ' + contentErr.message);
        await safeLog('SUCCESS', `Uložená nová kniha: ${title} (Auto-přiřazení: ${isAutoAssigned ? 'ANO' : 'NE'}, Cena: ${payload.price_coins} mincí)`);
        setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(150); setGenresInput(''); setDescriptionInput('');
        refreshData();
      } else {
        alert('Chyba při ukládání: ' + (error?.message || 'neznámá chyba'));
      }
    }
    setActionLoading(false);
  };

  const startEditBook = async (book) => {
    const [{ data, error }, { data: contentRow, error: contentErr }] = await Promise.all([
      supabase.from('books').select('fake_likes, is_auto_assigned, price_coins, genres, description').eq('id', book.id).single(),
      supabase.from('book_contents').select('content').eq('book_id', book.id).maybeSingle()
    ]);
    if (!error && data && !contentErr) {
      setEditingBookId(book.id);
      setTitle(book.title);
      setAuthor(book.author);
      setContent(contentRow?.content || '');
      setFakeLikes(data.fake_likes || 0);
      setIsAutoAssigned(data.is_auto_assigned || false);
      setPriceCoins(data.price_coins ?? 150);
      setGenresInput(Array.isArray(data.genres) ? data.genres.join(', ') : '');
      setDescriptionInput(data.description || '');
      setActiveTab('books'); 
    } else {
      alert('Nepodařilo se načíst kompletní text knihy k editaci.');
    }
  };

  const handleSaveFakeXp = async () => {
    if (!activeUser) return;
    let xpNum = parseInt(userFakeXpInput) || 0;
    if (xpNum >= 1000000) xpNum = 1000000;
    
    setActionLoading(true);
    const { error } = await supabase.from('profiles').update({ fake_xp: xpNum }).eq('id', activeUser.id);

    if (!error) {
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} nastaveno ${xpNum} bonusových XP.`);
      setActiveUser(prev => prev ? { ...prev, fake_xp: xpNum } : null);
      setUserFakeXpInput(xpNum);
      refreshData();
    } else {
      alert('Chyba při ukládání XP: ' + error.message);
    }
    setActionLoading(false);
  };

  const handleGrantCoins = async () => {
    if (!activeUser) return;
    const amountNum = parseInt(coinGrantInput, 10);
    if (!amountNum) return alert('Zadej nenulovou částku (záporná = odečíst).');

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_grant_coins', {
        target_user_id: activeUser.id,
        amount: amountNum,
        reason: coinGrantReason || null
      });
      if (error) throw error;
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} připsáno ${amountNum} mincí (${coinGrantReason || 'bez důvodu'}). Nový zůstatek: ${data?.new_balance}.`);
      setActiveUser(prev => prev ? { ...prev, coins: data?.new_balance } : null);
      setCoinGrantInput('');
      setCoinGrantReason('');
      refreshData();
    } catch (err) {
      alert('Připsání mincí selhalo: ' + (err.message || 'neznámá chyba'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleGrantStreakFreeze = async () => {
    if (!activeUser) return;
    setActionLoading(true);
    try {
      const newCount = (activeUser.streak_freezes || 0) + 1;
      const { error } = await supabase.from('profiles').update({ streak_freezes: newCount }).eq('id', activeUser.id);
      if (error) throw error;
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} přidán 1 Streak Freeze (nyní ${newCount}).`);
      setActiveUser(prev => prev ? { ...prev, streak_freezes: newCount } : null);
      refreshData();
    } catch (err) {
      alert('Přidání Streak Freeze selhalo: ' + (err.message || 'neznámá chyba'));
    } finally {
      setActionLoading(false);
    }
  };

  const toggleFeaturedBook = (bookId) => {
    setHpFeaturedBookIds(prev =>
      prev.includes(bookId) ? prev.filter(id => id !== bookId) : [...prev, bookId]
    );
  };

  const updateWhyReadItem = (idx, field, value) => {
    setHpWhyRead(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  };

  const saveHomepageSettings = async () => {
    setSavingHomepage(true);
    try {
      const rows = [
        { key: 'homepage_hero', value: { headline: hpHeadline, subtitle: hpSubtitle } },
        { key: 'homepage_featured_books', value: { book_ids: hpFeaturedBookIds } },
        { key: 'homepage_font_demo', value: { quote: hpFontQuote, attribution: hpFontAttribution } },
        { key: 'homepage_why_read', value: { items: hpWhyRead } },
      ];
      const { error } = await supabase.from('site_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
      await safeLog('SUCCESS', 'Aktualizován obsah domovské stránky.');
      alert('Domovská stránka uložena.');
    } catch (err) {
      alert('Uložení domovské stránky selhalo: ' + (err.message || 'neznámá chyba'));
    } finally {
      setSavingHomepage(false);
    }
  };

  const handleDeleteComment = async (commentId, preview) => {
    if (!confirm(`Smazat komentář "${preview}"?`)) return;
    try {
      const { error } = await supabase.from('book_comments').delete().eq('id', commentId);
      if (error) throw error;
      setComments(prev => prev.filter(cm => cm.id !== commentId));
      await safeLog('SUCCESS', `Smazán komentář (moderace): "${preview}"`);
    } catch (err) {
      alert('Smazání komentáře selhalo: ' + (err.message || 'neznámá chyba'));
    }
  };

  const toggleRole = async (uId, currentRole) => {
    let nextRole = 'uživatel';
    if (currentRole === 'uživatel') nextRole = 'nakladatel';
    else if (currentRole === 'nakladatel') nextRole = 'správce';
    else if (currentRole === 'správce') nextRole = 'uživatel';

    const { error } = await supabase.from('profiles').update({ role: nextRole }).eq('id', uId);
    if (!error) {
      await safeLog('WARN', `Změna role uživatele ${uId} na ${nextRole}`);
      refreshData();
    } else {
      alert('Chyba při změně role: ' + error.message);
    }
  };

  // Skrytá kniha zmizí z katalogu pro čtenáře; autor a správce ji dál vidí. Autor ji může zase zveřejnit sám.
  const toggleBookHidden = async (book) => {
    setActionLoading(true);
    const { error } = await supabase.from('books').update({ is_hidden: !book.isHidden }).eq('id', book.id);
    if (!error) {
      await safeLog('WARN', `${book.isHidden ? 'Znovu zveřejněna' : 'Skryta'} kniha: ${book.title}`);
      refreshData();
    } else {
      alert('Chyba při změně viditelnosti knihy: ' + error.message);
    }
    setActionLoading(false);
  };

  const toggleBookAutoAssign = async (bookId, currentStatus) => {
    setActionLoading(true);
    const { error } = await supabase
      .from('books')
      .update({ is_auto_assigned: !currentStatus })
      .eq('id', bookId);

    if (!error) {
      await safeLog('SUCCESS', `Změněn status automatického přidělení pro Knihu ID: ${bookId}`);
      refreshData();
    } else {
      alert('Chyba při změně auto-assign stavu: ' + error.message);
    }
    setActionLoading(false);
  };

  const revokeAllLicenses = async (uId, uEmail) => {
    if (!confirm(`🚨 OPRAVDU CHCETE ODEBRAT VŠECHNY LICENCE uživateli ${uEmail}? Uživatel ztratí přístup ke všem knihám.`)) return;
    setActionLoading(true);
    const { error } = await supabase.from('user_books').delete().eq('user_id', uId);
    if (!error) {
      await safeLog('WARN', `Kompletní revokace licencí pro uživatele: ${uEmail}`);
      alert('Všechny přístupy byly smazány.');
      refreshData();
    } else {
      alert('Chyba při odebírání: ' + error.message);
    }
    setActionLoading(false);
  };

  const assignBookToUser = async () => {
    if (!activeUser || !selectedBookId) return;
    setActionLoading(true);
    
    const { data: existing } = await supabase
      .from('user_books')
      .select('id, status')
      .eq('user_id', activeUser.id)
      .eq('book_id', selectedBookId)
      .single();

    let error;
    if (existing) {
      const { error: updateError } = await supabase.from('user_books').update({ status: 'active' }).eq('id', existing.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase.from('user_books').insert([{ user_id: activeUser.id, book_id: selectedBookId, status: 'active' }]);
      error = insertError;
    }
    
    if (error) {
      alert('Chyba při přiřazování licence: ' + error.message);
    } else {
      await safeLog('SUCCESS', `Přiřazena aktivní kniha uživateli ${activeUser.email}`);
      setSelectedBookId('');
      refreshData();
    }
    setActionLoading(false);
  };

  const assignAllBooksToUser = async () => {
    if (!activeUser || books.length === 0) return;
    if (!confirm(`Opravdu chcete uživateli ${activeUser.email} okamžitě odemknout ÚPLNĚ VŠECHNY knihy?`)) return;

    setActionLoading(true);
    try {
      const { data: existingUserBooks, error: fetchError } = await supabase.from('user_books').select('book_id, id, status').eq('user_id', activeUser.id);
      if (fetchError) throw fetchError;
      
      const existingBookIds = existingUserBooks?.map(ub => ub.book_id) || [];
      const requestedEntries = existingUserBooks?.filter(ub => ub.status === 'requested') || [];

      if (requestedEntries.length > 0) {
        await supabase.from('user_books').update({ status: 'active' }).in('id', requestedEntries.map(re => re.id));
      }

      const booksToAssign = books.filter(b => !existingBookIds.includes(b.id));
      if (booksToAssign.length > 0) {
        const insertData = booksToAssign.map(b => ({ user_id: activeUser.id, book_id: b.id, status: 'active' }));
        const { error: insertError } = await supabase.from('user_books').insert(insertData);
        if (insertError) throw insertError;
      }

      await safeLog('SUCCESS', `Hromadně aktivovány VŠECHNY knihy pro: ${activeUser.email}`);
      refreshData();
    } catch (err) {
      alert('Chyba: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Rozdání knihy VŠEM účtům je nevratné a ničí její cenu, proto se místo prostého
  // "OK / Zrušit" musí opsat název knihy (viz TypedConfirm dole).
  const assignSelectedBookToAllUsers = () => {
    if (!selectedBookId) return alert('Nejprve zvolte knihu z rozevíracího seznamu.');
    const selectedBook = books.find(b => b.id === selectedBookId);
    if (!selectedBook) return;
    if (profiles.length === 0) return alert('V systému nejsou žádní uživatelé.');
    setBulkGrantOpen(true);
  };

  const runBulkGrant = async () => {
    const selectedBook = books.find(b => b.id === selectedBookId);
    if (!selectedBook) return setBulkGrantOpen(false);
    setBulkGrantOpen(false);
    setActionLoading(true);
    try {
      const { data: alreadyHasBook, error: fetchError } = await supabase.from('user_books').select('user_id, id, status').eq('book_id', selectedBookId);
      if (fetchError) throw fetchError;
      
      const userIdsWithBook = alreadyHasBook?.map(ub => ub.user_id) || [];
      const requestedEntries = alreadyHasBook?.filter(ub => ub.status === 'requested') || [];

      if (requestedEntries.length > 0) {
        await supabase.from('user_books').update({ status: 'active' }).in('id', requestedEntries.map(re => re.id));
      }

      const profilesToAssign = profiles.filter(p => !userIdsWithBook.includes(p.id));
      if (profilesToAssign.length > 0) {
        const insertData = profilesToAssign.map(p => ({ user_id: p.id, book_id: selectedBookId, status: 'active' }));
        const { error: insertError } = await supabase.from('user_books').insert(insertData);
        if (insertError) throw insertError;
      }

      await safeLog('SUCCESS', `Kniha "${selectedBook.title}" byla globálně aktivována všem uživatelům.`);
      setSelectedBookId('');
      refreshData();
    } catch (err) {
      alert('Chyba při hromadném sdílení: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const currentSelectedBook = books.find(b => b.id === selectedBookId);

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-7xl mx-auto px-4 py-8 animate-in fade-in duration-200 space-y-6">
      
      {/* HEADER DASHBOARDU */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-solid gap-4" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Shield size={26} className="text-red-500 animate-pulse" /> Core Admin Panel 2026
          </h1>
          <p className="text-xs font-semibold opacity-70" style={{ color: 'var(--text-muted)' }}>
            Komplexní správa licencí, autorských práv, uživatelských klanů a systémových logů.
          </p>
        </div>
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <Button 
            onClick={refreshData} 
            disabled={globalLoading || actionLoading}
            variant="secondary"
            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border rounded-lg hover:opacity-80 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={globalLoading ? "animate-spin" : ""} /> Sync Data
          </Button>
        </div>
      </div>

      {/* STATISTICKÉ UKAZATELE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="flex items-center gap-4 py-4 relative overflow-hidden">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500"><Database size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-60">Katalog Titulů</h4>
            <p className="text-xl font-black">{books.length} Knih v DB</p>
          </div>
        </Card>
        <Card style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex items-center gap-4 py-4">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500"><Users size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-60">Komunita</h4>
            <p className="text-xl font-black">{profiles.length} Čtenářů</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500"><Terminal size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-60">Live Stream Log</h4>
            <p className="text-xl font-black">{logCount} Záznamů</p>
          </div>
        </Card>
      </div>

      {/* TAB NAVIGACE */}
      <div className="flex border-b font-black text-xs uppercase tracking-wider space-x-1 overflow-x-auto scrollbar-hide" style={{ borderColor: 'var(--border-color)' }}>
        {[
          { id: 'overview', label: 'Přehled', icon: <LayoutDashboard size={14} /> },
          { id: 'notifications', label: 'Upozornění', icon: <Bell size={14} />, badge: pendingCount },
          { id: 'accounts', label: 'Účty', icon: <UserCog size={14} /> },
          { id: 'books', label: 'Knihovna & Editace', icon: <Database size={14} /> },
          { id: 'homepage', label: 'Domovská stránka', icon: <Layout size={14} /> },
          { id: 'users', label: 'Licence & odměny', icon: <Users size={14} /> },
          { id: 'logs', label: 'Systémový Syslog', icon: <Terminal size={14} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchBook(''); }}
            style={{ 
              backgroundColor: activeTab === tab.id ? 'var(--bg-secondary)' : 'transparent',
              borderColor: activeTab === tab.id ? 'var(--border-color)' : 'transparent',
              color: activeTab === tab.id ? 'var(--bg-primary)' : 'var(--text-muted)'
            }}
            className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-4 py-3 border-t border-x rounded-t-xl transition-all cursor-pointer -mb-[1px]`}
          >
            {tab.icon} {tab.label}
            {tab.badge > 0 && <span data-testid="tab-badge" className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black leading-[18px] text-center">{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* INDIKÁTOR AKČNÍHO LOADINGU */}
      {actionLoading && (
        <div className="w-full bg-yellow-500 text-black text-center text-xs font-black py-1 rounded animate-pulse uppercase tracking-widest">
          Probíhá zápis do databáze Supabase... Čekejte prosím.
        </div>
      )}

      {activeTab === 'overview' && (
        <OverviewTab
          onOpenAccounts={(preset) => { setAccountsPreset({ ...preset, nonce: Date.now() }); setActiveTab('accounts'); }}
          onOpenBooks={() => setActiveTab('books')}
        />
      )}

      {activeTab === 'notifications' && (
        <NotificationsTab onCountChange={setPendingCount} currentUserId={adminUser?.id} onOpenAccount={(u) => { setAccountsPreset({ search: u.email || '', openId: u.id, nonce: Date.now() }); setActiveTab('accounts'); }} />
      )}

      {activeTab === 'accounts' && (
        <AccountsTab currentUserId={adminUser?.id} preset={accountsPreset} onChanged={refreshData} />
      )}

      {/* 2. ZÁLOŽKA: SPRÁVA KNIH */}
      {activeTab === 'books' && (
        <div className="space-y-6">
        {books.some(b => !b.authorId && !b.is_auto_assigned) && (
          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-1 flex items-center gap-2 text-red-500">
              <ShieldAlert size={16} /> Knihy bez propojeného účtu
            </h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4 opacity-70">
              U těchto knih se nepodařilo jednoznačně dohledat, kterému účtu patří (typicky když víc účtů sdílí stejnou předponu e-mailu) - vlastnická kontrola bez toho nefunguje správně. Vyber ručně správný účet.
            </p>
            <div className="space-y-2">
              {books.filter(b => !b.authorId && !b.is_auto_assigned).map(b => (
                <div key={b.id} style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  <span className="text-xs font-bold flex-1 min-w-0 truncate">{b.title} <span style={{ color: 'var(--text-muted)' }} className="opacity-60 font-medium">({b.author})</span></span>
                  <select
                    value={resolveAuthorSelections[b.id] || ''}
                    onChange={e => setResolveAuthorSelections(prev => ({ ...prev, [b.id]: e.target.value }))}
                    style={{ backgroundColor: 'var(--bg-body)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="p-2 border rounded-lg text-xs font-bold outline-none cursor-pointer w-full sm:w-64"
                  >
                    <option value="">-- Vyber správný účet --</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.email} ({p.role})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleResolveAuthorId(b.id)}
                    disabled={!resolveAuthorSelections[b.id]}
                    style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    className="px-4 py-2 rounded-lg font-black uppercase text-[10px] border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    Přiřadit
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <Card>
              <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                {editingBookId ? <ShieldAlert size={16} className="text-yellow-500"/> : <Plus size={16}/>}
                {editingBookId ? 'Upravit digitální titul' : 'Registrovat nový digitální titul'}
              </h3>
              <form onSubmit={saveBook} className="space-y-3">
                <input 
                  type="text" 
                  placeholder="Přesný název knihy..." 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none placeholder:opacity-40" 
                  required 
                />
                <input 
                  type="text" 
                  placeholder="Autor / Vydavatel..." 
                  value={author} 
                  onChange={e => setAuthor(e.target.value)} 
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none placeholder:opacity-40" 
                />
                
                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Umělá Prestiž (Počet Fake Lajků)</label>
                  <input 
                    type="number" 
                    placeholder="Počet lajků..." 
                    value={fakeLikes} 
                    onChange={e => setFakeLikes(Math.max(0, parseInt(e.target.value) || 0))} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70 flex items-center gap-1"><Coins size={11} /> Cena licence (Jomarid Coins)</label>
                  <input 
                    type="number" 
                    placeholder="Cena v mincích..." 
                    value={priceCoins} 
                    onChange={e => setPriceCoins(Math.max(0, parseInt(e.target.value) || 0))} 
                    disabled={isAutoAssigned}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none disabled:opacity-40" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Žánry (oddělené čárkou)</label>
                  <input 
                    type="text" 
                    placeholder="např. Sci-Fi, Dobrodružství" 
                    value={genresInput} 
                    onChange={e => setGenresInput(e.target.value)} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Popis (pro nákupní/detailní obrazovku)</label>
                  <textarea
                    placeholder="Krátký popis, co čtenáře čeká - zobrazí se v detailu knihy před koupí..."
                    value={descriptionInput}
                    onChange={e => setDescriptionInput(e.target.value)}
                    rows={3}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none resize-none placeholder:opacity-40 placeholder:font-medium"
                  />
                </div>

                <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }} className="flex items-center gap-3 p-3 border rounded-xl mb-4 shadow-inner">
                  <input 
                    type="checkbox" 
                    id="is_auto_assigned"
                    checked={isAutoAssigned} 
                    onChange={(e) => setIsAutoAssigned(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="is_auto_assigned" className="text-[10px] font-black uppercase tracking-wide cursor-pointer select-none flex items-center gap-1.5">
                    <Sparkles size={12} className="text-yellow-500 fill-current" /> Automatická kniha (Přiřadit všem zdarma)
                  </label>
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Obsah a Text knihy</label>
                  <textarea 
                    placeholder="Sem vložte čistý text knihy, kapitoly nebo markdown..." 
                    value={content} 
                    onChange={e => setContent(e.target.value)} 
                    rows={8} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-medium outline-none resize-none font-mono placeholder:opacity-40" 
                    required 
                  />
                </div>
                
                <Button type="submit" disabled={actionLoading} className="w-full py-3 uppercase tracking-wider font-black">
                  {editingBookId ? '💾 Aktualizovat data v DB' : '🚀 Vydat knihu do oběhu'}
                </Button>

                {editingBookId && (
                  <button 
                    type="button" 
                    onClick={() => { setEditingBookId(null); setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(150); setGenresInput(''); }}
                    style={{ color: 'var(--text-muted)' }}
                    className="w-full py-2 text-xs hover:underline uppercase cursor-pointer bg-transparent border-none font-bold tracking-wide"
                  >
                    Stornovat úpravy
                  </button>
                )}
              </form>
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="flex gap-2 items-center p-2 rounded-xl border border-solid" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <Search size={16} className="opacity-60 ml-2 shadow-sm shrink-0" />
              <input 
                type="text"
                placeholder="Filtrovat knihy podle názvu či autora..."
                value={searchBook}
                onChange={e => setSearchBook(e.target.value)}
                className="w-full bg-transparent border-none outline-none font-bold text-xs p-1"
              />
              {searchBook && <button onClick={() => setSearchBook('')} className="text-xs px-2 opacity-50 hover:opacity-100 font-bold">X</button>}
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b font-black text-xs uppercase tracking-wider flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
                <span>Inventář titulů (Katalog aplikací)</span>
                <span className="opacity-60">{filteredBooks.length} nalezeno</span>
              </div>
              <div className="p-2 max-h-[500px] overflow-y-auto space-y-1.5">
                {filteredBooks.length === 0 ? (
                  <p className="text-xs font-bold text-center py-8 italic opacity-50">Žádné knihy neodpovídají vyhledávacímu dotazu.</p>
                ) : (
                  filteredBooks.map(b => (
                    <div key={b.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex justify-between items-center p-3 rounded-xl text-xs font-bold gap-4 hover:opacity-95 transition-opacity">
                      <span className="truncate flex-1">
                        <span className="text-sm font-black block truncate flex items-center gap-1.5">
                          {b.title}
                          {b.isHidden && (
                            <span data-testid="hidden-badge" className="bg-slate-500/20 text-slate-500 font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide flex items-center gap-0.5">
                              <EyeOff size={10} /> Skrytá
                            </span>
                          )}
                          {b.is_auto_assigned && (
                            <span className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide flex items-center gap-0.5">
                              <Sparkles size={10} className="fill-current" /> Auto
                            </span>
                          )}
                          {!b.is_auto_assigned && (
                            <span className="bg-amber-500/20 text-amber-500 font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide flex items-center gap-0.5">
                              <Coins size={10} /> {b.price_coins ?? 150}
                            </span>
                          )}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }} className="opacity-70 font-medium">Autor: {b.authorDisplay}</span>
                      </span>
                      
                      <div style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--bg-secondary)' }} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] shrink-0 font-black shadow-sm">
                        <Heart size={10} className="fill-current" />
                        <span>{b.likesCount}</span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button 
                          onClick={() => startEditBook(b)}
                          style={{ color: 'var(--bg-primary)' }}
                          className="bg-transparent border-none cursor-pointer hover:scale-110 transition-transform font-bold text-base"
                          title="Editovat parametry a text"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => toggleBookHidden(b)}
                          disabled={actionLoading}
                          aria-label={b.isHidden ? `Zveřejnit knihu ${b.title}` : `Skrýt knihu ${b.title}`}
                          aria-pressed={b.isHidden}
                          style={{ color: b.isHidden ? 'var(--bg-primary)' : 'var(--text-muted)' }}
                          className="bg-transparent border-none cursor-pointer hover:scale-110 transition-transform flex items-center disabled:opacity-40"
                          title={b.isHidden ? 'Skrytá - klikni pro zveřejnění' : 'Skrýt před čtenáři'}
                        >
                          {b.isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button 
                          onClick={async () => { 
                            if(confirm(`Smazat knihu "${b.title}" natvrdo z DB? Tato akce smaže i existující uživatelské licence!`)) { 
                              await supabase.from('books').delete().eq('id', b.id); 
                              await safeLog('DANGER', `Smazána kniha z databáze: ${b.title}`);
                              refreshData(); 
                            } 
                          }} 
                          style={{ color: 'var(--text-muted)' }}
                          className="bg-transparent border-none cursor-pointer hover:text-red-500 hover:scale-110 transition-all flex items-center"
                          title="Smazat titul z DB"
                        >
                          <Trash size={14}/>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b font-black text-xs uppercase tracking-wider flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
            <span>Moderace komentářů (posledních 50 napříč knihami)</span>
            <span className="opacity-60">{comments.length} nalezeno</span>
          </div>
          <div className="p-2 max-h-80 overflow-y-auto space-y-1.5">
            {comments.length === 0 ? (
              <p className="text-xs font-bold text-center py-8 italic opacity-50">Zatím žádné komentáře.</p>
            ) : (
              comments.map(cm => (
                <div key={cm.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex justify-between items-center p-3 rounded-xl text-xs font-bold gap-4">
                  <span className="truncate flex-1">
                    <span style={{ color: 'var(--bg-primary)' }} className="font-black block truncate">{cm.author_name} <span style={{ color: 'var(--text-muted)' }} className="font-medium opacity-70">na {cm.bookTitle}</span></span>
                    <span style={{ color: 'var(--text-body)' }} className="opacity-90 font-medium">{cm.content}</span>
                  </span>
                  <button
                    onClick={() => handleDeleteComment(cm.id, cm.content)}
                    style={{ color: 'var(--text-muted)' }}
                    className="bg-transparent border-none cursor-pointer hover:text-red-500 hover:scale-110 transition-all flex items-center shrink-0"
                    title="Smazat komentář"
                  >
                    <Trash size={14}/>
                  </button>
                </div>
              ))
            )}
          </div>
        </Card>
        </div>
      )}

      {/* 2b. ZÁLOŽKA: DOMOVSKÁ STRÁNKA */}
      {activeTab === 'homepage' && (
        <div className="space-y-6">
          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Layout size={16} /> Hlavní nadpis a podtext
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Nadpis (hero)</label>
                <input
                  type="text"
                  value={hpHeadline}
                  onChange={e => setHpHeadline(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Podtext</label>
                <textarea
                  value={hpSubtitle}
                  onChange={e => setHpSubtitle(e.target.value)}
                  rows={3}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none resize-none"
                />
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Sparkles size={16} /> Doporučené tituly na domovské stránce
            </h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4 opacity-70">
              Zaškrtni, které knihy se mají zobrazit v sekci "Hlavní tituly". Nezáleží na pořadí zaškrtnutí.
            </p>
            <div style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl divide-y max-h-64 overflow-y-auto">
              {books.length === 0 ? (
                <p className="text-xs font-bold text-center py-6 opacity-50">Zatím žádné knihy v katalogu.</p>
              ) : (
                books.map(b => (
                  <label key={b.id} style={{ borderColor: 'var(--border-color)' }} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors">
                    <input
                      type="checkbox"
                      checked={hpFeaturedBookIds.includes(b.id)}
                      onChange={() => toggleFeaturedBook(b.id)}
                      className="w-4 h-4 cursor-pointer shrink-0"
                    />
                    <span className="text-xs font-bold truncate">{b.title}</span>
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60 shrink-0 ml-auto">{b.authorDisplay}</span>
                  </label>
                ))
              )}
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[10px] mt-2 opacity-60">{hpFeaturedBookIds.length} vybráno</p>
          </Card>

          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Award size={16} /> Ukázka pro demo velikosti písma
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Ukázkový text</label>
                <textarea
                  value={hpFontQuote}
                  onChange={e => setHpFontQuote(e.target.value)}
                  rows={3}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Odkud je ukázka (zobrazí se pod textem)</label>
                <input
                  type="text"
                  value={hpFontAttribution}
                  onChange={e => setHpFontAttribution(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none"
                />
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <ShieldAlert size={16} /> Proč číst tady (4 důvody)
            </h3>
            <div className="space-y-4">
              {hpWhyRead.map((item, idx) => (
                <div key={idx} style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 space-y-2">
                  <input
                    type="text"
                    placeholder={`Důvod ${idx + 1} - titulek`}
                    value={item.title}
                    onChange={e => updateWhyReadItem(idx, 'title', e.target.value)}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-2.5 border rounded-lg text-xs font-bold outline-none"
                  />
                  <textarea
                    placeholder="Popis"
                    value={item.description}
                    onChange={e => updateWhyReadItem(idx, 'description', e.target.value)}
                    rows={2}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-2.5 border rounded-lg text-xs font-medium outline-none resize-none"
                  />
                </div>
              ))}
            </div>
          </Card>

          <button
            onClick={saveHomepageSettings}
            disabled={savingHomepage}
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            className="w-full py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {savingHomepage ? 'Ukládám...' : 'Uložit domovskou stránku'}
          </button>
        </div>
      )}

      {/* 3. ZÁLOŽKA: UŽIVATELÉ A LICENCE */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex gap-2 items-center p-2 rounded-xl border border-solid" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <Search size={16} className="opacity-60 ml-2 shrink-0" />
                <input 
                  type="text"
                  placeholder="Hledat uživatele podle e-mailu..."
                  value={searchUser}
                  onChange={e => setSearchUser(e.target.value)}
                  className="w-full bg-transparent border-none outline-none font-bold text-xs p-1"
                />
              </div>
              <div className="flex gap-2 items-center p-2 rounded-xl border border-solid shrink-0" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <Filter size={14} className="opacity-60 ml-1" />
                <select 
                  value={filterRole} 
                  onChange={e => setFilterRole(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs font-bold font-sans cursor-pointer"
                >
                  <option value="all">Všechny role</option>
                  <option value="uživatel">Uživatelé</option>
                  <option value="nakladatel">Nakladatelé</option>
                  <option value="správce">Správci</option>
                </select>
              </div>
            </div>

            <Card className="overflow-hidden p-0">
              <div style={{ borderColor: 'var(--border-color)' }} className="p-4 border-b font-black text-xs uppercase tracking-wider">
                Databáze čtenářských účtů a oprávnění
              </div>
              <div className="max-h-[450px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }} className="font-black uppercase border-b opacity-80 sticky top-0 z-10">
                      <th className="p-3">Uživatel</th>
                      <th className="p-3">Role systému</th>
                      <th className="p-3 text-right">Řízení</th>
                    </tr>
                  </thead>
                  <tbody style={{ borderColor: 'var(--border-color)' }} className="divide-y">
                    {filteredProfiles.map(p => (
                      <tr key={p.id} style={{ borderColor: 'var(--border-color)' }} className={`hover:bg-[var(--bg-secondary)] transition-colors font-bold ${activeUser?.id === p.id ? "bg-[var(--bg-secondary)] ring-1 ring-inset ring-blue-500/30" : ""}`}>
                        <td className="p-3 truncate max-w-[200px]">
                          <div className="truncate text-sm font-black">{p.email}</div>
                          {p.fake_xp > 0 && (
                            <div className="text-[10px] font-black flex items-center gap-1 mt-0.5" style={{ color: 'var(--bg-primary)' }}>
                              <Award size={10}/> {p.fake_xp >= 1000000 ? "Level 100 (Max)" : `+${p.fake_xp} Admin XP`}
                            </div>
                          )}
                        </td>
                        <td className="p-3 align-middle">
                          <span 
                            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} 
                            className={`text-[9px] px-2.5 py-0.5 rounded-full uppercase border border-solid font-black shadow-sm tracking-wider`}
                          >
                            {p.role || 'uživatel'}
                          </span>
                        </td>
                        <td className="p-3 text-right flex justify-end items-center gap-2">
                          <Button 
                            variant={activeUser?.id === p.id ? "success" : "secondary"} 
                            onClick={() => { setActiveUser(p); setUserFakeXpInput(p.fake_xp || 0); }} 
                            className="text-[10px] px-2.5 py-1 uppercase flex items-center gap-1 font-black"
                          >
                            <Plus size={10}/> Vybrat
                          </Button>
                          <Button 
                            variant="secondary"
                            onClick={() => toggleRole(p.id, p.role)} 
                            className="p-1.5 border border-solid rounded-lg cursor-pointer" 
                            title="Cyklovat roli (Uživatel -> Nakladatel -> Správce)"
                          >
                            <Shield size={13}/>
                          </Button>
                          <Button 
                            variant="secondary"
                            onClick={() => revokeAllLicenses(p.id, p.email)} 
                            className="p-1.5 text-red-400 border border-solid border-red-500/20 rounded-lg hover:bg-red-500/10 cursor-pointer" 
                            title="Kompletní revokace (Smazat všechny licence uživatele)"
                          >
                            <XCircle size={13}/>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* DISTRIBUČNÍ PANEL VYBRANÉHO UŽIVATELE */}
          <div className="lg:col-span-5 space-y-4">
            <Card style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border-2">
              <h3 style={{ color: 'var(--bg-primary)' }} className="text-sm font-black uppercase tracking-wider mb-3 flex items-center gap-2">
                <UserCheck size={18}/> Správce distribuce a oprávnění
              </h3>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider block opacity-70">1. Vyberte knihu z registru</label>
                  
                  {/* Vyhledávací a filtrovací pole pro rychlé prohledávání registru knih */}
                  <div className="flex gap-2 items-center p-2 mb-1.5 rounded-lg border border-solid bg-[var(--bg-primary)]" style={{ borderColor: 'var(--border-color)' }}>
                    <Search size={14} className="opacity-50 ml-1 shrink-0" />
                    <input 
                      type="text"
                      placeholder="Rychlý filtr knih (název / autor)..."
                      value={searchBook}
                      onChange={e => setSearchBook(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-xs font-bold p-0.5"
                    />
                  </div>

                  <select 
                    value={selectedBookId} 
                    onChange={e => setSelectedBookId(e.target.value)} 
                    style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg font-bold text-xs outline-none cursor-pointer shadow-sm"
                  >
                    <option value="" style={{ background: 'var(--bg-secondary)' }}>
                      -- ({filteredBooks.length}) Titulů odpovídá filtru --
                    </option>
                    {filteredBooks.map(b => (
                      <option key={b.id} value={b.id} style={{ background: 'var(--bg-secondary)' }}>
                        {b.title} ({b.authorDisplay})
                      </option>
                    ))}
                  </select>
                </div>

                {/* MODUL PRO UKÁZKU A PŘEPÍNÁNÍ AUTO-ASSIGNU VYBRANÉ KNIHY */}
                {selectedBookId && currentSelectedBook && (
                  <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl border border-solid flex items-center justify-between gap-4 animate-in fade-in duration-150">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider block flex items-center gap-1">
                        <Sparkles size={11} className="text-yellow-500 fill-current"/> Auto-Assign globální příznak
                      </span>
                      <span className="text-[9px] opacity-50 block font-bold">Přidělí se automaticky každému čtenáři</span>
                    </div>
                    <Button
                      variant={currentSelectedBook.is_auto_assigned ? "success" : "secondary"}
                      onClick={() => toggleBookAutoAssign(currentSelectedBook.id, currentSelectedBook.is_auto_assigned)}
                      disabled={actionLoading}
                      className="text-[10px] px-3 py-1.5 font-black uppercase tracking-wider shrink-0"
                    >
                      {currentSelectedBook.is_auto_assigned ? "✨ Aktivní" : "Vypnuto"}
                    </Button>
                  </div>
                )}

                <Button 
                  onClick={assignSelectedBookToAllUsers}
                  variant="purple"
                  disabled={actionLoading || !selectedBookId}
                  className="w-full text-xs py-2.5 uppercase tracking-wider font-black shadow-md flex items-center justify-center gap-1"
                >
                  📢 Globální odemčení této knihy VŠEM čtenářům
                </Button>
                
                {activeUser ? (
                  <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-4 border-t border-solid space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                      <p className="text-xs font-bold text-blue-400 truncate m-0">Target: <span className="font-black text-sm">{activeUser.email}</span></p>
                    </div>
                    
                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-80 block">
                        Modifikátor bonusových XP (Úroveň Profilu)
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={userFakeXpInput} 
                          onChange={e => setUserFakeXpInput(parseInt(e.target.value) || 0)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="w-full p-2 border rounded-lg text-xs font-bold outline-none font-mono" 
                          placeholder="Množství XP..."
                        />
                        <button 
                          onClick={handleSaveFakeXp}
                          disabled={actionLoading}
                          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 font-black text-[10px] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity shrink-0 active:scale-95 duration-100"
                        >
                          Uložit XP
                        </button>
                      </div>
                      <span className="text-[9px] opacity-40 font-bold block">* Zadejte hodnotu ≥ 1 000 000 pro okamžitý skok na Level 100.</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-80 flex items-center gap-1">
                        <Coins size={11} /> Připsat / odečíst Jomarid Coins (funguje i na tvůj vlastní účet)
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={coinGrantInput} 
                          onChange={e => setCoinGrantInput(e.target.value)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="w-24 p-2 border rounded-lg text-xs font-bold outline-none font-mono" 
                          placeholder="±počet"
                        />
                        <input 
                          type="text" 
                          value={coinGrantReason} 
                          onChange={e => setCoinGrantReason(e.target.value)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="flex-1 p-2 border rounded-lg text-xs font-bold outline-none" 
                          placeholder="Důvod (volitelné)..."
                        />
                        <button 
                          onClick={handleGrantCoins}
                          disabled={actionLoading || !coinGrantInput}
                          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 font-black text-[10px] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity shrink-0 active:scale-95 duration-100 disabled:opacity-40"
                        >
                          Připsat
                        </button>
                      </div>
                      <span className="text-[9px] opacity-40 font-bold block">* Zůstatek {activeUser.coins ?? 0} 🪙. Záporné číslo strhne mince (nejníž na 0), loguje se to do coin_transactions.</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-80 flex items-center gap-1">
                        <Award size={11} /> Herní postup (jen pro přehled)
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                        <span style={{ color: 'var(--text-muted)' }}>Odznaky: <span style={{ color: 'var(--text-body)' }}>{(activeUser.unlocked_badges || []).length} / 100</span></span>
                        <span style={{ color: 'var(--text-muted)' }}>Nejvyšší splněný cíl: <span style={{ color: 'var(--text-body)' }}>{activeUser.highest_goal_completed ?? 25}</span></span>
                        <span style={{ color: 'var(--text-muted)' }} className="col-span-2">Vlajkový odznak: <span style={{ color: 'var(--text-body)' }}>{activeUser.featured_badge || '—'}</span></span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Streak Freeze: <span style={{ color: 'var(--text-body)' }}>{activeUser.streak_freezes ?? 0}</span></span>
                        <button
                          onClick={handleGrantStreakFreeze}
                          disabled={actionLoading}
                          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 py-1.5 font-black text-[10px] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity active:scale-95 duration-100 disabled:opacity-40"
                        >
                          +1 Freeze
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <button 
                        onClick={assignBookToUser} 
                        disabled={actionLoading || !selectedBookId}
                        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)' }}
                        className="flex-1 text-xs py-2.5 uppercase font-black rounded-lg border-none cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-40"
                      >
                        Aktivovat zvolenou knihu
                      </button>
                      <Button variant="secondary" onClick={() => setActiveUser(null)} className="text-xs py-2.5 font-bold">Zrušit výběr</Button>
                    </div>
                    
                    <Button 
                      onClick={assignAllBooksToUser}
                      disabled={actionLoading}
                      variant="success"
                      className="w-full text-xs py-2.5 uppercase tracking-wider font-black shadow-sm"
                    >
                      ✨ Full Unlock: Aktivovat mu VŠECHNY knihy z databáze
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs font-bold opacity-50 italic border border-dashed rounded-xl p-4" style={{ borderColor: 'var(--border-color)' }}>
                    Pro individuální přidělení licencí nebo zápis XP vyberte uživatele ze sousední tabulky.
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* 4. ZÁLOŽKA: SYSTÉMOVÉ LOGY (FULL CORE SYSLOG) */}
      {activeTab === 'logs' && <LogsTab />}

      <TypedConfirm
        open={bulkGrantOpen}
        title="Rozdat knihu všem"
        description={`Kniha "${books.find(b => b.id === selectedBookId)?.title || ''}" se okamžitě odemkne ZDARMA všem ${profiles.length} načteným účtům. Její cena tím pro ně přestane platit a zpět to nejde vzít.`}
        expected={books.find(b => b.id === selectedBookId)?.title || ''}
        confirmLabel="Rozdat všem"
        onConfirm={runBulkGrant}
        onCancel={() => setBulkGrantOpen(false)}
      />
    </div>
  );
};


