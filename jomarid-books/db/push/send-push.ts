// Supabase Edge Function "send-push": odešle Web Push na zařízení uživatele (nebo všech správců).
// Volá ji jen databáze (spouštěč v db/push-notifications.sql) se sdíleným heslem v hlavičce x-push-secret.
// Nastavení a nasazení: db/push/README.md. Potřebné tajné hodnoty (Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (např. mailto:ty@example.cz), PUSH_WEBHOOK_SECRET
// SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY dodává Supabase sám.
//
// Dvě cesty: databáze pošle buď hotový titulek a text (oznámení z appky), nebo jen druh a data (motivační oznámení) -
// pak texty složí compose() níž: pro každý druh je víc variant, ať se oznámení neomílají.
// Logika je ve funkcích handle() a compose() se závislostmi zvenku, takže jde testovat v Node (src/tests/push.test.mjs) bez Deno a sítě.

export interface PushSub { id: string; endpoint: string; p256dh: string; auth: string }

export interface PushDeps {
  secret: string;
  sendWebPush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;
  listSubscriptions: (audience: 'user' | 'admins', userId: string | null) => Promise<PushSub[]>;
  deleteSubscriptions: (ids: string[]) => Promise<void>;
  rnd?: () => number; // výběr varianty textu (v testech pevný)
  now?: () => Date;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
// Cíl kliknutí smí být jen cesta v téhle appce (ne cizí adresa).
// Bez zpětných lomítek, mezer a řídicích znaků: prohlížeč čte „/\\example.com“ jako cizí adresu.
const safeUrl = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 200 || v[0] !== '/' || v[1] === '/' || v[1] === '\\') return '/';
  for (const ch of v) { const c = ch.codePointAt(0)!; if (c <= 32 || c === 127 || c === 92 || /\s/.test(ch)) return '/'; }
  return v;
};
// Zařízení smí vést jen na push službu prohlížeče (stejné pravidlo jako push_endpoint_ok v SQL). Jiná adresa se nikdy nevolá, ať server
// nikdo nepřiměje posílat požadavky kam chce.
export const isPushServiceUrl = (v: unknown) =>
  typeof v === 'string' && v.length <= 2000 && /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(:443)?\//i.test(v);

// ---------- Texty motivačních oznámení ----------
// Tykáme, hlas je hravý a trochu dramatický (jako Duolingo), ale s knižním humorem. Bez rodových tvarů minulého času
// („přečetl/a“): jen přítomný čas, rozkaz a podstatná jména, ať sedí všem. Titulek do ~45 znaků, text do ~130.
export type Msg = { title: string; body: string; url?: string };
type Data = Record<string, unknown>;

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const whole = (v: unknown, fallback = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, 0), 99999) : fallback; };
const days = (n: number) => `${n} ${plural(n, 'den', 'dny', 'dní')}`;
const books = (n: number) => `${n} ${plural(n, 'kniha', 'knihy', 'knih')}`;
const coinsText = (n: number) => `${n} ${plural(n, 'mince', 'mince', 'mincí')}`;
// Název knihy a autor jdou do textu zkrácené, ať se oznámení nikdy nepřetáhne přes limit.
const short = (v: unknown, max: number) => {
  const s = (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

const streakRisk = (n: number): Msg[] => {
  const nn = days(n);
  if (n <= 2) return [
    { title: 'Jedna stránka a série žije 📖', body: `Série z ${nn} se dnes může přerušit. Chvilka čtení ji zachrání.` },
    { title: 'Záložka čeká na své místo', body: `Dnes zatím žádné čtení. Otevři knihu, než ${nn} série zmizí.` },
    { title: 'Malý krok, velká série', body: `Pár odstavců stačí, aby série z ${nn} přežila do zítřka.` },
    { title: 'Tohle ještě zachráníš 🔥', body: `Série má zatím ${nn}. Přidej dnešní čtení a z jedničky bude dvojka.` },
  ];
  if (n <= 6) return [
    { title: `🔥 ${nn} v řadě! Nezahoď to`, body: 'Dnes zatím nic nepřečteno. Jedna kapitola a série pokračuje.' },
    { title: `Série ${n}… a dnes ticho?`, body: 'Tvoje knihy si všimly. Otevři jednu aspoň na pár minut.' },
    { title: 'Tohle by byla škoda 🔥', body: `${nn} čtení v řadě, dnes zatím nic. Nech sérii růst.` },
    { title: 'Ještě to jde stihnout', body: `Do půlnoci zbývá čas na pár stránek. Série z ${nn} to ocení.` },
  ];
  if (n < 30) return [
    { title: `Série ${nn} se nevzdává 🔥`, body: 'Dnes ještě chybí čtení. Pár stránek a rekord se prodlouží.' },
    { title: `${nn} v řadě si zaslouží pokračování`, body: 'Otevři knihu, ať se to dnes nezlomí.' },
    { title: 'Pozor, série se třese 🔥', body: `Čtení ${nn} v řadě visí na vlásku. Chvilka s knihou a je zachráněno.` },
    { title: 'Knihy hlásí: dnes ticho', body: `${nn} čtení v řadě a dnes nic? Pár stránek to spraví.` },
    { title: 'Tolik práce a teď by zmizela?', body: `Série z ${nn} se nehodí zahodit kvůli jedné večerní lenosti. Přečti aspoň kousek.` },
  ];
  return [
    { title: `🔥 ${nn}. Tohle přece nepustíš`, body: 'Dnes ještě chybí čtení. Jedna stránka stačí k záchraně celé série.' },
    { title: 'Legendární série v ohrožení', body: `Série ${nn} už je skoro pomník. Přidej dnešní čtení, než půlnoc zaklapne.` },
    { title: `Půlnoc se blíží, série ${n}`, body: 'Pár minut s knihou a legenda žije dál.' },
  ];
};

const MILESTONES: Record<number, Msg[]> = {
  3: [
    { title: 'Tři dny v řadě! 🔥', body: 'Čtení se pomalu mění ve zvyk. Takhle dál!' },
    { title: 'Trojka je venku 📖', body: 'Tři dny čtení za sebou. Zítra mrkneme na čtvrtý.' },
  ],
  7: [
    { title: 'Týden v řadě! 🔥', body: 'Sedm dní čtení bez vynechání. Knihovna smekla.' },
    { title: 'Sedmička! Týden bez výmluv 🎉', body: 'Série je oficiálně zvyk. Pokračuj dál.' },
  ],
  14: [
    { title: 'Dva týdny v řadě! 🔥', body: 'Čtrnáct dní čtení každý den. To už je styl.' },
    { title: 'Čtrnáct dní bez přestávky 🎉', body: 'Záložky tleskají. Zítra dál!' },
  ],
  30: [
    { title: 'Měsíc čtení v kuse! 🏆', body: 'Třicet dní v řadě. Tohle se jen tak nevidí.' },
    { title: 'Třicítka! Měsíc každý den 🎉', body: 'Série se stala legendou. Neuhýbej z kurzu.' },
  ],
  50: [
    { title: 'Padesát dní v řadě! 🏆', body: 'Takhle dlouhá série je opravdová výdrž. Smekáme.' },
    { title: 'Půl stovky dní čtení 🎉', body: 'Tvoje knihovna je na tebe hrdá.' },
  ],
  100: [
    { title: 'STO dní v řadě! 🏆', body: 'Stovka čtení za sebou. Tohle se bude vyprávět.' },
    { title: 'Stovka! Nezastavitelné čtení 🔥', body: 'Sto dní bez vynechání. Čest a sláva.' },
  ],
  200: [
    { title: 'Dvě stě dní v řadě! 🏆', body: 'Série, o které se píšou příběhy.' },
  ],
  365: [
    { title: 'CELÝ ROK čtení každý den! 🎉', body: 'Tři sta šedesát pět dní v řadě. Jomarid Books tleská vestoje.' },
  ],
};
const milestone = (n: number): Msg[] => MILESTONES[n] ?? [
  { title: `Série ${days(n)}! 🔥`, body: 'Další milník splněn. Takhle dál!' },
];

const comeback = (n: number): Msg[] => {
  if (n <= 3) return [
    { title: 'Knihy se po tobě stýskají 📚', body: `Už ${days(n)} bez čtení. Vrať se na pár stránek, ať to nevychladne.` },
    { title: 'Záložka se nudí', body: 'Rozečtený příběh čeká přesně tam, kde přestal. Otevři ho na chvilku.' },
  ];
  if (n <= 7) return [
    { title: 'Týden bez čtení? Stránky čekají', body: 'Rozečtené věci nikam neutekly. Stačí otevřít knihu a navázat.' },
    { title: 'Prach na polici se usazuje 📖', body: 'Týden ticha. Jedna krátká kapitola a zase jedeš.' },
  ];
  if (n <= 14) return [
    { title: 'Dva týdny ticha na polici', body: 'Knihovna zeje prázdnotou. Dnes stačí jedna krátká kapitola.' },
    { title: 'Knihy mají pocit, že se na ně zapomnělo', body: 'Dokaž jim opak. Pár stránek stačí.' },
  ];
  return [
    { title: 'Měsíc! Poznáme se ještě? 👀', body: 'Jomarid Books stojí na starém místě. Otevři knihu a začni znovu - série se rozběhne od jedničky.' },
    { title: 'Tvoje knihovna se po tobě ptá', body: 'Dlouho se nevidíme. Vyber si něco krátkého a rozjeď to znovu.' },
  ];
};

const continueBook = (title: string, pct: number): Msg[] => {
  const t = short(title, 60);
  return [
    { title: `„${short(title, 40)}“ čeká na další stránky`, body: `Máš za sebou ${pct} %. Pokračuj přesně od záložky.` },
    { title: 'Záložka drží místo', body: `V „${t}“ je hotovo ${pct} %. Zbytek čeká na tebe.` },
    { title: `${pct} % je za tebou 📖`, body: `Rozečtená kniha „${t}“ se sama nepřečte. Navaž od záložky.` },
    { title: `Příběh se zasekl na ${pct} %`, body: `„${t}“ prosí o další kapitolu. Jen jednu, slibujeme.` },
    { title: 'Dej té knize ještě šanci', body: `Dnes aspoň pár stránek z „${t}“ a posuneš se z ${pct} % dál.` },
  ];
};

const goalProgress = (goal: number, done: number, remaining: number): Msg[] => {
  if (remaining === 1) return [
    { title: 'Poslední kniha do cíle! 🎯', body: 'Splnění měsíčního cíle dělí jedna kniha. Odměna v mincích je na dosah.' },
    { title: 'Cíl je na dosah ruky', body: 'Stačí dočíst ještě jednu knihu a měsíc je splněný. Dáš to!' },
  ];
  if (done === 0) return [
    { title: 'Měsíční cíl zatím na nule', body: `Cíl ${books(goal)} se sám nesplní. Vyber si kratší knihu a rozjeď to.` },
    { title: 'Prázdný ukazatel cíle 🎯', body: 'Tenhle měsíc ještě nic nepřibylo. První kniha rozhýbe všechno.' },
  ];
  if (done * 2 >= goal) return [
    { title: `Cíl je na dosah: ${done} z ${goal} 🎯`, body: `Do splnění zbývá ${books(remaining)}. Máš to skoro doma.` },
    { title: 'Přes půlku cíle!', body: `Máš ${done} z ${goal}. Dnešní čtení tě posune blíž.` },
  ];
  return [
    { title: `Měsíční cíl: ${done} z ${goal}`, body: `Do splnění zbývá ${books(remaining)}. Dnes je dobrý den začít další.` },
    { title: 'Cíl měsíce se nepřečte sám 🎯', body: `Zbývá ${books(remaining)}. Vyber si a pusť se do toho.` },
  ];
};

const coinsToSpend = (coins: number): Msg[] => [
  { title: `🪙 ${coinsText(coins)} leží ladem`, body: 'Za ně se odemkne nová kniha. Mrkni do knihovny, co by se hodilo.' },
  { title: 'Peněženka se hlásí 🪙', body: `Na účtu je ${coinsText(coins)}. V knihovně na ně čeká další příběh.` },
  { title: 'Mince nečtou, ale knihy ano', body: `Tvých ${coinsText(coins)} stačí na novou knihu. Vyber si něco dobrého.` },
  { title: 'Nová kniha je na dosah 🪙', body: 'Máš dost mincí na další příběh. Podívej se, co knihovna nabízí.' },
];

// Jemné popostrčení: obecné i podle dne v týdnu (0 = neděle ... 6 = sobota, pražský čas).
const gentleNudge = (weekday: number): Msg[] => {
  const common: Msg[] = [
    { title: 'Pár minut s knihou? 📖', body: 'Dnes je dobrý den na pár stránek. Otevři Jomarid Books a vyber si.' },
    { title: 'Tvoje knihovna drží místo', body: 'Žádný tlak, jen pár stránek ve chvíli, kdy se to hodí.' },
    { title: 'Chvilka pro příběh', body: 'Čaj, gauč, pár kapitol. Jomarid Books je připravené.' },
    { title: 'Telefon máš stejně v ruce 📱', body: 'Tak ho využij k něčemu hezkému a přečti si pár stránek.' },
    { title: 'Kniha ti posílá pozdrav 👋', body: 'Říká, že dnes ještě nebyla otevřená. Dej jí pár minut.' },
    { title: 'Dnes ještě není pozdě', body: 'Do večera zbývá spousta času na krátkou kapitolu.' },
    { title: 'Jedna stránka. Víc nechceme.', body: 'No dobře, chceme víc. Ale jedna stránka už se počítá.' },
    { title: 'Nová série začíná dnes 🔥', body: 'Přečti pár stránek a zapiš si první den. Zítra už to budou dva.' },
  ];
  if (weekday === 1) common.push({ title: 'Pondělí potřebuje dobrý příběh', body: 'Start týdne se čtením vypadá líp. Pár stránek stačí.' });
  if (weekday === 5) common.push({ title: 'Pátek! Čas na knihu 📚', body: 'Týden je za námi. Odměň se pár stránkami do víkendu.' });
  if (weekday === 0 || weekday === 6) common.push(
    { title: 'Víkend voní papírem 📖', body: 'Žádný spěch, jen klid a dobrá kniha. Vyber si, co ti sedne.' },
    { title: 'Neděle je stvořená na čtení', body: 'Přikrývka, čaj a kapitola. Jomarid Books na tebe čeká.' },
  );
  return common;
};

const newBook = (title: string, author: string): Msg[] => {
  const t = short(title, 60);
  const by = author ? ` Od ${short(author, 40)}.` : '';
  return [
    { title: '📚 Nová kniha v knihovně', body: `Nově v knihovně: „${t}“.${by} Mrkni, jestli ti sedne.`, url: '/app' },
    { title: `Čerstvě přibylo: „${short(title, 36)}“`, body: `Nový příběh je na polici.${by}`, url: '/app' },
    { title: 'Něco nového na polici 📖', body: `Knihovna se rozrostla o „${t}“.${by}`, url: '/app' },
  ];
};

// Vrátí hotový titulek a text, nebo null pro neznámý druh. rnd vybírá variantu (0 až <1), weekday jen pro jemné popostrčení.
export function compose(kind: unknown, data: Data | null | undefined, rnd: () => number = Math.random, weekday = 3): Msg | null {
  const d = data && typeof data === 'object' ? data : {};
  let list: Msg[];
  switch (kind) {
    case 'streak_risk': list = streakRisk(Math.max(1, whole(d.streak, 1))); break;
    case 'streak_milestone': list = milestone(Math.max(1, whole(d.streak, 1))); break;
    case 'comeback': list = comeback(Math.max(1, whole(d.days, 7))); break;
    case 'continue_book': list = continueBook(String(d.title ?? ''), Math.min(100, whole(d.percent))); break;
    case 'goal_progress': {
      const goal = Math.max(1, whole(d.goal, 1));
      const done = Math.min(whole(d.done), goal - 1);
      list = goalProgress(goal, done, Math.max(1, whole(d.remaining, goal - done)));
      break;
    }
    case 'coins_to_spend': list = coinsToSpend(whole(d.coins)); break;
    case 'gentle_nudge': list = gentleNudge(weekday); break;
    case 'new_book': list = newBook(String(d.title ?? ''), String(d.author ?? '')); break;
    default: return null;
  }
  const r = Math.floor(rnd() * list.length);
  const i = Number.isFinite(r) || r === Infinity ? Math.min(list.length - 1, Math.max(0, r)) : 0;
  const m = list[i];
  return { ...m, url: m.url ?? (kind === 'streak_milestone' ? '/stats' : '/app') };
}
export const MESSAGE_KINDS = ['streak_risk', 'streak_milestone', 'comeback', 'continue_book', 'goal_progress', 'coins_to_spend', 'gentle_nudge', 'new_book'];

export async function handle(req: Request, deps: PushDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!deps.secret || req.headers.get('x-push-secret') !== deps.secret) return json({ error: 'unauthorized' }, 401);
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const audience = input.audience === 'admins' ? 'admins' : input.audience === 'user' ? 'user' : null;
  const userId = typeof input.user_id === 'string' && UUID.test(input.user_id) ? input.user_id : null;
  if (!audience || (audience === 'user' && !userId)) return json({ error: 'bad_audience' }, 400);

  // Druh + data (motivační oznámení): texty složí tahle funkce. Jinak platí hotový titulek a text z databáze.
  let title = clip(input.title, 120);
  let body = clip(input.body, 200);
  let url = safeUrl(input.url);
  if (typeof input.kind === 'string' && input.kind) {
    const weekday = new Date(((deps.now?.() ?? new Date()).toLocaleString('en-US', { timeZone: 'Europe/Prague' }))).getDay();
    const m = compose(input.kind, input.data as Data, deps.rnd ?? Math.random, weekday);
    if (!m) return json({ error: 'bad_kind' }, 400);
    title = m.title;
    body = m.body;
    url = safeUrl(m.url);
  }
  const payload = JSON.stringify({
    title: clip(title, 120) || 'Jomarid Books',
    body: clip(body, 200),
    url,
    tag: clip(input.tag, 80) || undefined,
  });

  let subs: PushSub[];
  try {
    subs = await deps.listSubscriptions(audience, userId);
  } catch (e) {
    console.error('send-push: čtení zařízení z databáze selhalo', e); // ať se chyba nastavení nepřehlédne (Edge Functions -> Logs)
    return json({ error: 'db_error' }, 500);
  }
  const dead: PushSub[] = [];
  let sent = 0;
  let failed = 0;
  const queue: PushSub[] = [];
  for (const s of subs) (isPushServiceUrl(s.endpoint) ? queue : dead).push(s); // cizí adresy se jen smažou, nevolají se
  const toSend = queue.length;
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        await deps.sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent += 1;
      } catch (e) {
        const status = Number((e as { statusCode?: number })?.statusCode);
        if (status === 404 || status === 410) dead.push(s); // odhlášené nebo smazané zařízení
        else failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, toSend) }, worker));
  let removed = 0;
  if (dead.length) {
    try { await deps.deleteSubscriptions(dead.map((d) => d.id)); removed = dead.length; } catch (e) { console.error('send-push: mazání mrtvých zařízení selhalo', e); }
  }
  return json({ sent, removed, failed, total: subs.length });
}

// Spuštění v Supabase (Deno). V Node (testy) se tahle část přeskočí.
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && typeof D.serve === 'function') {
  const [{ default: webpush }, { createClient }] = await Promise.all([import('npm:web-push@3.6.7'), import('npm:@supabase/supabase-js@2')]);
  webpush.setVapidDetails(D.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', D.env.get('VAPID_PUBLIC_KEY') ?? '', D.env.get('VAPID_PRIVATE_KEY') ?? '');
  const db = createClient(D.env.get('SUPABASE_URL')!, D.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const deps: PushDeps = {
    secret: D.env.get('PUSH_WEBHOOK_SECRET') ?? '',
    sendWebPush: async (sub, payload) => { await webpush.sendNotification(sub, payload, { TTL: 86400, urgency: 'normal' }); },
    listSubscriptions: async (audience, userId) => {
      const cols = 'id, endpoint, p256dh, auth';
      let ids: string[] = userId ? [userId] : [];
      if (audience === 'admins') {
        const admins = await db.from('profiles').select('id').eq('role', 'správce');
        if (admins.error) throw admins.error;
        ids = (admins.data ?? []).map((r: { id: string }) => r.id);
      }
      if (!ids.length) return [];
      const res = await db.from('push_subscriptions').select(cols).in('user_id', ids);
      if (res.error) throw res.error;
      return (res.data ?? []) as PushSub[];
    },
    deleteSubscriptions: async (ids) => {
      const res = await db.from('push_subscriptions').delete().in('id', ids);
      if (res.error) throw res.error;
    },
  };
  D.serve((req: Request) => handle(req, deps));
}
