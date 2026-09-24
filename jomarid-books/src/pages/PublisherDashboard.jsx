import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BarChart3, BookOpen, Check, Clock, Coins, Heart, Loader2, Mail, PlusCircle, ShieldCheck, UserPlus, X } from 'lucide-react';

export const PublisherDashboard = () => {
  const [myBooks, setMyBooks] = useState([]);
  const [readerProfiles, setReaderProfiles] = useState([]); 
  const [pendingRequests, setPendingRequests] = useState([]); 
  const [title, setTitle] = useState('');
  const [bookContent, setBookContent] = useState(''); // 🔥 OPRAVENO: Přejmenováno z 'content' kvůli kolizi
  const [priceCoins, setPriceCoins] = useState(150);
  const [genresInput, setGenresInput] = useState('');
  const [selectedBookId, setSelectedBookId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();

  // Pomocná funkce pro získání username z e-mailu
  const getUsername = useCallback((email) => {
    return email ? email.split('@')[0] : '';
  }, []);

  // Výpočet celkového počtu lajků nakladatele pro statistickou kartu
  const getTotalLikes = () => {
    return myBooks.reduce((sum, b) => sum + (b.likesCount || 0), 0);
  };

  const fetchPublisherBooks = useCallback(async (username) => {
    try {
      const { data, error } = await supabase
        .from('books')
        .select(`
          id, 
          title, 
          author, 
          fake_likes,
          book_likes(count)
        `)
        .eq('author', username);

      if (error) throw error;

      if (data) {
        const booksWithLikes = data.map(book => ({
          id: book.id,
          title: book.title,
          author: book.author,
          likesCount: (book.book_likes?.[0]?.count || 0) + (book.fake_likes || 0) 
        }));
        setMyBooks(booksWithLikes);
      }
    } catch (err) {
      console.error("Chyba při načítání knih nakladatele:", err.message);
    }
  }, []);

  const fetchPendingRequests = useCallback(async (username) => {
    setLoadingRequests(true);
    try {
      const { data: publisherBooks, error: booksError } = await supabase
        .from('books')
        .select('id')
        .eq('author', username);

      if (booksError) throw booksError;

      const bookIds = publisherBooks?.map(b => b.id) || [];

      if (bookIds.length === 0) {
        setPendingRequests([]);
        return;
      }

      const { data: requests, error: requestsError } = await supabase
        .from('user_books')
        .select(`
          id,
          user_id,
          book_id,
          status,
          created_at,
          profiles!user_id(email),
          books(title)
        `)
        .eq('status', 'requested')
        .in('book_id', bookIds);

      if (requestsError) throw requestsError;
      if (requests) setPendingRequests(requests);

    } catch (err) {
      console.error("Chyba při načítání žádostí:", err.message);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    if (!user) return;
    const username = getUsername(user.email);

    try {
      await Promise.all([
        fetchPublisherBooks(username),
        fetchPendingRequests(username),
        (async () => {
          const { data, error } = await supabase.from('profiles').select('id, email');
          if (!error) setReaderProfiles(data || []);
        })()
      ]);
    } catch (err) {
      console.error("Chyba při inicializaci dat dashboardu:", err.message);
    }
  }, [user, getUsername, fetchPublisherBooks, fetchPendingRequests]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const createBook = async (e) => {
    e.preventDefault();
    if (!title || !bookContent) return alert('Doplňte název a text knihy.'); // 🔥 OPRAVENO

    setIsSubmitting(true);
    const username = getUsername(user.email);

    try {
      const { data: insertedBook, error: bookError } = await supabase
        .from('books')
        .insert([{ 
          title, 
          author: username,
          fake_likes: 0,
          price_coins: Math.max(0, parseInt(priceCoins, 10) || 0),
          genres: genresInput.split(',').map(g => g.trim()).filter(Boolean)
        }])
        .select('id')
        .single();

      if (bookError) throw bookError;

      // 'content' žije v samostatné tabulce book_contents (viz saveBook v AdminDashboardu
      // pro vysvětlení proč), takže se text zapisuje sem jako druhý krok.
      const { error: contentError } = await supabase
        .from('book_contents')
        .insert([{ book_id: insertedBook.id, content: bookContent }]);
      if (contentError) throw contentError;

      if (insertedBook?.id && user?.id) {
        const { error: assignError } = await supabase
          .from('user_books')
          .insert([{ 
            user_id: user.id, 
            book_id: insertedBook.id,
            status: 'active',
            is_read: false
          }]);
        
        if (assignError) {
          console.warn("Kniha byla vytvořena, ale auto-assign selhal:", assignError.message);
        }
      }

      setTitle(''); 
      setBookContent(''); // 🔥 OPRAVENO
      setPriceCoins(150);
      setGenresInput('');
      await fetchPublisherBooks(username);
      alert('Kniha byla úspěšně publikována a hned přiřazena do Vaší knihovny!');

    } catch (error) {
      alert('Chyba při publikování: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const assignBook = async () => {
    if (!selectedBookId || !selectedUserId) return alert('Vyberte knihu a uživatele');
    
    const { error } = await supabase.from('user_books').insert([{ 
      user_id: selectedUserId, 
      book_id: selectedBookId,
      status: 'active',
      is_read: false
    }]);
    
    if (error) {
      alert('Chyba nebo uživatel již tuto knihu má: ' + error.message);
    } else {
      alert('Kniha byla úspěšně přiřazena uživateli!');
      setSelectedBookId('');
      setSelectedUserId('');
      if (user) loadAllData();
    }
  };

  const handleApproveRequest = async (requestId) => {
    const { error } = await supabase
      .from('user_books')
      .update({ status: 'active' })
      .eq('id', requestId);

    if (!error) {
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } else {
      alert('Žádost se nepodařilo schválit: ' + error.message);
    }
  };

  const handleRejectRequest = async (requestId) => {
    const { error } = await supabase
      .from('user_books')
      .delete()
      .eq('id', requestId);

    if (!error) {
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
    } else {
      alert('Žádost se nepodařilo zamítnout: ' + error.message);
    }
  };

  return (
    <div style={{ color: 'var(--text-body)' }} className="max-w-5xl mx-auto py-12 px-4 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* HLAVIČKA PANELU */}
      <div style={{ borderColor: 'var(--border-color)' }} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight m-0">Nakladatelský Panel</h2>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium mt-1 opacity-70">Správa rukopisů, autorských licencí a čtenářské komunity.</p>
        </div>
        <span style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="text-xs px-4 py-2 border rounded-xl font-bold uppercase flex items-center gap-2 shadow-sm">
          <ShieldCheck size={14} style={{ color: 'var(--bg-primary)' }} />
          <span>Vydavatel: {getUsername(user?.email)}</span>
        </span>
      </div>

      {/* MINI STATISTICKÝ PŘEHLED */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-4 flex items-center gap-4 shadow-sm border rounded-2xl">
          <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="w-12 h-12 rounded-xl flex items-center justify-center text-current">
            <BookOpen size={20} className="opacity-80" />
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0 opacity-60">Vydané svazky</p>
            <h3 className="text-xl font-black m-0">{myBooks.length}</h3>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-4 flex items-center gap-4 shadow-sm border rounded-2xl">
          <div style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--bg-primary)' }} className="w-12 h-12 rounded-xl flex items-center justify-center">
            <Heart size={20} className="fill-current" />
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0 opacity-60">Ohlasy celkem</p>
            <h3 className="text-xl font-black m-0">{getTotalLikes()} lajků</h3>
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className={`p-4 flex items-center gap-4 shadow-sm border rounded-2xl transition-all ${pendingRequests.length > 0 ? 'border-amber-500/30' : ''}`}>
          <div style={{ backgroundColor: pendingRequests.length > 0 ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-secondary)' }} className="w-12 h-12 rounded-xl flex items-center justify-center">
            <Clock size={20} className={pendingRequests.length > 0 ? "text-amber-500 animate-pulse" : "opacity-80"} />
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider m-0 opacity-60">Čekající žádosti</p>
            <h3 className={`text-xl font-black m-0 ${pendingRequests.length > 0 ? 'text-amber-500' : ''}`}>{pendingRequests.length}</h3>
          </div>
        </div>
      </div>
      
      {/* SEKCE 1: ČEKAJÍCÍ ŽÁDOSTI O LICENCE */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 shadow-md rounded-2xl border">
        <h3 style={{ color: 'var(--bg-primary)' }} className="font-black mb-4 text-base uppercase tracking-tight flex items-center gap-2">
          <Clock size={18} className={pendingRequests.length > 0 ? "animate-spin duration-1000" : ""} /> Žádosti o schválení licencí k Vašim knihám
        </h3>
        
        {loadingRequests ? (
          <div className="flex items-center gap-2 text-xs font-bold uppercase opacity-60 py-6 justify-center">
            <Loader2 className="animate-spin" size={16}/> Načítám žádosti čtenářů...
          </div>
        ) : pendingRequests.length === 0 ? (
          <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="text-center py-6 rounded-xl border border-dashed border-neutral-300/30">
            <p className="text-xs font-black uppercase opacity-50 m-0 tracking-wide">Všechny licence jsou vyřízeny. Žádný čtenář nečeká.</p>
          </div>
        ) : (
          <div style={{ borderColor: 'var(--border-color)' }} className="divide-y border rounded-xl overflow-hidden shadow-sm">
            {pendingRequests.map(req => (
              <div key={req.id} style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="flex flex-col sm:flex-row sm:justify-between sm:items-center p-4 gap-4 transition-colors hover:bg-black/5">
                <div className="flex items-start gap-3">
                  <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="w-9 h-9 rounded-lg border flex items-center justify-center opacity-70">
                    <Mail size={16} />
                  </div>
                  <div>
                    <h4 className="font-black text-sm uppercase m-0 tracking-tight">{req.books?.title}</h4>
                    <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium m-0 mt-0.5">Čtenář: <span style={{ color: 'var(--text-body)' }} className="font-bold">{req.profiles?.email || 'Neznámý uživatel'}</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button 
                    onClick={() => handleApproveRequest(req.id)}
                    style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    className="py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider border-none cursor-pointer hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <Check size={14} /> Schválit
                  </button>
                  <button 
                    onClick={() => handleRejectRequest(req.id)}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
                    className="py-2 px-3 rounded-xl text-xs font-black uppercase border cursor-pointer hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30 active:scale-95 transition-all flex items-center justify-center"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DVOUSLOUPCOVÝ EDITAČNÍ BLOK */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* FORMULÁŘ PRO NOVOU KNIHU */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 shadow-md rounded-2xl border">
          <h3 className="font-black mb-4 text-base uppercase tracking-tight flex items-center gap-2">
            <PlusCircle size={18} style={{ color: 'var(--bg-primary)' }} /> Vložit novou knihu do katalogu
          </h3>
          <form onSubmit={createBook} className="space-y-4">
            <input 
              type="text" 
              placeholder="Název knihy" 
              value={title} 
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
              className="w-full p-3.5 border rounded-xl font-bold outline-none text-sm placeholder:opacity-40 transition-all focus:border-[var(--bg-primary)]" 
              onChange={e => setTitle(e.target.value)} 
              required 
            />
            <div className="space-y-1">
              <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70 flex items-center gap-1"><Coins size={11} /> Cena licence (Jomarid Coins)</label>
              <input
                type="number"
                placeholder="Cena v mincích..."
                value={priceCoins}
                onChange={e => setPriceCoins(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                className="w-full p-3 border rounded-xl font-bold outline-none text-sm"
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
                className="w-full p-3 border rounded-xl font-bold outline-none text-sm"
              />
            </div>
            {/* 🔥 OPRAVENO: Níže upraven state bind na bookContent */}
            <textarea 
              placeholder="Sem vložte kompletní text knihy..." 
              value={bookContent} 
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
              className="w-full p-3.5 border rounded-xl font-bold outline-none resize-none text-sm placeholder:opacity-40 transition-all focus:border-[var(--bg-primary)]" 
              rows={7} 
              onChange={e => setBookContent(e.target.value)} 
              required 
            />
            <button 
              type="submit" 
              disabled={isSubmitting}
              style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              className="w-full py-3.5 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 shadow-md flex items-center justify-center gap-2"
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <><BookOpen size={14}/> Publikovat svazek</>}
            </button>
          </form>
        </div>
        
        {/* RUČNÍ PŘIŘAZENÍ LICENCE */}
        <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 shadow-md rounded-2xl border flex flex-col justify-between">
          <div>
            <h3 className="font-black mb-4 text-base uppercase tracking-tight flex items-center gap-1.5">
              <UserPlus size={18} style={{ color: 'var(--bg-primary)' }} /> Přímé přiřazení licence čtenáři
            </h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs font-medium mb-4 opacity-70">Umožňuje okamžitě darovat nebo přiřadit licenci vybranému uživateli bez nutnosti schvalovacího procesu.</p>
            
            <div className="space-y-3">
              <select 
                onChange={e => setSelectedBookId(e.target.value)} 
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                className="w-full p-3.5 border rounded-xl font-bold text-xs outline-none cursor-pointer transition-all focus:border-[var(--bg-primary)]"
                value={selectedBookId}
              >
                <option value="">-- Vyberte SVOU knihu --</option>
                {myBooks.map(b => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
              
              <select 
                onChange={e => setSelectedUserId(e.target.value)} 
                style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                className="w-full p-3.5 border rounded-xl font-bold text-xs outline-none cursor-pointer transition-all focus:border-[var(--bg-primary)]"
                value={selectedUserId}
              >
                <option value="">-- Vyberte čtenáře podle e-mailu --</option>
                {readerProfiles.map(p => ( 
                  <option key={p.id} value={p.id}>{p.email}</option>
                ))}
              </select>
            </div>
          </div>
          
          <button 
            onClick={assignBook} 
            style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }}
            className="w-full py-3.5 mt-4 rounded-xl font-black uppercase text-xs tracking-wider border-none cursor-pointer transition-all hover:opacity-90 active:scale-[0.99] shadow-md flex items-center justify-center gap-2"
          >
            <UserPlus size={14} /> Aktivovat licenci natvrdo
          </button>
        </div>
      </div>

      {/* STATISTIKY VYDANÝCH KNIH */}
      <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="p-6 shadow-md rounded-2xl border">
        <h3 className="font-black mb-4 text-base uppercase tracking-tight flex items-center gap-2">
          <BarChart3 size={18} style={{ color: 'var(--bg-primary)' }} /> Katalog Vašich děl a čtenářské ohlasy
        </h3>
        
        {myBooks.length === 0 ? (
          <div style={{ backgroundColor: 'var(--bg-secondary)' }} className="text-center py-8 rounded-xl border border-dashed border-neutral-300/30">
            <p className="text-xs font-black uppercase opacity-50 m-0 tracking-wide">Zatím jste do katalogu nevložil(a) žádné knihy.</p>
          </div>
        ) : (
          <div style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl divide-y max-h-72 overflow-y-auto shadow-sm">
            {myBooks.map(b => (
              <div key={b.id} style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="flex justify-between items-center p-4 transition-colors hover:bg-black/5">
                <div>
                  <h4 className="font-black text-sm uppercase m-0 tracking-tight">{b.title}</h4>
                  <p style={{ color: 'var(--text-muted)' }} className="text-[10px] uppercase opacity-50 font-black m-0 mt-0.5">ID svazku: {b.id}</p>
                </div>
                <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--bg-primary)', color: 'var(--bg-primary)' }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm font-black text-xs select-none">
                  <Heart size={12} className="fill-current text-current" />
                  <span>{b.likesCount}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

