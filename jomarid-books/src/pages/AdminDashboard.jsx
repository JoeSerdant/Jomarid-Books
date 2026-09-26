import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Button, Card } from '../components/ui';
import { Award, Coins, Database, Filter, Heart, Layout, Plus, RefreshCw, Search, Shield, ShieldAlert, Sparkles, Terminal, Trash, UserCheck, Users, XCircle } from 'lucide-react';

export const AdminDashboard = () => {
  // --- Základní stavy dat ---
  const [books, setBooks] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [logs, setLogs] = useState([]);
  const [comments, setComments] = useState([]);
  
  // --- Stavy rozhraní (UX) ---
  const [activeTab, setActiveTab] = useState('books'); // books | users | logs
  const [globalLoading, setGlobalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  
  // --- Filtry & Vyhledávání ---
  const [searchBook, setSearchBook] = useState('');
  const [searchUser, setSearchUser] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterLogType, setFilterLogType] = useState('all');

  // --- Formulářové stavy pro Knihy ---
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [fakeLikes, setFakeLikes] = useState(0); 
  const [isAutoAssigned, setIsAutoAssigned] = useState(false); 
  const [priceCoins, setPriceCoins] = useState(150); 
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
      // 1. Načtení knih
      const { data: b } = await supabase
        .from('books')
        .select('id, title, author, fake_likes, is_auto_assigned, price_coins, book_likes(count)');
        
      // 2. Načtení profilů
      const { data: p } = await supabase
        .from('profiles')
        .select('id, email, role, created_at, fake_xp, coins, unlocked_badges, featured_badge, streak_freezes, highest_goal_ever')
        .order('created_at', { ascending: false });
      
      // 3. Načtení logů
      const { data: l } = await supabase
        .from('system_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      
      // 4. Posledních 50 komentářů napříč knihami - pro moderaci (viz sekce Komentáře).
      const { data: c } = await supabase
        .from('book_comments')
        .select('id, content, author_name, book_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      // 5. Nastavení domovské stránky
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
          fake_likes: fikes,
          is_auto_assigned: book.is_auto_assigned || false,
          price_coins: book.price_coins ?? 150,
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

      setBooks(booksWithLikes); 
      setProfiles(p || []); 
      setLogs(l || []);
      setComments(mapovaneKomentare);
    } catch (err) {
      console.error("Chyba v refreshData:", err);
    } finally {
      setGlobalLoading(false);
    }
  };

  // Inicializace a real-time poslech na systémové logy
  useEffect(() => {
    refreshData();
    const sub = supabase.channel('sys_logs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_logs' }, payload => {
        setLogs(prev => [payload.new, ...prev].slice(0, 50));
      }).subscribe();
    
    return () => { supabase.removeChannel(sub); };
  }, []);

  // --- Klientské vyhledávací a filtrační procesory (useMemo) ---
  const filteredBooks = useMemo(() => {
    return books.filter(b => 
      b.title.toLowerCase().includes(searchBook.toLowerCase()) || 
      b.author.toLowerCase().includes(searchBook.toLowerCase())
    );
  }, [books, searchBook]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter(p => {
      const matchesSearch = p.email?.toLowerCase().includes(searchUser.toLowerCase());
      const matchesRole = filterRole === 'all' || (p.role || 'uživatel') === filterRole;
      return matchesSearch && matchesRole;
    });
  }, [profiles, searchUser, filterRole]);

  const filteredLogs = useMemo(() => {
    if (filterLogType === 'all') return logs;
    return logs.filter(l => l.log_type === filterLogType);
  }, [logs, filterLogType]);

  // --- Handlery akcí ---
  const saveBook = async (e) => {
    e.preventDefault();
    if (!title) return alert('Doplňte název knihy.');
    setActionLoading(true);

    // POZOR: 'content' už NENÍ sloupec v 'books' - text knihy žije v samostatné
    // tabulce 'book_contents', která má vlastní (přísnější) RLS. 'books' zůstává
    // volně čitelná pro procházení knihovny/nákup, ale bez samotného textu.
    const payload = { 
      title, 
      author: author || 'Neznámý', 
      fake_likes: parseInt(fakeLikes) || 0,
      is_auto_assigned: isAutoAssigned,
      price_coins: Math.max(0, parseInt(priceCoins, 10) || 0),
      genres: genresInput.split(',').map(g => g.trim()).filter(Boolean),
      description: descriptionInput || null
    };

    if (editingBookId) {
      const { error } = await supabase.from('books').update(payload).eq('id', editingBookId);
      if (!error) {
        const { error: contentErr } = await supabase
          .from('book_contents')
          .upsert({ book_id: editingBookId, content });
        if (contentErr) alert('Kniha uložena, ale text se nepodařilo uložit: ' + contentErr.message);
        await safeLog('SUCCESS', `Upravena kniha: ${title} (Auto-přiřazení: ${isAutoAssigned ? 'ANO' : 'NE'}, Cena: ${payload.price_coins} mincí)`);
        setEditingBookId(null);
        setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(150); setGenresInput(''); setDescriptionInput('');
        refreshData();
      } else {
        alert('Chyba při úpravě: ' + error.message);
      }
    } else {
      if (!content) { setActionLoading(false); return alert('Doplňte text knihy.'); }
      const { data: newBook, error } = await supabase.from('books').insert([payload]).select('id').single();
      if (!error && newBook) {
        const { error: contentErr } = await supabase
          .from('book_contents')
          .insert([{ book_id: newBook.id, content }]);
        if (contentErr) alert('Kniha vytvořena, ale text se nepodařilo uložit: ' + contentErr.message);
        await safeLog('SUCCESS', `Uložená nová kniha: ${title} (Auto-přiřazení: ${isAutoAssigned ? 'ANO' : 'NE'}, Cena: ${payload.price_coins} mincí)`);
        setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(150); setGenresInput(''); setDescriptionInput('');
        refreshData();
      } else {
        alert('Chyba při ukládání: ' + (error?.message || 'neznámá chyba'));
      }
    }
    setActionLoading(false);
  };

  const startEditBook = async (book) => {
    const [{ data, error }, { data: contentRow, error: contentErr }] = await Promise.all([
      supabase.from('books').select('fake_likes, is_auto_assigned, price_coins, genres, description').eq('id', book.id).single(),
      supabase.from('book_contents').select('content').eq('book_id', book.id).maybeSingle()
    ]);
    if (!error && data && !contentErr) {
      setEditingBookId(book.id);
      setTitle(book.title);
      setAuthor(book.author);
      setContent(contentRow?.content || '');
      setFakeLikes(data.fake_likes || 0);
      setIsAutoAssigned(data.is_auto_assigned || false);
      setPriceCoins(data.price_coins ?? 150);
      setGenresInput(Array.isArray(data.genres) ? data.genres.join(', ') : '');
      setDescriptionInput(data.description || '');
      setActiveTab('books'); 
    } else {
      alert('Nepodařilo se načíst kompletní text knihy k editaci.');
    }
  };

  const handleSaveFakeXp = async () => {
    if (!activeUser) return;
    let xpNum = parseInt(userFakeXpInput) || 0;
    if (xpNum >= 1000000) xpNum = 1000000;
    
    setActionLoading(true);
    const { error } = await supabase.from('profiles').update({ fake_xp: xpNum }).eq('id', activeUser.id);

    if (!error) {
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} nastaveno ${xpNum} bonusových XP.`);
      setActiveUser(prev => prev ? { ...prev, fake_xp: xpNum } : null);
      setUserFakeXpInput(xpNum);
      refreshData();
    } else {
      alert('Chyba při ukládání XP: ' + error.message);
    }
    setActionLoading(false);
  };

  const handleGrantCoins = async () => {
    if (!activeUser) return;
    const amountNum = parseInt(coinGrantInput, 10);
    if (!amountNum) return alert('Zadej nenulovou částku (záporná = odečíst).');

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_grant_coins', {
        target_user_id: activeUser.id,
        amount: amountNum,
        reason: coinGrantReason || null
      });
      if (error) throw error;
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} připsáno ${amountNum} mincí (${coinGrantReason || 'bez důvodu'}). Nový zůstatek: ${data?.new_balance}.`);
      setActiveUser(prev => prev ? { ...prev, coins: data?.new_balance } : null);
      setCoinGrantInput('');
      setCoinGrantReason('');
      refreshData();
    } catch (err) {
      alert('Připsání mincí selhalo: ' + (err.message || 'neznámá chyba'));
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
      await safeLog('SUCCESS', `Uživateli ${activeUser.email} přidán 1 Streak Freeze (nyní ${newCount}).`);
      setActiveUser(prev => prev ? { ...prev, streak_freezes: newCount } : null);
      refreshData();
    } catch (err) {
      alert('Přidání Streak Freeze selhalo: ' + (err.message || 'neznámá chyba'));
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
      await safeLog('SUCCESS', 'Aktualizován obsah domovské stránky.');
      alert('Domovská stránka uložena.');
    } catch (err) {
      alert('Uložení domovské stránky selhalo: ' + (err.message || 'neznámá chyba'));
    } finally {
      setSavingHomepage(false);
    }
  };

  const handleDeleteComment = async (commentId, preview) => {
    if (!confirm(`Smazat komentář "${preview}"?`)) return;
    try {
      const { error } = await supabase.from('book_comments').delete().eq('id', commentId);
      if (error) throw error;
      setComments(prev => prev.filter(cm => cm.id !== commentId));
      await safeLog('SUCCESS', `Smazán komentář (moderace): "${preview}"`);
    } catch (err) {
      alert('Smazání komentáře selhalo: ' + (err.message || 'neznámá chyba'));
    }
  };

  const toggleRole = async (uId, currentRole) => {
    let nextRole = 'uživatel';
    if (currentRole === 'uživatel') nextRole = 'nakladatel';
    else if (currentRole === 'nakladatel') nextRole = 'správce';
    else if (currentRole === 'správce') nextRole = 'uživatel';

    const { error } = await supabase.from('profiles').update({ role: nextRole }).eq('id', uId);
    if (!error) {
      await safeLog('WARN', `Změna role uživatele ${uId} na ${nextRole}`);
      refreshData();
    } else {
      alert('Chyba při změně role: ' + error.message);
    }
  };

  const toggleBookAutoAssign = async (bookId, currentStatus) => {
    setActionLoading(true);
    const { error } = await supabase
      .from('books')
      .update({ is_auto_assigned: !currentStatus })
      .eq('id', bookId);

    if (!error) {
      await safeLog('SUCCESS', `Změněn status automatického přidělení pro Knihu ID: ${bookId}`);
      refreshData();
    } else {
      alert('Chyba při změně auto-assign stavu: ' + error.message);
    }
    setActionLoading(false);
  };

  const revokeAllLicenses = async (uId, uEmail) => {
    if (!confirm(`🚨 OPRAVDU CHCETE ODEBRAT VŠECHNY LICENCE uživateli ${uEmail}? Uživatel ztratí přístup ke všem knihám.`)) return;
    setActionLoading(true);
    const { error } = await supabase.from('user_books').delete().eq('user_id', uId);
    if (!error) {
      await safeLog('WARN', `Kompletní revokace licencí pro uživatele: ${uEmail}`);
      alert('Všechny přístupy byly smazány.');
      refreshData();
    } else {
      alert('Chyba při odebírání: ' + error.message);
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
      alert('Chyba při přiřazování licence: ' + error.message);
    } else {
      await safeLog('SUCCESS', `Přiřazena aktivní kniha uživateli ${activeUser.email}`);
      setSelectedBookId('');
      refreshData();
    }
    setActionLoading(false);
  };

  const assignAllBooksToUser = async () => {
    if (!activeUser || books.length === 0) return;
    if (!confirm(`Opravdu chcete uživateli ${activeUser.email} okamžitě odemknout ÚPLNĚ VŠECHNY knihy?`)) return;

    setActionLoading(true);
    try {
      const { data: existingUserBooks, error: fetchError } = await supabase.from('user_books').select('book_id, id, status').eq('user_id', activeUser.id);
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

      await safeLog('SUCCESS', `Hromadně aktivovány VŠECHNY knihy pro: ${activeUser.email}`);
      refreshData();
    } catch (err) {
      alert('Chyba: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const assignSelectedBookToAllUsers = async () => {
    if (!selectedBookId) return alert('Nejprve zvolte knihu z rozevíracího seznamu.');
    const selectedBook = books.find(b => b.id === selectedBookId);
    if (!selectedBook) return;
    if (profiles.length === 0) return alert('V systému nejsou žádní uživatelé.');
    if (!confirm(`🚨 Opravdu chcete knihu "${selectedBook.title}" IHNED aktivovat VŠEM registrovaným čtenářům?`)) return;

    setActionLoading(true);
    try {
      const { data: alreadyHasBook, error: fetchError } = await supabase.from('user_books').select('user_id, id, status').eq('book_id', selectedBookId);
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

      await safeLog('SUCCESS', `Kniha "${selectedBook.title}" byla globálně aktivována všem uživatelům.`);
      setSelectedBookId('');
      refreshData();
    } catch (err) {
      alert('Chyba při hromadném sdílení: ' + err.message);
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
            <Shield size={26} className="text-red-500 animate-pulse" /> Core Admin Panel 2026
          </h1>
          <p className="text-xs font-semibold opacity-70" style={{ color: 'var(--text-muted)' }}>
            Komplexní správa licencí, autorských práv, uživatelských klanů a systémových logů.
          </p>
        </div>
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <Button 
            onClick={refreshData} 
            disabled={globalLoading || actionLoading}
            variant="secondary"
            className="flex items-center justify-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-wider border rounded-lg hover:opacity-80 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={14} className={globalLoading ? "animate-spin" : ""} /> Sync Data
          </Button>
        </div>
      </div>

      {/* STATISTICKÉ UKAZATELE */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="flex items-center gap-4 py-4 relative overflow-hidden">
          <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500"><Database size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-60">Katalog Titulů</h4>
            <p className="text-xl font-black">{books.length} Knih v DB</p>
          </div>
        </Card>
        <Card style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex items-center gap-4 py-4">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-500"><Users size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-60">Komunita</h4>
            <p className="text-xl font-black">{profiles.length} Čtenářů</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500"><Terminal size={22}/></div>
          <div>
            <h4 style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-60">Live Stream Log</h4>
            <p className="text-xl font-black">{logs.length} Záznamů</p>
          </div>
        </Card>
      </div>

      {/* TAB NAVIGACE */}
      <div className="flex border-b font-black text-xs uppercase tracking-wider space-x-1" style={{ borderColor: 'var(--border-color)' }}>
        {[
          { id: 'books', label: 'Knihovna & Editace', icon: <Database size={14} /> },
          { id: 'homepage', label: 'Domovská stránka', icon: <Layout size={14} /> },
          { id: 'users', label: 'Uživatelé & Licence', icon: <Users size={14} /> },
          { id: 'logs', label: 'Systémový Syslog', icon: <Terminal size={14} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchBook(''); }}
            style={{ 
              backgroundColor: activeTab === tab.id ? 'var(--bg-secondary)' : 'transparent',
              borderColor: activeTab === tab.id ? 'var(--border-color)' : 'transparent',
              color: activeTab === tab.id ? 'var(--bg-primary)' : 'var(--text-muted)'
            }}
            className={`flex items-center gap-2 px-4 py-3 border-t border-x rounded-t-xl transition-all cursor-pointer -mb-[1px]`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* INDIKÁTOR AKČNÍHO LOADINGU */}
      {actionLoading && (
        <div className="w-full bg-yellow-500 text-black text-center text-xs font-black py-1 rounded animate-pulse uppercase tracking-widest">
          Probíhá zápis do databáze Supabase... Čekejte prosím.
        </div>
      )}

      {/* 2. ZÁLOŽKA: SPRÁVA KNIH */}
      {activeTab === 'books' && (
        <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <Card>
              <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
                {editingBookId ? <ShieldAlert size={16} className="text-yellow-500"/> : <Plus size={16}/>}
                {editingBookId ? 'Upravit digitální titul' : 'Registrovat nový digitální titul'}
              </h3>
              <form onSubmit={saveBook} className="space-y-3">
                <input 
                  type="text" 
                  placeholder="Přesný název knihy..." 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none placeholder:opacity-40" 
                  required 
                />
                <input 
                  type="text" 
                  placeholder="Autor / Vydavatel..." 
                  value={author} 
                  onChange={e => setAuthor(e.target.value)} 
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none placeholder:opacity-40" 
                />
                
                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Umělá Prestiž (Počet Fake Lajků)</label>
                  <input 
                    type="number" 
                    placeholder="Počet lajků..." 
                    value={fakeLikes} 
                    onChange={e => setFakeLikes(Math.max(0, parseInt(e.target.value) || 0))} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70 flex items-center gap-1"><Coins size={11} /> Cena licence (Jomarid Coins)</label>
                  <input 
                    type="number" 
                    placeholder="Cena v mincích..." 
                    value={priceCoins} 
                    onChange={e => setPriceCoins(Math.max(0, parseInt(e.target.value) || 0))} 
                    disabled={isAutoAssigned}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none disabled:opacity-40" 
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
                    className="w-full p-3 border rounded-lg text-sm font-bold outline-none" 
                  />
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Popis (pro nákupní/detailní obrazovku)</label>
                  <textarea
                    placeholder="Krátký popis, co čtenáře čeká - zobrazí se v detailu knihy před koupí..."
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
                  <label htmlFor="is_auto_assigned" className="text-[10px] font-black uppercase tracking-wide cursor-pointer select-none flex items-center gap-1.5">
                    <Sparkles size={12} className="text-yellow-500 fill-current" /> Automatická kniha (Přiřadit všem zdarma)
                  </label>
                </div>

                <div className="space-y-1">
                  <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Obsah a Text knihy</label>
                  <textarea 
                    placeholder="Sem vložte čistý text knihy, kapitoly nebo markdown..." 
                    value={content} 
                    onChange={e => setContent(e.target.value)} 
                    rows={8} 
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-3 border rounded-lg text-sm font-medium outline-none resize-none font-mono placeholder:opacity-40" 
                    required 
                  />
                </div>
                
                <Button type="submit" disabled={actionLoading} className="w-full py-3 uppercase tracking-wider font-black">
                  {editingBookId ? '💾 Aktualizovat data v DB' : '🚀 Vydat knihu do oběhu'}
                </Button>

                {editingBookId && (
                  <button 
                    type="button" 
                    onClick={() => { setEditingBookId(null); setTitle(''); setAuthor(''); setContent(''); setFakeLikes(0); setIsAutoAssigned(false); setPriceCoins(150); setGenresInput(''); }}
                    style={{ color: 'var(--text-muted)' }}
                    className="w-full py-2 text-xs hover:underline uppercase cursor-pointer bg-transparent border-none font-bold tracking-wide"
                  >
                    Stornovat úpravy
                  </button>
                )}
              </form>
            </Card>
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="flex gap-2 items-center p-2 rounded-xl border border-solid" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
              <Search size={16} className="opacity-60 ml-2 shadow-sm shrink-0" />
              <input 
                type="text"
                placeholder="Filtrovat knihy podle názvu či autora..."
                value={searchBook}
                onChange={e => setSearchBook(e.target.value)}
                className="w-full bg-transparent border-none outline-none font-bold text-xs p-1"
              />
              {searchBook && <button onClick={() => setSearchBook('')} className="text-xs px-2 opacity-50 hover:opacity-100 font-bold">X</button>}
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="p-4 border-b font-black text-xs uppercase tracking-wider flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
                <span>Inventář titulů (Katalog aplikací)</span>
                <span className="opacity-60">{filteredBooks.length} nalezeno</span>
              </div>
              <div className="p-2 max-h-[500px] overflow-y-auto space-y-1.5">
                {filteredBooks.length === 0 ? (
                  <p className="text-xs font-bold text-center py-8 italic opacity-50">Žádné knihy neodpovídají vyhledávacímu dotazu.</p>
                ) : (
                  filteredBooks.map(b => (
                    <div key={b.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex justify-between items-center p-3 rounded-xl text-xs font-bold gap-4 hover:opacity-95 transition-opacity">
                      <span className="truncate flex-1">
                        <span className="text-sm font-black block truncate flex items-center gap-1.5">
                          {b.title}
                          {b.is_auto_assigned && (
                            <span className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide flex items-center gap-0.5">
                              <Sparkles size={10} className="fill-current" /> Auto
                            </span>
                          )}
                          {!b.is_auto_assigned && (
                            <span className="bg-amber-500/20 text-amber-500 font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide flex items-center gap-0.5">
                              <Coins size={10} /> {b.price_coins ?? 150}
                            </span>
                          )}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }} className="opacity-70 font-medium">Autor: {b.author}</span>
                      </span>
                      
                      <div style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--bg-secondary)' }} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] shrink-0 font-black shadow-sm">
                        <Heart size={10} className="fill-current" />
                        <span>{b.likesCount}</span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <button 
                          onClick={() => startEditBook(b)}
                          style={{ color: 'var(--bg-primary)' }}
                          className="bg-transparent border-none cursor-pointer hover:scale-110 transition-transform font-bold text-base"
                          title="Editovat parametry a text"
                        >
                          ✎
                        </button>
                        <button 
                          onClick={async () => { 
                            if(confirm(`Smazat knihu "${b.title}" natvrdo z DB? Tato akce smaže i existující uživatelské licence!`)) { 
                              await supabase.from('books').delete().eq('id', b.id); 
                              await safeLog('DANGER', `Smazána kniha z databáze: ${b.title}`);
                              refreshData(); 
                            } 
                          }} 
                          style={{ color: 'var(--text-muted)' }}
                          className="bg-transparent border-none cursor-pointer hover:text-red-500 hover:scale-110 transition-all flex items-center"
                          title="Smazat titul z DB"
                        >
                          <Trash size={14}/>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b font-black text-xs uppercase tracking-wider flex justify-between items-center" style={{ borderColor: 'var(--border-color)' }}>
            <span>Moderace komentářů (posledních 50 napříč knihami)</span>
            <span className="opacity-60">{comments.length} nalezeno</span>
          </div>
          <div className="p-2 max-h-80 overflow-y-auto space-y-1.5">
            {comments.length === 0 ? (
              <p className="text-xs font-bold text-center py-8 italic opacity-50">Zatím žádné komentáře.</p>
            ) : (
              comments.map(cm => (
                <div key={cm.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="flex justify-between items-center p-3 rounded-xl text-xs font-bold gap-4">
                  <span className="truncate flex-1">
                    <span style={{ color: 'var(--bg-primary)' }} className="font-black block truncate">{cm.author_name} <span style={{ color: 'var(--text-muted)' }} className="font-medium opacity-70">na {cm.bookTitle}</span></span>
                    <span style={{ color: 'var(--text-body)' }} className="opacity-90 font-medium">{cm.content}</span>
                  </span>
                  <button
                    onClick={() => handleDeleteComment(cm.id, cm.content)}
                    style={{ color: 'var(--text-muted)' }}
                    className="bg-transparent border-none cursor-pointer hover:text-red-500 hover:scale-110 transition-all flex items-center shrink-0"
                    title="Smazat komentář"
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

      {/* 2b. ZÁLOŽKA: DOMOVSKÁ STRÁNKA */}
      {activeTab === 'homepage' && (
        <div className="space-y-6">
          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Layout size={16} /> Hlavní nadpis a podtext
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Nadpis (hero)</label>
                <input
                  type="text"
                  value={hpHeadline}
                  onChange={e => setHpHeadline(e.target.value)}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Podtext</label>
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
              <Sparkles size={16} /> Doporučené tituly na domovské stránce
            </h3>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs mb-4 opacity-70">
              Zaškrtni, které knihy se mají zobrazit v sekci "Hlavní tituly". Nezáleží na pořadí zaškrtnutí.
            </p>
            <div style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl divide-y max-h-64 overflow-y-auto">
              {books.length === 0 ? (
                <p className="text-xs font-bold text-center py-6 opacity-50">Zatím žádné knihy v katalogu.</p>
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
                    <span style={{ color: 'var(--text-muted)' }} className="text-[10px] opacity-60 shrink-0 ml-auto">{b.author}</span>
                  </label>
                ))
              )}
            </div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[10px] mt-2 opacity-60">{hpFeaturedBookIds.length} vybráno</p>
          </Card>

          <Card>
            <h3 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center gap-2">
              <Award size={16} /> Ukázka pro demo velikosti písma
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Ukázkový text</label>
                <textarea
                  value={hpFontQuote}
                  onChange={e => setHpFontQuote(e.target.value)}
                  rows={3}
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="w-full p-3 border rounded-lg text-sm font-bold outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider block pl-1 opacity-70">Odkud je ukázka (zobrazí se pod textem)</label>
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
              <ShieldAlert size={16} /> Proč číst tady (4 důvody)
            </h3>
            <div className="space-y-4">
              {hpWhyRead.map((item, idx) => (
                <div key={idx} style={{ borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 space-y-2">
                  <input
                    type="text"
                    placeholder={`Důvod ${idx + 1} - titulek`}
                    value={item.title}
                    onChange={e => updateWhyReadItem(idx, 'title', e.target.value)}
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                    className="w-full p-2.5 border rounded-lg text-xs font-bold outline-none"
                  />
                  <textarea
                    placeholder="Popis"
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
            {savingHomepage ? 'Ukládám...' : 'Uložit domovskou stránku'}
          </button>
        </div>
      )}

      {/* 3. ZÁLOŽKA: UŽIVATELÉ A LICENCE */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex gap-2 items-center p-2 rounded-xl border border-solid" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
                <Search size={16} className="opacity-60 ml-2 shrink-0" />
                <input 
                  type="text"
                  placeholder="Hledat uživatele podle e-mailu..."
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
                  <option value="all">Všechny role</option>
                  <option value="uživatel">Uživatelé</option>
                  <option value="nakladatel">Nakladatelé</option>
                  <option value="správce">Správci</option>
                </select>
              </div>
            </div>

            <Card className="overflow-hidden p-0">
              <div style={{ borderColor: 'var(--border-color)' }} className="p-4 border-b font-black text-xs uppercase tracking-wider">
                Databáze čtenářských účtů a oprávnění
              </div>
              <div className="max-h-[450px] overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }} className="font-black uppercase border-b opacity-80 sticky top-0 z-10">
                      <th className="p-3">Uživatel</th>
                      <th className="p-3">Role systému</th>
                      <th className="p-3 text-right">Řízení</th>
                    </tr>
                  </thead>
                  <tbody style={{ borderColor: 'var(--border-color)' }} className="divide-y">
                    {filteredProfiles.map(p => (
                      <tr key={p.id} style={{ borderColor: 'var(--border-color)' }} className={`hover:bg-[var(--bg-secondary)] transition-colors font-bold ${activeUser?.id === p.id ? "bg-[var(--bg-secondary)] ring-1 ring-inset ring-blue-500/30" : ""}`}>
                        <td className="p-3 truncate max-w-[200px]">
                          <div className="truncate text-sm font-black">{p.email}</div>
                          {p.fake_xp > 0 && (
                            <div className="text-[10px] font-black flex items-center gap-1 mt-0.5" style={{ color: 'var(--bg-primary)' }}>
                              <Award size={10}/> {p.fake_xp >= 1000000 ? "Level 100 (Max)" : `+${p.fake_xp} Admin XP`}
                            </div>
                          )}
                        </td>
                        <td className="p-3 align-middle">
                          <span 
                            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }} 
                            className={`text-[9px] px-2.5 py-0.5 rounded-full uppercase border border-solid font-black shadow-sm tracking-wider`}
                          >
                            {p.role || 'uživatel'}
                          </span>
                        </td>
                        <td className="p-3 text-right flex justify-end items-center gap-2">
                          <Button 
                            variant={activeUser?.id === p.id ? "success" : "secondary"} 
                            onClick={() => { setActiveUser(p); setUserFakeXpInput(p.fake_xp || 0); }} 
                            className="text-[10px] px-2.5 py-1 uppercase flex items-center gap-1 font-black"
                          >
                            <Plus size={10}/> Vybrat
                          </Button>
                          <Button 
                            variant="secondary"
                            onClick={() => toggleRole(p.id, p.role)} 
                            className="p-1.5 border border-solid rounded-lg cursor-pointer" 
                            title="Cyklovat roli (Uživatel -> Nakladatel -> Správce)"
                          >
                            <Shield size={13}/>
                          </Button>
                          <Button 
                            variant="secondary"
                            onClick={() => revokeAllLicenses(p.id, p.email)} 
                            className="p-1.5 text-red-400 border border-solid border-red-500/20 rounded-lg hover:bg-red-500/10 cursor-pointer" 
                            title="Kompletní revokace (Smazat všechny licence uživatele)"
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
                <UserCheck size={18}/> Správce distribuce a oprávnění
              </h3>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider block opacity-70">1. Vyberte knihu z registru</label>
                  
                  {/* Vyhledávací a filtrovací pole pro rychlé prohledávání registru knih */}
                  <div className="flex gap-2 items-center p-2 mb-1.5 rounded-lg border border-solid bg-[var(--bg-primary)]" style={{ borderColor: 'var(--border-color)' }}>
                    <Search size={14} className="opacity-50 ml-1 shrink-0" />
                    <input 
                      type="text"
                      placeholder="Rychlý filtr knih (název / autor)..."
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
                      -- ({filteredBooks.length}) Titulů odpovídá filtru --
                    </option>
                    {filteredBooks.map(b => (
                      <option key={b.id} value={b.id} style={{ background: 'var(--bg-secondary)' }}>
                        {b.title} ({b.author})
                      </option>
                    ))}
                  </select>
                </div>

                {/* MODUL PRO UKÁZKU A PŘEPÍNÁNÍ AUTO-ASSIGNU VYBRANÉ KNIHY */}
                {selectedBookId && currentSelectedBook && (
                  <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl border border-solid flex items-center justify-between gap-4 animate-in fade-in duration-150">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider block flex items-center gap-1">
                        <Sparkles size={11} className="text-yellow-500 fill-current"/> Auto-Assign globální příznak
                      </span>
                      <span className="text-[9px] opacity-50 block font-bold">Přidělí se automaticky každému čtenáři</span>
                    </div>
                    <Button
                      variant={currentSelectedBook.is_auto_assigned ? "success" : "secondary"}
                      onClick={() => toggleBookAutoAssign(currentSelectedBook.id, currentSelectedBook.is_auto_assigned)}
                      disabled={actionLoading}
                      className="text-[10px] px-3 py-1.5 font-black uppercase tracking-wider shrink-0"
                    >
                      {currentSelectedBook.is_auto_assigned ? "✨ Aktivní" : "Vypnuto"}
                    </Button>
                  </div>
                )}

                <Button 
                  onClick={assignSelectedBookToAllUsers}
                  variant="purple"
                  disabled={actionLoading || !selectedBookId}
                  className="w-full text-xs py-2.5 uppercase tracking-wider font-black shadow-md flex items-center justify-center gap-1"
                >
                  📢 Globální odemčení této knihy VŠEM čtenářům
                </Button>
                
                {activeUser ? (
                  <div style={{ borderColor: 'var(--border-color)' }} className="mt-4 pt-4 border-t border-solid space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/20">
                      <p className="text-xs font-bold text-blue-400 truncate m-0">Target: <span className="font-black text-sm">{activeUser.email}</span></p>
                    </div>
                    
                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-80 block">
                        Modifikátor bonusových XP (Úroveň Profilu)
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={userFakeXpInput} 
                          onChange={e => setUserFakeXpInput(parseInt(e.target.value) || 0)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="w-full p-2 border rounded-lg text-xs font-bold outline-none font-mono" 
                          placeholder="Množství XP..."
                        />
                        <button 
                          onClick={handleSaveFakeXp}
                          disabled={actionLoading}
                          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 font-black text-[10px] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity shrink-0 active:scale-95 duration-100"
                        >
                          Uložit XP
                        </button>
                      </div>
                      <span className="text-[9px] opacity-40 font-bold block">* Zadejte hodnotu ≥ 1 000 000 pro okamžitý skok na Level 100.</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-80 flex items-center gap-1">
                        <Coins size={11} /> Připsat / odečíst Jomarid Coins (funguje i na tvůj vlastní účet)
                      </label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={coinGrantInput} 
                          onChange={e => setCoinGrantInput(e.target.value)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="w-24 p-2 border rounded-lg text-xs font-bold outline-none font-mono" 
                          placeholder="±počet"
                        />
                        <input 
                          type="text" 
                          value={coinGrantReason} 
                          onChange={e => setCoinGrantReason(e.target.value)}
                          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                          className="flex-1 p-2 border rounded-lg text-xs font-bold outline-none" 
                          placeholder="Důvod (volitelné)..."
                        />
                        <button 
                          onClick={handleGrantCoins}
                          disabled={actionLoading || !coinGrantInput}
                          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 font-black text-[10px] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity shrink-0 active:scale-95 duration-100 disabled:opacity-40"
                        >
                          Připsat
                        </button>
                      </div>
                      <span className="text-[9px] opacity-40 font-bold block">* Zůstatek {activeUser.coins ?? 0} 🪙. Záporné číslo strhne mince (nejníž na 0), loguje se to do coin_transactions.</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }} className="p-3 rounded-xl space-y-2 border border-solid">
                      <label style={{ color: 'var(--text-muted)' }} className="text-[10px] font-black uppercase tracking-wider opacity-80 flex items-center gap-1">
                        <Award size={11} /> Herní postup (jen pro přehled)
                      </label>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
                        <span style={{ color: 'var(--text-muted)' }}>Odznaky: <span style={{ color: 'var(--text-body)' }}>{(activeUser.unlocked_badges || []).length} / 100</span></span>
                        <span style={{ color: 'var(--text-muted)' }}>Nejvyšší cíl: <span style={{ color: 'var(--text-body)' }}>{activeUser.highest_goal_ever ?? 5}</span></span>
                        <span style={{ color: 'var(--text-muted)' }} className="col-span-2">Vlajkový odznak: <span style={{ color: 'var(--text-body)' }}>{activeUser.featured_badge || '—'}</span></span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>Streak Freeze: <span style={{ color: 'var(--text-body)' }}>{activeUser.streak_freezes ?? 0}</span></span>
                        <button
                          onClick={handleGrantStreakFreeze}
                          disabled={actionLoading}
                          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
                          className="px-3 py-1.5 font-black text-[10px] uppercase rounded-lg border border-solid cursor-pointer hover:opacity-80 transition-opacity active:scale-95 duration-100 disabled:opacity-40"
                        >
                          +1 Freeze
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
                        Aktivovat zvolenou knihu
                      </button>
                      <Button variant="secondary" onClick={() => setActiveUser(null)} className="text-xs py-2.5 font-bold">Zrušit výběr</Button>
                    </div>
                    
                    <Button 
                      onClick={assignAllBooksToUser}
                      disabled={actionLoading}
                      variant="success"
                      className="w-full text-xs py-2.5 uppercase tracking-wider font-black shadow-sm"
                    >
                      ✨ Full Unlock: Aktivovat mu VŠECHNY knihy z databáze
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs font-bold opacity-50 italic border border-dashed rounded-xl p-4" style={{ borderColor: 'var(--border-color)' }}>
                    Pro individuální přidělení licencí nebo zápis XP vyberte uživatele ze sousední tabulky.
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* 4. ZÁLOŽKA: SYSTÉMOVÉ LOGY (FULL CORE SYSLOG) */}
      {activeTab === 'logs' && (
        <Card className="bg-slate-950 text-emerald-400 font-mono p-5 border border-slate-900 shadow-2xl rounded-2xl space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs font-black uppercase tracking-widest pb-3 border-b border-solid border-slate-900 gap-2">
            <span className="flex items-center gap-1.5 text-slate-400"><Terminal size={14} /> Postgres Live Core Syslog</span>
            <div className="flex gap-2 items-center bg-slate-900 p-1.5 rounded-xl border border-slate-800 self-stretch sm:self-auto">
              <span className="text-slate-500 pl-1 text-[10px]">Filtr eventu:</span>
              <select 
                value={filterLogType} 
                onChange={e => setFilterLogType(e.target.value)}
                className="bg-transparent border-none text-emerald-400 font-mono outline-none text-xs cursor-pointer"
              >
                <option value="all">VŠECHNY LOGY</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="WARN">WARN</option>
                <option value="DANGER">DANGER</option>
              </select>
            </div>
          </div>

          <div className="max-h-[500px] overflow-y-auto space-y-1.5 pr-2 font-mono text-xs scrollbar-thin scrollbar-thumb-slate-800">
            {filteredLogs.length === 0 ? (
              <p className="text-slate-500 italic text-center py-12">Žádné systémové logy v zadané konfiguraci nebyly zachyceny.</p>
            ) : (
              filteredLogs.map((log, index) => {
                let badgeColor = "text-emerald-400";
                if (log.log_type === 'WARN') badgeColor = "text-yellow-400";
                if (log.log_type === 'DANGER' || log.log_type === 'ERROR') badgeColor = "text-red-500 font-extrabold";
                
                return (
                  <div key={log.id || index} className="py-1.5 border-b border-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-1 hover:bg-slate-900/30 px-1 rounded transition-colors">
                    <span className="break-all">
                      <span className={`inline-block w-20 uppercase font-black ${badgeColor}`}>[{log.log_type || 'INFO'}]</span>
                      <span className="text-slate-200">{log.message}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0 font-sans sm:font-mono">
                      {log.created_at ? new Date(log.created_at).toLocaleString('cs-CZ') : 'Nyní'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div className="text-[10px] text-slate-500 pt-2 border-t border-slate-900 text-right">
            Kanál Real-time Event Stream přes WebSockets [Aktivní]
          </div>
        </Card>
      )}

    </div>
  );
};


