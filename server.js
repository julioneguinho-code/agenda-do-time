// Agenda do Time — servidor (Node puro, zero dependências)
// Rotas: páginas (login, consultor, gestor) + API (/api/*) + estáticos (/public)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const notion = require('./lib/notion');
const auth = require('./lib/auth');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !(body instanceof Buffer);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---- estáticos
    if (p.startsWith('/public/')) {
      const file = path.join(__dirname, p);
      if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'negado');
      if (fs.existsSync(file)) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(file));
      }
      return send(res, 404, 'não encontrado');
    }

    // ---- API
    if (p.startsWith('/api/')) {
      const session = auth.getSession(req);
      if (p === '/api/login' && req.method === 'POST') {
        const { email, senha } = await readBody(req);
        const result = await auth.login(email, senha);
        if (result && result.bloqueado) return send(res, 403, { erro: 'Acesso desativado. Fale com seu gestor.' });
        if (!result) return send(res, 401, { erro: 'Usuário ou senha incorretos' });
        return send(res, 200, { ok: true, papel: result.papel }, { 'Set-Cookie': result.cookie });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
      }
      if (!session) return send(res, 401, { erro: 'Não autenticado' });

      if (p === '/api/me') return send(res, 200, session);
      if (p === '/api/avisos') return send(res, 200, await notion.listarAvisos(session));
      if (p === '/api/chat') return send(res, 200, await notion.listarChat(session, url.searchParams.get('consultor')));
      if (p === '/api/chat/enviar' && req.method === 'POST') return send(res, 200, await notion.enviarChat(session, await readBody(req)));
      if (p === '/api/avisos/ler' && req.method === 'POST') return send(res, 200, await notion.marcarAvisoLido(session, await readBody(req)));
      if (p === '/api/avisos/apagar' && req.method === 'POST') return send(res, 200, await notion.excluirAviso(session, await readBody(req)));
      if (p === '/api/home' && session.papel === 'consultor') return send(res, 200, await notion.homeConsultor(session));
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
      if (p === '/api/cancelar' && req.method === 'POST' && session.papel === 'consultor') {
        return send(res, 200, await notion.cancelarSolicitacao(session, await readBody(req)));
      }
      if (p === '/api/atividade/cancelar' && req.method === 'POST') {
        return send(res, 200, await notion.cancelarAtividade(session, await readBody(req)));
      }
      // --- gestor
      if (session.papel !== 'gestor' && p.startsWith('/api/gestor')) return send(res, 403, { erro: 'Somente gestores' });
      if (p === '/api/gestor/painel') return send(res, 200, await notion.painelGestor(session));
      if (p === '/api/gestor/consultor') return send(res, 200, await notion.perfilConsultor(session, url.searchParams.get('nome')));
      if (p === '/api/gestor/controle') return send(res, 200, await notion.controleGestor(session));
      if (p === '/api/gestor/ranking') return send(res, 200, await notion.rankingGestor(session));
      if (p === '/api/gestor/meta' && req.method === 'POST') return send(res, 200, await notion.definirMeta(session, await readBody(req)));
      if (p === '/api/gestor/agenda') return send(res, 200, await notion.agendaGestor(session));
      if (p === '/api/gestor/decidir' && req.method === 'POST') {
        return send(res, 200, await notion.decidirSolicitacao(session, await readBody(req)));
      }
      if (p === '/api/gestor/atividade' && req.method === 'POST') {
        return send(res, 200, await notion.criarAtividade(session, await readBody(req)));
      }
      if (p === '/api/gestor/usuarios' && req.method === 'GET') {
        return send(res, 200, { usuarios: auth.listarUsuarios() });
      }
      if (p === '/api/gestor/usuarios' && req.method === 'POST') {
        const { email, senha, nome, papel, time, calendarId } = await readBody(req);
        if (!email || !senha || !nome || !papel) return send(res, 400, { erro: 'Preencha nome, e-mail, senha e papel' });
        auth.criarUsuario(email.trim().toLowerCase(), senha, nome.trim(), papel, { time: time || '', calendarId: calendarId || '' });
        return send(res, 200, { ok: true });
      }
      if (p === '/api/gestor/usuarios/remover' && req.method === 'POST') {
        const { email } = await readBody(req);
        if (email === session.email) return send(res, 400, { erro: 'Você não pode remover seu próprio acesso' });
        return send(res, 200, auth.removerUsuario(email));
      }
      if (p === '/api/gestor/usuarios/senha' && req.method === 'POST') {
        const { email, senha } = await readBody(req);
        return send(res, 200, auth.redefinirSenha(email, senha));
      }
      if (p === '/api/gestor/usuarios/editar' && req.method === 'POST') {
        const { email, nome, papel, time, calendarId, cargo, cor } = await readBody(req);
        return send(res, 200, auth.atualizarUsuario(email, { nome, papel, time, calendarId, cargo, cor }));
      }
      if (p === '/api/gestor/usuarios/ativo' && req.method === 'POST') {
        const { email, ativo } = await readBody(req);
        return send(res, 200, auth.atualizarUsuario(email, { ativo: !!ativo }));
      }
      return send(res, 404, { erro: 'Rota não encontrada' });
    }

    // ---- páginas
    const session = auth.getSession(req);
    if (p === '/' || p === '/login') {
      if (session) return send(res, 302, '', { Location: session.papel === 'gestor' ? '/gestor' : '/app' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/login.html'), 'utf8'));
    }
    if (p === '/app') {
      if (!session) return send(res, 302, '', { Location: '/login' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/consultor.html'), 'utf8'));
    }
    if (p === '/gestor') {
      if (!session || session.papel !== 'gestor') return send(res, 302, '', { Location: '/login' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/gestor.html'), 'utf8'));
    }
    send(res, 404, '<h1>404</h1>');
  } catch (e) {
    console.error(e);
    send(res, 500, { erro: 'Erro interno', detalhe: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Agenda do Time rodando em http://localhost:${PORT} (modo ${process.env.NOTION_TOKEN ? 'NOTION' : 'DEMO'})`));
