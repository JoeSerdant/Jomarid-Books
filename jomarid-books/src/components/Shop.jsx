import { useRef, useState } from 'react';
import { Coins, Check, Lock, Loader2, Store } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SHOP_KINDS, KIND_GAMEFX, groupsOfKind, itemState, missingCoins, requirementText, shopErrorText } from '../shop/catalog';
import { buyCosmetic, equipCosmetic, loadMyCosmetics } from '../shop/api';

const fmt = (n) => Number(n || 0).toLocaleString('cs-CZ');

// Náhled vzhledu her: pestrá plocha, na kterou se použije stejný filtr jako na hru.
const FxPreview = ({ filter }) => (
  <span
    aria-hidden="true"
    style={{ filter, background: 'linear-gradient(120deg, #ef4444 0%, #f59e0b 25%, #22c55e 50%, #3b82f6 75%, #a855f7 100%)' }}
    className="block h-8 w-full rounded-lg"
  />
);

const ItemCard = ({ item, state, coins, busy, onBuy, onEquip, onUnequip }) => {
  const need = requirementText(item);
  const missing = missingCoins(item, coins);
  const owned = state === 'owned' || state === 'equipped';
  return (
    <li
      data-testid={`shop-item-${item.id}`}
      data-state={state}
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: state === 'equipped' ? 'var(--bg-primary)' : 'var(--border-color)', color: 'var(--text-body)' }}
      className="border rounded-xl p-3 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-black">{item.label}</span>
          {item.description && <span style={{ color: 'var(--text-muted)' }} className="block text-[0.6875rem] font-bold">{item.description}</span>}
        </span>
        {state === 'equipped' && (
          <span style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }} className="shrink-0 rounded-md px-1.5 py-0.5 text-[0.5625rem] font-black uppercase tracking-wide inline-flex items-center gap-1">
            <Check size={10} aria-hidden="true" /> Nasazeno
          </span>
        )}
      </div>

      {item.kind === KIND_GAMEFX && <FxPreview filter={item.filter} />}

      {state === 'locked' && need && (
        <span style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] font-bold inline-flex items-start gap-1.5">
          <Lock size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> Odemkne se: {need}
        </span>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <span style={{ color: owned ? 'var(--text-muted)' : 'var(--text-body)' }} className="text-xs font-black inline-flex items-center gap-1">
          <Coins size={12} className="text-amber-500" aria-hidden="true" /> {fmt(item.price)}
        </span>
        {owned ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => (state === 'equipped' ? onUnequip(item) : onEquip(item))}
            style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', borderColor: 'var(--border-color)' }}
            className="px-3 py-1.5 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border disabled:cursor-wait"
          >
            {busy ? <Loader2 size={12} className="animate-spin" aria-label="Pracuju" /> : state === 'equipped' ? 'Sundat' : 'Nasadit'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || state === 'locked' || state === 'poor'}
            onClick={() => onBuy(item)}
            title={state === 'poor' ? `Chybí ti ${fmt(missing)} ${missing === 1 ? 'mince' : 'mincí'}` : undefined}
            style={{
              backgroundColor: state === 'available' ? 'var(--bg-primary)' : 'var(--bg-card)',
              color: state === 'available' ? 'var(--text-primary)' : 'var(--text-muted)',
              borderColor: 'var(--border-color)',
            }}
            className="px-3 py-1.5 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={12} className="animate-spin" aria-label="Pracuju" /> : state === 'locked' ? 'Zamčeno' : state === 'poor' ? `Chybí ${fmt(missing)}` : 'Koupit'}
          </button>
        )}
      </div>
    </li>
  );
};

// Obchůdek na stránce Odznaky. Stav (koupené a nasazené) i zůstatek patří stránce, tady se jen mění přes onCosmetics a onBalance.
//   cosmetics: {owned: [id...], equipped: {title, gamefx}}
//   unlocked: id herních odznaků, které čtenář má (podle nich se odemykají některé tituly)
export const Shop = ({ cosmetics, coins, unlocked, onCosmetics, onBalance }) => {
  const [kind, setKind] = useState(SHOP_KINDS[0].kind);
  const [busyId, setBusyId] = useState(null);
  const busyRef = useRef(false); // dvojklik se nesmí projevit dvěma nákupy dřív, než se překreslí tlačítko
  const [message, setMessage] = useState(null); // {text, warn}
  const current = SHOP_KINDS.find((k) => k.kind === kind);

  const say = (text, warn = false) => setMessage({ text, warn });
  const refresh = async () => { const fresh = await loadMyCosmetics(supabase); if (fresh) onCosmetics(fresh); };

  const withBusy = async (item, job) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(item.id);
    setMessage(null);
    try { await job(); } finally { busyRef.current = false; setBusyId(null); }
  };

  const buy = (item) => withBusy(item, async () => {
    const res = await buyCosmetic(supabase, item.id);
    if (!res.ok) {
      say(shopErrorText(res.reason), true);
      if (res.reason === 'already_owned' || res.reason === 'unknown_item') await refresh();
      return;
    }
    onCosmetics({ owned: [...cosmetics.owned, item.id], equipped: { ...cosmetics.equipped, [item.kind]: item.id } });
    if (res.newBalance != null) onBalance(res.newBalance);
    say(item.kind === KIND_GAMEFX ? `Koupeno: ${item.label}. Vzhled her máš nasazený, uvidíš ho při další hře.` : `Koupeno: ${item.label}. Titul máš nasazený.`);
  });

  const equip = (item) => withBusy(item, async () => {
    const res = await equipCosmetic(supabase, item.kind, item.id);
    if (!res.ok) { say(shopErrorText(res.reason), true); await refresh(); return; }
    onCosmetics({ ...cosmetics, equipped: { ...cosmetics.equipped, [item.kind]: item.id } });
    say(`Nasazeno: ${item.label}.`);
  });

  const unequip = (item) => withBusy(item, async () => {
    const res = await equipCosmetic(supabase, item.kind, null);
    if (!res.ok) { say(shopErrorText(res.reason), true); await refresh(); return; }
    const equipped = { ...cosmetics.equipped };
    delete equipped[item.kind];
    onCosmetics({ ...cosmetics, equipped });
    say(`Sundáno: ${item.label}.`);
  });

  const state = { owned: cosmetics.owned, equipped: cosmetics.equipped, unlocked, coins };

  return (
    <div style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }} className="border rounded-2xl p-6 shadow-sm mb-8" data-testid="shop">
      <div className="mb-4">
        <h3 style={{ color: 'var(--text-muted)' }} className="text-xs font-black uppercase tracking-wider text-left flex items-center gap-1.5 m-0">
          <Store size={16} style={{ color: 'var(--bg-primary)' }} /> Obchůdek
        </h3>
        <p style={{ color: 'var(--text-muted)' }} className="text-xs mt-1 m-0 opacity-70">
          Jomarid Coins se dají utratit i za něco, co se nečte: tituly u jména a vzhledy her. Nic z toho nedává výhodu, je to jen vzhled. Máš {fmt(coins)} <Coins size={11} className="inline text-amber-500 -mt-0.5" aria-hidden="true" />
        </p>
      </div>

      <div className="flex gap-2 mb-3" role="group" aria-label="Druh zboží">
        {SHOP_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            aria-pressed={k.kind === kind}
            data-testid={`shop-tab-${k.kind}`}
            onClick={() => { setKind(k.kind); setMessage(null); }}
            style={{ backgroundColor: k.kind === kind ? 'var(--bg-primary)' : 'var(--bg-secondary)', color: k.kind === kind ? 'var(--text-primary)' : 'var(--text-body)', borderColor: 'var(--border-color)' }}
            className="px-3 py-1.5 rounded-lg text-[0.6875rem] font-black uppercase tracking-wider cursor-pointer border"
          >
            {k.label}
          </button>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)' }} className="text-[0.6875rem] font-bold m-0 mb-3">{current.hint}</p>

      {groupsOfKind(kind).map((group) => (
        <section key={group.id} data-testid={`shop-group-${group.id}`} aria-label={group.label || undefined} className="mb-5 last:mb-0">
          {group.label && <h4 style={{ color: 'var(--text-muted)' }} className="text-[0.625rem] font-black uppercase tracking-wider m-0 mb-2">{group.label}</h4>}
          <ul className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                state={itemState(item, state)}
                coins={coins}
                busy={busyId === item.id}
                onBuy={buy}
                onEquip={equip}
                onUnequip={unequip}
              />
            ))}
          </ul>
        </section>
      ))}

      <p
        role="status"
        data-testid="shop-message"
        style={{ color: message?.warn ? '#ef4444' : 'var(--text-body)' }}
        className="text-xs font-bold mt-3 mb-0 min-h-[1rem]"
      >
        {message?.text || ''}
      </p>
    </div>
  );
};
