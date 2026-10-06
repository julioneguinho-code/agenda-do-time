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
  assert.ok(ed('ver1', { nivel: 'supervisor' }).erro);
  assert.ok(ed('cinza1', { nivel: 'supervisor' }).erro);              // o roxo responde a ele
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
  assert.ok((await N.criarVenda(ver1, { nome: 'Cliente Estrutura', valor: 1000, status: 'negociacao', data: '2026-10-05' })).ok);
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
