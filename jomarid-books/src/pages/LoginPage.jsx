import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Button, Card } from '../components/ui';
import { AlertTriangle } from 'lucide-react';

export const LoginPage = () => {
  const [isSignUp, setIsSignUp] = useState(false); // 🔥 Přepínač Login / Registrace
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useAuth();
  const navigate = useNavigate();

  if (user) return <Navigate to="/app" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); 
    setLoading(true);

    try {
      if (isSignUp) {
        // 📝 REŽIM REGISTRACE
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signUpError) throw signUpError;

        alert('Účet úspěšně vytvořen! Nyní se můžete přihlásit.');
        setIsSignUp(false); // Přepneme uživatele zpět na login
        setPassword('');    // Vyčistíme heslo pro bezpečnost
      } else {
        // 🔑 REŽIM PŘIHLÁŠENÍ
        await login(email, password);
        navigate('/app');
      }
    } catch (err) {
      if (isSignUp) {
        setError(err.message || 'Chyba při vytváření účtu.');
      } else {
        setError('Neplatný e-mail nebo přístupové heslo.');
      }
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-sm mx-auto py-24 px-4 animate-in fade-in duration-300">
      <Card>
        {/* Dynamický nadpis podle režimu */}
        <h2 style={{ color: 'var(--text-body)' }} className="text-xl font-black text-center uppercase tracking-tight mb-6">
          {isSignUp ? 'Vytvořit nový účet' : 'Vstup do čítárny'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <input 
            type="email" 
            placeholder="E-mailová adresa" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            style={{ 
              backgroundColor: 'var(--bg-secondary)', 
              borderColor: 'var(--border-color)',
              color: 'var(--text-body)'
            }}
            className="w-full p-3 border rounded-lg text-sm font-bold outline-none transition-colors focus:style={{borderColor:'var(--bg-primary)'}} placeholder:opacity-50" 
            required 
          />
          <input 
            type="password" 
            placeholder={isSignUp ? 'Zvolte si heslo' : 'Přístupové heslo'} 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            style={{ 
              backgroundColor: 'var(--bg-secondary)', 
              borderColor: 'var(--border-color)',
              color: 'var(--text-body)'
            }}
            className="w-full p-3 border rounded-lg text-sm font-bold outline-none transition-colors focus:style={{borderColor:'var(--bg-primary)'}} placeholder:opacity-50" 
            required 
          />
          
          {error && (
            <p className="text-red-500 text-xs font-bold flex items-center gap-1 bg-red-500/10 p-2 rounded-md">
              <AlertTriangle size={12}/> {error}
            </p>
          )}
          
          {/* Dynamické tlačítko */}
          <Button type="submit" disabled={loading} className="w-full py-3 uppercase tracking-wider">
            {loading ? 'Zpracovávám...' : isSignUp ? 'Zaregistrovat se' : 'Odemknout čítárnu'}
          </Button>
        </form>

        {/* 🔥 Přepínací odkaz pod formulářem */}
        <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-4 border-t text-center">
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
            style={{ color: 'var(--bg-primary)' }}
            className="text-xs font-bold hover:underline bg-transparent border-none cursor-pointer tracking-wide uppercase"
          >
            {isSignUp ? 'Už máte účet? Přihlaste se' : 'Nemáte účet? Zaregistrujte se zde'}
          </button>
        </div>
      </Card>
    </div>
  );
};
