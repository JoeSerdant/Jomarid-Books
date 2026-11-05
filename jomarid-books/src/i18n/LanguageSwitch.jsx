// Přepínač jazyka CZ / EN. Dvě tlačítka vedle sebe, aktivní je zvýrazněné. Stejný stav ovládá horní lišta i Nastavení.
// Viditelný text je zkratka (CZ, EN), čtečka dostane celý název jazyka se zkratkou: „Čeština (CZ)“, aby název obsahoval viditelný text.
import { useState } from 'react';
import { t, useLang } from './index.js';

const OPTIONS = [
  { key: 'cs', code: 'CZ', name: 'Čeština' },
  { key: 'en', code: 'EN', name: 'English' },
];

export const LanguageSwitch = ({ variant = 'navbar' }) => {
  const { lang, setLang } = useLang();
  const [busy, setBusy] = useState(false);
  const compact = variant === 'navbar';

  const choose = async (key) => {
    if (busy || key === lang) return;
    setBusy(true);
    const ok = await setLang(key);
    setBusy(false);
    // Bez připojení se angličtina nestáhne a zůstane čeština; jazyk, který se nepodařilo zapnout, se hlásí česky (platí ten, ve kterém appka zůstala).
    if (!ok) window.alert(t('Angličtinu se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.'));
  };

  return (
    <div
      role="group"
      aria-label={t('Jazyk')}
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
      className={`shrink-0 inline-flex items-stretch border rounded-xl overflow-hidden ${compact ? 'p-0.5 gap-0.5' : 'p-1 gap-1'}`}
    >
      {OPTIONS.map((o) => {
        const active = lang === o.key;
        return (
          <button
            key={o.key}
            type="button"
            lang={o.key}
            aria-pressed={active}
            disabled={busy}
            onClick={() => choose(o.key)}
            style={{ backgroundColor: active ? 'var(--bg-primary)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-body)' }}
            className={`border-none cursor-pointer font-black uppercase tracking-wider rounded-lg active:scale-95 transition-all ${compact ? 'px-1.5 sm:px-2 py-1.5 text-[0.5625rem] sm:text-[0.625rem]' : 'px-4 py-2 text-xs'}`}
          >
            <span aria-hidden="true">{o.code}</span>
            <span className="sr-only">{`${o.name} (${o.code})`}</span>
          </button>
        );
      })}
    </div>
  );
};
