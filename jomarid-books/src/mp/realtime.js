// Kanál v reálném čase pro hry, které si posílají polohy a střely (Rocket, Polygon aréna): Supabase Realtime Broadcast.
// Zprávy tudy nechodí přes databázi (to by bylo příliš pomalé), jen přes websocket mezi hráči. O tom, kdo smí do kanálu, rozhodují pravidla
// v db/multiplayer.sql (mp_topic_ok): zápas má kanál 'mp:<id zápasu>', sdílená aréna 'mp-arena:polygonarena'.
//
// Nejdřív se zkusí soukromý kanál (ověřený těmi pravidly). Kdyby ho projekt neumožňoval (Realtime autorizace se nedá zapnout, pravidla chybí),
// zkusí se obyčejný kanál stejného jména: číslo zápasu je náhodné a zná ho jen dvojice hráčů, takže se do cizího zápasu nikdo nedostane. Když
// nejde ani to, ohlásí se chyba a hra to řekne hráči.
//
// client je klient Supabase (stačí channel() a removeChannel()); handlers: onMessage(payload), onStatus({ status, private }), onPresence(stav).
// status: 'open' (kanál je připravený, i po automatickém obnovení spojení), 'down' (spojení se přerušilo, klient ho obnovuje), 'error' (kanál se nepodařilo otevřít).

export const BROADCAST_EVENT = 'g';
export const MAX_PAYLOAD_CHARS = 3000;   // větší zpráva se zahodí (polohy a střely jsou na desítky bajtů)
export const MIN_SEND_GAP_MS = 20;       // nejvýš 50 zpráv za vteřinu z jednoho hráče

export function openRealtime({ client, topic, key = null, preferPrivate = true, timeoutMs = 12000, now = () => Date.now(), timers = null, onMessage, onStatus, onPresence }) {
  const timer = timers || { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
  const attempts = preferPrivate ? [true, false] : [false];
  let channel = null, closed = false, open = false, usedPrivate = false, lastSend = 0, index = 0;
  const status = (s) => { if (!closed && onStatus) { try { onStatus(s); } catch { /* chyba v obsluze nesmí shodit kanál */ } } };

  const attempt = () => {
    if (closed) return;
    if (index >= attempts.length) { status({ status: 'error' }); return; }
    const priv = attempts[index++];
    let ch;
    try {
      ch = client.channel(topic, { config: { private: priv, broadcast: { self: false, ack: false }, presence: { key: key || undefined } } });
      ch.on('broadcast', { event: BROADCAST_EVENT }, (m) => { if (!closed && ch === channel && onMessage) { try { onMessage(m ? m.payload : undefined); } catch { /* chyba v obsluze nesmí shodit kanál */ } } });
      if (onPresence) ch.on('presence', { event: 'sync' }, () => { if (!closed && ch === channel) { try { onPresence(ch.presenceState()); } catch { /* totéž */ } } });
    } catch {
      channel = null;
      attempt();
      return;
    }
    channel = ch;
    let settled = false;
    const guard = timer.setTimeout(() => { if (!settled && ch === channel) fail(); }, timeoutMs);
    const fail = () => {
      settled = true;
      timer.clearTimeout(guard);
      try { client.removeChannel(ch); } catch { /* kanál už není */ }
      if (channel === ch) channel = null;
      attempt();
    };
    try {
      ch.subscribe((s) => {
        if (closed || ch !== channel) return;
        if (s === 'SUBSCRIBED') {
          settled = true; timer.clearTimeout(guard);
          open = true; usedPrivate = priv;
          status({ status: 'open', private: priv });
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          if (!settled) fail();
          else if (open) { open = false; status({ status: 'down' }); }
        }
      });
    } catch {
      fail();
    }
  };
  attempt();

  return {
    isOpen: () => open,
    isPrivate: () => usedPrivate,
    // Pošle zprávu ostatním v kanálu. Vrací true, když šla na cestu (nejde-li kanál, příliš často nebo je zpráva moc velká, zahodí se).
    // opts.force: důležitá zpráva (konec, výsledek) se neomezuje odstupem od předchozí.
    send(payload, opts) {
      if (closed || !open || !channel) return false;
      const t = now();
      if (t - lastSend < MIN_SEND_GAP_MS && !(opts && opts.force)) return false;
      let text;
      try { text = JSON.stringify(payload); } catch { return false; }
      if (!text || text.length > MAX_PAYLOAD_CHARS) return false;
      lastSend = t;
      try { channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload }); return true; } catch { return false; }
    },
    // Přítomnost v kanálu (kdo je tu): jen u sdílené arény.
    track(state) {
      if (closed || !open || !channel || !channel.track) return;
      try { channel.track(state); } catch { /* příště */ }
    },
    close() {
      if (closed) return;
      closed = true; open = false;
      const ch = channel; channel = null;
      if (ch) { try { client.removeChannel(ch); } catch { /* kanál už není */ } }
    },
  };
}
