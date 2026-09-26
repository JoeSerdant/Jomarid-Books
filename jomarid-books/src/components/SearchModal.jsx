import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { ChevronRight, Loader2, Search, X } from 'lucide-react';

export const SearchModal = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [userBooks, setUserBooks] = useState([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (isOpen && user) {
      setLoading(true);
      
      // Bezpečné načtení dat bez nespolehlivých DB joinů
      Promise.all([
        supabase.from('books').select('id, title, author, is_auto_assigned'),
        supabase.from('user_books').select('book_id, status').eq('user_id', user.id)
      ]).then(([booksRes, userBooksRes]) => {
        const allBooks = booksRes.data || [];
        const myUserBooks = userBooksRes.data || [];
        const currentUsername = user.email ? user.email.split('@')[0] : '';

        // Stejná definice přístupu jako v UserLibrary/ReaderPage: vlastník,
        // automaticky přiřazená kniha, nebo aktivní licence - dřív se tu
        // kontrolovala jen aktivní licence, takže automatické (zdarma pro
        // všechny) knihy se ve vyhledávání vůbec neobjevily.
        const activeBooks = allBooks.filter(book => {
          const userBookEntry = myUserBooks.find(ub => ub.book_id === book.id);
          const isOwner = book.author === currentUsername;
          return isOwner || book.is_auto_assigned || userBookEntry?.status === 'active';
        });

        setUserBooks(activeBooks);
        setLoading(false);
      }).catch(err => {
        console.error("Chyba při vyhledávání:", err);
        setLoading(false);
      });
    } else { 
      setQuery(''); 
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  // Filtrování výsledků podle zadaného textu v inputu
  const filtered = userBooks.filter(b => 
    b?.title?.toLowerCase().includes(query.toLowerCase()) || 
    b?.author?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex justify-center items-start p-4 pt-20" onClick={onClose}>
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl shadow-2xl w-full max-w-xl p-6 relative flex flex-col" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 opacity-50 hover:opacity-100 cursor-pointer text-current bg-transparent border-none">
          <X size={20} />
        </button>
        <h3 className="text-sm font-black uppercase tracking-widest mb-4 opacity-60">Vyhledat v mých knihách</h3>
        <div className="relative flex items-center text-slate-800">
          <Search className="absolute left-4 opacity-40 text-current" size={20} />
          <input 
            type="text" 
            placeholder="Zadejte název díla nebo jméno autora..." 
            value={query} 
            onChange={(e) => setQuery(e.target.value)} 
            autoFocus 
            className="w-full pl-12 pr-4 py-3 border border-black/10 rounded-xl outline-none bg-black/5 text-slate-900 font-bold" 
          />
        </div>
        <div className="mt-4 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="text-center py-4 text-xs font-bold text-slate-600 flex items-center justify-center gap-2">
              <Loader2 className="animate-spin" size={14} /> Načítání katalogu...
            </div>
          ) : query.trim() === '' ? (
            <p className="text-center py-6 text-xs uppercase tracking-wider opacity-40">Našeptávač se aktivuje psaním...</p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-6 text-sm opacity-60 font-medium">Žádná z vašich schválených knih neodpovídá zadání.</p>
          ) : (
            filtered.map(book => (
              <Link 
                to={`/read/${book.id}`} 
                key={book.id} 
                onClick={onClose} 
                className="p-3 flex justify-between items-center hover:bg-black/5 transition-colors rounded-xl no-underline text-current"
              >
                <div>
                  <h4 className="font-bold text-sm text-slate-900">{book.title}</h4>
                  <p className="text-xs uppercase font-semibold opacity-50 mt-0.5">{book.author}</p>
                </div>
                <ChevronRight size={16} className="opacity-50 text-emerald-600" />
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

