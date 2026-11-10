import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { t } from '../i18n';
import { MpSection } from './MpSection.jsx';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Okno „Hrát online“ nad hrou: otevře se z tlačítka v menu hry (src/mp/entry.js) a obsahuje hledání soupeře, hru s kamarádem, vstup do arény
// a návrat do rozehraného zápasu (MpSection). Zavře se křížkem, klávesou Esc nebo kliknutím vedle; zavření při hledání soupeře hledání ukončí.
// Okno je ve vlastní vrstvě nad celou stránkou (portál), takže funguje nad hrou i nad stránkou hry.
export const MpLobbyDialog = ({ game, online, avail, auto, onMatch, onArena, onClose }) => {
  const closeRef = useRef(null);
  const boxRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      // Tabulátor zůstává uvnitř okna (za ním je hra nebo stránka, ke které by se jinak focus dostal)
      if (e.key !== 'Tab' || !boxRef.current) return;
      const items = [...boxRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (!boxRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      data-testid="mp-lobby"
      role="dialog"
      aria-modal="true"
      aria-label={t('Hrát online')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, backgroundColor: 'rgba(0,0,0,0.65)' }}
      className="flex items-start justify-center overflow-y-auto p-4"
    >
      <div ref={boxRef} className="w-full max-w-md my-auto">
        <div className="flex justify-end mb-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            data-testid="mp-lobby-close"
            aria-label={t('Zavřít')}
            style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
            className="w-9 h-9 rounded-full border flex items-center justify-center cursor-pointer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <MpSection game={game} online={online} avail={avail} auto={auto} onMatch={onMatch} onArena={onArena} />
      </div>
    </div>,
    document.body,
  );
};
