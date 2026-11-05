import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { gameSaves, offlineSupported, syncNow } from './index.js';
import { prepareGames, preparedGames } from './gamesPrep.js';
import { useOnline } from './useOnline';
import { t, formatDate } from '../i18n';
import { tk } from '../i18n/mark.js';

const GAME_NAMES = {
  rocket: 'Rocket', warroom: 'Warroom', hannibal: 'Hannibal', cityclicker: 'City Clicker', polygonarena: tk('Polygon aréna'), chess: 'Chess League', koulovikamosi: tk('Kouloví Kámoši'),
};
const fmtDate = (ts) => formatDate(ts);

// Nastavení → Aplikace → Hry offline: stáhnout hry dopředu a přehled postupu, který je v zařízení (a co z něj čeká na odeslání).
export const OfflineGamesSection = ({ Section, Notice, ActionButton }) => {
  const { user } = useAuth();
  const online = useOnline();
  const [saves, setSaves] = useState(null);
  const [prepared, setPrepared] = useState(() => preparedGames());
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    if (!user || !offlineSupported()) { setSaves([]); return; }
    try { setSaves(await gameSaves.list(user.id)); } catch { setSaves([]); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  if (!user) return null;
  const supported = offlineSupported();

  const prepare = async () => {
    setBusy('prepare'); setMsg(null); setProgress([0, 1]);
    try {
      const { preloadGames } = await import('../pages/Games');
      const res = await prepareGames(preloadGames, { onProgress: (done, total) => setProgress([done, total]) });
      setPrepared(preparedGames());
      setMsg(res.ok ? { type: 'success', text: t('Hry jsou připravené, jdou hrát i bez internetu.') } : { type: 'error', text: t('Některé hry se nepodařilo stáhnout. Zkus to znovu.') });
    } catch { setMsg({ type: 'error', text: t('Stažení her se nepovedlo. Zkontroluj připojení a zkus to znovu.') }); } finally { setBusy(''); setProgress(null); }
  };
  const sendNow = async () => {
    setBusy('sync'); setMsg(null);
    try {
      const res = await syncNow(user, { force: true });
      await load();
      const failed = Object.values(res?.games || {}).some((g) => g.action === 'failed');
      setMsg(res?.flushed && !res.flushed.stopped && !failed ? { type: 'success', text: t('Postup her je odeslaný.') } : { type: 'error', text: t('Odeslání se nepovedlo, zkusí se to znovu samo.') });
    } catch { setMsg({ type: 'error', text: t('Odeslání se nepovedlo, zkusí se to znovu samo.') }); } finally { setBusy(''); }
  };
  const waiting = (saves || []).filter((s) => s.dirty);

  return (
    <Section title={t('Hry offline')} description={t('Hry jdou hrát i bez internetu. Postup se ukládá do zařízení zašifrovaně a po připojení se sloučí s účtem: když ses mezitím hrál jinde, platí pokročilejší postup a ten druhý se uloží jako záloha. Herní odměny a rekordy z offline hraní se odešlou po připojení (o částce a denním stropu rozhoduje server).')}>
      <div data-testid="offline-games-section" className="space-y-3">
        {!supported && <Notice type="info">{t('Tenhle prohlížeč nebo režim (třeba soukromé okno) ukládání postupu do zařízení nepodporuje.')}</Notice>}
        {supported && (
          <>
            <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0" data-testid="offline-games-status">
              {prepared ? t('Hry jsou připravené pro offline (naposledy {date}).', { date: fmtDate(prepared.at) }) : t('Hry se stahují při prvním spuštění. Chceš-li hrát i ty, které sis ještě neotevřel, připrav je dopředu.')}
            </p>
            <ActionButton busy={busy === 'prepare'} disabled={!online} onClick={prepare}>
              {busy === 'prepare' && <Loader2 size={13} className="animate-spin" />} {prepared ? t('Stáhnout hry znovu') : t('Připravit hry offline')}{progress ? ` (${progress[0]}/${progress[1]})` : ''}
            </ActionButton>
            {saves && saves.length > 0 && (
              <ul className="list-none p-0 m-0 space-y-1" data-testid="offline-game-saves">
                {saves.map((s) => (
                  <li key={s.gameId} style={{ color: 'var(--text-muted)' }} className="text-xs font-bold">
                    {s.dirty ? t('{game}: postup je v zařízení, čeká na odeslání', { game: t(GAME_NAMES[s.gameId] || s.gameId) }) : t('{game}: postup je v zařízení', { game: t(GAME_NAMES[s.gameId] || s.gameId) })}
                  </li>
                ))}
              </ul>
            )}
            {waiting.length > 0 && (
              <div className="space-y-2" data-testid="offline-games-pending">
                <Notice>{waiting.length === 1 ? t('Postup jedné hry čeká na odeslání.') : t('Postup {n} her čeká na odeslání.', { n: waiting.length })}</Notice>
                <ActionButton busy={busy === 'sync'} disabled={!online} onClick={sendNow}>{busy === 'sync' && <Loader2 size={13} className="animate-spin" />} {t('Odeslat teď')}</ActionButton>
              </div>
            )}
          </>
        )}
        {msg && <Notice type={msg.type}>{msg.text}</Notice>}
      </div>
    </Section>
  );
};
