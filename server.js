// Agenda do Time — servidor (Node puro, zero dependências)
// Rotas: páginas (login, consultor, gestor) + API (/api/*) + estáticos (/public)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const notion = require('./lib/notion');
const auth = require('./lib/auth');
const fin = require('./lib/financas');

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

    // ---- API FINANÇAS (módulo pessoal, cookie próprio)
    if (p.startsWith('/api/fin/')) {
      if (p === '/api/fin/login' && req.method === 'POST') {
        const { senha } = await readBody(req);
        const r = fin.login(senha);
        if (!r) return send(res, 401, { erro: 'Senha incorreta' });
        return send(res, 200, { ok: true }, { 'Set-Cookie': r.cookie });
      }
      if (p === '/api/fin/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': fin.clearCookie() });
      const fs2 = fin.sessao(req);
      if (!fs2) return send(res, 401, { erro: 'Não autenticado' });
      if (p === '/api/fin/mes' && req.method === 'GET') return send(res, 200, fin.getMes(url.searchParams.get('m')));
      if (p === '/api/fin/mes' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, fin.salvarMes(b.mes, b.renda, b.despesa)); }
      if (p === '/api/fin/metas' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, fin.salvarMetas(b.metas)); }
      if (p === '/api/fin/ano' && req.method === 'GET') return send(res, 200, fin.resumoAno(url.searchParams.get('y')));
      if (p === '/api/fin/investimentos' && req.method === 'GET') return send(res, 200, fin.investimentos(url.searchParams.get('y')));
      if (p === '/api/fin/parcela' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, fin.propagarParcela(b.mes, b.despesa)); }
      if (p === '/api/fin/senha' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, fin.trocarSenha(b.atual, b.nova)); }
      return send(res, 404, { erro: 'Rota não encontrada' });
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
      // auto-cadastro de consultor (público, aguarda aprovação do gestor)
      if (p === '/api/cadastro' && req.method === 'POST') {
        return send(res, 200, await notion.solicitarCadastro(await readBody(req)));
      }
      if (!session) return send(res, 401, { erro: 'Não autenticado' });

      if (p === '/api/me') return send(res, 200, session);
      if (p === '/api/senha' && req.method === 'POST') {
        const { atual, nova } = await readBody(req);
        return send(res, 200, auth.trocarSenha(session.email, atual, nova));
      }
      if (p === '/api/minha-foto' && req.method === 'POST') {
        const { foto } = await readBody(req);
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
        return send(res, 200, await notion.muralSalvar(session, await readBody(req)));
      }
      if (p === '/api/vendas' && req.method === 'GET') {
        return send(res, 200, await notion.listarVendas(session, { de: url.searchParams.get('de'), ate: url.searchParams.get('ate'), q: url.searchParams.get('q'), consultor: url.searchParams.get('consultor') }));
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
      // --- gestor
      if (session.papel !== 'gestor' && p.startsWith('/api/gestor')) return send(res, 403, { erro: 'Somente gestores' });
      if (p === '/api/gestor/painel') return send(res, 200, await notion.painelGestor(session));
      if (p === '/api/gestor/consultor') return send(res, 200, await notion.perfilConsultor(session, url.searchParams.get('email') || url.searchParams.get('nome')));
      if (p === '/api/gestor/controle') return send(res, 200, await notion.controleGestor(session));
      if (p === '/api/gestor/ranking') return send(res, 200, await notion.rankingGestor(session));
      if (p === '/api/gestor/meta' && req.method === 'POST') return send(res, 200, await notion.definirMeta(session, await readBody(req)));
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
        return send(res, 200, await notion.decidirCadastro(session, await readBody(req)));
      }
      if (p === '/api/gestor/contratacao' && req.method === 'GET') {
        return send(res, 200, await notion.listarContratacao(session));
      }
      if (p === '/api/gestor/contratacao/config' && req.method === 'POST') {
        return send(res, 200, await notion.configContratacao(session, await readBody(req)));
      }
      if (p === '/api/gestor/contratacao/marcar' && req.method === 'POST') {
        return send(res, 200, await notion.marcarContratacao(session, await readBody(req)));
      }
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
        return send(res, 200, await notion.listarRotinas());
      }
      if (p === '/api/gestor/rotinas' && req.method === 'POST') {
        return send(res, 200, await notion.salvarRotinas(session, await readBody(req)));
      }
      if (p === '/api/gestor/usuarios' && req.method === 'GET') {
        return send(res, 200, { usuarios: auth.listarUsuarios() });
      }
      if (p === '/api/gestor/usuarios' && req.method === 'POST') {
        const { email, senha, nome, papel, time, calendarId, metaVenda } = await readBody(req);
        if (!email || !senha || !nome || !papel) return send(res, 400, { erro: 'Preencha nome, e-mail, senha e papel' });
        auth.criarUsuario(email.trim().toLowerCase(), senha, nome.trim(), papel, { time: time || '', calendarId: calendarId || '', metaVenda: +metaVenda || 0 });
        return send(res, 200, { ok: true });
      }
      if (p === '/api/gestor/usuarios/remover' && req.method === 'POST') {
        const { email } = await readBody(req);
        if (email === session.email) return send(res, 400, { erro: 'Você não pode remover seu próprio acesso' });
        return send(res, 200, auth.removerUsuario(email));
      }
      if (p === '/api/gestor/reset-senhas' && req.method === 'POST') {
        const { senha, papel } = await readBody(req);
        return send(res, 200, auth.redefinirSenhaPorPapel(papel === 'gestor' ? 'gestor' : 'consultor', senha || '1234'));
      }
      if (p === '/api/gestor/usuarios/senha' && req.method === 'POST') {
        const { email, senha } = await readBody(req);
        return send(res, 200, auth.redefinirSenha(email, senha));
      }
      if (p === '/api/gestor/usuarios/editar' && req.method === 'POST') {
        const { email, novoEmail, nome, papel, time, calendarId, cargo, cor, master, metaVenda, foto } = await readBody(req);
        return send(res, 200, auth.atualizarUsuario(email, { novoEmail, nome, papel, time, calendarId, cargo, cor, master, metaVenda, foto }));
      }
      if (p === '/api/gestor/usuarios/ativo' && req.method === 'POST') {
        const { email, ativo } = await readBody(req);
        return send(res, 200, auth.atualizarUsuario(email, { ativo: !!ativo }));
      }
      return send(res, 404, { erro: 'Rota não encontrada' });
    }

    // ---- página do módulo financeiro (login próprio dentro da página)
    if (p === '/financas') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/financas.html'), 'utf8'));
    }

    // ---- páginas
    const session = auth.getSession(req);
    if (p === '/' || p === '/login') {
      if (session) return send(res, 302, '', { Location: session.papel === 'gestor' ? '/gestor' : '/app' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/login.html'), 'utf8'));
    }
    if (p === '/app') {
      if (!session) return send(res, 302, '', { Location: '/login' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/consultor.html'), 'utf8'), { 'Cache-Control': 'no-store, must-revalidate' });
    }
    if (p === '/gestor') {
      if (!session || session.papel !== 'gestor') return send(res, 302, '', { Location: '/login' });
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'pages/gestor.html'), 'utf8'), { 'Cache-Control': 'no-store, must-revalidate' });
    }
    send(res, 404, '<h1>404</h1>');
  } catch (e) {
    console.error(e);
    send(res, 500, { erro: 'Erro interno', detalhe: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`Agenda do Time rodando em http://localhost:${PORT} (modo ${process.env.NOTION_TOKEN ? 'NOTION' : 'DEMO'})`));
