// Integração Google Calendar.
// Método preferido: CONTA DE SERVIÇO — defina GOOGLE_SERVICE_ACCOUNT_JSON (o conteúdo do arquivo JSON da conta de serviço).
//   Cada gestor compartilha o calendário dele com o e-mail da conta de serviço (permissão "Fazer alterações nos eventos").
// Método alternativo: OAuth com GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN.
// Sem credenciais, roda simulado (não quebra o app).
const crypto = require('crypto');

let SA = null;
try { if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) SA = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON); } catch (e) { console.error('GOOGLE_SERVICE_ACCOUNT_JSON inválido:', e.message); }

const USA_SA = !!(SA && SA.client_email && SA.private_key);
const USA_OAUTH = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
const ATIVO = USA_SA || USA_OAUTH;

let cacheToken = { valor: null, exp: 0 };

function base64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function tokenContaServico() {
  const agora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora, exp: agora + 3600,
  }));
  const assinatura = base64url(crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(SA.private_key));
  const jwt = `${header}.${claim}.${assinatura}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error('Google SA token: ' + await res.text());
  return (await res.json()).access_token;
}

async function tokenOAuth() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error('Google OAuth: ' + await res.text());
  return (await res.json()).access_token;
}

async function accessToken() {
  if (cacheToken.valor && Date.now() < cacheToken.exp) return cacheToken.valor;
  const tok = USA_SA ? await tokenContaServico() : await tokenOAuth();
  cacheToken = { valor: tok, exp: Date.now() + 3000 * 1000 };
  return tok;
}

async function listarEventos(calendarId, timeMin, timeMax) {
  if (!ATIVO) return { simulado: true, eventos: [] };
  const tok = await accessToken();
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) throw new Error('Google list: ' + await res.text());
  const json = await res.json();
  return { simulado: false, eventos: (json.items || []).map(e => ({ id: e.id, titulo: e.summary || '(sem título)', inicio: e.start?.dateTime || e.start?.date, fim: e.end?.dateTime || e.end?.date, local: e.location || '', link: e.htmlLink })) };
}

// Retorna apenas os intervalos OCUPADOS (sem detalhes) — respeita a privacidade do gestor.
async function freeBusy(calendarId, timeMin, timeMax) {
  if (!ATIVO) return { simulado: true, ocupados: [] };
  const tok = await accessToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone: 'America/Sao_Paulo', items: [{ id: calendarId }] }),
  });
  if (!res.ok) throw new Error('Google freeBusy: ' + await res.text());
  const json = await res.json();
  const cal = (json.calendars && json.calendars[calendarId]) || {};
  if (cal.errors && cal.errors.length) throw new Error('Google freeBusy cal: ' + JSON.stringify(cal.errors));
  return { simulado: false, ocupados: (cal.busy || []).map(b => ({ inicio: b.start, fim: b.end })) };
}

async function temConflito(calendarId, inicioISO, fimISO) {
  if (!ATIVO) return false;
  try { const { eventos } = await listarEventos(calendarId, inicioISO, fimISO); return eventos.length > 0; }
  catch (e) { return false; }
}

async function criarEvento(calendarId, { titulo, inicioISO, fimISO, local, descricao, timeZone = 'America/Sao_Paulo' }) {
  if (!ATIVO) return { simulado: true, id: 'sim-' + Date.now(), link: null };
  const tok = await accessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo, location: local || undefined, description: descricao || undefined,
      start: { dateTime: inicioISO, timeZone }, end: { dateTime: fimISO, timeZone },
    }),
  });
  if (!res.ok) throw new Error('Google create: ' + await res.text());
  const e = await res.json();
  return { simulado: false, id: e.id, link: e.htmlLink };
}

module.exports = { ATIVO, USA_SA, listarEventos, freeBusy, temConflito, criarEvento };
