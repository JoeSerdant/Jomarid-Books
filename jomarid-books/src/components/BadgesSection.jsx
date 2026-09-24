import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BOOK_BADGES } from '../constants/badges';
import { Award, Calendar, CheckCircle, ChevronRight, Coins, Flame, Loader2, Lock, Search, Shield, ShieldCheck, ShieldOff, Sparkles, Star, TrendingUp, Users, ArrowUpDown } from 'lucide-react';

export const BadgesSection = ({ stats }) => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState('recent'); // 'default', 'recent', 'unlocked', 'locked', 'rewards'
  const [featuredBadge, setFeaturedBadge] = useState(stats?.featuredBadge || null);
  const [savingFeatured, setSavingFeatured] = useState(false);

  useEffect(() => { setFeaturedBadge(stats?.featuredBadge || null); }, [stats?.featuredBadge]);

  const handleSetFeatured = async (badgeId) => {
    if (!user || savingFeatured) return;
    setSavingFeatured(true);
    const newValue = featuredBadge === badgeId ? null : badgeId;
    try {
      const { error } = await supabase.from('profiles').update({ featured_badge: newValue }).eq('id', user.id);
      if (error) throw error;
      setFeaturedBadge(newValue);
    } catch (err) {
      console.error('Nepodařilo se nastavit vystavený odznak:', err);
    } finally {
      setSavingFeatured(false);
    }
  };

  // Pomocná funkce pro vyhledávání odolné vůči diakritice
  const normalizeText = (text) => 
    (text || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const categoriesList = [
    { id: 'all', label: 'Vše' },
    { id: 'books', label: '📚 Knihy' },
    { id: 'streak', label: '🔥 Streak' },
    { id: 'levels', label: '🏆 Úrovně' },
    { id: 'monthly', label: '📅 Výzvy' },
    { id: 'special', label: '⭐ Speciální' }
  ];

  // Výpočet odemčených odznaků
  const unlockedBadgesSet = useMemo(() => new Set(stats?.unlockedBadges || []), [stats?.unlockedBadges]);
  const totalUnlockedCount = unlockedBadgesSet.size;
  const progressPercent = Math.round((totalUnlockedCount / BOOK_BADGES.length) * 100);

  // Filtrování a řazení
  const filteredBadges = useMemo(() => {
    const query = normalizeText(searchQuery.trim());
    const unlockedArray = stats?.unlockedBadges || [];

    return BOOK_BADGES.filter(badge => {
      // 1. Filtr podle kategorie
      if (selectedCategory !== 'all' && badge.category !== selectedCategory) return false;
      
      // 2. Vyhledávání s autocorrectem / diakritikou
      if (query) {
        const titleNorm = normalizeText(badge.title);
        const descNorm = normalizeText(badge.description);
        return titleNorm.includes(query) || descNorm.includes(query);
      }
      return true;
    }).sort((a, b) => {
      const isUnlockedA = unlockedBadgesSet.has(a.id);
      const isUnlockedB = unlockedBadgesSet.has(b.id);

      if (sortBy === 'recent') {
        if (!isUnlockedA && !isUnlockedB) return 0;
        if (isUnlockedA && !isUnlockedB) return -1;
        if (!isUnlockedA && isUnlockedB) return 1;
        // Obě odemčené: vyšší index v unlockedBadges = nedávno odemčeno
        return unlockedArray.indexOf(b.id) - unlockedArray.indexOf(a.id);
      }
      if (sortBy === 'unlocked') {
        return (isUnlockedB ? 1 : 0) - (isUnlockedA ? 1 : 0);
      }
      if (sortBy === 'locked') {
        return (isUnlockedA ? 1 : 0) - (isUnlockedB ? 1 : 0);
      }
      if (sortBy === 'rewards') {
        return b.rewardCoins - a.rewardCoins;
      }
      return 0; // Výchozí pořadí v poli
    });
  }, [searchQuery, selectedCategory, sortBy, unlockedBadgesSet, stats?.unlockedBadges]);

  return (
    <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8">
      
      {/* HLAVIČKA A PROGRESS BAR */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider text-left flex items-center gap-1.5 m-0">
            <Award size={16} style={{ color: 'var(--bg-primary)' }} /> Sběratelské Odznáčky Knihovny ({BOOK_BADGES.length})
          </h3>
          <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 m-0 opacity-70">
            Odemčeno {totalUnlockedCount} ze {BOOK_BADGES.length} odznaků ({progressPercent}%)
          </p>
        </div>

        {/* PROGRESS BAR */}
        <div className="w-full sm:w-48 bg-black/5 dark:bg-white/10 h-3 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progressPercent}%`, backgroundColor: 'var(--bg-primary)' }}></div>
        </div>
      </div>

      {/* OVLÁDACÍ PANELY: VYHLEDÁVÁNÍ A ŘAZENÍ */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 mb-4">
        
        {/* VYHLEDÁVAČ */}
        <div className="relative w-full md:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="text"
            placeholder="Hledat odznak..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
            className="w-full pl-9 pr-4 py-2 text-xs font-bold rounded-xl border outline-none transition-all focus:border-[var(--bg-primary)]"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-100 bg-transparent border-none cursor-pointer">
              ✕
            </button>
          )}
        </div>

        {/* SELECT ŘAZENÍ */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <ArrowUpDown size={14} className="opacity-60 shrink-0" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
            className="w-full md:w-auto px-3 py-2 text-xs font-bold rounded-xl border outline-none cursor-pointer"
          >
            <option value="recent">Nedávno odemčené 🕒</option>
            <option value="unlocked">Odemčené prvotně 🔓</option>
            <option value="locked">Nezamčené prvotně 🔒</option>
            <option value="rewards">Nejvyšší odměny 💰</option>
            <option value="default">Výchozí pořadí 📜</option>
          </select>
        </div>
      </div>

      {/* ZÁLOŽKY KATEGORIÍ */}
      <div className="flex flex-wrap gap-1.5 mb-6 border-b pb-3" style={{ borderColor: 'var(--border-color)' }}>
        {categoriesList.map(cat => {
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                backgroundColor: isActive ? 'var(--bg-primary)' : 'var(--bg-badge)',
                color: isActive ? 'var(--text-primary)' : 'var(--text-badge)'
              }}
              className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider border-none cursor-pointer transition-all shadow-sm"
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* GRID ODZNAKŮ */}
      {filteredBadges.length === 0 ? (
        <div className="py-12 text-center opacity-60">
          <p className="text-sm font-bold m-0">Žádné odznaky neodpovídají tvému vyhledávání.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-1">
          {filteredBadges.map((badge) => {
            const isUnlocked = unlockedBadgesSet.has(badge.id);
            const isFeatured = featuredBadge === badge.id;
            const BadgeIcon = badge.icon;
            
            return (
              <div 
                key={badge.id} 
                style={{ 
                  backgroundColor: isUnlocked ? 'var(--bg-badge)' : 'rgba(0, 0, 0, 0.04)', 
                  borderColor: isFeatured ? '#f59e0b' : (isUnlocked ? 'var(--border-color)' : 'transparent'), 
                  opacity: isUnlocked ? 1 : 0.45 
                }} 
                className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all duration-300 shadow-inner relative ${isUnlocked ? 'scale-100' : 'scale-95'}`}
              >
                <div 
                  style={{ 
                    backgroundColor: isUnlocked ? 'var(--bg-primary)' : 'rgba(255,255,255,0.05)', 
                    color: isUnlocked ? 'var(--text-primary)' : 'var(--text-muted)' 
                  }} 
                  className="w-11 h-11 rounded-full flex items-center justify-center shadow-md shrink-0 transition-transform duration-500"
                >
                  <BadgeIcon size={20} className={isUnlocked ? "animate-pulse" : ""} />
                </div>
                
                <div className="text-left flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span style={{ color: isUnlocked ? 'var(--text-badge)' : 'var(--text-muted)' }} className="font-black text-xs tracking-wide uppercase truncate">
                      {badge.title}
                    </span>
                    {isUnlocked && (
                      <span className="text-[9px] bg-amber-500/20 text-amber-500 px-1 py-0.5 rounded font-bold flex items-center gap-0.5">
                        +{badge.rewardCoins} <Coins size={9} />
                      </span>
                    )}
                  </div>
                  <span style={{ color: 'var(--text-body)' }} className="text-[11px] opacity-75 mt-0.5 leading-tight line-clamp-2">
                    {badge.description}
                  </span>
                </div>

                {isUnlocked && (
                  <button
                    onClick={() => handleSetFeatured(badge.id)}
                    disabled={savingFeatured}
                    title={isFeatured ? 'Přestat vystavovat na žebříčku' : 'Vystavit na žebříčku'}
                    style={{ color: isFeatured ? '#f59e0b' : 'var(--text-muted)' }}
                    className="shrink-0 bg-transparent border-none cursor-pointer p-1 opacity-80 hover:opacity-100"
                  >
                    <Star size={16} className={isFeatured ? 'fill-amber-500' : ''} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
