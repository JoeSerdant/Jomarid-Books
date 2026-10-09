// Supabase Edge Function "send-push": odešle Web Push na zařízení uživatele (nebo všech správců).
// Volá ji jen databáze (spouštěč v db/push-notifications.sql) se sdíleným heslem v hlavičce x-push-secret.
// Nastavení a nasazení: db/push/README.md. Potřebné tajné hodnoty (Edge Functions -> Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (např. mailto:ty@example.cz), PUSH_WEBHOOK_SECRET
// SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY dodává Supabase sám.
//
// Logika je ve funkci handle() se závislostmi zvenku, takže jde testovat v Node (src/tests/push.test.mjs) bez Deno a sítě.

export interface PushDeps {
  secret: string;
  sendWebPush: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<void>;
  listSubscriptions: (audience: 'user' | 'admins', userId: string | null) => Promise<Array<{ id: string; endpoint: string; p256dh: string; auth: string }>>;
  deleteSubscriptions: (ids: string[]) => Promise<void>;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
// Cíl kliknutí smí být jen cesta v téhle appce (ne cizí adresa).
const safeUrl = (v: unknown) => (typeof v === 'string' && /^\/(?!\/)[^\s]*$/.test(v) && v.length <= 200 ? v : '/');

export async function handle(req: Request, deps: PushDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!deps.secret || req.headers.get('x-push-secret') !== deps.secret) return json({ error: 'unauthorized' }, 401);
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const audience = input.audience === 'admins' ? 'admins' : input.audience === 'user' ? 'user' : null;
  const userId = typeof input.user_id === 'string' && UUID.test(input.user_id) ? input.user_id : null;
  if (!audience || (audience === 'user' && !userId)) return json({ error: 'bad_audience' }, 400);

  const payload = JSON.stringify({
    title: clip(input.title, 120) || 'Jomarid Books',
    body: clip(input.body, 200),
    url: safeUrl(input.url),
    tag: clip(input.tag, 80) || undefined,
  });

  const subs = await deps.listSubscriptions(audience, userId);
  const dead: string[] = [];
  let sent = 0;
  let failed = 0;
  const queue = [...subs];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        await deps.sendWebPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent += 1;
      } catch (e) {
        const status = Number((e as { statusCode?: number })?.statusCode);
        if (status === 404 || status === 410) dead.push(s.id); // odhlášené nebo smazané zařízení
        else failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  if (dead.length) { try { await deps.deleteSubscriptions(dead); } catch { /* příště */ } }
  return json({ sent, removed: dead.length, failed, total: subs.length });
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
      let ids: string[] = userId ? [userId] : [];
      if (audience === 'admins') {
        const { data } = await db.from('profiles').select('id').eq('role', 'správce');
        ids = (data ?? []).map((r: { id: string }) => r.id);
      }
      if (!ids.length) return [];
      const { data } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('user_id', ids);
      return data ?? [];
    },
    deleteSubscriptions: async (ids) => { await db.from('push_subscriptions').delete().in('id', ids); },
  };
  D.serve((req: Request) => handle(req, deps));
}
