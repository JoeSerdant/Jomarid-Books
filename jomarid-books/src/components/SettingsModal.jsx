import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Smartphone, Share, ArrowLeft, User, ShieldCheck, Palette, Database, Check, Loader2, Download, BookOpen, RotateCcw, Bell, EyeOff, MessageCircle, UserCog, Gift, X, ClipboardCheck, AlertTriangle, Info, RefreshCw, Compass, Play, Mail, MailX, UserPlus } from 'lucide-react';
import { useAuth, useTheme } from '../contexts/AuthContext';
import { supabase, verifyPassword, validateNewPassword, mapAuthError } from '../lib/supabase';
import { friendlyError } from '../lib/friendlyError';
import { BOOK_BADGES } from '../constants/badges';
import { ROLE_PUBLISHER, ROLE_ADMIN, ROLE_LABELS } from '../constants/roles';
import { USERNAME_RE, USERNAME_MIN, USERNAME_MAX } from '../lib/username';
import { loadAccountNotices, countWarnings, LEVEL_WARN } from '../accountNotices';
import { isValidEmail, sameEmail, normalizeEmail, explainEmailError, REQUEST_ERRORS, EMAIL_CHANGED_KIND, EMAIL_REJECTED_KIND } from '../emailChange';
import { useTour } from '../tour/TourProvider';
import { activeSteps } from '../tour/tourModel';
import { readSeenVersion } from '../tour/tourSeen';
import {
  THEMES, FONT_FAMILIES, LINE_HEIGHTS, TEXT_WIDTHS, ALIGNMENTS, LETTER_SPACINGS, PAGE_MARGINS, PAGE_BREAKS, PAGE_ANIMATIONS, MOTION_OPTIONS,
  FONT_SIZE_RANGE, AUTO_ADVANCE_RANGE, WPM_RANGE, NIGHT_RANGE,
  loadReaderPrefs, saveReaderPref, resetReaderPrefs, readerTypography, loadMotionPref, saveMotionPref,
  CUSTOM_THEME_KEY, EXPERIMENTAL_THEME_KEY, usesCustomColors, CUSTOM_PRESETS, ACCENT_MIN_CONTRAST, resolveTheme, deriveTheme, completeHex, normalizeHex, readableAccent, customColorsPreview, contrast,
  ACCENTS, THEME_LABELS, UI_SCALES, UI_DENSITIES, loadUiScale, loadUiDensity, saveUiScale, saveUiDensity, withAccent,
  READER_PREFS_EVENT,
} from '../theme';
import { readLibraryPrefs, writeLibraryPref } from '../browse/browseStore';
import { SORT_OPTIONS, STATUS_FILTERS } from '../browse/libraryModel';
import { useSyncStatus } from '../settings/settingsSyncStore';
import { SETTINGS_TABLE, isMissingTable } from '../settings/settingsSync';
import { APP_VERSION_LABEL } from '../appInfo';
import PushSettings from '../push/PushSettings';
import { cleanupOnLogout } from '../push/pushClient';
import { createLoginCode, getLoginCodeInfo, revokeLoginCode } from '../offline/loginCode';
import { OfflineBooksSection } from '../offline/OfflineBooksSection';
import { OfflineGamesSection } from '../offline/OfflineGamesSection';
import { useInstallState, promptInstall } from '../pwa/install';
import { whenOfflineReady, resetApp } from '../pwa/register';
import { t, tx, formatDate, formatDateTime } from '../i18n';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { tk } from '../i18n/mark.js';
import { useAccounts } from '../accounts/useAccounts.js';
import { useAccountActions } from '../accounts/useAccountActions.js';
import { AccountList } from '../accounts/AccountList.jsx';
import { AddAccountDialog } from '../accounts/AddAccountDialog.jsx';

// ---- Sdílené stavební prvky nastavení ----
const Section = ({ title, description, danger = false, children }) => (
  <section style={{ borderColor: danger ? 'rgba(239,68,68,0.4)' : 'var(--border-color)' }} className="border rounded-xl p-4 sm:p-5 space-y-3">
    <div>
      <h4 className={`text-xs font-black uppercase tracking-wider m-0 ${danger ? 'text-red-500' : ''}`}>{title}</h4>
      {description && <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 mb-0 opacity-80 leading-relaxed">{description}</p>}
    </div>
    {children}
  </section>
);

const Field = ({ label, children }) => (
  <label className="block">
    <span style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider block mb-1 opacity-80">{label}</span>
    {children}
  </label>
);

const TextInput = ({ style, ...props }) => (
  <input
    {...props}
    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)', ...style }}
    className="w-full p-2.5 border rounded-lg text-sm font-semibold outline-none disabled:opacity-60"
  />
);

const NOTICE_STYLES = {
  error:   { backgroundColor: 'rgba(239,68,68,0.12)', color: '#ef4444' },
  success: { backgroundColor: 'rgba(16,185,129,0.14)', color: '#10b981' },
  info:    { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' },
};
const Notice = ({ type = 'info', children }) => (
  <p role={type === 'error' ? 'alert' : 'status'} style={NOTICE_STYLES[type]} className="text-xs font-bold rounded-lg px-3 py-2 m-0 leading-relaxed">{children}</p>
);

const ActionButton = ({ variant = 'primary', busy = false, disabled, children, ...props }) => {
  const style = variant === 'danger'
    ? { backgroundColor: '#dc2626', color: '#fff' }
    : variant === 'ghost'
      ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)' }
      : { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };
  return (
    <button
      {...props}
      disabled={disabled || busy}
      style={style}
      className="px-4 py-2.5 min-h-[2.5rem] rounded-lg border-none font-black uppercase text-[0.6875rem] tracking-wider cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busy && <Loader2 size={13} className="animate-spin" />}
      {children}
    </button>
  );
};

const Toggle = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    style={{ backgroundColor: checked ? 'var(--bg-primary)' : 'var(--border-color)' }}
    className="relative w-11 h-6 rounded-full border-none cursor-pointer shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <span style={{ transform: checked ? 'translateX(20px)' : 'translateX(2px)' }} className="absolute top-0.5 left-0 w-5 h-5 rounded-full bg-white shadow transition-transform" />
  </button>
);

// Účty na tomto zařízení (přepínač účtů): přepnutí bez odhlášení, přidání dalšího účtu, odebrání z tohoto zařízení.
const AccountsSection = () => {
  const { active, accounts } = useAccounts();
  const { busy, error, doSwitch, doRemove, logoutAll } = useAccountActions();
  const [adding, setAdding] = useState(false);
  return (
    <Section title={t('Účty na tomto zařízení')} description={t('Na jednom zařízení můžeš mít přihlášených víc účtů a přepínat mezi nimi bez odhlášení. Účty zůstávají přihlášené, dokud je odtud neodebereš nebo se neodhlásíš. Oznámení do zařízení chodí vždy jen aktivnímu účtu.')}>
      <AccountList accounts={accounts} active={active} busy={busy} onSwitch={doSwitch} onRemove={doRemove} />
      {error && <Notice type="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => setAdding(true)} data-testid="settings-add-account"><UserPlus size={13} /> {t('Přidat účet')}</ActionButton>
        {accounts.length > 1 && <ActionButton variant="ghost" onClick={logoutAll}>{t('Odhlásit ze všech účtů')}</ActionButton>}
      </div>
      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
    </Section>
  );
};

// ---- Záložka: Profil ----
const USERNAME_PARAMS = { min: USERNAME_MIN, max: USERNAME_MAX };
const USERNAME_ERRORS = {
  username_invalid: tk('Jméno musí mít {min}-{max} znaků: písmena a-z bez diakritiky, číslice, tečka, podtržítko nebo pomlčka (na začátku a na konci jen písmeno nebo číslice).'),
  username_reserved: tk('Tohle jméno je rezervované. Zvol jiné.'),
  username_taken: tk('Tohle jméno už někdo používá.'),
};
const USERNAME_HINTS = {
  same: tk('Tohle je tvoje současné jméno.'),
  checking: tk('Zjišťuju, jestli je volné...'),
  available: tk('Jméno je volné.'),
  taken: USERNAME_ERRORS.username_taken,
  reserved: USERNAME_ERRORS.username_reserved,
  invalid: tk('Zatím neplatné: {min}-{max} znaků, a-z bez diakritiky, číslice, tečka, podtržítko, pomlčka.'),
  error: tk('Dostupnost se nepodařilo zjistit. Zkus to za chvíli.'),
};

// Uživatelské jméno: unikátní, vidí ho ostatní (např. v žebříčku). Měnit jde jednou za 7 dní.
const UsernameSection = ({ profile, onSaved }) => {
  const current = profile.username || '';
  const [value, setValue] = useState(current);
  const [check, setCheck] = useState('same');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const trimmed = value.trim();

  useEffect(() => {
    if (trimmed === current) { setCheck('same'); return undefined; }
    if (!USERNAME_RE.test(trimmed)) { setCheck(trimmed ? 'invalid' : 'same'); return undefined; }
    setCheck('checking');
    let alive = true;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { p_username: trimmed });
      if (!alive) return;
      setCheck(error ? 'error' : data?.available ? 'available' : (data?.problem || 'taken'));
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [trimmed, current]);

  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    const { data, error } = await supabase.rpc('set_username', { p_username: trimmed });
    setBusy(false);
    if (error) {
      const m = String(error.message || '');
      if (m.includes('username_cooldown')) {
        const when = error.hint ? formatDate(error.hint) : null;
        return setMsg({ type: 'error', text: t('Jméno jde měnit jednou za 7 dní.') + (when ? ` ${t('Znovu to půjde {when}.', { when })}` : '') });
      }
      const code = Object.keys(USERNAME_ERRORS).find(k => m.includes(k));
      return setMsg({ type: 'error', text: code ? t(USERNAME_ERRORS[code], USERNAME_PARAMS) : t('Uložení se nepovedlo. Zkus to znovu.') });
    }
    onSaved(data?.username || trimmed);
    setValue(data?.username || trimmed);
    setMsg({ type: 'success', text: t('Jméno je uložené. Další změnu půjde udělat za 7 dní.') });
  };

  if (!('username' in profile)) {
    return (
      <Section title={t('Uživatelské jméno')} description={t('Takhle tě vidí ostatní čtenáři.')}>
        <Notice type="info">{t('Uživatelské jméno teď nejde nastavit. Zkus to později.')}</Notice>
      </Section>
    );
  }

  const tone = check === 'available' ? '#10b981' : (check === 'same' || check === 'checking') ? 'var(--text-muted)' : '#ef4444';
  return (
    <Section title={t('Uživatelské jméno')} description={t('Takhle tě vidí ostatní - například v žebříčku. Ukáže se i u tvých knih, pokud nemáš krycí jméno.')}>
      <form onSubmit={save} className="space-y-3">
        <Field label={t('Jméno ({min}-{max} znaků)', USERNAME_PARAMS)}>
          <TextInput value={value} onChange={e => setValue(e.target.value)} maxLength={USERNAME_MAX} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="username-hint" />
        </Field>
        <p id="username-hint" aria-live="polite" style={{ color: tone }} className="text-xs font-bold m-0 min-h-[16px]">{t(USERNAME_HINTS[check], USERNAME_PARAMS)}</p>
        {msg && <Notice type={msg.type}>{msg.text}</Notice>}
        <ActionButton type="submit" busy={busy} disabled={check !== 'available'}>{t('Uložit jméno')}</ActionButton>
      </form>
    </Section>
  );
};

// Krycí jméno nakladatele: u jeho knih se čtenářům ukáže místo uživatelského jména.
const PenNameSection = ({ profile, onSaved }) => {
  const [value, setValue] = useState(profile.pen_name || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const saved = profile.pen_name || '';

  const save = async (pen) => {
    setMsg(null);
    setBusy(true);
    const { data, error } = await supabase.rpc('set_pen_name', { new_pen_name: pen });
    setBusy(false);
    if (error) return setMsg({ type: 'error', text: friendlyError(error, t('Uložení se nepovedlo. Zkus to znovu.')) });
    onSaved(data?.pen_name || null);
    setValue(data?.pen_name || '');
    setMsg({ type: 'success', text: pen ? t('Krycí jméno je uložené a promítlo se do všech tvých knih.') : t('Krycí jméno je zrušené, u knih se ukazuje tvoje uživatelské jméno.') });
  };

  return (
    <Section title={t('Krycí jméno (nakladatel)')} description={t('U tvých knih se čtenářům ukáže místo uživatelského jména. Změna se rovnou promítne na všechny vydané knihy.')}>
      <form onSubmit={(e) => { e.preventDefault(); save(value); }} className="space-y-3">
        <Field label={t('Krycí jméno (2-50 znaků)')}>
          <TextInput value={value} onChange={e => setValue(e.target.value)} maxLength={50} placeholder={profile.username || ''} />
        </Field>
        {msg && <Notice type={msg.type}>{msg.text}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton type="submit" busy={busy} disabled={value.trim() === saved}>{t('Uložit krycí jméno')}</ActionButton>
          {saved && <button type="button" onClick={() => save(null)} disabled={busy} style={{ color: 'var(--text-muted)' }} className="text-xs font-bold underline bg-transparent border-none cursor-pointer p-0 disabled:opacity-50">{t('Zrušit krycí jméno')}</button>}
        </div>
      </form>
    </Section>
  );
};

const ProfileTab = ({ user, role }) => {
  const { refreshProfile } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setLoadError(t('Profil se nepodařilo načíst.'));
      else setProfile(data || { missing: true });
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const save = async (patch, label) => {
    setSaveError('');
    setSaved('');
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (error) { setSaveError(t('Uložení se nepovedlo. Zkus to znovu.')); return; }
    setProfile(p => ({ ...p, ...patch }));
    setSaved(label);
    setTimeout(() => setSaved(''), 2200);
  };

  if (loadError) return <Notice type="error">{loadError}</Notice>;
  if (!profile) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>;

  const unlockedIds = (profile.unlocked_badges || []).map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
  const unlocked = unlockedIds.map(id => BOOK_BADGES.find(b => b.id === id)).filter(Boolean);
  const inLeaderboard = profile.show_in_leaderboard ?? true;
  const memberSince = user.created_at ? formatDate(user.created_at) : '-';
  const canEdit = !profile.missing;

  return (
    <div className="space-y-4">
      <Section title={t('Účet')} description={t('Údaje o tvém účtu. Změnu e-mailu ti na žádost udělá správce (záložka Zabezpečení).')}>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm m-0">
          <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">{t('E-mail')}</dt>
          <dd className="m-0 font-semibold break-all">{user.email}</dd>
          <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">{t('Role')}</dt>
          <dd className="m-0 font-semibold">{t(ROLE_LABELS[role] || 'Čtenář')}</dd>
          <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">{t('Člen od')}</dt>
          <dd className="m-0 font-semibold">{memberSince}</dd>
        </dl>
        {profile.missing && <Notice type="info">{t('Profil se ti založí při příštím přihlášení - do té doby jdou nastavit jen údaje výše.')}</Notice>}
      </Section>

      <AccountsSection />

      {canEdit && <UsernameSection profile={profile} onSaved={(name) => { setProfile(p => ({ ...p, username: name })); refreshProfile?.(); }} />}
      {canEdit && (role === ROLE_PUBLISHER || role === ROLE_ADMIN) && <PenNameSection profile={profile} onSaved={(pen) => setProfile(p => ({ ...p, pen_name: pen }))} />}

      <Section title={t('Veřejná viditelnost')} description={t('Co o tobě uvidí ostatní čtenáři.')}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold m-0">{t('Zobrazovat mě v žebříčku')}</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-0.5 opacity-80">{t('Když vypneš, ve veřejném žebříčku nebudeš vidět.')}</p>
          </div>
          <Toggle checked={inLeaderboard} disabled={!canEdit} label={t('Zobrazovat v žebříčku')} onChange={(v) => save({ show_in_leaderboard: v }, t('Viditelnost v žebříčku uložena'))} />
        </div>

        <div>
          <p className="text-sm font-bold m-0 mb-1.5">{t('Vystavený odznak')}</p>
          <select
            value={profile.featured_badge || ''}
            disabled={!canEdit || unlocked.length === 0}
            onChange={(e) => save({ featured_badge: e.target.value || null }, t('Odznak uložen'))}
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
            className="w-full p-2.5 border rounded-lg text-sm font-semibold outline-none cursor-pointer disabled:opacity-60"
          >
            <option value="">{unlocked.length === 0 ? t('Zatím nemáš žádný odemčený odznak') : t('- žádný -')}</option>
            {unlocked.map(b => <option key={b.id} value={b.id}>{t(b.title)}</option>)}
          </select>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-1 opacity-80">{t('Zobrazuje se vedle tvého jména.')}</p>
        </div>

        {saved && <p style={{ color: '#10b981' }} className="text-xs font-bold m-0 flex items-center gap-1"><Check size={13} /> {saved}</p>}
        {saveError && <Notice type="error">{saveError}</Notice>}
      </Section>
    </div>
  );
};

// ---- Záložka: Zabezpečení ----
const isMissingRpc = (err) => !!err && (err.code === 'PGRST202' || /could not find the function/i.test(String(err.message || '')));

// Přihlašovací kód (db/login-code.sql): druhý způsob přihlášení místo hesla. Kód se ukáže jen jednou při vytvoření, server si pamatuje jen jeho otisk.
const LoginCodeSection = () => {
  const [info, setInfo] = useState(undefined);   // undefined: načítá se; null: funkce v databázi chybí; jinak { exists, createdAt, lastUsedAt, useCount }
  const [fresh, setFresh] = useState('');        // právě vytvořený kód (jediná chvíle, kdy je vidět)
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);  // 'new' | 'revoke'
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = async () => {
    try { const next = await getLoginCodeInfo(supabase); if (alive.current) setInfo(next); }
    catch { if (alive.current) setInfo(null); }
  };
  useEffect(() => { load(); }, []);

  const fmt = (v) => (v ? formatDateTime(v, { dateStyle: 'medium', timeStyle: 'short' }) : null);

  const create = async () => {
    setBusy(true); setMsg(null); setCopied(false); setConfirm(null);
    try {
      const code = await createLoginCode(supabase);
      if (!code) throw new Error('empty');
      if (!alive.current) return;
      setFresh(code);
      await load();
    } catch {
      if (alive.current) setMsg({ type: 'error', text: t('Kód se nepodařilo vytvořit. Zkus to znovu za chvíli.') });
    } finally { if (alive.current) setBusy(false); }
  };

  const revoke = async () => {
    setBusy(true); setMsg(null); setConfirm(null);
    try {
      await revokeLoginCode(supabase);
      if (!alive.current) return;
      setFresh('');
      setMsg({ type: 'success', text: t('Kód je zneplatněný. Přihlášení kódem už nefunguje, dokud si nevytvoříš nový.') });
      await load();
    } catch {
      if (alive.current) setMsg({ type: 'error', text: t('Kód se nepodařilo zneplatnit. Zkus to znovu.') });
    } finally { if (alive.current) setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh); setCopied(true); }
    catch { setMsg({ type: 'error', text: t('Kopírování nevyšlo. Kód si opiš ručně.') }); }
  };

  return (
    <Section title={t('Přihlašovací kód')} description={t('Dlouhý tajný kód, kterým se můžeš přihlásit místo hesla. Na zařízení, kde se jím přihlásíš, zůstaneš přihlášený i bez internetu, dokud se sám neodhlásíš. Ulož si ho na bezpečné místo (správce hesel) a nikomu ho neposílej: kdo kód zná, dostane se do tvého účtu.')}>
      <div data-testid="login-code-section" className="space-y-3">
        {info === undefined && <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">{t('Načítám…')}</p>}
        {info === null && <Notice type="info">{t('Přihlašovací kód zatím není na serveru zapnutý. Až bude, najdeš ho tady.')}</Notice>}

        {fresh && (
          <div className="space-y-2" data-testid="login-code-fresh">
            <p style={{ color: 'var(--text-body)' }} className="text-xs font-black m-0">{t('Tvůj nový kód. Server ho už nikdy neukáže, ulož si ho teď:')}</p>
            <code data-testid="login-code-value" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }} className="block border rounded-lg px-3 py-3 text-sm font-black tracking-wider break-all select-all leading-relaxed">{fresh}</code>
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={copy}>{copied ? t('Zkopírováno') : t('Zkopírovat')}</ActionButton>
              <ActionButton variant="ghost" onClick={() => { setFresh(''); setCopied(false); }}>{t('Mám uložený, skrýt')}</ActionButton>
            </div>
          </div>
        )}

        {info && !fresh && (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0" data-testid="login-code-info">
            {info.exists
              ? (info.lastUsedAt
                ? t('Kód je vytvořený {created}, naposledy použitý {used}.', { created: fmt(info.createdAt) || '', used: fmt(info.lastUsedAt) })
                : t('Kód je vytvořený {created}, zatím nepoužitý.', { created: fmt(info.createdAt) || '' }))
              : t('Zatím žádný kód nemáš.')}
          </p>
        )}

        {info && (
          <div className="flex flex-wrap gap-2">
            {!info.exists && !fresh && <ActionButton busy={busy} onClick={create}>{t('Vytvořit přihlašovací kód')}</ActionButton>}
            {info.exists && confirm !== 'new' && confirm !== 'revoke' && (
              <>
                <ActionButton variant="ghost" disabled={busy} onClick={() => setConfirm('new')}>{t('Vygenerovat nový kód')}</ActionButton>
                <ActionButton variant="ghost" disabled={busy} onClick={() => setConfirm('revoke')}>{t('Zrušit kód')}</ActionButton>
              </>
            )}
            {confirm === 'new' && (
              <>
                <span className="text-xs font-bold self-center">{t('Starý kód přestane platit. Pokračovat?')}</span>
                <ActionButton busy={busy} onClick={create}>{t('Ano, vytvořit nový')}</ActionButton>
                <ActionButton variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('Zrušit')}</ActionButton>
              </>
            )}
            {confirm === 'revoke' && (
              <>
                <span className="text-xs font-bold self-center">{t('Přihlášení kódem přestane fungovat. Pokračovat?')}</span>
                <ActionButton variant="danger" busy={busy} onClick={revoke}>{t('Ano, zrušit kód')}</ActionButton>
                <ActionButton variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>{t('Zpět')}</ActionButton>
              </>
            )}
          </div>
        )}
        {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      </div>
    </Section>
  );
};

const SecurityTab = ({ user }) => {
  const { username: accountName, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  // poslední žádost o změnu e-mailu tohoto účtu (undefined, dokud nepřijde první odpověď; null, když žádná není nebo funkce v databázi chybí)
  const [emailRequest, setEmailRequest] = useState(undefined);
  const [emailLoadFailed, setEmailLoadFailed] = useState(false);
  const alive = useRef(true);
  const lastEmailStatus = useRef(null); // stav žádosti při posledním načtení
  const emailLoadSeq = useRef(0); // pořadí načtení: pomalejší starší odpověď nesmí přepsat novější

  const loadEmailRequest = async () => {
    const seq = ++emailLoadSeq.current;
    const { data, error } = await supabase.rpc('my_email_change_request');
    if (!alive.current || seq !== emailLoadSeq.current) return;
    if (error) {
      if (isMissingRpc(error)) { setEmailLoadFailed(false); setEmailRequest(null); }
      else setEmailLoadFailed(true);
      return;
    }
    const next = data || null;
    // správce žádost mezitím provedl: relace nese starý e-mail, profil se načte znovu a obnoví ji
    if (lastEmailStatus.current === 'open' && next?.status === 'done') refreshProfile?.();
    lastEmailStatus.current = next?.status ?? null;
    setEmailLoadFailed(false);
    setEmailRequest(next);
  };
  const loadEmailRequestRef = useRef(loadEmailRequest);
  loadEmailRequestRef.current = loadEmailRequest;

  const retryEmailRequest = () => {
    setEmailLoadFailed(false);
    setEmailRequest(undefined);
    loadEmailRequest();
  };

  useEffect(() => {
    alive.current = true;
    loadEmailRequestRef.current();
    // Otevřená žádost se znovu načte, když se čtenář vrátí na stránku (správce ji mezitím mohl vyřídit).
    const refreshOpenRequest = () => {
      if (document.visibilityState !== 'hidden' && lastEmailStatus.current === 'open') loadEmailRequestRef.current();
    };
    window.addEventListener('focus', refreshOpenRequest);
    document.addEventListener('visibilitychange', refreshOpenRequest);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', refreshOpenRequest);
      document.removeEventListener('visibilitychange', refreshOpenRequest);
    };
  }, []);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState(null);

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutMsg, setSignOutMsg] = useState(null);

  // Správce mohl e-mail změnit, zatímco je relace otevřená: pro kontrolu hesla ho proto bereme ze serveru.
  const currentEmail = async () => {
    try {
      const { data } = await supabase.auth.getUser();
      return data?.user?.email || user.email;
    } catch { return user.email; }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (!curPw) return setPwMsg({ type: 'error', text: t('Zadej své současné heslo.') });
    const problem = validateNewPassword(newPw, confPw, curPw);
    if (problem) return setPwMsg({ type: 'error', text: problem });
    setPwBusy(true);
    try {
      if (!(await verifyPassword(await currentEmail(), curPw))) return setPwMsg({ type: 'error', text: t('Současné heslo nesedí.') });
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) return setPwMsg({ type: 'error', text: mapAuthError(error) });
      setCurPw(''); setNewPw(''); setConfPw('');
      setPwMsg({ type: 'success', text: t('Heslo je změněné. Příště se přihlas novým.') });
    } finally { setPwBusy(false); }
  };

  // E-mail se nemění sám: žádost jde správci, který ho změní a čtenáři pošle oznámení. Heslo tu slouží jen jako potvrzení.
  const requestEmailChange = async (e) => {
    e.preventDefault();
    if (emailBusy) return;
    setEmailMsg(null);
    if (!isValidEmail(newEmail)) return setEmailMsg({ type: 'error', text: t('Zadej platný e-mail.') });
    if (sameEmail(newEmail, user.email)) return setEmailMsg({ type: 'error', text: t('To je tvůj současný e-mail.') });
    if (!emailPw) return setEmailMsg({ type: 'error', text: t('Pro potvrzení zadej své heslo.') });
    setEmailBusy(true);
    try {
      if (!(await verifyPassword(await currentEmail(), emailPw))) return setEmailMsg({ type: 'error', text: t('Heslo nesedí.') });
      const { error } = await supabase.rpc('request_email_change', { p_new_email: normalizeEmail(newEmail), p_note: emailNote.trim() });
      if (error) {
        if (isMissingRpc(error)) return setEmailMsg({ type: 'error', text: t('Změna e-mailu teď není dostupná. Zkus to později.') });
        if (String(error.message || '').includes('request_already_open')) await loadEmailRequest();
        return setEmailMsg({ type: 'error', text: explainEmailError(error, REQUEST_ERRORS, t('Žádost se nepodařilo odeslat. Zkus to znovu.')) });
      }
      setNewEmail(''); setEmailPw(''); setEmailNote('');
      setEmailMsg({ type: 'success', text: t('Žádost je u správce. Až e-mail změní, objeví se oznámení v Nastavení → Oznámení a příště se přihlásíš novým. Do té doby se přihlašuj dál současným. Odpověď může chvíli trvat, žádost neposílej víckrát.') });
      await loadEmailRequest();
    } finally { if (alive.current) setEmailBusy(false); }
  };

  const cancelEmailRequest = async () => {
    if (cancelBusy) return;
    setEmailMsg(null);
    setCancelBusy(true);
    try {
      const { data, error } = await supabase.rpc('cancel_my_email_change_request');
      if (error) return setEmailMsg({ type: 'error', text: t('Žádost se nepodařilo zrušit. Zkus to znovu.') });
      setEmailMsg(data?.cancelled === false
        ? { type: 'info', text: t('Žádost už nejde zrušit, správce ji mezitím vyřídil.') }
        : { type: 'success', text: t('Žádost je zrušená.') });
      await loadEmailRequest();
    } finally { if (alive.current) setCancelBusy(false); }
  };

  // Heslo se neposílá e-mailem: žádost jde správci, který vydá dočasné heslo a předá ho mimo aplikaci.
  const requestAdminHelp = async () => {
    setResetMsg(null);
    setResetBusy(true);
    try {
      const { error } = await supabase.rpc('request_password_help', { p_email: await currentEmail(), p_username: accountName || '', p_note: t('Žádost z Nastavení (uživatel je přihlášený).') });
      if (error) return setResetMsg({ type: 'error', text: t('Žádost se nepodařilo odeslat. Zkus to znovu.') });
      setResetMsg({ type: 'success', text: t('Žádost je u správce. Až ti vydá dočasné heslo, dostaneš ho od něj mimo aplikaci. Po přihlášení si nastavíš vlastní. Odpověď může chvíli trvat, žádost neposílej víckrát.') });
    } finally { setResetBusy(false); }
  };

  const signOutEverywhere = async () => {
    setSignOutMsg(null);
    setSignOutBusy(true);
    await cleanupOnLogout({ client: supabase, nav: navigator, win: window }); // zařízení nemá dál dostávat oznámení odhlášeného účtu
    try { await revokeLoginCode(supabase); } catch { /* přihlašovací kód v databázi nemusí být zapnutý */ } // odhlášení všude platí i pro kód, jinak by se jím dal přihlásit zpátky
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setSignOutBusy(false);
    if (error) return setSignOutMsg({ type: 'error', text: mapAuthError(error) });
    navigate('/login');
  };

  return (
    <div className="space-y-4">
      <Section title={t('Změna hesla')} description={t('Pro jistotu napřed zadej současné heslo.')}>
        <form onSubmit={changePassword} className="space-y-3">
          <Field label={t('Současné heslo')}><TextInput type="password" autoComplete="current-password" value={curPw} onChange={e => setCurPw(e.target.value)} /></Field>
          <Field label={t('Nové heslo (aspoň 8 znaků)')}><TextInput type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} /></Field>
          <Field label={t('Nové heslo znovu')}><TextInput type="password" autoComplete="new-password" value={confPw} onChange={e => setConfPw(e.target.value)} /></Field>
          {pwMsg && <Notice type={pwMsg.type}>{pwMsg.text}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton type="submit" busy={pwBusy}>{t('Změnit heslo')}</ActionButton>
            <button type="button" onClick={requestAdminHelp} disabled={resetBusy} style={{ color: 'var(--bg-primary)' }} className="text-xs font-bold bg-transparent border-none cursor-pointer underline disabled:opacity-50 p-0">
              {t('Nepamatuju si současné heslo - požádat správce')}
            </button>
          </div>
          {resetMsg && <Notice type={resetMsg.type}>{resetMsg.text}</Notice>}
        </form>
      </Section>

      <LoginCodeSection />

      <Section title={t('Změna e-mailu')} description={t('Teď se přihlašuješ přes {email}. E-mail ti změní správce, stejně jako dočasné heslo: pošli mu žádost.', { email: user.email })}>
        {emailLoadFailed ? (
          <div className="space-y-3">
            <Notice type="error">{t('Stav žádosti se nepodařilo načíst. Zkus to znovu.')}</Notice>
            <ActionButton variant="ghost" onClick={retryEmailRequest}>{t('Zkusit znovu')}</ActionButton>
          </div>
        ) : emailRequest === undefined ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-80">{t('Načítám…')}</p>
        ) : emailRequest?.status === 'open' ? (
          <div className="space-y-3">
            <Notice>{t('Čeká se na správce: žádost o změnu e-mailu na {email}.', { email: emailRequest.new_email })}</Notice>
            <ActionButton variant="ghost" busy={cancelBusy} onClick={cancelEmailRequest}>{t('Zrušit žádost')}</ActionButton>
          </div>
        ) : (
          <form onSubmit={requestEmailChange} className="space-y-3">
            {emailRequest?.status === 'dismissed' && !emailRequest.cancelled && (
              <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-80">{t('Poslední žádost správce zamítl. Můžeš poslat novou.')}</p>
            )}
            <Field label={t('Nový e-mail')}><TextInput type="email" autoComplete="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} /></Field>
            <Field label={t('Tvoje heslo')}><TextInput type="password" autoComplete="current-password" value={emailPw} onChange={e => setEmailPw(e.target.value)} /></Field>
            <Field label={t('Vzkaz pro správce (nepovinné)')}>
              <textarea
                value={emailNote}
                onChange={e => setEmailNote(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t('Jak tě pozná, kde ti může odpovědět...')}
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                className="w-full p-2.5 border rounded-lg text-sm font-semibold outline-none resize-y"
              />
            </Field>
            <ActionButton type="submit" busy={emailBusy}>{t('Požádat správce o změnu')}</ActionButton>
          </form>
        )}
        {emailMsg && <Notice type={emailMsg.type}>{emailMsg.text}</Notice>}
      </Section>

      <Section title={t('Přihlášená zařízení')} description={t('Odhlásí tě všude - na telefonu, v jiných prohlížečích i tady - a zneplatní přihlašovací kód. Hodí se, když je tvůj účet přihlášený na cizím zařízení.')}>
        {!confirmSignOut ? (
          <ActionButton variant="ghost" onClick={() => setConfirmSignOut(true)}>{t('Odhlásit ze všech zařízení')}</ActionButton>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold">{t('Opravdu odhlásit všude?')}</span>
            <ActionButton busy={signOutBusy} onClick={signOutEverywhere}>{t('Ano, odhlásit')}</ActionButton>
            <ActionButton variant="ghost" disabled={signOutBusy} onClick={() => setConfirmSignOut(false)}>{t('Zrušit')}</ActionButton>
          </div>
        )}
        {signOutMsg && <Notice type={signOutMsg.type}>{signOutMsg.text}</Notice>}
      </Section>
    </div>
  );
};

// ---- Záložka: Vzhled ----
const THEME_OPTIONS = [...Object.keys(THEMES), CUSTOM_THEME_KEY, EXPERIMENTAL_THEME_KEY].map((key) => ({ key, label: THEME_LABELS[key] })); // i18n-ok: popisky motivů se překládají při vykreslení

// Jedna barva: nativní výběr barvy + zápis hex kódu (platí se až když je kód úplný).
const ColorField = ({ label, value, onChange }) => {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="h-9 w-12 p-0 border-none rounded-md cursor-pointer bg-transparent" />
        <input
          type="text" aria-label={t('{label} (hex kód)', { label })} value={text} maxLength={7} spellCheck={false}
          onChange={e => {
            const raw = e.target.value;
            setText(raw);
            const h = completeHex(raw); // za psaní jen úplný 6místný kód, zkratka #abc až při opuštění pole
            if (h) onChange(h);
          }}
          onBlur={() => { const h = normalizeHex(text); if (h) { setText(h); onChange(h); } else setText(value); }}
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
          className="w-24 px-2 py-1.5 rounded-lg border text-xs font-mono uppercase"
        />
      </div>
    </div>
  );
};

const Segmented = ({ options, value, onChange, ariaLabel }) => (
  <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
    {Object.entries(options).map(([key, opt]) => {
      const active = value === key;
      return (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(key)}
          style={{ backgroundColor: active ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: active ? 'var(--text-primary)' : 'var(--text-body)', borderColor: active ? 'var(--bg-primary)' : 'var(--border-color)' }}
          className="flex-auto min-w-[4.5rem] px-2 py-2 rounded-lg border border-solid cursor-pointer text-xs font-bold"
        >
          {t(opt.label)}
        </button>
      );
    })}
  </div>
);

const ToggleRow = ({ title, description, checked, onChange, disabled }) => (
  <div className="flex items-center justify-between gap-4">
    <div className="min-w-0">
      <p className="text-sm font-bold m-0">{title}</p>
      {description && <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-0.5 opacity-80 leading-relaxed">{description}</p>}
    </div>
    <Toggle checked={checked} label={title} disabled={disabled} onChange={onChange} />
  </div>
);

const RangeRow = ({ label, valueLabel, min, max, step = 1, value, onChange, hint }) => (
  <div>
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs font-bold">{label}</span>
      <span style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">{valueLabel}</span>
    </div>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full" style={{ accentColor: 'var(--bg-primary)' }} />
    {hint && <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-1 opacity-80 leading-relaxed">{hint}</p>}
  </div>
);

const Label = ({ children }) => <span className="text-xs font-bold block mb-1.5">{children}</span>;

// Kam se nastavení ukládají: k účtu (platí na všech zařízeních), nebo jen do tohoto zařízení.
const SYNC_TEXT = {
  off: tk('Nastavení se ukládají jen v tomto zařízení. Po přihlášení se budou ukládat k tvému účtu a platit na všech tvých zařízeních.'),
  syncing: tk('Ukládám nastavení k tvému účtu...'),
  synced: tk('Nastavení se ukládají k tvému účtu a platí na všech tvých zařízeních.'),
  unavailable: tk('Ukládání nastavení k účtu zatím není dostupné. Nastavení platí jen v tomto zařízení.'),
  error: tk('Nastavení se teď nepodařilo uložit k účtu. Platí v tomto zařízení a odešle se při dalším pokusu.'),
};
const SyncNote = () => {
  const status = useSyncStatus();
  const warn = status === 'error'; // chybějící tabulka (unavailable) není porucha, jen informace
  return (
    <p role="status" style={{ color: warn ? '#d97706' : 'var(--text-muted)' }} className="text-xs font-semibold m-0 flex items-start gap-1.5 leading-relaxed">
      {warn ? <AlertTriangle size={13} className="shrink-0 mt-0.5" /> : <Info size={13} className="shrink-0 mt-0.5" />}
      <span>{t(SYNC_TEXT[status] || SYNC_TEXT.off)}</span>
    </p>
  );
};

const SelectField = ({ label, value, onChange, children }) => (
  <label className="block">
    <Label>{label}</Label>
    <select
      value={value} onChange={e => onChange(e.target.value)}
      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
      className="w-full px-3 py-2.5 rounded-lg border text-sm font-medium cursor-pointer"
    >{children}</select>
  </label>
);

const toOptions = (list) => Object.fromEntries(list.map((o) => [o.key, { label: o.label }]));
const VIEW_OPTIONS = { grid: { label: tk('Mřížka') }, list: { label: tk('Seznam') } };
const STATUS_OPTIONS = toOptions(STATUS_FILTERS);

const AppearanceTab = () => {
  const { currentTheme, changeTheme, customColors, changeCustomColors, accent, changeAccent, lively, changeLively } = useTheme();
  const [motion, setMotion] = useState(loadMotionPref);
  const [scale, setScale] = useState(loadUiScale);
  const [density, setDensity] = useState(loadUiDensity);
  const [lib, setLib] = useState(() => readLibraryPrefs());
  const setLibPref = (name, value) => { writeLibraryPref(name, value); setLib(readLibraryPrefs()); };
  const isCustom = usesCustomColors(currentTheme);

  return (
    <div className="space-y-4">
      <SyncNote />

      <Section title={t('Jazyk')} description={t('Jazyk celé appky. Texty knih zůstávají v původním jazyce.')}>
        <LanguageSwitch variant="settings" />
      </Section>

      <Section title={t('Motiv')} description={t('Platí v celé appce - od knihovny přes čtečku až po minihry.')}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {THEME_OPTIONS.map(({ key, label }) => {
            // Náhled „Vlastní“ ukazuje barvy, které dostane po kliknutí (poprvé barvy právě používaného motivu).
            const preview = customColorsPreview(currentTheme, customColors);
            const colors = usesCustomColors(key) ? deriveTheme(preview.bg, preview.accent) : withAccent(resolveTheme(key), accent);
            const active = currentTheme === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => changeTheme(key)}
                aria-pressed={active}
                style={{ backgroundColor: colors['--bg-body'], borderColor: active ? colors['--bg-primary'] : colors['--border-color'], color: colors['--text-body'] }}
                className={`relative rounded-xl border-2 p-2.5 cursor-pointer text-left ${key === EXPERIMENTAL_THEME_KEY ? 'theme-tile-sketchy' : ''} ${active ? 'shadow-md' : ''}`}
              >
                <span style={{ backgroundColor: colors['--bg-card'], borderColor: colors['--border-color'] }} className="block h-9 rounded-md border mb-2 relative">
                  <span style={{ backgroundColor: colors['--bg-primary'] }} className="absolute left-1.5 top-1.5 h-2 w-8 rounded-full" />
                  <span style={{ backgroundColor: colors['--border-color'] }} className="absolute left-1.5 bottom-1.5 h-1.5 w-12 rounded-full" />
                </span>
                <span className="text-[0.6875rem] font-black block leading-tight">{t(label)}</span>
                {active && <Check size={13} style={{ color: colors['--bg-primary'] }} className="absolute right-2 top-2" />}
              </button>
            );
          })}
        </div>
        {isCustom && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap gap-4">
              <ColorField label={t('Pozadí')} value={customColors.bg} onChange={bg => changeCustomColors({ ...customColors, bg })} />
              <ColorField label={t('Zvýraznění')} value={customColors.accent} onChange={accent => changeCustomColors({ ...customColors, accent })} />
            </div>
            <div>
              <Label>{t('Hotové kombinace')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {CUSTOM_PRESETS.map(p => (
                  <button
                    key={p.label} type="button" onClick={() => changeCustomColors({ bg: p.bg, accent: p.accent })}
                    style={{ backgroundColor: p.bg, color: deriveTheme(p.bg, p.accent)['--text-body'], borderColor: p.accent }}
                    className="px-2.5 py-1 rounded-full border-2 text-[0.6875rem] font-bold cursor-pointer"
                  >{t(p.label)}</button>
                ))}
              </div>
            </div>
            {contrast(customColors.accent, customColors.bg) < ACCENT_MIN_CONTRAST && (
              <div className="flex flex-wrap items-center gap-2">
                <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
                  {t('Zvýraznění je na tomhle pozadí špatně vidět. Zkus světlejší nebo tmavší odstín.')}
                </p>
                <ActionButton type="button" onClick={() => changeCustomColors({ ...customColors, accent: readableAccent(customColors.accent, customColors.bg) })}>
                  {t('Upravit automaticky')}
                </ActionButton>
              </div>
            )}
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
              {t('Ostatní barvy (karty, okraje, text) se dopočítají samy a text se vždy upraví tak, aby byl čitelný.')}
            </p>
            {currentTheme === EXPERIMENTAL_THEME_KEY && (
              <p data-testid="experimental-note" style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
                {t('Experimentální vlastní má stejné barvy jako „Vlastní“ (změna se projeví v obou), jen vypadá hravěji: kreslené rohy, ručně psané písmo a odsazené stíny. Text knih ve čtečce se tím nemění.')}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title={t('Akcentní barva')} description={t('Barva tlačítek a štítků. Vždy se upraví tak, aby byla na pozadí motivu dobře vidět a text na ní byl čitelný.')}>
        {isCustom ? (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{t('U vlastních motivů se zvýraznění nastavuje barvami výše.')}</p>
        ) : (
          <div role="radiogroup" aria-label={t('Akcentní barva')} className="flex flex-wrap gap-2">
            {Object.entries(ACCENTS).map(([key, a]) => {
              const base = resolveTheme(currentTheme);
              const shown = withAccent(base, key);
              const active = accent === key;
              return (
                <button
                  key={key} type="button" role="radio" aria-checked={active} onClick={() => changeAccent(key)}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: active ? 'var(--text-body)' : 'var(--border-color)', color: 'var(--text-body)' }}
                  className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full border-2 cursor-pointer text-xs font-bold"
                >
                  <span style={{ backgroundColor: shown['--bg-primary'], color: shown['--text-primary'] }} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                    {active && <Check size={13} />}
                  </span>
                  {t(a.label)}
                </button>
              );
            })}
          </div>
        )}
      </Section>

      <Section title={t('Živý režim')} description={t('Experimentální. Appka je živější: stránky se přepínají odjezdem a příjezdem, karty a seznamy vyjíždějí postupně a z různých stran, čísla se dotáčejí a dosednou, ukazatele se plní, karty knih se naklánějí za myší a při filtrování plynule přeskakují na nová místa, okna naskakují, tlačítka a lišta pružně reagují a nový motiv se rozlije kruhem z místa kliknutí. Na pozadí a po stranách širokých obrazovek jsou jemné ozdoby.')}>
        <ToggleRow
          title={t('Zapnout živý režim')}
          description={t('Čtečka, hry a krátké knihy zůstávají klidné. Barvy se berou z motivu, takže se hodí ke všem, i k Vlastnímu. Na telefonu jsou jen animace rozhraní a pozadí, bez ozdob po stranách.')}
          checked={!!lively} onChange={changeLively}
        />
        {lively && (typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === '1') && (
          <p data-testid="lively-motion-note" style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
            {t('Máš omezený pohyb (níže v sekci Pohyb a animace), takže se nic nehýbe: karty se objeví hned, čísla se neroztáčejí a okna se jen zobrazí.')}
          </p>
        )}
      </Section>

      <Section title={t('Velikost a hustota')} description={t('Platí v celé appce. Čtečka má vlastní velikost písma (záložka Čtečka).')}>
        <div className="space-y-4">
          <div>
            <Label>{t('Velikost textu a prvků')}</Label>
            <Segmented ariaLabel={t('Velikost textu a prvků')} options={UI_SCALES} value={scale} onChange={v => { saveUiScale(v); setScale(loadUiScale()); }} />
          </div>
          <div>
            <Label>{t('Rozestupy')}</Label>
            <Segmented ariaLabel={t('Rozestupy')} options={UI_DENSITIES} value={density} onChange={v => { saveUiDensity(v); setDensity(loadUiDensity()); }} />
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-1.5 leading-relaxed">
              {t('Kompaktní se vejde víc obsahu na obrazovku, pohodlné nechá víc vzduchu kolem tlačítek.')}
            </p>
          </div>
        </div>
      </Section>

      <Section title={t('Knihovna')} description={t('Jak se knihovna otevře. Pohled i řazení můžeš v knihovně kdykoli změnit, tady je jen výchozí volba.')}>
        <div className="space-y-4">
          <div>
            <Label>{t('Výchozí pohled')}</Label>
            <Segmented ariaLabel={t('Výchozí pohled knihovny')} options={VIEW_OPTIONS} value={lib.view} onChange={v => setLibPref('view', v)} />
          </div>
          <SelectField label={t('Výchozí řazení')} value={lib.sort} onChange={v => setLibPref('sort', v)}>
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{t(o.label)}</option>)}
          </SelectField>
          <div>
            <Label>{t('Výchozí filtr')}</Label>
            <Segmented ariaLabel={t('Výchozí filtr knihovny')} options={STATUS_OPTIONS} value={lib.status} onChange={v => setLibPref('status', v)} />
          </div>
          <ToggleRow
            title={t('Pamatovat si polohu a filtry')}
            description={t('Po návratu ze čtečky se knihovna vrátí na původní místo a ke stejnému hledání a filtrům. Když je vypnuté, knihovna se otevře vždy od začátku s výchozími volbami.')}
            checked={lib.remember} onChange={v => setLibPref('remember', v)}
          />
        </div>
      </Section>

      <Section title={t('Pohyb a animace')} description={t('Omezení vypne přechody a animace v celé aplikaci (včetně otáčení stránek ve čtečce). Hodí se při nevolnosti z pohybu i na slabších telefonech.')}>
        <Segmented ariaLabel={t('Pohyb a animace')} options={MOTION_OPTIONS} value={motion} onChange={v => { saveMotionPref(v); setMotion(v); }} />
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">
          {motion === 'system' ? t('Řídí se nastavením zařízení („omezit pohyb“).') : motion === 'reduce' ? t('Animace jsou vypnuté.') : t('Animace jsou zapnuté bez ohledu na nastavení zařízení.')}
        </p>
      </Section>
    </div>
  );
};

// ---- Záložka: Aplikace (instalace jako PWA, offline obal, verze) ----
const AppTab = () => {
  const { installed, canPrompt, ios } = useInstallState();
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [offlineReady, setOfflineReady] = useState(null);
  const [resetMsg, setResetMsg] = useState('');
  // Po třech vteřinách se ukáže "zatím není", ale čeká se dál: první návštěva na pomalé síti může dokončit ukládání později.
  useEffect(() => {
    let on = true;
    const timer = setTimeout(() => { if (on) setOfflineReady(v => (v === null ? false : v)); }, 3000);
    whenOfflineReady().then(v => { if (on && v) setOfflineReady(true); });
    return () => { on = false; clearTimeout(timer); };
  }, []);

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    setResult(outcome === 'accepted' ? t('Hotovo, aplikace se instaluje. Najdeš ji v nabídce nebo na ploše.') : outcome === 'dismissed' ? t('Instalace byla zrušena. Spustit ji můžeš kdykoli později.') : '');
  };

  return (
    <div className="space-y-4">
      <Section title={t('Instalace')} description={t('Spouštěj Jomarid Books jako běžnou aplikaci: z plochy nebo z nabídky, v samostatném okně bez adresního řádku.')}>
        {installed ? (
          <Notice type="success">{t('Aplikace je nainstalovaná. Právě ji používáš jako aplikaci.')}</Notice>
        ) : canPrompt ? (
          <ActionButton busy={busy} onClick={install}><Download size={14} /> {t('Nainstalovat aplikaci')}</ActionButton>
        ) : ios ? (
          <div className="space-y-2">
            <p className="text-xs font-bold m-0">{t('Na iPhonu a iPadu se appka přidává ručně:')}</p>
            <ol style={{ color: 'var(--text-body)' }} className="text-xs m-0 pl-5 space-y-1 leading-relaxed">
              <li>{tx('Klepni na tlačítko {share} v liště prohlížeče.', { share: <><strong>{t('Sdílet')}</strong> <Share size={12} className="inline align-text-bottom" /></> })}</li>
              <li>{tx('Vyber {item}.', { item: <strong>{t('Přidat na plochu')}</strong> })}</li>
              <li>{tx('Potvrď tlačítkem {item}.', { item: <strong>{t('Přidat')}</strong> })}</li>
            </ol>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
            {t('Tvůj prohlížeč teď instalační okno nenabízí. V Chromu a Edge hledej ikonu instalace v adresním řádku nebo položku „Nainstalovat Jomarid Books“ v nabídce, v Safari na Macu to jde přes Soubor a Přidat do Docku. Ve Firefoxu na počítači instalace appek není.')}
          </p>
        )}
        {/* Výsledek je mimo větve nahoře: po klepnutí instalační okno zmizí (jde použít jen jednou) a s ním by zmizela i zpráva. */}
        {result && !installed && <Notice>{result}</Notice>}
      </Section>

      <Section title={t('Offline a aktualizace')} description={t('Obal aplikace se ukládá do zařízení, takže se otevře i bez připojení. Knihy, mince a postup ve čtení se vždy načítají z internetu, aby byly aktuální; ke čtení bez internetu si knihy stáhneš zvlášť (níže).')}>
        <Notice>
          {offlineReady === null ? t('Zjišťuji stav...') : offlineReady ? t('Offline kopie obalu aplikace je připravená.') : t('Offline kopie zatím není k dispozici (třeba při prvním otevření nebo v anonymním okně).')}
        </Notice>
        <div className="space-y-1.5">
          <ActionButton variant="ghost" busy={busy} onClick={async () => { setBusy(true); setResetMsg(''); const out = await resetApp(); if (out === 'offline') { setBusy(false); setResetMsg(t('Bez připojení k internetu se aplikace obnovit nedá, protože by se ztratila offline kopie. Zkus to znovu, až budeš online.')); } }}><RefreshCw size={14} /> {t('Obnovit aplikaci')}</ActionButton>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{t('Smaže uloženou offline kopii a načte nejnovější verzi. Použij, kdyby se appka chovala jako po staré verzi.')}</p>
          {resetMsg && <Notice type="error">{resetMsg}</Notice>}
        </div>
      </Section>

      <OfflineBooksSection Section={Section} Notice={Notice} ActionButton={ActionButton} />
      <OfflineGamesSection Section={Section} Notice={Notice} ActionButton={ActionButton} />

      <Section title={t('O aplikaci')}>
        <p translate="no" className="text-sm font-bold m-0">Jomarid Books · {APP_VERSION_LABEL}</p>
      </Section>
    </div>
  );
};

// ---- Záložka: Čtečka ----
const SAMPLE_TEXT = tk('Na ranním nebi se pomalu rozhořívala první hvězda. „Dnes půjdeme dál,“ řekla tiše. Nejneobyčejnější na tom všem bylo, že nikdo z nich nepochyboval o tom, že cesta vede správným směrem – a přece se každý z nich ve skrytu duše bál, že nepředstavitelně dlouhá noc teprve začíná.');

const ReaderTab = () => {
  const [prefs, setPrefs] = useState(loadReaderPrefs);
  const [resetDone, setResetDone] = useState(false);

  // Změna ze čtečky (rychlé přepínače) nebo z jiné záložky se projeví i tady.
  useEffect(() => {
    const sync = () => setPrefs(p => { const n = loadReaderPrefs(); return JSON.stringify(n) === JSON.stringify(p) ? p : n; });
    window.addEventListener(READER_PREFS_EVENT, sync);
    return () => window.removeEventListener(READER_PREFS_EVENT, sync);
  }, []);

  const update = (name, value) => {
    setResetDone(false);
    saveReaderPref(name, value);
    setPrefs(p => ({ ...p, [name]: value }));
  };
  const reset = () => { resetReaderPrefs(); setPrefs(loadReaderPrefs()); setResetDone(true); };

  const typo = readerTypography(prefs);
  const previewBg = prefs.paper ? '#f4ecd8' : 'var(--bg-secondary)';
  const previewColor = prefs.paper ? '#3b2f1e' : 'var(--text-body)';
  const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  return (
    <div className="space-y-4">
      <SyncNote />

      <div
        data-testid="reader-preview"
        lang={typo.lang}
        style={{ backgroundColor: previewBg, color: previewColor, borderColor: 'var(--border-color)', padding: `${Math.round(typo.padY * 0.6)}px ${typo.padX}px`, ...typo.style }}
        className={`relative overflow-hidden border rounded-xl max-h-44 sm:max-h-56 ${typo.className}`}
      >
        {t(SAMPLE_TEXT)}
        {prefs.nightFilter > 0 && (
          <span aria-hidden="true" data-testid="night-preview" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply', backgroundColor: `rgba(255, 130, 30, ${(prefs.nightFilter / 100) * 0.45})` }} />
        )}
      </div>

      <Section title={t('Text')} description={t('Ukázka nahoře se mění podle tvých voleb. Změny se hned uloží a projeví i v otevřené knize.')}>
        <RangeRow label={t('Velikost písma')} valueLabel={`${prefs.fontSize} px`} min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} value={prefs.fontSize} onChange={v => update('fontSize', v)} />
        <div><Label>{t('Písmo')}</Label><Segmented ariaLabel={t('Písmo')} options={FONT_FAMILIES} value={prefs.fontFamily} onChange={v => update('fontFamily', v)} /></div>
        <div><Label>{t('Řádkování')}</Label><Segmented ariaLabel={t('Řádkování')} options={LINE_HEIGHTS} value={prefs.lineHeight} onChange={v => update('lineHeight', v)} /></div>
        <div><Label>{t('Zarovnání')}</Label><Segmented ariaLabel={t('Zarovnání')} options={ALIGNMENTS} value={prefs.align} onChange={v => update('align', v)} /></div>
        <ToggleRow title={t('Dělení slov')} description={t('Dlouhá slova se na konci řádku dělí pomlčkou (nejlíp s zarovnáním do bloku). Záleží na prohlížeči, zda umí česky.')} checked={prefs.hyphens} onChange={v => update('hyphens', v)} />
        <div><Label>{t('Mezery mezi písmeny')}</Label><Segmented ariaLabel={t('Mezery mezi písmeny')} options={LETTER_SPACINGS} value={prefs.letterSpacing} onChange={v => update('letterSpacing', v)} /></div>
      </Section>

      <Section title={t('Stránka')}>
        <div><Label>{t('Tvar stránky')}</Label><Segmented ariaLabel={t('Tvar stránky')} options={TEXT_WIDTHS} value={prefs.textWidth} onChange={v => update('textWidth', v)} /></div>
        <div><Label>{t('Okraje')}</Label><Segmented ariaLabel={t('Okraje')} options={PAGE_MARGINS} value={prefs.margin} onChange={v => update('margin', v)} /></div>
        <div>
          <Label>{t('Zalamování stránek')}</Label>
          <Segmented ariaLabel={t('Zalamování stránek')} options={PAGE_BREAKS} value={prefs.pageBreak} onChange={v => update('pageBreak', v)} />
          <p data-testid="page-break-hint" style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-1.5 opacity-80 leading-relaxed">{t(PAGE_BREAKS[prefs.pageBreak].hint)}</p>
        </div>
        <ToggleRow title={t('Papírový režim')} description={t('Teplé pozadí jen pro samotný text.')} checked={prefs.paper} onChange={v => update('paper', v)} />
        <RangeRow label={t('Noční filtr')} valueLabel={prefs.nightFilter === 0 ? 'vypnuto' : `${prefs.nightFilter} %`} min={NIGHT_RANGE.min} max={NIGHT_RANGE.max} step={5} value={prefs.nightFilter} onChange={v => update('nightFilter', v)} hint={t('Teplý odstín, který šetří oči večer. Zatmaví celou obrazovku čtečky.')} />
      </Section>

      <Section title={t('Listování')}>
        <div><Label>{t('Animace otočení stránky')}</Label><Segmented ariaLabel={t('Animace otočení stránky')} options={PAGE_ANIMATIONS} value={prefs.pageAnim} onChange={v => update('pageAnim', v)} /></div>
        <ToggleRow title={t('Listování ťuknutím')} description={t('Levý a pravý okraj stránky listuje, střed přepíná fokus režim.')} checked={prefs.tapZones} onChange={v => update('tapZones', v)} />
        <ToggleRow title={t('Listování přejetím')} description={t('Přejetí prstem doleva nebo doprava.')} checked={prefs.swipe} onChange={v => update('swipe', v)} />
        <RangeRow label={t('Rychlost auto-listování')} valueLabel={t('{n} s / stránku', { n: prefs.autoAdvance })} min={AUTO_ADVANCE_RANGE.min} max={AUTO_ADVANCE_RANGE.max} value={prefs.autoAdvance} onChange={v => update('autoAdvance', v)} />
      </Section>

      <Section title={t('Informace při čtení')}>
        <ToggleRow title={t('Pruh postupu')} description={t('Tenký pruh nahoře ukazuje, kolik z knihy máš přečteno.')} checked={prefs.showProgress} onChange={v => update('showProgress', v)} />
        <ToggleRow title={t('Zbývající čas a číslo stránky')} checked={prefs.showMeta} onChange={v => update('showMeta', v)} />
        <RangeRow label={t('Rychlost čtení')} valueLabel={`${prefs.wpm} slov / min`} min={WPM_RANGE.min} max={WPM_RANGE.max} step={10} value={prefs.wpm} onChange={v => update('wpm', v)} hint={t('Podle ní se odhaduje, kolik minut ti do konce knihy zbývá.')} />
        <ToggleRow title={t('Otevírat ve fokus režimu')} description={t('Bez horní lišty, jen text.')} checked={prefs.startFocus} onChange={v => update('startFocus', v)} />
      </Section>

      <Section title={t('Zařízení')}>
        <ToggleRow title={t('Nechat displej svítit při čtení')} description={wakeLockSupported ? t('Displej nezhasne, dokud máš otevřenou knihu.') : t('Tenhle prohlížeč to bohužel nepodporuje.')} checked={prefs.wakeLock} disabled={!wakeLockSupported} onChange={v => update('wakeLock', v)} />
      </Section>

      <div className="flex items-center gap-3 flex-wrap">
        <ActionButton variant="ghost" onClick={reset}><RotateCcw size={13} className="inline mr-1.5 -mt-0.5" />{t('Obnovit výchozí nastavení čtečky')}</ActionButton>
        {resetDone && <Notice type="success">{t('Nastavení čtečky je zpět na výchozí.')}</Notice>}
      </div>
    </div>
  );
};

// ---- Záložka: Data a účet ----
const EXPORT_SOURCES = [
  { key: 'profile', table: 'profiles', column: 'id' },
  { key: 'reading_progress', table: 'user_books', column: 'user_id' },
  { key: 'bookmarks', table: 'book_bookmarks', column: 'user_id' },
  { key: 'highlights', table: 'book_highlights', column: 'user_id' },
  { key: 'ratings', table: 'book_ratings', column: 'user_id' },
  { key: 'comments', table: 'book_comments', column: 'user_id' },
  { key: 'likes', table: 'book_likes', column: 'user_id' },
  { key: 'coin_transactions', table: 'coin_transactions', column: 'user_id' },
  { key: 'daily_activity', table: 'user_daily_activity', column: 'user_id' },
  { key: 'settings', table: SETTINGS_TABLE, column: 'user_id', optional: true }, // tabulka nemusí existovat
  // Herní rekordy a odznaky (db/game-records.sql) a obchůdek (db/shop.sql) čtou jen funkce, do tabulek klient nesmí; funkce nemusí existovat.
  { key: 'game_progress', rpc: 'my_game_progress', optional: true },
  { key: 'cosmetics', rpc: 'my_cosmetics', optional: true },
  { key: 'game_saves', rpc: 'my_game_saves', optional: true }, // postup her (db/game-saves.sql)
];

// Supabase vrací nanejvýš 1000 řádků na dotaz - proto se čte po stránkách.
async function fetchAll(table, column, value) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').eq(column, value).range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function fetchRpc(name) {
  const { data, error } = await supabase.rpc(name);
  if (error) throw error;
  return data;
}

const isMissingFunction = (error) => ['PGRST202', '42883'].includes(String(error?.code || '')) || /could not find the function|function .* does not exist/i.test(String(error?.message || ''));

const DELETE_ERRORS = {
  admin_cannot_self_delete: tk('Účet správce si sám smazat nejde - napřed předej správu jinému správci.'),
  has_published_books: tk('Máš vydané knihy. Smazat jdou jen ty, které ještě nemají čtenáře. U ostatních požádej správce o převod na jiný účet (kontakt najdeš na úvodní stránce).'),
  not_authenticated: tk('Přihlášení vypršelo, přihlas se prosím znovu.'),
};

const DataTab = ({ user, role }) => {
  const navigate = useNavigate();
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const [typedEmail, setTypedEmail] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState(null);

  const exportData = async () => {
    setExportMsg(null);
    setExportBusy(true);
    try {
      const results = await Promise.allSettled(EXPORT_SOURCES.map(s => (s.rpc ? fetchRpc(s.rpc) : fetchAll(s.table, s.column, user.id))));
      const data = {};
      const errors = [];
      results.forEach((r, i) => {
        const { key, table, rpc, optional } = EXPORT_SOURCES[i];
        if (r.status === 'fulfilled') data[key] = key === 'profile' ? (r.value[0] || null) : r.value;
        else if (optional && (isMissingTable(r.reason) || isMissingFunction(r.reason))) return; // chybějící volitelná tabulka nebo funkce není chyba exportu
        else errors.push(`${table || rpc}: ${r.reason?.message || t('chyba čtení')}`);
      });
      const payload = {
        exportedAt: new Date().toISOString(),
        account: { id: user.id, email: user.email, createdAt: user.created_at },
        ...data,
        ...(errors.length ? { errors } : {}),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jomarid-books-moje-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMsg(errors.length
        ? { type: 'info', text: t.p(errors.length, 'Export je stažený, ale nepodařilo se načíst {n} část (podrobnosti najdeš v souboru pod "errors").', 'Export je stažený, ale nepodařilo se načíst {n} části (podrobnosti najdeš v souboru pod "errors").', 'Export je stažený, ale nepodařilo se načíst {n} částí (podrobnosti najdeš v souboru pod "errors").', { n: errors.length }) }
        : { type: 'success', text: t('Export je stažený.') });
    } catch (err) {
      setExportMsg({ type: 'error', text: friendlyError(err, 'Export se nepovedl. Zkus to znovu.') });
    } finally { setExportBusy(false); }
  };

  const emailMatches = typedEmail.trim().toLowerCase() === (user.email || '').toLowerCase() && typedEmail.trim() !== '';

  const deleteAccount = async () => {
    setDeleteMsg(null);
    setDeleteBusy(true);
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      setDeleteBusy(false);
      const code = Object.keys(DELETE_ERRORS).find(c => String(error.message).includes(c));
      return setDeleteMsg({ type: 'error', text: code ? t(DELETE_ERRORS[code]) : friendlyError(error, t('Smazání se nepovedlo. Zkus to znovu.')) });
    }
    // Účet už na serveru neexistuje - stačí zahodit lokální session.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    navigate('/');
  };

  return (
    <div className="space-y-4">
      <Section title={t('Stáhnout moje data')} description={t('Soubor JSON s hlavními údaji účtu: profil (včetně odznaků), rozečtené knihy, záložky, zvýraznění, hodnocení, komentáře, lajky, pohyby mincí, denní aktivita a nastavení. Texty knih a oznámení v něm nejsou.')}>
        <ActionButton busy={exportBusy} onClick={exportData}><Download size={13} /> {t('Stáhnout data')}</ActionButton>
        {exportMsg && <Notice type={exportMsg.type}>{exportMsg.text}</Notice>}
      </Section>

      <Section
        danger
        title={t('Smazat účet')}
        description={t('Nevratně smaže tvůj účet i všechna data: profil, odznaky, rozečtené knihy, záložky, zvýraznění, hodnocení, komentáře, lajky, mince, aktivitu a nastavení. Zpět to nejde vzít.')}
      >
        {(role === ROLE_ADMIN || role === ROLE_PUBLISHER) && (
          <Notice type="info">
            {role === ROLE_ADMIN ? t('Účet správce si sám smazat nejde.') : t('Vydané knihy musíš před smazáním účtu smazat (jdou jen ty bez čtenářů) nebo nechat převést na jiný účet. Převod udělá správce.')}
          </Notice>
        )}
        <Field label={t('Pro potvrzení napiš svůj e-mail ({email})', { email: user.email })}>
          <TextInput type="email" autoComplete="off" value={typedEmail} onChange={e => setTypedEmail(e.target.value)} placeholder={user.email} />
        </Field>
        {deleteMsg && <Notice type={deleteMsg.type}>{deleteMsg.text}</Notice>}
        <ActionButton variant="danger" busy={deleteBusy} disabled={!emailMatches} onClick={deleteAccount}>{t('Smazat můj účet natrvalo')}</ActionButton>
      </Section>
    </div>
  );
};

// ---- Stránka Nastavení (/settings/:záložka) ----
// Každá záložka má vlastní adresu, takže jde sdílet odkaz, obnovit stránku a funguje tlačítko Zpět.
// Cíle prohlídky appky u záložek Nastavení (viz ANCHORS v tour/tourModel.js)
const TAB_TOUR = { profile: 'settings-profile', security: 'settings-security', notifications: 'settings-notifications', checks: 'settings-checks', tour: 'settings-tour', appearance: 'settings-appearance', reader: 'settings-reader', app: 'settings-app', data: 'settings-data' };

const TABS = [
  { id: 'profile', label: tk('Profil'), icon: User, needsUser: true },
  { id: 'security', label: tk('Zabezpečení'), icon: ShieldCheck, needsUser: true },
  { id: 'notifications', label: tk('Oznámení'), icon: Bell, needsUser: true },
  { id: 'checks', label: tk('Kontrola účtu'), icon: ClipboardCheck, needsUser: true },
  { id: 'tour', label: tk('Prohlídka appky'), icon: Compass, needsUser: true },
  { id: 'appearance', label: tk('Vzhled'), icon: Palette, needsUser: false },
  { id: 'reader', label: tk('Čtečka'), icon: BookOpen, needsUser: false },
  { id: 'app', label: tk('Aplikace'), icon: Smartphone, needsUser: false },
  { id: 'data', label: tk('Data a účet'), icon: Database, needsUser: true },
];

const INBOX_ICONS = { book_hidden: EyeOff, book_unhidden: EyeOff, comment_removed: MessageCircle, username_changed: UserCog, license_received: Gift, [EMAIL_CHANGED_KIND]: Mail, [EMAIL_REJECTED_KIND]: MailX };
const timeAgo = (iso) => {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return t('právě teď');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('před {n} min', { n: min });
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return t('před {n} h', { n: hrs });
  const days = Math.floor(hrs / 24);
  return days === 1 ? t('včera') : t('před {n} dny', { n: days });
};
const announceUnread = (n) => window.dispatchEvent(new CustomEvent('jomarid-user-notifications', { detail: n }));

// Oznámení od správce a autorů (skrytá kniha, odstraněný komentář, dar knihy...).
// Otevření záložky označí vše jako přečtené; nepřečtené zůstanou do odchodu zvýrazněné.
const InboxTab = () => {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (markRead) => {
    const { data, error: rpcError } = await supabase.rpc('my_notifications', { p_limit: 50 });
    if (rpcError) {
      if (rpcError.code === 'PGRST202' || /could not find the function/i.test(String(rpcError.message || ''))) setMissing(true);
      else setError(t('Oznámení se nepodařilo načíst. Zkus to za chvíli.'));
      setItems([]);
      return;
    }
    // Jiná odpověď než seznam (null je prázdná schránka) nesmí shodit stránku ani se tvářit jako prázdná schránka.
    if (data != null && !Array.isArray(data)) {
      setError(t('Oznámení se nepodařilo načíst. Zkus to za chvíli.'));
      setItems([]);
      return;
    }
    setError('');
    const list = data || [];
    setItems(list);
    if (markRead && list.some(n => !n.read_at)) {
      const { error: markError } = await supabase.rpc('mark_notifications_read');
      if (!markError) announceUnread(0);
    }
  };

  useEffect(() => { load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const removeOne = async (id) => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('delete_my_notifications', { p_id: id });
    setBusy(false);
    if (rpcError) return setError(t('Smazání se nepovedlo. Zkus to znovu.'));
    setItems(prev => (prev || []).filter(n => n.id !== id));
  };

  const removeRead = async () => {
    setBusy(true);
    const { error: rpcError } = await supabase.rpc('delete_my_notifications');
    if (rpcError) { setBusy(false); return setError(t('Smazání se nepovedlo. Zkus to znovu.')); }
    await load(false);
    setBusy(false);
  };

  if (missing) return <Notice type="info">{t('Oznámení teď nejsou k dispozici. Zkus to později.')}</Notice>;
  if (items === null) return <div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}><Loader2 size={14} className="animate-spin" /> {t('Načítám...')}</div>;

  return (
    <div className="space-y-3">
      <PushSettings />
      {error && <Notice type="error">{error}</Notice>}
      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }} className="text-sm m-0 py-6 text-center leading-relaxed">{t('Zatím nemáš žádná oznámení. Ozveme se, když správce zasáhne do tvé knihy, komentáře, uživatelského jména nebo e-mailu, nebo když ti autor daruje knihu.')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <span style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">{t.p(items.length, '{n} oznámení', '{n} oznámení', '{n} oznámení', { n: items.length })}</span>
            <ActionButton variant="ghost" busy={busy} onClick={removeRead}>{t('Smazat přečtená')}</ActionButton>
          </div>
          <ul className="list-none p-0 m-0 space-y-2">
            {items.map(n => {
              const Icon = INBOX_ICONS[n.kind] || Bell;
              const isNew = !n.read_at;
              return (
                <li key={n.id} data-testid="inbox-item" data-unread={isNew ? 'true' : 'false'}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: isNew ? 'var(--bg-primary)' : 'var(--border-color)' }}
                  className="border rounded-xl p-3 flex items-start gap-3">
                  <span style={{ backgroundColor: 'var(--bg-card)', color: 'var(--bg-primary)' }} className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"><Icon size={15} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black m-0 break-words">{n.title}{isNew && <span style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="ml-2 align-middle px-1.5 py-0.5 rounded text-[0.5625rem] font-black uppercase">{t('Nové')}</span>}</p>
                    {n.body && <p style={{ color: 'var(--text-body)' }} className="text-xs m-0 mt-1 leading-relaxed break-words">{n.body}</p>}
                    <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] m-0 mt-1 opacity-80">{timeAgo(n.created_at)}</p>
                  </div>
                  <button type="button" onClick={() => removeOne(n.id)} disabled={busy} aria-label={t('Smazat oznámení: {title}', { title: n.title })} title={t('Smazat')} style={{ color: 'var(--text-muted)' }} className="bg-transparent border-none cursor-pointer w-8 h-8 -m-1 flex items-center justify-center shrink-0 opacity-60 hover:opacity-100 disabled:opacity-30"><X size={14} /></button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

// ---- Záložka: Kontrola účtu ----
// Upozornění na to, co si může uživatel opravit sám (jméno, u nakladatelů i nedodělané knihy). Počítá se při otevření
// Nastavení a při každém přepnutí záložky (po opravě jména tak upozornění hned zmizí), ručně jde spustit znovu.
const useAccountNotices = (user, role, refreshKey) => {
  const [state, setState] = useState({ status: 'loading', notices: [], partial: false, refreshing: false });
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setState(s => ({ ...s, refreshing: true })); // staré výsledky zůstanou vidět, než dorazí nové
    (async () => {
      try {
        const result = await loadAccountNotices(supabase, { user: { id: userId }, role });
        if (!cancelled) setState({ status: 'ready', ...result, refreshing: false });
      } catch {
        if (!cancelled) setState(s => ({ ...s, status: 'error', refreshing: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [userId, role, refreshKey]);
  return state;
};

const ChecksTab = ({ state, role, onRecheck }) => {
  const { status, notices, partial } = state;
  const hasBooks = role === ROLE_PUBLISHER || role === ROLE_ADMIN;
  const recheck = (
    <button
      type="button"
      onClick={onRecheck}
      disabled={state.refreshing}
      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
      className="px-4 py-2.5 border rounded-lg font-black uppercase text-[0.6875rem] tracking-wider cursor-pointer inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
    >
      {state.refreshing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t('Zkontrolovat znovu')}
    </button>
  );

  if (status === 'loading' && notices.length === 0) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>;
  if (status === 'error') return <div className="space-y-3"><Notice type="error">{t('Kontrolu se nepodařilo provést. Zkus to za chvíli znovu.')}</Notice>{recheck}</div>;

  return (
    <div className="space-y-3">
      <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
        {hasBooks ? t('Rychlá kontrola tvého účtu a tvých knih.') : t('Rychlá kontrola tvého účtu.')} {t('Ukazuje jen to, co můžeš opravit.')}
      </p>
      {notices.length === 0
        ? <Notice type="success">{t('Všechno je v pořádku, není co opravovat.')}</Notice>
        : notices.map(n => {
          const warn = n.level === LEVEL_WARN;
          return (
            <div
              key={n.id}
              data-testid={`notice-${n.id}`}
              style={{ borderColor: warn ? 'rgba(245,158,11,0.55)' : 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}
              className="border rounded-xl p-3 sm:p-4 flex gap-3"
            >
              <span style={{ color: warn ? '#f59e0b' : 'var(--text-muted)' }} className="shrink-0 mt-0.5" aria-hidden="true">
                {warn ? <AlertTriangle size={18} /> : <Info size={18} />}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-bold m-0 leading-snug">
                  <span className="sr-only">{warn ? t('Je potřeba opravit') : t('Tip')}: </span>{n.title}
                </p>
                <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{n.detail}</p>
                {n.items?.length > 0 && (
                  <ul className="text-xs m-0 pl-4 space-y-0.5 list-disc">
                    {n.items.map(item => <li key={item} className="break-words">{item}</li>)}
                    {n.more > 0 && <li style={{ color: 'var(--text-muted)' }} className="list-none -ml-4">{t('...a další ({n})', { n: n.more })}</li>}
                  </ul>
                )}
                {n.to && (
                  <Link
                    to={n.to}
                    style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                    className="inline-block mt-1 px-3 py-1.5 border rounded-lg no-underline text-[0.6875rem] font-black uppercase tracking-wider"
                  >
                    {t(n.linkLabel || 'Opravit')}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      {partial && <Notice type="info">{t('Část kontroly se nepodařilo načíst, výsledek proto nemusí být úplný.')}</Notice>}
      <div>{recheck}</div>
    </div>
  );
};

// ---- Záložka: Prohlídka appky ----
// Prohlídku vidí nový uživatel po prvním přihlášení sám; tady ji může kdykoli pustit znovu. Obsah upravuje správce.
const TourTab = ({ user, role }) => {
  const tour = useTour();
  const config = tour?.config;
  if (!config) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>;

  const steps = activeSteps(config, role);
  const available = config.enabled && steps.length > 0;
  const seen = readSeenVersion(user) >= config.version;

  return (
    <div className="space-y-4">
      <Section title={t('Prohlídka appky')} description={t('Krátká prohlídka ukáže, kde co najdeš. Po prvním přihlášení se spustí sama, tady ji můžeš pustit kdykoli znovu.')}>
        {available ? (
          <>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed" data-testid="tour-status">
              {t.p(steps.length, '{n} krok', '{n} kroky', '{n} kroků', { n: steps.length })} · {seen ? t('už zobrazena') : t('zatím nezobrazena')}
            </p>
            <ActionButton type="button" onClick={() => tour.start({ source: 'manual' })} data-testid="tour-start">
              <Play size={13} /> {t('Spustit prohlídku')}
            </ActionButton>
          </>
        ) : (
          <Notice type="info">{t('Prohlídka teď není k dispozici.')}</Notice>
        )}
      </Section>
    </div>
  );
};

export const SettingsPage = () => {
  const { user, role, loading } = useAuth();
  const { tab } = useParams();
  const [recheck, setRecheck] = useState(0);
  const accountNotices = useAccountNotices(user, role, `${tab}:${recheck}`);
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef(null);

  // Na úzkém displeji se menu záložek posouvá do strany - aktivní záložka musí být vždy vidět.
  // Posouvá se jen samo menu (ne celá stránka).
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, [tab, loading]);

  // Dokud se neví, jestli je uživatel přihlášený, nic nepřesměrovávat (jinak by obnovení stránky
  // na /settings/security přeskočilo na Vzhled, protože "user" je na chvíli null).
  if (loading) return <div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="animate-spin" /></div>;

  const warnCount = countWarnings(accountNotices.notices);
  const visibleTabs = TABS.filter(tb => !tb.needsUser || user); // i18n-ok: popisky záložek se překládají při vykreslení
  const active = visibleTabs.find(tb => tb.id === tab);
  if (!active) return <Navigate to={`/settings/${visibleTabs[0].id}`} replace />;

  // Přišel-li uživatel z jiné stránky, vrátí ho Zpět tam; po otevření odkazu rovnou se vrátí do aplikace.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(user ? '/app' : '/'));

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={goBack}
          aria-label={t('Zpět')}
          title={t('Zpět')}
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
          className="w-10 h-10 shrink-0 border rounded-xl cursor-pointer flex items-center justify-center hover:brightness-95 active:scale-95 transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight m-0">{t('Nastavení')}</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        <nav
          ref={navRef}
          aria-label={t('Sekce nastavení')}
          data-tour="settings-tabs"
          className="relative shrink-0 flex md:flex-col gap-1 overflow-x-auto scrollbar-hide md:w-56 md:sticky md:top-24 -mx-1 px-1 md:mx-0 md:px-0"
        >
          {visibleTabs.map(({ id, label, icon: Icon }) => {
            const isActive = id === active.id;
            return (
              <Link
                key={id}
                to={`/settings/${id}`}
                replace
                data-tour={TAB_TOUR[id]}
                aria-current={isActive ? 'page' : undefined}
                style={{
                  backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-card)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-body)',
                  borderColor: isActive ? 'transparent' : 'var(--border-color)',
                }}
                className="shrink-0 flex items-center gap-2 px-3 py-2.5 rounded-xl border no-underline text-xs font-black uppercase tracking-wider whitespace-nowrap"
              >
                <Icon size={15} /> {t(label)}
                {id === 'checks' && warnCount > 0 && (
                  <span data-testid="checks-badge" style={{ backgroundColor: '#ef4444', color: '#fff' }} className="min-w-[18px] h-[18px] px-1 rounded-full text-[0.625rem] font-black leading-[18px] text-center">
                    {warnCount}<span className="sr-only"> {t.p(warnCount, 'věc k opravě', 'věci k opravě', 'věcí k opravě')}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <section
          aria-labelledby="settings-heading"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          className="flex-1 min-w-0 border rounded-2xl shadow-sm p-4 sm:p-6"
        >
          <h2 id="settings-heading" className="text-sm font-black uppercase tracking-widest m-0 mb-4">{t(active.label)}</h2>
          {active.id === 'profile' && <ProfileTab user={user} role={role} />}
          {active.id === 'security' && <SecurityTab user={user} />}
          {active.id === 'notifications' && <InboxTab />}
          {active.id === 'checks' && <ChecksTab state={accountNotices} role={role} onRecheck={() => setRecheck(n => n + 1)} />}
          {active.id === 'tour' && <TourTab user={user} role={role} />}
          {active.id === 'appearance' && <AppearanceTab />}
          {active.id === 'reader' && <ReaderTab />}
          {active.id === 'app' && <AppTab />}
          {active.id === 'data' && <DataTab user={user} role={role} />}
        </section>
      </div>
      <p translate="no" style={{ color: 'var(--text-muted)' }} className="text-xs text-center m-0 mt-6">Jomarid Books · {APP_VERSION_LABEL}</p>
    </div>
  );
};
