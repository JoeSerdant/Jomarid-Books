// Klíče VAPID (identita odesílatele Web Push): pár ECDSA P-256. Generuje se v prohlížeči správce, aby se soukromý klíč nikdy
// neposílal přes chat ani repozitář: ukáže se jednou a správce ho vloží do Supabase (db/push/README.md).

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Vrací { publicKey (87 znaků, 65 bajtů), privateKey (43 znaků, 32 bajtů) } v base64url, jak je chce knihovna web-push. */
export const generateVapidKeys = async (cryptoImpl = globalThis.crypto) => {
  const subtle = cryptoImpl?.subtle;
  if (!subtle) throw new Error('Prohlížeč neumí WebCrypto.');
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)));
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey: jwk.d };
};

export const isVapidPublicKey = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{87}$/.test(v);
export const isVapidPrivateKey = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);

/** base64url -> Uint8Array (applicationServerKey pro pushManager.subscribe). */
export const urlBase64ToUint8Array = (str) => {
  const pad = '='.repeat((4 - (String(str).length % 4)) % 4);
  const raw = atob((String(str) + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
