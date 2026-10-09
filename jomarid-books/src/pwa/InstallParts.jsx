import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { promptInstall, useInstallState } from './install.js';
import { readDismissals, recordDismissal, shouldShowInstallPopup } from './installPromptModel.js';

const POPUP_DELAY_MS = 2500;
const solid = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };
const soft = { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-body)', border: '1px solid var(--border-color)' };
const btn = 'px-3.5 py-2 rounded-lg cursor-pointer text-xs font-black inline-flex items-center gap-1.5';

/** Ruční postup pro iPhone a iPad (Safari tam nemá instalační okno). */
export const IosSteps = () => (
  <ol data-testid="ios-install-steps" className="text-xs m-0 pl-5 space-y-1 leading-relaxed list-decimal">
    <li>Klepni na tlačítko <strong>Sdílet</strong> <Share size={12} className="inline align-text-bottom" /> v liště prohlížeče.</li>
    <li>Vyber <strong>Přidat na plochu</strong>.</li>
    <li>Potvrď tlačítkem <strong>Přidat</strong>.</li>
  </ol>
);

/** Zmínka o appce přímo na úvodní stránce (zmizí, když už appka běží jako nainstalovaná). */
export const InstallNote = () => {
  const { installed, canPrompt, ios } = useInstallState();
  const [steps, setSteps] = useState(false);
  const [result, setResult] = useState('');
  if (installed) return null;
  const install = async () => {
    const out = await promptInstall();
    setResult(out === 'accepted' ? 'Hotovo, appka se instaluje. Najdeš ji na ploše nebo v nabídce.' : '');
  };
  return (
    <div data-testid="install-note" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <Smartphone size={15} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
        <p style={{ color: 'var(--text-body)' }} className="m-0 flex-1 min-w-[12rem]">
          <strong>Jomarid Books máš i jako aplikaci.</strong> Spustíš ji z plochy, bez adresního řádku, a otevře se i bez připojení.
        </p>
        {canPrompt && <button type="button" onClick={install} style={{ ...solid, border: 'none' }} className={btn}><Download size={13} /> Nainstalovat</button>}
        {!canPrompt && ios && <button type="button" onClick={() => setSteps((s) => !s)} aria-expanded={steps} style={{ ...solid, border: 'none' }} className={btn}>Jak na to</button>}
        {!canPrompt && !ios && <Link to="/settings/app" style={{ color: 'var(--text-body)' }} className="font-black underline underline-offset-2 text-xs">Jak ji nainstalovat</Link>}
      </div>
      {!canPrompt && ios && steps && <div style={{ color: 'var(--text-body)' }} className="mt-2.5 pl-6"><IosSteps /></div>}
      {result && <p role="status" style={{ color: 'var(--text-muted)' }} className="m-0 mt-2 pl-6">{result}</p>}
    </div>
  );
};

/** Vyskakovací nabídka „Nainstalovat Jomarid Books?“ (po chvíli na úvodní stránce, po „Teď ne“ se dlouho neukazuje). */
export const InstallPopup = () => {
  const state = useInstallState();
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);
  const [steps, setSteps] = useState(false);

  useEffect(() => { const t = setTimeout(() => setReady(true), POPUP_DELAY_MS); return () => clearTimeout(t); }, []);
  const show = ready && !gone && shouldShowInstallPopup({ state, dismissals: readDismissals() });
  const close = () => { recordDismissal(); setGone(true); };

  useEffect(() => {
    if (!show) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show]);

  if (!show) return null;
  const install = async () => {
    const out = await promptInstall();
    if (out === 'dismissed') close(); else setGone(true);
  };
  return (
    <div
      role="dialog" aria-label="Instalace aplikace" data-testid="install-popup"
      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-body)', bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      className="fixed left-3 right-3 sm:left-auto sm:right-6 sm:w-[22rem] z-40 border rounded-2xl shadow-xl p-4"
    >
      <button type="button" onClick={close} aria-label="Zavřít" style={{ color: 'var(--text-muted)' }} className="absolute top-2.5 right-2.5 bg-transparent border-none cursor-pointer p-1 flex"><X size={16} /></button>
      <div className="flex items-start gap-3 pr-5">
        <span style={solid} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black">J</span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-black">Nechceš si nainstalovat Jomarid Books?</p>
          <p style={{ color: 'var(--text-muted)' }} className="m-0 mt-1 text-xs leading-relaxed">Otevře se jako appka z plochy, bez adresního řádku, a funguje i bez připojení.</p>
        </div>
      </div>
      {state.ios && !state.canPrompt && steps && <div className="mt-3"><IosSteps /></div>}
      <div className="flex items-center gap-2 mt-3">
        {state.canPrompt
          ? <button type="button" onClick={install} style={{ ...solid, border: 'none' }} className={btn}><Download size={13} /> Nainstalovat</button>
          : <button type="button" onClick={() => setSteps((s) => !s)} aria-expanded={steps} style={{ ...solid, border: 'none' }} className={btn}>Jak na to</button>}
        <button type="button" onClick={close} style={soft} className={btn}>Teď ne</button>
      </div>
    </div>
  );
};
