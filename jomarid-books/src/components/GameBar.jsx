import { X, Coins, BookOpen, CloudOff } from 'lucide-react';
import { SAVE_CHIPS } from '../gameSave/messages';

// Lišta nad hrou: hra běží přes celou obrazovku, takže tohle je jediné, co z appky zůstane vidět. Drží se motivu appky
// (barvy z proměnných), ukazuje, kdo hraje (úroveň) a živý zůstatek Jomarid Coins, a je to jediné místo, kde se potvrzují
// odměny (hry samy nic nezobrazují). Na nízké obrazovce na šířku (telefon) je lišta svislá vpravo.
// Třídy jsou napsané celé (ne skládané): Tailwind je při sestavení hledá v textu a sestavené by nepoznal.
//   flash: { id, text, label, warn } - krátké potvrzení (odměna nebo poznámka o limitu), nebo null
//   saveStatus: 'failing' | 'conflict' | 'rejected' - postup se právě neukládá (štítek v liště, dokud to trvá), jinak null
export const GameBar = ({ title, onClose, coins, coinsLoaded, level, levelName, flash, saveStatus }) => (
  <div
    data-testid="game-bar"
    style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', paddingTop: 'var(--sat)', paddingRight: 'var(--sar)', borderColor: 'var(--border-color)' }}
    className="relative z-10 shrink-0 flex items-center justify-between gap-2 px-3 h-[calc(2.75rem+var(--sat))] border-b [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:justify-start [@media(orientation:landscape)_and_(max-height:500px)]:w-[calc(3.5rem+var(--sar))] [@media(orientation:landscape)_and_(max-height:500px)]:h-auto [@media(orientation:landscape)_and_(max-height:500px)]:px-1 [@media(orientation:landscape)_and_(max-height:500px)]:pt-2 [@media(orientation:landscape)_and_(max-height:500px)]:border-b-0 [@media(orientation:landscape)_and_(max-height:500px)]:border-l"
  >
    <span style={{ color: 'var(--text-muted)' }} className="min-w-0 flex items-center gap-1.5 text-[0.6875rem] font-black uppercase tracking-wider [@media(orientation:landscape)_and_(max-height:500px)]:hidden">
      <BookOpen size={13} className="shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate">{title}</span>
    </span>

    <div className="shrink-0 flex items-center gap-1.5 [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:gap-2 [@media(orientation:landscape)_and_(max-height:500px)]:w-full">
      {saveStatus && SAVE_CHIPS[saveStatus] && (
        <span
          data-testid="game-bar-save"
          role="status"
          title={SAVE_CHIPS[saveStatus]}
          style={{ backgroundColor: '#fee2e2', borderColor: '#ef4444', color: '#991b1b' }}
          className="flex items-center gap-1 px-2 py-1.5 rounded-xl border text-xs font-black leading-none whitespace-nowrap [@media(orientation:landscape)_and_(max-height:500px)]:order-4 [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:text-[0.625rem] [@media(orientation:landscape)_and_(max-height:500px)]:px-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5"
        >
          <CloudOff size={13} aria-hidden="true" />
          <span className="[@media(orientation:landscape)_and_(max-height:500px)]:sr-only">{SAVE_CHIPS[saveStatus]}</span>
        </span>
      )}
      {level != null && (
        <span
          data-testid="game-bar-level"
          title={levelName || 'Tvoje úroveň čtenáře'}
          style={{ backgroundColor: 'var(--bg-badge)', borderColor: 'var(--border-color)', color: 'var(--text-badge)' }}
          className="px-2 py-1.5 rounded-xl border text-xs font-black leading-none whitespace-nowrap [@media(orientation:landscape)_and_(max-height:500px)]:order-2 [@media(orientation:landscape)_and_(max-height:500px)]:text-[0.625rem] [@media(orientation:landscape)_and_(max-height:500px)]:px-1"
        >
          Lv. {level}
        </span>
      )}
      {coinsLoaded && (
        <span
          data-testid="game-bar-coins"
          title="Tvoje Jomarid Coins"
          style={{ backgroundColor: 'var(--bg-badge)', borderColor: 'var(--border-color)', color: 'var(--text-badge)' }}
          className="flex items-center gap-1 px-2 py-1.5 rounded-xl border text-xs font-black leading-none whitespace-nowrap [@media(orientation:landscape)_and_(max-height:500px)]:order-3 [@media(orientation:landscape)_and_(max-height:500px)]:flex-col [@media(orientation:landscape)_and_(max-height:500px)]:text-[0.625rem] [@media(orientation:landscape)_and_(max-height:500px)]:px-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5"
        >
          <Coins size={13} className="text-amber-500 fill-amber-500/20" aria-hidden="true" />
          <span>{Number(coins || 0).toLocaleString('cs-CZ')}</span>
        </span>
      )}
      <button
        onClick={onClose}
        title="Zavřít hru"
        aria-label="Zavřít hru"
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
        className="w-9 h-9 shrink-0 rounded-xl cursor-pointer border flex items-center justify-center [@media(orientation:landscape)_and_(max-height:500px)]:order-1"
      >
        <X size={18} />
      </button>
    </div>

    {flash && (
      <div
        key={flash.id}
        role="status"
        aria-live="polite"
        data-testid="game-bar-flash"
        style={flash.warn
          ? { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }
          : { backgroundColor: '#f59e0b', color: '#1c1203', borderColor: '#d97706' }}
        className="pointer-events-none absolute top-full right-2 mt-1.5 max-w-[calc(100vw-1rem)] px-3 py-1.5 rounded-full border shadow-lg text-xs font-black flex items-center gap-1.5 animate-in fade-in duration-200 [@media(orientation:landscape)_and_(max-height:500px)]:top-2 [@media(orientation:landscape)_and_(max-height:500px)]:right-full [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 [@media(orientation:landscape)_and_(max-height:500px)]:mr-2"
      >
        {flash.text && <span>{flash.text}</span>}
        {flash.label && <span className="font-bold opacity-80">{flash.label}</span>}
        {!flash.warn && <Coins size={12} aria-hidden="true" />}
      </div>
    )}
  </div>
);
