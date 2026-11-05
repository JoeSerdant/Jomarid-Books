import { useState, useEffect, useMemo } from 'react';
import { Gamepad2, Check, Lock, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { GAME_CATALOG, countGameBadges, visibleGameBadges } from '../gameRecords/catalog';
import { loadGameLeaderboard } from '../gameRecords/api';
import { t, formatNumber } from '../i18n';

const fmt = (n) => formatNumber(n);

// Žebříček jedné hry (nejlepší hráči podle hlavní statistiky). Načítá se až po rozbalení karty.
const GameLeaderboard = ({ game, userId }) => {
  const stat = game.stats.find((s) => s.key === game.headline);
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    loadGameLeaderboard(supabase, game.id, game.headline, 5).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [game.id, game.headline]);

  return (
    <div data-testid={`game-board-${game.id}`}>
      <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0 mb-2">{t('Nejlepší hráči: {stat}', { stat: stat ? t(stat.label) : '' })}</p>
      {rows === null ? (
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">{t('Načítám…')}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }} className="text-xs m-0 opacity-70">{t('Zatím tu nikdo není. Buď první.')}</p>
      ) : (
        <ol className="list-none m-0 p-0 flex flex-col gap-1">
          {rows.map((r, i) => (
            <li
              key={r.userId}
              style={{ backgroundColor: r.userId === userId ? 'var(--bg-badge)' : 'transparent', color: 'var(--text-body)' }}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-xs font-bold"
            >
              <span className="min-w-0 truncate"><span style={{ color: 'var(--text-muted)' }} className="inline-block w-5">{i + 1}.</span>{r.name}{r.userId === userId ? ` ${t('(ty)')}` : ''}</span>
              <span className="shrink-0 tabular-nums">{fmt(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

const GameCard = ({ game, progress, userId, open, onToggle }) => {
  const Icon = game.icon;
  const records = progress.records[game.id] || {};
  const unlocked = new Set(progress.unlocked);
  const badges = visibleGameBadges(game.id, progress.unlocked);   // skrytý odznak je v seznamu až tehdy, když ho čtenář má
  const earned = badges.filter((b) => unlocked.has(b.id)).length;
  const [filter, setFilter] = useState('all');   // all | open | done: her je mnoho odznaků, ať jde zobrazit jen to, co ještě chybí
  const shown = badges.filter((b) => filter === 'all' || (filter === 'done') === unlocked.has(b.id));
  const headStat = game.stats.find((s) => s.key === game.headline);
  const head = records[game.headline];

  return (
    <div style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl overflow-hidden" data-testid={`game-card-${game.id}`}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ color: 'var(--text-body)' }}
        className="w-full flex items-center gap-3 px-3 py-3 bg-transparent border-none cursor-pointer text-left"
      >
        <span style={{ backgroundColor: 'var(--bg-badge)', color: 'var(--text-badge)' }} className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center"><Icon size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-black uppercase tracking-wide truncate">{t(game.title)}</span>
          <span style={{ color: 'var(--text-muted)' }} className="block text-[0.6875rem] font-bold">
            {head ? `${t(headStat.label)}: ${fmt(head)}` : t('Zatím bez rekordu')}
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }} className="shrink-0 text-[0.6875rem] font-black">{earned}/{badges.length}</span>
        <ChevronDown size={16} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none' }} className="shrink-0 transition-transform" aria-hidden="true" />
      </button>

      {open && (
        <div style={{ borderColor: 'var(--border-color)' }} className="border-t px-3 py-3 flex flex-col gap-4">
          <div>
            <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0 mb-2">{t('Tvoje rekordy')}</p>
            <dl className="m-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              {game.stats.map((s) => (
                <div key={s.key} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt style={{ color: 'var(--text-muted)' }} className="font-bold min-w-0 truncate">{t(s.label)}</dt>
                  <dd style={{ color: records[s.key] ? 'var(--text-body)' : 'var(--text-muted)' }} className="m-0 font-black tabular-nums shrink-0">{records[s.key] ? fmt(records[s.key]) : '–'}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0">{t('Odznaky ({earned}/{total})', { earned, total: badges.length })}</p>
              <div role="group" aria-label={t('Filtr odznaků')} className="flex gap-1">
                {[['all', t('Vše')], ['open', t('Chybí')], ['done', t('Mám')]].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    aria-pressed={filter === id}
                    data-testid={`game-filter-${game.id}-${id}`}
                    style={{ backgroundColor: filter === id ? 'var(--bg-primary)' : 'var(--bg-card)', color: filter === id ? 'var(--text-primary)' : 'var(--text-muted)', borderColor: 'var(--border-color)' }}
                    className="border rounded-full px-2.5 py-0.5 text-[0.6875rem] font-black cursor-pointer"
                  >{label}</button>
                ))}
              </div>
            </div>
            {shown.length === 0 && <p style={{ color: 'var(--text-muted)' }} className="text-xs font-bold m-0">{filter === 'done' ? t('Zatím žádný odznak.') : t('Máš všechny odznaky této hry!')}</p>}
            <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {shown.map((b) => {
                const on = unlocked.has(b.id);
                return (
                  <li
                    key={b.id}
                    data-testid={`game-badge-${b.id}`}
                    data-unlocked={on ? 'true' : 'false'}
                    style={{ backgroundColor: 'var(--bg-card)', borderColor: on ? 'var(--bg-primary)' : 'var(--border-color)', color: 'var(--text-body)', opacity: on ? 1 : 0.6 }}
                    className="border rounded-lg px-2.5 py-2 flex items-start gap-2"
                  >
                    <span style={{ color: on ? 'var(--bg-primary)' : 'var(--text-muted)' }} className="mt-0.5 shrink-0">{on ? <Check size={14} aria-label={t('Odemčeno')} /> : <Lock size={13} aria-label={t('Zamčeno')} />}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-black">{t(b.title)} <span style={{ color: 'var(--text-muted)' }} className="font-bold">+{b.xp} {t('XP')}</span>{b.secret && <span style={{ color: 'var(--bg-primary)' }} className="ml-1.5 text-[0.5625rem] font-black uppercase tracking-wider">{t('skrytý')}</span>}</span>
                      <span style={{ color: 'var(--text-muted)' }} className="block text-[0.6875rem] font-bold">{t(b.description)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <GameLeaderboard game={game} userId={userId} />
        </div>
      )}
    </div>
  );
};

// Sekce Odznaků her: rekordy, herní odznaky a žebříčky všech her. Postup (progress) předává stránka Odznaky; stejné XP se přičítá do úrovně.
export const GamesProgress = ({ progress, userId }) => {
  const [openId, setOpenId] = useState(null);
  const counts = useMemo(() => countGameBadges(progress.unlocked), [progress.unlocked]);

  return (
    <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8" data-testid="games-progress">
      <div className="mb-4">
        <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider text-left flex items-center gap-1.5 m-0">
          <Gamepad2 size={16} style={{ color: 'var(--bg-primary)' }} /> {t('Hry')}
        </h3>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 m-0 opacity-70" data-testid="games-progress-summary">
          {t('Herní odznaky: {unlocked} z {total}, dohromady {xp} z {totalXp} XP. Rekordy se ukládají k účtu a hlásí je hry samy.', { unlocked: counts.unlocked, total: counts.total, xp: fmt(progress.xp), totalXp: fmt(counts.totalXp) })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {GAME_CATALOG.map((game) => (
          <GameCard key={game.id} game={game} progress={progress} userId={userId} open={openId === game.id} onToggle={() => setOpenId(openId === game.id ? null : game.id)} />
        ))}
      </div>
    </div>
  );
};
