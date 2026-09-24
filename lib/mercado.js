// Indicadores de mercado do Banco Central (SGS) — Selic e taxas médias de financiamento.
// Busca 1x/dia, guarda em cache (memória + /data/mercado.json) e é tolerante a falha:
// se o BCB estiver fora do ar, mantém o último valor bom. Usado pelos simuladores.
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'mercado.json');

// séries do SGS: selic meta (% a.a.), veículos PF (% a.m.), imobiliário taxas de mercado PF (% a.m.)
const SERIES = { selic: 432, veiculosAM: 25471, imovelAM: 25497 };
const UM_DIA = 24 * 60 * 60 * 1000;

let cache = { selic: null, veiculosAM: null, imovelAM: null, atualizadoEm: null, fontes: {} };
let _lastFetch = 0;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000, headers: { 'Accept': 'application/json' } }, res => {
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchSerie(cod) {
  const j = await getJSON(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cod}/dados/ultimos/1?formato=json`);
  const it = Array.isArray(j) && j[0];
  if (!it || it.valor == null) return null;
  const valor = parseFloat(String(it.valor).replace(',', '.'));
  return isFinite(valor) ? { valor, data: it.data } : null;
}

function loadCache() {
  try { if (fs.existsSync(CACHE_FILE)) { cache = Object.assign(cache, JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))); } } catch (e) {}
}
function saveCache() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); } catch (e) {}
}

async function atualizar() {
  for (const [k, cod] of Object.entries(SERIES)) {
    try { const r = await fetchSerie(cod); if (r) { cache[k] = r.valor; cache.fontes[k] = { serie: cod, ref: r.data }; } }
    catch (e) { /* mantém o último valor bom */ }
  }
  cache.atualizadoEm = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  _lastFetch = Date.now();
  saveCache();
  return cache;
}

// responde já com o cache; se estiver velho (>20h) dispara atualização em background (não bloqueia)
function getMercado() {
  if (Date.now() - _lastFetch > 20 * 60 * 60 * 1000) atualizar().catch(() => {});
  return cache;
}

loadCache();
atualizar().catch(() => {}); // primeira carga no boot (assíncrona)
const _timer = setInterval(() => atualizar().catch(() => {}), UM_DIA);
if (_timer.unref) _timer.unref();

module.exports = { getMercado, atualizar };
