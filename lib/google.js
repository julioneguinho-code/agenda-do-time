// Integração Google Calendar.
// Ativa quando GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN existirem (definidos na publicação).
// Sem credenciais, roda em modo simulado (não quebra o app em demo).
const ATIVO = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

let cacheToken = { valor: null, exp: 0 };

async function accessToken() {
  if (cacheToken.valor && Date.now() < cacheToken.exp) return cacheToken.valor;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error('Google OAuth: ' + await res.text());
  const json = await res.json();
  cacheToken = { valor: json.access_token, exp: Date.now() + (json.expires_in - 60) * 1000 };
  return cacheToken.valor;
}

// Lista eventos de um calendário num intervalo
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

// Verifica se há evento ocupando um intervalo (para detectar conflito antes de aprovar)
async function temConflito(calendarId, inicioISO, fimISO) {
  if (!ATIVO) return false;
  const { eventos } = await listarEventos(calendarId, inicioISO, fimISO);
  return eventos.length > 0;
}

// Cria o evento aprovado e retorna { id, link }
async function criarEvento(calendarId, { titulo, inicioISO, fimISO, local, descricao, timeZone = 'America/Sao_Paulo' }) {
  if (!ATIVO) return { simulado: true, id: 'sim-' + Date.now(), link: null };
  const tok = await accessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: titulo,
      location: local || undefined,
      description: descricao || undefined,
      start: { dateTime: inicioISO, timeZone },
      end: { dateTime: fimISO, timeZone },
      visibility: 'private',
    }),
  });
  if (!res.ok) throw new Error('Google create: ' + await res.text());
  const e = await res.json();
  return { simulado: false, id: e.id, link: e.htmlLink };
}

module.exports = { ATIVO, listarEventos, temConflito, criarEvento };
