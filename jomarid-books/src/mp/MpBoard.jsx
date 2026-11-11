import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Medal } from 'lucide-react';
import { t } from '../i18n';
import { mpApi } from './index.js';

const SHOWN = 10;

// Žebříček online hry (mp_leaderboard): nejlepší hráči hry a režimu podle hodnocení (u týmové hry podle výher) a pozice hráče. Načte se až po rozkliknutí.
// Hodnocení začíná na 1000 a mění se podle výsledku proti soupeři (Elo); počítají se jen řádně odehrané zápasy (stejné podmínky jako pro odměnu).
export const MpBoard = ({ gameId, mode }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('idle'); // idle | loading | ready | missing | error
  const [data, setData] = useState(null);
  const aliveRef = useRef(true);
  const keyRef = useRef('');
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const key = `${gameId}/${mode}`;
    keyRef.current = key;
    setState('loading');
    const res = await mpApi.leaderboard(gameId, mode, SHOWN);
    if (!aliveRef.current || keyRef.current !== key) return;
    if (res.error) { setState(res.error.code === 'unavailable' ? 'missing' : 'error'); return; }
    setData(res.data);
    setState('ready');
  }, [gameId, mode]);

  // Rozkliknutý žebříček se po změně režimu (třeba Rocket: spolupráce nebo souboj) načte znovu
  useEffect(() => { if (open) load(); }, [open, load]);

  const team = !!data?.team;
  const rows = data?.rows || [];
  const me = data?.me;
  const meInRows = rows.some((r) => r.me);

  return (
    <div data-testid="mp-board" className="border-t pt-2" style={{ borderColor: 'var(--border-color)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="mp-board-toggle"
        style={{ color: 'var(--text-body)' }}
        className="w-full flex items-center justify-between gap-2 bg-transparent border-none p-0 cursor-pointer text-[0.6875rem] font-black uppercase tracking-wider"
      >
        <span className="flex items-center gap-1.5"><Medal size={13} className="text-amber-500" aria-hidden="true" /> {t('Žebříček')}</span>
        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5" aria-live="polite">
          {state === 'loading' && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs flex items-center gap-2"><Loader2 size={13} className="animate-spin" aria-hidden="true" /> {t('Načítám žebříček...')}</p>}
          {state === 'missing' && <p style={{ color: 'var(--text-muted)' }} data-testid="mp-board-missing" className="m-0 text-xs">{t('Žebříček zatím není na serveru zapnutý.')}</p>}
          {state === 'error' && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-xs">{t('Žebříček se nepodařilo načíst.')}</p>}
          {state === 'ready' && rows.length === 0 && <p style={{ color: 'var(--text-muted)' }} data-testid="mp-board-empty" className="m-0 text-xs">{t('Zatím tu nikdo nehrál. Odehraj zápas a budeš první.')}</p>}
          {state === 'ready' && rows.length > 0 && (
            <>
              <ol className="m-0 p-0 list-none space-y-1" data-testid="mp-board-rows">
                {rows.map((r) => <BoardRow key={r.rank} r={r} team={team} />)}
              </ol>
              {me && !meInRows && (
                <ol className="m-0 p-0 list-none border-t pt-1.5" style={{ borderColor: 'var(--border-color)' }}>
                  <BoardRow r={{ ...me, name: t('Ty'), me: true }} team={team} />
                </ol>
              )}
              {!me && <p style={{ color: 'var(--text-muted)' }} className="m-0 text-[0.6875rem]">{t('Ty zatím v žebříčku nejsi: počítají se zápasy, které měly dost tahů a trvaly dost dlouho.')}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const BoardRow = ({ r, team }) => (
  <li
    data-testid={r.me ? 'mp-board-me' : undefined}
    style={r.me ? { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' } : { color: 'var(--text-body)' }}
    className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
  >
    <span className="w-6 shrink-0 text-right font-black tabular-nums">{r.rank}.</span>
    <span className="min-w-0 flex-1 truncate font-bold">{r.name}</span>
    <span className="shrink-0 tabular-nums font-black">{team ? t.p(r.wins, '{n} výhra', '{n} výhry', '{n} výher', { n: r.wins }) : r.rating}</span>
    {!team && <span style={{ opacity: 0.75 }} className="shrink-0 tabular-nums text-[0.625rem]" title={t('Výhry / prohry / remízy')}>{r.wins}/{r.losses}/{r.draws}</span>}
  </li>
);
