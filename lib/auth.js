// Autenticação simples: e-mail/senha + sessão por cookie assinado.
// Usuários ficam em data/usuarios.json (senhas com hash sha256 + sal).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
// Segredo de sessão: usa APP_SECRET forte; se faltar ou for o default público,
// gera um segredo aleatório e PERSISTE em /data/.secret (evita cookie forjável).
function resolveSecret() {
  const env = process.env.APP_SECRET;
  if (env && env !== 'troque-este-segredo-na-publicacao' && env.length >= 16) return env;
  const f = path.join(DATA_DIR, '.secret');
  try { if (fs.existsSync(f)) { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } } catch (e) {}
  const gen = crypto.randomBytes(48).toString('hex');
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, gen); console.warn('APP_SECRET ausente/fraco — gerado e salvo em ' + f); } catch (e) { console.error('secret persist:', e.message); }
  return gen;
}
const SECRET = resolveSecret();
function getSecret() { return SECRET; }
const USERS_FILE = path.join(DATA_DIR, 'usuarios.json');
const SEED_FILE = path.join(__dirname, '..', 'data', 'usuarios.seed.json');
// Primeiro boot: se ainda não há usuários no volume, copia os acessos iniciais do seed
(function garantirSeed() {
  try {
    if (!fs.existsSync(USERS_FILE) && fs.existsSync(SEED_FILE)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.copyFileSync(SEED_FILE, USERS_FILE);
    }
  } catch (e) { console.error('seed usuarios:', e.message); }
})();

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

// hash forte (scrypt, embutido no Node). Prefixo "s2$" distingue do sha256 legado.
function hashSenha(senha, sal) {
  try { return 's2$' + crypto.scryptSync(String(senha), String(sal), 32).toString('hex'); }
  catch (e) { return crypto.createHash('sha256').update(sal + ':' + senha).digest('hex'); }
}
function hashSha256(senha, sal) { return crypto.createHash('sha256').update(sal + ':' + senha).digest('hex'); }
// confere a senha contra o hash guardado (scrypt novo OU sha256 legado)
function conferirSenha(senha, user) {
  const h = String(user.hash || '');
  if (h.startsWith('s2$')) { try { return h === ('s2$' + crypto.scryptSync(String(senha), String(user.sal), 32).toString('hex')); } catch (e) { return false; } }
  return h === hashSha256(senha, user.sal); // legado
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

async function login(email, senha) {
  if (!email || !senha) return null;
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (!user) return null;
  if (!conferirSenha(senha, user)) return null;
  if (user.ativo === false) return { bloqueado: true };
  // upgrade transparente: se ainda é hash antigo (sha256), regrava com scrypt
  if (!String(user.hash || '').startsWith('s2$')) { try { user.hash = hashSenha(senha, user.sal); fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch (e) {} }
  const payload = {
    email: user.email, nome: user.nome, papel: user.papel,
    consultorPageId: user.consultorPageId || null,
    time: user.time || null, calendarId: user.calendarId || null,
    master: user.master === true || String(user.email || '').toLowerCase() === 'gestorchama',
    // IMPORTANTE: NÃO guardar a foto (base64) aqui — deixaria o cookie grande demais e o navegador o descartaria (login não persistia). A foto é carregada do banco no painel/home.
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const token = sign(payload);
  const secure = (process.env.PROD === '1' || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  return { papel: user.papel, cookie: `sessao=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}` };
}

function getSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
  const s = verify(cookies.sessao);
  if (!s) return null;
  // REVALIDA contra o cadastro ATUAL: papel/master/time/nome podem ter mudado desde que o
  // token foi emitido (o cookie vale 7 dias). Se o acesso foi desativado ou removido, invalida a sessão.
  try {
    const u = loadUsers().find(x => String(x.email || '').toLowerCase() === String(s.email || '').toLowerCase());
    if (!u) return null;
    if (u.ativo === false) return null;
    s.papel = u.papel;
    s.nome = u.nome;
    s.time = u.time || null;
    s.calendarId = u.calendarId || null;
    s.master = u.master === true || String(u.email || '').toLowerCase() === 'gestorchama';
  } catch (e) { /* se não conseguir ler, mantém os dados do token */ }
  return s;
}

function clearCookie() { return 'sessao=; HttpOnly; Path=/; Max-Age=0'; }

// util para gerar usuários: node -e "require('./lib/auth').criarUsuario(...)"
function loginExiste(email) {
  const em = String(email || '').trim().toLowerCase();
  return loadUsers().some(u => String(u.email || '').trim().toLowerCase() === em);
}
function criarUsuario(email, senha, nome, papel, extras = {}) {
  const users = loadUsers();
  const em = String(email || '').trim().toLowerCase();
  if (!em) return { erro: 'Informe o usuário (login)' };
  // NÃO deixa duplicar login: se já existir, bloqueia (não sobrescreve)
  if (users.some(u => String(u.email || '').trim().toLowerCase() === em)) return { erro: 'Já existe um acesso com esse usuário (login). Escolha outro.' };
  const sal = crypto.randomBytes(8).toString('hex');
  const novo = { email: em, nome, papel, sal, hash: hashSenha(senha, sal), ...extras };
  users.push(novo);
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return novo;
}

function trocarSenha(email, senhaAtual, novaSenha) {
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  if (!conferirSenha(senhaAtual, u)) return { erro: 'Senha atual incorreta' };
  if (!novaSenha || String(novaSenha).length < 4) return { erro: 'A nova senha deve ter pelo menos 4 caracteres' };
  u.sal = crypto.randomBytes(8).toString('hex');
  u.hash = hashSenha(novaSenha, u.sal);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true };
}

function listarUsuarios() {
  return loadUsers().map(u => ({ email: u.email, nome: u.nome, papel: u.papel, time: u.time || '', calendarId: u.calendarId || '', ativo: u.ativo !== false, cargo: u.cargo || '', cor: u.cor || '', metaVenda: +u.metaVenda || 0, foto: u.foto || '', master: u.master === true || String(u.email || '').toLowerCase() === 'gestorchama' }));
}

function removerUsuario(email) {
  const users = loadUsers().filter(u => u.email.toLowerCase() !== String(email).toLowerCase());
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true };
}

function redefinirSenha(email, novaSenha) {
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  u.sal = crypto.randomBytes(8).toString('hex');
  u.hash = hashSenha(novaSenha, u.sal);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true };
}

function atualizarUsuario(email, campos) {
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  if (campos.novoEmail != null && String(campos.novoEmail).trim() !== '') {
    const novo = String(campos.novoEmail).trim().toLowerCase();
    if (novo !== u.email.toLowerCase() && users.some(x => x.email.toLowerCase() === novo)) {
      return { erro: 'Já existe um acesso com esse usuário' };
    }
    u.email = novo;
  }
  if (campos.nome != null) u.nome = campos.nome;
  if (campos.papel != null) u.papel = campos.papel;
  if (campos.time != null) u.time = campos.time;
  if (campos.calendarId != null) u.calendarId = campos.calendarId;
  if (campos.ativo != null) u.ativo = campos.ativo;
  if (campos.cargo != null) u.cargo = campos.cargo;
  if (campos.cor != null) u.cor = campos.cor;
  if (campos.master != null) u.master = !!campos.master;
  if (campos.metaVenda != null) u.metaVenda = +campos.metaVenda || 0;
  if (campos.foto != null) u.foto = String(campos.foto).slice(0, 1500000);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true };
}

function redefinirSenhaPorPapel(papel, novaSenha) {
  const users = loadUsers(); let alterados = 0;
  users.forEach(u => { if (u.papel === papel) { u.sal = crypto.randomBytes(8).toString('hex'); u.hash = hashSenha(String(novaSenha || '1234'), u.sal); alterados++; } });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true, alterados };
}

module.exports = { login, getSession, getSecret, clearCookie, criarUsuario, loginExiste, listarUsuarios, removerUsuario, redefinirSenha, atualizarUsuario, trocarSenha, redefinirSenhaPorPapel };
