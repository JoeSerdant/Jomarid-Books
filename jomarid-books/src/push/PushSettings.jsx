import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, Loader2, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useInstallState } from '../pwa/install.js';
import { enableMessage, pushSupport, TEST_PUSH_DELAY_SECONDS, TEST_PUSH_HELP } from './pushModel.js';
import { deviceState, disablePush, enablePush, fetchVapidKey, getPushPrefs, isPushWanted, keepPushAlive, sendTestPush, setPushPrefs } from './pushClient.js';
import { t, tx } from '../i18n';

const btn = 'px-3 py-2 rounded-lg border-none cursor-pointer text-xs font-black inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
const solid = { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' };
const soft = { backgroundColor: 'var(--bg-card)', color: 'var(--text-body)', border: '1px solid var(--border-color)' };
const Note = ({ children, tone }) => <p role={tone === 'error' ? 'alert' : 'status'} style={{ color: tone === 'error' ? '#ef4444' : 'var(--text-muted)' }} className="text-xs m-0 leading-relaxed">{children}</p>;

/** Nastavení -> Oznámení: zapnutí oznámení do tohohle zařízení (telefon, počítač). */
export default function PushSettings({ client = supabase }) {
  const { installed } = useInstallState();
  const [state, setState] = useState(null); // { support, device, configured }
  const [busy, setBusy] = useState('');
  const [savingEngage, setSavingEngage] = useState(false); // dvě rychlé změny za sebou by se do databáze mohly dostat v opačném pořadí
  const [message, setMessage] = useState(null); // { tone, text }

  const load = useCallback(async () => {
    const support = pushSupport({ win: window, nav: navigator, standalone: installed });
    if (!support.supported) { setState({ support }); return; }
    const vapid = await fetchVapidKey(client);
    const vapidKey = !vapid.error && vapid.key ? vapid.key : null;
    let [device, prefs] = await Promise.all([deviceState({ nav: navigator, win: window, client, vapidKey }), getPushPrefs(client)]);
    // Zařízení oznámení chce a povolení platí, jen se přihlášení ztratilo (Obnovit aplikaci, přepnutí účtu): obnoví se samo, bez klepnutí
    if (vapidKey && !device.subscribed && device.permission === 'granted' && isPushWanted(window)) {
      await keepPushAlive({ client, nav: navigator, win: window });
      device = await deviceState({ nav: navigator, win: window, client, vapidKey });
    }
    setState({ support, device, configured: !!vapidKey, vapidKey, engage: prefs.engage });
  }, [client, installed]);
  useEffect(() => { load(); }, [load]);

  const turnOn = async () => {
    setBusy('on'); setMessage(null);
    const res = await enablePush({ client, nav: navigator, win: window, vapidKey: state?.vapidKey }); // klíč je načtený předem, ať dotaz na povolení přijde přímo z klepnutí
    setBusy('');
    setMessage({ tone: res.status === 'enabled' ? 'ok' : res.status === 'error' ? 'error' : 'info', text: enableMessage(res.status) });
    load();
  };
  const turnOff = async () => {
    setBusy('off'); setMessage(null);
    await disablePush({ client, nav: navigator, win: window });
    setBusy('');
    setMessage({ tone: 'info', text: t('Oznámení jsou v tomhle zařízení vypnutá.') });
    load();
  };
  const test = async () => {
    setBusy('test'); setMessage(null);
    const res = await sendTestPush(client, undefined, { delay: TEST_PUSH_DELAY_SECONDS });
    setBusy('');
    setMessage(res.ok
      ? { tone: 'ok', text: t.p(TEST_PUSH_DELAY_SECONDS, 'Zkušební oznámení přijde za {n} sekundu. Teď appku zavři, přepni se jinam nebo zamkni telefon, ať ho uvidíš.', 'Zkušební oznámení přijde za {n} sekundy. Teď appku zavři, přepni se jinam nebo zamkni telefon, ať ho uvidíš.', 'Zkušební oznámení přijde za {n} sekund. Teď appku zavři, přepni se jinam nebo zamkni telefon, ať ho uvidíš.', { n: TEST_PUSH_DELAY_SECONDS }) }
      : { tone: res.reason === 'too-many' ? 'info' : 'error', text: res.reason === 'too-many' ? t('Počkej chvilku a zkus to znovu.') : res.reason === 'not-configured' ? enableMessage('not-configured') : t('Zkušební oznámení se nepodařilo odeslat.') });
  };

  const toggleEngage = async (next) => {
    if (savingEngage) return;
    setSavingEngage(true);
    setState((s) => ({ ...s, engage: next })); // hned vidět; při chybě se vrátí
    setMessage(null);
    const res = await setPushPrefs(client, next);
    if (!res.ok) {
      setState((s) => ({ ...s, engage: !next }));
      setMessage({ tone: 'error', text: t('Nastavení se nepodařilo uložit. Zkus to za chvilku znovu.') });
    }
    setSavingEngage(false);
  };

  const wrap = (children) => (
    <section data-testid="push-settings" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }} className="border rounded-xl p-3 space-y-2">
      <h4 className="text-xs font-black uppercase tracking-wider m-0 flex items-center gap-1.5"><Bell size={13} /> {t('Oznámení do zařízení')}</h4>
      {children}
    </section>
  );

  if (!state) return wrap(<div className="flex items-center gap-2 text-xs font-bold" style={{ color: 'var(--text-muted)' }}><Loader2 size={13} className="animate-spin" /> {t('Zjišťuji stav...')}</div>);
  if (!state.support.supported) {
    return wrap(state.support.reason === 'ios-needs-install'
      ? <Note>{tx('Na iPhonu a iPadu fungují oznámení jen v appce přidané na plochu. Přidej ji ({link}), otevři ji z plochy a zapni oznámení tady.', { link: <Link to="/settings/app" style={{ color: 'var(--text-body)' }} className="font-black underline">{t('Nastavení → Aplikace')}</Link> })}</Note>
      : <Note>{t('Tenhle prohlížeč oznámení do zařízení neumí.')}</Note>);
  }
  const { device, configured } = state;
  return wrap(
    <>
      <Note>{t('Nové oznámení z appky (skrytá kniha, odstraněný komentář, změna jména, dar knihy...) ti přijde i jako oznámení v zařízení, i když appku nemáš otevřenou.')}</Note>
      {!configured ? (
        <Note>{enableMessage('not-configured')}</Note>
      ) : device.permission === 'denied' ? (
        <Note tone="error">{enableMessage('denied')}</Note>
      ) : device.subscribed ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ color: 'var(--text-body)' }} className="text-xs font-black flex items-center gap-1.5"><Bell size={13} /> {t('Zapnuto v tomhle zařízení')}</span>
            <button type="button" onClick={test} disabled={!!busy} style={solid} className={btn}>{busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {t('Poslat zkušební oznámení (za {n} s)', { n: TEST_PUSH_DELAY_SECONDS })}</button>
            <button type="button" onClick={turnOff} disabled={!!busy} style={soft} className={btn}>{busy === 'off' ? <Loader2 size={12} className="animate-spin" /> : <BellOff size={12} />} {t('Vypnout')}</button>
          </div>
          <Note>{t('Oznámení zůstávají zapnutá i po obnovení aplikace a přepnutí účtu: zařízení si je samo přiřadí k účtu, který právě používáš. Vypneš je jen tady.')}</Note>
          <Note>{t(TEST_PUSH_HELP)}</Note>
        </div>
      ) : (
        <div className="space-y-2">
          {device.stale && <Note>{t('Oznámení v tomhle zařízení přestala fungovat. Zapni je prosím znovu.')}</Note>}
          <button type="button" onClick={turnOn} disabled={!!busy} style={solid} className={btn}>{busy === 'on' ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />} {t('Zapnout oznámení v tomhle zařízení')}</button>
        </div>
      )}
      {configured && device.permission !== 'denied' && (
        <label className="flex items-start gap-2 cursor-pointer pt-1" style={{ color: 'var(--text-body)' }}>
          <input type="checkbox" data-testid="push-engage" checked={state.engage !== false} disabled={savingEngage} onChange={(e) => toggleEngage(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0 disabled:opacity-60" style={{ accentColor: 'var(--bg-primary)' }} />
          <span className="text-xs leading-relaxed">
            <span className="font-black">{t('Připomínky a novinky')}</span>
            <span style={{ color: 'var(--text-muted)' }} className="block">{t('Povzbuzení ke čtení, pochvaly za sérii, rozečtená kniha, měsíční cíl, mince na novou knihu a nové knihy v knihovně. Chodí během dne, nikdy v noci. Kdykoli si je tady vypneš.')}</span>
          </span>
        </label>
      )}
      {message && <Note tone={message.tone === 'error' ? 'error' : undefined}>{message.text}</Note>}
    </>
  );
}
