import { createContext, useContext, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { clearPersonalBrowseState } from '../browse/browseStore';

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
         .insert([{ id: sessionUser.id, email: sessionUser.email, role: 'uživatel' }])
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
       setRole(data?.role || 'uživatel');
       setUsername(data?.username || (sessionUser.email ? sessionUser.email.split('@')[0] : ''));
       setMustChange(!!data?.must_change_password);
     }
   } catch (catchedError) {
     console.error("Auth sync crash:", catchedError);
   } finally {
     setLoading(false);
   }
 }

 useEffect(() => {
   supabase.auth.getSession().then(({ data: { session } }) => {
     syncProfile(session?.user ?? null);
   });

   const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
     if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
     if (event === 'SIGNED_OUT') { setRecoveryMode(false); clearPersonalBrowseState(); }
     syncProfile(session?.user ?? null);
   });

   return () => subscription.unsubscribe();
 }, []);

 const login = async (email, password) => {
   const { data, error } = await supabase.auth.signInWithPassword({ email, password });
   if (error) throw error;
   return data;
 };

 const logout = async () => {
   clearPersonalBrowseState(); // hledání a filtry z knihovny nemají po odhlášení zůstat v kartě
   await supabase.auth.signOut();
 };

 // Knihovna si při odpojení ještě dopíše rozdělaný stav (poslední posun stránky), a to by přepsalo předchozí mazání.
 // Efekt rodiče se spouští až po úklidu potomků, takže tohle mazání je poslední a platí.
 useEffect(() => {
   if (!user && !loading) clearPersonalBrowseState();
 }, [user, loading]);

 return (
   <AuthContext.Provider value={{ user, role, loading, login, logout, username, mustChangePassword: mustChange, recoveryMode: recoveryMode || mustChange, clearRecovery: () => { setRecoveryMode(false); setMustChange(false); }, refreshProfile: () => syncProfile(user) }}>
     {children}
   </AuthContext.Provider>
 );
}

export const ProtectedAdminRoute = ({ children }) => {
 const { user, role, loading } = useAuth();
 if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>;
 if (!user) return <Navigate to="/login" replace />;
 if (role !== 'správce') return <Navigate to="/app" replace />;
 return children;
};

export const ProtectedUserRoute = ({ children }) => {
 const { user, loading } = useAuth();
 if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="animate-spin" /></div>;
 if (!user) return <Navigate to="/login" replace />;
 return children;
};

