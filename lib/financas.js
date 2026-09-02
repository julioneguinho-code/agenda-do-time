// Controle financeiro PESSOAL — dois perfis independentes (Julio e Ana), cada um com login/senha e dados próprios.
// Cada perfil: por mês -> Renda (item/valor) e Despesas (item/obs/valor/pago) + Metas + Carteira de investimentos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'troque-este-segredo-na-publicacao';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'financas.json');
const SEED = path.join(__dirname, '..', 'data', 'financas.seed.json');

const USUARIOS = ['julio', 'ana'];
const SENHA_PADRAO = { julio: 'julio2026', ana: 'ana2026' };
const LABEL = { julio: 'Julio', ana: 'Ana' };

function hash(s, sal) { return crypto.createHash('sha256').update(sal + ':' + s).digest('hex'); }
function novoPerfil(senhaPadrao, base) {
  const sal = crypto.randomBytes(8).toString('hex');
  base = base || {};
  return { senhaSal: sal, senhaHash: hash(senhaPadrao, sal), meses: base.meses || {}, metas: base.metas || [], invest: base.invest || [] };
}
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; } }
function save(d) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); } catch (e) { console.error('fin save:', e.message); } }
function db() {
  let d = load();
  if (!d) {
    let base = { meses: {}, metas: [] };
    try { if (fs.existsSync(SEED)) base = JSON.parse(fs.readFileSync(SEED, 'utf8')); } catch (e) { console.error('fin seed:', e.message); }
    d = { usuarios: { julio: novoPerfil(SENHA_PADRAO.julio, base), ana: novoPerfil(SENHA_PADRAO.ana, {}) } };
    save(d);
  }
  // migração do formato antigo (perfil único no topo) -> usuarios.julio
  if (!d.usuarios) {
    d = { usuarios: { julio: { senhaSal: d.senhaSal, senhaHash: d.senhaHash, meses: d.meses || {}, metas: d.metas || [], invest: d.invest || [] }, ana: novoPerfil(SENHA_PADRAO.ana, {}) } };
    save(d);
  }
  // garante os dois perfis e seus campos
  let mudou = false;
  USUARIOS.forEach(u => {
    if (!d.usuarios[u]) { d.usuarios[u] = novoPerfil(SENHA_PADRAO[u], {}); mudou = true; }
    const P = d.usuarios[u];
    if (!P.meses) { P.meses = {}; mudou = true; }
    if (!P.metas) { P.metas = []; mudou = true; }
    if (!P.invest) { P.invest = []; mudou = true; }
  });
  if (mudou) save(d);
  return d;
}
function usuarioValido(u) { return USUARIOS.includes(String(u || '').toLowerCase()) ? String(u).toLowerCase() : null; }
function perfil(d, u) { return d.usuarios[usuarioValido(u) || 'julio']; }

function sign(p) { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); const s = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); return b + '.' + s; }
function verify(t) {
  if (!t) return null; const [b, s] = t.split('.'); if (!b || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  try { if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null; const p = JSON.parse(Buffer.from(b, 'base64url').toString()); if (p.exp < Date.now()) return null; return p; } catch (e2) { return null; }
}
function login(usuario, senha) {
  const u = usuarioValido(usuario);
  if (!u) return null;
  const d = db(); const P = d.usuarios[u];
  if (hash(senha, P.senhaSal) !== P.senhaHash) return null;
  const secure = (process.env.PROD === '1' || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  return { usuario: u, nome: LABEL[u], cookie: `finsessao=${sign({ fin: true, u, exp: Date.now() + 7 * 864e5 })}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}` };
}
function sessao(req) { const c = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('='))); const p = verify(c.finsessao); return (p && p.fin) ? p : null; }
function clearCookie() { return 'finsessao=; HttpOnly; Path=/; Max-Age=0'; }
function perfilInfo(u) { const uu = usuarioValido(u) || 'julio'; return { usuario: uu, nome: LABEL[uu], usuarios: USUARIOS.map(x => ({ usuario: x, nome: LABEL[x] })) }; }
function trocarSenha(u, atual, nova) {
  const d = db(); const P = perfil(d, u);
  if (hash(atual, P.senhaSal) !== P.senhaHash) return { erro: 'Senha atual incorreta' };
  if (!nova || String(nova).length < 4) return { erro: 'A nova senha deve ter pelo menos 4 caracteres' };
  P.senhaSal = crypto.randomBytes(8).toString('hex'); P.senhaHash = hash(nova, P.senhaSal); save(d);
  return { ok: true };
}

const n2 = v => Math.round((+v || 0) * 100) / 100;
// Metas com o total acumulado (aporte manual + despesas vinculadas àquela meta em todos os meses)
function acumuladoMetas(P) {
  const soma = {};
  Object.values(P.meses || {}).forEach(m => (m.despesa || []).forEach(l => { if (l.meta) soma[l.meta] = (soma[l.meta] || 0) + n2(l.valor); }));
  return (P.metas || []).map(m => ({ nome: m.nome, alvo: n2(m.alvo), guardado: n2(m.guardado), img: m.img || '', vinculado: n2(soma[m.nome] || 0), guardadoTotal: n2((+m.guardado || 0) + (soma[m.nome] || 0)) }));
}
function totais(m) {
  const receitas = (m.renda || []).reduce((s, l) => s + n2(l.valor), 0);
  const despesas = (m.despesa || []).reduce((s, l) => s + n2(l.valor), 0);
  return { receitas: n2(receitas), despesas: n2(despesas), saldo: n2(receitas - despesas) };
}
function mesVazio() { return { renda: [], despesa: [] }; }
function getMes(u, mes) {
  const d = db(); const P = perfil(d, u);
  mes = mes || new Date().toISOString().slice(0, 7);
  let m = P.meses[mes];
  if (!m) {
    const keys = Object.keys(P.meses).filter(k => k < mes).sort();
    const anterior = keys.length ? P.meses[keys[keys.length - 1]] : null;
    m = anterior ? JSON.parse(JSON.stringify(anterior)) : mesVazio();
  }
  return { mes, renda: m.renda || [], despesa: m.despesa || [], metas: acumuladoMetas(P), resumo: totais(m) };
}
function salvarMes(u, mes, renda, despesa) {
  if (!mes) return { erro: 'Mês inválido' };
  const d = db(); const P = perfil(d, u);
  const r = (renda || []).filter(x => (x.item && String(x.item).trim()) || +x.valor).map(x => ({ item: String(x.item || '').slice(0, 60), valor: n2(x.valor) }));
  const p = (despesa || []).filter(x => (x.item && String(x.item).trim()) || +x.valor).map(x => ({ item: String(x.item || '').slice(0, 60), obs: String(x.obs || '').slice(0, 40), valor: n2(x.valor), pago: !!x.pago, meta: String(x.meta || '').slice(0, 60), investimento: !!x.investimento }));
  P.meses[mes] = { renda: r, despesa: p };
  save(d);
  return { ok: true, resumo: totais(P.meses[mes]), metas: acumuladoMetas(P) };
}
function salvarMetas(u, metas) {
  const d = db(); const P = perfil(d, u);
  P.metas = (metas || []).filter(x => x.nome && String(x.nome).trim()).map(x => ({ nome: String(x.nome).slice(0, 60), alvo: n2(x.alvo), guardado: n2(x.guardado), img: String(x.img || '').slice(0, 1500000) }));
  save(d);
  return { ok: true, metas: P.metas };
}
function garantirMes(P, key) {
  if (P.meses[key]) return P.meses[key];
  const keys = Object.keys(P.meses).filter(k => k < key).sort();
  const ant = keys.length ? P.meses[keys[keys.length - 1]] : null;
  const m = ant ? JSON.parse(JSON.stringify(ant)) : { renda: [], despesa: [] };
  P.meses[key] = m; return m;
}
// Repete uma despesa parcelada (obs "N/T") nos meses seguintes, incrementando a parcela até a última
function propagarParcela(u, mesInicial, dsp) {
  const mm = String(dsp.obs || '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!mm) return { erro: 'A despesa precisa ter a parcela no formato N/T (ex: 3/10) para repetir.' };
  let n = +mm[1], t = +mm[2];
  if (t <= n) return { erro: 'A parcela já está na última (ou o total é menor). Nada a repetir.' };
  const data = db(); const P = perfil(data, u);
  let [y, mo] = mesInicial.split('-').map(Number);
  let count = 0;
  while (n < t && count < 240) {
    n++; mo++; if (mo > 12) { mo = 1; y++; }
    const key = y + '-' + String(mo).padStart(2, '0');
    const mes = garantirMes(P, key);
    const ex = (mes.despesa || []).find(x => x.item === dsp.item);
    if (ex) { ex.obs = n + '/' + t; ex.valor = n2(dsp.valor); ex.meta = dsp.meta || ''; ex.investimento = !!dsp.investimento; }
    else { mes.despesa.push({ item: dsp.item, obs: n + '/' + t, valor: n2(dsp.valor), pago: false, meta: dsp.meta || '', investimento: !!dsp.investimento }); }
    count++;
  }
  save(data);
  return { ok: true, meses: count };
}

function resumoAno(u, ano) {
  const d = db(); const P = perfil(d, u);
  ano = ano || String(new Date().getFullYear());
  let receitas = 0, despesas = 0; const meses = [];
  for (let i = 1; i <= 12; i++) {
    const k = ano + '-' + String(i).padStart(2, '0');
    const m = P.meses[k];
    const t = m ? totais(m) : { receitas: 0, despesas: 0, saldo: 0 };
    receitas += t.receitas; despesas += t.despesas;
    meses.push({ mes: k, ...t });
  }
  return { ano, receitas: n2(receitas), despesas: n2(despesas), saldo: n2(receitas - despesas), meses, metas: acumuladoMetas(P) };
}

function investimentosP(P, ano) {
  ano = ano || String(new Date().getFullYear());
  const mesN = {}; const porItem = {}; const lancs = [];
  for (let i = 1; i <= 12; i++) {
    const k = ano + '-' + String(i).padStart(2, '0');
    const m = P.meses[k];
    if (m) (m.despesa || []).forEach(l => { if (l.investimento) { mesN[k] = (mesN[k] || 0) + n2(l.valor); const nm = l.item || 'Outros'; porItem[nm] = (porItem[nm] || 0) + n2(l.valor); lancs.push({ mes: k, item: nm, valor: n2(l.valor), meta: l.meta || '', origem: 'despesa' }); } });
  }
  let aportes = 0, retiradas = 0;
  (P.invest || []).forEach(mv => { if (mv.tipo === 'aporte') aportes += n2(mv.valor); else if (mv.tipo === 'retirada') retiradas += n2(mv.valor); });
  const movimentos = (P.invest || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)) || String(b.id).localeCompare(String(a.id)))
    .map(mv => ({ id: mv.id, data: mv.data, tipo: mv.tipo, categoria: mv.categoria || 'Outros', valor: n2(mv.valor), obs: mv.obs || '' }));
  (P.invest || []).forEach(mv => { const k = String(mv.data || '').slice(0, 7); if (k.slice(0, 4) !== String(ano)) return; const sinal = mv.tipo === 'retirada' ? -1 : 1; const v = sinal * n2(mv.valor); mesN[k] = (mesN[k] || 0) + v; const nm = mv.categoria || 'Outros'; porItem[nm] = (porItem[nm] || 0) + v; lancs.push({ mes: k, item: nm, valor: v, meta: '', origem: mv.tipo }); });
  const meses = []; let total = 0;
  for (let i = 1; i <= 12; i++) { const k = ano + '-' + String(i).padStart(2, '0'); const t = n2(mesN[k] || 0); meses.push({ mes: k, total: t }); total += t; }
  const itens = Object.entries(porItem).map(([nome, valor]) => ({ nome, valor: n2(valor) })).filter(x => x.valor !== 0).sort((a, b) => b.valor - a.valor);
  lancs.sort((a, b) => String(b.mes).localeCompare(String(a.mes)));
  const carteira = { aportes: n2(aportes), retiradas: n2(retiradas), saldo: n2(aportes - retiradas) };
  return { ano, total: n2(total), meses, itens, lancamentos: lancs, carteira, movimentos };
}
function investimentos(u, ano) { const d = db(); return investimentosP(perfil(d, u), ano); }
function addInvest(u, { tipo, valor, categoria, data, obs } = {}) {
  const t = tipo === 'retirada' ? 'retirada' : 'aporte';
  const v = n2(valor);
  if (!(v > 0)) return { erro: 'Informe um valor maior que zero' };
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) ? data : new Date().toISOString().slice(0, 10);
  const d = db(); const P = perfil(d, u);
  P.invest.push({ id: 'i' + Date.now() + Math.random().toString(36).slice(2, 5), tipo: t, valor: v, categoria: String(categoria || 'Outros').slice(0, 60), data: dt, obs: String(obs || '').slice(0, 120) });
  save(d);
  return { ok: true, ...investimentosP(P, dt.slice(0, 4)) };
}
function removerInvest(u, id, ano) {
  const d = db(); const P = perfil(d, u);
  const i = (P.invest || []).findIndex(x => x.id === id);
  if (i < 0) return { erro: 'Lançamento não encontrado' };
  P.invest.splice(i, 1); save(d);
  return { ok: true, ...investimentosP(P, ano || String(new Date().getFullYear())) };
}

module.exports = { login, sessao, clearCookie, perfilInfo, trocarSenha, getMes, salvarMes, salvarMetas, resumoAno, investimentos, addInvest, removerInvest, propagarParcela, USUARIOS };
