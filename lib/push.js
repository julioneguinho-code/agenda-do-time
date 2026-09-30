// Notificações PUSH (Web Push) — zero dependências.
// Criptografia da mensagem: RFC 8291 (aes128gcm) · Autenticação do servidor: VAPID (RFC 8292, ES256).
// As chaves VAPID são geradas no 1º boot e guardadas em data/vapid.json (ou vêm de VAPID_PUBLIC / VAPID_PRIVATE).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUJEITO = process.env.VAPID_SUBJECT || process.env.PUBLIC_URL || 'https://gestao-chama.onrender.com';

const b64u = buf => Buffer.from(buf).toString('base64url');
const deB64u = s => Buffer.from(String(s || ''), 'base64url');

// ---- chaves VAPID (P-256) ----
function carregarChaves() {
  if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) return { publicKey: process.env.VAPID_PUBLIC, privateKey: process.env.VAPID_PRIVATE };
  try { const j = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); if (j.publicKey && j.privateKey) return j; } catch (e) {}
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const chaves = { publicKey: b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)])), privateKey: jwk.d };
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(VAPID_FILE, JSON.stringify(chaves)); } catch (e) { console.error('vapid:', e.message); }
  return chaves;
}
const CHAVES = carregarChaves();
function chavePrivadaObj() {
  const pub = deB64u(CHAVES.publicKey);
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: CHAVES.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
}
let _chaveObj = null;

// ---- JWT VAPID (ES256), um por serviço de push, reaproveitado por ~11 h ----
const _jwtCache = new Map();
function jwtVapid(audience) {
  const c = _jwtCache.get(audience);
  const agora = Math.floor(Date.now() / 1000);
  if (c && c.exp - agora > 3600) return c.token;
  const exp = agora + 12 * 3600;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64u(JSON.stringify({ aud: audience, exp, sub: SUJEITO }));
  _chaveObj = _chaveObj || chavePrivadaObj();
  const assinatura = crypto.sign('sha256', Buffer.from(cab + '.' + corpo), { key: _chaveObj, dsaEncoding: 'ieee-p1363' });
  const token = cab + '.' + corpo + '.' + b64u(assinatura);
  _jwtCache.set(audience, { token, exp });
  return token;
}

// ---- criptografia RFC 8291 (aes128gcm) ----
function hkdf(sal, ikm, info, tam) { return Buffer.from(crypto.hkdfSync('sha256', ikm, sal, info, tam)); }
// opts.senderPrivate / opts.salt existem só para o teste com o exemplo oficial da RFC
function criptografar(payload, p256dh, auth, opts = {}) {
  const uaPublic = deB64u(p256dh), segredo = deB64u(auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.senderPrivate) ecdh.setPrivateKey(deB64u(opts.senderPrivate)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const compartilhado = ecdh.computeSecret(uaPublic);
  const ikm = hkdf(segredo, compartilhado, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const sal = opts.salt ? deB64u(opts.salt) : crypto.randomBytes(16);
  const cek = hkdf(sal, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(sal, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const texto = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = último registro, sem preenchimento
  const corpoCifrado = Buffer.concat([cifra.update(texto), cifra.final(), cifra.getAuthTag()]);
  const cab = Buffer.alloc(21); sal.copy(cab, 0); cab.writeUInt32BE(4096, 16); cab.writeUInt8(asPublic.length, 20);
  return Buffer.concat([cab, asPublic, corpoCifrado]);
}

// Envia uma notificação. Devolve { ok } ou { expirada: true } (inscrição não vale mais → apagar).
async function enviar(inscricao, dados) {
  try {
    if (!inscricao || !inscricao.endpoint || !inscricao.keys) return { expirada: true };
    const url = new URL(inscricao.endpoint);
    if (url.protocol !== 'https:') return { expirada: true };
    const corpo = criptografar(JSON.stringify(dados).slice(0, 3000), inscricao.keys.p256dh, inscricao.keys.auth);
    const r = await fetch(inscricao.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: '86400', Urgency: 'normal', Authorization: 'vapid t=' + jwtVapid(url.origin) + ', k=' + CHAVES.publicKey },
      body: corpo,
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404 || r.status === 410) return { expirada: true };
    if (!r.ok) return { erro: 'push ' + r.status };
    return { ok: true };
  } catch (e) { return { erro: String(e.message || e) }; }
}

function chavePublica() { return CHAVES.publicKey; }

module.exports = { enviar, chavePublica, criptografar };
