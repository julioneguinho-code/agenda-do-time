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
  demo.progressoSemana = {}; demo.mensagens = []; demo.diaAtual = hoje();
}

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
}
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
function nomesDoTime(session) {
  try {
    const auth = require('./auth');
    const us = auth.listarUsuarios().filter(u => u.papel === 'consultor' && u.ativo !== false && (!session.time || u.time === session.time));
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

// visibilidade da solicitação para um gestor: por e-mail (se transferida) ou por time
function visivelPara(session, s) {
  if (s.gestorEmail) return s.gestorEmail === session.email;
  return !session.time || session.time === s.time;
}
function meuTime(session, timeDaSolicitacao) { const t = session.time; return !t || t === timeDaSolicitacao; }
function execPct(nome) { return Math.min(100, Math.round(100 * (demo.progressoSemana[nome] ?? 0) / demo.metaSemanal)); }
function checkinPctHoje(nome) { return Math.round(100 * (demo.checkinsFeitos[nome]?.size || 0) / demo.rotinas.length); }

// ---------- GAMIFICAÇÃO ----------
function pontosDe(nome) { return (demo.pontosBase[nome] || 0) + (demo.pontosApp[nome] || 0); }
function medalha(pos) { return pos === 0 ? '🥇' : pos === 1 ? '🥈' : pos === 2 ? '🥉' : ''; }
function rankingLista() {
  return Object.keys(demo.pontosBase)
    .map(nome => ({ nome, pontos: pontosDe(nome) }))
    .sort((a, b) => b.pontos - a.pontos)
    .map((x, i) => ({ ...x, pos: i + 1, medalha: medalha(i) }));
}

// ---------- CONSULTOR ----------
async function homeConsultor(session) {
  if (DEMO) {
    rolloverDia();
    const nome = session.nome.split(' ')[0];
    const feitos = demo.checkinsFeitos[nome] || (demo.checkinsFeitos[nome] = new Set());
    const rk = rankingLista();
    const meu = rk.find(x => x.nome === nome) || { pos: '-', pontos: 0 };
    const prog = demo.progressoSemana[nome] ?? 0;
    const finalizado = demo.checkinFinalizado[nome] === hoje();
    let cor = '', cargo = '';
    try { const u = require('./auth').listarUsuarios().find(x => x.email === session.email); if (u) { cor = u.cor || ''; cargo = u.cargo || ''; } } catch (e) {}
    return {
      nome, cor, cargo,
      checkin: { feitas: feitos.size, total: demo.rotinas.length, finalizado, completo: feitos.size === demo.rotinas.length, rotinas: demo.rotinas.map(r => ({ nome: r, feita: feitos.has(r) })) },
      proximasReunioes: demo.solicitacoes.filter(s => s.consultor === nome && s.status === 'Aprovada' && new Date(s.inicio) >= new Date(Date.now() - 3600000)).sort((a, b) => a.inicio < b.inicio ? -1 : 1),
      solicitacoes: demo.solicitacoes.filter(s => s.consultor === nome),
      atividades: demo.atividades.filter(a => a.consultor === nome),
      meta: { atual: prog, alvo: demo.metaSemanal, pct: Math.min(100, Math.round(100 * prog / demo.metaSemanal)) },
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

async function criarSolicitacao(session, { assunto, inicio, duracao, local }) {
  if (DEMO) {
    const nome = session.nome.split(' ')[0];
    const nova = { id: 's' + Date.now(), assunto: assunto || 'Reunião', consultor: nome, time: session.time, inicio, duracao: duracao || 60, local: local || '', status: 'Pendente' };
    demo.solicitacoes.unshift(nova);
    novoAviso('gestor:' + (session.time || ''), 'Nova solicitação de reunião', `${nome} pediu reunião "${nova.assunto}" em ${new Date(inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${local ? ' · ' + local : ''}. Vá em Aprovações para decidir.`);
    return { ok: true, solicitacao: nova };
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

async function registrarCheckin(session, { rotina, valor }) {
  if (DEMO) {
    const nome = session.nome.split(' ')[0];
    if (demo.checkinFinalizado[nome] === hoje()) return { erro: 'Check-in do dia já finalizado — não pode alterar' };
    const feitos = demo.checkinsFeitos[nome] || (demo.checkinsFeitos[nome] = new Set());
    if (valor && !feitos.has(rotina)) { feitos.add(rotina); demo.pontosApp[nome] = (demo.pontosApp[nome] || 0) + 5; demo.progressoSemana[nome] = (demo.progressoSemana[nome] || 0) + 1; }
    else if (!valor && feitos.has(rotina)) { feitos.delete(rotina); demo.pontosApp[nome] = (demo.pontosApp[nome] || 0) - 5; demo.progressoSemana[nome] = Math.max(0, (demo.progressoSemana[nome] || 0) - 1); }
    const completo = feitos.size === demo.rotinas.length;
    // 100% NÃO trava — só comemora. A trava é manual (botão) ou automática na virada do dia.
    return { ok: true, feitas: feitos.size, completo, finalizado: demo.checkinFinalizado[nome] === hoje() };
  }
  // Notion real: cria/atualiza registro do dia no database de check-in (implementação na integração final)
  return { ok: true };
}

async function finalizarCheckin(session) {
  if (DEMO) { const nome = session.nome.split(' ')[0]; demo.checkinFinalizado[nome] = hoje(); return { ok: true }; }
  return { ok: true };
}

async function checkinDeHoje() { return { feitas: 0, total: 8, rotinas: demo.rotinas }; }

async function atualizarAtividade(session, { id, status }) {
  if (DEMO) {
    const a = demo.atividades.find(x => x.id === id);
    if (a) {
      const eraFeito = a.status === 'Feito';
      a.status = status;
      if (status === 'Feito' && !eraFeito) demo.pontosApp[a.consultor] = (demo.pontosApp[a.consultor] || 0) + 10;
      if (status !== 'Feito' && eraFeito) demo.pontosApp[a.consultor] = (demo.pontosApp[a.consultor] || 0) - 10;
      // recorrência: ao concluir uma recorrente, gera a próxima ocorrência
      if (status === 'Feito' && a.recorrente) {
        const prox = new Date(a.prazo || hoje()); prox.setDate(prox.getDate() + 7);
        demo.atividades.unshift({ id: 'a' + Date.now(), titulo: a.titulo, consultor: a.consultor, tipo: a.tipo, prazo: prox.toISOString().slice(0, 10), status: 'A fazer', recorrente: true });
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
    const consultores = us.filter(u => u.papel === 'consultor' && (!session.time || u.time === session.time)).map(u => ({ nome: u.nome.split(' ')[0], papel: 'consultor', time: u.time || '' }));
    const gestores = us.filter(u => u.papel === 'gestor' && u.email !== session.email).map(u => ({ nome: u.nome, papel: 'gestor', time: u.time || '' }));
    return { consultores, gestores };
  } catch (e) { return { consultores: [], gestores: [] }; }
}

async function painelGestor(session) {
  if (DEMO) {
    rolloverDia();
    const nomes = nomesDoTime(session);
    const checkinMedia = nomes.length ? Math.round(nomes.reduce((s, n) => s + checkinPctHoje(n), 0) / nomes.length) : 0;
    const atvTime = demo.atividades.filter(a => nomes.includes(a.consultor));
    const tarefas = {
      atrasadas: atvTime.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada' && a.prazo < hoje()).length,
      pendentes: atvTime.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada' && a.prazo >= hoje()).length,
      finalizadas: atvTime.filter(a => a.status === 'Feito').length,
    };
    return {
      time: session.time || 'Chama',
      email: session.email,
      nome: session.nome,
      cor: (() => { try { const u = require('./auth').listarUsuarios().find(x => x.email === session.email); return u ? (u.cor || '') : ''; } catch (e) { return ''; } })(),
      tarefas,
      kpis: { checkinPct: checkinMedia, atrasadas: tarefas.atrasadas, pendentes: demo.solicitacoes.filter(s => s.status === 'Pendente' && visivelPara(session, s)).length },
      execucao: (() => { const c = coresConsultores(); return nomes.map(n => ({ nome: n, pct: execPct(n), cor: (c[n] || {}).cor || '', cargo: (c[n] || {}).cargo || '' })).sort((a, b) => b.pct - a.pct); })(),
      pendentes: demo.solicitacoes.filter(s => s.status === 'Pendente' && visivelPara(session, s)),
      decididas: demo.solicitacoes.filter(s => ['Aprovada', 'Recusada', 'Reagendar'].includes(s.status)).slice(0, 10),
      atividadesAtrasadas: demo.atividades.filter(a => a.status !== 'Feito' && a.status !== 'Cancelada' && a.prazo < hoje()),
      consultores: nomes,
      minhasTarefas: demo.atividades.filter(a => a.consultor === session.nome && a.status !== 'Cancelada').map(a => ({ id: a.id, titulo: a.titulo, tipo: a.tipo, prazo: a.prazo, status: a.status, de: a.criadaPor || '' })),
    };
  }
  // Notion real: agregações equivalentes filtradas pelo time do gestor
  return {};
}

async function agendaGestor(session) {
  if (DEMO) {
    const eventos = demo.solicitacoes.filter(s => s.status !== 'Recusada' && s.status !== 'Cancelada').map(s => ({ ...s, vinculado: !!s.googleEventId }));
    let googleEventos = [];
    if (require('./google').ATIVO && session.calendarId) {
      try {
        const ini = new Date(); ini.setDate(ini.getDate() - 7);
        const fim = new Date(); fim.setDate(fim.getDate() + 21);
        const r = await require('./google').listarEventos(session.calendarId, ini.toISOString(), fim.toISOString());
        googleEventos = r.eventos.map(e => ({ id: e.id, assunto: e.titulo, consultor: '(Google)', inicio: e.inicio, duracao: 60, local: e.local, status: 'Google', link: e.link, google: true }));
      } catch (e) { /* ignora falha do Google, mostra ao menos as solicitações */ }
    }
    return { eventos, googleEventos, googleAtivo: require('./google').ATIVO };
  }
  return { eventos: [], googleEventos: [] };
}

async function cancelarSolicitacao(session, { id }) {
  if (DEMO) {
    const s = demo.solicitacoes.find(x => x.id === id && x.consultor === session.nome.split(' ')[0]);
    if (!s) return { erro: 'Solicitação não encontrada' };
    if (s.status !== 'Pendente') return { erro: 'Só é possível cancelar solicitações pendentes' };
    s.status = 'Cancelada';
    return { ok: true };
  }
  // Notion real: PATCH status → Cancelada (adicionar a opção no select do database)
  return { ok: true };
}

async function cancelarAtividade(session, { id, justificativa }) {
  if (DEMO) {
    const a = demo.atividades.find(x => x.id === id);
    if (!a) return { erro: 'Atividade não encontrada' };
    if (a.status === 'Feito') return { erro: 'Atividade já concluída não pode ser cancelada' };
    if (session.papel === 'consultor') {
      if (a.consultor !== session.nome.split(' ')[0]) return { erro: 'Essa atividade não é sua' };
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

async function criarAtividade(session, { consultor, titulo, tipo, prazo, recorrente }) {
  if (!titulo || !consultor) return { erro: 'Preencha o destinatário e a atividade' };
  if (DEMO) {
    const deQuem = session.nome || 'Gestor';
    demo.atividades.unshift({ id: 'a' + Date.now(), titulo, consultor, tipo: tipo || 'Outro', prazo: prazo || hoje(), status: 'A fazer', recorrente: !!recorrente, criadaPor: deQuem });
    // roteia o aviso: se o destinatário é um gestor, avisa por e-mail; senão, pelo nome (consultor)
    let alvo = consultor;
    try { const u = require('./auth').listarUsuarios().find(x => x.nome === consultor || x.nome.split(' ')[0] === consultor); if (u && u.papel === 'gestor') alvo = 'email:' + u.email; } catch (e) {}
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
        novoAviso(s.consultor, 'Reunião transferida', `Sua reunião foi encaminhada para ${paraNome || 'outro gestor'} aprovar.`);
        return { ok: true, transferida: true, paraNome: paraNome || paraEmail };
      }
      s.status = decisao; s.resposta = resposta || '';
      if (decisao === 'Aprovada') {
        const fim = new Date(new Date(s.inicio).getTime() + (s.duracao || 60) * 60000).toISOString();
        const ev = await google.criarEvento(session.calendarId || 'primary', { titulo: `${s.assunto || 'Reunião'} — ${s.consultor}`, inicioISO: s.inicio, fimISO: fim, local: s.local, descricao: `Aprovada via app. Consultor: ${s.consultor} · Time: ${s.time}` });
        s.googleEventId = ev.id; s.googleLink = ev.link; s.noGoogle = true;
      }
      const quando = new Date(s.inicio).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const msg = decisao === 'Aprovada' ? `Sua reunião de ${quando} foi APROVADA ✅ — já está na agenda do gestor.` : decisao === 'Recusada' ? `Sua reunião de ${quando} foi recusada.${resposta ? ' Motivo: ' + resposta : ''}` : `Seu gestor pediu para reagendar a reunião de ${quando}.${resposta ? ' Sugestão: ' + resposta : ''} Envie nova solicitação.`;
      novoAviso(s.consultor, `Reunião ${decisao.toLowerCase()}`, msg);
      if (decisao === 'Reagendar') {
        const prazo = new Date(); prazo.setDate(prazo.getDate() + 2);
        demo.atividades.unshift({ id: 'a' + Date.now(), titulo: `Reagendar reunião (era ${quando})${resposta ? ' — sugestão: ' + resposta : ''}`, consultor: s.consultor, tipo: 'Reunião', prazo: prazo.toISOString().slice(0, 10), status: 'A fazer' });
      }
    }
    const s2 = demo.solicitacoes.find(x => x.id === id);
    return { ok: true, googleCalendar: decisao === 'Aprovada' ? (google.ATIVO ? 'evento criado no Google ✓' : 'evento simulado (Google ativa na publicação)') : null, link: s2?.googleLink || null };
  }
  // Notion real + criação no Google Calendar via API (rota implementada na integração final)
  return { ok: true };
}

async function rankingGestor(session) {
  if (DEMO) {
    const rk = nomesDoTime(session).map(nome => ({ nome, pontos: pontosDe(nome) })).sort((a, b) => b.pontos - a.pontos).map((x, i) => ({ ...x, pos: i + 1, medalha: medalha(i) }));
    return {
      ranking: rk.map(x => ({ ...x, meta: { atual: demo.progressoSemana[x.nome] ?? 0, alvo: demo.metaSemanal, pct: Math.min(100, Math.round(100 * (demo.progressoSemana[x.nome] ?? 0) / demo.metaSemanal)) } })),
      metaSemanal: demo.metaSemanal,
    };
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
    const nomes = nomesDoTime(session);
    const dias = [];
    const chaves = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      chaves.push(d.toISOString().slice(0, 10));
      dias.push({ label: ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'][d.getDay()], data: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') });
    }
    const cores = coresConsultores();
    const consultores = nomes.map(nome => {
      const hist = demo.historico[nome] || {};
      const envios = chaves.map((k, i) => {
        if (i === 6) return { enviou: (demo.checkinsFeitos[nome] || new Set()).size > 0, feitas: (demo.checkinsFeitos[nome] || new Set()).size };
        const h = hist[k];
        return { enviou: !!(h && h.feitas > 0), feitas: h ? h.feitas : 0 };
      });
      const enviosDias = envios.map(e => e.enviou);
      const minhas = demo.atividades.filter(a => a.consultor === nome);
      return {
        nome,
        cor: (cores[nome] || {}).cor || '',
        cargo: (cores[nome] || {}).cargo || '',
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

async function perfilConsultor(session, nome) {
  if (DEMO) {
    rolloverDia();
    const feitos = demo.checkinsFeitos[nome] || new Set();
    const atividades = demo.atividades.filter(a => a.consultor === nome);
    const reunioes = demo.solicitacoes.filter(s => s.consultor === nome);
    const exec = execPct(nome);
    const nomesDia = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
    const hist = demo.historico[nome] || {};
    const historico7d = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const rotinasFeitas = i === 0 ? Array.from(feitos) : (hist[key] && hist[key].rotinas ? hist[key].rotinas : []);
      const feitasDia = i === 0 ? feitos.size : (hist[key] ? hist[key].feitas : 0);
      const pct = Math.round(100 * feitasDia / demo.rotinas.length);
      historico7d.push({ dia: nomesDia[d.getDay()], data: String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), feitas: feitasDia, total: demo.rotinas.length, pct, rotinasFeitas, hoje: i === 0 });
    }
    const info = coresConsultores()[nome] || {};
    const time = (() => { try { const u = require('./auth').listarUsuarios().find(x => x.papel === 'consultor' && x.nome.split(' ')[0] === nome); return u ? (u.time || '') : ''; } catch (e) { return ''; } })();
    return {
      nome, time, execucao: exec, cor: info.cor || '', cargo: info.cargo || '',
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
  const consultor = session.papel === 'consultor' ? session.nome.split(' ')[0] : consultorParam;
  if (!consultor) {
    // gestor sem consultor selecionado: devolve a lista de consultores com contagem de não lidas
    const nomes = Object.keys(demo.checkinsFeitos);
    return { lista: nomes.map(n => ({ nome: n, naoLidas: demo.mensagens.filter(m => m.consultor === n && m.de === 'consultor' && !m.lida).length })) };
  }
  const thread = demo.mensagens.filter(m => m.consultor === consultor);
  // marca como lidas as mensagens destinadas a quem está lendo
  const paraMim = session.papel === 'consultor' ? 'gestor' : 'consultor';
  thread.forEach(m => { if (m.de === paraMim) m.lida = true; });
  return { consultor, mensagens: thread };
}

async function enviarChat(session, { consultor, texto }) {
  if (!texto || !texto.trim()) return { erro: 'Mensagem vazia' };
  const alvoConsultor = session.papel === 'consultor' ? session.nome.split(' ')[0] : consultor;
  if (!alvoConsultor) return { erro: 'Selecione o consultor' };
  const de = session.papel;
  demo.mensagens.push({ consultor: alvoConsultor, de, texto: texto.trim(), data: new Date().toISOString(), lida: false });
  if (de === 'consultor') novoAviso('gestor:' + (session.time || ''), 'Nova mensagem', `${alvoConsultor}: ${texto.trim().slice(0, 60)}`);
  else novoAviso(alvoConsultor, 'Nova mensagem do gestor', texto.trim().slice(0, 60));
  return { ok: true };
}

function chatNaoLidas(session) {
  if (session.papel === 'consultor') return demo.mensagens.filter(m => m.consultor === session.nome.split(' ')[0] && m.de === 'gestor' && !m.lida).length;
  return demo.mensagens.filter(m => m.de === 'consultor' && !m.lida).length;
}

// ---------- AVISOS (caixa de notificações no site) ----------
function novoAviso(para, titulo, texto) {
  demo.avisos.unshift({ id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6), para, titulo, texto, lida: false, data: new Date().toISOString() });
}

async function listarAvisos(session) {
  const chaves = session.papel === 'gestor' ? ['gestor:' + (session.time || ''), 'email:' + session.email] : [session.nome.split(' ')[0]];
  const meus = demo.avisos.filter(a => chaves.includes(a.para));
  return { avisos: meus, naoLidas: meus.filter(a => !a.lida).length };
}

async function marcarAvisoLido(session, { id }) {
  const a = demo.avisos.find(x => x.id === id);
  if (a) a.lida = true;
  return { ok: true };
}

async function excluirAviso(session, { id, todos }) {
  const chave = session.papel === 'gestor' ? 'gestor:' + (session.time || '') : session.nome.split(' ')[0];
  if (todos) { demo.avisos = demo.avisos.filter(a => a.para !== chave); return { ok: true }; }
  demo.avisos = demo.avisos.filter(a => !(a.id === id && a.para === chave));
  return { ok: true };
}

function mapSolicitacao(p) { return { id: p.id }; }
function mapAtividade(p) { return { id: p.id }; }
function duracaoLabel(min) { return min >= 60 ? '1 hora' : `${min} min`; }

module.exports = { homeConsultor, criarSolicitacao, registrarCheckin, finalizarCheckin, atualizarAtividade, painelGestor, agendaGestor, decidirSolicitacao, cancelarSolicitacao, criarAtividade, cancelarAtividade, listarAvisos, marcarAvisoLido, excluirAviso, perfilConsultor, controleGestor, rankingGestor, definirMeta, listarChat, enviarChat, chatNaoLidas, listarRotinas, salvarRotinas, destinatarios, DEMO };
