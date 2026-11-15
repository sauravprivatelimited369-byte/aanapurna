// A stand-in push service for local and CI verification. Loopback only; never part of a deployment.
//
// It plays the two parts of Web Push this application does not own: the browser that subscribes and
// the push service that receives. It is deliberately strict, because a permissive double would say
// "delivered" to bytes a real service refuses:
//
//   * RFC 8292 (VAPID): the Authorization header must be `vapid t=<jwt>, k=<key>`; the JWT must be
//     ES256, signed by `k`, with `aud` equal to the push service's origin, an `exp` in the future and
//     at most 24 hours away, and a `sub` that is a mailto: or https: URL. `k` must be the application
//     server key the "browser" subscribed with - a different key is 403, exactly as with a real one.
//   * RFC 8291 / 8188 (aes128gcm): the body is decrypted with the subscriber's private key and auth
//     secret. A message that does not decrypt is 400. What is recorded is the plaintext the service
//     worker would be handed.
//   * RFC 8030: TTL is required (400 without it).
//
// The word before the first dash of an endpoint's last segment selects a behaviour:
//   ok     201                          gone   410 (the browser unsubscribed)
//   down   500 every time               flaky  503 once, then 201
//   twice  503 twice, then 201          hang   accepts the request and never answers
//
// Control (same port):
//   GET /control/subscribe?mode=ok&vapid=<applicationServerKey>   what pushManager.subscribe() returns
//   GET /control/received          every request seen, with the decrypted payload
//   GET /control/forget?token=...  the push service forgets a subscription (later pushes: 404)
//
// Endpoints are issued under PUSH_STAND_IN_ORIGIN, a public-looking https name, because that is the
// only shape the application accepts. `scripts/support/push-stand-in-redirect.mjs` routes that one name
// to this process inside the application under test.
import { createServer } from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.env.PUSH_STAND_IN_PORT ?? 2528);
const ORIGIN = process.env.PUSH_STAND_IN_ORIGIN ?? 'https://push.stand-in.test';
if (process.env.NODE_ENV === 'production') {
  console.error('The stand-in push service is for local verification only.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PUSH_STAND_IN_PORT must be a TCP port between 1 and 65535.');
  process.exit(1);
}

const b64u = (buffer) => Buffer.from(buffer).toString('base64url');
const fromB64u = (text) => Buffer.from(text, 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** token -> { ecdh, publicKey, auth, vapidPublicKey, attempts } */
const subscriptions = new Map();
const received = [];

/** RFC 8291 section 3.4 with RFC 8188 framing. Returns the plaintext or throws. */
function decryptAes128gcm(body, subscription) {
  if (body.length < 21) throw new Error('body too short for an aes128gcm header');
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const serverPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  if (idLength !== 65 || serverPublic[0] !== 0x04) throw new Error('keyid is not an uncompressed P-256 point');
  if (ciphertext.length > recordSize) throw new Error('more than one record');

  const shared = subscription.ecdh.computeSecret(serverPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), subscription.publicKey, serverPublic]);
  const ikm = hmac(hmac(subscription.auth, shared), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0', 'utf8'), Buffer.from([1])])).subarray(0, 12);

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  // The last record ends with the delimiter 0x02, optionally followed by zero padding.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (end < 0 || padded[end] !== 0x02) throw new Error('missing last-record delimiter');
  return padded.subarray(0, end).toString('utf8');
}

/** RFC 8292. Returns the validated claims or throws with the status a real service would use. */
function verifyVapid(authorization, subscription) {
  const refuse = (status, reason) => Object.assign(new Error(reason), { status });
  if (!authorization) throw refuse(401, 'missing Authorization');
  const match = /^vapid\s+t=([^,\s]+),\s*k=([^,\s]+)$/i.exec(authorization.trim());
  if (!match) throw refuse(401, 'Authorization is not the vapid scheme');
  const [, token, key] = match;
  if (key !== subscription.vapidPublicKey) throw refuse(403, 'application server key does not match the subscription');
  const parts = token.split('.');
  if (parts.length !== 3) throw refuse(401, 'malformed JWT');
  const header = JSON.parse(fromB64u(parts[0]).toString('utf8'));
  const claims = JSON.parse(fromB64u(parts[1]).toString('utf8'));
  if (header.alg !== 'ES256') throw refuse(401, `unexpected alg ${header.alg}`);
  const point = fromB64u(key);
  if (point.length !== 65 || point[0] !== 0x04) throw refuse(401, 'k is not an uncompressed P-256 point');
  const publicKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)) },
    format: 'jwk',
  });
  const signed = crypto.verify(
    'sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64u(parts[2]),
  );
  if (!signed) throw refuse(403, 'JWT signature does not verify against k');
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== ORIGIN) throw refuse(403, `aud ${claims.aud} is not ${ORIGIN}`);
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw refuse(403, 'JWT expired');
  if (claims.exp - now > 24 * 3600) throw refuse(403, 'JWT exp is more than 24 hours away');
  if (typeof claims.sub !== 'string' || !/^(mailto:.+@.+|https:\/\/.+)$/.test(claims.sub)) {
    throw refuse(403, 'sub is not a mailto: or https: URL');
  }
  return claims;
}

function handlePush(request, response, token, body) {
  const answer = (status, text = '') => { response.writeHead(status, { 'Content-Type': 'text/plain' }); response.end(text); };
  const subscription = subscriptions.get(token);
  const entry = { at: new Date().toISOString(), token, mode: token.split('-')[0] };
  // A subscription the service never issued, or has forgotten, is gone - like a real one that expired.
  if (!subscription) { received.push({ ...entry, status: 404, reason: 'unknown subscription' }); return answer(404, 'unknown subscription'); }
  subscription.attempts += 1;
  try {
    if (!('ttl' in request.headers)) throw Object.assign(new Error('TTL header is required'), { status: 400 });
    if (request.headers['content-encoding'] !== 'aes128gcm') throw Object.assign(new Error('Content-Encoding must be aes128gcm'), { status: 400 });
    const claims = verifyVapid(request.headers.authorization, subscription);
    let plaintext;
    try { plaintext = decryptAes128gcm(body, subscription); }
    catch (error) { throw Object.assign(new Error(`payload did not decrypt: ${error.message}`), { status: 400 }); }
    const details = {
      ...entry,
      attempt: subscription.attempts,
      ttl: request.headers.ttl,
      urgency: request.headers.urgency ?? null,
      vapid: { aud: claims.aud, sub: claims.sub },
      payload: JSON.parse(plaintext),
    };
    if (entry.mode === 'gone') { received.push({ ...details, status: 410 }); return answer(410, 'subscription unsubscribed'); }
    if (entry.mode === 'down') { received.push({ ...details, status: 500 }); return answer(500, 'push service unavailable'); }
    if (entry.mode === 'flaky' && subscription.attempts === 1) { received.push({ ...details, status: 503 }); return answer(503, 'try again'); }
    if (entry.mode === 'twice' && subscription.attempts <= 2) { received.push({ ...details, status: 503 }); return answer(503, 'try again'); }
    if (entry.mode === 'hang') { received.push({ ...details, status: 0, reason: 'never answered' }); return undefined; }
    received.push({ ...details, status: 201 });
    response.writeHead(201, { Location: `${ORIGIN}/message/${crypto.randomUUID()}` });
    return response.end();
  } catch (error) {
    const status = error.status ?? 500;
    received.push({ ...entry, status, reason: error.message });
    return answer(status, error.message);
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };

  if (request.method === 'GET' && url.pathname === '/control/subscribe') {
    const mode = url.searchParams.get('mode') ?? 'ok';
    const vapidPublicKey = url.searchParams.get('vapid');
    if (!vapidPublicKey) return json(400, { error: 'vapid (the applicationServerKey) is required, as it is in a browser' });
    const ecdh = crypto.createECDH('prime256v1');
    const publicKey = ecdh.generateKeys();
    const auth = crypto.randomBytes(16);
    const token = `${mode}-${crypto.randomBytes(12).toString('hex')}`;
    subscriptions.set(token, { ecdh, publicKey, auth, vapidPublicKey, attempts: 0 });
    return json(200, { endpoint: `${ORIGIN}/push/${token}`, expirationTime: null, keys: { p256dh: b64u(publicKey), auth: b64u(auth) } });
  }
  if (request.method === 'GET' && url.pathname === '/control/received') return json(200, received);
  if (request.method === 'GET' && url.pathname === '/control/forget') {
    return json(200, { forgotten: subscriptions.delete(url.searchParams.get('token')) });
  }
  if (request.method === 'GET' && url.pathname === '/control/ready') return json(200, { ready: true, origin: ORIGIN });

  const match = /^\/push\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (request.method !== 'POST' || !match) return json(404, { error: 'no such endpoint' });
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => handlePush(request, response, match[1], Buffer.concat(chunks)));
  return undefined;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Stand-in push service listening on 127.0.0.1:${port} as ${ORIGIN}; payloads are held in memory only.`);
});
