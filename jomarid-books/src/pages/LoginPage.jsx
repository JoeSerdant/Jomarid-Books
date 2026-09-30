import { useEffect, useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase, validateNewPassword, mapAuthError } from '../lib/supabase';
import { Button, Card } from '../components/ui';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

const INPUT_STYLE = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const INPUT_CLASS = 'w-full p-3 border rounded-lg text-sm font-bold outline-none transition-colors placeholder:opacity-50';

const TITLES = { login: 'Vstup do čítárny', signup: 'Vytvořit nový účet', forgot: 'Obnova hesla' };
const SUBMIT_LABELS = { login: 'Odemknout čítárnu', signup: 'Zaregistrovat se', forgot: 'Poslat odkaz na e-mail' };

// Srozumitelná hláška podle toho, CO se doopravdy stalo - dřív se všechny chyby
// přihlášení schovávaly za "Neplatný e-mail nebo heslo", takže třeba nepotvrzený
// e-mail vypadal úplně stejně jako překlep v hesle.
const loginErrorText = (err) => {
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('email not confirmed')) return 'E-mail zatím není potvrzený - klikni na odkaz v potvrzovacím e-mailu.';
  if (err?.status === 429 || msg.includes('rate limit') || msg.includes('too many')) return 'Příliš mnoho pokusů. Zkus to za chvíli.';
  return 'Neplatný e-mail nebo přístupové heslo.';
};

export const LoginPage = () => {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/app" replace />;

  const switchMode = (next) => { setMode(next); setError(''); setNotice(''); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;

        // Supabase u již existujícího e-mailu (při zapnutém potvrzování) NEVRÁTÍ chybu,
        // ale "prázdného" uživatele bez identit - bez téhle kontroly by appka hlásila
        // úspěšnou registraci, i když se nic nevytvořilo.
        if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
          setError('Účet s tímto e-mailem už existuje. Přihlas se, nebo si nech poslat odkaz na obnovu hesla.');
          return;
        }
        if (!data?.session) {
          switchMode('login');
          setNotice('Účet je vytvořený. Poslali jsme ti potvrzovací e-mail - klikni na odkaz v něm a pak se přihlas.');
        }
        setPassword('');
      } else if (mode === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (resetError) throw resetError;
        // Záměrně stejná odpověď, ať účet existuje, nebo ne - jinak by šlo přes tenhle
        // formulář zjišťovat, kdo je registrovaný.
        setNotice('Pokud účet s tímto e-mailem existuje, poslali jsme na něj odkaz pro obnovu hesla. Mrkni i do spamu.');
      } else {
        await login(email, password);
        navigate('/app');
      }
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (mode === 'signup') {
        setError(msg.includes('already registered') || msg.includes('already been registered')
          ? 'Účet s tímto e-mailem už existuje. Přihlas se, nebo si nech poslat odkaz na obnovu hesla.'
          : (err.message || 'Chyba při vytváření účtu.'));
      } else if (mode === 'forgot') {
        setError(err?.status === 429 || msg.includes('rate limit') ? 'Příliš mnoho pokusů. Zkus to za chvíli.' : 'Odkaz se nepodařilo odeslat. Zkus to znovu.');
      } else {
        setError(loginErrorText(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-sm mx-auto py-24 px-4 animate-in fade-in duration-300">
      <Card>
        <h2 style={{ color: 'var(--text-body)' }} className="text-xl font-black text-center uppercase tracking-tight mb-6">{TITLES[mode]}</h2>

        {mode === 'forgot' && (
          <p style={{ color: 'var(--text-muted)' }} className="text-xs text-center mb-4 -mt-3 opacity-80">Zadej e-mail k účtu a pošleme ti odkaz pro nastavení nového hesla.</p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="email" placeholder="E-mailová adresa" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" style={INPUT_STYLE} className={INPUT_CLASS} required />
          {mode !== 'forgot' && (
            <input
              type="password"
              placeholder={mode === 'signup' ? 'Zvolte si heslo' : 'Přístupové heslo'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              style={INPUT_STYLE}
              className={INPUT_CLASS}
              required
            />
          )}

          {error && (
            <p role="alert" className="text-red-500 text-xs font-bold flex items-center gap-1 bg-red-500/10 p-2 rounded-md"><AlertTriangle size={12} /> {error}</p>
          )}
          {notice && (
            <p role="status" style={{ color: '#10b981' }} className="text-xs font-bold flex items-start gap-1 bg-emerald-500/10 p-2 rounded-md"><CheckCircle2 size={12} className="mt-0.5 shrink-0" /> {notice}</p>
          )}

          <Button type="submit" disabled={loading} className="w-full py-3 uppercase tracking-wider">
            {loading ? 'Zpracovávám...' : SUBMIT_LABELS[mode]}
          </Button>
        </form>

        <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-4 border-t text-center space-y-2">
          {mode === 'login' && (
            <button type="button" onClick={() => switchMode('forgot')} style={{ color: 'var(--text-muted)' }} className="block w-full text-xs font-bold hover:underline bg-transparent border-none cursor-pointer">
              Zapomněl jsi heslo?
            </button>
          )}
          <button
            type="button"
            onClick={() => switchMode(mode === 'signup' ? 'login' : mode === 'forgot' ? 'login' : 'signup')}
            style={{ color: 'var(--bg-primary)' }}
            className="block w-full text-xs font-bold hover:underline bg-transparent border-none cursor-pointer tracking-wide uppercase"
          >
            {mode === 'login' ? 'Nemáte účet? Zaregistrujte se zde' : mode === 'signup' ? 'Už máte účet? Přihlaste se' : 'Zpět na přihlášení'}
          </button>
        </div>
      </Card>
    </div>
  );
};

// ============================================================================
// Stránka /reset-password - nastavení nového hesla po kliknutí na odkaz z e-mailu
// ============================================================================
// Adresa se zachytí při načtení modulu - tedy dřív, než ji Supabase klient
// zpracuje a odstraní z ní tokeny. Podle ní poznáme, jestli uživatel přišel z
// e-mailového odkazu (a má tedy smysl chvíli počkat na událost PASSWORD_RECOVERY),
// nebo jestli odkaz vypršel / stránku otevřel jen tak.
const INITIAL_HASH = typeof window !== 'undefined' ? window.location.hash : '';
const INITIAL_SEARCH = typeof window !== 'undefined' ? window.location.search : '';
const CAME_FROM_RECOVERY_LINK = /type=recovery/.test(INITIAL_HASH) || /[?&]code=/.test(INITIAL_SEARCH);
const LINK_ERROR = /error_code=|error=access_denied/.test(INITIAL_HASH);
const LINK_EXPIRED = /error_code=otp_expired/.test(INITIAL_HASH);


export const ResetPasswordPage = () => {
  const { recoveryMode, clearRecovery, loading } = useAuth();
  const navigate = useNavigate();
  const [graceOver, setGraceOver] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [confPw, setConfPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setGraceOver(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const problem = validateNewPassword(newPw, confPw);
    if (problem) return setError(problem);
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
    setBusy(false);
    if (updateError) return setError(mapAuthError(updateError));
    setDone(true);
    clearRecovery();
    setTimeout(() => navigate('/app', { replace: true }), 1600);
  };

  const cancel = () => { clearRecovery(); navigate('/app', { replace: true }); };

  const wrap = (children) => (
    <div style={{ color: 'var(--text-body)' }} className="max-w-sm mx-auto py-24 px-4"><Card>{children}</Card></div>
  );

  if (done) {
    return wrap(
      <div className="text-center space-y-3">
        <CheckCircle2 size={32} style={{ color: '#10b981' }} className="mx-auto" />
        <h2 className="text-lg font-black uppercase tracking-tight m-0">Heslo je nastavené</h2>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">Za chvíli tě přesměrujeme do knihovny.</p>
      </div>
    );
  }

  if (recoveryMode) {
    return wrap(
      <>
        <h2 className="text-xl font-black text-center uppercase tracking-tight mb-2">Nové heslo</h2>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs text-center mb-5 opacity-80">Zvol si nové heslo k účtu (aspoň 8 znaků).</p>
        <form onSubmit={submit} className="space-y-4">
          <input type="password" placeholder="Nové heslo" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} style={INPUT_STYLE} className={INPUT_CLASS} required />
          <input type="password" placeholder="Nové heslo znovu" autoComplete="new-password" value={confPw} onChange={e => setConfPw(e.target.value)} style={INPUT_STYLE} className={INPUT_CLASS} required />
          {error && <p role="alert" className="text-red-500 text-xs font-bold flex items-center gap-1 bg-red-500/10 p-2 rounded-md"><AlertTriangle size={12} /> {error}</p>}
          <Button type="submit" disabled={busy} className="w-full py-3 uppercase tracking-wider">{busy ? 'Ukládám...' : 'Nastavit heslo'}</Button>
        </form>
        <button type="button" onClick={cancel} style={{ color: 'var(--text-muted)' }} className="block w-full mt-4 text-xs font-bold hover:underline bg-transparent border-none cursor-pointer">Zrušit a pokračovat bez změny</button>
      </>
    );
  }

  const stillWaiting = !LINK_ERROR && (loading || (CAME_FROM_RECOVERY_LINK && !graceOver));
  if (stillWaiting) {
    return wrap(
      <div className="text-center py-4 space-y-3">
        <Loader2 className="animate-spin mx-auto opacity-50" />
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0">Ověřuji odkaz...</p>
      </div>
    );
  }

  return wrap(
    <div className="text-center space-y-4">
      <AlertTriangle size={30} className="mx-auto text-amber-500" />
      <h2 className="text-lg font-black uppercase tracking-tight m-0">Odkaz nefunguje</h2>
      <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">
        {LINK_EXPIRED
          ? 'Odkaz pro obnovu hesla vypršel nebo už byl použit. Nech si poslat nový.'
          : 'Tenhle odkaz je neplatný, vypršel, nebo už byl použit. Nech si poslat nový.'}
      </p>
      <Link to="/login" className="inline-block no-underline"><Button type="button" className="uppercase tracking-wider">Zpět na přihlášení</Button></Link>
    </div>
  );
};
