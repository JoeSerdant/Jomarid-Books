import { createContext, useContext, useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export const ThemeContext = createContext(null);
export const AuthContext = createContext(null);

export const useTheme = () => useContext(ThemeContext);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
 const [user, setUser] = useState(null);
 const [role, setRole] = useState(null);
 const [loading, setLoading] = useState(true);

 async function syncProfile(sessionUser) {
   if (!sessionUser) {
     setUser(null);
     setRole(null);
     setLoading(false);
     return;
   }

   try {
     let { data, error } = await supabase
       .from('profiles')
       .select('role')
       .eq('id', sessionUser.id)
       .single();

     if (error && error.code === 'PGRST116') {
       const { data: newProfile, error: insertError } = await supabase
         .from('profiles')
         .insert([{ id: sessionUser.id, email: sessionUser.email, role: 'uživatel' }])
         .select()
         .single();
      
       if (!insertError) data = newProfile;
     }

     setUser(sessionUser);
     setRole(data?.role || 'uživatel');
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

   const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
   await supabase.auth.signOut();
 };

 return (
   <AuthContext.Provider value={{ user, role, loading, login, logout, refreshProfile: () => syncProfile(user) }}>
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

