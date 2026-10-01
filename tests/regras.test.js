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

test('simuladores de planilha: Venda da Carta × CDI e INCC/assunção (Excel + correções v164)', () => {
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
  // v164: custo = TIR real (a planilha dava 6,11% a.a.); TIR de um PRICE a 1% a.m. tem que dar 1%
  assert.ok(Math.abs(r.custoAA - 0.1221) < 0.0005, 'custo a.a. ' + r.custoAA);
  const pmt = 100000 * 0.01 / (1 - Math.pow(1.01, -120));
  assert.ok(Math.abs(S.tirMensal(100000, Array(120).fill(pmt), 120, 0) - 0.01) < 1e-7);
});
