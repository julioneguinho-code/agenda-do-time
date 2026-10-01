/* Simuladores de planilha (v163) — mesma conta das planilhas Excel do time:
 *  • "Venda da Carta com Lucro" (Alavancagem — venda da carta contemplada)
 *  • "INCC e Assunção de Dívida" (correção anual do saldo e valor para assumir a cota)
 * O CÁLCULO fica separado da TELA: as funções calcCarta/calcIncc também rodam no Node (testes conferem
 * mês a mês com os valores salvos nas planilhas originais). */
(function (raiz) {
  'use strict';

  // ---------------- CÁLCULO: VENDA DA CARTA COM LUCRO ----------------
  // p = { credito, prazo, taxaAdm, reducao, lanceParcelas, incc, recompra, cdi }  (taxas em fração: 0,242 = 24,2%)
  function calcCarta(p) {
    const A = +p.credito, E = Math.round(+p.prazo), tx = +p.taxaAdm, red = +p.reducao, lance = +p.lanceParcelas,
      incc = +p.incc, rec = +p.recompra,
      cdiAM = Math.pow(1 + (+p.cdi), 1 / 12) - 1;   // v164: taxa mensal EQUIVALENTE (a planilha dividia por 12 e superestimava o CDI)
    const parcelaOriginal = A * (1 + tx) / E;
    const creditoReduzidoTx = A * (1 - red) + A * tx;          // "crédito reduzido + TX adm"
    const parcelaLiberada = creditoReduzidoTx / E;            // parcela reduzida que o cliente paga
    const linhas = [];
    let B = A, C = parcelaLiberada, D = 0, L = 0, somaC = 0;
    for (let m = 1; m <= E; m++) {
      if (m > 1 && (m - 1) % 12 === 0) { B = B * (1 + incc); C = C * (1 + incc); }   // reajuste a cada 12 meses
      D += C; somaC += C;
      L = m === 1 ? C : L * (1 + cdiAM) + C;
      const lucroBrutoS = B * rec, lucroS = lucroBrutoS - D;
      const credLance = B - ((B * (1 + tx)) / E) * lance;     // crédito líquido com lance embutido
      const lucroBrutoL = credLance * rec, lucroL = lucroBrutoL - D;
      const lucroCdi = L - somaC;
      linhas.push({ mes: m, credito: B, parcela: C, investido: D,
        brutoS: lucroBrutoS, lucroS, roiS: lucroS / D,
        credLance, brutoL: lucroBrutoL, lucroL, roiL: lucroL / D,
        cdiTotal: L, lucroCdi, roiCdi: lucroCdi / somaC });   // v164: rendimento ÷ investido (mesma base do ROI da venda)
    }
    const ultimoPositivo = k => { let u = 0; for (const l of linhas) if (l[k] > 0) u = l.mes; return u; };
    return { parcelaOriginal, parcelaLiberada, creditoReduzidoTx, linhas,
      ateQuandoSorteio: ultimoPositivo('lucroS'), ateQuandoLance: ultimoPositivo('lucroL') };
  }

  // ---------------- CÁLCULO: INCC E ASSUNÇÃO DE DÍVIDA ----------------
  // p = { prazo, parcela, saldo, credito, incc, faixas:[{min, desc}] }  (faixas: parcelas restantes ≥ min → desconto)
  function descontoFaixa(faixas, restantes) {
    // igual ao LOOKUP do Excel: maior "min" que seja ≤ restantes (faixas em qualquer ordem)
    let d = 0, melhor = -Infinity;
    for (const f of faixas || []) if (+f.min <= restantes && +f.min > melhor) { melhor = +f.min; d = +f.desc; }
    return d;
  }
  // Taxa mensal (TIR) que iguala o crédito recebido no início aos pagamentos: parcelas 1..m e, no mês m,
  // um pagamento final (saldo para quitar, ou valor de assunção). v164: substitui a conta da planilha
  // [(pago + saldo) ÷ crédito]^(1/prazo) − 1, que tratava tudo como pago num único dia no fim e dava ~metade do custo real.
  function tirMensal(credito, parcelas, m, finalMes) {
    const vpl = t => { let v = credito, f = 1; for (let k = 0; k < m; k++) { f /= (1 + t); v -= parcelas[k] * f; } return v - Math.max(0, finalMes) * f; };
    let lo = -0.5, hi = 1;
    if (!(vpl(lo) < 0)) return lo; if (!(vpl(hi) > 0)) return hi;
    for (let i = 0; i < 80; i++) { const md = (lo + hi) / 2; if (vpl(md) > 0) hi = md; else lo = md; }
    return (lo + hi) / 2;
  }
  function calcIncc(p) {
    const prazo = Math.round(+p.prazo), incc = +p.incc, cred = +p.credito, faixas = p.faixas || [];
    const linhas = [], pagas = [];
    let D = +p.parcela, F = +p.saldo, G = 0;
    for (let m = 1; m <= prazo; m++) {
      const B = prazo - (m - 1);                              // parcelas restantes (inclui a atual)
      const reaj = m > 1 && (m - 1) % 12 === 0;
      const E = m === 1 ? +p.saldo : (reaj ? F * (1 + incc) : F);   // saldo antes
      if (reaj) D = E / B;                                    // no reajuste a parcela é recalculada
      F = E - D; G += D; pagas.push(D);
      const H = descontoFaixa(faixas, B), I = F * (1 - H);
      const J = tirMensal(cred, pagas, m, F);                  // custo da operação (% a.m.) — quitando o saldo no mês m
      const K = tirMensal(cred, pagas, m, I);                  // custo de assunção (% a.m.) — pagando o valor de assunção no mês m
      linhas.push({ mes: m, restantes: B, reajuste: reaj, parcela: D, saldoAntes: E, saldo: F, pago: G,
        desconto: H, assuncao: I, custoOp: J, custoAssuncao: K });
    }
    const ult = linhas[linhas.length - 1] || {};
    return { linhas, totalPago: ult.pago || 0, saldoFinal: ult.saldo || 0, parcelaFinal: ult.parcela || 0,
      pagoSobreCredito: cred ? (ult.pago || 0) / cred : 0, custoAM: ult.custoOp || 0,
      custoAA: Math.pow(1 + (ult.custoOp || 0), 12) - 1 };
  }

  const api = { calcCarta, calcIncc, descontoFaixa, tirMensal };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  raiz.SimPlan = api;

  // ======================= TELA (só no navegador) =======================
  const brl = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = (v, c = 2) => isFinite(v) ? (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%' : '–';
  const cor = v => v >= 0 ? 'var(--ok)' : 'var(--no)';
  // lê número digitado em BR: "100.000", "100.000,50", "24,2", "1.5" (taxa: ponto = decimal)
  function num(id, taxa) {
    const el = document.getElementById(id); if (!el) return NaN;
    let v = String(el.value || '').trim().replace(/\s|R\$|%/g, ''); if (!v) return NaN;
    if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
    else if (!taxa && /^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, '');
    return parseFloat(v);
  }
  const campo = (id, rot, val, dica, taxa) => `<div class="spl-c"><label for="${id}">${rot}</label><input id="${id}" type="text" inputmode="decimal" value="${val}"${taxa ? ' data-taxa="1"' : ''}>${dica ? `<small>${dica}</small>` : ''}</div>`;

  (function css() {
    if (document.getElementById('spl-css')) return;
    const st = document.createElement('style'); st.id = 'spl-css';
    st.textContent = '.spl-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}'
      + '@media(min-width:620px){.spl-g{grid-template-columns:repeat(4,minmax(0,1fr))}}'
      + '.spl-c{min-width:0}.spl-c label{display:block;font-size:11px;color:var(--mut);margin-bottom:3px}'
      + '.spl-c input{width:100%;padding:10px;border:1px solid var(--bord);border-radius:10px;font-size:14px;background:var(--bg);color:var(--txt)}'
      + '.spl-c small{display:block;font-size:10px;color:var(--mut);margin-top:2px;line-height:1.25}'
      + '.spl-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}@media(min-width:620px){.spl-k{grid-template-columns:repeat(3,minmax(0,1fr))}}'
      + '.spl-k>div{background:var(--bg);border-radius:10px;padding:9px 10px;min-width:0}.spl-k b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.spl-k span{font-size:11px;color:var(--mut)}'
      + '.spl-t{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--bord);border-radius:10px}'
      + '.spl-t table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}.spl-t th{background:var(--bg);font-weight:600;color:var(--mut);font-size:11px;text-align:right;padding:7px 8px;position:sticky;top:0}'
      + '.spl-t td{text-align:right;padding:6px 8px;border-top:1px solid var(--bord)}.spl-t th:first-child,.spl-t td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}.spl-t th:first-child{background:var(--bg)}'
      + '.spl-t tr.on td{background:#FFF6D6}.spl-t tr.on td:first-child{background:#FFF6D6}'
      + '.spl-h{font-weight:700;font-size:13px;margin:4px 0 8px}.spl-box{border-radius:12px;padding:11px 12px;margin-bottom:8px;border:1px solid var(--bord)}'
      + '.spl-faixas{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;align-items:center}.spl-faixas input{width:100%;padding:8px;border:1px solid var(--bord);border-radius:9px;font-size:13px;background:var(--bg);color:var(--txt)}';
    document.head.appendChild(st);
  })();

  // ---------------- TELA: VENDA DA CARTA ----------------
  const MARCOS_C = [1, 3, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 120, 144, 168, 180, 200, 220, 240];
  let _carta = null, _cartaTodos = false;
  function montarCarta(el) {
    el.innerHTML = `<div class="card" style="padding:12px;margin-bottom:10px">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px">💰 Venda da Carta × CDI</div>
      <div class="mut" style="font-size:12px;margin-bottom:10px">Cliente compra a cota com parcela reduzida e, contemplado, vende a carta. Compare com deixar o mesmo dinheiro no CDI.</div>
      <div class="spl-g">
        ${campo('spc-credito', 'Valor do crédito (R$)', '100.000')}
        ${campo('spc-prazo', 'Prazo (meses)', '220')}
        ${campo('spc-adm', 'Taxa adm total (%)', '24,2', '', 1)}
        ${campo('spc-red', 'Parcela reduzida (%)', '50', 'quanto do crédito sai da parcela', 1)}
        ${campo('spc-lance', 'Lance embutido (nº parcelas)', '44', 'modalidade lance fixo')}
        ${campo('spc-incc', 'Correção INCC (% a.a.)', '6', '', 1)}
        ${campo('spc-rec', 'Recompra (% do crédito)', '50', 'quanto o comprador paga pela carta', 1)}
        ${campo('spc-cdi', 'CDI (% a.a.)', '14,5', '', 1)}
      </div>
      <button class="btn" style="width:100%;padding:11px;margin-top:12px" onclick="SimPlan.calcularCarta()">Calcular</button>
    </div><div id="spc-res"></div>`;
    el.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') api.calcularCarta(); }));
    api.calcularCarta();
  }
  api.calcularCarta = function () {
    const p = { credito: num('spc-credito'), prazo: num('spc-prazo'), taxaAdm: num('spc-adm', 1) / 100, reducao: num('spc-red', 1) / 100,
      lanceParcelas: num('spc-lance'), incc: num('spc-incc', 1) / 100, recompra: num('spc-rec', 1) / 100, cdi: num('spc-cdi', 1) / 100 };
    const out = document.getElementById('spc-res');
    const erro = !(p.credito > 0) ? 'Informe o valor do crédito' : !(p.prazo >= 1 && p.prazo <= 400) ? 'Prazo entre 1 e 400 meses'
      : [p.taxaAdm, p.reducao, p.lanceParcelas, p.incc, p.recompra, p.cdi].some(v => !isFinite(v) || v < 0) ? 'Preencha todos os campos (use 0 quando não houver)'
      : p.reducao >= 1 ? 'Parcela reduzida precisa ser menor que 100%' : '';
    if (erro) { out.innerHTML = `<div class="card" style="padding:12px;color:var(--no)">${erro}</div>`; return; }
    _carta = calcCarta(p);
    const mesIni = Math.min(12, _carta.linhas.length);
    out.innerHTML = `<div class="card" style="padding:12px;margin-bottom:10px">
        <div class="spl-k">
          <div><span>Parcela original</span><b>${brl(_carta.parcelaOriginal)}</b></div>
          <div><span>Parcela reduzida</span><b style="color:var(--ok)">${brl(_carta.parcelaLiberada)}</b></div>
          <div><span>Lucro na venda até o</span><b>${_carta.ateQuandoSorteio ? _carta.ateQuandoSorteio + 'º mês' : 'nenhum mês'}</b><span>no sorteio · lance: ${_carta.ateQuandoLance ? _carta.ateQuandoLance + 'º mês' : 'nenhum'}</span></div>
        </div>
      </div>
      <div class="card" style="padding:12px;margin-bottom:10px">
        <label style="font-size:12px;color:var(--mut)">Mês da contemplação: <b id="spc-mesv" style="color:var(--txt)">${mesIni}º</b></label>
        <input id="spc-mes" type="range" min="1" max="${_carta.linhas.length}" value="${mesIni}" style="width:100%;margin:6px 0 10px" oninput="SimPlan.mesCarta(this.value)">
        <div id="spc-mesres"></div>
      </div>
      <div class="card" style="padding:12px;margin-bottom:10px">
        <div class="row" style="align-items:center;margin-bottom:8px"><div class="spl-h" style="margin:0">📋 Mês a mês</div><button class="btn sec2" style="padding:5px 10px;font-size:12px" onclick="SimPlan.todosCarta()" id="spc-todos">Ver todos os meses</button></div>
        <div id="spc-tab"></div>
        <div class="mut" style="font-size:11px;margin-top:6px">Crédito e parcela sobem pelo INCC a cada 12 meses. Lucro líquido = valor da venda − total investido. ROI = lucro ÷ investido.</div>
      </div>`;
    _cartaTodos = false; api.mesCarta(mesIni);
  };
  api.mesCarta = function (m) {
    m = +m; const l = _carta && _carta.linhas[m - 1]; if (!l) return;
    document.getElementById('spc-mesv').textContent = m + 'º';
    const vezes = l.lucroCdi > 0 ? l.lucroS / l.lucroCdi : null;
    document.getElementById('spc-mesres').innerHTML = `
      <div class="spl-box"><div class="spl-h">🎲 Sorteio</div><div class="spl-k">
        <div><span>Crédito</span><b>${brl(l.credito)}</b></div><div><span>Venda da carta</span><b>${brl(l.brutoS)}</b></div>
        <div><span>Total investido</span><b>${brl(l.investido)}</b></div><div><span>Lucro líquido</span><b style="color:${cor(l.lucroS)}">${brl(l.lucroS)}</b></div>
        <div><span>ROI</span><b style="color:${cor(l.roiS)}">${pct(l.roiS, 0)}</b></div></div></div>
      <div class="spl-box"><div class="spl-h">🎯 Lance fixo (embutido)</div><div class="spl-k">
        <div><span>Crédito após lance</span><b>${brl(l.credLance)}</b></div><div><span>Venda da carta</span><b>${brl(l.brutoL)}</b></div>
        <div><span>Lucro líquido</span><b style="color:${cor(l.lucroL)}">${brl(l.lucroL)}</b></div><div><span>ROI</span><b style="color:${cor(l.roiL)}">${pct(l.roiL, 0)}</b></div></div></div>
      <div class="spl-box" style="background:var(--bg)"><div class="spl-h">🏦 Mesmo valor no CDI (100%)</div><div class="spl-k">
        <div><span>Total acumulado</span><b>${brl(l.cdiTotal)}</b></div><div><span>Rendimento</span><b>${brl(l.lucroCdi)}</b></div><div><span>Rendimento ÷ investido</span><b>${pct(l.roiCdi)}</b></div></div>
        ${vezes ? `<div style="font-size:12px;margin-top:8px">No ${m}º mês, vender a carta (sorteio) dá <b style="color:${cor(l.lucroS)}">${vezes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}×</b> o rendimento do CDI.</div>` : ''}</div>`;
    tabelaCarta(m);
  };
  api.todosCarta = function () { _cartaTodos = !_cartaTodos; document.getElementById('spc-todos').textContent = _cartaTodos ? 'Ver só os marcos' : 'Ver todos os meses'; tabelaCarta(+document.getElementById('spc-mes').value); };
  function tabelaCarta(sel) {
    const ls = _carta.linhas.filter(l => _cartaTodos || MARCOS_C.includes(l.mes) || l.mes === sel || l.mes === _carta.linhas.length);
    document.getElementById('spc-tab').innerHTML = `<div class="spl-t" style="max-height:${_cartaTodos ? '420px' : 'none'}"><table><thead><tr><th>Mês</th><th>Crédito</th><th>Parcela</th><th>Investido</th><th>Lucro sorteio</th><th>ROI</th><th>Lucro lance</th><th>ROI</th><th>Rend. CDI</th></tr></thead><tbody>${ls.map(l => `<tr class="${l.mes === sel ? 'on' : ''}"><td>${l.mes}º</td><td>${brl(l.credito)}</td><td>${brl(l.parcela)}</td><td>${brl(l.investido)}</td><td style="color:${cor(l.lucroS)}">${brl(l.lucroS)}</td><td>${pct(l.roiS, 0)}</td><td style="color:${cor(l.lucroL)}">${brl(l.lucroL)}</td><td>${pct(l.roiL, 0)}</td><td>${brl(l.lucroCdi)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------- TELA: INCC E ASSUNÇÃO ----------------
  const FAIXAS_PADRAO = [{ min: 160, desc: 50 }, { min: 100, desc: 40 }, { min: 70, desc: 30 }, { min: 60, desc: 25 }, { min: 0, desc: 0 }];
  const MARCOS_I = [1, 12, 24, 36, 48, 60, 90, 120, 160, 180, 200, 220, 240];
  let _incc = null;
  function montarIncc(el) {
    el.innerHTML = `<div class="card" style="padding:12px;margin-bottom:10px">
      <div style="font-weight:700;font-size:14px;margin-bottom:2px">🏗️ INCC e Assunção de Dívida</div>
      <div class="mut" style="font-size:12px;margin-bottom:10px">Projeta a correção anual do saldo pelo INCC e quanto custa assumir a cota em cada momento do plano.</div>
      <div class="spl-g">
        ${campo('spi-prazo', 'Prazo total (meses)', '180')}
        ${campo('spi-parcela', 'Parcela inicial (R$)', '2.500')}
        ${campo('spi-saldo', 'Saldo devedor atual (R$)', '700.000')}
        ${campo('spi-credito', 'Valor do crédito (R$)', '450.000')}
        ${campo('spi-incc', 'INCC — reajuste anual (%)', '6', '', 1)}
      </div>
      <details style="margin-top:10px"><summary style="font-size:12px;cursor:pointer;color:var(--acc)">Desconto de assunção por parcelas restantes</summary>
        <div class="spl-faixas" style="margin-top:8px"><div class="mut" style="font-size:11px">Parcelas restantes ≥</div><div class="mut" style="font-size:11px">Desconto (%)</div>
        ${FAIXAS_PADRAO.map((f, i) => `<input id="spi-fmin${i}" inputmode="numeric" value="${f.min}"><input id="spi-fdesc${i}" inputmode="decimal" value="${f.desc}" data-taxa="1">`).join('')}</div>
        <div class="mut" style="font-size:11px;margin-top:6px">Ex.: 165 parcelas restantes → 50% de desconto. Abaixo de 60 → sem desconto (paga o saldo integral).</div>
      </details>
      <button class="btn" style="width:100%;padding:11px;margin-top:12px" onclick="SimPlan.calcularIncc()">Calcular</button>
    </div><div id="spi-res"></div>`;
    el.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') api.calcularIncc(); }));
    api.calcularIncc();
  }
  api.calcularIncc = function () {
    const faixas = FAIXAS_PADRAO.map((_, i) => ({ min: num('spi-fmin' + i), desc: num('spi-fdesc' + i, 1) / 100 })).filter(f => isFinite(f.min) && isFinite(f.desc));
    const p = { prazo: num('spi-prazo'), parcela: num('spi-parcela'), saldo: num('spi-saldo'), credito: num('spi-credito'), incc: num('spi-incc', 1) / 100, faixas };
    const out = document.getElementById('spi-res');
    const erro = !(p.prazo >= 1 && p.prazo <= 400) ? 'Prazo entre 1 e 400 meses' : !(p.parcela > 0) ? 'Informe a parcela inicial'
      : !(p.saldo > 0) ? 'Informe o saldo devedor' : !(p.credito > 0) ? 'Informe o valor do crédito' : !(p.incc >= 0) ? 'Informe o INCC (0 se não houver)' : '';
    if (erro) { out.innerHTML = `<div class="card" style="padding:12px;color:var(--no)">${erro}</div>`; return; }
    _incc = calcIncc(p);
    const n = _incc.linhas.length, mesIni = Math.min(12, n), pJusta = p.saldo / p.prazo;
    const aviso = Math.abs(p.parcela - pJusta) / pJusta > 0.1 && p.prazo > 12
      ? `<div style="font-size:12px;background:#FFF6D6;border-radius:10px;padding:8px 10px;margin-bottom:10px">⚠️ A parcela informada (${brl(p.parcela)}) ${p.parcela < pJusta ? 'não quita' : 'quita mais rápido que'} o saldo em ${p.prazo} meses — o justo seria cerca de <b>${brl(pJusta)}</b>. No 13º mês o sistema recalcula a parcela (salto para ${brl(_incc.linhas[12].parcela)}). <a href="#" onclick="document.getElementById('spi-parcela').value='${pJusta.toFixed(2).replace('.', ',')}';SimPlan.calcularIncc();return false" style="color:var(--acc)">Usar ${brl(pJusta)}</a></div>` : '';
    out.innerHTML = aviso + `<div class="card" style="padding:12px;margin-bottom:10px"><div class="spl-h">📌 Resultados do plano</div>
        <div class="spl-k">
          <div><span>Total pago até o fim</span><b>${brl(_incc.totalPago)}</b></div>
          <div><span>Parcela do último mês</span><b>${brl(_incc.parcelaFinal)}</b></div>
          <div><span>Total pago ÷ crédito</span><b>${_incc.pagoSobreCredito.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}×</b></div>
          <div><span>Custo da operação</span><b>${pct(_incc.custoAM, 3)} a.m.</b></div>
          <div><span>Custo da operação</span><b>${pct(_incc.custoAA)} a.a.</b></div>
        </div></div>
      <div class="card" style="padding:12px;margin-bottom:10px">
        <label style="font-size:12px;color:var(--mut)">Assumir a dívida no mês: <b id="spi-mesv" style="color:var(--txt)">${mesIni}º</b></label>
        <input id="spi-mes" type="range" min="1" max="${n}" value="${mesIni}" style="width:100%;margin:6px 0 10px" oninput="SimPlan.mesIncc(this.value)">
        <div id="spi-mesres"></div>
      </div>
      <div class="card" style="padding:12px;margin-bottom:10px"><div class="spl-h">📋 Marcos do plano — quanto custa assumir a dívida</div><div id="spi-tab"></div>
        <div class="mut" style="font-size:11px;margin-top:6px">Valor de assunção = saldo devedor do mês × (1 − desconto da faixa). Custo = taxa mensal (TIR) entre o crédito recebido e tudo o que foi pago até o mês, incluindo o valor final.</div></div>`;
    api.mesIncc(mesIni);
  };
  api.mesIncc = function (m) {
    m = +m; const l = _incc && _incc.linhas[m - 1]; if (!l) return;
    document.getElementById('spi-mesv').textContent = m + 'º';
    document.getElementById('spi-mesres').innerHTML = `<div class="spl-k">
      <div><span>Parcelas restantes</span><b>${l.restantes}</b></div>
      <div><span>Parcela</span><b>${brl(l.parcela)}</b>${l.reajuste ? '<span>↑ reajustada pelo INCC</span>' : ''}</div>
      <div><span>Saldo devedor</span><b>${brl(l.saldo)}</b></div>
      <div><span>Desconto</span><b>${pct(l.desconto, 0)}</b></div>
      <div><span>Valor de assunção</span><b style="color:var(--ok)">${brl(l.assuncao)}</b></div>
      <div><span>Custo assunção</span><b style="color:${cor(-l.custoAssuncao)}">${pct(l.custoAssuncao, 3)} a.m.</b></div></div>`;
    const ls = _incc.linhas.filter(x => MARCOS_I.includes(x.mes) || x.mes === m || x.mes === _incc.linhas.length);
    document.getElementById('spi-tab').innerHTML = `<div class="spl-t"><table><thead><tr><th>Mês</th><th>Restantes</th><th>Parcela</th><th>Saldo devedor</th><th>Desconto</th><th>Valor de assunção</th><th>Custo a.m.</th></tr></thead><tbody>${ls.map(x => `<tr class="${x.mes === m ? 'on' : ''}"><td>${x.mes}º</td><td>${x.restantes}</td><td>${brl(x.parcela)}</td><td>${brl(Math.max(0, x.saldo))}</td><td>${pct(x.desconto, 0)}</td><td>${brl(Math.max(0, x.assuncao))}</td><td>${pct(x.custoAssuncao, 3)}</td></tr>`).join('')}</tbody></table></div>`;
  };

  // abre dentro do painel do simulador (chamado por abrirSimulador das telas)
  api.montar = function (id, el) {
    if (!el || el.dataset.ok) return; el.dataset.ok = '1';
    if (id === 'carta') montarCarta(el); else if (id === 'incc') montarIncc(el);
  };
})(typeof window !== 'undefined' ? window : globalThis);
