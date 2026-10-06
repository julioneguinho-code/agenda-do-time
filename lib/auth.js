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

// Leitura FRESCA do disco — usada só nos caminhos que ALTERAM o cadastro (login, criar, editar...).
// Se o arquivo principal estiver corrompido, usa o backup .bak. Se nenhum dos dois der para ler, NÃO devolve
// lista vazia (a próxima gravação apagaria todos os acessos) — lança erro e a operação é abortada.
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch (e1) {
    console.error('usuarios.json ilegível, tentando backup:', e1.message);
    try { return JSON.parse(fs.readFileSync(USERS_FILE + '.bak', 'utf8')); }
    catch (e2) { throw new Error('Cadastro de usuários ilegível (usuarios.json e .bak)'); }
  }
}
// Grava o cadastro (mesmo formato de sempre) e invalida o cache de leitura.
// Escrita ATÔMICA (temporário + rename) e backup rotativo .bak, como no estado.json.
let _ultimoBackupU = 0;
function gravarUsuarios(users) {
  if (!Array.isArray(users)) throw new Error('lista de usuários inválida');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const agora = Date.now();
  if (agora - _ultimoBackupU > 10 * 60000 && fs.existsSync(USERS_FILE)) {
    try { JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); fs.copyFileSync(USERS_FILE, USERS_FILE + '.bak'); _ultimoBackupU = agora; } catch (e) { /* não copia arquivo corrompido por cima do backup bom */ }
  }
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
  fs.renameSync(tmp, USERS_FILE);
  _cacheU.chave = '';
}

// Texto exibido nas telas (nome, time, cargo): tira os caracteres que permitiriam injetar HTML/JS.
function limpaTxt(v, max) { return String(v == null ? '' : v).replace(/[<>"`\\]/g, '').trim().slice(0, max || 200); }
// Login aceito: letras (com acento), números e . _ @ + -  (sem espaço, aspas ou símbolos que quebram as telas)
function loginValido(em) { return /^[\p{L}\p{N}._@+-]{1,80}$/u.test(String(em || '')); }

// ===== CACHE DE LEITURA (performance) =====
// Antes: cada consulta relia e decodificava o usuarios.json inteiro (com fotos) — em listas de vendas isso
// acontecia milhares de vezes por tela. Agora: lê 1x e só relê quando o arquivo muda (data/tamanho).
// v155: o arquivo só muda por este processo (gravarUsuarios zera a chave), então o stat do disco é feito
// no máximo 1x a cada 2 s (antes era 1 stat por consulta — milhares por tela). Índice por login = busca O(1).
const _cacheU = { chave: null, raw: [], lista: [], fotos: {}, porEmail: new Map(), rawPorEmail: new Map(), checado: 0 };
function _chaveArquivo() { try { const st = fs.statSync(USERS_FILE); return st.mtimeMs + ':' + st.size; } catch (e) { return 'sem-arquivo'; } }
function _usuariosCache() {
  const agora = Date.now();
  if (_cacheU.chave && agora - _cacheU.checado < 2000) return _cacheU;
  _cacheU.checado = agora;
  const k = _chaveArquivo();
  if (k !== _cacheU.chave) {
    const raw = loadUsers();
    const fotos = {};
    const porEmail = new Map(), rawPorEmail = new Map();
    const lista = raw.map(u => {
      const em = String(u.email || '').toLowerCase();
      rawPorEmail.set(em, u);
      let fotoUrl = '';
      if (u.foto && /^arq:[a-f0-9]{16,64}\.(jpg|png|webp|gif)$/i.test(String(u.foto))) {
        // v155: foto guardada em arquivo (data/fotos) — o usuarios.json fica pequeno
        const arq = String(u.foto).slice(4);
        const v = arq.slice(0, 12);
        fotos[em] = { arquivo: arq, v };
        fotoUrl = '/api/foto?u=' + encodeURIComponent(em) + '&v=' + v;
      } else if (u.foto && !/^data:image\//i.test(String(u.foto))) {
        fotoUrl = String(u.foto); // cadastro antigo com foto em link: mantém como estava
      } else if (u.foto) {
        const v = crypto.createHash('sha1').update(String(u.foto)).digest('hex').slice(0, 12);
        fotos[em] = { dado: String(u.foto), v };
        fotoUrl = '/api/foto?u=' + encodeURIComponent(em) + '&v=' + v;
      }
      const o = { email: u.email, nome: limpaTxt(u.nome, 80), papel: u.papel, time: limpaTxt(u.time, 40), calendarId: u.calendarId || '', ativo: u.ativo !== false, cargo: limpaTxt(u.cargo, 40), cor: u.cor || '', metaVenda: +u.metaVenda || 0, foto: fotoUrl, equipes: Object.freeze(Array.isArray(u.equipes) ? u.equipes.map(t => limpaTxt(t, 40)) : []), timeAtivo: limpaTxt(u.timeAtivo, 40), master: u.master === true || em === 'gestorchama', nivel: nivelDe(u), superior: String(u.superior || '').toLowerCase(), verEstrutura: u.verEstrutura !== false };
      return o;
    });
    // v174: consultor SEM "Responde a" fica automaticamente abaixo do gestor dono do time dele (time principal).
    // Assim, ao pendurar um laranja embaixo de um roxo, os vermelhos do time dele vão junto. "Responde a" manual vale por cima.
    const donoDoTime = new Map();
    for (const o of lista) if (o.papel === 'gestor' && o.ativo !== false && o.time) {
      const r = rankNivel(o.nivel), d = donoDoTime.get(o.time);
      if (!d || r < d.r) donoDoTime.set(o.time, { l: String(o.email).toLowerCase(), r });
    }
    // v175: time sem gestor principal → fica com o gestor que tem esse time como EXTRA ("Minhas equipes")
    const extra = new Map();
    for (const o of lista) if (o.papel === 'gestor' && o.ativo !== false) for (const t of (o.equipes || [])) {
      if (!t || t === o.time || donoDoTime.has(t)) continue;
      const r = rankNivel(o.nivel), d = extra.get(t);
      if (!d || r < d.r) extra.set(t, { l: String(o.email).toLowerCase(), r });
    }
    for (const [t, d] of extra) donoDoTime.set(t, d);
    for (const o of lista) {
      o.superiorManual = o.superior; o.superiorPeloTime = false;
      if (o.papel !== 'gestor' && !o.superior && o.time) { const d = donoDoTime.get(o.time); if (d && d.l !== String(o.email).toLowerCase()) { o.superior = d.l; o.superiorPeloTime = true; } }
      Object.freeze(o); porEmail.set(String(o.email || '').toLowerCase(), o);
    }
    _cacheU.chave = k; _cacheU.raw = raw; _cacheU.lista = lista; _cacheU.fotos = fotos; _cacheU.porEmail = porEmail; _cacheU.rawPorEmail = rawPorEmail;
  }
  return _cacheU;
}
// busca O(1) por login (objeto congelado, igual ao de listarUsuarios)
function usuarioPorEmail(email) { return _usuariosCache().porEmail.get(String(email || '').toLowerCase()) || null; }

// ===== FOTOS EM ARQUIVO (v155) =====
const FOTOS_DIR = path.join(DATA_DIR, 'fotos');
const EXT_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
// grava um data URI de imagem em data/fotos/<sha>.<ext> e devolve a referência "arq:<arquivo>"
function salvarFotoArquivo(dataUri) {
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/i.exec(String(dataUri || ''));
  if (!m) return null;
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 1200000) return null;
  const nome = crypto.createHash('sha1').update(buf).digest('hex') + '.' + ext;
  fs.mkdirSync(FOTOS_DIR, { recursive: true });
  const alvo = path.join(FOTOS_DIR, nome);
  if (!fs.existsSync(alvo)) fs.writeFileSync(alvo, buf);
  return 'arq:' + nome;
}
const _fotoBufCache = new Map(); // arquivo -> Buffer (fotos são pequenas; guarda as últimas 200)
// Foto de um usuário (binário) para a rota /api/foto
function fotoDoUsuario(email) {
  const f = _usuariosCache().fotos[String(email || '').toLowerCase()];
  if (!f) return null;
  if (f.arquivo) {
    let buf = _fotoBufCache.get(f.arquivo);
    if (!buf) {
      try { buf = fs.readFileSync(path.join(FOTOS_DIR, f.arquivo)); } catch (e) { return null; }
      _fotoBufCache.set(f.arquivo, buf);
      if (_fotoBufCache.size > 200) _fotoBufCache.delete(_fotoBufCache.keys().next().value);
    }
    return { mime: EXT_MIME[f.arquivo.split('.').pop()] || 'image/jpeg', buf, v: f.v };
  }
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(f.dado);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], 'base64'), v: f.v };
}
// migração única: fotos base64 de dentro do usuarios.json passam para arquivos
(function migrarFotos() {
  try {
    if (!fs.existsSync(USERS_FILE)) return;
    const users = loadUsers(); let mudou = 0;
    users.forEach(u => { if (u.foto && /^data:image\//i.test(String(u.foto))) { const ref = salvarFotoArquivo(u.foto); if (ref) { u.foto = ref; mudou++; } } });
    if (mudou) { gravarUsuarios(users); console.log('fotos migradas para arquivo:', mudou); }
  } catch (e) { console.error('migrarFotos:', e.message); }
})();

// hash forte (scrypt, embutido no Node). Prefixo "s2$" distingue do sha256 legado.
function hashSenha(senha, sal) {
  try { return 's2$' + crypto.scryptSync(String(senha), String(sal), 32).toString('hex'); }
  catch (e) { return crypto.createHash('sha256').update(sal + ':' + senha).digest('hex'); }
}
function hashSha256(senha, sal) { return crypto.createHash('sha256').update(sal + ':' + senha).digest('hex'); }
// scrypt ASSÍNCRONO (roda fora da thread principal) — o login não congela o servidor para os outros usuários
function scryptAsync(senha, sal) { return new Promise((ok, err) => crypto.scrypt(String(senha), String(sal), 32, (e, k) => e ? err(e) : ok(k))); }
async function hashSenhaAsync(senha, sal) { try { return 's2$' + (await scryptAsync(senha, sal)).toString('hex'); } catch (e) { return hashSha256(senha, sal); } }
function igualSeguro(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
// confere a senha contra o hash guardado (scrypt novo OU sha256 legado)
async function conferirSenha(senha, user) {
  const h = String(user.hash || '');
  if (h.startsWith('s2$')) { try { return igualSeguro(h, 's2$' + (await scryptAsync(senha, user.sal)).toString('hex')); } catch (e) { return false; } }
  return igualSeguro(h, hashSha256(senha, user.sal)); // legado
}
const HASH_FALSO = { sal: 'x', hash: 's2$' + '0'.repeat(64) }; // usado p/ gastar o mesmo tempo quando o login não existe

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


// ===== MULTI-EQUIPE (gestor) =====
// O gestor tem o time PRINCIPAL (campo time) + equipes extras que ele criou/gerencia (campo equipes).
// timeAtivo = equipe que está aberta no quadro agora. Consultor tem sempre um único time.
// ===== ESTRUTURA DE GESTÃO (v172) =====
// ⚫ dono > ⚫⚪ sócio > ⚪ gestor de loja > 🟣 gestor de equipe > 🟠 supervisor > 🔴 consultor.
// Cada pessoa "responde a" (superior) alguém de nível ACIMA do dela — por isso não existe ciclo.
const NIVEIS = ['consultor', 'supervisor', 'gestorEquipe', 'gestorLoja', 'socio', 'dono'];
const COR_DO_NIVEL = { supervisor: '#FB923C', gestorEquipe: '#A78BFA', gestorLoja: '#9CA3AF', socio: 'gradpc', dono: '#111318' };
function rankNivel(n) { return NIVEIS.indexOf(n); }
// nível do cadastro; quem ainda não tem, recebe um padrão pelo papel/cor (nada muda para quem já usa o sistema)
function nivelDe(u) {
  if (!u) return 'consultor';
  if (NIVEIS.includes(u.nivel)) return u.nivel;
  if (u.papel !== 'gestor') return 'consultor';
  const c = String(u.cor || '').toUpperCase();
  return c === '#FB923C' ? 'supervisor' : c === '#9CA3AF' ? 'gestorLoja' : 'gestorEquipe';
}
// todos os logins abaixo de alguém na estrutura (filhos, netos...)
function abaixoDe(login, lista) {
  lista = lista || listarUsuarios();
  const filhos = new Map();
  for (const u of lista) { const s = u.superior; if (s) { if (!filhos.has(s)) filhos.set(s, []); filhos.get(s).push(u); } }
  const out = [], vistos = new Set([String(login || '').toLowerCase()]), fila = [String(login || '').toLowerCase()];
  while (fila.length) { const l = fila.shift(); for (const f of filhos.get(l) || []) { const fl = String(f.email).toLowerCase(); if (!vistos.has(fl)) { vistos.add(fl); out.push(f); fila.push(fl); } } }
  return out;
}
// equipes que a pessoa ENXERGA: as dela + as de toda a estrutura abaixo (não muda para quem vão os avisos)
function timesVisiveis(u) {
  if (!u) return [];
  const ts = new Set(timesDoUsuario(u));
  try { for (const d of abaixoDe(u.email)) { if (d.ativo === false) continue; for (const t of timesDoUsuario(d)) ts.add(t); } } catch (e) {}
  return [...ts];
}
// confere se a ligação é válida (superior acima; quem está abaixo continua abaixo)
function validarEstrutura(users, u, nivel, superior) {
  const r = rankNivel(nivel);
  if (r < 0) return 'Nível inválido';
  if ((nivel === 'consultor') !== (u.papel !== 'gestor')) return nivel === 'consultor' ? 'Consultor (vermelho) precisa ter papel Consultor' : 'Esse nível precisa ter papel Gestor';
  if (superior) {
    const sup = users.find(x => x.email.toLowerCase() === superior);
    if (!sup) return 'Superior não encontrado';
    if (sup.email.toLowerCase() === u.email.toLowerCase()) return 'A pessoa não pode responder a ela mesma';
    if (rankNivel(nivelDe(sup)) <= r) return `${sup.nome} (${ROTULO_NIVEL[nivelDe(sup)]}) não pode ficar acima de um ${ROTULO_NIVEL[nivel]}`;
  }
  const abaixo = users.filter(x => String(x.superior || '').toLowerCase() === u.email.toLowerCase() && rankNivel(nivelDe(x)) >= r);
  if (abaixo.length) return `${abaixo.map(x => x.nome).join(', ')} responde(m) a esta pessoa e tem nível igual ou maior — ajuste antes`;
  return '';
}
const ROTULO_NIVEL = { consultor: 'consultor (vermelho)', supervisor: 'supervisor (laranja)', gestorEquipe: 'gestor de equipe (roxo)', gestorLoja: 'gestor de loja (cinza)', socio: 'sócio de loja (preto e cinza)', dono: 'dono de loja (preto)' };

// v175: gestor desativado → todos abaixo dele (ligados à mão ou pelo time) passam para o chefe direto dele,
// gravado no "Responde a" de cada um. Reativar NÃO devolve (o Julio reorganiza à mão).
function repassarAbaixo(login) {
  const l = String(login || '').toLowerCase();
  const lista = listarUsuarios(); const eu = lista.find(u => String(u.email).toLowerCase() === l);
  if (!eu || eu.papel !== 'gestor') return { movidos: [], para: '' };
  // chefe direto ativo (se o direto também estiver desativado, sobe até achar um ativo)
  let para = eu.superior || ''; const vistos = new Set([l]);
  while (para && !vistos.has(para)) { vistos.add(para); const s2 = lista.find(u => String(u.email).toLowerCase() === para); if (!s2 || s2.ativo !== false) break; para = s2.superior || ''; }
  const filhos = lista.filter(u => String(u.superior || '').toLowerCase() === l && String(u.email).toLowerCase() !== l);
  if (!filhos.length) return { movidos: [], para };
  const users = loadUsers(); const movidos = [];
  for (const f of filhos) { const raw = users.find(x => x.email.toLowerCase() === String(f.email).toLowerCase()); if (raw) { raw.superior = para; movidos.push(f.nome); } }
  if (movidos.length) gravarUsuarios(users);
  return { movidos, para };
}

function timesDoUsuario(u) {
  if (!u) return [];
  const lista = [u.time, ...(Array.isArray(u.equipes) ? u.equipes : [])].map(t => String(t || '').trim()).filter(Boolean);
  return [...new Set(lista)];
}
function timeEfetivo(u) {
  if (!u) return '';
  if (u.papel === 'gestor' && u.timeAtivo) {
    const ts = timesVisiveis(u);
    if (ts.includes(String(u.timeAtivo).trim())) return String(u.timeAtivo).trim();
  }
  return u.time || '';
}

async function login(email, senha) {
  if (!email || !senha) return null;
  const users = loadUsers();
  const user = users.find(u => u.email.toLowerCase() === String(email).toLowerCase().trim());
  if (!user) { await conferirSenha(senha, HASH_FALSO); return null; } // mesmo tempo de resposta: não revela se o login existe
  if (!(await conferirSenha(senha, user))) return null;
  if (user.ativo === false) return { bloqueado: true };
  // upgrade transparente: se ainda é hash antigo (sha256), regrava com scrypt
  if (!String(user.hash || '').startsWith('s2$')) { try { user.hash = await hashSenhaAsync(senha, user.sal); gravarUsuarios(users); } catch (e) {} }
  return { papel: user.papel, cookie: emitirCookie(user) };
}
// cookie de sessão para um usuário (sv = versão da senha: trocar/redefinir a senha derruba sessões antigas)
function emitirCookie(user) {
  const payload = {
    email: user.email, nome: user.nome, papel: user.papel,
    consultorPageId: user.consultorPageId || null,
    time: timeEfetivo(user) || null, calendarId: user.calendarId || null,
    master: user.master === true || String(user.email || '').toLowerCase() === 'gestorchama',
    // IMPORTANTE: NÃO guardar a foto (base64) aqui — deixaria o cookie grande demais e o navegador o descartaria (login não persistia). A foto é carregada do banco no painel/home.
    sv: +user.sv || 0,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const token = sign(payload);
  const secure = (process.env.PROD === '1' || process.env.NODE_ENV === 'production') ? '; Secure' : '';
  return `sessao=${token}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax${secure}`;
}

function getSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
  const s = verify(cookies.sessao);
  if (!s) return null;
  // REVALIDA contra o cadastro ATUAL: papel/master/time/nome podem ter mudado desde que o
  // token foi emitido (o cookie vale 7 dias). Se o acesso foi desativado ou removido, invalida a sessão.
  try {
    const u = _usuariosCache().rawPorEmail.get(String(s.email || '').toLowerCase());
    if (!u) return null;
    if (u.ativo === false) return null;
    if ((+u.sv || 0) !== (+s.sv || 0)) return null; // senha trocada/redefinida depois deste login
    s.papel = u.papel;
    s.nome = limpaTxt(u.nome, 80);
    s.time = timeEfetivo(u) || null;
    s.times = u.papel === 'gestor' ? timesVisiveis(u) : [];
    s.calendarId = u.calendarId || null;
    s.master = u.master === true || String(u.email || '').toLowerCase() === 'gestorchama';
  } catch (e) { /* se não conseguir ler, mantém os dados do token */ }
  return s;
}

function clearCookie() { return 'sessao=; HttpOnly; Path=/; Max-Age=0'; }

// util para gerar usuários: node -e "require('./lib/auth').criarUsuario(...)"
function loginExiste(email) { return _usuariosCache().rawPorEmail.has(String(email || '').trim().toLowerCase()); }
function criarUsuario(email, senha, nome, papel, extras = {}) {
  const users = loadUsers();
  const em = String(email || '').trim().toLowerCase();
  if (!em) return { erro: 'Informe o usuário (login)' };
  if (!loginValido(em)) return { erro: 'Usuário (login) só pode ter letras, números e . _ @ + - (sem espaços ou aspas)' };
  if (nome != null) nome = limpaTxt(nome, 80);
  if (extras && extras.time != null) extras = { ...extras, time: limpaTxt(extras.time, 40) };
  // NÃO deixa duplicar login: se já existir, bloqueia (não sobrescreve)
  if (users.some(u => String(u.email || '').trim().toLowerCase() === em)) return { erro: 'Já existe um acesso com esse usuário (login). Escolha outro.' };
  const sal = crypto.randomBytes(8).toString('hex');
  const novo = { email: em, nome, papel, sal, hash: hashSenha(senha, sal), ...extras };
  users.push(novo);
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  gravarUsuarios(users);
  return novo;
}

async function trocarSenha(email, senhaAtual, novaSenha) {
  let users = loadUsers();
  let u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  if (!(await conferirSenha(senhaAtual, u))) return { erro: 'Senha atual incorreta' };
  if (!novaSenha || String(novaSenha).length < 4) return { erro: 'A nova senha deve ter pelo menos 4 caracteres' };
  const sal = crypto.randomBytes(8).toString('hex');
  const hash = await hashSenhaAsync(novaSenha, sal);
  users = loadUsers(); u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase()); // relê após o await
  if (!u) return { erro: 'Usuário não encontrado' };
  u.sal = sal; u.hash = hash; u.sv = (+u.sv || 0) + 1; // derruba sessões abertas em outros aparelhos
  gravarUsuarios(users);
  return { ok: true, cookie: emitirCookie(u) }; // quem trocou continua logado
}

function listarUsuarios() {
  // objetos congelados vindos do cache; a foto vem como LINK (/api/foto?...), não o base64
  return _usuariosCache().lista.slice();
}

function removerUsuario(email) {
  const users = loadUsers().filter(u => u.email.toLowerCase() !== String(email).toLowerCase());
  gravarUsuarios(users);
  return { ok: true };
}

async function redefinirSenha(email, novaSenha) {
  if (!novaSenha || String(novaSenha).length < 4) return { erro: 'A nova senha deve ter pelo menos 4 caracteres' }; // antes aceitava vazia (a senha virava "undefined")
  if (!loadUsers().some(x => x.email.toLowerCase() === String(email).toLowerCase())) return { erro: 'Usuário não encontrado' };
  const sal = crypto.randomBytes(8).toString('hex');
  const hash = await hashSenhaAsync(novaSenha, sal);
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  u.sal = sal; u.hash = hash; u.sv = (+u.sv || 0) + 1;
  gravarUsuarios(users);
  return { ok: true };
}

function atualizarUsuario(email, campos) {
  const users = loadUsers();
  const u = users.find(x => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u) return { erro: 'Usuário não encontrado' };
  if (campos.novoEmail != null && String(campos.novoEmail).trim() !== '') {
    const novo = String(campos.novoEmail).trim().toLowerCase();
    if (novo !== u.email.toLowerCase() && !loginValido(novo)) return { erro: 'Usuário (login) só pode ter letras, números e . _ @ + - (sem espaços ou aspas)' };
    if (novo !== u.email.toLowerCase() && users.some(x => x.email.toLowerCase() === novo)) {
      return { erro: 'Já existe um acesso com esse usuário' };
    }
    u.email = novo;
  }
  if (campos.nome != null) u.nome = limpaTxt(campos.nome, 80);
  if (campos.papel != null) u.papel = campos.papel;
  // trocou o papel sem dizer o nível: volta ao nível padrão (evita consultor marcado como gestor e vice-versa)
  if (campos.papel != null && campos.nivel == null && u.nivel && ((u.nivel === 'consultor') !== (u.papel !== 'gestor'))) delete u.nivel;
  if (campos.time != null) u.time = limpaTxt(campos.time, 40);
  if (Array.isArray(campos.equipes)) u.equipes = [...new Set(campos.equipes.map(t => limpaTxt(t, 40)).filter(Boolean))];
  if (campos.timeAtivo != null) u.timeAtivo = limpaTxt(campos.timeAtivo, 40);
  if (campos.verEstrutura != null) u.verEstrutura = !!campos.verEstrutura; // v173: modo "Toda a minha estrutura"
  if (campos.calendarId != null) u.calendarId = campos.calendarId;
  if (campos.ativo != null) u.ativo = campos.ativo;
  if (campos.cargo != null) u.cargo = limpaTxt(campos.cargo, 40);
  if (campos.cor != null) u.cor = campos.cor;
  // estrutura de gestão: nível + a quem responde (validado); a cor do gestor acompanha o nível (comissão laranja/roxo)
  if (campos.nivel != null || campos.superior != null) {
    const nivel = campos.nivel != null && campos.nivel !== '' ? String(campos.nivel) : nivelDe(u);
    const superior = campos.superior != null ? String(campos.superior || '').toLowerCase().trim() : String(u.superior || '').toLowerCase();
    const erro = validarEstrutura(users, u, nivel, superior);
    if (erro) return { erro };
    u.nivel = nivel; u.superior = superior;
    if (COR_DO_NIVEL[nivel]) u.cor = COR_DO_NIVEL[nivel];
  }
  if (campos.master != null) u.master = !!campos.master;
  if (campos.metaVenda != null) u.metaVenda = +campos.metaVenda || 0;
  if (campos.foto != null) {
    const f = String(campos.foto);
    if (f === '') u.foto = '';
    else if (/^data:image\//i.test(f)) {
      const ref = salvarFotoArquivo(f);
      if (!ref) return { erro: 'Foto inválida ou grande demais (máx. 1 MB). Tente uma imagem menor.' }; // antes: dizia "ok" e não salvava
      u.foto = ref;
    }
  }
  gravarUsuarios(users);
  return { ok: true };
}

// Gera sal+hash de uma senha (usado no auto-cadastro: a senha já fica protegida enquanto aguarda aprovação)
function hashNovaSenha(senha) { const sal = crypto.randomBytes(8).toString('hex'); return { sal, hash: hashSenha(senha, sal) }; }

async function redefinirSenhaPorPapel(papel, novaSenha) {
  // calcula os hashes em paralelo fora da thread principal (antes travava o servidor ~70 ms por pessoa)
  const alvos = loadUsers().filter(u => u.papel === papel).map(u => String(u.email).toLowerCase());
  const novos = {};
  await Promise.all(alvos.map(async em => { const sal = crypto.randomBytes(8).toString('hex'); novos[em] = { sal, hash: await hashSenhaAsync(String(novaSenha || '1234'), sal) }; }));
  const users = loadUsers(); let alterados = 0;
  users.forEach(u => { const n = novos[String(u.email).toLowerCase()]; if (n && u.papel === papel) { u.sal = n.sal; u.hash = n.hash; u.sv = (+u.sv || 0) + 1; alterados++; } });
  gravarUsuarios(users);
  return { ok: true, alterados };
}

module.exports = { repassarAbaixo, NIVEIS, ROTULO_NIVEL, nivelDe, abaixoDe, timesVisiveis, usuarioPorEmail, hashNovaSenha, loginValido, limpaTxt, fotoDoUsuario, timesDoUsuario, timeEfetivo, login, getSession, getSecret, clearCookie, criarUsuario, loginExiste, listarUsuarios, removerUsuario, redefinirSenha, atualizarUsuario, trocarSenha, redefinirSenhaPorPapel };
