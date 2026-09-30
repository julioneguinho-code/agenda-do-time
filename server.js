// Agenda do Time — servidor (Node puro, zero dependências)
// Rotas: páginas (login, consultor, gestor) + API (/api/*) + estáticos (/public)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const notion = require('./lib/notion');
const auth = require('./lib/auth');
const mercado = require('./lib/mercado');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
// cabeçalhos de segurança em TODAS as respostas (sem custo): impede o site de ser embutido em outro (clickjacking),
// o navegador "adivinhar" tipo de arquivo e o vazamento do endereço completo para outros sites
const SEG = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
const VERSAO = require('./package.json').version;
const INICIO = Date.now();
// erros inesperados vão para o log (Render) com data/hora, em vez de sumirem ou derrubarem o processo em silêncio
process.on('unhandledRejection', e => console.error(new Date().toISOString(), 'unhandledRejection:', e && e.stack || e));
process.on('uncaughtException', e => console.error(new Date().toISOString(), 'uncaughtException:', e && e.stack || e));

// Compacta (gzip) respostas de texto/JSON acima de 1 KB quando o navegador aceita — reduz 70–90% do tráfego.
let _reqAtual = null; // requisição em andamento (o servidor atende uma por vez no event loop)
function aceitaGzip(req) { return !!req && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')); }
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !(body instanceof Buffer);
  const h = { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', ...SEG, ...headers };
  let payload = isObj ? JSON.stringify(body) : body;
  const req = res.req || _reqAtual;
  if (payload != null && status !== 204 && status !== 304 && !h['Content-Encoding'] && aceitaGzip(req)) {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
    if (buf.length > 1024) {
      try { payload = zlib.gzipSync(buf, { level: 6 }); h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding'; } catch (e) { payload = buf; }
    }
  }
  res.writeHead(status, h);
  res.end(payload);
}
// Páginas HTML: lidas do disco 1x (mudam só em deploy, que reinicia o processo), já compactadas,
// com ETag — o navegador revalida e recebe 304 (sem baixar de novo) quando nada mudou.
const _paginas = {};
function pagina(nome) {
  if (!_paginas[nome]) {
    const html = fs.readFileSync(path.join(__dirname, 'pages', nome));
    _paginas[nome] = { html, gz: zlib.gzipSync(html, { level: 9 }), etag: '"' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 16) + '"' };
  }
  return _paginas[nome];
}
function sendPagina(req, res, nome) {
  const pg = pagina(nome);
  const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': pg.etag, 'Vary': 'Accept-Encoding', ...SEG };
  if (String(req.headers['if-none-match'] || '') === pg.etag) { res.writeHead(304, h); return res.end(); }
  if (aceitaGzip(req)) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); return res.end(pg.gz); }
  res.writeHead(200, h); return res.end(pg.html);
}

// arquivos de /public: lidos 1x do disco (mudam só em deploy), com ETag e gzip
const _estaticos = {};
function sendEstatico(req, res, rel, cache, extra) {
  let e = _estaticos[rel];
  if (!e) {
    const file = path.join(__dirname, 'public', rel);
    if (!file.startsWith(path.join(__dirname, 'public') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'não encontrado');
    const buf = fs.readFileSync(file);
    const tipo = MIME[path.extname(file)] || 'application/octet-stream';
    e = _estaticos[rel] = { buf, tipo, gz: /^(text|application\/(json|manifest))/.test(tipo) || /javascript/.test(tipo) ? zlib.gzipSync(buf) : null, etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"' };
  }
  const h = { 'Content-Type': e.tipo, 'Cache-Control': cache, 'ETag': e.etag, ...SEG, ...(extra || {}) };
  if (String(req.headers['if-none-match'] || '') === e.etag) { res.writeHead(304, h); return res.end(); }
  if (e.gz && aceitaGzip(req)) { h['Content-Encoding'] = 'gzip'; h['Vary'] = 'Accept-Encoding'; res.writeHead(200, h); return res.end(e.gz); }
  res.writeHead(200, h); return res.end(e.buf);
}

// Limite de tamanho do corpo (evita zip-bomb / upload gigante que derruba a memória).
// Uploads (planilhas em base64) podem ser grandes, então damos folga: 25 MB.
const MAX_BODY = 25 * 1024 * 1024;
async function readBody(req) {
  let data = '';
  let tam = 0;
  for await (const chunk of req) {
    tam += chunk.length;
    if (tam > MAX_BODY) { req.destroy(); return { __tooBig: true }; }
    data += chunk;
  }
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

// Extrai o IP do cliente (respeita proxy do Render via X-Forwarded-For)
function ipDe(req) {
  // usa o ÚLTIMO IP da lista: é o que o proxy do Render acrescenta. O primeiro pode ser inventado pelo cliente
  // (bastaria mandar um X-Forwarded-For falso a cada tentativa para escapar do limite de login).
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const ips = String(xff).split(',').map(x => x.trim()).filter(Boolean); if (ips.length) return ips[ips.length - 1]; }
  return (req.socket && req.socket.remoteAddress) || 'desconhecido';
}

// Rate-limit em memória para login: no máx. N tentativas por janela, por chave (IP+usuário).
const tentativasLogin = new Map(); // chave -> { n, reset }
const LOGIN_MAX = 8;             // tentativas
const LOGIN_JANELA = 15 * 60000; // 15 minutos
function loginBloqueado(chave) {
  const agora = Date.now();
  const reg = tentativasLogin.get(chave);
  if (!reg || agora > reg.reset) { tentativasLogin.set(chave, { n: 0, reset: agora + LOGIN_JANELA }); return false; }
  return reg.n >= LOGIN_MAX;
}
function registrarFalhaLogin(chave) {
  const agora = Date.now();
  const reg = tentativasLogin.get(chave);
  if (!reg || agora > reg.reset) { tentativasLogin.set(chave, { n: 1, reset: agora + LOGIN_JANELA }); return; }
  reg.n++;
}
function limparFalhaLogin(chave) { tentativasLogin.delete(chave); }
// Auto-cadastro público: no máx. 5 pedidos por hora por IP (evita encher a lista de aprovações com lixo)
const pedidosCadastro = new Map(); // ip -> { n, reset }
function cadastroLiberado(ip) {
  const agora = Date.now();
  const reg = pedidosCadastro.get(ip);
  if (!reg || agora > reg.reset) { pedidosCadastro.set(ip, { n: 1, reset: agora + 60 * 60000 }); return true; }
  reg.n++;
  return reg.n <= 5;
}
// limpeza periódica das chaves expiradas (evita crescer indefinidamente)
setInterval(() => { const t = Date.now(); for (const [k, v] of tentativasLogin) if (t > v.reset) tentativasLogin.delete(k); for (const [k, v] of pedidosCadastro) if (t > v.reset) pedidosCadastro.delete(k); }, 10 * 60000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  _reqAtual = req;
  try {
    // ---- estáticos
    // PWA: manifest e service worker servidos da RAIZ (o SW só controla o site inteiro se estiver em "/")
    if (p === '/manifest.webmanifest') return sendEstatico(req, res, 'manifest.webmanifest', 'no-cache');
    if (p === '/sw.js') return sendEstatico(req, res, 'sw.js', 'no-cache', { 'Service-Worker-Allowed': '/' });
    if (p.startsWith('/public/')) {
      const rel = path.normalize(p.slice('/public/'.length));
      if (rel.startsWith('..') || path.isAbsolute(rel)) return send(res, 403, 'negado');
      // ícones mudam só em deploy: cache de 1 dia (+ ETag para revalidar barato)
      return sendEstatico(req, res, rel, /\.png$/.test(rel) ? 'public, max-age=86400' : 'no-cache');
    }
    // HEALTH CHECK (Render → Settings → Health Check Path = /healthz): responde rápido, sem dados sensíveis
    if (p === '/healthz') {
      const g = notion.statusGravacao();
      return send(res, 200, { ok: true, versao: VERSAO, noArDesde: new Date(INICIO).toISOString(), ultimoSalvoEm: g.ultimoSalvoEm, gravacaoPendente: g.pendente }, { 'Cache-Control': 'no-store' });
    }

    // ---- BACKUP (rotina diária): dump de vendas/carteira em JSON, protegido por token fixo.
    // Não usa cookie de sessão (é chamado por uma tarefa agendada). Defina BACKUP_TOKEN no ambiente.
    if (p === '/api/backup/vendas' && req.method === 'GET') {
      const tok = process.env.BACKUP_TOKEN;
      if (!tok) return send(res, 403, { erro: 'Backup desativado — defina a variável BACKUP_TOKEN.' });
      const enviado = url.searchParams.get('token') || req.headers['x-backup-token'] || '';
      if (String(enviado).length !== String(tok).length || !crypto.timingSafeEqual(Buffer.from(String(enviado)), Buffer.from(String(tok)))) return send(res, 401, { erro: 'Token inválido' });
      return send(res, 200, notion.backupDados(), { 'Cache-Control': 'no-store' });
    }

    // BACKUP COMPLETO (estado + acessos) compactado — para a rotina externa diária. Token de preferência no
    // cabeçalho x-backup-token (fica fora dos logs de acesso); ?token= continua aceito por compatibilidade.
    if (p === '/api/backup/completo' && req.method === 'GET') {
      const tok = process.env.BACKUP_TOKEN;
      if (!tok) return send(res, 403, { erro: 'Backup desativado — defina a variável BACKUP_TOKEN.' });
      const enviado = String(req.headers['x-backup-token'] || url.searchParams.get('token') || '');
      if (enviado.length !== String(tok).length || !crypto.timingSafeEqual(Buffer.from(enviado), Buffer.from(String(tok)))) return send(res, 401, { erro: 'Token inválido' });
      const gz = zlib.gzipSync(JSON.stringify(notion.backupCompleto()));
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="gestao-chama-backup-' + new Date().toISOString().slice(0, 10) + '.json.gz"', 'Content-Length': gz.length, 'Cache-Control': 'no-store', ...SEG });
      return res.end(gz);
    }

    // ---- MERCADO (Selic + taxas médias BCB) para os simuladores. Dados públicos, sem sessão.
    if (p === '/api/mercado' && req.method === 'GET') {
      return send(res, 200, mercado.getMercado(), { 'Cache-Control': 'max-age=3600' });
    }

    // ---- API
    if (p.startsWith('/api/')) {
      if (req.method === 'POST' && p !== '/api/login' && p !== '/api/logout') { notion.marcarAlterado(); res.on('finish', () => notion.marcarAlterado()); }
      const session = auth.getSession(req);
      if (p === '/api/login' && req.method === 'POST') {
        const { email, senha } = await readBody(req);
        const chave = 'app:' + ipDe(req) + ':' + String(email || '').toLowerCase();
        if (loginBloqueado(chave)) return send(res, 429, { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' });
        const result = await auth.login(email, senha);
        if (result && result.bloqueado) return send(res, 403, { erro: 'Acesso desativado. Fale com seu gestor.' });
        if (!result) { registrarFalhaLogin(chave); return send(res, 401, { erro: 'Usuário ou senha incorretos' }); }
        limparFalhaLogin(chave);
        return send(res, 200, { ok: true, papel: result.papel }, { 'Set-Cookie': result.cookie });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
      }
      // auto-cadastro de consultor (público, aguarda aprovação do gestor)
      if (p === '/api/cadastro' && req.method === 'POST') {
        if (!cadastroLiberado(ipDe(req))) return send(res, 429, { erro: 'Muitos pedidos de acesso seguidos. Tente novamente mais tarde.' });
        return send(res, 200, await notion.solicitarCadastro(await readBody(req)));
      }
      // "esqueci minha senha": vira aviso para o gestor/master (público, com limite por IP, resposta sempre igual)
      if (p === '/api/esqueci-senha' && req.method === 'POST') {
        if (!cadastroLiberado('senha:' + ipDe(req))) return send(res, 429, { erro: 'Muitos pedidos seguidos. Tente mais tarde.' });
        const { login } = await readBody(req);
        return send(res, 200, notion.pedirResetSenha({ login }));
      }
      if (!session) return send(res, 401, { erro: 'Não autenticado' });
      // pulso: a tela pergunta "mudou algo?" a cada 10 s e só recarrega o resto se mudou
      if (p === '/api/pulso') return send(res, 200, notion.pulso(session), { 'Cache-Control': 'no-store' });
      // atalhos do menu escolhidos por cada pessoa
      if (p === '/api/preferencias' && req.method === 'GET') return send(res, 200, notion.lerPreferencias(session), { 'Cache-Control': 'no-store' });
      if (p === '/api/preferencias' && req.method === 'POST') return send(res, 200, notion.salvarPreferencias(session, await readBody(req)));
      // notificações push
      if (p === '/api/push/chave') return send(res, 200, { chave: require('./lib/push').chavePublica() });
      if (p === '/api/push/inscrever' && req.method === 'POST') return send(res, 200, notion.inscreverPush(session, await readBody(req)));
      if (p === '/api/push/cancelar' && req.method === 'POST') return send(res, 200, notion.cancelarPush(session, await readBody(req)));
      // loteria federal (salva na base para todos) — GET só lê o que está salvo; POST extrai da Caixa se puder haver sorteio novo
      if (p === '/api/loteria/federal' && req.method === 'GET') return send(res, 200, notion.loteriaSalva());
      if (p === '/api/loteria/federal' && req.method === 'POST') return send(res, 200, await notion.extrairLoteria(session));
      // extrato de comissões da própria pessoa (consultor, supervisor, gestor que recebe repasse)
      if (p === '/api/comissoes/minhas' && req.method === 'GET') return send(res, 200, notion.comMeuExtrato(session));
      // ficha do cliente, lembrete de retorno e planilha da carteira
      if (p === '/api/clientes/ficha' && req.method === 'GET') return send(res, 200, await notion.fichaCliente(session, { cpf: url.searchParams.get('cpf'), nome: url.searchParams.get('nome') }));
      if (p === '/api/clientes/ficha' && req.method === 'POST') return send(res, 200, await notion.salvarFichaCliente(session, await readBody(req)));
      if (p === '/api/atividade/propria' && req.method === 'POST') return send(res, 200, await notion.criarAtividadePropria(session, await readBody(req)));
      if (p === '/api/clientes/export' && req.method === 'GET') {
        const r = await notion.exportarClientesXlsx(session);
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="' + r.filename + '"', 'Content-Length': r.buffer.length, 'Cache-Control': 'no-store', ...SEG });
        return res.end(r.buffer);
      }

      if (p === '/api/me') return send(res, 200, session);
      // foto de perfil como imagem (antes ia embutida em base64 em todas as listas). Link muda quando a foto muda.
      if (p === '/api/foto' && req.method === 'GET') {
        const f = auth.fotoDoUsuario(url.searchParams.get('u'));
        if (!f) return send(res, 404, { erro: 'Sem foto' });
        const etag = '"' + f.v + '"';
        const hf = { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'ETag': etag };
        if (String(req.headers['if-none-match'] || '') === etag) { res.writeHead(304, hf); return res.end(); }
        res.writeHead(200, { ...hf, 'Content-Length': f.buf.length });
        return res.end(f.buf);
      }
      if (p === '/api/senha' && req.method === 'POST') {
        const { atual, nova } = await readBody(req);
        const r = await auth.trocarSenha(session.email, atual, nova);
        if (r.ok) { notion.auditar(session, 'trocou a própria senha', '', session.email); return send(res, 200, { ok: true }, { 'Set-Cookie': r.cookie }); }
        return send(res, 200, r);
      }
      if (p === '/api/minha-foto' && req.method === 'POST') {
        const { foto } = await readBody(req);
        if (foto && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(String(foto))) return send(res, 200, { erro: 'Envie uma imagem JPG, PNG ou WEBP' });
        return send(res, 200, auth.atualizarUsuario(session.email, { foto: foto || '' }));
      }
      if (p === '/api/avisos') return send(res, 200, await notion.listarAvisos(session));
      if (p === '/api/chat') return send(res, 200, await notion.listarChat(session, url.searchParams.get('consultor')));
      if (p === '/api/chat/enviar' && req.method === 'POST') return send(res, 200, await notion.enviarChat(session, await readBody(req)));
      if (p === '/api/avisos/ler' && req.method === 'POST') return send(res, 200, await notion.marcarAvisoLido(session, await readBody(req)));
      if (p === '/api/avisos/apagar' && req.method === 'POST') return send(res, 200, await notion.excluirAviso(session, await readBody(req)));
      if (p === '/api/home' && session.papel === 'consultor') return send(res, 200, await notion.homeConsultor(session));
      if (p === '/api/disponibilidade') return send(res, 200, await notion.disponibilidade(session));
      if (p === '/api/gestores') return send(res, 200, { gestores: notion.listarGestores() });
      if (p === '/api/arquivos' && req.method === 'GET') return send(res, 200, await notion.listarArquivos(session));
      if (p === '/api/arquivos' && req.method === 'POST') return send(res, 200, await notion.salvarArquivo(session, await readBody(req)));
      if (p === '/api/arquivos/excluir' && req.method === 'POST') return send(res, 200, await notion.excluirArquivo(session, await readBody(req)));
      if (p === '/api/arquivo' && req.method === 'GET') {
        const d = notion.arquivoParaDownload(session, url.searchParams.get('id'));
        if (!d || !fs.existsSync(d.path)) return send(res, 404, { erro: 'Arquivo não encontrado' });
        res.writeHead(200, { 'Content-Type': d.tipo || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(d.nome)}"` });
        return res.end(fs.readFileSync(d.path));
      }
      if (p === '/api/solicitar' && req.method === 'POST' && session.papel === 'consultor') {
        return send(res, 200, await notion.criarSolicitacao(session, await readBody(req)));
      }
      if (p === '/api/checkin' && req.method === 'POST' && session.papel === 'consultor') {
        return send(res, 200, await notion.registrarCheckin(session, await readBody(req)));
      }
      if (p === '/api/checkin/finalizar' && req.method === 'POST' && session.papel === 'consultor') {
        return send(res, 200, await notion.finalizarCheckin(session));
      }
      if (p === '/api/atividade' && req.method === 'POST') {
        return send(res, 200, await notion.atualizarAtividade(session, await readBody(req)));
      }
      if (p === '/api/mural' && req.method === 'GET') {
        return send(res, 200, await notion.muralDados(session, { mes: url.searchParams.get('mes') }));
      }
      if (p === '/api/mural' && req.method === 'POST') {
        if (session.papel !== 'gestor') return send(res, 403, { erro: 'Somente gestores podem editar o Mural' });
        const r = await notion.muralSalvar(session, await readBody(req));
        if (r.ok) notion.auditar(session, 'editou o Mural', '', '');
        return send(res, 200, r);
      }
      if (p === '/api/vendas' && req.method === 'GET') {
        return send(res, 200, await notion.listarVendas(session, { de: url.searchParams.get('de'), ate: url.searchParams.get('ate'), q: url.searchParams.get('q'), consultor: url.searchParams.get('consultor') }));
      }
      if (p === '/api/vendas/export' && req.method === 'GET') {
        if (session.papel !== 'gestor') return send(res, 403, { erro: 'Somente gestores' });
        const r = await notion.exportarVendasXlsx(session, { de: url.searchParams.get('de'), ate: url.searchParams.get('ate'), q: url.searchParams.get('q'), consultor: url.searchParams.get('consultor') });
        if (!r || !r.ok) return send(res, 400, r || { erro: 'Falha ao gerar planilha' });
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="' + (r.filename || 'vendas.xlsx') + '"',
          'Content-Length': r.buffer.length,
          'Cache-Control': 'no-store',
        });
        return res.end(r.buffer);
      }
      if (p === '/api/vendas' && req.method === 'POST') {
        return send(res, 200, await notion.criarVenda(session, await readBody(req)));
      }
      if (p === '/api/vendas/editar' && req.method === 'POST') {
        return send(res, 200, await notion.editarVenda(session, await readBody(req)));
      }
      if (p === '/api/vendas/excluir' && req.method === 'POST') {
        return send(res, 200, await notion.excluirVenda(session, await readBody(req)));
      }
      if (p === '/api/cancelar' && req.method === 'POST' && session.papel === 'consultor') {
        return send(res, 200, await notion.cancelarSolicitacao(session, await readBody(req)));
      }
      if (p === '/api/solicitacao/excluir' && req.method === 'POST' && session.papel === 'consultor') {
        return send(res, 200, await notion.excluirSolicitacao(session, await readBody(req)));
      }
      if (p === '/api/atividade/cancelar' && req.method === 'POST') {
        return send(res, 200, await notion.cancelarAtividade(session, await readBody(req)));
      }
      // sorteio por proximidade — disponível para gestor E consultor (cada um vê as suas cotas)
      if (p === '/api/sorteio-grupos' && req.method === 'GET') return send(res, 200, await notion.gruposParaSorteio(session));
      if (p === '/api/sorteio' && req.method === 'POST') return send(res, 200, await notion.sortearProximidade(session, await readBody(req)));
      // cadastro de clientes por planilha — gestor E consultor
      if (p === '/api/clientes/modelo' && req.method === 'GET') {
        const r = notion.modeloClientesXlsx();
        if (!r || !r.ok) return send(res, 400, r || { erro: 'Falha ao gerar modelo' });
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="' + r.filename + '"', 'Content-Length': r.buffer.length, 'Cache-Control': 'no-store' });
        return res.end(r.buffer);
      }
      if (p === '/api/clientes/importar' && req.method === 'POST') { const b = await readBody(req); if (b.__tooBig) return send(res, 413, { erro: 'Arquivo muito grande (máx. 25 MB).' }); return send(res, 200, await notion.importarClientesXlsx(session, b)); }
      // --- gestor
      if (session.papel !== 'gestor' && p.startsWith('/api/gestor')) return send(res, 403, { erro: 'Somente gestores' });
      if (p === '/api/gestor/painel') return send(res, 200, await notion.painelGestor(session));
      if (p === '/api/gestor/sorteio-grupos') return send(res, 200, await notion.gruposParaSorteio(session));
      if (p === '/api/gestor/sorteio' && req.method === 'POST') return send(res, 200, await notion.sortearProximidade(session, await readBody(req)));
      if (p === '/api/gestor/clientes-por-consultor') return send(res, 200, await notion.clientesPorConsultor(session));
      if (p === '/api/gestor/comissoes/impostos' && req.method === 'GET') return send(res, 200, notion.comImpostosGet(session));
      if (p === '/api/gestor/comissoes/impostos' && req.method === 'POST') return send(res, 200, notion.comImpostosSalvar(session, await readBody(req)));
      if (p === '/api/gestor/comissoes/importar' && req.method === 'POST') { const b = await readBody(req); if (b.__tooBig) return send(res, 413, { erro: 'Arquivo muito grande (máx. 25 MB).' }); const r = await notion.comImportar(session, b); if (r.ok) notion.auditar(session, 'importou comissões', 'competência ' + r.fechamento.competencia + ' · ' + r.fechamento.qtdCotas + ' cotas', ''); return send(res, 200, r); }
      if (p === '/api/gestor/comissoes/fechamentos' && req.method === 'GET') return send(res, 200, notion.comListarFechamentos(session));
      if (p === '/api/gestor/comissoes/fechamento' && req.method === 'GET') return send(res, 200, notion.comFechamento(session, { id: url.searchParams.get('id'), consultor: url.searchParams.get('consultor') }));
      if (p === '/api/gestor/comissoes/excluir' && req.method === 'POST') { const b = await readBody(req); const r = notion.comExcluirFechamento(session, b); if (r.ok) notion.auditar(session, 'excluiu fechamento de comissão', 'id ' + b.id, ''); return send(res, 200, r); }
      if (p === '/api/gestor/comissoes/pago' && req.method === 'POST') return send(res, 200, notion.comMarcarPago(session, await readBody(req)));
      if (p === '/api/gestor/comissoes/vincular' && req.method === 'POST') return send(res, 200, notion.comVincular(session, await readBody(req)));
      if (p === '/api/gestor/auditoria' && req.method === 'GET') return send(res, 200, notion.listarAuditoria(session, { limite: url.searchParams.get('limite') }));
      // backup completo para o MASTER baixar (cópia fora do servidor)
      if (p === '/api/gestor/backup' && req.method === 'GET') {
        if (!session.master) return send(res, 403, { erro: 'Somente o master' });
        notion.auditar(session, 'baixou backup completo', '', '');
        const gz = zlib.gzipSync(JSON.stringify(notion.backupCompleto()));
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="gestao-chama-backup-' + new Date().toISOString().slice(0, 10) + '.json.gz"', 'Content-Length': gz.length, 'Cache-Control': 'no-store', ...SEG });
        return res.end(gz);
      }
      if (p === '/api/gestor/comissoes/exportar' && req.method === 'GET') {
        const r = notion.comExportarXlsx(session, { id: url.searchParams.get('id') });
        if (!r || !r.ok) return send(res, 400, r || { erro: 'Falha ao gerar relatório' });
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="' + r.filename + '"', 'Content-Length': r.buffer.length, 'Cache-Control': 'no-store' });
        return res.end(r.buffer);
      }
      if (p === '/api/gestor/consultor') return send(res, 200, await notion.perfilConsultor(session, url.searchParams.get('email') || url.searchParams.get('nome')));
      if (p === '/api/gestor/controle') return send(res, 200, await notion.controleGestor(session));
      if (p === '/api/gestor/ranking') return send(res, 200, await notion.rankingGestor(session));
      if (p === '/api/gestor/meta' && req.method === 'POST') { const r = await notion.definirMeta(session, await readBody(req)); if (r.ok) notion.auditar(session, 'alterou meta semanal', (r.time || 'geral') + ' → ' + r.metaSemanal, ''); return send(res, 200, r); }
      if (p === '/api/gestor/agenda') return send(res, 200, await notion.agendaGestor(session));
      if (p === '/api/gestor/decidir' && req.method === 'POST') {
        return send(res, 200, await notion.decidirSolicitacao(session, await readBody(req)));
      }
      if (p === '/api/gestor/solicitacao/cancelar' && req.method === 'POST') {
        return send(res, 200, await notion.cancelarSolicitacaoGestor(session, await readBody(req)));
      }
      if (p === '/api/gestor/atividade' && req.method === 'POST') {
        return send(res, 200, await notion.criarAtividade(session, await readBody(req)));
      }
      if (p === '/api/gestor/destinatarios') {
        return send(res, 200, await notion.destinatarios(session));
      }
      if (p === '/api/gestor/reuniao-gestor' && req.method === 'POST') {
        return send(res, 200, await notion.solicitarReuniaoGestor(session, await readBody(req)));
      }
      if (p === '/api/gestor/vendas-dash' && req.method === 'GET') {
        return send(res, 200, await notion.dashboardVendas(session, { mes: url.searchParams.get('mes') }));
      }
      if (p === '/api/gestor/vendas-log' && req.method === 'GET') {
        return send(res, 200, await notion.listarVendasLog(session, { limite: url.searchParams.get('limite') }));
      }
      if (p === '/api/gestor/negociacoes-todas' && req.method === 'GET') {
        return send(res, 200, await notion.negociacoesTodasEquipes(session));
      }
      if (p === '/api/gestor/clientes' && req.method === 'GET') {
        return send(res, 200, await notion.listarClientes(session, { q: url.searchParams.get('q'), consultor: url.searchParams.get('consultor') }));
      }
      if (p === '/api/gestor/cadastros' && req.method === 'GET') {
        return send(res, 200, await notion.listarCadastros(session));
      }
      if (p === '/api/gestor/cadastros/decidir' && req.method === 'POST') {
        const b = await readBody(req);
        const c = notion.cadastroPorId(b.id); // lido antes de decidir (a decisão remove o pedido)
        const r = await notion.decidirCadastro(session, b);
        if (r.ok && c) notion.auditar(session, b.aprovar ? 'aprovou pedido de acesso' : 'recusou pedido de acesso', c.nome + ' · time ' + (b.time || c.time || ''), c.email);
        return send(res, 200, r);
      }
      // equipes do gestor (vários escritórios no mesmo acesso) — trocar muda só o quadro
      if (p === '/api/gestor/equipes' && req.method === 'GET') return send(res, 200, notion.minhasEquipes(session));
      if (p === '/api/gestor/equipes' && req.method === 'POST') { const b = await readBody(req); const r = notion.criarEquipe(session, b); if (r.ok) notion.auditar(session, r.assumida ? 'assumiu equipe' : 'criou equipe', r.ativa, ''); return send(res, 200, r); }
      if (p === '/api/gestor/equipes/ativa' && req.method === 'POST') return send(res, 200, notion.trocarEquipe(session, await readBody(req)));
      if (p === '/api/gestor/equipes/remover' && req.method === 'POST') { const b = await readBody(req); const r = notion.removerEquipe(session, b); if (r.ok) notion.auditar(session, 'removeu equipe extra', b.nome, ''); return send(res, 200, r); }
      if (p === '/api/gestor/times' && req.method === 'GET') {
        return send(res, 200, { times: notion.listarTimes() });
      }
      if (p === '/api/gestor/times' && req.method === 'POST') {
        return send(res, 200, notion.criarTime(session, await readBody(req)));
      }
      if (p === '/api/gestor/times/excluir' && req.method === 'POST') {
        return send(res, 200, notion.excluirTime(session, await readBody(req)));
      }
      if (p === '/api/gestor/rotinas' && req.method === 'GET') {
        return send(res, 200, await notion.listarRotinas(session));
      }
      if (p === '/api/gestor/rotinas' && req.method === 'POST') {
        const r = await notion.salvarRotinas(session, await readBody(req));
        if (r.ok) notion.auditar(session, 'alterou rotinas do check-in', (r.time || 'geral') + ' · ' + r.rotinas.length + ' rotinas', '');
        return send(res, 200, r);
      }
      if (p === '/api/gestor/usuarios' && req.method === 'GET') {
        return send(res, 200, { usuarios: auth.listarUsuarios() });
      }
      if (p === '/api/gestor/usuarios' && req.method === 'POST') {
        const { email, senha, nome, papel, time, calendarId, metaVenda } = await readBody(req);
        if (!email || !senha || !nome || !papel) return send(res, 400, { erro: 'Preencha nome, e-mail, senha e papel' });
        const rc = auth.criarUsuario(email.trim().toLowerCase(), senha, nome.trim(), papel, { time: time || '', calendarId: calendarId || '', metaVenda: +metaVenda || 0 });
        if (rc && rc.erro) return send(res, 400, { erro: rc.erro });
        notion.auditar(session, 'criou acesso', papel + ' · ' + nome + (time ? ' · time ' + time : ''), email);
        return send(res, 200, { ok: true });
      }
      if (p === '/api/gestor/usuarios/remover' && req.method === 'POST') {
        const { email } = await readBody(req);
        if (email === session.email) return send(res, 400, { erro: 'Você não pode remover seu próprio acesso' });
        const antes = auth.usuarioPorEmail(email);
        notion.auditar(session, 'removeu acesso', antes ? antes.nome + ' · ' + antes.papel + ' · time ' + (antes.time || '') : '', email);
        return send(res, 200, auth.removerUsuario(email));
      }
      if (p === '/api/gestor/reset-senhas' && req.method === 'POST') {
        const { senha, papel } = await readBody(req);
        const r = await auth.redefinirSenhaPorPapel(papel === 'gestor' ? 'gestor' : 'consultor', senha || '1234');
        notion.auditar(session, 'redefiniu a senha de TODOS', (papel === 'gestor' ? 'gestores' : 'consultores') + ' · ' + r.alterados + ' acesso(s)', '');
        return send(res, 200, r);
      }
      if (p === '/api/gestor/usuarios/senha' && req.method === 'POST') {
        const { email, senha } = await readBody(req);
        const r = await auth.redefinirSenha(email, senha);
        if (r.ok) notion.auditar(session, 'redefiniu senha', '', email);
        return send(res, 200, r);
      }
      if (p === '/api/gestor/usuarios/editar' && req.method === 'POST') {
        const { email, novoEmail, nome, papel, time, calendarId, cargo, cor, master, metaVenda, foto } = await readBody(req);
        const antes = auth.usuarioPorEmail(email);
        const r = auth.atualizarUsuario(email, { novoEmail, nome, papel, time, calendarId, cargo, cor, master, metaVenda, foto });
        if (r.ok && antes) {
          // registra SÓ o que mudou (antes → depois)
          const mud = [];
          const cmp = (rot, a, d) => { if (d != null && String(d) !== String(a == null ? '' : a)) mud.push(rot + ': ' + (a === '' || a == null ? '—' : a) + ' → ' + (d === '' ? '—' : d)); };
          cmp('login', antes.email, novoEmail && String(novoEmail).trim().toLowerCase()); cmp('nome', antes.nome, nome); cmp('papel', antes.papel, papel); cmp('time', antes.time, time);
          cmp('cargo', antes.cargo, cargo); cmp('cor', antes.cor, cor); cmp('master', !!antes.master, master == null ? null : !!master); cmp('meta', antes.metaVenda, metaVenda == null ? null : (+metaVenda || 0)); cmp('agenda', antes.calendarId, calendarId);
          if (foto != null && foto !== '' && /^data:/.test(String(foto))) mud.push('foto alterada');
          if (mud.length) notion.auditar(session, 'editou acesso', mud.join(' · '), (novoEmail && String(novoEmail).trim()) || email);
        }
        return send(res, 200, r);
      }
      if (p === '/api/gestor/usuarios/ativo' && req.method === 'POST') {
        const { email, ativo } = await readBody(req);
        notion.auditar(session, ativo ? 'reativou acesso' : 'desativou acesso', '', email);
        return send(res, 200, auth.atualizarUsuario(email, { ativo: !!ativo }));
      }
      return send(res, 404, { erro: 'Rota não encontrada' });
    }

    // ---- páginas
    const session = auth.getSession(req);
    if (p === '/' || p === '/login') {
      if (session) return send(res, 302, '', { Location: session.papel === 'gestor' ? '/gestor' : '/app' });
      return sendPagina(req, res, 'login.html');
    }
    if (p === '/app') {
      if (!session) return send(res, 302, '', { Location: '/login' });
      return sendPagina(req, res, 'consultor.html');
    }
    if (p === '/gestor') {
      if (!session || session.papel !== 'gestor') return send(res, 302, '', { Location: '/login' });
      return sendPagina(req, res, 'gestor.html');
    }
    send(res, 404, '<h1>404</h1>');
  } catch (e) {
    console.error(e);
    console.error(new Date().toISOString(), req.method, p); // (a pilha já foi logada acima)
    if (!res.headersSent) send(res, 500, { erro: 'Erro interno' }); // detalhe só no log do servidor
  }
});

server.keepAliveTimeout = 65000; // acima do timeout do proxy do Render — reaproveita conexões, evita 502 esporádico
server.headersTimeout = 66000;
server.listen(PORT, () => console.log(`Gestão Chama v${VERSAO} rodando em http://localhost:${PORT}`));
