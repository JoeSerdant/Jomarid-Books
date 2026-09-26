import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BookOpen, Coins, Heart, Loader2, MessageCircle, Star, X } from 'lucide-react';

export const BookDetailModal = ({ book, onClose, onBuy, buying, coins }) => {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [commentError, setCommentError] = useState('');

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    setLoadingComments(true);
    setNewComment('');
    setCommentError('');
    supabase
      .from('book_comments')
      .select('id, content, author_name, user_id, created_at')
      .eq('book_id', book.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setComments(data || []);
        setLoadingComments(false);
      });
    return () => { cancelled = true; };
  }, [book?.id]);

  if (!book) return null;

  const myComment = comments.find(c => c.user_id === user?.id);

  const handlePostComment = async () => {
    const trimmed = newComment.trim();
    if (!trimmed) return;
    if (trimmed.length > 100) { setCommentError('Nejvýš 100 znaků.'); return; }
    setPostingComment(true);
    setCommentError('');
    try {
      const { data, error } = await supabase
        .from('book_comments')
        .insert([{ user_id: user.id, book_id: book.id, content: trimmed }])
        .select('id, content, author_name, user_id, created_at')
        .single();
      if (error) throw error;
      setComments(prev => [data, ...prev]);
      setNewComment('');
    } catch (err) {
      setCommentError(err.message.includes('duplicate') ? 'Na tuhle knihu už komentář máš.' : 'Nepodařilo se uložit.');
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await supabase.from('book_comments').delete().eq('id', commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err) {
      console.error('Nepodařilo se smazat komentář:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[110] flex justify-center items-center p-4" onClick={onClose}>
      <div
        style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
        className="border rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-4 top-4 opacity-50 hover:opacity-100 cursor-pointer text-current bg-transparent border-none">
          <X size={20} />
        </button>

        <h2 className="text-xl font-black uppercase tracking-tight m-0 pr-8">{book.title}</h2>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs font-bold opacity-70 mt-1">Autor: {book.author}</p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {book.avgRating > 0 && (
            <span style={{ borderColor: 'var(--border-color)' }} className="border px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1">
              <Star size={11} className="fill-amber-400 text-amber-400" /> {book.avgRating.toFixed(1)} ({book.ratingsCount})
            </span>
          )}
          <span style={{ borderColor: 'var(--border-color)' }} className="border px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1">
            <Heart size={11} className="fill-red-500 text-red-500" /> {book.likesCount}
          </span>
          {book.genres.map(g => (
            <span key={g} style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }} className="text-[9px] font-bold uppercase px-2 py-1 rounded">{g}</span>
          ))}
        </div>

        <p style={{ color: 'var(--text-body)' }} className="text-sm leading-relaxed mt-4 opacity-90">
          {book.description || 'Autor k téhle knize zatím nepřidal popis.'}
        </p>

        <div className="mt-5">
          {book.hasAccess ? (
            <Link to={`/read/${book.id}`} className="no-underline">
              <button style={{ backgroundColor: 'var(--text-body)', color: 'var(--bg-body)' }} className="w-full py-3 rounded-xl font-black text-xs uppercase tracking-wider border-none cursor-pointer flex items-center justify-center gap-1.5">
                <BookOpen size={14} /> {book.isRead ? 'Číst znovu' : 'Číst'}
              </button>
            </Link>
          ) : (
            <button
              onClick={() => onBuy(book)}
              disabled={buying || coins < book.priceCoins}
              style={{ backgroundColor: coins < book.priceCoins ? 'var(--bg-secondary)' : 'var(--bg-primary)', color: coins < book.priceCoins ? 'var(--text-muted)' : 'white' }}
              className="w-full py-3 rounded-xl font-black text-xs uppercase tracking-wider border-none cursor-pointer flex items-center justify-center gap-1.5 disabled:cursor-not-allowed"
            >
              {buying ? (
                <Loader2 size={14} className="animate-spin" />
              ) : coins < book.priceCoins ? (
                <>Chybí {book.priceCoins - coins} <Coins size={13} /></>
              ) : (
                <>Koupit za {book.priceCoins} <Coins size={13} /></>
              )}
            </button>
          )}
        </div>

        <div style={{ borderColor: 'var(--border-color)' }} className="border-t mt-6 pt-5">
          <h3 style={{ color: 'var(--text-muted)' }} className="text-[11px] font-black uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MessageCircle size={13} /> Komentáře {comments.length > 0 && `(${comments.length})`}
          </h3>

          {!myComment && (
            <div className="flex flex-col gap-1 mb-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={100}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Krátký komentář (max 100 znaků)..."
                  style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' }}
                  className="flex-1 p-2.5 border rounded-lg text-xs font-medium outline-none"
                />
                <button
                  onClick={handlePostComment}
                  disabled={postingComment || !newComment.trim()}
                  style={{ backgroundColor: 'var(--bg-primary)', color: 'white' }}
                  className="px-3 py-2.5 rounded-lg text-[10px] font-black uppercase cursor-pointer border-none disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {postingComment ? <Loader2 size={12} className="animate-spin" /> : 'Přidat'}
                </button>
              </div>
              <div className="flex items-center justify-between">
                {commentError && <span className="text-red-500 text-[10px]">{commentError}</span>}
                <span style={{ color: 'var(--text-muted)' }} className="text-[9px] opacity-50 ml-auto">{newComment.length}/100</span>
              </div>
            </div>
          )}

          {loadingComments ? (
            <p style={{ color: 'var(--text-muted)' }} className="text-xs opacity-50 text-center py-3">Načítám...</p>
          ) : comments.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }} className="text-xs opacity-50 text-center py-3">Zatím žádné komentáře. Buď první!</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {comments.map(c => (
                <div key={c.id} style={{ backgroundColor: 'var(--bg-secondary)' }} className="p-2.5 rounded-lg flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span style={{ color: 'var(--text-badge)' }} className="text-[10px] font-black uppercase block">{c.author_name}</span>
                    <span style={{ color: 'var(--text-body)' }} className="text-xs break-words">{c.content}</span>
                  </div>
                  {c.user_id === user?.id && (
                    <button onClick={() => handleDeleteComment(c.id)} className="bg-transparent border-none cursor-pointer p-0.5 text-red-400 opacity-60 hover:opacity-100 shrink-0">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


