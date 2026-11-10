import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { friendlyErrorWithDetail } from '../lib/friendlyError';
import { fetchBookText, saveBookText, removeBookText } from '../bookText/bookText';
import BookTextField from '../components/BookTextField';
import ShortsStudio from '../components/ShortsStudio';
import PushAdminCard from '../push/PushAdminCard';
import { Button, Card } from '../components/ui';
import { TourEditor, peekAdminTabRequest } from '../tour/TourEditor';
import { useAuth } from '../contexts/AuthContext';
import { usePagedList } from '../browse/usePagedList';
import { LoadMore } from '../browse/BrowseParts';
import { fetchAllByKey, keysetQuery } from '../browse/libraryData';
import { cleanGenres, GENRES_PER_BOOK, GENRE_MAX_LENGTH } from '../browse/libraryModel';
import { ROLE_READER, ROLE_PUBLISHER, ROLE_ADMIN, ROLE_LABELS } from '../constants/roles';
import { DEFAULT_BOOK_PRICE } from '../constants/economy';
import { USERNAME_MIN, USERNAME_MAX } from '../lib/username';
import { EMAIL_MAX, EMAIL_REQUEST_KIND, ADMIN_EMAIL_ERRORS, isValidEmail, normalizeEmail, sameEmail } from '../emailChange';
import { BOOK_BADGES } from '../constants/badges';
import { t, formatNumber, formatDate as formatDateI18n, formatDateTime as formatDateTimeI18n } from '../i18n';
import { plural } from '../lib/plural.js';
import { DEFAULT_MONTHLY_GOAL } from '../constants/leveling';
import { Award, Coins, Database, Feather, Filter, Heart, Layout, Plus, RefreshCw, Search, Shield, ShieldAlert, Sparkles, Terminal, Trash, UserCheck, Users, XCircle, LayoutDashboard, UserCog, Loader2, CheckCircle2, X, ChevronLeft, ChevronRight, Ban, KeyRound, Trash2, ShieldCheck, Bell, Copy, Flag, Eye, EyeOff, Download, Mail } from 'lucide-react';
import { tk } from '../i18n/mark.js';

// ============================================================================
// Admin: Přehled a správa účtů (pomocné prvky, záložka Přehled, záložka Účty)
// ============================================================================
const formatDate = (iso) => (iso ? formatDateI18n(iso) : '-');
const formatDateTime = (iso) => (iso ? formatDateTimeI18n(iso, { dateStyle: 'short', timeStyle: 'short' }) : '-');

// Databáze vrací najednou jen omezený počet řádků (standardně 1000): všechna čtení správce, která musí být úplná
// (knihy, účty, licence), jdou po částech podle sloupce id. Vybírané sloupce musí obsahovat id.
const readAllRows = (table, columns, filter) => fetchAllByKey(keysetQuery(() => supabase.from(table), columns, 'id', filter), { key: 'id' });

const relativeTime = (iso) => {
  if (!iso) return t('nikdy');
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t('před chvílí');
  if (minutes < 60) return t('před {n} min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('před {n} h', { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('včera');
  if (days < 30) return t('před {n} dny', { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('před {n} měs.', { n: months });
  return t('před {n} r.', { n: Math.floor(months / 12) });
};

const daysText = (n) => t.p(n, '{n} den', '{n} dny', '{n} dní', { n });

// Zdroje mincí se ve coin_transactions poznají podle prefixu před dvojtečkou.
const SOURCE_LABELS = {
  badge: tk('Odznaky'),
  game_event: tk('Události ve hrách'),
  game_bonus: tk('Denní bonus za hru'),
  mp_win: tk('Výhry v online hrách'),
  daily_login: tk('Denní přihlášení'),
  admin_grant: tk('Přidělil admin'),
  book_purchase: tk('Nákupy knih'),
  book_sale: tk('Prodeje knih (autorům)'),
  streak_freeze_purchase: tk('Streak Freeze'),
  cosmetic_purchase: tk('Tituly a vzhledy her'),
};
const sourceLabel = (sourceType) => {
  const key = String(sourceType || '').split(':')[0];
  return SOURCE_LABELS[key] ? t(SOURCE_LABELS[key]) : (key || t('Jiné'));
};

const ADMIN_ERRORS = {
  forbidden: tk('K téhle akci nemáš oprávnění.'),
  cannot_target_self: tk('Tohle nejde provést na vlastním účtu.'),
  cannot_target_admin: tk('Účet správce nejde blokovat ani mazat - nejdřív mu změň roli.'),
  has_published_books: tk('Účet má vydané knihy - nejdřív je smaž nebo předej jinému autorovi.'),
  user_not_found: tk('Účet už neexistuje (mohl být mezitím smazán).'),
  profile_not_found: tk('Účet nemá profil - založí se při jeho příštím přihlášení.'),
  invalid_role: tk('Neplatná role.'),
  cannot_reset_self: tk('Heslo sobě vydat nejde - použij Supabase (Authentication -> Users) nebo druhého správce.'),
  notification_not_found: tk('Upozornění už neexistuje (mohlo být mezitím smazáno).'),
  invalid_status: tk('Neplatný stav upozornění.'),
  already_handled: tk('Tohle upozornění už bylo vyřízeno.'),
  username_invalid: tk('Neplatné uživatelské jméno ({min}-{max} znaků, a-z, číslice, . _ -).'),
  username_reserved: tk('Tohle jméno je rezervované.'),
  username_taken: tk('Tohle jméno už někdo používá.'),
  ...ADMIN_EMAIL_ERRORS,
};
const mapAdminError = (err) => {
  const msg = String(err?.message || '');
  const code = Object.keys(ADMIN_ERRORS).find(c => msg.includes(c));
  return code ? t(ADMIN_ERRORS[code], { min: USERNAME_MIN, max: USERNAME_MAX }) : t('Akce se nepovedla: {msg}', { msg: msg || t('neznámá chyba') });
};

const StatCard = ({ label, value, hint }) => (
  <div style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-4 min-w-0">
    <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0 opacity-80">{label}</p>
    <p className="text-2xl font-black m-0 mt-1 tabular-nums">{value}</p>
    {hint && <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 mt-1 opacity-80">{hint}</p>}
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
  <span style={PILL_TONES[tone]} className="inline-block text-[0.625rem] font-black uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap">{children}</span>
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
          <span className="text-[0.625rem] font-black uppercase tracking-wider block mb-1 opacity-80">{t('Pro potvrzení napiš:')} <span className="normal-case tracking-normal select-all">{expected}</span></span>
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
          <button type="button" onClick={onCancel} disabled={busy} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }} className="px-4 py-2 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider disabled:opacity-50">{t('Zrušit')}</button>
          <button type="button" onClick={onConfirm} disabled={!matches || busy} style={{ backgroundColor: '#dc2626', color: '#fff' }} className="px-4 py-2 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2">
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
        <p className="text-[0.625rem] font-black uppercase tracking-wider m-0 opacity-80">{title}</p>
        <p className="text-sm font-black m-0 tabular-nums">{formatNumber(total)}</p>
      </div>
      <div className="flex items-end gap-[3px] h-16" role="img" aria-label={t('{title}: {n} za posledních 14 dní', { title, n: total })}>
        {points.map((p, i) => (
          <div
            key={p.day}
            title={`${formatDateI18n(p.day, { day: 'numeric', month: 'numeric' })}: ${formatNumber(values[i])}`}
            style={{ height: `${Math.max(values[i] > 0 ? 8 : 2, (values[i] / max) * 100)}%`, backgroundColor: color, opacity: values[i] > 0 ? 1 : 0.25 }}
            className="flex-1 rounded-sm"
          />
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] m-0 mt-1 opacity-70">{t('posledních 14 dní')}</p>
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
        <InlineMessage type="error">{error || t('Přehled se nepodařilo načíst.')}</InlineMessage>
        <button type="button" onClick={load} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="px-4 py-2 rounded-lg border-none cursor-pointer text-xs font-black uppercase">{t('Zkusit znovu')}</button>
      </div>
    );
  }

  const { users, books, reading, coins, daily } = data;
  const sources = coins.sources || [];
  const earned30 = sources.reduce((s, r) => s + Number(r.earned_30d), 0);
  const spent30 = sources.reduce((s, r) => s + Number(r.spent_30d), 0);
  const issues = [
    users.no_profile > 0 && { key: 'np', label: `${users.no_profile} ${t.p(users.no_profile, 'účet bez profilu', 'účty bez profilu', 'účtů bez profilu')}`, onClick: () => onOpenAccounts({ role: 'bez_profilu' }) },
    users.banned > 0 && { key: 'ban', label: `${users.banned} ${t.p(users.banned, 'zablokovaný', 'zablokovaní', 'zablokovaných')}`, onClick: () => onOpenAccounts({ status: 'banned' }) },
    users.unconfirmed > 0 && { key: 'unc', label: `${users.unconfirmed} ${t.p(users.unconfirmed, 'nepotvrzený e-mail', 'nepotvrzené e-maily', 'nepotvrzených e-mailů')}`, onClick: () => onOpenAccounts({ status: 'unconfirmed' }) },
    books.missing_author > 0 && { key: 'ma', label: `${books.missing_author} ${t.p(books.missing_author, 'kniha bez propojeného autora', 'knihy bez propojeného autora', 'knih bez propojeného autora')}`, onClick: onOpenBooks },
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-80">{t('Stav k {time}', { time: formatDateTime(data.generated_at) })}</p>
        <button type="button" onClick={load} disabled={loading} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} className="border rounded-lg px-3 py-1.5 cursor-pointer text-xs font-black uppercase inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> {t('Obnovit')}
        </button>
      </div>
      {error && <InlineMessage type="error">{error}</InlineMessage>}

      <div className="flex items-center gap-2 flex-wrap" data-testid="issues">
        {issues.length === 0
          ? <span style={{ color: '#10b981' }} className="text-xs font-black inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> {t('Žádné nalezené problémy')}</span>
          : issues.map(i => <Chip key={i.key} onClick={i.onClick}>{i.label}</Chip>)}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t('Účty')} value={formatNumber(users.total)} hint={t('+{a} za 7 dní · +{b} za 30 dní', { a: users.new_7d, b: users.new_30d })} />
        <StatCard label={t('Aktivní')} value={formatNumber(users.active_7d)} hint={t('za 7 dní · {n} za 30 dní', { n: users.active_30d })} />
        <StatCard label={t('Dočtené knihy')} value={formatNumber(reading.finished_total)} hint={t('{a} za 7 dní · {b} za 30 dní', { a: reading.finished_7d, b: reading.finished_30d })} />
        <StatCard label={t('Mince v oběhu')} value={formatNumber(coins.in_circulation)} hint={t('průměr {n} na profil', { n: formatNumber(coins.avg_per_profile) })} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MiniBars title={t('Nové účty')} points={daily} valueKey="new_users" color="#6366f1" />
        <MiniBars title={t('Dočtené knihy')} points={daily} valueKey="finished" color="#10b981" />
        <MiniBars title={t('Získané mince')} points={daily} valueKey="coins_earned" color="#f59e0b" />
      </div>

      <Card>
        <h3 className="text-sm font-black uppercase tracking-wider mb-1">{t('Ekonomika mincí podle zdroje')}</h3>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mb-3 opacity-80">
          {t('Za posledních 30 dní přibylo {earned} a ubylo {spent} mincí (čistě {net}).', { earned: formatNumber(earned30), spent: formatNumber(spent30), net: `${earned30 - spent30 >= 0 ? '+' : ''}${formatNumber(earned30 - spent30)}` })}
        </p>
        {sources.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">{t('Zatím žádné transakce.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[520px]">
              <thead>
                <tr style={{ color: 'var(--text-muted)', borderColor: 'var(--border-color)' }} className="text-left border-b">
                  <th className="py-2 pr-3 font-black uppercase text-[0.625rem]">{t('Zdroj')}</th>
                  <th className="py-2 px-2 font-black uppercase text-[0.625rem] text-right">{t('Získáno 30 d')}</th>
                  <th className="py-2 px-2 font-black uppercase text-[0.625rem] text-right">{t('Utraceno 30 d')}</th>
                  <th className="py-2 px-2 font-black uppercase text-[0.625rem] text-right">{t('Získáno celkem')}</th>
                  <th className="py-2 px-2 font-black uppercase text-[0.625rem] text-right">{t('Utraceno celkem')}</th>
                  <th className="py-2 pl-2 font-black uppercase text-[0.625rem] text-right">{t('Počet')}</th>
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
          <h3 className="text-sm font-black uppercase tracking-wider mb-3">{t('Nejčtenější knihy')}</h3>
          {reading.top_books.length === 0 ? <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">{t('Zatím nikdo nic nedočetl.')}</p> : (
            <ol className="m-0 pl-5 space-y-1.5 text-sm">
              {reading.top_books.map(b => <li key={b.id}><span className="font-bold">{b.title}</span> <span style={{ color: 'var(--text-muted)' }} className="text-xs">· {b.reads}×</span></li>)}
            </ol>
          )}
          <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 mt-3 opacity-70">{t('Knih v katalogu: {total} (placených {paid}, zdarma pro všechny {free})', { total: books.total, paid: books.paid, free: books.auto_assigned })}</p>
        </Card>
        <Card>
          <h3 className="text-sm font-black uppercase tracking-wider mb-3">{t('Nejvíc mincí')}</h3>
          <ol className="m-0 pl-5 space-y-1.5 text-sm">
            {coins.top_holders.map((h, i) => <li key={`${h.email}-${i}`} className="break-all"><span className="font-bold">{h.email}</span> <span style={{ color: 'var(--text-muted)' }} className="text-xs">· {formatNumber(h.coins)}</span></li>)}
          </ol>
          <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 mt-3 opacity-70">{t('Hodnoty mimo běžný řád (např. testovací účty) tu snadno poznáš.')}</p>
        </Card>
      </div>
    </div>
  );
};

const PAGE_SIZE = 20;
const ROLE_FILTERS = [['all', tk('Všechny role')], [ROLE_READER, tk('Čtenáři')], [ROLE_PUBLISHER, tk('Nakladatelé')], [ROLE_ADMIN, tk('Správci')], ['bez_profilu', tk('Bez profilu')]];
const STATUS_FILTERS = [['all', tk('Jakýkoliv stav')], ['banned', tk('Zablokovaní')], ['unconfirmed', tk('Nepotvrzený e-mail')], ['inactive30', tk('Neaktivní 30 dní')]];
const SORTS = [['created_desc', tk('Nejnovější')], ['created_asc', tk('Nejstarší')], ['last_login_desc', tk('Naposledy přihlášení')], ['coins_desc', tk('Nejvíc mincí')], ['email_asc', tk('E-mail A-Z')]];

const selectStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const selectClass = 'p-2.5 border rounded-lg text-xs font-bold outline-none cursor-pointer';

const SmallButton = ({ tone = 'ghost', busy = false, disabled, children, ...props }) => {
  const style = tone === 'danger' ? { backgroundColor: '#dc2626', color: '#fff' } : tone === 'primary' ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' } : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' };
  return (
    <button {...props} disabled={disabled || busy} style={style} className="px-3 py-2 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
      {busy && <Loader2 size={12} className="animate-spin" />}{children}
    </button>
  );
};

const AccountDetail = ({ userId, currentUserId, onClose, onChanged, onEmailChanged }) => {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [roleDraft, setRoleDraft] = useState('');
  const [confirmBan, setConfirmBan] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [tempOpen, setTempOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_user_detail', { p_user_id: userId });
    if (rpcError) { setError(mapAdminError(rpcError)); return; }
    setError('');
    setDetail(data);
    setRoleDraft(data?.profile?.role || '');
    setNameDraft(data?.profile?.username || '');
  }, [userId]);
  useEffect(() => { setDetail(null); setMsg(null); setConfirmBan(false); setEmailOpen(false); load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !deleteOpen && !emailOpen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, deleteOpen, emailOpen]);

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
  const isAdminTarget = profile?.role === ROLE_ADMIN;
  const hasBooks = (stats?.published_books || 0) > 0;
  const isBanned = !!account?.is_banned;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('Detail účtu')}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="h-full w-full max-w-md border-l shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }} className="sticky top-0 z-10 flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-black uppercase tracking-widest m-0">{t('Detail účtu')}</h3>
          <button type="button" onClick={onClose} aria-label={t('Zavřít detail')} className="bg-transparent border-none cursor-pointer text-current opacity-60 hover:opacity-100 p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {error && <InlineMessage type="error">{error}</InlineMessage>}
          {!detail && !error && <div className="py-10 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>}

          {detail && (
            <>
              <div>
                <p className="text-base font-black m-0 break-all">{account.email}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <Pill tone="accent">{profile ? t(ROLE_LABELS[profile.role] || profile.role) : t('Bez profilu')}</Pill>
                  {isBanned && <Pill tone="danger">{t('Zablokován')}</Pill>}
                  {!account.email_confirmed_at && <Pill tone="warn">{t('E-mail nepotvrzen')}</Pill>}
                  {isSelf && <Pill tone="ok">{t('Tohle jsi ty')}</Pill>}
                </div>
                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs mt-3 m-0">
                  <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Vytvořen')}</dt><dd className="m-0 font-semibold">{formatDate(account.created_at)}</dd>
                  <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Naposledy přihlášen')}</dt><dd className="m-0 font-semibold">{account.last_sign_in_at ? `${formatDateTime(account.last_sign_in_at)} (${relativeTime(account.last_sign_in_at)})` : 'nikdy'}</dd>
                  {profile && <><dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Mince')}</dt><dd className="m-0 font-semibold">{formatNumber(profile.coins)}</dd></>}
                  {profile && <><dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Série (streak)')}</dt><dd className="m-0 font-semibold">{daysText(profile.current_streak ?? 0)}</dd></>}
                </dl>
                {!profile && <div className="mt-3"><InlineMessage>{t('Účet zatím nemá profil - založí se, jakmile se poprvé přihlásí.')}</InlineMessage></div>}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[[t('Přečteno'), stats.books_read], [t('Zvýraznění'), stats.highlights], [t('Komentáře'), stats.comments], [t('Hodnocení'), stats.ratings], [t('Odemčené'), stats.books_active], [t('Vydané'), stats.published_books]].map(([label, value]) => (
                  <div key={label} style={{ backgroundColor: 'var(--bg-secondary)' }} className="rounded-lg py-2">
                    <p className="text-lg font-black m-0 tabular-nums">{value}</p>
                    <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-bold uppercase m-0">{label}</p>
                  </div>
                ))}
              </div>

              <section className="space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider m-0">{t('Akce')}</h4>
                {msg && <InlineMessage type={msg.type}>{msg.text}</InlineMessage>}
                {isSelf && <InlineMessage>{t('Na vlastním účtu nejde měnit roli, blokovat, mazat, vydat dočasné heslo ani změnit e-mail - to může provést jiný správce.')}</InlineMessage>}

                {profile?.must_change_password && <InlineMessage>{t('Čeká na změnu hesla: správce vydal dočasné heslo a uživatel si zatím nenastavil vlastní.')}</InlineMessage>}

                {profile && 'username' in profile && (
                  <div className="flex items-end gap-2 flex-wrap">
                    <label className="block flex-1 min-w-[140px]">
                      <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-1">{t('Uživatelské jméno')}</span>
                      <input aria-label={t('Uživatelské jméno')} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={USERNAME_MAX} autoCapitalize="none" spellCheck={false} disabled={busy} style={selectStyle} className="w-full p-2.5 border rounded-lg text-xs font-bold outline-none disabled:opacity-50" />
                    </label>
                    <SmallButton busy={busy} disabled={nameDraft.trim() === (profile.username || '') || nameDraft.trim().length < USERNAME_MIN} onClick={() => run(() => supabase.rpc('admin_set_username', { p_user: userId, p_username: nameDraft.trim() }), t('Jméno přejmenováno.'))}>
                      <UserCog size={13} /> {t('Přejmenovat')}
                    </SmallButton>
                  </div>
                )}

                <div className="flex items-end gap-2 flex-wrap">
                  <label className="block flex-1 min-w-[140px]">
                    <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-1">{t('Role')}</span>
                    <select aria-label={t('Role')} value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)} disabled={isSelf || !profile || busy} style={selectStyle} className={`${selectClass} w-full disabled:opacity-50`}>
                      {!profile && <option value="">-</option>}
                      {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
                    </select>
                  </label>
                  <SmallButton tone="primary" busy={busy} disabled={isSelf || !profile || roleDraft === profile?.role} onClick={() => run(() => supabase.rpc('admin_set_role', { p_user_id: userId, p_role: roleDraft }), t('Role změněna.'))}>
                    <ShieldCheck size={13} /> {t('Uložit roli')}
                  </SmallButton>
                </div>

                <div className="flex flex-wrap gap-2">
                  <SmallButton busy={busy} disabled={isSelf} onClick={() => setTempOpen(true)}><KeyRound size={13} /> {t('Vydat dočasné heslo')}</SmallButton>
                  <SmallButton busy={busy} disabled={isSelf} onClick={() => setEmailOpen(true)}><Mail size={13} /> {t('Změnit e-mail')}</SmallButton>
                  {isBanned ? (
                    <SmallButton busy={busy} disabled={isSelf} onClick={() => run(() => supabase.rpc('admin_set_user_banned', { p_user_id: userId, p_banned: false }), t('Účet odblokován.'))}><Ban size={13} /> {t('Odblokovat')}</SmallButton>
                  ) : !confirmBan ? (
                    <SmallButton busy={busy} disabled={isSelf || isAdminTarget} onClick={() => setConfirmBan(true)}><Ban size={13} /> {t('Zablokovat')}</SmallButton>
                  ) : (
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold">{t('Zablokovat a odhlásit?')}</span>
                      <SmallButton tone="danger" busy={busy} onClick={async () => { const ok = await run(() => supabase.rpc('admin_set_user_banned', { p_user_id: userId, p_banned: true }), t('Účet zablokován a odhlášen ze zařízení.')); if (ok) setConfirmBan(false); }}>{t('Ano, zablokovat')}</SmallButton>
                      <SmallButton disabled={busy} onClick={() => setConfirmBan(false)}>{t('Zrušit')}</SmallButton>
                    </span>
                  )}
                </div>
                {isAdminTarget && !isSelf && <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 opacity-80">{t('Účet správce nejde blokovat ani mazat - nejdřív mu změň roli.')}</p>}

                <div style={{ borderColor: 'rgba(239,68,68,0.35)' }} className="border rounded-lg p-3 space-y-2">
                  <p className="text-[0.6875rem] font-black uppercase tracking-wider text-red-500 m-0">{t('Nebezpečná zóna')}</p>
                  <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{t('Nevratně smaže účet i všechna jeho data (rozečtené knihy, záložky, zvýraznění, hodnocení, komentáře, mince).')}</p>
                  {hasBooks && <p className="text-xs font-bold text-amber-600 m-0">{t('Účet má vydané knihy ({n}) - napřed je smaž nebo předej jinému autorovi.', { n: stats.published_books })}</p>}
                  <SmallButton tone="danger" disabled={isSelf || isAdminTarget || hasBooks} onClick={() => { setDeleteError(''); setDeleteOpen(true); }}><Trash2 size={13} /> {t('Smazat účet')}</SmallButton>
                </div>
              </section>

              <section>
                <h4 className="text-xs font-black uppercase tracking-wider m-0 mb-2">{t('Poslední pohyby mincí')}</h4>
                {detail.transactions.length === 0 ? <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">{t('Žádné pohyby.')}</p> : (
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
        title={t('Smazat účet natrvalo')}
        description={t('Smaže se účet {email} i všechna jeho data. Zpět to nejde vzít.', { email: account?.email || '' })}
        expected={account?.email || ''}
        confirmLabel={t('Smazat účet')}
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

      {emailOpen && (
        <ChangeEmailDialog
          target={{ userId, username: profile?.username || '', currentEmail: account?.email || '' }}
          onClose={() => setEmailOpen(false)}
          onDone={(res) => { onEmailChanged?.(res?.old_email, res?.new_email); load(); onChanged?.(); }}
        />
      )}
    </div>
  );
};

// ============================================================================
// Admin: Upozornění (žádosti o heslo...) a vydání dočasného hesla
// ============================================================================
// Dočasné heslo se ukáže jednou hned po vydání (nikde se neukládá). Uživatel se odhlásí ze všech
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
        aria-label={t('Dočasné heslo')}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[92dvh] overflow-y-auto"
      >
        {step === 'confirm' ? (
          <>
            <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><KeyRound size={18} /> {t('Vydat dočasné heslo?')}</h3>
            <p className="text-sm m-0 leading-relaxed">{t('Účet:')} <b className="break-all">{target.username || target.email}</b>{target.email && target.username ? <span style={{ color: 'var(--text-muted)' }} className="break-all"> ({target.email})</span> : null}</p>
            <ul style={{ color: 'var(--text-muted)' }} className="text-xs m-0 pl-4 space-y-1.5 leading-relaxed">
              <li>{t('Staré heslo přestane platit a uživatel bude')} <b>{t('odhlášen ze všech zařízení')}</b> {t('(už přihlášená zařízení se odhlásí nejpozději do hodiny, než vyprší jejich přihlášení).')}</li>
              <li>{t('Heslo se ti ukáže')} <b>{t('jen jednou')}</b> {t('a nikde se neukládá.')}</li>
              <li>{t('Předej ho uživateli')} <b>{t('mimo aplikaci')}</b> {t('a nejdřív ověř, že žádá opravdu majitel účtu. Shoda e-mailu a jména to sama nedokazuje.')}</li>
              <li>{t('Při přihlášení si uživatel musí hned nastavit vlastní heslo.')}</li>
            </ul>
            {error && <InlineMessage type="error">{error}</InlineMessage>}
            <div className="flex gap-2 justify-end">
              <SmallButton onClick={onClose} disabled={busy}>{t('Zrušit')}</SmallButton>
              <SmallButton tone="danger" busy={busy} onClick={issue}><KeyRound size={13} /> {t('Vydat heslo')}</SmallButton>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><CheckCircle2 size={18} style={{ color: '#10b981' }} /> {t('Dočasné heslo je vydané')}</h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{t('Účet')} <b>{result?.username || target.username}</b>{t('. Heslo se ukazuje jen teď - až dialog zavřeš, už ho neuvidíš (můžeš vydat nové).')}</p>
            <div style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <code data-testid="temp-password" className="min-w-0 text-lg font-black tracking-wider break-all select-all">{result?.temp_password}</code>
              <SmallButton onClick={copy}><Copy size={13} /> {copied ? t('Zkopírováno') : t('Kopírovat')}</SmallButton>
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{t('Předej ho uživateli mimo aplikaci. Ze všech zařízení se odhlásí (nejpozději do hodiny) a po přihlášení si musí nastavit vlastní heslo.')}</p>
            <div className="flex justify-end"><SmallButton tone="primary" onClick={onClose}>{t('Hotovo')}</SmallButton></div>
          </>
        )}
      </div>
    </div>
  );
};

// Změna e-mailu účtu správcem (z žádosti uživatele, nebo přímo z detailu účtu). Nový e-mail z žádosti je pevný,
// z detailu účtu se zadává. Uživatel zůstane přihlášený, potvrzovací e-mail se neposílá.
export const ChangeEmailDialog = ({ target, onClose, onDone }) => {
  const fixedNew = !!target.newEmail;
  const [step, setStep] = useState('confirm'); // 'confirm' | 'result'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const newEmail = normalizeEmail(fixedNew ? target.newEmail : draft);
  const isSame = sameEmail(newEmail, target.currentEmail);
  const canSubmit = isValidEmail(newEmail) && !isSame;
  const draftHint = !fixedNew && draft.trim() !== '' ? (!isValidEmail(newEmail) ? t(ADMIN_EMAIL_ERRORS.invalid_email) : isSame ? t(ADMIN_EMAIL_ERRORS.same_email) : '') : '';

  const change = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('admin_change_email', { p_user: target.userId, p_new_email: newEmail, p_notification: target.notificationId || null });
    setBusy(false);
    if (rpcError) return setError(mapAdminError(rpcError));
    setResult(data);
    setStep('result');
    onDone?.(data);
  };

  return (
    <div className="fixed inset-0 z-[130] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3" onClick={(e) => { e.stopPropagation(); if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Změna e-mailu')}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[92dvh] overflow-y-auto"
      >
        {step === 'confirm' ? (
          <>
            <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><Mail size={18} /> {t('Změnit e-mail?')}</h3>
            <p className="text-sm m-0 leading-relaxed">{t('Účet:')} <b className="break-all">{target.username || target.currentEmail}</b></p>
            {fixedNew || canSubmit ? (
              <p className="text-sm m-0 leading-relaxed">{t('E-mail se změní z')} <b className="break-all">{target.currentEmail}</b> {t('na')} <b className="break-all">{newEmail}</b>.</p>
            ) : (
              <p className="text-sm m-0 leading-relaxed">{t('Současný e-mail:')} <b className="break-all">{target.currentEmail}</b></p>
            )}
            {!fixedNew && (
              <label className="block">
                <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-1">{t('Nový e-mail')}</span>
                <input
                  type="email"
                  aria-label={t('Nový e-mail')}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') change(); }}
                  maxLength={EMAIL_MAX}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  style={selectStyle}
                  className="w-full p-2.5 border rounded-lg text-xs font-bold outline-none disabled:opacity-50"
                />
                {draftHint && <span style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] block mt-1">{draftHint}</span>}
              </label>
            )}
            {fixedNew && isSame && <InlineMessage>{t(ADMIN_EMAIL_ERRORS.same_email)}</InlineMessage>}
            <ul style={{ color: 'var(--text-muted)' }} className="text-xs m-0 pl-4 space-y-1.5 leading-relaxed">
              <li>{t('Potvrzovací e-mail se neposílá, nový e-mail se rovnou bere jako potvrzený.')}</li>
              <li>{t('Uživatel zůstane přihlášený a heslo se nemění; přihlašovat se bude novým e-mailem.')}</li>
              <li>{t('Uživatel dostane oznámení v appce. Řekni mu to i mimo aplikaci.')}</li>
              {!target.username && <li>{t('Účet nemá uživatelské jméno, zobrazované jméno se odvozuje z e-mailu a po změně se změní.')}</li>}
            </ul>
            {error && <InlineMessage type="error">{error}</InlineMessage>}
            <div className="flex gap-2 justify-end">
              <SmallButton onClick={onClose} disabled={busy}>{t('Zrušit')}</SmallButton>
              <SmallButton tone="primary" busy={busy} disabled={!canSubmit} onClick={change}><Mail size={13} /> {t('Změnit e-mail')}</SmallButton>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><CheckCircle2 size={18} style={{ color: '#10b981' }} /> {t('E-mail je změněný.')}</h3>
            <p className="text-sm m-0 leading-relaxed break-all"><b>{result?.old_email}</b> → <b>{result?.new_email}</b></p>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{t('Uživatel dostal oznámení v appce. Řekni mu to i mimo aplikaci - přihlašovat se bude novým e-mailem.')}</p>
            <div className="flex justify-end"><SmallButton tone="primary" onClick={onClose}>{t('Hotovo')}</SmallButton></div>
          </>
        )}
      </div>
    </div>
  );
};

// Zamítnutí žádosti o změnu e-mailu: uživatel dostane oznámení, volitelně s důvodem.
const REJECT_REASON_MAX = 300;
const RejectEmailChangeDialog = ({ target, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const reject = async () => {
    setBusy(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('admin_reject_email_change', { p_notification: target.notificationId, p_reason: reason.trim() || null });
    setBusy(false);
    if (rpcError) return setError(mapAdminError(rpcError));
    onDone?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[130] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Zamítnutí žádosti o změnu e-mailu')}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
        className="border rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[92dvh] overflow-y-auto"
      >
        <h3 className="text-base font-black uppercase tracking-tight m-0 flex items-center gap-2"><XCircle size={18} /> {t('Zamítnout žádost?')}</h3>
        <p className="text-sm m-0 leading-relaxed">{t('Účet:')} <b className="break-all">{target.username || target.email}</b></p>
        <label className="block">
          <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-1">{t('Důvod (nepovinný)')}</span>
          <textarea
            aria-label={t('Důvod zamítnutí')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REJECT_REASON_MAX}
            rows={3}
            disabled={busy}
            style={selectStyle}
            className="w-full p-2.5 border rounded-lg text-xs font-semibold outline-none resize-y disabled:opacity-50"
          />
          <span style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] block mt-1">{t('Uživatel dostane oznámení v appce a důvod v něm uvidí.')} {reason.length}/{REJECT_REASON_MAX}</span>
        </label>
        {error && <InlineMessage type="error">{error}</InlineMessage>}
        <div className="flex gap-2 justify-end">
          <SmallButton onClick={onClose} disabled={busy}>{t('Zpět')}</SmallButton>
          <SmallButton tone="danger" busy={busy} onClick={reject}><XCircle size={13} /> {t('Zamítnout')}</SmallButton>
        </div>
      </div>
    </div>
  );
};

const NOTIF_STATUS = { open: [tk('Otevřené'), 'warn'], done: [tk('Vyřízeno'), 'ok'], dismissed: [tk('Zamítnuto'), 'muted'] };
const NOTIF_FILTERS = [['open', tk('Otevřené')], ['all', tk('Vše')]];
const REPORT_STATUS = { open: [tk('Otevřené'), 'warn'], done: [tk('Smazáno'), 'ok'], dismissed: [tk('Ponecháno'), 'muted'] };
const REPORT_REASONS = { spam: 'spam', abuse: tk('urážky'), inappropriate: tk('nevhodný obsah'), other: tk('jiný důvod') };

export const NotificationsTab = ({ onCountChange, currentUserId, onOpenAccount, onChanged }) => {
  const [filter, setFilter] = useState('open');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState(null);
  const [issueFor, setIssueFor] = useState(null);
  const [emailFor, setEmailFor] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
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
    setMsg({ type: 'success', text: del ? (data?.deleted ? t('Komentář je smazaný.') : t('Komentář už byl dřív smazaný, upozornění je vyřízené.')) : t('Komentář je ponechaný.') });
    await load();
  };

  // Po změně e-mailu nebo zamítnutí žádosti se znovu načte seznam i počty a dá se vědět nadřazené stránce (její seznam účtů).
  const emailRequestHandled = async (text) => {
    setMsg({ type: 'success', text });
    await load();
    onChanged?.();
  };

  const clearHandled = async () => {
    setMsg(null);
    const { data, error: rpcError } = await supabase.rpc('admin_clear_handled_notifications');
    if (rpcError) return setMsg({ type: 'error', text: mapAdminError(rpcError) });
    setMsg({ type: 'success', text: t('Smazáno vyřízených upozornění: {n}.', { n: data?.deleted ?? 0 }) });
    await load();
  };

  if (missing) {
    return <InlineMessage type="error">{t('Upozornění teď nejdou načíst. Obnov stránku.')}</InlineMessage>;
  }

  const hasHandled = (items || []).some(n => n.status !== 'open');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('Filtr upozornění')} className="flex gap-1">
          {NOTIF_FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              style={filter === value ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' } : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}
              className="px-3 py-1.5 rounded-lg border-none cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider">{t(label)}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <SmallButton onClick={load}><RefreshCw size={13} /> {t('Obnovit')}</SmallButton>
          {filter === 'all' && hasHandled && <SmallButton onClick={clearHandled}><Trash2 size={13} /> {t('Smazat vyřízená')}</SmallButton>}
        </div>
      </div>

      {msg && <InlineMessage type={msg.type}>{msg.text}</InlineMessage>}
      {error && <InlineMessage type="error">{error}</InlineMessage>}
      {items === null && <p style={{ color: 'var(--text-muted)' }} className="text-xs font-bold flex items-center gap-2 m-0"><Loader2 size={14} className="animate-spin" /> {t('Načítám...')}</p>}
      {items && items.length === 0 && !error && (
        <Card className="text-center py-10"><p style={{ color: 'var(--text-muted)' }} className="text-xs font-bold m-0">{filter === 'open' ? t('Žádná otevřená upozornění.') : t('Zatím žádná upozornění.')}</p></Card>
      )}

      {(items || []).map(n => {
        const isReport = n.kind === 'comment_report';
        const [statusLabel, statusTone] = (isReport ? REPORT_STATUS : NOTIF_STATUS)[n.status] || [n.status, 'muted'];
        const u = n.user;
        const isPassword = n.kind === 'password_request';
        const isEmail = n.kind === EMAIL_REQUEST_KIND;
        const isOwnRequest = !!u && u.id === currentUserId;
        const ownRequestTitle = isOwnRequest ? t('Vlastní žádost nevyřídíš - nech to na druhém správci, nebo ji zruš v Nastavení → Zrušit žádost.') : undefined;
        return (
          <div key={n.id} data-testid="notification">
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-sm font-black uppercase tracking-tight m-0 flex items-center gap-2">{isReport ? <Flag size={15} /> : isEmail ? <Mail size={15} /> : <KeyRound size={15} />} {isEmail ? t('Žádost o změnu e-mailu') : n.title}</h4>
                <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 mt-1 opacity-80">{relativeTime(n.created_at)} · {formatDateTime(n.created_at)}{n.handled_at ? ` · ${t('vyřízeno {time}', { time: formatDateTime(n.handled_at) })}` : ''}</p>
              </div>
              <Pill tone={statusTone}>{t(statusLabel)}</Pill>
            </div>

            {u ? (
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs m-0">
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Účet')}</dt><dd className="m-0 font-semibold break-all">{u.username || '-'} <span style={{ color: 'var(--text-muted)' }}>({t(ROLE_LABELS[u.role] || u.role)})</span></dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('E-mail')}</dt><dd className="m-0 font-semibold break-all">{u.email}</dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Založen')}</dt><dd className="m-0 font-semibold">{formatDate(u.created_at)}</dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Poslední přihlášení')}</dt><dd className="m-0 font-semibold">{u.last_sign_in_at ? relativeTime(u.last_sign_in_at) : t('nikdy')}</dd>
              </dl>
            ) : <InlineMessage>{t('Účet už neexistuje.')}</InlineMessage>}

            {isReport && (
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs m-0">
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Kniha')}</dt><dd className="m-0 font-semibold break-words">{n.payload?.book_title || '-'}</dd>
                <dt style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Nahlášení')}</dt>
                <dd className="m-0 font-semibold">{n.payload?.reports || 1}× <span style={{ color: 'var(--text-muted)' }}>({Object.entries(n.payload?.reasons || {}).map(([k, v]) => `${t(REPORT_REASONS[k] || k)} ${v}×`).join(', ')})</span></dd>
              </dl>
            )}

            {isEmail && (
              <p className="text-xs m-0 leading-relaxed">
                <span style={{ color: 'var(--text-muted)' }} className="font-bold">{t('Nový e-mail:')} </span><b className="break-all">{n.payload?.new_email || '-'}</b>
              </p>
            )}
            {isEmail && n.status === 'open' && n.payload?.conflict && <InlineMessage type="error">{t('V době žádosti tenhle e-mail už používal jiný účet - změna se nejspíš nepovede.')}</InlineMessage>}
            {isEmail && n.status === 'dismissed' && n.payload?.cancelled && <InlineMessage>{t('Uživatel žádost zrušil.')}</InlineMessage>}

            {n.body && <p style={{ backgroundColor: 'var(--bg-secondary)' }} className="text-sm m-0 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap break-words">„{n.body}“</p>}
            {isPassword && <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 leading-relaxed opacity-90">{n.payload?.logged_in ? t('Žádost poslal přihlášený uživatel z Nastavení.') : t('Žádost poslal nepřihlášený člověk (zapomenuté heslo).')} {t('E-mail i jméno sedí, ale to samo nedokazuje, že žádá majitel účtu - ověř to mimo aplikaci.')}</p>}

            <div className="flex flex-wrap gap-2">
              {u && onOpenAccount && <SmallButton onClick={() => onOpenAccount(u)}><UserCog size={13} /> {t('Otevřít účet')}</SmallButton>}
              {n.status === 'open' && isReport ? (
                <>
                  {confirmDeleteId === n.id
                    ? <SmallButton tone="danger" busy={busyId === n.id} onClick={() => resolveReport(n, true)}><Trash2 size={13} /> {t('Opravdu smazat')}</SmallButton>
                    : <SmallButton tone="danger" busy={busyId === n.id} onClick={() => setConfirmDeleteId(n.id)}><Trash2 size={13} /> {t('Smazat komentář')}</SmallButton>}
                  <SmallButton busy={busyId === n.id} onClick={() => (confirmDeleteId === n.id ? setConfirmDeleteId(null) : resolveReport(n, false))}>
                    <CheckCircle2 size={13} /> {confirmDeleteId === n.id ? t('Zpět') : t('Ponechat komentář')}
                  </SmallButton>
                </>
              ) : n.status === 'open' && isEmail ? (
                <>
                  <SmallButton tone="primary" disabled={!u || isOwnRequest || !n.payload?.new_email} title={ownRequestTitle} onClick={() => { setMsg(null); setEmailFor({ userId: u.id, username: u.username, currentEmail: u.email, newEmail: n.payload.new_email, notificationId: n.id }); }}><Mail size={13} /> {t('Změnit e-mail')}</SmallButton>
                  {u
                    ? <SmallButton disabled={isOwnRequest} title={ownRequestTitle} onClick={() => { setMsg(null); setRejectFor({ notificationId: n.id, username: u.username, email: u.email }); }}><XCircle size={13} /> {t('Zamítnout')}</SmallButton>
                    : <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'dismissed')}><XCircle size={13} /> {t('Zamítnout')}</SmallButton>}
                </>
              ) : n.status === 'open' ? (
                <>
                  {isPassword && u && <SmallButton tone="primary" disabled={u.id === currentUserId} onClick={() => setIssueFor({ id: u.id, username: u.username, email: u.email, notificationId: n.id })}><KeyRound size={13} /> {t('Vydat dočasné heslo')}</SmallButton>}
                  <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'dismissed')}><XCircle size={13} /> {t('Zamítnout')}</SmallButton>
                  <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'done')}><CheckCircle2 size={13} /> {t('Vyřízeno')}</SmallButton>
                </>
              ) : !isEmail && (
                <SmallButton busy={busyId === n.id} onClick={() => setStatus(n, 'open')}><RefreshCw size={13} /> {t('Znovu otevřít')}</SmallButton>
              )}
            </div>
            {isEmail && n.status === 'open' && u && <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 leading-relaxed opacity-90">{t('To, že žádost poslal přihlášený uživatel, nedokazuje, že žádá majitel účtu - ověř to mimo aplikaci.')}</p>}
          </Card>
          </div>
        );
      })}

      {issueFor && <TempPasswordDialog target={issueFor} onClose={() => setIssueFor(null)} onIssued={load} />}
      {emailFor && <ChangeEmailDialog target={emailFor} onClose={() => setEmailFor(null)} onDone={() => emailRequestHandled(t('E-mail je změněný a žádost je vyřízená.'))} />}
      {rejectFor && <RejectEmailChangeDialog target={rejectFor} onClose={() => setRejectFor(null)} onDone={() => emailRequestHandled(t('Žádost je zamítnutá, uživatel dostane oznámení.'))} />}
    </div>
  );
};

// ============================================================================
// Admin: Systémový log (auditní log) - filtry na serveru, hledání, období, stránkování a export do CSV
// ============================================================================
const LOG_TYPES = ['INFO', 'SUCCESS', 'WARN', 'DANGER', 'ERROR'];
const LOG_PERIODS = [['24h', tk('Posledních 24 h'), 86400000], ['7d', tk('Posledních 7 dní'), 7 * 86400000], ['30d', tk('Posledních 30 dní'), 30 * 86400000], ['all', tk('Celá historie'), null]];
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
export const buildLogsCsv = (rows) => `\uFEFF${[t('"Čas"'), '"Typ"', t('"Zpráva"')].join(';')}\r\n${rows.map(r => [csvCell(r.created_at), csvCell(r.log_type || 'INFO'), csvCell(r.message)].join(';')).join('\r\n')}`;

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
    if (rpcError) { setError(t('Logy se nepodařilo načíst. Zkus to znovu.')); setRows([]); setTotal(0); setHasMore(false); return; }
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
    if (rpcError) return setError(t('Další záznamy se nepodařilo načíst.'));
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
      if (rpcError) { setExporting(false); return setMsg({ type: 'error', text: t('Export se nepodařil. Zkus to znovu.') }); }
      all.push(...(data || []));
      if (!data || data.length < LOG_EXPORT_PAGE) break;
      if (from + LOG_EXPORT_PAGE >= LOG_EXPORT_MAX) truncated = true;
    }
    download(`system-log_${new Date().toISOString().slice(0, 10)}.csv`, buildLogsCsv(all));
    // Export dat je sám citlivá akce: zapíše se do logu.
    await supabase.from('system_logs').insert([{ log_type: 'INFO', message: `Správce exportoval systémový log do CSV (${all.length} ${plural(all.length, 'záznam', 'záznamy', 'záznamů')}).` }]); // i18n-ok: záznam v logu je data a zůstává česky
    setMsg({ type: 'success', text: truncated ? t('Exportováno {n} nejnovějších záznamů (nejvýš {max}). Zúžením filtru získáš starší.', { n: all.length, max: LOG_EXPORT_MAX }) : t('Exportováno záznamů: {n}.', { n: all.length }) });
    setExporting(false);
  };

  const filtered = type !== 'all' || period !== '7d' || search.trim() !== '';
  const inputCls = 'bg-slate-900 border border-slate-800 rounded-lg text-emerald-400 font-mono text-xs outline-none px-2.5 py-2 placeholder:text-slate-600';

  return (
    // Pevné tmavé pozadí (ne <Card>): ten si bere barvy z motivu, takže ve světlém motivu by světlé písmo terminálu zmizelo.
    <div data-testid="logs-panel" style={{ backgroundColor: '#020617', borderColor: '#0f172a' }} className="text-emerald-400 font-mono p-4 sm:p-5 border border-solid shadow-2xl rounded-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black uppercase tracking-widest pb-3 border-b border-solid border-slate-900">
        <span className="flex items-center gap-1.5 text-slate-400"><Terminal size={14} /> {t('Systémový log')}</span>
        <span className="flex items-center gap-1.5 text-[0.625rem] text-slate-500 normal-case tracking-normal font-bold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t('živě')}</span>
      </div>

      <div className="space-y-3">
        <div role="group" aria-label={t('Typ záznamu')} className="flex flex-wrap gap-1.5">
          {['all', ...LOG_TYPES].map(lt => (
            <button key={lt} type="button" aria-pressed={type === lt} onClick={() => setType(lt)}
              className={`px-2.5 py-1.5 rounded-lg border text-[0.625rem] font-black uppercase tracking-wider cursor-pointer ${type === lt ? 'bg-emerald-400 text-slate-950 border-emerald-400' : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-emerald-400'}`}>
              {lt === 'all' ? t('Vše') : lt}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="search" aria-label={t('Hledat v logu')} placeholder={t('Hledat ve zprávách...')} value={searchInput} onChange={e => setSearchInput(e.target.value)} className={`${inputCls} flex-1 min-w-0`} />
          <select aria-label={t('Období')} value={period} onChange={e => setPeriod(e.target.value)} className={`${inputCls} cursor-pointer`}>
            {LOG_PERIODS.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-slate-500 font-bold">
        <span data-testid="logs-count">{rows === null ? t('Načítám...') : `Zobrazeno ${rows.length}${typeof total === 'number' ? ` z ${total}` : ''}${filtered ? ' (podle filtru)' : ''}`}</span>
        <span className="flex gap-2">
          <button type="button" onClick={load} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2.5 py-1.5 cursor-pointer text-[0.625rem] font-black uppercase tracking-wider hover:text-emerald-400"><RefreshCw size={11} /> {t('Obnovit')}</button>
          <button type="button" onClick={exportCsv} disabled={exporting || !rows || rows.length === 0} className="inline-flex items-center gap-1 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2.5 py-1.5 cursor-pointer text-[0.625rem] font-black uppercase tracking-wider hover:text-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed">
            {exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />} {t('Export CSV')}
          </button>
        </span>
      </div>

      {msg && <p role={msg.type === 'error' ? 'alert' : 'status'} className={`text-[0.6875rem] font-bold m-0 ${msg.type === 'error' ? 'text-red-400' : 'text-emerald-300'}`}>{msg.text}</p>}
      {error && <p role="alert" className="text-[0.6875rem] font-bold m-0 text-red-400">{error}</p>}

      <div className="max-h-[500px] overflow-y-auto space-y-1.5 pr-2 text-xs">
        {rows === null ? (
          <p className="text-slate-500 text-center py-12 m-0 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> {t('Načítám...')}</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-500 italic text-center py-12 m-0">{filtered ? t('Žádný záznam neodpovídá filtru.') : t('Žádné systémové logy zatím nebyly zachyceny.')}</p>
        ) : (
          rows.map((log, index) => (
            <div key={log.id || index} data-testid="log-row" className="py-1.5 border-b border-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-1 hover:bg-slate-900/30 px-1 rounded transition-colors">
              <span className="break-words min-w-0">
                <span className={`inline-block w-20 uppercase font-black ${LOG_TYPE_COLORS[log.log_type] || 'text-slate-400'}`}>[{log.log_type || 'INFO'}]</span> {/* i18n-ok: typ záznamu je kód */}
                <span className="text-slate-200">{log.message}</span>
              </span>
              <span className="text-[0.625rem] text-slate-500 shrink-0 font-sans sm:font-mono">{log.created_at ? formatDateTimeI18n(log.created_at) : t('Nyní')}</span>
            </div>
          ))
        )}
        {hasMore && rows && rows.length > 0 && (
          <div className="pt-2 text-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} className="inline-flex items-center gap-1.5 bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-4 py-2 cursor-pointer text-[0.625rem] font-black uppercase tracking-wider hover:text-emerald-400 disabled:opacity-50">
              {loadingMore && <Loader2 size={11} className="animate-spin" />} {t('Načíst starší')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const AccountsTab = ({ currentUserId, preset, onChanged, onPresetEmailChanged }) => {
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
            <input type="search" aria-label={t('Hledat účet')} placeholder={t('Hledat podle e-mailu nebo jména...')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} style={selectStyle} className="w-full pl-9 pr-3 py-2.5 border rounded-lg text-sm font-semibold outline-none" />
          </div>
          <select aria-label={t('Filtr role')} value={role} onChange={changeFilter(setRole)} style={selectStyle} className={selectClass}>{ROLE_FILTERS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
          <select aria-label={t('Filtr stavu')} value={status} onChange={changeFilter(setStatus)} style={selectStyle} className={selectClass}>{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
          <select aria-label={t('Řazení')} value={sort} onChange={changeFilter(setSort)} style={selectStyle} className={selectClass}>{SORTS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
        </div>
      </Card>

      {error && <InlineMessage type="error">{error}</InlineMessage>}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-black uppercase tracking-wider m-0">{t('Účty')} <span style={{ color: 'var(--text-muted)' }} className="font-bold normal-case tracking-normal">({formatNumber(result.total)})</span></p>
          {loading && <Loader2 size={14} className="animate-spin opacity-50" />}
        </div>

        {result.rows.length === 0 && !loading ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-sm m-0 py-6 text-center opacity-70">{t('Žádný účet neodpovídá filtru.')}</p>
        ) : (
          <ul className="m-0 p-0 list-none divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {result.rows.map(r => (
              <li key={r.id}>
                <button type="button" data-testid="account-row" onClick={() => setSelectedId(r.id)} className="w-full text-left bg-transparent border-none cursor-pointer text-current py-3 px-1 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 hover:bg-black/5 rounded-lg">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold break-all">{r.email}</span>
                    {r.username && <span data-testid="account-username" style={{ color: 'var(--text-muted)' }} className="block text-xs font-semibold break-all">@{r.username}</span>}
                    <span className="flex flex-wrap gap-1 mt-1">
                      <Pill tone="accent">{r.has_profile ? t(ROLE_LABELS[r.role] || r.role) : t('Bez profilu')}</Pill>
                      {r.is_banned && <Pill tone="danger">{t('Zablokován')}</Pill>}
                      {!r.email_confirmed && <Pill tone="warn">{t('Nepotvrzen')}</Pill>}
                    </span>
                  </span>
                  <span style={{ color: 'var(--text-muted)' }} className="text-xs flex sm:block gap-3 sm:text-right sm:w-40 shrink-0">
                    <span className="block">{t('přihlášen {time}', { time: relativeTime(r.last_sign_in_at) })}</span>
                    <span className="block opacity-80">{t('{coins} · {n} přečteno', { coins: t.p(r.coins, '{n} mince', '{n} mince', '{n} mincí', { n: formatNumber(r.coins) }), n: r.books_read })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{t('Zobrazeno {from}-{to} z {total}', { from, to, total: formatNumber(result.total) })}</p>
          <div className="flex items-center gap-2">
            <SmallButton aria-label={t('Předchozí strana')} disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></SmallButton>
            <span className="text-xs font-bold tabular-nums">{page + 1} / {pageCount}</span>
            <SmallButton aria-label={t('Další strana')} disabled={page + 1 >= pageCount || loading} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></SmallButton>
          </div>
        </div>
      </Card>

      {selectedId && (
        <AccountDetail
          userId={selectedId}
          currentUserId={currentUserId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { setReloadKey(k => k + 1); onChanged?.(); }}
          onEmailChanged={(oldEmail, newEmail) => {
            // Hledání podle starého e-mailu by už účet nenašlo.
            if (newEmail && sameEmail(searchInput, oldEmail)) { setSearchInput(newEmail); setSearch(newEmail); setPage(0); }
            onPresetEmailChanged?.(oldEmail, newEmail); // předvolba z Upozornění by po návratu na záložku hledala starý e-mail
          }}
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
  const [activeTab, setActiveTab] = useState(() => peekAdminTabRequest() || 'overview'); // po náhledu prohlídky rovnou záložka Prohlídka appky; overview | notifications | accounts | books | shorts | homepage | tour | users | logs
  const [pendingCount, setPendingCount] = useState(0); // otevřená upozornění (odznak na záložce)
  const [logCount, setLogCount] = useState(0); // počet záznamů v systémovém logu (karta nahoře)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('admin_open_notifications_count');
      if (!error && typeof data === 'number') setPendingCount(data);
    })();
  }, []);
  // Změna e-mailu z detailu účtu uzavře i otevřenou žádost toho uživatele: odznak v záložce a v liště se přepočítá.
  const refreshPending = async () => {
    const { data, error } = await supabase.rpc('admin_open_notifications_count');
    if (error || typeof data !== 'number') return;
    setPendingCount(data);
    window.dispatchEvent(new CustomEvent('jomarid-admin-notifications', { detail: data }));
  };
  const { user: adminUser } = useAuth();
  const [accountsPreset, setAccountsPreset] = useState(null); // filtr předaný z Přehledu do záložky Účty
  const [bulkGrantOpen, setBulkGrantOpen] = useState(false); // potvrzení hromadného rozdání knihy
  const [globalLoading, setGlobalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  // Neúplné načtení (výpadek, přetížená databáze): zůstanou předchozí seznamy a ukáže se upozornění, ne prázdný přehled.
  const [loadProblem, setLoadProblem] = useState(false);
  
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
  const [priceCoins, setPriceCoins] = useState(DEFAULT_BOOK_PRICE); 
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
      // Knihy, skryté knihy a profily se čtou současně (jsou na sobě nezávislé).
      const [booksRes, hiddenRes, profilesRes] = await Promise.all([
        readAllRows('books', 'id, title, author, author_display, author_id, fake_likes, is_auto_assigned, price_coins, book_likes(count)'),
        readAllRows('books', 'id, is_hidden'),
        readAllRows('profiles', '*'),
      ]);
      const { data: b, error: booksErr } = booksRes;

      // Skryté knihy zvlášť: kdyby sloupec is_hidden ještě neexistoval (starší databáze, kód 42703), jen se nezobrazí
      // štítky. Jiná chyba (výpadek) je ale neúplné načtení: jinak by se skryté knihy tvářily jako viditelné.
      const { data: hiddenRows, error: hiddenErr } = hiddenRes;
      const hiddenFailed = !!hiddenErr && hiddenErr.code !== '42703';
      const hiddenMap = new Map((!hiddenErr && hiddenRows ? hiddenRows : []).map(r => [r.id, !!r.is_hidden]));
        
      // Profily (nejnovější účty první)
      const { data: profileRows, error: profilesErr } = profilesRes;
      const p = profileRows ? [...profileRows].sort((x, y) => new Date(y.created_at) - new Date(x.created_at)) : profileRows;
      const booksOk = !booksErr && !hiddenFailed;
      const profilesOk = !profilesErr;
      setLoadProblem(!booksOk || !profilesOk);
      
      const { count: logsTotal } = await supabase.from('system_logs').select('id', { count: 'exact', head: true });
      setLogCount(typeof logsTotal === 'number' ? logsTotal : 0);

      // Posledních 50 komentářů napříč knihami - pro moderaci (viz Moderace komentářů).
      const { data: c } = await supabase
        .from('book_comments')
        .select('id, content, author_name, book_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      // Nastavení domovské stránky
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
          price_coins: book.price_coins ?? DEFAULT_BOOK_PRICE,
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

      // Seznam, který se nenačetl celý, se nepřepisuje: radši zastaralý než zdánlivě prázdný.
      if (booksOk) { setBooks(booksWithLikes); setComments(mapovaneKomentare); }
      if (profilesOk) setProfiles(p || []);
    } catch (err) {
      console.error("Chyba v refreshData:", err);
    } finally {
      setGlobalLoading(false);
    }
  };

  // Data se načtou při otevření administrace.
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
  // Inventář titulů se vykresluje po částech, ať katalog s tisíci knihami nezpomalí celou administraci.
  const pagedBooks = usePagedList(filteredBooks, { pageSize: 50, resetKey: searchBook });

  const filteredProfiles = useMemo(() => {
    return profiles.filter(p => {
      const matchesSearch = p.email?.toLowerCase().includes(searchUser.toLowerCase());
      const matchesRole = filterRole === 'all' || (p.role || ROLE_READER) === filterRole;
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
      await safeLog('SUCCESS', `Kniha ID ${bookId} ručně propojena s účtem ${selectedProfile?.email || selectedProfileId}.`); // i18n-ok: záznam v logu je data a zůstává česky
      setResolveAuthorSelections(prev => {
        const next = { ...prev };
        delete next[bookId];
        return next;
      });
      refreshData();
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Přiřazení účtu selhalo.')));
    } finally {
      setActionLoading(false);
    }
  };

  const saveBook = async (e) => {
    e.preventDefault();
    if (!title) return alert(t('Doplň název knihy.'));
    setActionLoading(true);

    // Text knihy se neukládá do tabulky books, ale do Storage (bucket "book-texts", viz src/bookText/bookText.js);
    // books zůstává volně čitelná pro procházení knihovny a nákup.
    // Autor se hledá mezi účty podle uživatelského jména (nebo předpony e-mailu). Jednoznačná shoda se použije
    // rovnou, i s krycím jménem (viz Nakladatelský panel), jinak by kniha ukazovala skutečné uživatelské jméno,
    // dokud ji nakladatel sám znovu neuloží. Při shodě víc účtů dostane přednost nakladatel nebo správce.
    // Je-li nejednoznačná i tahle volba, author_id zůstane prázdné: radši knihu nepřiřadit, než ji omylem
    // přiřadit cizímu účtu.
    const targetUsername = (author || '').trim();
    const matchingProfiles = profiles.filter(p => p.email && (p.username || p.email.split('@')[0]) === targetUsername);
    let resolvedProfile = null;
    if (matchingProfiles.length === 1) {
      resolvedProfile = matchingProfiles[0];
    } else if (matchingProfiles.length > 1) {
      const preferred = matchingProfiles.filter(p => p.role === ROLE_PUBLISHER || p.role === ROLE_ADMIN);
      if (preferred.length === 1) resolvedProfile = preferred[0];
      // jinak je to nejednoznačné i mezi preferovanými rolemi: author_id zůstane null
    }
    const payload = { 
      title, 
      author: author || t('Neznámý'), 
      author_id: resolvedProfile?.id || null,
      author_display: resolvedProfile?.pen_name || null,
      fake_likes: parseInt(fakeLikes) || 0,
      is_auto_assigned: isAutoAssigned,
      price_coins: Math.max(0, parseInt(priceCoins, 10) || 0),
      genres: cleanGenres(genresInput.split(',')),
      description: descriptionInput || null
    };

    if (editingBookId) {
      const { error } = await supabase.from('books').update(payload).eq('id', editingBookId);
      if (!error) {
        const { error: contentErr } = await saveBookText(supabase, editingBookId, content);
        if (contentErr) alert(friendlyErrorWithDetail(contentErr, t('Kniha je uložená, ale text se nepodařilo uložit.')));
        await safeLog('SUCCESS', `Upravena kniha: ${title} (Auto-přiřazení: ${isAutoAssigned ? 'ANO' : 'NE'}, Cena: ${payload.price_coins} mincí)`); // i18n-ok: záznam v logu je data a zůstává česky
        setEditingBookId(null);
        setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(DEFAULT_BOOK_PRICE); setGenresInput(''); setDescriptionInput('');
        refreshData();
      } else {
        alert(friendlyErrorWithDetail(error, t('Chyba při úpravě.')));
      }
    } else {
      if (!content) { setActionLoading(false); return alert(t('Doplň text knihy.')); }
      const { data: newBook, error } = await supabase.from('books').insert([payload]).select('id').single();
      if (!error && newBook) {
        const { error: contentErr } = await saveBookText(supabase, newBook.id, content);
        if (contentErr) alert(friendlyErrorWithDetail(contentErr, t('Kniha je vytvořená, ale text se nepodařilo uložit.')));
        await safeLog('SUCCESS', `Uložená nová kniha: ${title} (Auto-přiřazení: ${isAutoAssigned ? 'ANO' : 'NE'}, Cena: ${payload.price_coins} mincí)`); // i18n-ok: záznam v logu je data a zůstává česky
        setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(DEFAULT_BOOK_PRICE); setGenresInput(''); setDescriptionInput('');
        refreshData();
      } else {
        alert(friendlyErrorWithDetail(error, t('Chyba při ukládání.')));
      }
    }
    setActionLoading(false);
  };

  const startEditBook = async (book) => {
    const [{ data, error }, { data: contentRow, error: contentErr }] = await Promise.all([
      supabase.from('books').select('fake_likes, is_auto_assigned, price_coins, genres, description').eq('id', book.id).single(),
      fetchBookText(supabase, book.id).then((r) => ({ data: r, error: r.error }))
    ]);
    if (!error && data && !contentErr) {
      setEditingBookId(book.id);
      setTitle(book.title);
      setAuthor(book.author);
      setContent(contentRow?.text || '');
      setFakeLikes(data.fake_likes || 0);
      setIsAutoAssigned(data.is_auto_assigned || false);
      setPriceCoins(data.price_coins ?? DEFAULT_BOOK_PRICE);
      setGenresInput(Array.isArray(data.genres) ? data.genres.join(', ') : '');
      setDescriptionInput(data.description || '');
      setActiveTab('books'); 
    } else {
      alert(t('Nepodařilo se načíst kompletní text knihy k editaci.'));
    }
  };

  const handleSaveFakeXp = async () => {
    if (!activeUser) return;
    const xpNum = Math.max(0, parseInt(userFakeXpInput, 10) || 0);

    setActionLoading(true);
    const { error } = await supabase.from('profiles').update({ fake_xp: xpNum }).eq('id', activeUser.id);

    if (!error) {
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} nastaveno ${xpNum} bonusových XP.`); // i18n-ok: záznam v logu je data a zůstává česky
      setActiveUser(prev => prev ? { ...prev, fake_xp: xpNum } : null);
      setUserFakeXpInput(xpNum);
      refreshData();
    } else {
      alert(friendlyErrorWithDetail(error, t('Chyba při ukládání XP.')));
    }
    setActionLoading(false);
  };

  const handleGrantCoins = async () => {
    if (!activeUser) return;
    const amountNum = parseInt(coinGrantInput, 10);
    if (!amountNum) return alert(t('Zadej nenulovou částku (záporná = odečíst).'));

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_grant_coins', {
        target_user_id: activeUser.id,
        amount: amountNum,
        reason: coinGrantReason || null
      });
      if (error) throw error;
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} připsáno ${amountNum} mincí (${coinGrantReason || 'bez důvodu'}). Nový zůstatek: ${data?.new_balance}.`); // i18n-ok: záznam v logu je data a zůstává česky
      setActiveUser(prev => prev ? { ...prev, coins: data?.new_balance } : null);
      setCoinGrantInput('');
      setCoinGrantReason('');
      refreshData();
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Připsání mincí selhalo.')));
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
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} přidán 1 Streak Freeze (nyní ${newCount}).`); // i18n-ok: záznam v logu je data a zůstává česky
      setActiveUser(prev => prev ? { ...prev, streak_freezes: newCount } : null);
      refreshData();
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Přidání Streak Freeze selhalo.')));
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
      await safeLog('SUCCESS', t('Aktualizován obsah domovské stránky.'));
      alert(t('Domovská stránka uložena.'));
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Uložení domovské stránky selhalo.')));
    } finally {
      setSavingHomepage(false);
    }
  };

  const handleDeleteComment = async (commentId, preview) => {
    if (!confirm(t('Smazat komentář "{preview}"?', { preview }))) return;
    try {
      const { error } = await supabase.from('book_comments').delete().eq('id', commentId);
      if (error) throw error;
      setComments(prev => prev.filter(cm => cm.id !== commentId));
      await safeLog('SUCCESS', `Smazán komentář (moderace): "${preview}"`); // i18n-ok: záznam v logu je data a zůstává česky
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Smazání komentáře selhalo.')));
    }
  };

  // Role se mění stejnou funkcí jako v záložce Účty. Ta hlídá, že správce nezmění roli sám sobě.
  const toggleRole = async (uId, currentRole) => {
    const nextRole = currentRole === ROLE_READER ? ROLE_PUBLISHER : currentRole === ROLE_PUBLISHER ? ROLE_ADMIN : ROLE_READER;

    setActionLoading(true);
    const { error } = await supabase.rpc('admin_set_role', { p_user_id: uId, p_role: nextRole });
    if (error) {
      alert(mapAdminError(error));
    } else {
      await safeLog('WARN', `Změna role uživatele ${uId} na ${nextRole}`); // i18n-ok: záznam v logu je data a zůstává česky
      await refreshData();
    }
    setActionLoading(false);
  };

  // Skrytá kniha zmizí z katalogu pro čtenáře; autor a správce ji dál vidí. Autor ji může zase zveřejnit sám.
  const toggleBookHidden = async (book) => {
    setActionLoading(true);
    const { error } = await supabase.from('books').update({ is_hidden: !book.isHidden }).eq('id', book.id);
    if (!error) {
      await safeLog('WARN', `${book.isHidden ? t('Znovu zveřejněna') : 'Skryta'} kniha: ${book.title}`);
      refreshData();
    } else {
      alert(friendlyErrorWithDetail(error, t('Chyba při změně viditelnosti knihy.')));
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
      await safeLog('SUCCESS', `Změněn status automatického přidělení pro Knihu ID: ${bookId}`); // i18n-ok: záznam v logu je data a zůstává česky
      refreshData();
    } else {
      alert(friendlyErrorWithDetail(error, t('Chyba při změně auto-assign stavu.')));
    }
    setActionLoading(false);
  };

  const revokeAllLicenses = async (uId, uEmail) => {
    if (!confirm(t('Opravdu chceš uživateli {email} odebrat všechny licence? Uživatel ztratí přístup ke všem knihám.', { email: uEmail }))) return;
    setActionLoading(true);
    const { error } = await supabase.from('user_books').delete().eq('user_id', uId);
    if (!error) {
      await safeLog('WARN', `Kompletní revokace licencí pro uživatele: ${uEmail}`); // i18n-ok: záznam v logu je data a zůstává česky
      alert(t('Všechny přístupy byly smazány.'));
      refreshData();
    } else {
      alert(friendlyErrorWithDetail(error, t('Chyba při odebírání.')));
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
      alert(friendlyErrorWithDetail(error, t('Chyba při přiřazování licence.')));
    } else {
      await safeLog('SUCCESS', `Přiřazena aktivní kniha uživateli ${activeUser.email}`); // i18n-ok: záznam v logu je data a zůstává česky
      setSelectedBookId('');
      refreshData();
    }
    setActionLoading(false);
  };

  const incompleteListsAlert = () => alert(t('Seznam knih nebo účtů se nepodařilo načíst celý, hromadná akce by pracovala s neúplnými daty. Obnov data tlačítkem Obnovit data a zkus to znovu.'));

  const assignAllBooksToUser = async () => {
    if (!activeUser || books.length === 0) return;
    if (loadProblem) return incompleteListsAlert();
    if (!confirm(t('Opravdu chceš uživateli {email} okamžitě odemknout všechny knihy?', { email: activeUser.email }))) return;

    setActionLoading(true);
    try {
      const { data: existingUserBooks, error: fetchError } = await readAllRows('user_books', 'book_id, id, status', (q) => q.eq('user_id', activeUser.id));
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

      await safeLog('SUCCESS', `Hromadně aktivovány VŠECHNY knihy pro: ${activeUser.email}`); // i18n-ok: záznam v logu je data a zůstává česky
      refreshData();
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Něco se nepovedlo.')));
    } finally {
      setActionLoading(false);
    }
  };

  // Rozdání knihy všem účtům je nevratné a ničí její cenu, proto se místo prostého
  // "OK / Zrušit" musí opsat název knihy (viz TypedConfirm dole).
  const assignSelectedBookToAllUsers = () => {
    if (!selectedBookId) return alert(t('Nejprve vyber knihu z rozevíracího seznamu.'));
    const selectedBook = books.find(b => b.id === selectedBookId);
    if (!selectedBook) return;
    if (loadProblem) return incompleteListsAlert();
    if (profiles.length === 0) return alert(t('V systému nejsou žádní uživatelé.'));
    setBulkGrantOpen(true);
  };

  const runBulkGrant = async () => {
    const selectedBook = books.find(b => b.id === selectedBookId);
    if (!selectedBook) return setBulkGrantOpen(false);
    setBulkGrantOpen(false);
    setActionLoading(true);
    try {
      const { data: alreadyHasBook, error: fetchError } = await readAllRows('user_books', 'user_id, id, status', (q) => q.eq('book_id', selectedBookId));
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

      await safeLog('SUCCESS', `Kniha "${selectedBook.title}" byla globálně aktivována všem uživatelům.`); // i18n-ok: záznam v logu je data a zůstává česky
      setSelectedBookId('');
      refreshData();
    } catch (err) {
      alert(friendlyErrorWithDetail(err, t('Chyba při hromadném sdílení.')));
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
            <Shield size={26} className="text-red-500 animate-pulse" /> {t('Administrace')}
          </h1>
          <p className="text-xs font-semibold opacity-70" style={{ color: 'var(--text-muted)' }}>
            {t('Účty, knihy, domovská stránka, prohlídka, licence a systémový log.')}
          </p>
        </div>
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <Button 
            onClick={refreshData} 
            disabled={globalLoading || actionLoading}
            variant="secondary"
            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border rounded-lg hover:opacity-80 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={globalLoading ? "animate-spin" : ""} /> {t('Obnovit data')}
          </Button>
        </div>
      </div>

      {loadProblem && (
        <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-solid px-4 py-3 text-sm font-semibold" style={{ borderColor: '#d97706', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }}>
          <span>{t('Knihy nebo účty se nepodařilo načíst celé (výpadek spojení nebo přetížená databáze). Zobrazená čísla a seznamy mohou být neúplné nebo zastaralé.')}</span>
          <Button onClick={refreshData} disabled={globalLoading || actionLoading} variant="secondary" className="px-4 py-2 text-xs font-black uppercase tracking-wider border rounded-lg cursor-pointer disabled:opacity-50">{t('Zkusit znovu')}</Button>
        </div>
      )}

      {/* STATISTICKÉ UKAZATELE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="flex items-center gap-4 py-4 relative overflow-hidden">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500"><Database size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-60">{t('Knihy')}</h4>
            <p className="text-xl font-black">{books.length} {t.p(books.length, 'kniha', 'knihy', 'knih')}</p>
          </div>
        </Card>
        <Card style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex items-center gap-4 py-4">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500"><Users size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-60">{t('Účty')}</h4>
            <p className="text-xl font-black">{profiles.length} {t.p(profiles.length, 'účet', 'účty', 'účtů')}</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500"><Terminal size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-60">{t('Systémový log')}</h4>
            <p className="text-xl font-black">{logCount} {t.p(logCount, 'záznam', 'záznamy', 'záznamů')}</p>
          </div>
        </Card>
      </div>

      {/* TAB NAVIGACE */}
      <div className="flex border-b font-black text-xs uppercase tracking-wider space-x-1 overflow-x-auto scrollbar-hide" style={{ borderColor: 'var(--border-color)' }}>
        {[
          { id: 'overview', label: t('Přehled'), icon: <LayoutDashboard size={14} /> },
          { id: 'notifications', label: t('Upozornění'), icon: <Bell size={14} />, badge: pendingCount },
          { id: 'accounts', label: t('Účty'), icon: <UserCog size={14} /> },
          { id: 'books', label: t('Knihovna & Editace'), icon: <Database size={14} /> },
          { id: 'shorts', label: t('shortB'), icon: <Feather size={14} /> },
          { id: 'homepage', label: t('Domovská stránka'), icon: <Layout size={14} /> },
          { id: 'tour', label: t('Prohlídka appky'), icon: <Sparkles size={14} /> },
          { id: 'users', label: t('Licence, XP a mince'), icon: <Users size={14} /> },
          { id: 'logs', label: t('Systémový log'), icon: <Terminal size={14} /> }
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
            {tab.badge > 0 && <span data-testid="tab-badge" className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[0.625rem] font-black leading-[18px] text-center">{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* INDIKÁTOR AKČNÍHO LOADINGU */}
      {actionLoading && (
        <div className="w-full bg-yellow-500 text-black text-center text-xs font-black py-1 rounded animate-pulse uppercase tracking-widest">
          {t('Probíhá zápis do databáze Supabase... Počkej prosím.')}
        </div>
      )}

      {activeTab === 'overview' && (
        <OverviewTab
          onOpenAccounts={(preset) => { setAccountsPreset({ ...preset, nonce: Date.now() }); setActiveTab('accounts'); }}
          onOpenBooks={() => setActiveTab('books')}
        />
      )}

      {activeTab === 'notifications' && <div className="mb-6"><PushAdminCard client={supabase} /></div>}
      {activeTab === 'notifications' && (
        <NotificationsTab onCountChange={setPendingCount} currentUserId={adminUser?.id} onChanged={refreshData} onOpenAccount={(u) => { setAccountsPreset({ search: u.email || '', openId: u.id, nonce: Date.now() }); setActiveTab('accounts'); }} />
      )}

      {activeTab === 'accounts' && (
        <AccountsTab
          currentUserId={adminUser?.id}
          preset={accountsPreset}
          onChanged={() => { refreshData(); refreshPending(); }}
          onPresetEmailChanged={(oldEmail, newEmail) => setAccountsPreset(p => (p && oldEmail && sameEmail(p.search, oldEmail) ? { ...p, search: newEmail } : p))}
        />
      )}

      {/* ZÁLOŽKA: SPRÁVA KNIH */}
      {activeTab === 'books' && (
        <div className="space-y-6">
        {books.some(b => !b.authorId && !b.is_auto_assigned) && (
          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-1 flex items-center gap-2 text-red-500">
              <ShieldAlert size={16} /> {t('Knihy bez propojeného účtu')}
            </h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4 opacity-70">
              {t('U těchto knih se nepodařilo jednoznačně dohledat, kterému účtu patří (typicky když víc účtů sdílí stejnou předponu e-mailu) - vlastnická kontrola bez toho nefunguje správně. Vyber ručně správný účet.')}
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
                    <option value="">{t('-- Vyber správný účet --')}</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.email} ({t(ROLE_LABELS[p.role] || p.role)})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleResolveAuthorId(b.id)}
                    disabled={!resolveAuthorSelections[b.id]}
                    style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    className="px-4 py-2 rounded-lg font-black uppercase text-[0.625rem] border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {t('Přiřadit')}
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6">
            <Card>
              <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                {editingBookId ? <ShieldAlert size={16} className="text-yellow-500"/> : <Plus size={16}/>}
                {editingBookId ? t('Upravit digitální titul') : t('Registrovat nový digitální titul')}
              </h3>
              <form onSubmit={saveBook} className="space-y-3">
                <input 
                  type="text" 
                  placeholder={t('Přesný název knihy...')} 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none placeholder:opacity-40" 
                  required 
                />
                <input 
                  type="text" 
                  placeholder={t('Autor / Vydavatel...')} 
                  value={author} 
                  onChange={e => setAuthor(e.target.value)} 
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none placeholder:opacity-40" 
                />
                
                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Umělá Prestiž (Počet Fake Lajků)')}</label>
                  <input 
                    type="number" 
                    placeholder={t('Počet lajků...')} 
                    value={fakeLikes} 
                    onChange={e => setFakeLikes(Math.max(0, parseInt(e.target.value) || 0))} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70 flex items-center gap-1"><Coins size={11} /> {t('Cena licence (Jomarid Coins)')}</label>
                  <input 
                    type="number" 
                    placeholder={t('Cena v mincích...')} 
                    value={priceCoins} 
                    onChange={e => setPriceCoins(Math.max(0, parseInt(e.target.value) || 0))} 
                    disabled={isAutoAssigned}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none disabled:opacity-40" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Žánry (oddělené čárkou)')}</label>
                  <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-medium pl-1 m-0 opacity-70">{t('Nejvýš {genres}, každý nejvýš {chars}. Co je navíc, se při uložení zahodí.', { genres: t.p(GENRES_PER_BOOK, '{n} žánr', '{n} žánry', '{n} žánrů', { n: GENRES_PER_BOOK }), chars: t.p(GENRE_MAX_LENGTH, '{n} znak', '{n} znaky', '{n} znaků', { n: GENRE_MAX_LENGTH }) })}</p>
                  <input 
                    type="text" 
                    placeholder={t('např. Sci-Fi, Dobrodružství')} 
                    value={genresInput} 
                    onChange={e => setGenresInput(e.target.value)} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Popis (pro nákupní/detailní obrazovku)')}</label>
                  <textarea
                    placeholder={t('Krátký popis, co čtenáře čeká - zobrazí se v detailu knihy před koupí...')}
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
                  <label htmlFor="is_auto_assigned" className="text-[0.625rem] font-black uppercase tracking-wide cursor-pointer select-none flex items-center gap-1.5">
                    <Sparkles size={12} className="text-yellow-500 fill-current" /> {t('Automatická kniha (Přiřadit všem zdarma)')}
                  </label>
                </div>

                <BookTextField
                  key={editingBookId || 'nova-kniha'} id="admin-book-text" value={content} onChange={setContent} required labelStyle={{ color: 'var(--text-muted)' }}
                  placeholder={t('Sem vlož čistý text knihy, kapitoly nebo markdown, nebo přetáhni soubor .txt / .md...')}
                />
                
                <Button type="submit" disabled={actionLoading} className="w-full py-3 uppercase tracking-wider font-black">
                  {editingBookId ? t('💾 Aktualizovat data v DB') : t('🚀 Vydat knihu do oběhu')}
                </Button>

                {editingBookId && (
                  <button 
                    type="button" 
                    onClick={() => { setEditingBookId(null); setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(DEFAULT_BOOK_PRICE); setGenresInput(''); }}
                    style={{ color: 'var(--text-muted)' }}
                    className="w-full py-2 text-xs hover:underline uppercase cursor-pointer bg-transparent border-none font-bold tracking-wide"
                  >
                    {t('Stornovat úpravy')}
                  </button>
                )}
              </form>
            </Card>
          </div>

          <div className="lg:col-span-6 space-y-4">
            <div className="flex gap-2 items-center p-2 rounded-xl border border-solid" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <Search size={16} className="opacity-60 ml-2 shadow-sm shrink-0" />
              <input 
                type="text"
                placeholder={t('Filtrovat knihy podle názvu či autora...')}
                value={searchBook}
                onChange={e => setSearchBook(e.target.value)}
                className="w-full bg-transparent border-none outline-none font-bold text-xs p-1"
              />
              {searchBook && <button onClick={() => setSearchBook('')} className="text-xs px-2 opacity-50 hover:opacity-100 font-bold">X</button>}
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b font-black text-xs uppercase tracking-wider flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
                <span>{t('Inventář titulů (Katalog aplikací)')}</span>
                <span className="opacity-60">{t('{n} nalezeno', { n: filteredBooks.length })}</span>
              </div>
              <div className="p-2 max-h-[500px] overflow-y-auto space-y-1.5">
                {filteredBooks.length === 0 ? (
                  <p className="text-xs font-bold text-center py-8 italic opacity-50">{t('Žádné knihy neodpovídají vyhledávacímu dotazu.')}</p>
                ) : (
                  pagedBooks.items.map(b => (
                    <div key={b.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex justify-between items-center p-3 rounded-xl text-xs font-bold gap-4 hover:opacity-95 transition-opacity">
                      <span className="truncate flex-1">
                        <span className="text-sm font-black block truncate flex items-center gap-1.5">
                          {b.title}
                          {b.isHidden && (
                            <span data-testid="hidden-badge" className="bg-slate-500/20 text-slate-500 font-black px-1.5 py-0.5 rounded text-[0.5625rem] uppercase tracking-wide flex items-center gap-0.5">
                              <EyeOff size={10} /> {t('Skrytá')}
                            </span>
                          )}
                          {b.is_auto_assigned && (
                            <span className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-black px-1.5 py-0.5 rounded text-[0.5625rem] uppercase tracking-wide flex items-center gap-0.5">
                              <Sparkles size={10} className="fill-current" /> {t('Auto')}
                            </span>
                          )}
                          {!b.is_auto_assigned && (
                            <span className="bg-amber-500/20 text-amber-500 font-black px-1.5 py-0.5 rounded text-[0.5625rem] uppercase tracking-wide flex items-center gap-0.5">
                              <Coins size={10} /> {b.price_coins ?? DEFAULT_BOOK_PRICE}
                            </span>
                          )}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }} className="opacity-70 font-medium">{t('Autor: {name}', { name: b.authorDisplay })}</span>
                      </span>
                      
                      <div style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--bg-secondary)' }} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.625rem] shrink-0 font-black shadow-sm">
                        <Heart size={10} className="fill-current" />
                        <span>{b.likesCount}</span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button 
                          onClick={() => startEditBook(b)}
                          style={{ color: 'var(--bg-primary)' }}
                          className="bg-transparent border-none cursor-pointer hover:scale-110 transition-transform font-bold text-base"
                          title={t('Editovat parametry a text')}
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => toggleBookHidden(b)}
                          disabled={actionLoading}
                          aria-label={b.isHidden ? t('Zveřejnit knihu {title}', { title: b.title }) : t('Skrýt knihu {title}', { title: b.title })}
                          aria-pressed={b.isHidden}
                          style={{ color: b.isHidden ? 'var(--bg-primary)' : 'var(--text-muted)' }}
                          className="bg-transparent border-none cursor-pointer hover:scale-110 transition-transform flex items-center disabled:opacity-40"
                          title={b.isHidden ? t('Skrytá - klikni pro zveřejnění') : t('Skrýt před čtenáři')}
                        >
                          {b.isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                        <button 
                          onClick={async () => { 
                            if(confirm(t('Smazat knihu "{title}" natvrdo z DB? Tato akce smaže i existující uživatelské licence!', { title: b.title }))) { 
                              const { error: delErr } = await supabase.from('books').delete().eq('id', b.id);
                              if (delErr) { alert(friendlyErrorWithDetail(delErr, t('Smazání se nepovedlo.'))); return; }
                              await removeBookText(supabase, b.id);
                              await safeLog('DANGER', `Smazána kniha z databáze: ${b.title}`); // i18n-ok: záznam v logu je data a zůstává česky
                              refreshData(); 
                            } 
                          }} 
                          style={{ color: 'var(--text-muted)' }}
                          className="bg-transparent border-none cursor-pointer hover:text-red-500 hover:scale-110 transition-all flex items-center"
                          title={t('Smazat titul z DB')}
                        >
                          <Trash size={14}/>
                        </button>
                      </div>
                    </div>
                  ))
                )}
                <LoadMore paged={pagedBooks} className="py-2" />
              </div>
            </Card>
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b font-black text-xs uppercase tracking-wider flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
            <span>{t('Moderace komentářů (posledních 50 napříč knihami)')}</span>
            <span className="opacity-60">{t('{n} nalezeno', { n: comments.length })}</span>
          </div>
          <div className="p-2 max-h-80 overflow-y-auto space-y-1.5">
            {comments.length === 0 ? (
              <p className="text-xs font-bold text-center py-8 italic opacity-50">{t('Zatím žádné komentáře.')}</p>
            ) : (
              comments.map(cm => (
                <div key={cm.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex justify-between items-center p-3 rounded-xl text-xs font-bold gap-4">
                  <span className="truncate flex-1">
                    <span style={{ color: 'var(--bg-primary)' }} className="font-black block truncate">{cm.author_name} <span style={{ color: 'var(--text-muted)' }} className="font-medium opacity-70">{t('na {title}', { title: cm.bookTitle })}</span></span>
                    <span style={{ color: 'var(--text-body)' }} className="opacity-90 font-medium">{cm.content}</span>
                  </span>
                  <button
                    onClick={() => handleDeleteComment(cm.id, cm.content)}
                    style={{ color: 'var(--text-muted)' }}
                    className="bg-transparent border-none cursor-pointer hover:text-red-500 hover:scale-110 transition-all flex items-center shrink-0"
                    title={t('Smazat komentář')}
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

      {/* ZÁLOŽKA: DOMOVSKÁ STRÁNKA */}
      {activeTab === 'homepage' && (
        <div className="space-y-6">
          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Layout size={16} /> {t('Hlavní nadpis a podtext')}
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Nadpis (hero)')}</label>
                <input
                  type="text"
                  value={hpHeadline}
                  onChange={e => setHpHeadline(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Podtext')}</label>
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
              <Sparkles size={16} /> {t('Doporučené tituly na domovské stránce')}
            </h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4 opacity-70">
              {t('Zaškrtni, které knihy se mají zobrazit v sekci "Hlavní tituly". Nezáleží na pořadí zaškrtnutí.')}
            </p>
            <div style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl divide-y max-h-64 overflow-y-auto">
              {books.length === 0 ? (
                <p className="text-xs font-bold text-center py-6 opacity-50">{t('Zatím žádné knihy v katalogu.')}</p>
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
                    <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] opacity-60 shrink-0 ml-auto">{b.authorDisplay}</span>
                  </label>
                ))
              )}
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] mt-2 opacity-60">{t('{n} vybráno', { n: hpFeaturedBookIds.length })}</p>
          </Card>

          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Award size={16} /> {t('Ukázka pro demo velikosti písma')}
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Ukázkový text')}</label>
                <textarea
                  value={hpFontQuote}
                  onChange={e => setHpFontQuote(e.target.value)}
                  rows={3}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block pl-1 opacity-70">{t('Odkud je ukázka (zobrazí se pod textem)')}</label>
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
              <ShieldAlert size={16} /> {t('Proč číst tady (4 důvody)')}
            </h3>
            <div className="space-y-4">
              {hpWhyRead.map((item, idx) => (
                <div key={idx} style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 space-y-2">
                  <input
                    type="text"
                    placeholder={t('Důvod {n} - titulek', { n: idx + 1 })}
                    value={item.title}
                    onChange={e => updateWhyReadItem(idx, 'title', e.target.value)}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-2.5 border rounded-lg text-xs font-bold outline-none"
                  />
                  <textarea
                    placeholder={t('Popis')}
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
            {savingHomepage ? t('Ukládám...') : t('Uložit domovskou stránku')}
          </button>
        </div>
      )}

      {/* ZÁLOŽKA: PROHLÍDKA APPKY */}
      {activeTab === 'tour' && <TourEditor />}

      {/* ZÁLOŽKA: LICENCE, XP A MINCE */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex gap-2 items-center p-2 rounded-xl border border-solid" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <Search size={16} className="opacity-60 ml-2 shrink-0" />
                <input 
                  type="text"
                  placeholder={t('Hledat uživatele podle e-mailu...')}
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
                  <option value="all">{t('Všechny role')}</option>
                  <option value={ROLE_READER}>{t('Čtenáři')}</option>
                  <option value={ROLE_PUBLISHER}>{t('Nakladatelé')}</option>
                  <option value={ROLE_ADMIN}>{t('Správci')}</option>
                </select>
              </div>
            </div>

            <Card className="overflow-hidden p-0">
              <div style={{ borderColor: 'var(--border-color)' }} className="p-4 border-b font-black text-xs uppercase tracking-wider">
                {t('Účty a jejich role')}
              </div>
              <div className="max-h-[450px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }} className="font-black uppercase border-b opacity-80 sticky top-0 z-10">
                      <th className="p-3">{t('Uživatel')}</th>
                      <th className="p-3">{t('Role')}</th>
                      <th className="p-3 text-right">{t('Řízení')}</th>
                    </tr>
                  </thead>
                  <tbody style={{ borderColor: 'var(--border-color)' }} className="divide-y">
                    {filteredProfiles.map(p => (
                      <tr key={p.id} style={{ borderColor: 'var(--border-color)' }} className={`hover:bg-[var(--bg-secondary)] transition-colors font-bold ${activeUser?.id === p.id ? "bg-[var(--bg-secondary)] ring-1 ring-inset ring-blue-500/30" : ""}`}>
                        <td className="p-3 truncate max-w-[200px]">
                          <div className="truncate text-sm font-black">{p.email}</div>
                          {p.fake_xp > 0 && (
                            <div className="text-[0.625rem] font-black flex items-center gap-1 mt-0.5" style={{ color: 'var(--bg-primary)' }}>
                              <Award size={10}/> {t('+{n} Admin XP', { n: p.fake_xp })}
                            </div>
                          )}
                        </td>
                        <td className="p-3 align-middle">
                          <span 
                            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} 
                            className={`text-[0.5625rem] px-2.5 py-0.5 rounded-full uppercase border border-solid font-black shadow-sm tracking-wider`}
                          >
                            {t(ROLE_LABELS[p.role || ROLE_READER] || p.role)}
                          </span>
                        </td>
                        <td className="p-3 text-right flex justify-end items-center gap-2">
                          <Button 
                            variant={activeUser?.id === p.id ? "success" : "secondary"} 
                            onClick={() => { setActiveUser(p); setUserFakeXpInput(p.fake_xp || 0); }} 
                            className="text-[0.625rem] px-2.5 py-1 uppercase flex items-center gap-1 font-black"
                          >
                            <Plus size={10}/> {t('Vybrat')}
                          </Button>
                          <Button 
                            variant="secondary"
                            onClick={() => toggleRole(p.id, p.role || ROLE_READER)} disabled={p.id === adminUser?.id} 
                            className="p-1.5 border border-solid rounded-lg cursor-pointer" 
                            title={p.id === adminUser?.id ? t('Vlastní roli nejde změnit') : t('Změnit roli (Čtenář → Nakladatel → Správce → Čtenář)')}
                          >
                            <Shield size={13}/>
                          </Button>
                          <Button 
                            variant="secondary"
                            onClick={() => revokeAllLicenses(p.id, p.email)} 
                            className="p-1.5 text-red-400 border border-solid border-red-500/20 rounded-lg hover:bg-red-500/10 cursor-pointer" 
                            title={t('Kompletní revokace (Smazat všechny licence uživatele)')}
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
                <UserCheck size={18}/> {t('Správce distribuce a oprávnění')}
              </h3>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[0.625rem] font-black uppercase tracking-wider block opacity-70">{t('Vyber knihu z registru')}</label>
                  
                  {/* Vyhledávací a filtrovací pole pro rychlé prohledávání registru knih */}
                  <div className="flex gap-2 items-center p-2 mb-1.5 rounded-lg border border-solid bg-[var(--bg-primary)]" style={{ borderColor: 'var(--border-color)' }}>
                    <Search size={14} className="opacity-50 ml-1 shrink-0" />
                    <input 
                      type="text"
                      placeholder={t('Rychlý filtr knih (název / autor)...')}
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
                      {t('-- Knih podle filtru: {n} --', { n: filteredBooks.length })}
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
                      <span className="text-[0.625rem] font-black uppercase tracking-wider block flex items-center gap-1">
                        <Sparkles size={11} className="text-yellow-500 fill-current"/> {t('Auto-Assign globální příznak')}
                      </span>
                      <span className="text-[0.5625rem] opacity-50 block font-bold">{t('Přidělí se automaticky každému čtenáři')}</span>
                    </div>
                    <Button
                      variant={currentSelectedBook.is_auto_assigned ? "success" : "secondary"}
                      onClick={() => toggleBookAutoAssign(currentSelectedBook.id, currentSelectedBook.is_auto_assigned)}
                      disabled={actionLoading}
                      className="text-[0.625rem] px-3 py-1.5 font-black uppercase tracking-wider shrink-0"
                    >
                      {currentSelectedBook.is_auto_assigned ? t('✨ Aktivní') : t('Vypnuto')}
                    </Button>
                  </div>
                )}

                <Button 
                  onClick={assignSelectedBookToAllUsers}
                  variant="purple"
                  disabled={actionLoading || !selectedBookId}
                  className="w-full text-xs py-2.5 uppercase tracking-wider font-black shadow-md flex items-center justify-center gap-1"
                >
                  {t('📢 Globální odemčení této knihy VŠEM čtenářům')}
                </Button>
                
                {activeUser ? (
                  <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-4 border-t border-solid space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                      <p className="text-xs font-bold text-blue-400 truncate m-0">{t('Target:')} <span className="font-black text-sm">{activeUser.email}</span></p>
                    </div>
                    
                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-80 block">
                        {t('Modifikátor bonusových XP (Úroveň Profilu)')}
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={userFakeXpInput} 
                          onChange={e => setUserFakeXpInput(parseInt(e.target.value) || 0)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="w-full p-2 border rounded-lg text-xs font-bold outline-none font-mono" 
                          placeholder={t('Množství XP...')}
                        />
                        <button 
                          onClick={handleSaveFakeXp}
                          disabled={actionLoading}
                          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 font-black text-[0.625rem] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity shrink-0 active:scale-95 duration-100"
                        >
                          {t('Uložit XP')}
                        </button>
                      </div>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-80 flex items-center gap-1">
                        <Coins size={11} /> {t('Připsat / odečíst Jomarid Coins (funguje i na tvůj vlastní účet)')}
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={coinGrantInput} 
                          onChange={e => setCoinGrantInput(e.target.value)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="w-24 p-2 border rounded-lg text-xs font-bold outline-none font-mono" 
                          placeholder={t('±počet')}
                        />
                        <input 
                          type="text" 
                          value={coinGrantReason} 
                          onChange={e => setCoinGrantReason(e.target.value)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="flex-1 p-2 border rounded-lg text-xs font-bold outline-none" 
                          placeholder={t('Důvod (volitelné)...')}
                        />
                        <button 
                          onClick={handleGrantCoins}
                          disabled={actionLoading || !coinGrantInput}
                          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 font-black text-[0.625rem] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity shrink-0 active:scale-95 duration-100 disabled:opacity-40"
                        >
                          {t('Připsat')}
                        </button>
                      </div>
                      <span className="text-[0.5625rem] opacity-40 font-bold block">{t('* Zůstatek {n} 🪙. Záporné číslo strhne mince (nejníž na 0), loguje se to do coin_transactions.', { n: activeUser.coins ?? 0 })}</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider opacity-80 flex items-center gap-1">
                        <Award size={11} /> {t('Herní postup (jen pro přehled)')}
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-[0.6875rem] font-bold">
                        <span style={{ color: 'var(--text-muted)' }}>{t('Odznaky:')} <span style={{ color: 'var(--text-body)' }}>{(activeUser.unlocked_badges || []).length} / {BOOK_BADGES.length}</span></span>
                        <span style={{ color: 'var(--text-muted)' }}>{t('Nejvyšší splněný cíl:')} <span style={{ color: 'var(--text-body)' }}>{activeUser.highest_goal_completed ?? DEFAULT_MONTHLY_GOAL}</span></span>
                        <span style={{ color: 'var(--text-muted)' }} className="col-span-2">{t('Vystavený odznak:')} <span style={{ color: 'var(--text-body)' }}>{activeUser.featured_badge || '—'}</span></span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[0.6875rem] font-bold" style={{ color: 'var(--text-muted)' }}>{t('Streak Freeze:')} <span style={{ color: 'var(--text-body)' }}>{activeUser.streak_freezes ?? 0}</span></span>
                        <button
                          onClick={handleGrantStreakFreeze}
                          disabled={actionLoading}
                          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 py-1.5 font-black text-[0.625rem] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity active:scale-95 duration-100 disabled:opacity-40"
                        >
                          {t('+1 Freeze')}
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
                        {t('Aktivovat zvolenou knihu')}
                      </button>
                      <Button variant="secondary" onClick={() => setActiveUser(null)} className="text-xs py-2.5 font-bold">{t('Zrušit výběr')}</Button>
                    </div>
                    
                    <Button 
                      onClick={assignAllBooksToUser}
                      disabled={actionLoading}
                      variant="success"
                      className="w-full text-xs py-2.5 uppercase tracking-wider font-black shadow-sm"
                    >
                      {t('✨ Full Unlock: Aktivovat mu VŠECHNY knihy z databáze')}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs font-bold opacity-50 italic border border-dashed rounded-xl p-4" style={{ borderColor: 'var(--border-color)' }}>
                    {t('Pro individuální přidělení licencí nebo zápis XP vyber uživatele v tabulce vedle.')}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ZÁLOŽKA: SYSTÉMOVÝ LOG */}
      {activeTab === 'logs' && <LogsTab />}
      {activeTab === 'shorts' && <ShortsStudio all />}

      <TypedConfirm
        open={bulkGrantOpen}
        title={t('Rozdat knihu všem')}
        description={t('Kniha "{title}" se okamžitě odemkne ZDARMA všem načteným účtům ({n}). Její cena tím pro ně přestane platit a zpět to nejde vzít.', { title: books.find(b => b.id === selectedBookId)?.title || '', n: profiles.length })}
        expected={books.find(b => b.id === selectedBookId)?.title || ''}
        confirmLabel={t('Rozdat všem')}
        onConfirm={runBulkGrant}
        onCancel={() => setBulkGrantOpen(false)}
      />
    </div>
  );
};


