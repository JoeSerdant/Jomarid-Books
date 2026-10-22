import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { askHelpBot, checkQuestion, toRequestMessages, HELP_MSG_MAX } from '../helpbot/helpBotApi';

const panelStyle = { backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const inputStyle = { backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-body)' };
const mutedStyle = { color: 'var(--text-muted)' };
const primaryBtn = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };

const WELCOME = 'Ahoj! Jsem pomocník k aplikaci Jomarid Books. Zeptej se mě, jak se v ní co dělá, nebo na tip, co číst.';
const PERSONAL_KEY = 'jomarid_helpbot_personal';
const readPersonal = () => { try { return localStorage.getItem(PERSONAL_KEY) !== '0'; } catch { return true; } };
const SUGGESTIONS = ['Poraď mi, co číst', 'Jak získám Jomarid Coins?', 'K čemu je Streak Freeze?'];

// Na těchhle stránkách by plovoucí tlačítko překáželo (čtečka, hry mají vlastní lištu a ovládání, feed shortB má tlačítka u okraje).
const HIDDEN_ON = [/^\/read\//, /^\/games\/[^/]+/, /^\/shorts/];

// Pomocník v appce: plovoucí tlačítko a okno chatu pro přihlášené. Odpovídá jen na otázky o používání appky (Edge Function help-bot).
export const HelpBot = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState([]);       // { from: 'me' | 'bot', text, error?, detail? }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(null);
  const [hint, setHint] = useState('');
  const [personal, setPersonal] = useState(readPersonal);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [chat, busy, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { if (!user) { setOpen(false); setChat([]); setLeft(null); } }, [user]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!user) return null;
  if (HIDDEN_ON.some((re) => re.test(pathname))) return null;

  const send = async (raw) => {
    if (busy) return;
    const checked = checkQuestion(raw);
    if (checked.error) { setHint(checked.error); return; }
    setHint('');
    const next = [...chat, { from: 'me', text: checked.text }];
    setChat(next);
    setText('');
    setBusy(true);
    const res = await askHelpBot(supabase, { messages: toRequestMessages(next), page: pathname, personalize: personal });
    setBusy(false);
    if (res.error) { setChat((c) => [...c, { from: 'bot', text: res.error, error: true, detail: res.detail }]); return; }
    if (res.left !== null) setLeft(res.left);
    setChat((c) => [...c, { from: 'bot', text: res.answer }]);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); }
  };

  return (
    <div className="fixed z-40 right-4 bottom-4 flex flex-col items-end gap-3" data-testid="helpbot">
      {open && (
        <section aria-label="Pomocník" style={panelStyle} className="border rounded-2xl shadow-2xl flex flex-col overflow-hidden w-[min(22rem,calc(100vw-2rem))] h-[min(30rem,calc(100vh-7rem))]" data-testid="helpbot-panel">
          <header style={{ borderColor: 'var(--border-color)' }} className="flex items-center justify-between gap-2 px-4 py-3 border-b">
            <p className="m-0 font-black text-xs uppercase tracking-wider">Pomocník</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Zavřít pomocníka" style={{ color: 'var(--text-body)' }} className="bg-transparent border-none cursor-pointer p-1 flex"><X size={16} aria-hidden="true" /></button>
          </header>
          <div role="log" aria-live="polite" className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm" data-testid="helpbot-log">
            <p style={{ backgroundColor: 'var(--bg-secondary)' }} className="m-0 rounded-xl px-3 py-2 font-medium">{WELCOME}</p>
            {chat.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((q) => (
                  <button key={q} type="button" onClick={() => send(q)} disabled={busy} style={inputStyle} className="border rounded-full px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50">{q}</button>
                ))}
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={m.from === 'me' ? 'flex justify-end' : 'flex justify-start'}>
                <div data-testid={m.from === 'me' ? 'helpbot-me' : m.error ? 'helpbot-error' : 'helpbot-bot'}
                  style={m.from === 'me' ? primaryBtn : m.error ? { backgroundColor: 'var(--bg-secondary)', color: '#ef4444' } : { backgroundColor: 'var(--bg-secondary)' }}
                  className="max-w-[85%] rounded-xl px-3 py-2 font-medium whitespace-pre-wrap break-words">
                  {m.text}
                  {m.detail && (
                    <details className="text-[0.6875rem] opacity-80 mt-1" style={mutedStyle}>
                      <summary className="cursor-pointer">Technické podrobnosti</summary>
                      <span className="block break-words" data-testid="helpbot-detail">{m.detail}</span>
                    </details>
                  )}
                </div>
              </div>
            ))}
            {busy && <p role="status" style={mutedStyle} className="m-0 text-xs font-bold flex items-center gap-2"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Píšu odpověď...</p>}
            <div ref={endRef} />
          </div>
          <div style={{ borderColor: 'var(--border-color)' }} className="border-t p-3 space-y-2">
            {hint && <p role="alert" className="m-0 text-[0.6875rem] font-bold" style={{ color: '#ef4444' }}>{hint}</p>}
            <div className="flex items-end gap-2">
              <textarea ref={inputRef} rows={1} maxLength={HELP_MSG_MAX} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} disabled={busy}
                aria-label="Tvoje otázka" placeholder="Na co se chceš zeptat?" data-testid="helpbot-input" style={inputStyle} className="flex-1 min-w-0 border rounded-xl px-3 py-2 text-sm font-medium outline-none resize-none max-h-28" />
              <button type="button" onClick={() => send(text)} disabled={busy || !text.trim()} aria-label="Odeslat" data-testid="helpbot-send" style={primaryBtn} className="border-none rounded-xl p-2.5 cursor-pointer disabled:opacity-50 flex"><Send size={16} aria-hidden="true" /></button>
            </div>
            <label className="flex items-start gap-2 text-[0.625rem] cursor-pointer" style={mutedStyle}>
              <input type="checkbox" checked={personal} data-testid="helpbot-personal" className="mt-0.5"
                onChange={(e) => { setPersonal(e.target.checked); try { localStorage.setItem(PERSONAL_KEY, e.target.checked ? '1' : '0'); } catch { /* bez úložiště se volba jen nezapamatuje */ } }} />
              <span>Pomocník smí znát moje jméno, mince, sérii a četbu (kvůli tipům na knihy). Posílá se to jen s otázkou, e-mail ne.</span>
            </label>
            <p style={mutedStyle} className="m-0 text-[0.625rem] opacity-80">Odpovídám jen na otázky o aplikaci a můžu se mýlit.{left !== null ? ` Dnes ti zbývá ${left} ${left === 1 ? 'otázka' : left >= 2 && left <= 4 ? 'otázky' : 'otázek'}.` : ''}</p>
          </div>
        </section>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Zavřít pomocníka' : 'Otevřít pomocníka'} data-testid="helpbot-open" style={primaryBtn}
        className="border-none rounded-full w-12 h-12 shadow-xl cursor-pointer flex items-center justify-center">
        {open ? <X size={20} aria-hidden="true" /> : <MessageCircle size={20} aria-hidden="true" />}
      </button>
    </div>
  );
};
