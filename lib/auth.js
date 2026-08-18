// Autenticação simples: e-mail/senha + sessão por cookie assinado.
// Usuários ficam em data/usuarios.json (senhas com hash sha256 + sal).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET = process.env.APP_SECRET || 'troque-este-segredo-na-publicacao';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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

function hashSenha(senha, sal) {
  return crypto.createHash('sha256').update(sal + ':' + senha).digest('hex');
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
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
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
  if (hashSenha(senha, user.sal) !== user.hash) return null;
  if (user.ativo === false) return { bloqueado: true };
  const payload = {
    email: user.email, nome: user.nome, papel: user.papel,
    consultorPageId: user.consultorPageId || null,
    time: user.time || null, calendarId: user.calendarId || null,
    master: user.master === true || String(user.email || '').toLowerCase() === 'gestorchama',
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const token = sign(payload);
  const secure = (process.env.PROD === '1' || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  return { papel: user.papel, cookie: `sessao=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}` };
}

function getSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
  return verify(cookies.sessao);
}

function clearCookie() { return 'sessao=; HttpOnly; Path=/; Max-Age=0'; }

// util para gerar usuários: node -e "require('./lib/auth').criarUsuario(...)"
function criarUsuario(email, senha, nome, papel, extras = {}) {
  const users = loadUsers();
  const sal = crypto.randomBytes(8).toString('hex');
  const novo = { email, nome, papel, sal, hash: hashSenha(senha, sal), ...extras };
  const idx = users.findIndex(u => u.email === email);
  if (idx >= 0) users[idx] = novo; else users.push(novo);
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return novo;
}

function trocarSenha(email, senhaAtual, novaSenha) {
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  if (hashSenha(senhaAtual, u.sal) !== u.hash) return { erro: 'Senha atual incorreta' };
  if (!novaSenha || String(novaSenha).length < 4) return { erro: 'A nova senha deve ter pelo menos 4 caracteres' };
  u.sal = crypto.randomBytes(8).toString('hex');
  u.hash = hashSenha(novaSenha, u.sal);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true };
}

function listarUsuarios() {
  return loadUsers().map(u => ({ email: u.email, nome: u.nome, papel: u.papel, time: u.time || '', calendarId: u.calendarId || '', ativo: u.ativo !== false, cargo: u.cargo || '', cor: u.cor || '', master: u.master === true || String(u.email || '').toLowerCase() === 'gestorchama' }));
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
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  return { ok: true };
}

module.exports = { login, getSession, clearCookie, criarUsuario, listarUsuarios, removerUsuario, redefinirSenha, atualizarUsuario, trocarSenha };
