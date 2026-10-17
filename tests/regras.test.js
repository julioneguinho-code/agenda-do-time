// Testes das regras de negócio (zero dependências): npm test  (= node --test tests/regras.test.js)
// Rodam num diretório de dados TEMPORÁRIO — não tocam em data/ de verdade.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chama-teste-'));
process.env.DATA_DIR = TMP;
const auth = require('../lib/auth');
// gestores: roxo (A e extra A2), laranja (L), outro roxo (R)
auth.criarUsuario('roxo', 'x1234', 'Gestor Roxo', 'gestor', { time: 'A', cor: '#A78BFA', equipes: ['A2'] });
auth.criarUsuario('laranja', 'x1234', 'Sup Laranja', 'gestor', { time: 'L', cor: '#FB923C' });
auth.criarUsuario('outro', 'x1234', 'Outro Roxo', 'gestor', { time: 'R', cor: '#A78BFA' });
const N = require('../lib/notion');
const push = require('../lib/push');
test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} });

test('sorteio: número do grupo = últimos 4 dígitos mod N (0 vira N)', () => {
  assert.strictEqual(N.numeroSorteadoGrupo('59074', 2000), 9074 % 2000);
  assert.strictEqual(N.numeroSorteadoGrupo('12000', 2000), 2000); // 2000 % 2000 = 0 → N
  assert.strictEqual(N.numeroSorteadoGrupo('007802', 1000), 802);
});

test('sorteio: casa por proximidade (frente ímpar, trás par, anel)', () => {
  assert.strictEqual(N.casaDaCota(100, 100, 2000), 0);
  assert.strictEqual(N.casaDaCota(101, 100, 2000), 1);  // 1 à frente
  assert.strictEqual(N.casaDaCota(99, 100, 2000), 2);   // 1 atrás
  assert.strictEqual(N.casaDaCota(102, 100, 2000), 3);
  assert.strictEqual(N.casaDaCota(1, 2000, 2000), 1);   // dá a volta no anel
});

test('comissão: roxo importando — próprio, laranja (2/5 · 3/5), outro roxo, não bateu', () => {
  const f = { id: 'f1', gestorEmail: 'roxo', gestorNome: 'Gestor Roxo', nivelImportador: 'roxo', impostos: [], pagos: {}, cotasBase: [
    { grupo: '1', cota: '1', cliente: '', aut: 0, lic: 100, autDono: null, licDest: { tipo: 'proprio' } },
    { grupo: '1', cota: '2', cliente: '', aut: 0, lic: 100.5, autDono: null, licDest: { tipo: 'sup', email: 'laranja', nome: 'Sup Laranja', time: 'L' } },
    { grupo: '1', cota: '3', cliente: '', aut: 0, lic: 50, autDono: null, licDest: { tipo: 'roxo', email: 'outro', nome: 'Outro Roxo', time: 'R' } },
    { grupo: '1', cota: '4', cliente: '', aut: 30, lic: 0, autDono: 'ca', licDest: null },
    { grupo: '1', cota: '5', cliente: '', aut: 0, lic: 10, autDono: null, licDest: null },
  ] };
  N.comMontarFechamento(f);
  assert.strictEqual(f.repassesSupervisor[0].cheio, 40.2);         // 100,50 ÷ 5 × 2
  assert.strictEqual(f.gestor.cheio, 100 + 60.3);                  // próprio + 3/5 retido
  assert.strictEqual(f.repassesRoxo[0].cheio, 50);                  // integral ao outro roxo
  assert.strictEqual(f.porConsultor[0].cheio, 30);                  // AUTORIZADO → consultor
  assert.strictEqual(f.naoBateuTotal, 10);                          // sem dono
  assert.strictEqual(f.totalCheio, 100 + 60.3 + 40.2 + 50 + 30);
  assert.strictEqual(f.totalPendente, f.totalRepasse);
});

test('comissão: impostos % e fixo rateado', () => {
  const f = { id: 'f2', gestorEmail: 'roxo', gestorNome: 'G', nivelImportador: 'roxo', pagos: {}, impostos: [{ nome: 'ISS', tipo: 'pct', valor: 10 }, { nome: 'Taxa', tipo: 'fixo', valor: 20 }], cotasBase: [
    { grupo: '1', cota: '1', cliente: '', aut: 100, lic: 0, autDono: 'c1', licDest: null },
    { grupo: '1', cota: '2', cliente: '', aut: 100, lic: 0, autDono: 'c2', licDest: null },
  ] };
  N.comMontarFechamento(f);
  // cada um: 10% de 100 = 10 + metade do fixo 20 = 10 → imposto 20, líquido 80
  f.porConsultor.forEach(p => { assert.strictEqual(p.imposto, 20); assert.strictEqual(p.liquido, 80); });
});

test('valores de planilha: texto BR, milhar com ponto e célula numérica', () => {
  assert.strictEqual(N.parseValorImport('1.234,56'), 1234.56);
  assert.strictEqual(N.parseValorImport('200.000'), 200000);
  assert.strictEqual(N.parseValorImport('R$ 1.500.000'), 1500000);
  assert.strictEqual(N.parseValorImport(1.125), 1.125);            // célula numérica não vira milhar
  assert.strictEqual(N.parseValorImport('346350.63'), 346350.63);
});

test('loteria: lê o formato da Caixa e decide quando pode haver sorteio novo', () => {
  const r = N.lerResultadoLoteria({ numero: 6104, dataApuracao: '27/09/2026', listaDezenas: ['059074', '003557', '020563', '040449', '007802'] });
  assert.deepStrictEqual(r.premios, ['059074', '003557', '020563', '040449', '007802']);
  assert.strictEqual(r.dataISO, '2026-09-27');
  // Caixa informa o próximo: concurso de quarta 23/09 com próximo no DOMINGO 27/09 → libera 27/09 às 20h de Brasília (23h UTC)
  const qua = N.lerResultadoLoteria({ numero: 6103, dataApuracao: '23/09/2026', dataProximoConcurso: '27/09/2026', listaDezenas: ['1', '2', '3', '4', '5'] });
  assert.strictEqual(qua.proximaISO, '2026-09-27');
  assert.strictEqual(N.podeTerSorteioNovo(qua, Date.UTC(2026, 8, 26, 23, 30)), false); // sábado: não consulta à toa
  assert.strictEqual(N.podeTerSorteioNovo(qua, Date.UTC(2026, 8, 27, 22, 59)), false);
  assert.strictEqual(N.podeTerSorteioNovo(qua, Date.UTC(2026, 8, 27, 23, 1)), true);
  // sem data anunciada: domingo 27/09 → próximo dia provável é quarta 30/09
  assert.strictEqual(N.podeTerSorteioNovo({ dataISO: '2026-09-27' }, Date.UTC(2026, 8, 29, 23, 30)), false);
  assert.strictEqual(N.podeTerSorteioNovo({ dataISO: '2026-09-27' }, Date.UTC(2026, 8, 30, 23, 1)), true);
  assert.strictEqual(N.podeTerSorteioNovo(null), true);
});

test('push: criptografia idêntica ao exemplo oficial da RFC 8291', () => {
  const out = push.criptografar('When I grow up, I want to be a watermelon', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', { senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.strictEqual(out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('acessos: login inválido é recusado e senha trocada derruba sessão antiga', async () => {
  assert.ok(auth.criarUsuario("a');x//", '1234', 'X', 'consultor').erro);
  auth.criarUsuario('cons1', 'velha1', 'Consultor Um', 'consultor', { time: 'A' });
  const l = await auth.login('cons1', 'velha1');
  const req = { headers: { cookie: l.cookie.split(';')[0] } };
  assert.ok(auth.getSession(req));
  const t = await auth.trocarSenha('cons1', 'velha1', 'nova12');
  assert.ok(t.ok);
  await new Promise(r => setTimeout(r, 2100)); // cache de leitura do cadastro (2 s)
  assert.strictEqual(auth.getSession(req), null);                               // cookie antigo morreu
  assert.ok(auth.getSession({ headers: { cookie: t.cookie.split(';')[0] } }));  // cookie novo vale
  assert.strictEqual(await auth.login('cons1', 'velha1'), null);
});

test('simuladores de planilha: Venda da Carta × CDI (correções v164) e INCC/assunção igual ao Excel', () => {
  const S = require('../public/simuladores.js');
  const c = S.calcCarta({ credito: 100000, prazo: 220, taxaAdm: .242, reducao: .5, lanceParcelas: 44, incc: .06, recompra: .5, cdi: .145 });
  const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), a + ' ≠ ' + b);
  perto(c.parcelaLiberada, 337.27272727272725);
  perto(c.linhas[12].credito, 106000); perto(c.linhas[12].credLance, 79669.6);   // 13º mês: 1º reajuste INCC
  perto(c.linhas[219].lucroL, -21668.302314494038);
  // v164: CDI com taxa mensal equivalente — 12 meses compostos dão exatamente o CDI anual
  perto(Math.pow(1 + (Math.pow(1.145, 1 / 12) - 1), 12), 1.145); assert.ok(c.linhas[219].lucroCdi < 378236);
  const r = S.calcIncc({ prazo: 180, parcela: 2500, saldo: 700000, credito: 450000, incc: .06,
    faixas: [{ min: 0, desc: 0 }, { min: 60, desc: .25 }, { min: 70, desc: .3 }, { min: 100, desc: .4 }, { min: 160, desc: .5 }] });
  perto(r.linhas[23].parcela, 4227.380952380952); perto(r.linhas[89].assuncao, 377787.1025715801);
  perto(r.totalPago, 1096064.2730676136);
  // v167: custo do INCC volta a ser IGUAL à planilha do time (6,11% a.a. no exemplo); TIR fica só na planilha nova
  perto(r.custoAA, 0.06114541165683729); perto(r.linhas[89].custoAssuncao, 0.0031849398183791955);
  // a função de TIR continua disponível (e certa): PRICE a 1% a.m. tem que dar 1%
  const pmt = 100000 * 0.01 / (1 - Math.pow(1.01, -120));
  assert.ok(Math.abs(S.tirMensal(100000, Array(120).fill(pmt), 120, 0) - 0.01) < 1e-7);
});

test('chat (v170): gestor envia mensagem para toda a equipe — só o time dele recebe', async () => {
  auth.criarUsuario('eqa1', 'x1234', 'Ana Equipe', 'consultor', { time: 'A' });
  auth.criarUsuario('eqa2', 'x1234', 'Bia Equipe', 'consultor', { time: 'A' });
  auth.criarUsuario('eql1', 'x1234', 'Caio Outro', 'consultor', { time: 'L' });
  const gestor = { papel: 'gestor', email: 'roxo', nome: 'Gestor Roxo', time: 'A' };
  const r = await N.enviarChat(gestor, { paraTime: true, texto: 'Reunião às 9h' });
  assert.ok(r.ok && r.qtd >= 2, JSON.stringify(r));
  const ana = await N.listarChat({ papel: 'consultor', email: 'eqa1', nome: 'Ana Equipe', time: 'A' });
  assert.ok(ana.mensagens.some(m => m.equipe && m.texto === 'Reunião às 9h'));
  const caio = await N.listarChat({ papel: 'consultor', email: 'eql1', nome: 'Caio Outro', time: 'L' });
  assert.ok(!caio.mensagens.some(m => m.texto === 'Reunião às 9h'));            // outro time não recebe
  const hist = await N.listarChat(gestor, '#equipe');
  const envio = hist.mensagens.find(m => m.texto === 'Reunião às 9h');
  assert.strictEqual(envio.total, r.qtd); assert.ok(envio.lidas >= 1);            // Ana já leu
  const cons = await N.enviarChat({ papel: 'consultor', email: 'eqa2', nome: 'Bia Equipe', time: 'A' }, { paraTime: true, texto: 'oi' });
  assert.ok(cons.ok && cons.qtd === undefined);                                  // consultor não faz envio em massa
});

test('estrutura de gestão (v172): níveis, quem responde a quem, equipes visíveis e check-in individual', async () => {
  auth.criarUsuario('dono1', 'x1234', 'Dona Loja', 'gestor', { time: 'D' });
  auth.criarUsuario('cinza1', 'x1234', 'Gestor Loja', 'gestor', { time: 'C', cor: '#9CA3AF' });
  auth.criarUsuario('lar2', 'x1234', 'Sup Dois', 'gestor', { time: 'L2', cor: '#FB923C' });
  auth.criarUsuario('ver1', 'x1234', 'Vermelho Um', 'consultor', { time: 'L2' });
  auth.criarUsuario('ver2', 'x1234', 'Vermelho Dois', 'consultor', { time: 'L2' });
  const ed = (l, c) => auth.atualizarUsuario(l, c);
  assert.ok(ed('dono1', { nivel: 'dono', superior: '' }).ok);
  assert.ok(ed('cinza1', { nivel: 'gestorLoja', superior: 'dono1' }).ok);
  assert.ok(ed('roxo', { nivel: 'gestorEquipe', superior: 'cinza1' }).ok);
  assert.ok(ed('lar2', { nivel: 'supervisor', superior: 'roxo' }).ok);
  assert.ok(ed('ver1', { nivel: 'consultor', superior: 'lar2' }).ok);
  assert.ok(ed('ver2', { nivel: 'consultor', superior: 'lar2' }).ok);
  // regras: laranja não fica acima de roxo; consultor não vira gestor pelo nível; ninguém acima de quem já é maior que ele
  assert.ok(ed('roxo', { superior: 'lar2' }).erro);
  // v176: o nível manda no acesso — consultor promovido vira gestor (e volta)
  assert.ok(ed('ver1', { nivel: 'supervisor' }).erro); assert.ok(ed('ver1', { nivel: 'supervisor', superior: 'roxo' }).ok); assert.strictEqual(auth.usuarioPorEmail('ver1').papel, 'gestor');
  assert.ok(ed('ver1', { nivel: 'consultor', superior: 'lar2' }).ok); assert.strictEqual(auth.usuarioPorEmail('ver1').papel, 'consultor');
  // v176: rebaixar o cinza para supervisor passa o roxo (que ficaria igual/maior) para o chefe dele (dono1)
  const rb = ed('cinza1', { nivel: 'supervisor' }); assert.ok(rb.ok && rb.movidos && rb.movidos.includes('Gestor Roxo'));
  assert.strictEqual(auth.usuarioPorEmail('roxo').superior, 'dono1');
  assert.ok(ed('cinza1', { nivel: 'gestorLoja', superior: 'dono1' }).ok); assert.ok(ed('roxo', { superior: 'cinza1' }).ok);
  assert.strictEqual(auth.usuarioPorEmail('lar2').cor, '#FB923C');    // cor acompanha o nível (comissão laranja)
  // quem está acima enxerga as equipes de baixo; o de baixo não enxerga as de cima
  const vis = l => auth.timesVisiveis(auth.usuarioPorEmail(l));
  assert.ok(vis('dono1').includes('L2') && vis('dono1').includes('C') && vis('dono1').includes('A'));
  assert.ok(vis('roxo').includes('L2') && !vis('roxo').includes('C'));
  assert.ok(!vis('lar2').includes('A'));
  // check-in: estrutura do roxo vale para os vermelhos do laranja dele; individual substitui
  const roxo = { papel: 'gestor', email: 'roxo', nome: 'Gestor Roxo', time: 'A' };
  assert.ok((await N.salvarRotinas(roxo, { rotinas: ['Ligar 10 clientes'], alvo: { tipo: 'estrutura', id: 'roxo' } })).ok);
  assert.deepStrictEqual(N.rotinasDe('ver1'), ['Ligar 10 clientes']);
  assert.ok((await N.salvarRotinas(roxo, { rotinas: ['Visita ao cliente X'], alvo: { tipo: 'pessoa', id: 'ver2' } })).ok);
  assert.deepStrictEqual(N.rotinasDe('ver2'), ['Visita ao cliente X']);
  assert.deepStrictEqual(N.rotinasDe('ver1'), ['Ligar 10 clientes']);
  // laranja só manda para a estrutura dele; não mexe em quem está fora
  const lar = { papel: 'gestor', email: 'lar2', nome: 'Sup Dois', time: 'L2' };
  assert.ok((await N.salvarRotinas(lar, { rotinas: ['x'], alvo: { tipo: 'estrutura', id: 'roxo' } })).erro);
  assert.ok((await N.salvarRotinas(lar, { rotinas: ['Prospectar'], alvo: { tipo: 'estrutura', id: 'lar2' } })).ok);
  assert.deepStrictEqual(N.rotinasDe('ver1'), ['Prospectar']);        // o chefe mais próximo vale
  assert.ok((await N.salvarRotinas(roxo, { alvo: { tipo: 'pessoa', id: 'ver2' }, remover: true })).ok);
  assert.deepStrictEqual(N.rotinasDe('ver2'), ['Prospectar']);
});

test('estrutura no site todo (v173): superior vê vendas/consultores de toda a estrutura; modo equipe restringe', async () => {
  const sess = (l, t) => ({ papel: 'gestor', email: l, nome: auth.usuarioPorEmail(l).nome, time: t });
  const ver1 = { papel: 'consultor', email: 'ver1', nome: 'Vermelho Um', time: 'L2' };
  assert.ok((await N.criarVenda(ver1, { nome: 'Cliente Estrutura', valor: 1000, status: 'negociacao', data: '2026-10-05', telefone: '11 99999-0000', semLead: true })).ok);
  const dono = sess('dono1', 'D'), lar = sess('lar2', 'L2'), cinza = sess('cinza1', 'C');
  const temVenda = async s => ((await N.listarVendas(s, {})).vendas || []).some(v => v.cliente && v.cliente.nome === 'Cliente Estrutura');
  assert.ok(await temVenda(dono));                     // dono vê a venda do vermelho lá embaixo
  assert.ok(await temVenda(cinza));
  assert.ok(await temVenda(lar));                      // o laranja é o chefe direto
  assert.ok(!(await temVenda(sess('outro', 'R'))));    // outro roxo fora da estrutura não vê
  const nomes = (await N.listarChat(dono)).lista.map(c => c.email);
  assert.ok(nomes.includes('ver1') && nomes.includes('ver2'));
  // dono troca para UMA equipe (a dele, D) → deixa de ver a estrutura; volta para "toda a estrutura"
  assert.ok(N.trocarEquipe(dono, { time: 'D' }).ok);
  assert.ok(!(await temVenda(dono)));
  assert.ok(N.trocarEquipe(dono, { time: '*estrutura' }).ok);
  assert.ok(await temVenda(dono));
  assert.ok(N.trocarEquipe(lar, { time: '*estrutura' }).ok);   // laranja tem vermelhos abaixo: também pode
  assert.ok(N.trocarEquipe(sess('outro', 'R'), { time: '*estrutura' }).erro);
});

test('estrutura pelo time (v174): consultor sem "Responde a" fica abaixo do gestor dono do time dele', async () => {
  auth.criarUsuario('roxoT', 'x1234', 'Danilo Roxo', 'gestor', { time: 'Chama', cor: '#A78BFA' });
  auth.criarUsuario('larT', 'x1234', 'Adriane Lar', 'gestor', { time: 'Alpha', cor: '#FB923C' });
  auth.criarUsuario('vA', 'x1234', 'Leandro Alpha', 'consultor', { time: 'Alpha' });
  auth.criarUsuario('vC', 'x1234', 'Diego Chama', 'consultor', { time: 'Chama' });
  const sup = l => auth.usuarioPorEmail(l).superior;
  assert.strictEqual(sup('vA'), 'lart');                     // vermelho do Alpha → Adriane (sem cadastrar nada)
  assert.strictEqual(sup('vC'), 'roxot');                    // vermelho do Chama → direto com o Danilo
  assert.ok(auth.usuarioPorEmail('vA').superiorPeloTime);
  assert.ok(auth.atualizarUsuario('larT', { nivel: 'supervisor', superior: 'roxot' }).ok);
  const abaixoRoxo = auth.abaixoDe('roxot').map(u => String(u.email).toLowerCase());
  assert.ok(abaixoRoxo.includes('lart') && abaixoRoxo.includes('va') && abaixoRoxo.includes('vc')); // o time da Adriane veio junto
  assert.ok(auth.atualizarUsuario('vA', { time: 'Chama' }).ok);  // troca de time → muda de chefe sozinho
  assert.strictEqual(sup('vA'), 'roxot');
  assert.ok(auth.atualizarUsuario('vA', { nivel: 'consultor', superior: 'lart' }).ok); // manual vale por cima
  assert.strictEqual(sup('vA'), 'lart'); assert.ok(!auth.usuarioPorEmail('vA').superiorPeloTime);
});

test('estrutura (v175): gestor desativado passa o time para o chefe direto; time extra sem dono principal', async () => {
  auth.criarUsuario('roxoD', 'x1234', 'Roxo D', 'gestor', { time: 'TD', cor: '#A78BFA' });
  auth.criarUsuario('larD', 'x1234', 'Lar D', 'gestor', { time: 'LD', cor: '#FB923C' });
  auth.criarUsuario('vD1', 'x1234', 'Verm D1', 'consultor', { time: 'LD' });   // pelo time
  auth.criarUsuario('vD2', 'x1234', 'Verm D2', 'consultor', { time: 'X9' });
  assert.ok(auth.atualizarUsuario('larD', { nivel: 'supervisor', superior: 'roxod' }).ok);
  assert.ok(auth.atualizarUsuario('vD2', { nivel: 'consultor', superior: 'lard' }).ok);   // ligado à mão
  const r = auth.repassarAbaixo('larD'); auth.atualizarUsuario('larD', { ativo: false });
  assert.strictEqual(r.para, 'roxod'); assert.strictEqual(r.movidos.length, 2);
  assert.strictEqual(auth.usuarioPorEmail('vD1').superior, 'roxod'); assert.ok(!auth.usuarioPorEmail('vD1').superiorPeloTime);
  assert.strictEqual(auth.usuarioPorEmail('vD2').superior, 'roxod');
  auth.atualizarUsuario('larD', { ativo: true });                                       // reativar NÃO devolve
  assert.strictEqual(auth.usuarioPorEmail('vD1').superior, 'roxod');
  // item 5: time "Extra9" sem gestor principal → fica com quem tem o time como extra
  auth.criarUsuario('vE', 'x1234', 'Verm Extra', 'consultor', { time: 'Extra9' });
  assert.ok(!auth.usuarioPorEmail('vE').superior);
  auth.atualizarUsuario('roxoD', { equipes: ['Extra9'] });
  assert.strictEqual(auth.usuarioPorEmail('vE').superior, 'roxod'); assert.ok(auth.usuarioPorEmail('vE').superiorPeloTime);
});

test('estrutura (v178): branco fica abaixo do vermelho que indicou e guarda a origem ao virar vermelho', async () => {
  auth.criarUsuario('larB', 'x1234', 'Lar B', 'gestor', { time: 'TB', cor: '#FB923C' });
  auth.criarUsuario('vB', 'x1234', 'Verm B', 'consultor', { time: 'TB' });
  auth.criarUsuario('bB', 'x1234', 'Branco B', 'consultor', { time: 'TB' });
  assert.ok(auth.atualizarUsuario('larB', { nivel: 'supervisor' }).ok);
  // vermelho indica o branco: acesso continua de consultor, balão branco
  assert.ok(auth.atualizarUsuario('bB', { nivel: 'branco', superior: 'vb' }).ok);
  let b = auth.usuarioPorEmail('bB');
  assert.strictEqual(b.nivel, 'branco'); assert.strictEqual(b.papel, 'consultor'); assert.strictEqual(b.superior, 'vb'); assert.strictEqual(b.indicadoPor, 'vb');
  assert.strictEqual(b.cor, '#FFFFFF');
  // o gestor do vermelho enxerga o branco na estrutura; o vermelho não vira gestor
  assert.ok(auth.abaixoDe('larb').map(u => String(u.email).toLowerCase()).includes('bb'));
  assert.strictEqual(auth.usuarioPorEmail('vB').papel, 'consultor');
  // ninguém fica abaixo de um branco; branco não pode ter papel de gestor
  assert.ok(auth.atualizarUsuario('vB', { nivel: 'consultor', superior: 'bb' }).erro);
  // virou vermelho: sai de baixo de quem indicou (volta ao automático pelo time), mas a origem fica guardada
  assert.ok(auth.atualizarUsuario('bB', { nivel: 'consultor' }).ok);
  b = auth.usuarioPorEmail('bB');
  assert.strictEqual(b.nivel, 'consultor'); assert.strictEqual(b.superior, 'larb'); assert.ok(b.superiorPeloTime);
  assert.strictEqual(b.indicadoPor, 'vb'); assert.strictEqual(b.cor, '#E23B3B');
});

test('estrutura (v178): rebaixar escolhendo como chefe quem estava abaixo não deixa ninguém respondendo a si mesmo', async () => {
  auth.criarUsuario('roxoC', 'x1234', 'Roxo C', 'gestor', { time: 'TC', cor: '#A78BFA' });
  auth.criarUsuario('larC', 'x1234', 'Lar C', 'gestor', { time: 'LC', cor: '#FB923C' });
  auth.criarUsuario('larC2', 'x1234', 'Lar C2', 'gestor', { time: 'LC2', cor: '#FB923C' });
  auth.criarUsuario('vC1', 'x1234', 'Verm C1', 'consultor', { time: 'LC' });
  auth.criarUsuario('vC2', 'x1234', 'Verm C2', 'consultor', { time: 'TC' });
  assert.ok(auth.atualizarUsuario('larC', { nivel: 'supervisor', superior: 'roxoc' }).ok);
  assert.ok(auth.atualizarUsuario('larC2', { nivel: 'supervisor', superior: 'roxoc' }).ok);
  // o roxo vira consultor e passa a responder ao laranja que estava ABAIXO dele
  assert.ok(auth.atualizarUsuario('roxoC', { nivel: 'consultor', superior: 'larc' }).ok);
  const sup = l => auth.usuarioPorEmail(l).superior;
  assert.strictEqual(sup('larC'), '');          // subiu para o lugar do roxo (antes: respondia a si mesmo)
  assert.strictEqual(sup('roxoC'), 'larc');
  assert.strictEqual(sup('larC2'), '');         // mesmo nível do novo chefe → vai para o chefe antigo (topo)
  assert.strictEqual(sup('vC2'), 'larc');       // consultor do time do roxo → novo chefe
  assert.strictEqual(sup('vC1'), 'larc');
  assert.strictEqual(auth.quebrarCirculos(auth.listarUsuarios()).length, 0);
});

test('estrutura (v178): dado antigo em círculo é consertado (leitura e cadastro) e ligação em círculo é recusada', async () => {
  auth.criarUsuario('larD9', 'x1234', 'Lar D9', 'gestor', { time: 'D9', cor: '#FB923C' });
  auth.criarUsuario('roxoD9', 'x1234', 'Roxo D9', 'gestor', { time: 'R9', cor: '#A78BFA' });
  assert.ok(auth.atualizarUsuario('larD9', { nivel: 'supervisor', superior: 'roxod9' }).ok);
  // simula o dado quebrado da regra antiga: o laranja respondendo a si mesmo
  const f = path.join(TMP, 'usuarios.json'); const us = JSON.parse(fs.readFileSync(f, 'utf8'));
  us.find(u => u.email === 'lard9').superior = 'lard9'; us.find(u => u.email === 'roxod9').superior = 'lard9';
  fs.writeFileSync(f, JSON.stringify(us));
  const lido = auth.usuarioPorEmail('larD9');
  assert.strictEqual(lido.superior, ''); assert.ok(lido.estruturaCorrigida);   // na leitura já não some da árvore
  const corr = auth.repararEstrutura();
  assert.ok(corr.some(c => c.login === 'lard9'));
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).find(u => u.email === 'lard9').superior, '');
  assert.strictEqual(auth.usuarioPorEmail('roxoD9').superior, 'lard9');      // continua como estava; o Julio reorganiza
  // pela tela: tirar o roxo de baixo do laranja volta a funcionar
  assert.ok(auth.atualizarUsuario('roxoD9', { nivel: 'gestorEquipe', superior: '' }).ok);
  assert.ok(auth.atualizarUsuario('larD9', { nivel: 'supervisor', superior: 'roxod9' }).ok);
});

test('estrutura (v179): branco é consultor e só fica abaixo de um vermelho do MESMO time', async () => {
  auth.criarUsuario('larE', 'x1234', 'Lar E', 'gestor', { time: 'TE', cor: '#FB923C' });
  auth.criarUsuario('vE1', 'x1234', 'Verm E1', 'consultor', { time: 'TE' });
  auth.criarUsuario('vE2', 'x1234', 'Verm E2', 'consultor', { time: 'OUTRO' });
  auth.criarUsuario('bE', 'x1234', 'Branco E', 'consultor', { time: 'TE' });
  assert.ok(auth.atualizarUsuario('larE', { nivel: 'supervisor' }).ok);
  assert.ok(auth.atualizarUsuario('bE', { nivel: 'branco', superior: 'vE2'.toLowerCase() }).erro);  // vermelho de outro time: não
  assert.ok(auth.atualizarUsuario('bE', { nivel: 'branco', superior: 'lare' }).erro);               // gestor: não (só vermelho)
  assert.ok(auth.atualizarUsuario('bE', { nivel: 'branco', superior: 've1' }).ok);                 // vermelho do mesmo time: sim
  assert.ok(auth.atualizarUsuario('bE', { nivel: 'branco', superior: '' }).ok);                    // ou automático pelo time
  assert.strictEqual(auth.usuarioPorEmail('bE').superior, 'lare');
  assert.ok(auth.atualizarUsuario('bE', { nivel: 'branco', superior: 've1' }).ok);
  assert.ok(auth.atualizarUsuario('vE1', { time: 'OUTRO' }).ok);                                    // o vermelho mudou de time
  assert.strictEqual(auth.usuarioPorEmail('bE').superior, 'lare');                                  // o branco volta ao automático
  assert.strictEqual(auth.ROTULO_NIVEL.branco, 'consultor (branco)');
});

test('funil de leads (v182): cadastro, duplicado, colunas, vínculo com a venda e ficha', async () => {
  auth.criarUsuario('gL', 'x1234', 'Gestor Leads', 'gestor', { time: 'TL', cor: '#A78BFA' });
  auth.criarUsuario('cL', 'x1234', 'Cons Leads', 'consultor', { time: 'TL' });
  auth.criarUsuario('cX', 'x1234', 'Cons Fora', 'consultor', { time: 'OUTRO-TL' });
  const cons = { papel: 'consultor', email: 'cl', nome: 'Cons Leads', time: 'TL' };
  const fora = { papel: 'consultor', email: 'cx', nome: 'Cons Fora', time: 'OUTRO-TL' };
  const gest = { papel: 'gestor', email: 'gl', nome: 'Gestor Leads', time: 'TL' };
  assert.ok((await N.criarLead(cons, { nome: 'Sem contato' })).erro);                       // precisa telefone ou @
  const a = await N.criarLead(cons, { nome: 'Danilo', telefone: '(11) 98888-7777', obs: 'veio do Insta' });
  assert.ok(a.ok); assert.strictEqual(a.lead.status, 'lead');
  const dup = await N.criarLead(cons, { nome: 'Danilo 2', telefone: '11988887777' });       // mesmo telefone → avisa
  assert.ok(dup.duplicado); assert.strictEqual(dup.duplicado.nome, 'Danilo');
  assert.ok((await N.criarLead(cons, { nome: 'Danilo 2', telefone: '11988887777', forcar: true })).ok);
  const b = await N.criarLead(cons, { nome: 'Julia Insta', insta: 'julia.c' });
  assert.strictEqual(b.lead.insta, '@julia.c');
  // colunas
  assert.ok((await N.moverLead(cons, { id: a.lead.id, status: 'andamento' })).ok);
  assert.ok((await N.moverLead(cons, { id: a.lead.id, status: 'venda' })).erro);           // "virou venda" só pela venda
  assert.ok((await N.moverLead(fora, { id: a.lead.id, status: 'lead' })).erro);            // outro consultor não mexe
  assert.ok((await N.moverLead(gest, { id: b.lead.id, status: 'excluido' })).ok);          // gestor do time mexe
  // quem vê o quê
  assert.strictEqual((await N.listarLeads(cons, {})).leads.length, 3);
  assert.ok((await N.listarLeads(fora, { de: 'cl' })).erro);
  const vg = await N.listarLeads(gest, { de: 'cl' });
  assert.strictEqual(vg.leads.length, 3); assert.ok(vg.pessoas.some(p => p.login === 'cl'));
  // busca do vínculo: não traz Excluídos
  const bus = await N.buscarLeads(cons, { q: 'dan' });
  assert.deepStrictEqual(bus.leads.map(l => l.nome).sort(), ['Danilo', 'Danilo 2']);
  assert.strictEqual((await N.buscarLeads(cons, { q: 'julia' })).leads.length, 0);
  // venda nova: telefone e vínculo obrigatórios
  const base = { nome: 'Danilo Silva', valor: 50000, status: 'negociacao', data: '2026-10-16' };
  assert.ok((await N.criarVenda(cons, { ...base, semLead: true })).erro);                  // sem telefone
  assert.ok((await N.criarVenda(cons, { ...base, telefone: '11988887777' })).erro);        // sem lead e sem "Sem lead"
  assert.ok((await N.criarVenda(cons, { ...base, telefone: '11988887777', leadId: b.lead.id })).erro); // lead em Excluídos
  const v1 = await N.criarVenda(cons, { ...base, telefone: '11988887777', leadId: a.lead.id, grupo: '9001', cota: '11' });
  assert.ok(v1.ok); assert.strictEqual(v1.venda.leadId, a.lead.id); assert.strictEqual(v1.venda.cliente.telefone, '11988887777');
  const v2 = await N.criarVenda(cons, { ...base, valor: 30000, telefone: '11988887777', leadId: a.lead.id, grupo: '9001', cota: '12' }); // 2ª cota, mesmo lead
  assert.ok(v2.ok);
  assert.strictEqual((await N.listarLeads(cons, {})).leads.some(l => l.id === a.lead.id), false); // saiu do quadro
  let rf = N.resumoLeads('cl');
  assert.strictEqual(rf.venda, 1); assert.strictEqual(rf.total, 3); assert.strictEqual(rf.pct, 33);
  // telefone foi para a ficha do cliente
  assert.strictEqual((await N.fichaCliente(cons, { nome: 'Danilo Silva' })).telefone, '11988887777');
  // cliente antigo (carteira) não exige lead nem telefone
  assert.ok((await N.criarVenda(cons, { nome: 'Antigo', valor: 1000, status: 'fechada', carteira: true, _import: true })).ok);
  // venda excluída: enquanto houver outra venda, o lead continua como venda; sem nenhuma, volta para Em andamento
  assert.ok((await N.excluirVenda(cons, { id: v1.venda.id })).ok);
  assert.strictEqual(N.resumoLeads('cl').venda, 1);
  assert.ok((await N.excluirVendas(cons, { ids: [v2.venda.id] })).ok);
  rf = N.resumoLeads('cl'); assert.strictEqual(rf.venda, 0); assert.strictEqual(rf.andamento, 1);
  // gestor lançando venda em nome do consultor: o lead tem que ser do consultor dono da venda
  const g1 = await N.criarLead(gest, { nome: 'Lead do Gestor', telefone: '21977776666' });
  assert.ok((await N.criarVenda(gest, { ...base, consultorEmail: 'cl', telefone: '21977776666', leadId: g1.lead.id })).erro);
  assert.ok((await N.criarVenda(gest, { ...base, telefone: '21977776666', leadId: g1.lead.id })).ok);
});

test('check-in do gestor (v183): lista própria, marcar, finalizar e sem pontos para o gestor', async () => {
  auth.criarUsuario('gCk', 'x1234', 'Gestor Check', 'gestor', { time: 'TCK', cor: '#A78BFA' });
  auth.criarUsuario('cCk', 'x1234', 'Cons Check', 'consultor', { time: 'TCK' });
  const g = { papel: 'gestor', email: 'gck', nome: 'Gestor Check', time: 'TCK' };
  const c = { papel: 'consultor', email: 'cck', nome: 'Cons Check', time: 'TCK' };
  let m = await N.meuCheckinGestor(g);
  assert.ok(m.ok); assert.ok(m.padrao); assert.ok(m.total > 0);                         // começa com a lista sugerida
  assert.ok((await N.meuCheckinGestor(c)).erro);                                          // consultor não usa esta rota
  assert.ok((await N.salvarRotinasGestor(g, { rotinas: [' ', ''] })).erro);              // lista vazia não
  assert.ok((await N.salvarRotinasGestor(g, { rotinas: ['Ligar para 5 clientes', 'Revisar funil', 'Ligar para 5 clientes'] })).ok);
  m = await N.meuCheckinGestor(g);
  assert.deepStrictEqual(m.rotinas.map(r => r.nome), ['Ligar para 5 clientes', 'Revisar funil']); assert.strictEqual(m.padrao, false);
  const rotC = N.rotinasDe('cck');
  assert.ok(!rotC.includes('Revisar funil'));                                             // a lista do gestor não vai para o consultor
  const r1 = await N.registrarCheckin(g, { rotina: 'Revisar funil', valor: true });
  assert.ok(r1.ok); assert.strictEqual(r1.feitas, 1);
  assert.ok((await N.registrarCheckin(g, { rotina: 'Item que não existe', valor: true })).erro);
  assert.ok((await N.finalizarCheckin(g)).ok);
  assert.ok((await N.registrarCheckin(g, { rotina: 'Ligar para 5 clientes', valor: true })).erro); // finalizado trava
  m = await N.meuCheckinGestor(g); assert.ok(m.finalizado); assert.strictEqual(m.feitas, 1);
  assert.ok((await N.salvarRotinasGestor(g, { padrao: true })).ok);                     // volta à lista sugerida
  assert.ok((await N.meuCheckinGestor(g)).padrao);
});

test('sorteio por cliente (v184): sinal da distância, 1º prêmio × 5 prêmios, agrupado por cliente', async () => {
  // sinal: + acima, − abaixo, menor caminho no anel
  assert.strictEqual(N.distanciaComSinal(459, 457, 1000), 2);
  assert.strictEqual(N.distanciaComSinal(455, 457, 1000), -2);
  assert.strictEqual(N.distanciaComSinal(1, 1000, 1000), 1);      // dá a volta: 1 está 1 acima do 1000
  assert.strictEqual(N.distanciaComSinal(999, 1, 1000), -2);
  assert.strictEqual(N.distanciaComSinal(457, 457, 1000), 0);
  auth.criarUsuario('gSrt', 'x1234', 'Gestor Sorteio', 'gestor', { time: 'TSRT', cor: '#A78BFA' });
  const g = { papel: 'gestor', email: 'gsrt', nome: 'Gestor Sorteio', time: 'TSRT' };
  const nova = (nome, grupo, cota, tipo) => N.criarVenda(g, { nome, valor: 1000, status: 'fechada', carteira: true, _import: true, grupo, cota, tamanhoGrupo: 1000, tipo });
  await nova('Cli A', '8801', '458', 'veiculo');   // 1º prêmio 39457 → 457 no grupo de 1000 → +1
  await nova('Cli A', '8802', '900', 'veiculo');   // outra cota do mesmo cliente (longe)
  await nova('Cli B', '8801', '455', 'veiculo');   // −2
  await nova('Cli C', '8803', '120', 'veiculo');   // perto do 2º prêmio (81120 → 120) = 0 só no modo 5
  await nova('Cli D', '8804', '457', 'imovel');    // outro tipo: não entra em veículos
  const premios = ['39457', '81120', '', '', ''];
  const r1 = await N.sorteioClientes(g, { premios, tipo: 'veiculo', modo: '1' });
  assert.ok(r1.ok);
  assert.deepStrictEqual(r1.clientes.map(c => c.nome).slice(0, 2), ['Cli A', 'Cli B']);
  assert.strictEqual(r1.clientes[0].cotas[0].d, 1); assert.strictEqual(r1.clientes[0].cotas.length, 2);
  assert.strictEqual(r1.clientes[1].cotas[0].d, -2);
  assert.ok(!r1.clientes.some(c => c.nome === 'Cli D'));
  const r5 = await N.sorteioClientes(g, { premios, tipo: 'veiculo', modo: '5' });
  assert.strictEqual(r5.clientes[0].nome, 'Cli C'); assert.strictEqual(r5.clientes[0].cotas[0].d, 0); assert.strictEqual(r5.clientes[0].cotas[0].premio, 2);
  const ri = await N.sorteioClientes(g, { premios, tipo: 'imovel', modo: '1' });
  assert.strictEqual(ri.clientes[0].nome, 'Cli D'); assert.strictEqual(ri.clientes[0].cotas[0].d, 0);
  assert.ok((await N.sorteioClientes(g, { premios: ['', '81120'], tipo: 'veiculo', modo: '1' })).erro); // modo 1 exige o 1º prêmio
});
