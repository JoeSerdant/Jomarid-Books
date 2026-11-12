import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase, supabaseUrl, supabaseKey } from '../lib/supabase';
import { loginWithCode as loginWithCodeApi } from '../offline/loginCode';
import { confirmLogoutDiscard } from '../offline/index.js';
import { clearCachedProfile, clearCachedProfiles, clearStoredSession, isNetworkProblem, readCachedProfile, readStoredSession, runLogoutCleanups, writeCachedProfile } from '../offline/session';
import { purgeUserData } from '../offline/index.js';
import { accounts } from '../accounts/index.js';
import { clearPersonalBrowseState } from '../browse/browseStore';
import { cleanupOnLogout, keepPushAlive } from '../push/pushClient';
import { ROLE_READER, ROLE_ADMIN } from '../constants/roles';
import { sameEmail, normalizeEmail } from '../emailChange';

// Správce může změnit e-mail účtu, zatímco je čtenář přihlášený: relace pak nese starý e-mail, dokud se token neobnoví
// (až hodinu). Jedno obnovení to srovná (nový uživatel z relace pak přijde přes onAuthStateChange); pro stejnou dvojici
// e-mailů se zkusí jen jednou, ať se to nikdy nezacyklí.
const refreshStaleSessionEmail = (triedRef, profileEmail, sessionEmail) => {
  const pair = `${normalizeEmail(sessionEmail)}|${normalizeEmail(profileEmail)}`;
  if (triedRef.current === pair) return;
  triedRef.current = pair;
  Promise.resolve(supabase.auth.refreshSession()).catch(() => {});
};

export const ThemeContext = createContext(null);
export const AuthContext = createContext(null);

export const useTheme = () => useContext(ThemeContext);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
 const [user, setUser] = useState(null);
 const [role, setRole] = useState(null);
 const [loading, setLoading] = useState(true);
 // true, kdyz uzivatel prisel z odkazu "obnova hesla" (udalost PASSWORD_RECOVERY) -
 // App ho pak presmeruje na /reset-password, kde si nastavi nove heslo.
 const [recoveryMode, setRecoveryMode] = useState(false);
 // uzivatelske jmeno (z profilu; jinak zaklad e-mailu) a priznak "spravce vydal docasne heslo - musi si nastavit vlastni"
 const [username, setUsername] = useState('');
 const [mustChange, setMustChange] = useState(false);
 // dvojice "e-mail v relaci | e-mail v profilu", pro kterou už se obnovení relace zkusilo (aby se to nikdy nezacyklilo)
 const emailRefreshTried = useRef('');
 // true, když je čtenář přihlášený jen podle relace uložené v zařízení, protože se ji bez internetu nepodařilo obnovit (viz offline/session.js)
 const [offline, setOffline] = useState(false);
 const offlineRef = useRef(false);
 offlineRef.current = offline;

 async function syncProfile(sessionUser) {
   if (!sessionUser) {
     setUser(null);
     setRole(null);
     setUsername('');
     setMustChange(false);
     setLoading(false);
     return;
   }

   try {
     let { data, error } = await supabase
       .from('profiles')
       .select('*')
       .eq('id', sessionUser.id)
       .single();

     if (error && error.code === 'PGRST116') {
       const { data: newProfile, error: insertError } = await supabase
         .from('profiles')
         .insert([{ id: sessionUser.id, email: sessionUser.email, role: ROLE_READER }])
         .select()
         .single();
      
       if (!insertError) data = newProfile;
       error = insertError;
     }

     setUser(sessionUser);
     if (error) {
       // Profil se nepodařilo ani načíst, ani (u nového účtu) založit -
       // nejde o "nový uživatel, správně uživatel" případ, tak se role
       // nesmí potichu domýšlet. Radši čestně "neznámá" (null) - ochranné
       // route guardy to už bezpečně berou jako "ne správce", ale příště
       // se to zkusí znovu, místo aby to celou session tvrdilo špatnou roli.
       console.error('Profil se nepodařilo synchronizovat:', error);
       setRole(null);
     } else {
       setRole(data?.role || ROLE_READER);
       setUsername(data?.username || (sessionUser.email ? sessionUser.email.split('@')[0] : ''));
       setMustChange(!!data?.must_change_password);
       writeCachedProfile(sessionUser.id, { role: data?.role || ROLE_READER, username: data?.username || (sessionUser.email ? sessionUser.email.split('@')[0] : '') });
       accounts.rememberProfile(sessionUser.id, { role: data?.role || ROLE_READER, username: data?.username || (sessionUser.email ? sessionUser.email.split('@')[0] : '') }); // přepínač účtů: seznam ukáže jméno a roli i u neaktivních účtů
       if (data?.email && !sameEmail(data.email, sessionUser.email)) refreshStaleSessionEmail(emailRefreshTried, data.email, sessionUser.email);
     }
   } catch (catchedError) {
     console.error("Auth sync crash:", catchedError);
   } finally {
     setLoading(false);
   }
 }

 useEffect(() => {
   let alive = true;

   // Bez internetu se uložená relace nedá obnovit a getSession() vrátí prázdno: čtenář pak zůstane přihlášený podle uložené relace
   // (bez ní by ho appka odhlásila jen proto, že je offline). Po připojení Supabase relaci obnoví sám a přijde událost s plnou relací.
   const boot = async () => {
     let session = null;
     let err = null;
     try { const res = await supabase.auth.getSession(); session = res.data?.session ?? null; err = res.error ?? null; } catch (e) { err = e; }
     if (!alive) return;
     if (session?.user) { setOffline(false); accounts.remember(session); syncProfile(session.user); return; }
     const stored = readStoredSession(supabaseUrl);
     if (stored && ((typeof navigator !== 'undefined' && navigator.onLine === false) || isNetworkProblem(err))) {
       const cached = readCachedProfile(stored.user.id);
       setUser(stored.user);
       setRole(cached?.role ?? null);
       setUsername(cached?.username || (stored.user.email ? stored.user.email.split('@')[0] : ''));
       setMustChange(false);
       setOffline(true);
       setLoading(false);
       return;
     }
     setOffline(false);
     syncProfile(null);
   };
   boot();

   const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
     if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
     if (event === 'SIGNED_OUT') { setRecoveryMode(false); clearPersonalBrowseState(); }
     if (session?.user || event === 'SIGNED_OUT') setOffline(false);
     if (session?.user) accounts.remember(session); // přepínač účtů: relace aktivního účtu (přihlášení, obnovení tokenu) se zapamatuje, ať se na něj jde vrátit
     syncProfile(session?.user ?? null);
   });

   const onOnline = () => { if (offlineRef.current) boot(); };
   window.addEventListener('online', onOnline);

   return () => { alive = false; subscription.unsubscribe(); window.removeEventListener('online', onOnline); };
 }, []);

 const login = async (email, password) => {
   const { data, error } = await supabase.auth.signInWithPassword({ email, password });
   if (error) throw error;
   return data;
 };

 // Přihlášení přihlašovacím kódem místo hesla (Nastavení -> Zabezpečení, db/login-code.sql); dokončí ho událost SIGNED_IN
 const loginWithCode = (code) => loginWithCodeApi(supabase, { url: supabaseUrl, key: supabaseKey }, code);

 // Vlastní odhlášení účtu z Supabase a úklid zařízení (jen když na zařízení nezůstává žádný jiný účet).
 const finishLogout = async () => {
   clearPersonalBrowseState(); // hledání a filtry z knihovny nemají po odhlášení zůstat v kartě
   await runLogoutCleanups(); // stažené knihy a fronta změn nesmí po odhlášení zůstat na zařízení
   try { await cleanupOnLogout({ client: supabase, nav: navigator, win: window }); } catch (e) { console.error('Úklid oznámení při odhlášení selhal:', e); } // zařízení nemá dál dostávat oznámení odhlášeného účtu
   let failed = null;
   try { const res = await supabase.auth.signOut(); failed = res?.error ?? null; } catch (e) { failed = e; }
   if (failed) {
     // Bez internetu signOut() relaci nesmaže: odhlášení se dokončí ručně (jinak by čtenář zůstal přihlášený podle uložené relace).
     clearStoredSession(supabaseUrl);
   }
   clearCachedProfiles();
   if (failed || offlineRef.current) { setUser(null); setRole(null); setUsername(''); setMustChange(false); setOffline(false); }
 };

 // Odhlášení účtu, když je na zařízení uložený další (přepínač účtů): odhlásí se jen tenhle, úklid se týká jen jeho dat a zařízení se přepne na jiný účet.
 const logoutKeepingOthers = async (userId) => {
   clearPersonalBrowseState();
   const nextId = accounts.forgetActive(userId);
   try { await cleanupOnLogout({ client: supabase, nav: navigator, win: window }); } catch (e) { console.error('Úklid oznámení při odhlášení selhal:', e); }
   let failed = null;
   try { const res = await supabase.auth.signOut(); failed = res?.error ?? null; } catch (e) { failed = e; }
   if (failed) clearStoredSession(supabaseUrl);
   clearCachedProfile(userId);
   try { await purgeUserData(userId); } catch (e) { console.error('Úklid dat odhlášeného účtu selhal:', e); }
   const res = nextId ? await accounts.switchTo(nextId) : { ok: false };
   if (!res.ok) { setUser(null); setRole(null); setUsername(''); setMustChange(false); setOffline(false); } // jiný účet už nejde otevřít: zůstane přihlašovací stránka se seznamem uložených účtů
 };

 const logout = async () => {
   if (!(await confirmLogoutDiscard(user))) return; // neodeslané změny z offline čtení: odešlou se, nebo čtenář potvrdí, že o ně přijde
   if (user?.id && accounts.others(user.id).length > 0) { await logoutKeepingOthers(user.id); return; }
   accounts.forgetActive(user?.id);
   await finishLogout();
 };

 // Odhlášení ze všech účtů na tomto zařízení: ostatním se zneplatní relace tohoto zařízení, nic osobního nezůstane.
 const logoutAll = async () => {
   if (!(await confirmLogoutDiscard(user))) return;
   await accounts.forgetAll(user?.id);
   accounts.forgetActive(user?.id);
   await finishLogout();
 };

 // Oznámení v zařízení zůstávají zapnutá, dokud je výslovně nevypneš v Nastavení: po spuštění appky, po přihlášení nebo přepnutí na jiný účet a při návratu do appky
 // (nejvýš jednou za půl hodiny) se přihlášení k oznámením obnoví, pokud se ztratilo (Obnovit aplikaci, výměna klíčů), a zařízení se přiřadí k účtu, který právě používáš.
 // Nikdy se nevyvolá dotaz na povolení: to zůstává na Nastavení.
 useEffect(() => {
   if (!user?.id || offline || typeof document === 'undefined') return undefined;
   let last = Date.now();
   const run = () => { if (navigator.onLine !== false) keepPushAlive({ client: supabase, nav: navigator, win: window, userId: user.id }).catch(() => {}); };
   run();
   const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - last > 30 * 60 * 1000) { last = Date.now(); run(); } };
   document.addEventListener('visibilitychange', onVisible);
   return () => document.removeEventListener('visibilitychange', onVisible);
 }, [user?.id, offline]);

 // Knihovna si při odpojení ještě dopíše rozdělaný stav (poslední posun stránky), a to by přepsalo předchozí mazání.
 // Efekt rodiče se spouští až po úklidu potomků, takže tohle mazání je poslední a platí.
 useEffect(() => {
   if (!user && !loading) clearPersonalBrowseState();
 }, [user, loading]);

 return (
   <AuthContext.Provider value={{ user, role, loading, offline, login, loginWithCode, logout, logoutAll, switchAccount: accounts.switchTo, addAccount: accounts.add, removeAccount: accounts.remove, username, mustChangePassword: mustChange, recoveryMode: recoveryMode || mustChange, clearRecovery: () => { setRecoveryMode(false); setMustChange(false); }, refreshProfile: () => syncProfile(user) }}>
     {children}
   </AuthContext.Provider>
 );
}

export const ProtectedAdminRoute = ({ children }) => {
 const { user, role, loading } = useAuth();
 if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>;
 if (!user) return <Navigate to="/login" replace />;
 if (role !== ROLE_ADMIN) return <Navigate to="/app" replace />;
 return children;
};

export const ProtectedUserRoute = ({ children }) => {
 const { user, loading } = useAuth();
 if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>;
 if (!user) return <Navigate to="/login" replace />;
 return children;
};

