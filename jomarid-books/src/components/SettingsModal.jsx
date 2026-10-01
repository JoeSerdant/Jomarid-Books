import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, User, ShieldCheck, Palette, Database, Check, Loader2, Download, BookOpen, RotateCcw } from 'lucide-react';
import { useAuth, useTheme } from '../contexts/AuthContext';
import { supabase, verifyPassword, validateNewPassword, mapAuthError } from '../lib/supabase';
import { BOOK_BADGES } from '../constants/badges';
import {
  THEMES, FONT_FAMILIES, LINE_HEIGHTS, TEXT_WIDTHS, ALIGNMENTS, LETTER_SPACINGS, PAGE_MARGINS, PAGE_BREAKS, PAGE_ANIMATIONS, MOTION_OPTIONS,
  FONT_SIZE_RANGE, AUTO_ADVANCE_RANGE, WPM_RANGE, NIGHT_RANGE,
  loadReaderPrefs, saveReaderPref, resetReaderPrefs, readerTypography, loadMotionPref, saveMotionPref,
} from '../theme';

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
    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block mb-1 opacity-80">{label}</span>
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
      className="px-4 py-2.5 rounded-lg border-none font-black uppercase text-[11px] tracking-wider cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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

// ---- Záložka: Profil ----
const ROLE_LABELS = { 'uživatel': 'Čtenář', nakladatel: 'Nakladatel', 'správce': 'Správce' };

const ProfileTab = ({ user, role }) => {
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('show_in_leaderboard, featured_badge, unlocked_badges, pen_name')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setLoadError('Profil se nepodařilo načíst.');
      else setProfile(data || { missing: true });
    })();
    return () => { cancelled = true; };
  }, [user.id]);

  const save = async (patch, label) => {
    setSaveError('');
    setSaved('');
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
    if (error) { setSaveError('Uložení se nepovedlo. Zkus to znovu.'); return; }
    setProfile(p => ({ ...p, ...patch }));
    setSaved(label);
    setTimeout(() => setSaved(''), 2200);
  };

  if (loadError) return <Notice type="error">{loadError}</Notice>;
  if (!profile) return <div className="py-10 flex justify-center"><Loader2 className="animate-spin opacity-50" /></div>;

  const unlockedIds = (profile.unlocked_badges || []).map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
  const unlocked = unlockedIds.map(id => BOOK_BADGES.find(b => b.id === id)).filter(Boolean);
  const inLeaderboard = profile.show_in_leaderboard ?? true;
  const memberSince = user.created_at ? new Date(user.created_at).toLocaleDateString('cs-CZ') : '-';
  const canEdit = !profile.missing;

  return (
    <div className="space-y-4">
      <Section title="Účet" description="Údaje o tvém účtu. E-mail se mění v záložce Zabezpečení.">
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm m-0">
          <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">E-mail</dt>
          <dd className="m-0 font-semibold break-all">{user.email}</dd>
          <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">Role</dt>
          <dd className="m-0 font-semibold">{ROLE_LABELS[role] || 'Čtenář'}</dd>
          <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">Člen od</dt>
          <dd className="m-0 font-semibold">{memberSince}</dd>
          {profile.pen_name && (
            <>
              <dt style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">Krycí jméno</dt>
              <dd className="m-0 font-semibold">
                {profile.pen_name} <Link to="/publisher" style={{ color: 'var(--bg-primary)' }} className="text-xs font-bold ml-1">upravit</Link>
              </dd>
            </>
          )}
        </dl>
        {profile.missing && <Notice type="info">Profil se ti založí při příštím přihlášení - do té doby jdou nastavit jen údaje výše.</Notice>}
      </Section>

      <Section title="Veřejná viditelnost" description="Co o tobě uvidí ostatní čtenáři.">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold m-0">Zobrazovat mě v žebříčku</p>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-0.5 opacity-80">Když vypneš, ve veřejném žebříčku nebudeš vidět.</p>
          </div>
          <Toggle checked={inLeaderboard} disabled={!canEdit} label="Zobrazovat v žebříčku" onChange={(v) => save({ show_in_leaderboard: v }, 'Viditelnost v žebříčku uložena')} />
        </div>

        <div>
          <p className="text-sm font-bold m-0 mb-1.5">Vystavený odznak</p>
          <select
            value={profile.featured_badge || ''}
            disabled={!canEdit || unlocked.length === 0}
            onChange={(e) => save({ featured_badge: e.target.value || null }, 'Odznak uložen')}
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
            className="w-full p-2.5 border rounded-lg text-sm font-semibold outline-none cursor-pointer disabled:opacity-60"
          >
            <option value="">{unlocked.length === 0 ? 'Zatím nemáš žádný odemčený odznak' : '- žádný -'}</option>
            {unlocked.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-1 opacity-80">Zobrazuje se vedle tvého jména.</p>
        </div>

        {saved && <p style={{ color: '#10b981' }} className="text-xs font-bold m-0 flex items-center gap-1"><Check size={13} /> {saved}</p>}
        {saveError && <Notice type="error">{saveError}</Notice>}
      </Section>
    </div>
  );
};

// ---- Záložka: Zabezpečení ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SecurityTab = ({ user }) => {
  const navigate = useNavigate();

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);

  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState(null);

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutMsg, setSignOutMsg] = useState(null);

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (!curPw) return setPwMsg({ type: 'error', text: 'Zadej své současné heslo.' });
    const problem = validateNewPassword(newPw, confPw, curPw);
    if (problem) return setPwMsg({ type: 'error', text: problem });
    setPwBusy(true);
    try {
      if (!(await verifyPassword(user.email, curPw))) return setPwMsg({ type: 'error', text: 'Současné heslo nesedí.' });
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) return setPwMsg({ type: 'error', text: mapAuthError(error) });
      setCurPw(''); setNewPw(''); setConfPw('');
      setPwMsg({ type: 'success', text: 'Heslo je změněné. Příště se přihlas novým.' });
    } finally { setPwBusy(false); }
  };

  const changeEmail = async (e) => {
    e.preventDefault();
    setEmailMsg(null);
    const target = newEmail.trim();
    if (!EMAIL_RE.test(target)) return setEmailMsg({ type: 'error', text: 'Zadej platný e-mail.' });
    if (target.toLowerCase() === (user.email || '').toLowerCase()) return setEmailMsg({ type: 'error', text: 'To je tvůj současný e-mail.' });
    if (!emailPw) return setEmailMsg({ type: 'error', text: 'Pro potvrzení zadej své heslo.' });
    setEmailBusy(true);
    try {
      if (!(await verifyPassword(user.email, emailPw))) return setEmailMsg({ type: 'error', text: 'Heslo nesedí.' });
      const { error } = await supabase.auth.updateUser({ email: target }, { emailRedirectTo: `${window.location.origin}/app` });
      if (error) return setEmailMsg({ type: 'error', text: mapAuthError(error) });
      setNewEmail(''); setEmailPw('');
      setEmailMsg({ type: 'success', text: `Poslali jsme potvrzení na ${target}. Změna se projeví po kliknutí na odkaz v e-mailu (podle nastavení může přijít potvrzení i na tvůj současný e-mail). Do té doby se přihlašuj dál starým.` });
    } finally { setEmailBusy(false); }
  };

  const sendResetLink = async () => {
    setResetMsg(null);
    setResetBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/reset-password` });
      if (error) return setResetMsg({ type: 'error', text: mapAuthError(error) });
      setResetMsg({ type: 'success', text: `Odkaz pro nastavení nového hesla je na cestě na ${user.email}. Mrkni i do spamu.` });
    } finally { setResetBusy(false); }
  };

  const signOutEverywhere = async () => {
    setSignOutMsg(null);
    setSignOutBusy(true);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    setSignOutBusy(false);
    if (error) return setSignOutMsg({ type: 'error', text: mapAuthError(error) });
    navigate('/login');
  };

  return (
    <div className="space-y-4">
      <Section title="Změna hesla" description="Pro jistotu napřed zadej současné heslo.">
        <form onSubmit={changePassword} className="space-y-3">
          <Field label="Současné heslo"><TextInput type="password" autoComplete="current-password" value={curPw} onChange={e => setCurPw(e.target.value)} /></Field>
          <Field label="Nové heslo (aspoň 8 znaků)"><TextInput type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} /></Field>
          <Field label="Nové heslo znovu"><TextInput type="password" autoComplete="new-password" value={confPw} onChange={e => setConfPw(e.target.value)} /></Field>
          {pwMsg && <Notice type={pwMsg.type}>{pwMsg.text}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton type="submit" busy={pwBusy}>Změnit heslo</ActionButton>
            <button type="button" onClick={sendResetLink} disabled={resetBusy} style={{ color: 'var(--bg-primary)' }} className="text-xs font-bold bg-transparent border-none cursor-pointer underline disabled:opacity-50 p-0">
              Nepamatuju si současné heslo
            </button>
          </div>
          {resetMsg && <Notice type={resetMsg.type}>{resetMsg.text}</Notice>}
        </form>
      </Section>

      <Section title="Změna e-mailu" description={`Teď se přihlašuješ přes ${user.email}. Nový e-mail je potřeba potvrdit odkazem, který na něj pošleme.`}>
        <form onSubmit={changeEmail} className="space-y-3">
          <Field label="Nový e-mail"><TextInput type="email" autoComplete="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} /></Field>
          <Field label="Tvoje heslo"><TextInput type="password" autoComplete="current-password" value={emailPw} onChange={e => setEmailPw(e.target.value)} /></Field>
          {emailMsg && <Notice type={emailMsg.type}>{emailMsg.text}</Notice>}
          <ActionButton type="submit" busy={emailBusy}>Změnit e-mail</ActionButton>
        </form>
      </Section>

      <Section title="Přihlášená zařízení" description="Odhlásí tě všude - na telefonu, v jiných prohlížečích i tady. Hodí se, když ses přihlásil na cizím zařízení.">
        {!confirmSignOut ? (
          <ActionButton variant="ghost" onClick={() => setConfirmSignOut(true)}>Odhlásit ze všech zařízení</ActionButton>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold">Opravdu odhlásit všude?</span>
            <ActionButton busy={signOutBusy} onClick={signOutEverywhere}>Ano, odhlásit</ActionButton>
            <ActionButton variant="ghost" disabled={signOutBusy} onClick={() => setConfirmSignOut(false)}>Zrušit</ActionButton>
          </div>
        )}
        {signOutMsg && <Notice type={signOutMsg.type}>{signOutMsg.text}</Notice>}
      </Section>
    </div>
  );
};

// ---- Záložka: Vzhled ----
const THEME_OPTIONS = [
  { key: 'saas', label: 'Světlý' },
  { key: 'dark', label: 'Tmavý' },
  { key: 'emerald', label: 'Dřevo a zeleň' },
];

const Segmented = ({ options, value, onChange, ariaLabel }) => (
  <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1.5">
    {Object.entries(options).map(([key, opt]) => {
      const active = value === key;
      return (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(key)}
          style={{ backgroundColor: active ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: active ? 'var(--text-primary)' : 'var(--text-body)' }}
          className="flex-1 py-2 rounded-lg border-none cursor-pointer text-xs font-bold"
        >
          {opt.label}
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

const AppearanceTab = () => {
  const { currentTheme, changeTheme } = useTheme();
  const [motion, setMotion] = useState(loadMotionPref);

  return (
    <div className="space-y-4">
      <Section title="Vzhled aplikace" description="Platí v celé appce - od knihovny přes čtečku až po minihry.">
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ key, label }) => {
            const t = THEMES[key];
            const active = currentTheme === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => changeTheme(key)}
                aria-pressed={active}
                style={{ backgroundColor: t['--bg-body'], borderColor: active ? t['--bg-primary'] : t['--border-color'], color: t['--text-body'] }}
                className={`relative rounded-xl border-2 p-2.5 cursor-pointer text-left ${active ? 'shadow-md' : ''}`}
              >
                <span style={{ backgroundColor: t['--bg-card'], borderColor: t['--border-color'] }} className="block h-9 rounded-md border mb-2 relative">
                  <span style={{ backgroundColor: t['--bg-primary'] }} className="absolute left-1.5 top-1.5 h-2 w-8 rounded-full" />
                  <span style={{ backgroundColor: t['--border-color'] }} className="absolute left-1.5 bottom-1.5 h-1.5 w-12 rounded-full" />
                </span>
                <span className="text-[11px] font-black block leading-tight">{label}</span>
                {active && <Check size={13} style={{ color: t['--bg-primary'] }} className="absolute right-2 top-2" />}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Pohyb a animace" description="Omezení vypne přechody a animace v celé aplikaci (včetně otáčení stránek ve čtečce). Hodí se při nevolnosti z pohybu i na slabších telefonech.">
        <Segmented ariaLabel="Pohyb a animace" options={MOTION_OPTIONS} value={motion} onChange={v => { saveMotionPref(v); setMotion(v); }} />
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-80">
          {motion === 'system' ? 'Řídí se nastavením zařízení („omezit pohyb“).' : motion === 'reduce' ? 'Animace jsou vypnuté.' : 'Animace jsou zapnuté bez ohledu na nastavení zařízení.'}
        </p>
      </Section>
    </div>
  );
};

// ---- Záložka: Čtečka ----
const SAMPLE_TEXT = 'Na ranním nebi se pomalu rozhořívala první hvězda. „Dnes půjdeme dál,“ řekla tiše. Nejneobyčejnější na tom všem bylo, že nikdo z nich nepochyboval o tom, že cesta vede správným směrem – a přece se každý z nich ve skrytu duše bál, že nepředstavitelně dlouhá noc teprve začíná.';

const ReaderTab = () => {
  const [prefs, setPrefs] = useState(loadReaderPrefs);
  const [resetDone, setResetDone] = useState(false);

  // Změna ze čtečky (rychlé přepínače) nebo z jiné záložky se projeví i tady.
  useEffect(() => {
    const sync = () => setPrefs(p => { const n = loadReaderPrefs(); return JSON.stringify(n) === JSON.stringify(p) ? p : n; });
    window.addEventListener('jomarid-reader-prefs', sync);
    return () => window.removeEventListener('jomarid-reader-prefs', sync);
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
      <div
        data-testid="reader-preview"
        lang={typo.lang}
        style={{ backgroundColor: previewBg, color: previewColor, borderColor: 'var(--border-color)', padding: `${Math.round(typo.padY * 0.6)}px ${typo.padX}px`, ...typo.style }}
        className={`relative overflow-hidden border rounded-xl max-h-44 sm:max-h-56 ${typo.className}`}
      >
        {SAMPLE_TEXT}
        {prefs.nightFilter > 0 && (
          <span aria-hidden="true" data-testid="night-preview" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply', backgroundColor: `rgba(255, 130, 30, ${(prefs.nightFilter / 100) * 0.45})` }} />
        )}
      </div>

      <Section title="Text" description="Ukázka nahoře se mění podle tvých voleb. Změny se hned uloží a projeví i v otevřené knize.">
        <RangeRow label="Velikost písma" valueLabel={`${prefs.fontSize} px`} min={FONT_SIZE_RANGE.min} max={FONT_SIZE_RANGE.max} value={prefs.fontSize} onChange={v => update('fontSize', v)} />
        <div><Label>Písmo</Label><Segmented ariaLabel="Písmo" options={FONT_FAMILIES} value={prefs.fontFamily} onChange={v => update('fontFamily', v)} /></div>
        <div><Label>Řádkování</Label><Segmented ariaLabel="Řádkování" options={LINE_HEIGHTS} value={prefs.lineHeight} onChange={v => update('lineHeight', v)} /></div>
        <div><Label>Zarovnání</Label><Segmented ariaLabel="Zarovnání" options={ALIGNMENTS} value={prefs.align} onChange={v => update('align', v)} /></div>
        <ToggleRow title="Dělení slov" description="Dlouhá slova se na konci řádku dělí pomlčkou (nejlíp s zarovnáním do bloku). Záleží na prohlížeči, zda umí česky." checked={prefs.hyphens} onChange={v => update('hyphens', v)} />
        <div><Label>Mezery mezi písmeny</Label><Segmented ariaLabel="Mezery mezi písmeny" options={LETTER_SPACINGS} value={prefs.letterSpacing} onChange={v => update('letterSpacing', v)} /></div>
      </Section>

      <Section title="Stránka">
        <div><Label>Tvar stránky</Label><Segmented ariaLabel="Tvar stránky" options={TEXT_WIDTHS} value={prefs.textWidth} onChange={v => update('textWidth', v)} /></div>
        <div><Label>Okraje</Label><Segmented ariaLabel="Okraje" options={PAGE_MARGINS} value={prefs.margin} onChange={v => update('margin', v)} /></div>
        <div>
          <Label>Zalamování stránek</Label>
          <Segmented ariaLabel="Zalamování stránek" options={PAGE_BREAKS} value={prefs.pageBreak} onChange={v => update('pageBreak', v)} />
          <p data-testid="page-break-hint" style={{ color: 'var(--text-muted)' }} className="text-xs m-0 mt-1.5 opacity-80 leading-relaxed">{PAGE_BREAKS[prefs.pageBreak].hint}</p>
        </div>
        <ToggleRow title="Papírový režim" description="Teplé pozadí jen pro samotný text." checked={prefs.paper} onChange={v => update('paper', v)} />
        <RangeRow label="Noční filtr" valueLabel={prefs.nightFilter === 0 ? 'vypnuto' : `${prefs.nightFilter} %`} min={NIGHT_RANGE.min} max={NIGHT_RANGE.max} step={5} value={prefs.nightFilter} onChange={v => update('nightFilter', v)} hint="Teplý odstín, který šetří oči večer. Zatmaví celou obrazovku čtečky." />
      </Section>

      <Section title="Listování">
        <div><Label>Animace otočení stránky</Label><Segmented ariaLabel="Animace otočení stránky" options={PAGE_ANIMATIONS} value={prefs.pageAnim} onChange={v => update('pageAnim', v)} /></div>
        <ToggleRow title="Listování ťuknutím" description="Levý a pravý okraj stránky listuje, střed přepíná fokus režim." checked={prefs.tapZones} onChange={v => update('tapZones', v)} />
        <ToggleRow title="Listování přejetím" description="Přejetí prstem doleva nebo doprava." checked={prefs.swipe} onChange={v => update('swipe', v)} />
        <RangeRow label="Rychlost auto-listování" valueLabel={`${prefs.autoAdvance} s / stránku`} min={AUTO_ADVANCE_RANGE.min} max={AUTO_ADVANCE_RANGE.max} value={prefs.autoAdvance} onChange={v => update('autoAdvance', v)} />
      </Section>

      <Section title="Informace při čtení">
        <ToggleRow title="Pruh postupu" description="Tenký pruh nahoře ukazuje, kolik z knihy máš přečteno." checked={prefs.showProgress} onChange={v => update('showProgress', v)} />
        <ToggleRow title="Zbývající čas a číslo stránky" checked={prefs.showMeta} onChange={v => update('showMeta', v)} />
        <RangeRow label="Rychlost čtení" valueLabel={`${prefs.wpm} slov / min`} min={WPM_RANGE.min} max={WPM_RANGE.max} step={10} value={prefs.wpm} onChange={v => update('wpm', v)} hint="Podle ní se odhaduje, kolik minut ti do konce knihy zbývá." />
        <ToggleRow title="Otevírat ve fokus režimu" description="Bez horní lišty, jen text." checked={prefs.startFocus} onChange={v => update('startFocus', v)} />
      </Section>

      <Section title="Zařízení">
        <ToggleRow title="Nechat displej svítit při čtení" description={wakeLockSupported ? 'Displej nezhasne, dokud máš otevřenou knihu.' : 'Tenhle prohlížeč to bohužel nepodporuje.'} checked={prefs.wakeLock} disabled={!wakeLockSupported} onChange={v => update('wakeLock', v)} />
      </Section>

      <div className="flex items-center gap-3 flex-wrap">
        <ActionButton variant="ghost" onClick={reset}><RotateCcw size={13} className="inline mr-1.5 -mt-0.5" />Obnovit výchozí nastavení čtečky</ActionButton>
        {resetDone && <Notice type="success">Nastavení čtečky je zpět na výchozí.</Notice>}
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

const DELETE_ERRORS = {
  admin_cannot_self_delete: 'Účet správce si sám smazat nejde - napřed předej správu jinému správci.',
  has_published_books: 'Máš vydané knihy. Napřed je smaž, nebo požádej správce o jejich převod - jinak by zůstaly bez vlastníka.',
  not_authenticated: 'Přihlášení vypršelo, přihlas se prosím znovu.',
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
      const results = await Promise.allSettled(EXPORT_SOURCES.map(s => fetchAll(s.table, s.column, user.id)));
      const data = {};
      const errors = [];
      results.forEach((r, i) => {
        const { key, table } = EXPORT_SOURCES[i];
        if (r.status === 'fulfilled') data[key] = key === 'profile' ? (r.value[0] || null) : r.value;
        else errors.push(`${table}: ${r.reason?.message || 'chyba čtení'}`);
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
        ? { type: 'info', text: `Export je stažený, ale ${errors.length} část(í) se nepodařilo načíst (najdeš je v souboru pod "errors").` }
        : { type: 'success', text: 'Export je stažený.' });
    } catch (err) {
      setExportMsg({ type: 'error', text: 'Export se nepovedl: ' + (err?.message || 'neznámá chyba') });
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
      return setDeleteMsg({ type: 'error', text: code ? DELETE_ERRORS[code] : 'Smazání se nepovedlo: ' + error.message });
    }
    // Účet už na serveru neexistuje - stačí zahodit lokální session.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    navigate('/');
  };

  return (
    <div className="space-y-4">
      <Section title="Stáhnout moje data" description="Soubor JSON se vším, co appka o tobě eviduje: profil, rozečtené knihy, záložky, zvýraznění, hodnocení, komentáře, lajky, mince i aktivita. Texty knih v něm nejsou.">
        <ActionButton busy={exportBusy} onClick={exportData}><Download size={13} /> Stáhnout data</ActionButton>
        {exportMsg && <Notice type={exportMsg.type}>{exportMsg.text}</Notice>}
      </Section>

      <Section
        danger
        title="Smazat účet"
        description="Nevratně smaže tvůj účet i všechna data: rozečtené knihy, záložky, zvýraznění, hodnocení, komentáře, mince i odznaky. Zpět to nejde vzít."
      >
        {(role === 'správce' || role === 'nakladatel') && (
          <Notice type="info">
            {role === 'správce' ? 'Účet správce si sám smazat nejde.' : 'Pokud máš vydané knihy, nejdřív je musíš smazat nebo nechat převést.'}
          </Notice>
        )}
        <Field label={`Pro potvrzení napiš svůj e-mail (${user.email})`}>
          <TextInput type="email" autoComplete="off" value={typedEmail} onChange={e => setTypedEmail(e.target.value)} placeholder={user.email} />
        </Field>
        {deleteMsg && <Notice type={deleteMsg.type}>{deleteMsg.text}</Notice>}
        <ActionButton variant="danger" busy={deleteBusy} disabled={!emailMatches} onClick={deleteAccount}>Smazat můj účet natrvalo</ActionButton>
      </Section>
    </div>
  );
};

// ---- Stránka Nastavení (/settings/:záložka) ----
// Každá záložka má vlastní adresu, takže jde sdílet odkaz, obnovit stránku a funguje tlačítko Zpět.
const TABS = [
  { id: 'profile', label: 'Profil', icon: User, needsUser: true },
  { id: 'security', label: 'Zabezpečení', icon: ShieldCheck, needsUser: true },
  { id: 'appearance', label: 'Vzhled', icon: Palette, needsUser: false },
  { id: 'reader', label: 'Čtečka', icon: BookOpen, needsUser: false },
  { id: 'data', label: 'Data a účet', icon: Database, needsUser: true },
];

export const SettingsPage = () => {
  const { user, role, loading } = useAuth();
  const { tab } = useParams();
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

  const visibleTabs = TABS.filter(t => !t.needsUser || user);
  const active = visibleTabs.find(t => t.id === tab);
  if (!active) return <Navigate to={`/settings/${visibleTabs[0].id}`} replace />;

  // Přišel-li uživatel z jiné stránky, vrátí ho Zpět tam; po otevření odkazu rovnou se vrátí do aplikace.
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(user ? '/app' : '/'));

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={goBack}
          aria-label="Zpět"
          title="Zpět"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
          className="w-10 h-10 shrink-0 border rounded-xl cursor-pointer flex items-center justify-center hover:brightness-95 active:scale-95 transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight m-0">Nastavení</h1>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        <nav
          ref={navRef}
          aria-label="Sekce nastavení"
          className="relative shrink-0 flex md:flex-col gap-1 overflow-x-auto scrollbar-hide md:w-56 md:sticky md:top-24 -mx-1 px-1 md:mx-0 md:px-0"
        >
          {visibleTabs.map(({ id, label, icon: Icon }) => {
            const isActive = id === active.id;
            return (
              <Link
                key={id}
                to={`/settings/${id}`}
                replace
                aria-current={isActive ? 'page' : undefined}
                style={{
                  backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-card)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-body)',
                  borderColor: isActive ? 'transparent' : 'var(--border-color)',
                }}
                className="shrink-0 flex items-center gap-2 px-3 py-2.5 rounded-xl border no-underline text-xs font-black uppercase tracking-wider whitespace-nowrap"
              >
                <Icon size={15} /> {label}
              </Link>
            );
          })}
        </nav>

        <section
          aria-labelledby="settings-heading"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
          className="flex-1 min-w-0 border rounded-2xl shadow-sm p-4 sm:p-6"
        >
          <h2 id="settings-heading" className="text-sm font-black uppercase tracking-widest m-0 mb-4">{active.label}</h2>
          {active.id === 'profile' && <ProfileTab user={user} role={role} />}
          {active.id === 'security' && <SecurityTab user={user} />}
          {active.id === 'appearance' && <AppearanceTab />}
          {active.id === 'reader' && <ReaderTab />}
          {active.id === 'data' && <DataTab user={user} role={role} />}
        </section>
      </div>
    </div>
  );
};
