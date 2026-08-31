// Camada de dados: Notion como banco (API REST direta, sem SDK).
// Sem NOTION_TOKEN definido, roda em MODO DEMO com dados de exemplo — perfeito pra testar as telas.
const DEMO = !process.env.NOTION_TOKEN;
const TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = '2022-06-28';

// IDs dos databases (data sources) já criados no Notion do Julio
const DB = {
  agenda: process.env.DB_AGENDA || 'f777e14f-f14d-822a-a144-0719dd55ffc3',
  atividades: process.env.DB_ATIVIDADES || '624cd397-1841-44df-8f26-b8f1fc566525',
  checkin: process.env.DB_CHECKIN || '3887e14f-f14d-808d-a15c-000b779587cd',
  consultores: process.env.DB_CONSULTORES || '3887e14f-f14d-8047-9c6e-000bbb265a05',
};

async function notionFetch(pathName, body) {
  const res = await fetch(`https://api.notion.com/v1/${pathName}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------- MODO DEMO ----------
const demo = {
  solicitacoes: [
    { id: 's1', assunto: 'Reunião de acompanhamento', consultor: 'Carlos', time: 'Chama', inicio: proxDia(1, 14), duracao: 60, local: 'Google Meet', status: 'Pendente', conflito: false },
    { id: 's2', assunto: 'Dúvidas de proposta', consultor: 'Ana', time: 'Chama', inicio: proxDia(2, 10), duracao: 30, local: 'Escritório', status: 'Pendente', conflito: true },
    { id: 's3', assunto: 'Alinhamento mensal', consultor: 'Diego', time: 'Chama', inicio: proxDia(-2, 9), duracao: 60, local: 'Google Meet', status: 'Aprovada', conflito: false },
  ],
  atividades: [
    { id: 'a1', titulo: 'Prospectar 20 lista fria', consultor: 'Carlos', tipo: 'Prospecção', prazo: hoje(), status: 'Fazendo' },
    { id: 'a2', titulo: 'Gravar 5 reels teste', consultor: 'Carlos', tipo: 'Conteúdo', prazo: proxDia(2), status: 'A fazer' },
    { id: 'a3', titulo: 'Refazer bio do Instagram', consultor: 'Ana', tipo: 'Conteúdo', prazo: proxDia(-1), status: 'A fazer' },
    { id: 'a4', titulo: 'Treinamento de objeções', consultor: 'Ariel', tipo: 'Treinamento', prazo: proxDia(-3), status: 'A fazer' },
  ],
  rotinas: ['Verificar demanda de clientes', 'Verificar respostas de reels', 'Post pela manhã', 'Pedir indicação', 'Prospectar 20 lista fria CNPJ', 'Verificar tráfego pago', 'Post almoço condição especial', 'Atualizar trello'],
  checkinsFeitos: { Carlos: new Set(['Verificar demanda de clientes', 'Post pela manhã']), Ana: new Set(), Diego: new Set(), Ariel: new Set() },
  checkinFinalizado: {}, // nome -> 'YYYY-MM-DD' do dia finalizado
  diaAtual: null,        // controla a virada do dia
  historico: {},         // nome -> { 'YYYY-MM-DD': { feitas, total, finalizado } }
  avisos: [],
  // pontos acumulados na semana (gamificação) — base + o que for feito no app
  pontosBase: { Carlos: 320, Ana: 240, Diego: 150, Ariel: 60 },
  pontosApp: { Carlos: 0, Ana: 0, Diego: 0, Ariel: 0 },
  // meta semanal do "fazer" por consultor (nº de rotinas de check-in concluídas na semana)
  metaSemanal: 40, // 8 rotinas x 5 dias úteis
  progressoSemana: { Carlos: 34, Ana: 28, Diego: 19, Ariel: 6 },
  mensagens: [ { consultor: 'Carlos', de: 'gestor', texto: 'Carlos, tudo certo pra reunião de amanhã?', data: new Date(Date.now() - 3600000).toISOString(), lida: true } ],
  arquivos: [], // arquivos/leads enviados pelo gestor
  times: [],    // times criados manualmente (além dos derivados dos usuários)
  contratacao: { spreadsheetId: '', marcados: {} }, // planilha de candidatos + quem foi contatado
  vendas: [], // CRM: vendas dos consultores
  vendasLog: [], // histórico de inclusão/exclusão de vendas (auditoria)
  cadastros: [], // solicitações de acesso de consultor aguardando aprovação do gestor
  clientes: {}, // registro persistente de clientes por CPF (histórico)
  mural: { ano: new Date().getFullYear(), desafio: 0, expectativa: 0, piso: 0, recado: '', metasTime: {} }, // config do Mural (só gestor edita)
};
function hoje() { return new Date().toISOString().slice(0, 10); }

// ---------- PERSISTÊNCIA (banco próprio em disco) ----------
const fsp = require('fs');
const pathp = require('path');
const PROD = process.env.PROD === '1' || process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR || pathp.join(__dirname, '..', 'data');
const ESTADO_FILE = pathp.join(DATA_DIR, 'estado.json');

// Em produção começa limpo (sem os dados de exemplo do demo)
if (PROD) {
  demo.solicitacoes = []; demo.atividades = []; demo.checkinsFeitos = {}; demo.checkinFinalizado = {};
  demo.historico = {}; demo.avisos = []; demo.pontosBase = {}; demo.pontosApp = {};
  demo.progressoSemana = {}; demo.mensagens = []; demo.diaAtual = hoje(); demo.arquivos = [];
  demo.contratacao = { spreadsheetId: '', marcados: {} }; demo.vendas = []; demo.vendasLog = []; demo.cadastros = []; demo.clientes = {};
}
const UPLOAD_DIR = pathp.join(DATA_DIR, 'uploads');

function serializarEstado() {
  const o = Object.assign({}, demo);
  o.checkinsFeitos = Object.fromEntries(Object.entries(demo.checkinsFeitos).map(([k, v]) => [k, Array.from(v)]));
  return o;
}
function carregarEstado() {
  try {
    if (fsp.existsSync(ESTADO_FILE)) {
      const s = JSON.parse(fsp.readFileSync(ESTADO_FILE, 'utf8'));
      Object.assign(demo, s);
      demo.checkinsFeitos = Object.fromEntries(Object.entries(s.checkinsFeitos || {}).map(([k, v]) => [k, new Set(v)]));
    }
  } catch (e) { console.error('carregarEstado:', e.message); }
  // MIGRAÇÃO p/ identidade por LOGIN: reseta os dados que eram ligados por nome (check-in, pontos,
  // histórico, atividades, agendamentos, conversas, avisos). VENDAS e CLIENTES são preservados.
  if (demo._schema !== 3) {
    demo.checkinsFeitos = {}; demo.checkinFinalizado = {}; demo.historico = {};
    demo.pontosBase = {}; demo.pontosApp = {}; demo.progressoSemana = {};
    demo.atividades = []; demo.solicitacoes = []; demo.mensagens = []; demo.avisos = [];
    demo.diaAtual = hoje();
    demo._schema = 3;
    salvarEstadoSeguro();
  }
}
function salvarEstadoSeguro() { try { salvarEstado(); } catch (e) {} }
function salvarEstado() {
  try { fsp.mkdirSync(DATA_DIR, { recursive: true }); fsp.writeFileSync(ESTADO_FILE, JSON.stringify(serializarEstado())); }
  catch (e) { console.error('salvarEstado:', e.message); }
}
carregarEstado();
setInterval(salvarEstado, 8000);
process.on('SIGTERM', () => { salvarEstado(); process.exit(0); });
process.on('SIGINT', () => { salvarEstado(); process.exit(0); });

// escolhe um subconjunto de rotinas de tamanho n (rotacionado por seed) — para popular dias passados no demo
function subsetRotinas(n, seed) {
  const arr = demo.rotinas.slice();
  const off = ((seed % arr.length) + arr.length) % arr.length;
  const rot = arr.slice(off).concat(arr.slice(0, off));
  return rot.slice(0, n);
}

// Fecha o dia automaticamente na virada: salva o que cada consultor fez (mesmo 0) e zera pro novo dia.
function rolloverDia() {
  const d = hoje();
  if (demo.diaAtual === null) {
    // primeira execução: semeia 6 dias de histórico quantificado (dados de exemplo)
    demo.diaAtual = d;
    const base = { Carlos: 7, Ana: 5, Diego: 4, Ariel: 1 };
    Object.keys(demo.checkinsFeitos).forEach(nome => {
      demo.historico[nome] = {};
      for (let i = 6; i >= 1; i--) {
        const dd = new Date(); dd.setDate(dd.getDate() - i);
        const key = dd.toISOString().slice(0, 10);
        const feitas = Math.max(0, Math.min(demo.rotinas.length, (base[nome] ?? 3) + (((nome.length + i) * 3) % 5 - 2)));
        const rot = subsetRotinas(feitas, nome.length + i);
        demo.historico[nome][key] = { feitas, total: demo.rotinas.length, finalizado: feitas > 0, rotinas: rot };
      }
    });
    return;
  }
  if (demo.diaAtual !== d) {
    Object.keys(demo.checkinsFeitos).forEach(nome => {
      const feitas = demo.checkinsFeitos[nome]?.size || 0;
      demo.historico[nome] = demo.historico[nome] || {};
      demo.historico[nome][demo.diaAtual] = { feitas, total: demo.rotinas.length, finalizado: demo.checkinFinalizado[nome] === demo.diaAtual, rotinas: Array.from(demo.checkinsFeitos[nome] || []) };
      demo.checkinsFeitos[nome] = new Set();      // zera pro novo dia
    });
    demo.checkinFinalizado = {};
    demo.diaAtual = d;
  }
}
function proxDia(offset, hora) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  if (hora != null) { d.setHours(hora, 0, 0, 0); return d.toISOString(); }
  return d.toISOString().slice(0, 10);
}

// ---------- CÁLCULOS AO VIVO (refletem o que o consultor marca) ----------
// lista de consultores do time do gestor, a partir dos acessos reais (data/usuarios.json)
// Gestor "master" vê todos os times (por flag no acesso ou pelo login gestorchama)
function isMaster(session) {
  return !!(session && (session.master === true || String(session.email || '').toLowerCase() === 'gestorchama'));
}
function nomesDoTime(session) {
  try {
    const auth = require('./auth');
    const us = auth.listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false && (isMaster(session) || !session.time || u.time === session.time));
    const nomes = us.map(u => u.nome.split(' ')[0]);
    if (nomes.length) return nomes;
  } catch (e) {}
  return Object.keys(demo.checkinsFeitos); // fallback demo
}

// mapa nome->{cor,cargo} a partir dos acessos (para o balão colorido)
function coresConsultores() {
  const map = {};
  try { require('./auth').listarUsuarios().forEach(u => { if (u.papel === 'consultor') map[u.nome.split(' ')[0]] = { cor: u.cor || '', cargo: u.cargo || '' }; }); } catch (e) {}
  return map;
}
// mapa primeiro-nome -> foto (todos os acessos, para avatares em qualquer lugar)
function fotosPorNome() {
  const map = {};
  try { require('./auth').listarUsuarios().forEach(u => { if (u.foto) map[u.nome.split(' ')[0]] = u.foto; }); } catch (e) {}
  return map;
}
// foto de um consultor pelo PRIMEIRO NOME dentro do time do gestor (evita colisão entre dois nomes iguais de times diferentes)
function fotoConsultorTime(session, primeiroNome) {
  try {
    const us = require('./auth').listarUsuarios();
    const u = us.find(x => x.nome.split(' ')[0] === primeiroNome && (isMaster(session) || !session.time || x.time === session.time));
    return u ? (u.foto || '') : '';
  } catch (e) { return ''; }
}

// ===== IDENTIDADE POR LOGIN (email) =====
// Toda a identidade do sistema é o LOGIN do acesso (campo email), nunca o nome (há nomes repetidos).
function loginDe(session) { return String(session && session.email || '').toLowerCase(); }
function consultoresTime(session) { // usuários consultores no escopo do gestor
  try { return require('./auth').listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false && (isMaster(session) || !session.time || u.time === session.time)); } catch (e) { return []; }
}
function loginsDoTime(session) { return consultoresTime(session).map(u => String(u.email).toLowerCase()); }
function usuarioPorLogin(login) { try { return require('./auth').listarUsuarios().find(u => String(u.email).toLowerCase() === String(login || '').toLowerCase()) || null; } catch (e) { return null; } }
function nomeCurtoDe(login) { const u = usuarioPorLogin(login); return u ? u.nome.split(' ')[0] : String(login || ''); }
function nomeCompletoDe(login) { const u = usuarioPorLogin(login); return u ? u.nome : String(login || ''); }
function fotoDeLogin(login) { const u = usuarioPorLogin(login); return u ? (u.foto || '') : ''; }
function corCargoDe(login) { const u = usuarioPorLogin(login); return u ? { cor: u.cor || '', cargo: u.cargo || '' } : { cor: '', cargo: '' }; }

// visibilidade da solicitação para um gestor: por e-mail (se transferida) ou por time
function visivelPara(session, s) {
  if (isMaster(session)) return true;
  if (s.gestorEmail) return s.gestorEmail === session.email;
  return !session.time || session.time === s.time;
}
function meuTime(session, timeDaSolicitacao) { const t = session.time; return !t || t === timeDaSolicitacao; }
// obs: as chaves abaixo são o LOGIN (email) do consultor
function execPct(uid) { return Math.min(100, Math.round(100 * (demo.progressoSemana[uid] ?? 0) / demo.metaSemanal)); }
function checkinPctHoje(uid) { return Math.round(100 * (demo.checkinsFeitos[uid]?.size || 0) / demo.rotinas.length); }

// ---------- GAMIFICAÇÃO ----------
function pontosDe(uid) { return (demo.pontosBase[uid] || 0) + (demo.pontosApp[uid] || 0); }
function medalha(pos) { return pos === 0 ? '🥇' : pos === 1 ? '🥈' : pos === 2 ? '🥉' : ''; }
function rankingLista() { // ranking de todos os consultores ativos, por login
  let uids = [];
  try { uids = require('./auth').listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false).map(u => String(u.email).toLowerCase()); } catch (e) {}
  if (!uids.length) uids = Object.keys(demo.pontosBase);
  return uids
    .map(uid => ({ uid, nome: nomeCurtoDe(uid), pontos: pontosDe(uid) }))
    .sort((a, b) => b.pontos - a.pontos)
    .map((x, i) => ({ ...x, pos: i + 1, medalha: medalha(i) }));
}

// ---------- CONSULTOR ----------
async function homeConsultor(session) {
  if (DEMO) {
    rolloverDia();
    const nome = session.nome.split(' ')[0]; // apenas exibição
    const uid = loginDe(session);            // IDENTIDADE = login
    const feitos = demo.checkinsFeitos[uid] || (demo.checkinsFeitos[uid] = new Set());
    const rk = rankingLista();
    const meu = rk.find(x => x.uid === uid) || { pos: '-', pontos: 0 };
    const prog = demo.progressoSemana[uid] ?? 0;
    const finalizado = demo.checkinFinalizado[uid] === hoje();
    let cor = '', cargo = '', metaVenda = 0, foto = '';
    try { const u = require('./auth').listarUsuarios().find(x => x.email === session.email); if (u) { cor = u.cor || ''; cargo = u.cargo || ''; metaVenda = +u.metaVenda || 0; foto = u.foto || ''; } } catch (e) {}
    const mesAtual = new Date().toISOString().slice(0, 7);
    const vendidoMes = (demo.vendas || []).filter(v => v.consultorEmail === session.email && v.status === 'fechada' && String(v.data || '').slice(0, 7) === mesAtual).reduce((s, v) => s + (+v.valor || 0), 0);
    return {
      nome, cor, cargo, foto,
      checkin: { feitas: feitos.size, total: demo.rotinas.length, finalizado, completo: feitos.size === demo.rotinas.length, rotinas: demo.rotinas.map(r => ({ nome: r, feita: feitos.has(r) })) },
      proximasReunioes: demo.solicitacoes.filter(s => s.consultorEmail === uid && s.status === 'Aprovada' && new Date(s.inicio) >= new Date(Date.now() - 3600000)).sort((a, b) => a.inicio < b.inicio ? -1 : 1),
      solicitacoes: demo.solicitacoes.filter(s => s.consultorEmail === uid),
      atividades: demo.atividades.filter(a => a.consultorEmail === uid),
      meta: { atual: prog, alvo: demo.metaSemanal, pct: Math.min(100, Math.round(100 * prog / demo.metaSemanal)) },
      metaVendas: { feito: Math.round(vendidoMes * 100) / 100, alvo: metaVenda, pct: metaVenda ? Math.min(100, Math.round(100 * vendidoMes / metaVenda)) : 0 },
      ranking: { posicao: meu.pos, total: rk.length, pontos: meu.pontos, top3: rk.slice(0, 3) },
    };
  }
  // Notion real: consultas filtradas pelo consultorPageId da sessão
  const [sol, atv] = await Promise.all([
    notionFetch(`databases/${DB.agenda}/query`, { filter: { property: 'Consultor', relation: { contains: session.consultorPageId } }, sorts: [{ property: 'Data e Horário', direction: 'descending' }], page_size: 20 }),
    notionFetch(`databases/${DB.atividades}/query`, { filter: { property: 'Consultor', relation: { contains: session.consultorPageId } }, page_size: 50 }),
  ]);
  return { nome: session.nome, solicitacoes: sol.results.map(mapSolicitacao), atividades: atv.results.map(mapAtividade), checkin: await checkinDeHoje(session) };
}

// ---------- TIMES ----------
function listarTimes() {
  let doUsers = [];
  try { doUsers = require('./auth').listarUsuarios().map(u => (u.time || '').trim()).filter(Boolean); } catch (e) {}
  return [...new Set([...(demo.times || []), ...doUsers])].sort((a, b) => a.localeCompare(b));
}
function criarTime(session, { nome }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  const t = (nome || '').trim();
  if (!t) return { erro: 'Escreva o nome do time' };
  if (listarTimes().some(x => x.toLowerCase() === t.toLowerCase())) return { erro: 'Esse time já existe' };
  demo.times = demo.times || []; demo.times.push(t); salvarEstado();
  return { ok: true, times: listarTimes() };
}
function excluirTime(session, { nome }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  const t = (nome || '').trim();
  let emUso = false;
  try { emUso = require('./auth').listarUsuarios().some(u => (u.time || '') === t); } catch (e) {}
  if (emUso) return { erro: 'Há pessoas nesse time. Reatribua-as (na edição de acesso) antes de excluir.' };
  demo.times = (demo.times || []).filter(x => x !== t); salvarEstado();
  return { ok: true, times: listarTimes() };
}

function listarGestores() {
  try { return require('./auth').listarUsuarios().filter(u => u.papel === 'gestor' && u.ativo !== false).map(u => ({ nome: u.nome, email: u.email, time: u.time || '' })); } catch (e) { return []; }
}

async function criarSolicitacao(session, { assunto, inicio, duracao, local, gestorEmail, semEnvio }) {
  if (DEMO) {
    const nome = session.nome.split(' ')[0];
    const nova = { id: 's' + Date.now(), assunto: assunto || 'Reunião', consultor: nome, consultorEmail: loginDe(session), time: session.time, inicio, duracao: duracao || 60, local: local || '', status: 'Pendente' };
    // 1) Só registrar (apontamento próprio, sem enviar para ninguém)
    if (semEnvio) {
      nova.status = 'Aprovada'; nova.apontamento = true; nova.resposta = 'Apontamento próprio (sem aprovação)';
      demo.solicitacoes.unshift(nova);
      return { ok: true, solicitacao: nova, apontamento: true };
    }
    // 2) Enviar para um gestor específico OU para o gestor do time (padrão)
    let alvo = 'gestor:' + (session.time || '');
    let paraNome = '';
    if (gestorEmail) {
      nova.gestorEmail = gestorEmail;
      alvo = 'email:' + gestorEmail;
      try { const g = listarGestores().find(x => x.email === gestorEmail); paraNome = g ? g.nome : ''; } catch (e) {}
    }
    demo.solicitacoes.unshift(nova);
    novoAviso(alvo, 'Nova solicitação de reunião', `${nome} pediu reunião "${nova.assunto}" em ${new Date(inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${local ? ' · ' + local : ''}. Vá em Aprovações para decidir.`);
    return { ok: true, solicitacao: nova, paraNome };
  }
  await notionFetch('pages', {
    parent: { database_id: DB.agenda },
    properties: {
      'Solicitação': { title: [{ text: { content: `Reunião — ${session.nome}` } }] },
      'Consultor': { relation: [{ id: session.consultorPageId }] },
      'Data e Horário': { date: { start: inicio } },
      'Duração': { select: { name: duracaoLabel(duracao) } },
      'Local': { rich_text: [{ text: { content: local || '' } }] },
      'Status': { select: { name: 'Pendente' } },
    },
  });
  return { ok: true };
}

// Gestor envia pedido de reunião para OUTRO gestor (aceite na tela inicial dele)
async function solicitarReuniaoGestor(session, { paraEmail, assunto, inicio, duracao, local }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  if (!paraEmail) return { erro: 'Escolha o gestor de destino' };
  if (!inicio) return { erro: 'Informe a data e o horário' };
  if (String(paraEmail).toLowerCase() === String(session.email).toLowerCase()) return { erro: 'Escolha outro gestor' };
  let g = null;
  try { g = listarGestores().find(x => String(x.email).toLowerCase() === String(paraEmail).toLowerCase()); } catch (e) {}
  if (!g) return { erro: 'Gestor de destino não encontrado' };
  if (DEMO) {
    const nova = {
      id: 's' + Date.now(), assunto: assunto || 'Reunião', consultor: session.nome.split(' ')[0], consultorEmail: loginDe(session),
      deGestor: true, deEmail: session.email, deNome: session.nome,
      gestorEmail: g.email, time: g.time || '', inicio, duracao: duracao || 60, local: local || '', status: 'Pendente',
    };
    demo.solicitacoes.unshift(nova);
    novoAviso('email:' + g.email, 'Reunião de outro gestor', `${session.nome.split(' ')[0]} pediu reunião "${nova.assunto}" em ${new Date(inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${local ? ' · ' + local : ''}. Aceite na tela inicial.`);
    return { ok: true, paraNome: g.nome };
  }
  return { ok: true };
}

async function registrarCheckin(session, { rotina, valor }) {
  if (DEMO) {
    const uid = loginDe(session);
    if (demo.checkinFinalizado[uid] === hoje()) return { erro: 'Check-in do dia já finalizado — não pode alterar' };
    const feitos = demo.checkinsFeitos[uid] || (demo.checkinsFeitos[uid] = new Set());
    if (valor && !feitos.has(rotina)) { feitos.add(rotina); demo.pontosApp[uid] = (demo.pontosApp[uid] || 0) + 5; demo.progressoSemana[uid] = (demo.progressoSemana[uid] || 0) + 1; }
    else if (!valor && feitos.has(rotina)) { feitos.delete(rotina); demo.pontosApp[uid] = (demo.pontosApp[uid] || 0) - 5; demo.progressoSemana[uid] = Math.max(0, (demo.progressoSemana[uid] || 0) - 1); }
    const completo = feitos.size === demo.rotinas.length;
    // 100% NÃO trava — só comemora. A trava é manual (botão) ou automática na virada do dia.
    return { ok: true, feitas: feitos.size, completo, finalizado: demo.checkinFinalizado[uid] === hoje() };
  }
  // Notion real: cria/atualiza registro do dia no database de check-in (implementação na integração final)
  return { ok: true };
}

async function finalizarCheckin(session) {
  if (DEMO) { demo.checkinFinalizado[loginDe(session)] = hoje(); return { ok: true }; }
  return { ok: true };
}

async function checkinDeHoje() { return { feitas: 0, total: 8, rotinas: demo.rotinas }; }

async function atualizarAtividade(session, { id, status }) {
  if (DEMO) {
    const a = demo.atividades.find(x => x.id === id);
    if (a) {
      const eraFeito = a.status === 'Feito';
      a.status = status;
      const alvoPt = a.consultorEmail || a.consultor; // pontos por login
      if (status === 'Feito' && !eraFeito) demo.pontosApp[alvoPt] = (demo.pontosApp[alvoPt] || 0) + 10;
      if (status !== 'Feito' && eraFeito) demo.pontosApp[alvoPt] = (demo.pontosApp[alvoPt] || 0) - 10;
      // recorrência: ao concluir uma recorrente, gera a próxima ocorrência
      if (status === 'Feito' && a.recorrente) {
        const prox = new Date(a.prazo || hoje()); prox.setDate(prox.getDate() + 7);
        demo.atividades.unshift({ id: 'a' + Date.now(), titulo: a.titulo, consultor: a.consultor, consultorEmail: a.consultorEmail, tipo: a.tipo, prazo: prox.toISOString().slice(0, 10), status: 'A fazer', recorrente: true });
      }
    }
    return { ok: true };
  }
  await fetch(`https://api.notion.com/v1/pages/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { Status: { select: { name: status } } } }),
  });
  return { ok: true };
}

// ---------- GESTOR ----------
async function listarRotinas() { return { rotinas: demo.rotinas.slice() }; }
async function salvarRotinas(session, { rotinas }) {
  if (!Array.isArray(rotinas)) return { erro: 'Lista inválida' };
  const limpo = rotinas.map(r => String(r).trim()).filter(Boolean);
  if (!limpo.length) return { erro: 'A lista não pode ficar vazia' };
  demo.rotinas = limpo;
  return { ok: true, rotinas: demo.rotinas };
}
// destinatários possíveis para atividades: consultores do time + todos os gestores (menos você)
async function destinatarios(session) {
  try {
    const us = require('./auth').listarUsuarios().filter(u => u.ativo !== false);
    const consultores = us.filter(u => u.papel === 'consultor' && (isMaster(session) || !session.time || u.time === session.time)).map(u => ({ nome: u.nome.split(' ')[0], nomeCompleto: u.nome, login: String(u.email).toLowerCase(), papel: 'consultor', time: u.time || '' }));
    const gestores = us.filter(u => u.papel === 'gestor' && u.email !== session.email).map(u => ({ nome: u.nome, login: String(u.email).toLowerCase(), papel: 'gestor', time: u.time || '' }));
    return { consultores, gestores };
  } catch (e) { return { consultores: [], gestores: [] }; }
}

async function painelGestor(session) {
  if (DEMO) {
    rolloverDia();
    const cts = consultoresTime(session);              // usuários (objetos)
    const logins = cts.map(u => String(u.email).toLowerCase()); // identidade
    const checkinMedia = logins.length ? Math.round(logins.reduce((s, l) => s + checkinPctHoje(l), 0) / logins.length) : 0;
    const atvTime = demo.atividades.filter(a => logins.includes(String(a.consultorEmail || '').toLowerCase()));
    const tarefas = {
      atrasadas: atvTime.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada' && a.prazo < hoje()).length,
      pendentes: atvTime.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada' && a.prazo >= hoje()).length,
      finalizadas: atvTime.filter(a => a.status === 'Feito').length,
    };
    return {
      time: session.time || 'Chama',
      email: session.email,
      nome: session.nome,
      master: isMaster(session),
      fotos: fotosPorNome(),
      foto: (() => { try { const u = require('./auth').listarUsuarios().find(x => x.email === session.email); return u ? (u.foto || '') : ''; } catch (e) { return ''; } })(),
      cor: (() => { try { const u = require('./auth').listarUsuarios().find(x => x.email === session.email); return u ? (u.cor || '') : ''; } catch (e) { return ''; } })(),
      tarefas,
      kpis: { checkinPct: checkinMedia, atrasadas: tarefas.atrasadas, pendentes: demo.solicitacoes.filter(s => s.status === 'Pendente' && visivelPara(session, s)).length },
      execucao: cts.map(u => { const l = String(u.email).toLowerCase(); return { nome: u.nome, email: l, pct: execPct(l), cor: u.cor || '', cargo: u.cargo || '', foto: u.foto || '' }; }).sort((a, b) => b.pct - a.pct),
      pendentes: demo.solicitacoes.filter(s => s.status === 'Pendente' && visivelPara(session, s)).map(s => { const cc = corCargoDe(s.consultorEmail); return { ...s, consultor: nomeCompletoDe(s.consultorEmail), cor: cc.cor, cargo: cc.cargo, foto: fotoDeLogin(s.consultorEmail) }; }),
      decididas: demo.solicitacoes.filter(s => ['Aprovada', 'Recusada', 'Reagendar'].includes(s.status) && visivelPara(session, s)).slice(0, 10).map(s => ({ ...s, consultor: nomeCompletoDe(s.consultorEmail), cor: corCargoDe(s.consultorEmail).cor })),
      atividadesAtrasadas: demo.atividades.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada' && a.prazo < hoje() && logins.includes(String(a.consultorEmail || '').toLowerCase())).map(a => ({ ...a, consultor: nomeCompletoDe(a.consultorEmail), foto: fotoDeLogin(a.consultorEmail) })),
      consultores: cts.map(u => ({ nome: u.nome, email: String(u.email).toLowerCase() })),
      minhasTarefas: demo.atividades.filter(a => String(a.consultorEmail || '').toLowerCase() === loginDe(session) && a.status !== 'Cancelada').map(a => ({ id: a.id, titulo: a.titulo, tipo: a.tipo, prazo: a.prazo, status: a.status, de: a.criadaPor || '' })),
    };
  }
  // Notion real: agregações equivalentes filtradas pelo time do gestor
  return {};
}

// Acha o gestor do time do consultor (que tenha agenda Google configurada)
function gestorDoConsultor(session) {
  try {
    const us = require('./auth').listarUsuarios().filter(u => u.papel === 'gestor' && u.ativo !== false);
    // prioriza gestor do mesmo time com calendarId; senão qualquer gestor do time; senão qualquer gestor com calendarId
    return us.find(u => u.time === session.time && u.calendarId)
      || us.find(u => u.time === session.time)
      || us.find(u => u.calendarId)
      || null;
  } catch (e) { return null; }
}

// Lê o calendarId ATUAL do gestor (o da sessão pode estar desatualizado se ele editou depois do login)
function calendarIdDe(session) {
  try { const u = require('./auth').listarUsuarios().find(x => x.email === session.email); if (u && u.calendarId) return u.calendarId; } catch (e) {}
  return session.calendarId || null;
}

// Disponibilidade da semana do gestor para o consultor (livre / reservado / ocupado)
// Reservado = solicitação Pendente (já bloqueia o horário, aguardando aprovação)
// Ocupado   = reunião Aprovada (ou evento externo do Google Agenda do gestor)
async function disponibilidade(session) {
  const google = require('./google');
  const gestor = gestorDoConsultor(session);
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio); fim.setDate(fim.getDate() + 7);
  const base = { inicio: inicio.toISOString(), fim: fim.toISOString(), gestor: gestor ? gestor.nome : '' };
  // 1) reservas do próprio app (solicitações Pendente/Aprovada desse gestor)
  const reservas = [];
  if (gestor) {
    const iniMs = inicio.getTime(), fimMs = fim.getTime();
    (demo.solicitacoes || []).forEach(s => {
      if (s.status !== 'Pendente' && s.status !== 'Aprovada') return;
      // pertence a este gestor? (por e-mail se transferida, senão pelo time)
      const doGestor = s.gestorEmail ? (s.gestorEmail === gestor.email) : (!gestor.time || s.time === gestor.time);
      if (!doGestor) return;
      const ini = new Date(s.inicio); const iMs = ini.getTime();
      if (isNaN(iMs) || iMs < iniMs || iMs >= fimMs) return;
      const fimR = new Date(iMs + (+s.duracao || 60) * 60000);
      const meu = String(s.consultorEmail || '').toLowerCase() === loginDe(session);
      reservas.push({ inicio: ini.toISOString(), fim: fimR.toISOString(), tipo: s.status === 'Pendente' ? 'reservado' : 'ocupado', meu });
    });
  }
  // 2) ocupados externos do Google (se conectado)
  let googleOcup = [], googleAtivo = false, motivo = null;
  if (!google.ATIVO) motivo = 'google-off';
  else if (!gestor || !gestor.calendarId) motivo = 'sem-calendario';
  else {
    try {
      const r = await google.freeBusy(gestor.calendarId, inicio.toISOString(), fim.toISOString());
      googleOcup = (r.ocupados || []).map(o => ({ inicio: o.inicio, fim: o.fim, tipo: 'ocupado' }));
      googleAtivo = true;
    } catch (e) {
      console.error('disponibilidade/freeBusy:', e.message || e);
      motivo = 'erro'; base.erro = String(e.message || e);
    }
  }
  const ocupados = reservas.concat(googleOcup);
  // grade sempre visível quando há um gestor (mostra ao menos as reservas do app)
  return { ...base, ativo: !!gestor, googleAtivo, motivo, ocupados };
}

async function agendaGestor(session) {
  if (DEMO) {
    const eventos = demo.solicitacoes.filter(s => s.status !== 'Recusada' && s.status !== 'Cancelada' && visivelPara(session, s)).map(s => ({ ...s, vinculado: !!s.googleEventId }));
    let googleEventos = [];
    const calId = calendarIdDe(session);
    if (require('./google').ATIVO && calId) {
      try {
        const ini = new Date(); ini.setDate(ini.getDate() - 7);
        const fim = new Date(); fim.setDate(fim.getDate() + 21);
        const r = await require('./google').listarEventos(calId, ini.toISOString(), fim.toISOString());
        // não duplicar: esconde do Google os eventos que o próprio app criou ao aprovar (já aparecem como solicitação Aprovada)
        const idsDoApp = new Set(demo.solicitacoes.filter(s => s.googleEventId).map(s => s.googleEventId));
        googleEventos = r.eventos.filter(e => !idsDoApp.has(e.id)).map(e => ({ id: e.id, assunto: e.titulo, consultor: '(Google)', inicio: e.inicio, duracao: 60, local: e.local, status: 'Google', link: e.link, google: true }));
      } catch (e) { /* ignora falha do Google, mostra ao menos as solicitações */ }
    }
    return { eventos, googleEventos, googleAtivo: require('./google').ATIVO };
  }
  return { eventos: [], googleEventos: [] };
}

// calendário onde o evento da solicitação foi criado (do gestor responsável)
function calendarIdDeSolic(s) {
  try {
    const us = require('./auth').listarUsuarios();
    let g = null;
    if (s.gestorEmail) g = us.find(u => u.email === s.gestorEmail);
    if (!g) g = us.find(u => u.papel === 'gestor' && u.time === s.time && u.calendarId);
    return g ? (g.calendarId || null) : null;
  } catch (e) { return null; }
}

async function cancelarSolicitacao(session, { id }) {
  if (DEMO) {
    const s = demo.solicitacoes.find(x => x.id === id && (x.consultorEmail === loginDe(session) || x.consultor === session.nome.split(' ')[0]));
    if (!s) return { erro: 'Solicitação não encontrada' };
    if (!['Pendente', 'Aprovada'].includes(s.status)) return { erro: 'Não é possível cancelar' };
    // se havia evento no Google, tenta removê-lo
    if (s.googleEventId) {
      try {
        const g = require('./google');
        const cal = calendarIdDeSolic(s);
        if (g.ATIVO && cal) await g.deletarEvento(cal, s.googleEventId);
      } catch (e) { console.error('cancelar/deletarEvento:', e.message || e); }
    }
    // avisa o gestor se era uma reunião aprovada por ele (não apontamento próprio)
    if (s.status === 'Aprovada' && !s.apontamento) {
      const quando = new Date(s.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      novoAviso(s.gestorEmail ? 'email:' + s.gestorEmail : 'gestor:' + (s.time || ''), 'Reunião cancelada', `${s.consultor} cancelou a reunião de ${quando} ("${s.assunto || 'Reunião'}").`);
    }
    s.status = 'Cancelada';
    return { ok: true };
  }
  // Notion real: PATCH status → Cancelada (adicionar a opção no select do database)
  return { ok: true };
}

// Gestor cancela um compromisso da agenda dele (reunião aprovada, apontamento ou pendente)
async function cancelarSolicitacaoGestor(session, { id }) {
  if (DEMO) {
    const s = demo.solicitacoes.find(x => x.id === id);
    if (!s || !visivelPara(session, s)) return { erro: 'Compromisso não encontrado' };
    if (!['Pendente', 'Aprovada'].includes(s.status)) return { erro: 'Não é possível cancelar' };
    if (s.googleEventId) {
      try { const g = require('./google'); const cal = calendarIdDeSolic(s); if (g.ATIVO && cal) await g.deletarEvento(cal, s.googleEventId); }
      catch (e) { console.error('cancelarGestor/deletarEvento:', e.message || e); }
    }
    const quando = new Date(s.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    if (s.deGestor && s.deEmail) novoAviso('email:' + s.deEmail, 'Compromisso cancelado', `Seu gestor cancelou "${s.assunto || 'Reunião'}" de ${quando}.`);
    else novoAviso('login:' + (s.consultorEmail || ''), 'Compromisso cancelado', `Seu gestor cancelou "${s.assunto || 'Reunião'}" de ${quando}.`);
    s.status = 'Cancelada';
    return { ok: true };
  }
  return { ok: true };
}

// Remove uma solicitação já recusada/cancelada da lista do consultor
async function excluirSolicitacao(session, { id }) {
  if (DEMO) {
    const uid = loginDe(session);
    const i = demo.solicitacoes.findIndex(x => x.id === id && (x.consultorEmail === uid || x.consultor === session.nome.split(' ')[0]));
    if (i < 0) return { erro: 'Solicitação não encontrada' };
    if (demo.solicitacoes[i].status === 'Pendente') return { erro: 'Cancele a solicitação antes de excluir' };
    demo.solicitacoes.splice(i, 1);
    return { ok: true };
  }
  return { ok: true };
}

async function cancelarAtividade(session, { id, justificativa }) {
  if (DEMO) {
    const a = demo.atividades.find(x => x.id === id);
    if (!a) return { erro: 'Atividade não encontrada' };
    if (a.status === 'Feito') return { erro: 'Atividade já concluída não pode ser cancelada' };
    if (session.papel === 'consultor') {
      if ((a.consultorEmail || a.consultor) !== loginDe(session) && a.consultor !== session.nome.split(' ')[0]) return { erro: 'Essa atividade não é sua' };
      if (!justificativa || !justificativa.trim()) return { erro: 'Escreva uma justificativa para cancelar' };
      a.status = 'Cancelada'; a.justificativa = justificativa.trim(); a.canceladaPor = 'consultor';
      novoAviso('gestor:' + (session.time || ''), 'Atividade cancelada pelo consultor', `${session.nome.split(' ')[0]} cancelou "${a.titulo}". Motivo: ${a.justificativa}`);
    } else {
      // gestor cancela sem justificativa
      a.status = 'Cancelada'; a.canceladaPor = 'gestor'; a.justificativa = justificativa || '';
      novoAviso(a.consultor, 'Atividade cancelada', `Seu gestor cancelou a atividade "${a.titulo}".`);
    }
    return { ok: true };
  }
  return { ok: true };
}

async function criarAtividade(session, { consultorEmail, consultor, titulo, tipo, prazo, recorrente }) {
  // destinatário identificado pelo LOGIN (consultorEmail). Fallback: nome antigo.
  const alvoLogin = String(consultorEmail || '').toLowerCase();
  const u = alvoLogin ? usuarioPorLogin(alvoLogin) : null;
  if (!titulo || (!u && !consultor)) return { erro: 'Preencha o destinatário e a atividade' };
  if (DEMO) {
    const deQuem = session.nome || 'Gestor';
    const nomeExib = u ? u.nome.split(' ')[0] : consultor;
    const loginExib = u ? String(u.email).toLowerCase() : '';
    demo.atividades.unshift({ id: 'a' + Date.now(), titulo, consultor: nomeExib, consultorEmail: loginExib, tipo: tipo || 'Outro', prazo: prazo || hoje(), status: 'A fazer', recorrente: !!recorrente, criadaPor: deQuem });
    // roteia o aviso pelo LOGIN: gestor → email:, consultor → login:
    let alvo = u ? (u.papel === 'gestor' ? 'email:' + u.email : 'login:' + loginExib) : consultor;
    novoAviso(alvo, 'Nova atividade', `${deQuem} enviou: "${titulo}" (${tipo || 'Outro'})${recorrente ? ' 🔁 semanal' : ''}${prazo ? ' — prazo ' + prazo.slice(8, 10) + '/' + prazo.slice(5, 7) : ''}.`);
    return { ok: true };
  }
  await notionFetch('pages', {
    parent: { database_id: DB.atividades },
    properties: {
      'Atividade': { title: [{ text: { content: titulo } }] },
      'Tipo': { select: { name: tipo || 'Outro' } },
      'Status': { select: { name: 'A fazer' } },
      ...(prazo ? { 'Prazo': { date: { start: prazo } } } : {}),
    },
  });
  return { ok: true };
}

const google = require('./google');

async function decidirSolicitacao(session, { id, decisao, resposta, paraTime, paraEmail, paraNome }) {
  if (DEMO) {
    const s = demo.solicitacoes.find(x => x.id === id);
    if (s) {
      // TRANSFERIR: manda a solicitação para outro time/gestor, volta a Pendente lá
      if (decisao === 'Transferir') {
        if (!paraEmail) return { erro: 'Escolha o gestor de destino' };
        const origem = session.nome.split(' ')[0];
        s.status = 'Pendente';
        s.transferidaDe = origem;
        s.gestorEmail = paraEmail;          // roteia por e-mail (robusto, independe do time)
        if (paraTime) s.time = paraTime;
        novoAviso('email:' + paraEmail, 'Solicitação transferida', `${origem} transferiu uma reunião de ${s.consultor} para você aprovar.${resposta ? ' Obs: ' + resposta : ''}`);
        if (s.deGestor && s.deEmail) novoAviso('email:' + s.deEmail, 'Reunião transferida', `Sua reunião foi encaminhada para ${paraNome || 'outro gestor'} aprovar.`);
        else novoAviso('login:' + (s.consultorEmail || ''), 'Reunião transferida', `Sua reunião foi encaminhada para ${paraNome || 'outro gestor'} aprovar.`);
        return { ok: true, transferida: true, paraNome: paraNome || paraEmail };
      }
      s.status = decisao; s.resposta = resposta || '';
      if (decisao === 'Aprovada') {
        const fim = new Date(new Date(s.inicio).getTime() + (s.duracao || 60) * 60000).toISOString();
        const ev = await google.criarEvento(calendarIdDe(session) || 'primary', { titulo: `${s.assunto || 'Reunião'} — ${s.consultor}`, inicioISO: s.inicio, fimISO: fim, local: s.local, descricao: `Aprovada via app. Consultor: ${s.consultor} · Time: ${s.time}` });
        s.googleEventId = ev.id; s.googleLink = ev.link; s.noGoogle = true;
      }
      const quando = new Date(s.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const msg = decisao === 'Aprovada' ? `Sua reunião de ${quando} foi APROVADA ✅ — já está na agenda do gestor.` : decisao === 'Recusada' ? `Sua reunião de ${quando} foi recusada.${resposta ? ' Motivo: ' + resposta : ''}` : `Pediram para reagendar a reunião de ${quando}.${resposta ? ' Sugestão: ' + resposta : ''} Envie nova solicitação.`;
      // se o remetente for outro gestor, avisa por e-mail; senão avisa o consultor pelo primeiro nome
      if (s.deGestor && s.deEmail) novoAviso('email:' + s.deEmail, `Reunião ${decisao.toLowerCase()}`, msg);
      else novoAviso('login:' + (s.consultorEmail || ''), `Reunião ${decisao.toLowerCase()}`, msg);
      if (decisao === 'Reagendar') {
        const prazo = new Date(); prazo.setDate(prazo.getDate() + 2);
        demo.atividades.unshift({ id: 'a' + Date.now(), titulo: `Reagendar reunião (era ${quando})${resposta ? ' — sugestão: ' + resposta : ''}`, consultor: s.consultor, consultorEmail: s.consultorEmail, tipo: 'Reunião', prazo: prazo.toISOString().slice(0, 10), status: 'A fazer' });
      }
    }
    const s2 = demo.solicitacoes.find(x => x.id === id);
    return { ok: true, googleCalendar: decisao === 'Aprovada' ? (google.ATIVO ? 'evento criado no Google ✓' : 'evento simulado (Google ativa na publicação)') : null, link: s2?.googleLink || null };
  }
  // Notion real + criação no Google Calendar via API (rota implementada na integração final)
  return { ok: true };
}

// Todos os consultores ativos (todos os times) — para o ranking geral
function todosConsultores() {
  try {
    const us = require('./auth').listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false);
    if (us.length) return us.map(u => ({ nome: u.nome, time: u.time || '', cor: u.cor || '' }));
  } catch (e) {}
  return Object.keys(demo.checkinsFeitos).map(n => ({ nome: n, time: '', cor: '' }));
}

async function rankingGestor(session) {
  if (DEMO) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    let users = [];
    try { users = require('./auth').listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false); } catch (e) {}
    const rk = users.map(u => {
      const nome = u.nome;
      const uid = String(u.email).toLowerCase();
      const vendido = (demo.vendas || []).filter(v => v.consultorEmail === u.email && v.status === 'fechada' && String(v.data || '').slice(0, 7) === mesAtual).reduce((s, v) => s + (+v.valor || 0), 0);
      const metaV = +u.metaVenda || 0;
      const vendasPct = metaV ? Math.min(100, Math.round(100 * vendido / metaV)) : 0;
      const prog = demo.progressoSemana[uid] ?? 0;
      const checkPct = demo.metaSemanal ? Math.min(100, Math.round(100 * prog / demo.metaSemanal)) : 0;
      const pontos = vendasPct + checkPct; // premiação: 0 a 200 (vendas + check-in)
      return { nome, email: uid, foto: u.foto || '', time: u.time || '', cor: u.cor || '', vendido: Math.round(vendido * 100) / 100, metaVenda: metaV, vendasPct, checkAtual: prog, checkAlvo: demo.metaSemanal, checkPct, pontos };
    }).sort((a, b) => b.pontos - a.pontos || b.vendido - a.vendido).map((x, i) => ({ ...x, pos: i + 1, medalha: medalha(i) }));
    return { ranking: rk, metaSemanal: demo.metaSemanal };
  }
  return { ranking: [] };
}

async function definirMeta(session, { alvo }) {
  if (DEMO) { demo.metaSemanal = Math.max(1, +alvo || demo.metaSemanal); return { ok: true, metaSemanal: demo.metaSemanal }; }
  return { ok: true };
}

async function controleGestor(session) {
  if (DEMO) {
    rolloverDia();
    const cts = consultoresTime(session);
    const dias = [];
    const chaves = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      chaves.push(d.toISOString().slice(0, 10));
      dias.push({ label: ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'][d.getDay()], data: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') });
    }
    const consultores = cts.map(u => {
      const uid = String(u.email).toLowerCase();
      const nome = u.nome;
      const hist = demo.historico[uid] || {};
      const envios = chaves.map((k, i) => {
        if (i === 6) return { enviou: (demo.checkinsFeitos[uid] || new Set()).size > 0, feitas: (demo.checkinsFeitos[uid] || new Set()).size };
        const h = hist[k];
        return { enviou: !!(h && h.feitas > 0), feitas: h ? h.feitas : 0 };
      });
      const enviosDias = envios.map(e => e.enviou);
      const minhas = demo.atividades.filter(a => String(a.consultorEmail || '').toLowerCase() === uid);
      return {
        nome,
        email: uid,
        foto: u.foto || '',
        cor: u.cor || '',
        cargo: u.cargo || '',
        envios: enviosDias,
        enviosDetalhe: envios,
        totalEnvios: enviosDias.filter(Boolean).length,
        tarefas: {
          abertas: minhas.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada').map(a => ({ id: a.id, titulo: a.titulo, status: a.status, prazo: a.prazo, atrasada: a.prazo < hoje() })),
          feitas: minhas.filter(a => a.status === 'Feito').map(a => ({ titulo: a.titulo, tipo: a.tipo })),
          canceladas: minhas.filter(a => a.status === 'Cancelada').map(a => ({ titulo: a.titulo, justificativa: a.justificativa || '', por: a.canceladaPor })),
        },
      };
    });
    return { dias, consultores };
  }
  // Notion real: agrega check-ins por data e atividades por consultor
  return { dias: [], consultores: [] };
}

async function perfilConsultor(session, ident) {
  if (DEMO) {
    rolloverDia();
    const uid = String(ident || '').toLowerCase(); // IDENTIDADE = login
    const u = usuarioPorLogin(uid);
    const nome = u ? u.nome : String(ident || '');
    const feitos = demo.checkinsFeitos[uid] || new Set();
    const atividades = demo.atividades.filter(a => String(a.consultorEmail || '').toLowerCase() === uid);
    const reunioes = demo.solicitacoes.filter(s => String(s.consultorEmail || '').toLowerCase() === uid);
    const exec = execPct(uid);
    const nomesDia = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const hist = demo.historico[uid] || {};
    const historico7d = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const rotinasFeitas = i === 0 ? Array.from(feitos) : (hist[key] && hist[key].rotinas ? hist[key].rotinas : []);
      const feitasDia = i === 0 ? feitos.size : (hist[key] ? hist[key].feitas : 0);
      const pct = Math.round(100 * feitasDia / demo.rotinas.length);
      historico7d.push({ dia: nomesDia[d.getDay()], data: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), feitas: feitasDia, total: demo.rotinas.length, pct, rotinasFeitas, hoje: i === 0 });
    }
    const info = { cor: u ? (u.cor || '') : '', cargo: u ? (u.cargo || '') : '' };
    const time = u ? (u.time || '') : '';
    return {
      nome, email: uid, time, foto: u ? (u.foto || '') : '', execucao: exec, cor: info.cor || '', cargo: info.cargo || '',
      checkinHoje: { feitas: feitos.size, total: demo.rotinas.length, rotinas: demo.rotinas.map(r => ({ nome: r, feita: feitos.has(r) })) },
      todasRotinas: demo.rotinas.slice(),
      historico7d,
      atividades: {
        pendentes: atividades.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada').map(a => ({ titulo: a.titulo, tipo: a.tipo, prazo: a.prazo, status: a.status })),
        feitas: atividades.filter(a => a.status === 'Feito').map(a => ({ titulo: a.titulo, tipo: a.tipo })),
        canceladas: atividades.filter(a => a.status === 'Cancelada').map(a => ({ titulo: a.titulo, justificativa: a.justificativa || '', por: a.canceladaPor || '' })),
        totalFeitas: atividades.filter(a => a.status === 'Feito').length,
      },
      agendas: reunioes.sort((a, b) => a.inicio < b.inicio ? 1 : -1).map(r => ({ assunto: r.assunto || 'Reunião', inicio: r.inicio, duracao: r.duracao, local: r.local || '', status: r.status, resposta: r.resposta || '' })),
      reunioes: { proximas: reunioes.filter(r => r.status === 'Aprovada' && r.inicio >= new Date().toISOString()), total: reunioes.length },
    };
  }
  // Notion real: agregações por consultorPageId
  return {};
}

// ---------- CHAT (consultor ↔ gestor do time) ----------
async function listarChat(session, consultorParam) {
  // identidade da conversa = LOGIN do consultor
  const uid = session.papel === 'consultor' ? loginDe(session) : String(consultorParam || '').toLowerCase();
  if (!uid) {
    // gestor sem consultor selecionado: lista os consultores do time com não lidas
    return { lista: consultoresTime(session).map(u => { const l = String(u.email).toLowerCase(); return { nome: u.nome, email: l, foto: u.foto || '', naoLidas: demo.mensagens.filter(m => String(m.consultorEmail || '').toLowerCase() === l && m.de === 'consultor' && !m.lida).length }; }) };
  }
  const thread = demo.mensagens.filter(m => String(m.consultorEmail || '').toLowerCase() === uid);
  const paraMim = session.papel === 'consultor' ? 'gestor' : 'consultor';
  thread.forEach(m => { if (m.de === paraMim) m.lida = true; });
  return { consultor: nomeCompletoDe(uid), email: uid, mensagens: thread };
}

async function enviarChat(session, { consultor, texto }) {
  if (!texto || !texto.trim()) return { erro: 'Mensagem vazia' };
  const uid = session.papel === 'consultor' ? loginDe(session) : String(consultor || '').toLowerCase();
  if (!uid) return { erro: 'Selecione o consultor' };
  const de = session.papel;
  demo.mensagens.push({ consultorEmail: uid, de, texto: texto.trim(), data: new Date().toISOString(), lida: false });
  if (de === 'consultor') novoAviso('gestor:' + (session.time || ''), 'Nova mensagem', `${session.nome.split(' ')[0]}: ${texto.trim().slice(0, 60)}`);
  else novoAviso('login:' + uid, 'Nova mensagem do gestor', texto.trim().slice(0, 60));
  return { ok: true };
}

function chatNaoLidas(session) {
  if (session.papel === 'consultor') return demo.mensagens.filter(m => String(m.consultorEmail || '').toLowerCase() === loginDe(session) && m.de === 'gestor' && !m.lida).length;
  return demo.mensagens.filter(m => m.de === 'consultor' && !m.lida).length;
}

// ---------- AVISOS (caixa de notificações no site) ----------
function novoAviso(para, titulo, texto) {
  demo.avisos.unshift({ id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), para, titulo, texto, lida: false, data: new Date().toISOString() });
}

async function listarAvisos(session) {
  const chaves = session.papel === 'gestor' ? ['gestor:' + (session.time || ''), 'email:' + session.email, 'gestores'] : ['login:' + loginDe(session), session.nome.split(' ')[0]];
  const meus = demo.avisos.filter(a => chaves.includes(a.para));
  return { avisos: meus, naoLidas: meus.filter(a => !a.lida).length };
}

async function marcarAvisoLido(session, { id }) {
  const a = demo.avisos.find(x => x.id === id);
  if (a) a.lida = true;
  return { ok: true };
}

async function excluirAviso(session, { id, todos }) {
  const chaves = session.papel === 'gestor' ? ['gestor:' + (session.time || ''), 'email:' + session.email, 'gestores'] : ['login:' + loginDe(session), session.nome.split(' ')[0]];
  if (todos) { demo.avisos = demo.avisos.filter(a => !chaves.includes(a.para)); return { ok: true }; }
  demo.avisos = demo.avisos.filter(a => !(a.id === id && chaves.includes(a.para)));
  return { ok: true };
}

// ---------- ARQUIVOS / LEADS ----------
function nomeArquivoSeguro(n) { return String(n || 'arquivo').replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_').slice(0, 80); }
function podeVerArquivo(session, a) {
  if (session.papel === 'gestor') return true;
  const nome = session.nome.split(' ')[0];
  if (!a.destino || a.destino === 'Todos') return true;
  if (a.destino === session.time) return true;
  if (Array.isArray(a.nomes) && a.nomes.includes(nome)) return true;
  return false;
}
const ARQUIVO_TTL = 7 * 24 * 3600 * 1000; // arquivos expiram em 7 dias
function limparArquivosAntigos() {
  if (!demo.arquivos || !demo.arquivos.length) return false;
  const limite = Date.now() - ARQUIVO_TTL;
  const expirados = demo.arquivos.filter(a => new Date(a.data).getTime() < limite);
  if (!expirados.length) return false;
  expirados.forEach(a => { try { fsp.unlinkSync(pathp.join(UPLOAD_DIR, a.arquivoFs)); } catch (e) {} });
  demo.arquivos = demo.arquivos.filter(a => new Date(a.data).getTime() >= limite);
  salvarEstado();
  return true;
}
setInterval(limparArquivosAntigos, 60 * 60 * 1000); // varre de hora em hora
limparArquivosAntigos(); // e uma vez no boot

async function listarArquivos(session) {
  limparArquivosAntigos();
  const lista = (demo.arquivos || []).filter(a => podeVerArquivo(session, a))
    .map(a => ({ id: a.id, titulo: a.titulo, nome: a.nome, tipo: a.tipo, tamanho: a.tamanho, destino: a.destino, criadoPor: a.criadoPor, data: a.data, expiraEm: new Date(new Date(a.data).getTime() + ARQUIVO_TTL).toISOString(), baixadoPor: a.baixadoPor || [] }));
  return { arquivos: lista, souGestor: session.papel === 'gestor' };
}
async function salvarArquivo(session, { titulo, nome, tipo, dadosBase64, destino }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  if (!dadosBase64) return { erro: 'Arquivo vazio' };
  let buf;
  try { buf = Buffer.from(String(dadosBase64).split(',').pop(), 'base64'); } catch (e) { return { erro: 'Arquivo inválido' }; }
  if (!buf || !buf.length) return { erro: 'Arquivo vazio' };
  if (buf.length > 15 * 1024 * 1024) return { erro: 'Arquivo muito grande (máximo 15 MB)' };
  const id = 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
  const arquivoFs = id + '_' + nomeArquivoSeguro(nome);
  try { fsp.mkdirSync(UPLOAD_DIR, { recursive: true }); fsp.writeFileSync(pathp.join(UPLOAD_DIR, arquivoFs), buf); }
  catch (e) { return { erro: 'Falha ao salvar: ' + e.message }; }
  const meta = { id, titulo: titulo || nome || 'Arquivo', nome: nome || 'arquivo', tipo: tipo || 'application/octet-stream', tamanho: buf.length, destino: destino || 'Todos', arquivoFs, criadoPor: session.nome, criadoPorEmail: session.email, data: new Date().toISOString() };
  demo.arquivos = demo.arquivos || []; demo.arquivos.unshift(meta);
  try {
    const us = require('./auth').listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false && (meta.destino === 'Todos' || u.time === meta.destino));
    us.forEach(u => novoAviso('login:' + String(u.email).toLowerCase(), 'Novo arquivo disponível', `${session.nome} enviou "${meta.titulo}". Veja em Início › Arquivos do gestor.`));
  } catch (e) {}
  salvarEstado();
  return { ok: true, arquivo: { id: meta.id, titulo: meta.titulo } };
}
async function excluirArquivo(session, { id }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  const i = (demo.arquivos || []).findIndex(a => a.id === id);
  if (i < 0) return { erro: 'Arquivo não encontrado' };
  try { fsp.unlinkSync(pathp.join(UPLOAD_DIR, demo.arquivos[i].arquivoFs)); } catch (e) {}
  demo.arquivos.splice(i, 1); salvarEstado();
  return { ok: true };
}
function arquivoParaDownload(session, id) {
  const a = (demo.arquivos || []).find(x => x.id === id);
  if (!a || !podeVerArquivo(session, a)) return null;
  // Notifica o gestor quando um consultor baixa (uma vez por consultor)
  if (session.papel === 'consultor') {
    const uid = loginDe(session);
    const nome = session.nome.split(' ')[0];
    a.baixadoPor = a.baixadoPor || [];
    if (!a.baixadoPor.includes(uid)) {
      a.baixadoPor.push(uid);
      if (a.criadoPorEmail) novoAviso('email:' + a.criadoPorEmail, 'Arquivo baixado', `${nome} baixou "${a.titulo}".`);
      salvarEstado();
    }
  }
  return { path: pathp.join(UPLOAD_DIR, a.arquivoFs), nome: a.nome, tipo: a.tipo };
}

// ---------- CONTRATAÇÃO (planilha de candidatos) ----------
const cryptoC = require('crypto');
let _contratacaoCache = null;
function extrairPlanilhaId(url) {
  if (!url) return '';
  const s = String(url).trim();
  const m = s.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9\-_]+)/);
  return m ? m[1] : s.replace(/[^a-zA-Z0-9\-_]/g, '');
}
async function configContratacao(session, { url }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  const id = extrairPlanilhaId(url);
  if (!id) return { erro: 'Link inválido' };
  demo.contratacao = demo.contratacao || { spreadsheetId: '', marcados: {} };
  demo.contratacao.spreadsheetId = id; _contratacaoCache = null; salvarEstado();
  return { ok: true, spreadsheetId: id };
}
function montarContratacao(linhas, cfg) {
  const rows = (linhas || []).filter(r => r && r.some(c => String(c || '').trim() !== ''));
  if (!rows.length) return { config: true, ativo: true, colunas: [], candidatos: [], atualizadoEm: new Date().toISOString() };
  const headers = rows[0].map(h => String(h || '').trim());
  const idx = kw => headers.findIndex(h => h.toLowerCase().includes(kw));
  const iNome = idx('chamar') >= 0 ? idx('chamar') : idx('nome');
  const iIdade = idx('idade'), iWpp = idx('whatsapp'), iExp = idx('experi');
  const iPj = idx('modalidade') >= 0 ? idx('modalidade') : idx('pj');
  const iEmail = idx('email') >= 0 ? idx('email') : idx('e-mail');
  const iTel = idx('telefone');
  const dig = s => String(s || '').replace(/\D/g, '');
  const candidatos = rows.slice(1).map(r => {
    const chave = cryptoC.createHash('md5').update(r.join('|')).digest('hex').slice(0, 12);
    const tel = dig(iTel >= 0 ? r[iTel] : '') || dig(iWpp >= 0 ? r[iWpp] : '');
    const wa = tel ? (tel.length <= 11 ? '55' + tel : tel) : '';
    return {
      chave,
      nome: (iNome >= 0 ? r[iNome] : '') || '(sem nome)',
      idade: iIdade >= 0 ? r[iIdade] : '',
      whatsapp: iWpp >= 0 ? r[iWpp] : '',
      experiencia: iExp >= 0 ? r[iExp] : '',
      pj: iPj >= 0 ? r[iPj] : '',
      email: iEmail >= 0 ? r[iEmail] : '',
      wa,
      contatado: !!(cfg.marcados && cfg.marcados[chave]),
    };
  });
  return { config: true, ativo: true, colunas: headers, candidatos, atualizadoEm: new Date().toISOString() };
}
async function listarContratacao(session) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  const cfg = demo.contratacao || { spreadsheetId: '', marcados: {} };
  if (!cfg.spreadsheetId) return { config: false };
  const g = require('./google');
  if (!g.ATIVO) return { config: true, ativo: false, motivo: 'google-off', candidatos: [] };
  if (_contratacaoCache && _contratacaoCache.id === cfg.spreadsheetId && Date.now() - _contratacaoCache.t < 45000) {
    return montarContratacao(_contratacaoCache.linhas, cfg);
  }
  try {
    const r = await g.lerPlanilha(cfg.spreadsheetId);
    _contratacaoCache = { t: Date.now(), id: cfg.spreadsheetId, linhas: r.linhas };
    return montarContratacao(r.linhas, cfg);
  } catch (e) {
    console.error('contratacao/lerPlanilha:', e.message || e);
    return { config: true, ativo: false, motivo: 'erro', erro: String(e.message || e), candidatos: [] };
  }
}
async function marcarContratacao(session, { chave, contatado }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  demo.contratacao = demo.contratacao || { spreadsheetId: '', marcados: {} };
  demo.contratacao.marcados = demo.contratacao.marcados || {};
  if (contatado) demo.contratacao.marcados[chave] = true; else delete demo.contratacao.marcados[chave];
  salvarEstado();
  return { ok: true };
}

// ---------- CRM DE VENDAS ----------
function usuariosDoTime(session) { // usuários (consultores+gestores) visíveis pelo gestor
  try { return require('./auth').listarUsuarios().filter(u => isMaster(session) || !session.time || u.time === session.time); } catch (e) { return []; }
}
function nomesDoTimeFull(session) { // primeiros nomes dos consultores do time
  return usuariosDoTime(session).filter(u => u.papel === 'consultor').map(u => u.nome.split(' ')[0]);
}
function emailsDoTime(session) { // emails de todos do time (para checar dono da venda)
  return new Set(usuariosDoTime(session).map(u => String(u.email || '').toLowerCase()));
}
// gestor pode mexer nesta venda? (é dele, é do time dele, ou é master)
function gestorPodeVenda(session, venda) {
  if (session.papel !== 'gestor') return false;
  if (isMaster(session)) return true;
  const dono = String(venda.consultorEmail || '').toLowerCase();
  return dono === String(session.email || '').toLowerCase() || emailsDoTime(session).has(dono);
}
function registrarLogVenda(session, acao, venda) {
  try {
    demo.vendasLog = demo.vendasLog || [];
    demo.vendasLog.unshift({
      id: 'l' + Date.now() + Math.random().toString(36).slice(2, 5),
      acao, // 'incluiu' | 'excluiu'
      vendaId: venda.id,
      cliente: (venda.cliente && venda.cliente.nome) || '',
      valor: +venda.valor || 0,
      consultor: venda.consultor || '',
      consultorEmail: venda.consultorEmail || '',
      status: venda.status || '',
      por: session.nome ? session.nome.split(' ')[0] : (session.email || ''),
      porPapel: session.papel || '',
      quando: new Date().toISOString(),
    });
    if (demo.vendasLog.length > 500) demo.vendasLog.length = 500;
  } catch (e) {}
}
// valida CPF de verdade (dígitos verificadores) — evita burlar com número inventado
function cpfValido(cpf) {
  cpf = String(cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // todos dígitos iguais
  let s = 0; for (let i = 0; i < 9; i++) s += parseInt(cpf[i], 10) * (10 - i);
  let d1 = 11 - (s % 11); if (d1 >= 10) d1 = 0; if (d1 !== parseInt(cpf[9], 10)) return false;
  s = 0; for (let i = 0; i < 10; i++) s += parseInt(cpf[i], 10) * (11 - i);
  let d2 = 11 - (s % 11); if (d2 >= 10) d2 = 0; if (d2 !== parseInt(cpf[10], 10)) return false;
  return true;
}
// registro persistente de clientes (histórico por CPF)
function registrarCliente(venda) {
  try {
    const cpf = String((venda.cliente && venda.cliente.cpf) || '').replace(/\D/g, '');
    if (cpf.length !== 11) return;
    demo.clientes = demo.clientes || {};
    const nome = (venda.cliente && venda.cliente.nome) || '';
    const ex = demo.clientes[cpf];
    if (ex) {
      if (nome) ex.nome = nome;
      ex.atualizadoEm = new Date().toISOString();
      ex.consultores = Array.from(new Set([...(ex.consultores || []), venda.consultorEmail].filter(Boolean)));
    } else {
      demo.clientes[cpf] = { cpf, nome, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(), consultores: [venda.consultorEmail].filter(Boolean) };
    }
  } catch (e) {}
}
async function listarVendas(session, { de, ate, q, consultor } = {}) {
  if (DEMO) {
    let v = (demo.vendas || []).slice();
    if (session.papel === 'consultor') v = v.filter(x => x.consultorEmail === session.email);
    else { // gestor: vê o time (ou tudo se master); pode filtrar por consultor
      const nomes = nomesDoTimeFull(session);
      const emails = emailsDoTime(session);
      v = v.filter(x => isMaster(session) || nomes.includes(x.consultor) || emails.has(String(x.consultorEmail || '').toLowerCase()));
      if (consultor) { const sel = String(consultor).split(',').map(s => s.trim().toLowerCase()).filter(Boolean); if (sel.length) v = v.filter(x => sel.includes(String(x.consultorEmail || '').toLowerCase()) || sel.includes(String(x.consultor || '').toLowerCase())); }
    }
    if (de) v = v.filter(x => (x.data || '') >= de);
    if (ate) v = v.filter(x => (x.data || '') <= ate);
    if (q) { const s = q.toLowerCase(); const dq = q.replace(/\D/g, ''); v = v.filter(x => ((x.cliente && x.cliente.nome) || '').toLowerCase().includes(s) || (dq && (x.cliente && x.cliente.cpf || '').includes(dq))); }
    // ordena do maior valor para o menor
    v.sort((a, b) => (+b.valor || 0) - (+a.valor || 0));
    // exibe consultor com NOME + SOBRENOME (cópia rasa p/ não alterar o armazenado)
    v = v.map(x => ({ ...x, consultor: (nomeCompletoDe(x.consultorEmail) || x.consultor) }));
    const total = v.reduce((s, x) => s + (+x.valor || 0), 0);
    return { vendas: v, total: Math.round(total * 100) / 100, qtd: v.length };
  }
  return { vendas: [], total: 0, qtd: 0 };
}
// exporta as vendas filtradas (por data/consultor/busca) para uma planilha .xlsx (somente gestor)
async function exportarVendasXlsx(session, { de, ate, q, consultor } = {}) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  const xlsx = require('./xlsx');
  const base = await listarVendas(session, { de, ate, q, consultor });
  const vendas = base.vendas || [];
  const fmtData = d => { const s = String(d || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? (s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4)) : s; };
  const tipoLabel = t => ({ veiculo: 'Veículo', imovel: 'Imóvel', servicos: 'Serviços' }[String(t || '').toLowerCase()] || (t || ''));
  const statusLabel = s => s === 'fechada' ? 'Fechada' : 'Em negociação';
  const headers = ['Data', 'Cliente', 'CPF', 'Consultor', 'Time', 'Tipo', 'Grupo', 'Cota', 'Valor', 'Status'];
  const rows = vendas.map(v => [
    fmtData(v.data),
    (v.cliente && v.cliente.nome) || '',
    (v.cliente && v.cliente.cpf) || '',
    v.consultor || '',
    v.time || '',
    tipoLabel(v.tipo),
    v.grupo || '',
    v.cota || '',
    +v.valor || 0,
    statusLabel(v.status),
  ]);
  // linha de total
  const totalFechadas = vendas.filter(v => v.status === 'fechada').reduce((s, v) => s + (+v.valor || 0), 0);
  const totalGeral = vendas.reduce((s, v) => s + (+v.valor || 0), 0);
  rows.push(['', '', '', '', '', '', '', 'TOTAL', totalGeral, '']);
  rows.push(['', '', '', '', '', '', '', 'Só fechadas', totalFechadas, '']);
  const buf = xlsx.build(headers, rows, { moneyCols: [8], sheetName: 'Vendas', widths: [12, 26, 15, 24, 16, 12, 12, 12, 16, 16] });
  const nome = 'vendas' + (de ? '_de-' + de : '') + (ate ? '_ate-' + ate : '') + '.xlsx';
  return { ok: true, buffer: buf, filename: nome, qtd: vendas.length };
}
// clientes do time (gestor busca clientes dos seus consultores e vê as cotas vendidas)
async function listarClientes(session, { q, consultor } = {}) {
  if (session.papel !== 'gestor' && session.papel !== 'consultor') return { erro: 'Sem permissão' };
  if (DEMO) {
    // aproveita a mesma visibilidade da listagem de vendas
    const base = await listarVendas(session, { q: '', consultor });
    let vendas = base.vendas || [];
    const map = new Map();
    vendas.forEach(v => {
      const cpf = String((v.cliente && v.cliente.cpf) || '').replace(/\D/g, '');
      const key = cpf ? 'cpf:' + cpf : 'nome:' + String((v.cliente && v.cliente.nome) || '').trim().toLowerCase();
      if (!map.has(key)) map.set(key, { key, cpf, nome: (v.cliente && v.cliente.nome) || '—', vendas: [], consultores: new Set() });
      const c = map.get(key);
      c.vendas.push(v);
      if (v.cliente && v.cliente.nome) c.nome = v.cliente.nome;
      if (cpf) c.cpf = cpf;
      if (v.consultor) c.consultores.add(v.consultor);
    });
    let clientes = Array.from(map.values()).map(c => {
      const fechado = c.vendas.filter(v => v.status === 'fechada').reduce((s, v) => s + (+v.valor || 0), 0);
      const negoc = c.vendas.filter(v => v.status !== 'fechada').reduce((s, v) => s + (+v.valor || 0), 0);
      return { cpf: c.cpf, nome: c.nome, qtd: c.vendas.length, fechado: Math.round(fechado * 100) / 100, negociacao: Math.round(negoc * 100) / 100, total: Math.round((fechado + negoc) * 100) / 100, consultores: Array.from(c.consultores), vendas: c.vendas };
    });
    if (q) { const s = String(q).toLowerCase(); const dq = String(q).replace(/\D/g, ''); clientes = clientes.filter(c => (c.nome || '').toLowerCase().includes(s) || (dq && (c.cpf || '').includes(dq))); }
    clientes.sort((a, b) => b.total - a.total);
    return { clientes, qtdClientes: clientes.length, qtdCotas: vendas.length };
  }
  return { clientes: [] };
}
// histórico de inclusões/exclusões (somente gestor)
// negociações abertas de TODAS as equipes (visão do gestor)
async function negociacoesTodasEquipes(session) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  if (DEMO) {
    let users = [];
    try { users = require('./auth').listarUsuarios().filter(u => u.ativo !== false && (u.papel === 'consultor' || u.papel === 'gestor')); } catch (e) {}
    const byEmail = {}; users.forEach(u => { byEmail[String(u.email).toLowerCase()] = { nome: u.nome, time: u.time || '', foto: u.foto || '', cor: u.cor || '' }; });
    const negs = (demo.vendas || []).filter(v => v.status !== 'fechada').map(v => { const u = byEmail[String(v.consultorEmail || '').toLowerCase()] || {}; return { id: v.id, cliente: (v.cliente && v.cliente.nome) || '', valor: +v.valor || 0, tipo: v.tipo || '', data: v.data || '', consultor: u.nome || v.consultor || '', time: u.time || v.time || '(sem time)', foto: u.foto || '', cor: u.cor || '' }; });
    const porTime = {};
    negs.forEach(n => { const t = n.time || '(sem time)'; if (!porTime[t]) porTime[t] = { time: t, total: 0, itens: [] }; porTime[t].total += n.valor; porTime[t].itens.push(n); });
    const times = Object.values(porTime).map(t => ({ time: t.time, total: Math.round(t.total * 100) / 100, qtd: t.itens.length, itens: t.itens.sort((a, b) => b.valor - a.valor) })).sort((a, b) => b.total - a.total);
    const total = negs.reduce((s, n) => s + n.valor, 0);
    return { times, total: Math.round(total * 100) / 100, qtd: negs.length };
  }
  return { times: [], total: 0, qtd: 0 };
}
async function listarVendasLog(session, { limite } = {}) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  let log = (demo.vendasLog || []).slice();
  if (!isMaster(session)) {
    const emails = emailsDoTime(session);
    log = log.filter(l => emails.has(String(l.consultorEmail || '').toLowerCase()) || String(l.consultorEmail || '').toLowerCase() === String(session.email || '').toLowerCase());
  }
  return { log: log.slice(0, +limite || 100) };
}
async function dashboardVendas(session, { mes } = {}) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  mes = mes || new Date().toISOString().slice(0, 7);
  let users = [];
  try { users = require('./auth').listarUsuarios().filter(u => u.ativo !== false && ((u.papel === 'consultor' && (isMaster(session) || !session.time || u.time === session.time)) || (u.papel === 'gestor' && (isMaster(session) || u.email === session.email)))); } catch (e) {}
  const consultores = users.map(u => {
    const nome = u.nome;
    const fechadas = (demo.vendas || []).filter(v => v.consultorEmail === u.email && v.status === 'fechada' && String(v.data || '').slice(0, 7) === mes);
    const emNeg = (demo.vendas || []).filter(v => v.consultorEmail === u.email && v.status !== 'fechada' && String(v.data || '').slice(0, 7) === mes);
    const total = fechadas.reduce((s, v) => s + (+v.valor || 0), 0);
    const metaV = +u.metaVenda || 0;
    return { nome, email: u.email, foto: u.foto || '', papel: u.papel, time: u.time || '', cor: u.cor || '', total: Math.round(total * 100) / 100, meta: metaV, pct: metaV ? Math.min(100, Math.round(100 * total / metaV)) : 0, qtd: fechadas.length, negociando: emNeg.reduce((s, v) => s + (+v.valor || 0), 0), bateu: metaV > 0 && total >= metaV };
  }).sort((a, b) => b.total - a.total);
  const totalTime = consultores.reduce((s, x) => s + x.total, 0);
  const totalMeta = consultores.reduce((s, x) => s + x.meta, 0);
  return { mes, totalTime: Math.round(totalTime * 100) / 100, totalMeta, bateram: consultores.filter(x => x.bateu).length, consultores };
}

const TIPOS_COTA = ['veiculo', 'imovel', 'servicos'];
function tipoValido(t) { return TIPOS_COTA.includes(String(t || '').toLowerCase()) ? String(t).toLowerCase() : ''; }
async function criarVenda(session, { nome, cpf, valor, grupo, cota, data, status, consultorEmail, tipo }) {
  if (session.papel !== 'consultor' && session.papel !== 'gestor') return { erro: 'Sem permissão' };
  if (DEMO) {
    if (!nome || !(+valor)) return { erro: 'Informe o cliente e o valor da venda' };
    const cpfDig = String(cpf || '').replace(/\D/g, '');
    const vaiFechar = status === 'fechada';
    // CPF é opcional na negociação, mas obrigatório e VÁLIDO para efetivar (fechar) a venda
    if (cpfDig && !cpfValido(cpfDig)) return { erro: 'CPF inválido — confira os números' };
    if (vaiFechar && !cpfValido(cpfDig)) return { erro: 'Para efetivar a venda, informe um CPF válido do cliente' };
    // por padrão a venda é do próprio usuário; gestor pode lançar em nome de um consultor do time
    let dono = { email: session.email, nome: session.nome, time: session.time || '' };
    if (session.papel === 'gestor' && consultorEmail && String(consultorEmail).toLowerCase() !== String(session.email).toLowerCase()) {
      const u = usuariosDoTime(session).find(x => String(x.email).toLowerCase() === String(consultorEmail).toLowerCase());
      if (!u) return { erro: 'Consultor não encontrado no seu time' };
      dono = { email: u.email, nome: u.nome, time: u.time || '' };
    }
    const venda = { id: 'v' + Date.now() + Math.random().toString(36).slice(2, 5), consultor: dono.nome.split(' ')[0], consultorEmail: dono.email, time: dono.time, cliente: { nome: String(nome).slice(0, 80), cpf: String(cpf || '').replace(/\D/g, '').slice(0, 11) }, valor: Math.round((+valor || 0) * 100) / 100, grupo: String(grupo || '').slice(0, 40), cota: String(cota || '').slice(0, 40), tipo: tipoValido(tipo), data: data || hoje(), status: status === 'fechada' ? 'fechada' : 'negociacao', criadoEm: new Date().toISOString(), criadoPor: session.nome ? session.nome.split(' ')[0] : session.email };
    demo.vendas.unshift(venda);
    registrarCliente(venda);
    registrarLogVenda(session, 'incluiu', venda);
    // 🎉 venda já criada fechada por um consultor → avisa o gestor
    const festa = venda.status === 'fechada';
    if (festa && session.papel === 'consultor') {
      const nomeC = session.nome ? session.nome.split(' ')[0] : 'Consultor';
      novoAviso('gestor:' + (session.time || ''), '🎉 Venda fechada', `${nomeC} fechou uma venda de ${fmtMoedaBR(venda.valor)}! Parabéns pra equipe! 🔥`);
    }
    return { ok: true, venda, festa, valor: venda.valor };
  }
  return { ok: true };
}
async function editarVenda(session, { id, nome, cpf, valor, grupo, cota, data, status, tipo, consultorEmail }) {
  if (DEMO) {
    const v = demo.vendas.find(x => x.id === id);
    if (!v) return { erro: 'Venda não encontrada' };
    const eraFechada = v.status === 'fechada';
    const dono = v.consultorEmail === session.email;
    if (session.papel === 'consultor' && !dono) return { erro: 'Sem permissão' };
    if (session.papel === 'gestor' && !dono && !gestorPodeVenda(session, v)) return { erro: 'Sem permissão' };
    // CPF final (o novo, se enviado; senão o que já está na venda)
    const cpfFinal = cpf != null ? String(cpf).replace(/\D/g, '') : String((v.cliente && v.cliente.cpf) || '');
    if (cpf != null && cpfFinal && !cpfValido(cpfFinal)) return { erro: 'CPF inválido — confira os números' };
    // status final
    const statusFinal = status != null ? (status === 'fechada' ? 'fechada' : 'negociacao') : v.status;
    if (statusFinal === 'fechada' && !cpfValido(cpfFinal)) return { erro: 'Para efetivar a venda, informe um CPF válido do cliente' };
    if (nome != null) v.cliente.nome = String(nome).slice(0, 80);
    if (cpf != null) v.cliente.cpf = cpfFinal.slice(0, 11);
    if (valor != null) v.valor = Math.round((+valor || 0) * 100) / 100;
    if (grupo != null) v.grupo = String(grupo).slice(0, 40);
    if (cota != null) v.cota = String(cota).slice(0, 40);
    if (tipo != null) v.tipo = tipoValido(tipo);
    if (data != null) v.data = data;
    if (status != null) v.status = statusFinal;
    // gestor pode reatribuir a venda para outro consultor/gestor do time
    if (consultorEmail != null && session.papel === 'gestor') {
      const alvo = String(consultorEmail).toLowerCase();
      if (alvo && alvo !== String(v.consultorEmail || '').toLowerCase()) {
        const u = usuariosDoTime(session).find(x => String(x.email).toLowerCase() === alvo);
        if (!u) return { erro: 'Consultor de destino não encontrado no seu time' };
        v.consultorEmail = u.email; v.consultor = u.nome.split(' ')[0]; v.time = u.time || '';
      }
    }
    registrarCliente(v);
    // 🎉 fechou a venda agora? avisa o gestor do time (pra festa na tela dele)
    const virouFechada = !eraFechada && v.status === 'fechada';
    if (virouFechada && session.papel === 'consultor') {
      const nomeC = session.nome ? session.nome.split(' ')[0] : 'Consultor';
      novoAviso('gestor:' + (session.time || ''), '🎉 Venda fechada', `${nomeC} fechou uma venda de ${fmtMoedaBR(v.valor)}! Parabéns pra equipe! 🔥`);
    }
    return { ok: true, festa: virouFechada, valor: v.valor };
  }
  return { ok: true };
}
function fmtMoedaBR(v) { return 'R$ ' + (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
async function excluirVenda(session, { id }) {
  if (DEMO) {
    const i = demo.vendas.findIndex(x => x.id === id);
    if (i < 0) return { erro: 'Venda não encontrada' };
    const v = demo.vendas[i];
    const dono = v.consultorEmail === session.email;
    if (session.papel === 'consultor' && !dono) return { erro: 'Sem permissão' };
    if (session.papel === 'gestor' && !dono && !gestorPodeVenda(session, v)) return { erro: 'Sem permissão' };
    registrarLogVenda(session, 'excluiu', v);
    demo.vendas.splice(i, 1); return { ok: true };
  }
  return { ok: true };
}

// ---------- AUTO-CADASTRO DE CONSULTOR (com aprovação do gestor) ----------
async function solicitarCadastro({ nome, email, senha, time }) {
  if (DEMO) {
    nome = String(nome || '').trim(); email = String(email || '').trim().toLowerCase(); senha = String(senha || '');
    if (nome.length < 2) return { erro: 'Informe seu nome completo' };
    if (!email || /\s/.test(email)) return { erro: 'Informe um usuário válido (sem espaços)' };
    if (senha.length < 4) return { erro: 'A senha deve ter pelo menos 4 caracteres' };
    try { if (require('./auth').listarUsuarios().some(u => String(u.email).toLowerCase() === email)) return { erro: 'Já existe um acesso com esse usuário' }; } catch (e) {}
    demo.cadastros = demo.cadastros || [];
    if (demo.cadastros.some(c => c.email === email)) return { erro: 'Já existe uma solicitação com esse usuário aguardando aprovação' };
    const c = { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 5), nome: nome.slice(0, 80), email: email.slice(0, 80), senha: senha.slice(0, 60), time: String(time || '').slice(0, 40), papel: 'consultor', data: new Date().toISOString() };
    demo.cadastros.unshift(c);
    // avisa os gestores
    try { demo.avisos = demo.avisos || []; demo.avisos.unshift({ id: 'av' + Date.now(), para: 'gestores', tipo: 'cadastro', texto: `Novo pedido de acesso: ${c.nome}`, data: c.data, lida: false }); } catch (e) {}
    return { ok: true };
  }
  return { ok: true };
}
async function listarCadastros(session) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  let cs = (demo.cadastros || []).slice();
  if (!isMaster(session) && session.time) cs = cs.filter(c => !c.time || c.time === session.time);
  return { cadastros: cs.map(c => ({ id: c.id, nome: c.nome, email: c.email, time: c.time, data: c.data })) };
}
async function decidirCadastro(session, { id, aprovar, time }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  demo.cadastros = demo.cadastros || [];
  const i = demo.cadastros.findIndex(c => c.id === id);
  if (i < 0) return { erro: 'Solicitação não encontrada' };
  const c = demo.cadastros[i];
  if (aprovar) {
    try {
      require('./auth').criarUsuario(c.email, c.senha, c.nome, 'consultor', { time: String(time || c.time || session.time || '').slice(0, 40), ativo: true });
    } catch (e) { return { erro: 'Falha ao criar acesso: ' + e.message }; }
  }
  demo.cadastros.splice(i, 1);
  return { ok: true, aprovado: !!aprovar };
}

// ---------- MURAL (ranking + metas do ano) ----------
function seloMural(pct) { if (pct >= 200) return 'LENDÁRIO'; if (pct >= 100) return 'CAMPEÃO'; if (pct >= 70) return 'DESTAQUE'; return ''; }
async function muralDados(session, { mes } = {}) {
  const cfg = demo.mural || (demo.mural = { ano: new Date().getFullYear(), desafio: 0, expectativa: 0, piso: 0, recado: '', metasTime: {} });
  const ano = +cfg.ano || new Date().getFullYear();
  const mesAtual = new Date().toISOString().slice(0, 7);
  // período: consultor sempre no mês atual; gestor pode navegar
  let mesRef = mesAtual;
  if (session.papel === 'gestor' && mes && /^\d{4}-\d{2}$/.test(mes)) mesRef = mes;
  let users = [];
  // inclui CONSULTORES e GESTORES (gestores também vendem e devem aparecer no ranking)
  try { users = require('./auth').listarUsuarios().filter(u => u.ativo !== false && (u.papel === 'consultor' || u.papel === 'gestor')); } catch (e) {}
  const fechadasDe = (email, ym) => (demo.vendas || []).filter(v => v.consultorEmail === email && v.status === 'fechada' && String(v.data || '').slice(0, 7) === ym);
  const ranking = users.map(u => {
    const fs = fechadasDe(u.email, mesRef);
    const vendido = fs.reduce((s, v) => s + (+v.valor || 0), 0);
    const meta = +u.metaVenda || 0;
    const pct = meta ? Math.round(100 * vendido / meta) : 0;
    return { email: u.email, nome: u.nome, primeiro: u.nome.split(' ')[0], papel: u.papel, time: u.time || '', foto: u.foto || '', cor: u.cor || '', vendido: Math.round(vendido * 100) / 100, meta, pct, qtd: fs.length, selo: seloMural(pct) };
  }).sort((a, b) => b.vendido - a.vendido).map((x, i) => ({ ...x, pos: i + 1 }));
  const totalVendidoMes = ranking.reduce((s, x) => s + x.vendido, 0);
  const totalVendidoAno = (demo.vendas || []).filter(v => v.status === 'fechada' && String(v.data || '').slice(0, 4) === String(ano)).reduce((s, v) => s + (+v.valor || 0), 0);
  const meses = [];
  for (let m = 1; m <= 12; m++) { const ym = ano + '-' + String(m).padStart(2, '0'); const val = (demo.vendas || []).filter(v => v.status === 'fechada' && String(v.data || '').slice(0, 7) === ym).reduce((s, v) => s + (+v.valor || 0), 0); meses.push({ mes: ym, label: String(m).padStart(2, '0') + '/' + String(ano).slice(2), valor: Math.round(val * 100) / 100 }); }
  const timesMap = {};
  ranking.forEach(r => { const t = r.time || '(sem time)'; if (!timesMap[t]) timesMap[t] = { time: t, vendido: 0, consultores: 0 }; timesMap[t].vendido += r.vendido; timesMap[t].consultores++; });
  const times = Object.values(timesMap).map(t => { const meta = +((cfg.metasTime || {})[t.time]) || 0; return { time: t.time, vendido: Math.round(t.vendido * 100) / 100, consultores: t.consultores, meta, pct: meta ? Math.round(100 * t.vendido / meta) : 0 }; }).sort((a, b) => b.vendido - a.vendido);
  return {
    mes: mesRef, mesAtual, ano, podeEditar: session.papel === 'gestor', podeNavegar: session.papel === 'gestor',
    config: { desafio: +cfg.desafio || 0, expectativa: +cfg.expectativa || 0, piso: +cfg.piso || 0, recado: cfg.recado || '', metasTime: cfg.metasTime || {} },
    totalVendidoMes: Math.round(totalVendidoMes * 100) / 100, totalVendidoAno: Math.round(totalVendidoAno * 100) / 100,
    ranking, top3: ranking.slice(0, 3), meses, times,
  };
}
async function muralSalvar(session, { desafio, expectativa, piso, recado, metasTime, ano }) {
  if (session.papel !== 'gestor') return { erro: 'Somente gestores' };
  demo.mural = demo.mural || { ano: new Date().getFullYear(), desafio: 0, expectativa: 0, piso: 0, recado: '', metasTime: {} };
  if (desafio != null) demo.mural.desafio = Math.max(0, +desafio || 0);
  if (expectativa != null) demo.mural.expectativa = Math.max(0, +expectativa || 0);
  if (piso != null) demo.mural.piso = Math.max(0, +piso || 0);
  if (ano != null) demo.mural.ano = +ano || new Date().getFullYear();
  if (recado != null) demo.mural.recado = String(recado).slice(0, 200);
  if (metasTime && typeof metasTime === 'object') { demo.mural.metasTime = {}; Object.keys(metasTime).forEach(k => { demo.mural.metasTime[String(k)] = Math.max(0, +metasTime[k] || 0); }); }
  salvarEstado();
  return { ok: true, config: demo.mural };
}

function mapSolicitacao(p) { return { id: p.id }; }
function mapAtividade(p) { return { id: p.id }; }
function duracaoLabel(min) { return min >= 60 ? '1 hora' : `${min} min`; }

module.exports = { homeConsultor, criarSolicitacao, registrarCheckin, finalizarCheckin, atualizarAtividade, painelGestor, agendaGestor, decidirSolicitacao, cancelarSolicitacao, criarAtividade, cancelarAtividade, listarAvisos, marcarAvisoLido, excluirAviso, perfilConsultor, controleGestor, rankingGestor, definirMeta, listarChat, enviarChat, chatNaoLidas, listarRotinas, salvarRotinas, destinatarios, disponibilidade, excluirSolicitacao, listarGestores, listarArquivos, salvarArquivo, excluirArquivo, arquivoParaDownload, listarTimes, criarTime, excluirTime, cancelarSolicitacaoGestor, configContratacao, listarContratacao, marcarContratacao, listarVendas, exportarVendasXlsx, criarVenda, editarVenda, excluirVenda, dashboardVendas, listarVendasLog, negociacoesTodasEquipes, listarClientes, solicitarCadastro, listarCadastros, decidirCadastro, solicitarReuniaoGestor, muralDados, muralSalvar, DEMO };
