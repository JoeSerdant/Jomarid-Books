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
  sleep?: (ms: number) => Promise<void>; // čekání před odesláním (zkušební oznámení se zpožděním)
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
// Tykáme a držíme povzbudivý, hravý tón (jako Duolingo, ale s knižním humorem a bez vytýkání): chválíme, držíme palce, nikdy nestrašíme.
// Bez rodových tvarů minulého času („přečetl/a“): jen přítomný čas, rozkaz a podstatná jména, ať sedí všem. Titulek do ~45 znaků, text do ~130.
// Texty se losují z víc variant a podle denní doby (ráno, přes den, večer, pozdě večer) přibývají vlastní.
export type Msg = { title: string; body: string; url?: string };
type Data = Record<string, unknown>;
type Part = 'morning' | 'day' | 'evening' | 'late';

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const whole = (v: unknown, fallback = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, 0), 99999) : fallback; };
const days = (n: number) => `${n} ${plural(n, 'den', 'dny', 'dní')}`;
const books = (n: number) => `${n} ${plural(n, 'kniha', 'knihy', 'knih')}`;
const coinsText = (n: number) => `${n} ${plural(n, 'mince', 'mince', 'mincí')}`;
const coinsAcc = (n: number) => `${n} ${plural(n, 'minci', 'mince', 'mincí')}`; // „máš 1 minci“
const partOf = (hour: number): Part => (hour < 11 ? 'morning' : hour < 18 ? 'day' : hour < 20 ? 'evening' : 'late');
// Název knihy a autor jdou do textu zkrácené, ať se oznámení nikdy nepřetáhne přes limit.
const short = (v: unknown, max: number) => {
  const s = (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

const streakRisk = (n: number, t: Part): Msg[] => {
  const nn = days(n);
  const base: Msg[] = n <= 2 ? [
    { title: 'Skvělý začátek! 📖', body: `Série má ${nn} a může růst. Pár stránek dnes ji posune o další krok.` },
    { title: 'Každá stránka se počítá ✨', body: 'Chvilka čtení a tvoje série poroste dál. Máš to v malíku!' },
    { title: 'Malý krok, velká série', body: `Série má ${nn}. Pár odstavců dnes a bude z ní víc, zvládneš to!` },
    { title: 'Tohle půjde samo 🔥', body: 'Otevři knihu, přečti pár stránek a série pokračuje. Držíme ti palce!' },
  ] : n <= 6 ? [
    { title: `🔥 ${nn} v řadě! Jedeš skvěle`, body: 'Dnešní čtení ještě čeká. Jedna kapitola a série pokračuje, to dáš!' },
    { title: `Tvoje série má ${nn}! 🔥`, body: 'Pár minut s knihou a máš další den v kapse. Pojď na to!' },
    { title: 'Na téhle sérii se dá stavět 🧱', body: `${nn} čtení v řadě je super základ. Dnes ještě přidej svůj kousek.` },
    { title: 'Chvilka na knihu? 📚', body: `Tvoje série (${nn}) se na dnešek těší. Stačí pár stránek.` },
  ] : n < 30 ? [
    { title: `Wow, ${nn} v řadě! 🔥`, body: 'Takhle se buduje zvyk. Dnešní stránky ještě čekají, pojď na ně.' },
    { title: 'Jsi na skvělé cestě 🌟', body: `Série má ${nn}. Dnešní čtení ji udrží při životě a ty budeš mít další důvod k hrdosti.` },
    { title: `Držíš sérii už ${nn}!`, body: 'Přidej dnešní kousek, ať roste dál. Ty to umíš!' },
    { title: 'Ta série je tvoje pýcha 💪', body: `${nn} bez přestávky! Pár stránek a pokračuje dál.` },
  ] : [
    { title: `🔥 ${nn}! Jsi legenda`, body: 'Dnešní čtení udrží legendární sérii při životě. Pár stránek a hotovo.' },
    { title: `Série má ${nn}, to je síla!`, body: 'Takový výkon si zaslouží pokračování. Dnes ještě pár stránek?' },
    { title: 'Pomník vytrvalosti 🏆', body: `${nn} čtení v řadě. Přidej dnešní kapitolu a posuň rekord dál.` },
  ];
  if (t === 'morning') base.push(
    { title: 'Dobré ráno! ☀️', body: `Dnešní čtení ještě čeká a série (${nn}) se na něj těší. Začni pár stránkami.` },
    { title: 'Ranní kapitola? 📖', body: `Série má ${nn} a poroste, stačí chvilka čtení u snídaně.` },
  );
  if (t === 'evening') base.push(
    { title: 'Večer jako stvořený na čtení 🌙', body: `Pár stránek a série (${nn}) je zase o den delší. Zvládneš to!` },
  );
  if (t === 'late') base.push(
    { title: 'Ještě to stihneš! 🌟', body: `Do půlnoci zbývá čas na pár stránek. Série (${nn}) ti poděkuje.` },
    { title: 'Poslední výzva dne 🌙', body: 'Krátká kapitola před spaním a série žije dál. Dobrou chuť na čtení!' },
  );
  return base;
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

// Pochvala za dnešní čtení: ať si i ten, kdo už splnil, odnese dobrou zprávu.
const praise = (streak: number, t: Part): Msg[] => {
  const list: Msg[] = [
    { title: 'Dnešní čtení je splněno! 🎉', body: 'Skvělá práce, takhle se z čtení stává zvyk.' },
    { title: 'Dnes jsi na výbornou 🌟', body: 'Dnešní stránky máš za sebou. Tak dál!' },
    { title: 'Paráda, tohle se počítá 📚', body: 'Dnešní čtení je v kapse. Odpočiň si a zítra zase.' },
    { title: 'Dobrý pocit z přečtených stránek ✨', body: 'Užij si ho. Zítra tě čeká další příběh.' },
  ];
  if (streak >= 2) list.push(
    { title: `Série má ${days(streak)} 🔥`, body: 'Dnes máš splněno, zítra pokračuj. Je to skvělý příklad vytrvalosti!' },
    { title: 'Série roste a roste 💪', body: `${days(streak)} v řadě. Dnešní čtení se do ní právě zapsalo.` },
  );
  if (t === 'evening' || t === 'late') list.push({ title: 'Dobrá práce, teď si odpočiň 🌙', body: 'Dnešní čtení je splněné. Užij si zbytek večera.' });
  return list;
};

const comeback = (n: number): Msg[] => {
  if (n <= 3) return [
    { title: 'Knihy na tebe čekají 📚', body: `Už ${days(n)} bez čtení, a to nevadí. Otevři knihu a navaž přesně tam, kde příběh čeká.` },
    { title: 'Záložka drží místo', body: 'Rozečtený příběh nikam neuteče. Otevři ho na chvilku, bude se ti líbit.' },
  ];
  if (n <= 7) return [
    { title: 'Vítej zpátky kdykoli 💛', body: 'Týden pauzy je v pořádku. Stačí pár stránek a zase to jede.' },
    { title: 'Pauza skončila, příběh pokračuje 📖', body: 'Jedna krátká kapitola na rozjezd. Zvládneš to!' },
  ];
  if (n <= 14) return [
    { title: 'Stýská se nám po tobě 👋', body: 'Žádný tlak, jen jedna krátká kapitola na rozjezd. Máš to v sobě!' },
    { title: 'Dobrý den na nový začátek ✨', body: 'Knihovna je pořád tvoje. Vyber si něco, co tě bude bavit.' },
  ];
  return [
    { title: 'Vítej zpátky! 🎉', body: 'Jomarid Books na tebe čekalo. Vyber si něco krátkého a začni znovu, každý začátek je dobrý.' },
    { title: 'Tvoje knihovna se rozzářila 💡', body: 'Dlouho jsme se neviděli. Dnes je skvělý den na novou kapitolu.' },
  ];
};

const continueBook = (title: string, pct: number, t: Part): Msg[] => {
  const k = short(title, 60);
  const list: Msg[] = [
    { title: `„${short(title, 40)}“ na tebe čeká 📖`, body: `Už máš ${pct} % hotovo, to je super! Pokračuj přesně od záložky.` },
    { title: 'Záložka drží místo', body: `V „${k}“ je hotovo ${pct} %. Dnešních pár stránek tě posune o kus dál.` },
    { title: `${pct} % je za tebou 🎉`, body: `Rozečtená kniha „${k}“ se na tebe těší. Navaž od záložky.` },
    { title: 'Dej příběhu další kousek ✨', body: `Dnes aspoň pár stránek z „${k}“ a posuneš se z ${pct} % dál.` },
  ];
  if (pct >= 70) list.push({ title: 'Cíl na dohled! 🏁', body: `Z „${k}“ zbývá už jen ${100 - pct} %. Dočti to, zvládneš to!` });
  if (pct < 30) list.push({ title: 'Začátek je nejtěžší, a ten už máš', body: `V „${k}“ je ${pct} %. Další stránky půjdou samy.` });
  if (t === 'evening' || t === 'late') list.push({ title: `Večer s „${short(title, 36)}“ 🌙`, body: `Odpočiň si u rozečtené knihy. Máš ${pct} % a každá další stránka je odměna.` });
  if (t === 'morning') list.push({ title: 'Ranní stránky ☀️', body: `„${k}“ je ideální společník k ranní kávě. Máš ${pct} %, pojď na další.` });
  return list;
};

const goalProgress = (goal: number, done: number, remaining: number): Msg[] => {
  if (remaining === 1) return [
    { title: 'Poslední kniha do cíle! 🎯', body: 'Už jen jedna kniha a měsíční cíl je tvůj. Odměna v mincích je na dosah, držíme ti palce!' },
    { title: 'Cíl je na dosah ruky ✨', body: 'Stačí dočíst ještě jednu knihu a měsíc je splněný. Dáš to!' },
  ];
  if (done === 0) return [
    { title: 'Nový cíl, nový začátek 🎯', body: `Cíl ${books(goal)} je dosažitelný. První kniha tě hned nakopne.` },
    { title: 'Ukazatel cíle čeká na první kus 📚', body: 'Vyber si kratší knihu a rozjeď to, každá se počítá.' },
  ];
  if (done * 2 >= goal) return [
    { title: `Přes půlku cíle: ${done} z ${goal} 🎯`, body: `Jde ti to skvěle! Zbývá ${books(remaining)}.` },
    { title: 'Cíl je na dosah 🌟', body: `Máš ${done} z ${goal}. Dnešní čtení tě posune blíž.` },
  ];
  return [
    { title: `Měsíční cíl: ${done} z ${goal}`, body: `Každá přečtená kniha se počítá. Zbývá ${books(remaining)}, to zvládneš!` },
    { title: 'Krok po kroku k cíli 🎯', body: `Zbývá ${books(remaining)}. Vyber si a pusť se do toho.` },
  ];
};

const coinsToSpend = (coins: number): Msg[] => [
  { title: `🪙 Máš ${coinsAcc(coins)} na novou knihu!`, body: 'Mrkni do knihovny, jaký příběh si odemkneš.' },
  { title: 'Peněženka se hlásí 🪙', body: `Na účtu je ${coinsText(coins)}. V knihovně na ně čeká další příběh.` },
  { title: 'Odměna za čtení čeká na využití', body: `Máš ${coinsAcc(coins)}, a to stačí na novou knihu. Vyber si něco dobrého.` },
  { title: 'Nová kniha je na dosah 🪙', body: 'Máš dost mincí na další příběh. Podívej se, co knihovna nabízí.' },
];

// Jemné popostrčení: obecné, podle denní doby i dne v týdnu (0 = neděle ... 6 = sobota, pražský čas).
const gentleNudge = (weekday: number, t: Part): Msg[] => {
  const list: Msg[] = [
    { title: 'Pár stránek ti udělá dobře 📖', body: 'Dej si chvilku jen pro sebe a knihu. Jomarid Books je připravené.' },
    { title: 'Čas na příběh ✨', body: 'Čaj, pohodlí a pár kapitol. Dnešek si to zaslouží.' },
    { title: 'Tvoje knihovna se na tebe těší', body: 'Žádný tlak, jen pár stránek ve chvíli, kdy se ti to hodí.' },
    { title: 'Dnes je dobrý den začít sérii 🔥', body: 'Přečti pár stránek a zapiš si první den. Zítra už to budou dva!' },
    { title: 'Každá stránka je malé vítězství', body: 'Otevři knihu a dej si jednu. Máš na to!' },
    { title: 'Hej, tvoje knihy na tebe mávají 👋', body: 'Pár minut čtení dokáže zázraky. Otevři Jomarid Books.' },
    { title: 'Malá pauza, velký efekt', body: 'Pár minut s knihou tě odpoutá od starostí. Vyzkoušej to!' },
  ];
  if (t === 'morning') list.push(
    { title: 'Dobré ráno! ☀️', body: 'Začni den pár stránkami. Dobrý příběh dělá dobré ráno.' },
    { title: 'Ranní káva a kniha ☕', body: 'Nejhezčí kombinace dne. Otevři Jomarid Books a vyber si.' },
  );
  if (t === 'day') list.push({ title: 'Polední pauza s knihou 🥪', body: 'Chvilka čtení během dne dobije baterky. Zkus to!' });
  if (t === 'evening' || t === 'late') list.push(
    { title: 'Klidný večer s knihou 🌙', body: 'Zpomal, odlož starosti a ponoř se do příběhu.' },
    { title: 'Večerní čtení je nejlepší 🛋️', body: 'Pár stránek před spaním a den končí hezky.' },
  );
  if (weekday === 1) list.push({ title: 'Pondělí zvládneš s dobrým příběhem', body: 'Start týdne se čtením vypadá líp. Pár stránek stačí.' });
  if (weekday === 5) list.push({ title: 'Pátek! Čas na knihu 📚', body: 'Týden je za námi. Odměň se pár stránkami do víkendu.' });
  if (weekday === 0 || weekday === 6) list.push(
    { title: 'Víkend voní papírem 📖', body: 'Žádný spěch, jen klid a dobrá kniha. Vyber si, co ti sedne.' },
    { title: 'Víkend je stvořený na čtení', body: 'Přikrývka, čaj a kapitola. Jomarid Books na tebe čeká.' },
  );
  return list;
};

const newBook = (title: string, author: string): Msg[] => {
  const t = short(title, 60);
  const by = author ? ` Od ${short(author, 40)}.` : '';
  return [
    { title: '📚 Nová kniha v knihovně', body: `Nově v knihovně: „${t}“.${by} Mrkni, jestli ti sedne.`, url: '/app' },
    { title: `Čerstvě přibylo: „${short(title, 36)}“`, body: `Nový příběh je na polici.${by} Možná je to přesně ono!`, url: '/app' },
    { title: 'Něco nového na polici 📖', body: `Knihovna se rozrostla o „${t}“.${by}`, url: '/app' },
  ];
};

// Vrátí hotový titulek a text, nebo null pro neznámý druh. rnd vybírá variantu (0 až <1); weekday (0 = neděle) a hour (0-23, pražský čas)
// přidávají varianty podle dne a denní doby.
export function compose(kind: unknown, data: Data | null | undefined, rnd: () => number = Math.random, weekday = 3, hour = 14): Msg | null {
  const d = data && typeof data === 'object' ? data : {};
  const t = partOf(Number.isFinite(hour) ? hour : 14);
  let list: Msg[];
  switch (kind) {
    case 'streak_risk': list = streakRisk(Math.max(1, whole(d.streak, 1)), t); break;
    case 'streak_milestone': list = milestone(Math.max(1, whole(d.streak, 1))); break;
    case 'praise': list = praise(whole(d.streak, 1), t); break;
    case 'comeback': list = comeback(Math.max(1, whole(d.days, 7))); break;
    case 'continue_book': list = continueBook(String(d.title ?? ''), Math.min(100, whole(d.percent)), t); break;
    case 'goal_progress': {
      const goal = Math.max(1, whole(d.goal, 1));
      const done = Math.min(whole(d.done), goal - 1);
      list = goalProgress(goal, done, Math.max(1, whole(d.remaining, goal - done)));
      break;
    }
    case 'coins_to_spend': list = coinsToSpend(whole(d.coins)); break;
    case 'gentle_nudge': list = gentleNudge(weekday, t); break;
    case 'new_book': list = newBook(String(d.title ?? ''), String(d.author ?? '')); break;
    default: return null;
  }
  const r = Math.floor(rnd() * list.length);
  const i = Number.isFinite(r) || r === Infinity ? Math.min(list.length - 1, Math.max(0, r)) : 0;
  const m = list[i];
  return { ...m, url: m.url ?? (kind === 'streak_milestone' ? '/stats' : '/app') };
}
export const MESSAGE_KINDS = ['streak_risk', 'streak_milestone', 'praise', 'comeback', 'continue_book', 'goal_progress', 'coins_to_spend', 'gentle_nudge', 'new_book'];

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
    const prague = new Date((deps.now?.() ?? new Date()).toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
    const m = compose(input.kind, input.data as Data, deps.rnd ?? Math.random, prague.getDay(), prague.getHours());
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

  // Zkušební oznámení se zpožděním: čeká se až po ověření hesla a složení textu, nejvýš 30 vteřin.
  const delay = Math.min(30, Math.max(0, Math.round(Number(input.delay_seconds)) || 0));
  if (delay > 0) await (deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(delay * 1000);

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
