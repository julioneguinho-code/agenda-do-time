// Controle financeiro PESSOAL — módulo separado (login/senha próprios, cookie 'finsessao').
// Modelo igual à planilha: por mês -> Renda (item/valor) e Despesas (item/obs/valor/pago) + Metas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'troque-este-segredo-na-publicacao';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'financas.json');
const SEED = path.join(__dirname, '..', 'data', 'financas.seed.json');
const SENHA_PADRAO = 'julio2026';

function hash(s, sal) { return crypto.createHash('sha256').update(sal + ':' + s).digest('hex'); }
function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; } }
function save(d) { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); } catch (e) { console.error('fin save:', e.message); } }
function db() {
  let d = load();
  if (!d) {
    let base = { meses: {}, metas: [] };
    try { if (fs.existsSync(SEED)) base = JSON.parse(fs.readFileSync(SEED, 'utf8')); } catch (e) { console.error('fin seed:', e.message); }
    const sal = crypto.randomBytes(8).toString('hex');
    d = { senhaSal: sal, senhaHash: hash(SENHA_PADRAO, sal), meses: base.meses || {}, metas: base.metas || [] };
    save(d);
  }
  if (!d.meses) d.meses = {};
  if (!d.metas) d.metas = [];
  return d;
}

function sign(p) { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); const s = crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); return b + '.' + s; }
function verify(t) {
  if (!t) return null; const [b, s] = t.split('.'); if (!b || !s) return null;
  const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  try { if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null; const p = JSON.parse(Buffer.from(b, 'base64url').toString()); if (p.exp < Date.now()) return null; return p; } catch (e2) { return null; }
}
function login(senha) {
  const d = db();
  if (hash(senha, d.senhaSal) !== d.senhaHash) return null;
  const secure = (process.env.PROD === '1' || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  return { cookie: `finsessao=${sign({ fin: true, exp: Date.now() + 7 * 864e5 })}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}` };
}
function sessao(req) { const c = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('='))); const p = verify(c.finsessao); return (p && p.fin) ? p : null; }
function clearCookie() { return 'finsessao=; HttpOnly; Path=/; Max-Age=0'; }
function trocarSenha(atual, nova) {
  const d = db();
  if (hash(atual, d.senhaSal) !== d.senhaHash) return { erro: 'Senha atual incorreta' };
  if (!nova || String(nova).length < 4) return { erro: 'A nova senha deve ter pelo menos 4 caracteres' };
  d.senhaSal = crypto.randomBytes(8).toString('hex'); d.senhaHash = hash(nova, d.senhaSal); save(d);
  return { ok: true };
}

const n2 = v => Math.round((+v || 0) * 100) / 100;
function totais(m) {
  const receitas = (m.renda || []).reduce((s, l) => s + n2(l.valor), 0);
  const despesas = (m.despesa || []).reduce((s, l) => s + n2(l.valor), 0);
  return { receitas: n2(receitas), despesas: n2(despesas), saldo: n2(receitas - despesas) };
}
function mesVazio() { return { renda: [], despesa: [] }; }
function getMes(mes) {
  const d = db();
  mes = mes || new Date().toISOString().slice(0, 7);
  let m = d.meses[mes];
  if (!m) {
    // herda a estrutura do mês anterior mais recente (mantém itens e valores fixos)
    const keys = Object.keys(d.meses).filter(k => k < mes).sort();
    const anterior = keys.length ? d.meses[keys[keys.length - 1]] : null;
    m = anterior ? JSON.parse(JSON.stringify(anterior)) : mesVazio();
  }
  return { mes, renda: m.renda || [], despesa: m.despesa || [], metas: d.metas || [], resumo: totais(m) };
}
function salvarMes(mes, renda, despesa) {
  if (!mes) return { erro: 'Mês inválido' };
  const d = db();
  const r = (renda || []).filter(x => (x.item && String(x.item).trim()) || +x.valor).map(x => ({ item: String(x.item || '').slice(0, 60), valor: n2(x.valor) }));
  const p = (despesa || []).filter(x => (x.item && String(x.item).trim()) || +x.valor).map(x => ({ item: String(x.item || '').slice(0, 60), obs: String(x.obs || '').slice(0, 40), valor: n2(x.valor), pago: !!x.pago }));
  d.meses[mes] = { renda: r, despesa: p };
  save(d);
  return { ok: true, resumo: totais(d.meses[mes]) };
}
function salvarMetas(metas) {
  const d = db();
  d.metas = (metas || []).filter(x => x.nome && String(x.nome).trim()).map(x => ({ nome: String(x.nome).slice(0, 60), alvo: n2(x.alvo), guardado: n2(x.guardado) }));
  save(d);
  return { ok: true, metas: d.metas };
}
function resumoAno(ano) {
  const d = db();
  ano = ano || String(new Date().getFullYear());
  let receitas = 0, despesas = 0; const meses = [];
  for (let i = 1; i <= 12; i++) {
    const k = ano + '-' + String(i).padStart(2, '0');
    const m = d.meses[k];
    const t = m ? totais(m) : { receitas: 0, despesas: 0, saldo: 0 };
    receitas += t.receitas; despesas += t.despesas;
    meses.push({ mes: k, ...t });
  }
  return { ano, receitas: n2(receitas), despesas: n2(despesas), saldo: n2(receitas - despesas), meses, metas: d.metas || [] };
}

module.exports = { login, sessao, clearCookie, trocarSenha, getMes, salvarMes, salvarMetas, resumoAno };
