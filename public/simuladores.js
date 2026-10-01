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

  // ======================= TELA (só no navegador) — v165: layout mais amigável =======================
  const brl = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl0 = v => (isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const curto = v => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? s + 'R$ ' + (a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : a >= 1e3 ? s + 'R$ ' + Math.round(a / 1e3) + ' mil' : s + 'R$ ' + Math.round(a); };
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
  // campo com unidade dentro (R$ à esquerda, % / meses à direita)
  const campo = (id, rot, val, o = {}) => `<label class="spl-c" for="${id}"><span class="spl-rot">${rot}</span>
    <span class="spl-in">${o.pre ? `<i>${o.pre}</i>` : ''}<input id="${id}" type="text" inputmode="decimal" value="${val}" autocomplete="off">${o.suf ? `<i>${o.suf}</i>` : ''}</span>
    ${o.dica ? `<small>${o.dica}</small>` : ''}</label>`;
  const kpi = (rot, val, o = {}) => `<div class="spl-kp"${o.full ? ' style="grid-column:1/-1"' : ''}><span>${rot}</span><b${o.cor ? ` style="color:${o.cor}"` : ''}>${val}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</div>`;

  (function css() {
    if (document.getElementById('spl-css')) return;
    const st = document.createElement('style'); st.id = 'spl-css';
    st.textContent = ''
      + '.spl-top{display:flex;gap:12px;align-items:center;margin-bottom:12px}.spl-ic{width:46px;height:46px;flex:none;border-radius:14px;display:grid;place-items:center;font-size:24px;background:var(--accbg,#fde8ea)}'
      + '.spl-top b{display:block;font-size:16px}.spl-top span{font-size:12px;color:var(--mut);line-height:1.35;display:block}'
      + '.spl-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}@media(min-width:620px){.spl-g{grid-template-columns:repeat(3,minmax(0,1fr))}}'
      + '.spl-c{min-width:0;display:block}.spl-rot{display:block;font-size:12px;color:var(--mut);margin-bottom:4px;font-weight:500}'
      + '.spl-in{display:flex;align-items:center;border:1.5px solid var(--bord);border-radius:12px;background:var(--card2,#F2F3F5);padding:0 10px;transition:border-color .15s}'
      + '.spl-in:focus-within{border-color:var(--acc);background:var(--card)}.spl-in i{font-style:normal;font-size:12px;color:var(--mut);flex:none}'
      + '.spl-in input{flex:1;min-width:0;border:0;background:transparent;padding:11px 6px;font-size:15px;font-weight:600;color:var(--txt);outline:0}'
      + '.spl-c small{display:block;font-size:10.5px;color:var(--mut);margin-top:3px;line-height:1.25}'
      + '.spl-aj{margin-top:12px;border-top:1px dashed var(--bord);padding-top:10px}.spl-aj summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--txt);list-style:none;display:block;position:relative;padding-right:20px}'
      + '.spl-aj summary::-webkit-details-marker{display:none}.spl-aj summary:after{content:"▾";color:var(--mut);position:absolute;right:2px;top:0}.spl-aj[open] summary:after{content:"▴"}.spl-aj summary small{display:block;margin-top:2px;font-weight:400;color:var(--mut);font-size:11px}'
      + '.spl-aj .spl-g{margin-top:10px}'
      + '.spl-hero{border-radius:16px;padding:16px;color:#fff;margin-bottom:10px;background:linear-gradient(135deg,#2F7A5C,#3E8E6E 60%,#58A985)}'
      + '.spl-hero.neg{background:linear-gradient(135deg,#A8343B,#C0484E)}.spl-hero.neu{background:linear-gradient(135deg,#3B4352,#555F70)}'
      + '.spl-hero .t{font-size:12px;opacity:.9}.spl-hero .v{font-size:30px;font-weight:800;line-height:1.15;margin:2px 0 6px;letter-spacing:-.5px}.spl-hero .s{font-size:13px;opacity:.95;line-height:1.4}'
      + '.spl-bars{margin-top:12px;display:grid;gap:7px}.spl-bar{font-size:11.5px}.spl-bar div{display:flex;justify-content:space-between;margin-bottom:3px;opacity:.95}'
      + '.spl-bar em{display:block;height:9px;border-radius:6px;background:rgba(255,255,255,.25);overflow:hidden}.spl-bar em u{display:block;height:100%;border-radius:6px;background:#fff}'
      + '.spl-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}@media(min-width:620px){.spl-k{grid-template-columns:repeat(3,minmax(0,1fr))}}'
      + '.spl-kp{background:var(--card2,#F2F3F5);border-radius:12px;padding:10px 11px;min-width:0}.spl-kp span{font-size:11px;color:var(--mut);display:block}'
      + '.spl-kp b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}.spl-kp small{display:block;font-size:10.5px;color:var(--mut);margin-top:1px}'
      + '.spl-sec{font-weight:700;font-size:14px;margin:0 0 10px;display:flex;align-items:center;gap:6px}'
      + '.spl-mes{display:flex;align-items:center;gap:8px;margin-bottom:8px}.spl-mes button{width:38px;height:38px;flex:none;border-radius:50%;border:1.5px solid var(--bord);background:var(--card);font-size:18px;cursor:pointer;color:var(--txt)}'
      + '.spl-mes input[type=range]{flex:1;min-width:0;accent-color:var(--acc)}.spl-mesn{min-width:62px;text-align:center;font-weight:800;font-size:18px}.spl-mesn small{display:block;font-size:10px;color:var(--mut);font-weight:500}'
      + '.spl-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;margin-bottom:12px;scrollbar-width:none}.spl-chips button{flex:none;border:1.5px solid var(--bord);background:var(--card);border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;color:var(--txt)}'
      + '.spl-chips button.on{background:var(--acc);border-color:var(--acc);color:#fff}'
      + '.spl-seg{display:flex;background:var(--card2,#F2F3F5);border-radius:12px;padding:3px;margin-bottom:10px}.spl-seg button{flex:1;border:0;background:transparent;padding:8px 4px;border-radius:9px;font-size:12.5px;font-weight:600;color:var(--mut);cursor:pointer}'
      + '.spl-seg button.on{background:var(--card);color:var(--txt);box-shadow:0 1px 4px rgba(0,0,0,.1)}'
      + '.spl-graf{margin-top:4px}.spl-graf svg{display:block;width:100%;height:150px}.spl-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--mut);margin-top:6px}.spl-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}'
      + '.spl-dica{font-size:12px;background:var(--warnbg,#FFF6D6);border-radius:12px;padding:10px 12px;margin-bottom:10px;line-height:1.4}'
      + '.spl-tab summary{cursor:pointer;font-weight:700;font-size:14px;list-style:none;display:flex;justify-content:space-between}.spl-tab summary::-webkit-details-marker{display:none}.spl-tab summary:after{content:"Mostrar ▾";font-weight:500;font-size:12px;color:var(--acc)}.spl-tab[open] summary:after{content:"Ocultar ▴"}'
      + '.spl-t{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--bord);border-radius:10px;margin-top:10px}'
      + '.spl-t table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}.spl-t th{background:var(--card2,#F2F3F5);font-weight:600;color:var(--mut);font-size:11px;text-align:right;padding:7px 8px;position:sticky;top:0}'
      + '.spl-t td{text-align:right;padding:6px 8px;border-top:1px solid var(--bord)}.spl-t th:first-child,.spl-t td:first-child{text-align:left;position:sticky;left:0;background:var(--card)}.spl-t th:first-child{background:var(--card2,#F2F3F5)}'
      + '.spl-t tr.on td{background:#FFF6D6}'
      + '.spl-faixas{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;align-items:center;margin-top:10px}.spl-faixas .spl-in input{padding:8px 4px;font-size:14px}';
    document.head.appendChild(st);
  })();

  // gráfico de linhas leve (SVG): séries [{v:[...], cor, nome}], sel = índice marcado
  function grafico(series, sel, rotX, largura) {
    // usa a largura real do cartão: sem esticar texto e pontos no computador
    const W = Math.max(260, Math.round(largura || 320)), H = 150, pl = 4, pr = 4, pt = 10, pb = 18, n = series[0].v.length;
    let min = 0, max = 0; series.forEach(s => s.v.forEach(x => { if (isFinite(x)) { min = Math.min(min, x); max = Math.max(max, x); } }));
    if (max === min) max = min + 1;
    const X = i => pl + (n <= 1 ? 0 : i / (n - 1)) * (W - pl - pr), Y = v => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
    const linhas = series.map(s => `<polyline fill="none" stroke="${s.cor}" stroke-width="2.4" stroke-linejoin="round" points="${s.v.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`).join('');
    const zero = min < 0 ? `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--bord)" stroke-dasharray="3 3"/>` : '';
    const mk = sel != null ? `<line x1="${X(sel)}" x2="${X(sel)}" y1="${pt - 6}" y2="${H - pb}" stroke="var(--mut)" stroke-width="1" stroke-dasharray="2 3"/>` + series.map(s => `<circle cx="${X(sel)}" cy="${Y(s.v[sel])}" r="4.5" fill="${s.cor}" stroke="#fff" stroke-width="2"/>`).join('') : '';
    return `<div class="spl-graf"><svg viewBox="0 0 ${W} ${H}" style="height:${H}px">${zero}${linhas}${mk}
      <text x="2" y="${H - 4}" font-size="9" fill="var(--mut)">${rotX[0]}</text><text x="${W - 2}" y="${H - 4}" font-size="9" fill="var(--mut)" text-anchor="end">${rotX[1]}</text>
      <text x="2" y="9" font-size="9" fill="var(--mut)" stroke="var(--card)" stroke-width="3" paint-order="stroke">${curto(max)}</text></svg>
      <div class="spl-leg">${series.map(s => `<span><i style="background:${s.cor}"></i>${s.nome}</span>`).join('')}</div></div>`;
  }
  // seletor de mês: − [barra] + e atalhos
  const seletorMes = (pfx, n, ini, fn, rot) => `<div class="spl-sec">📅 ${rot}</div>
    <div class="spl-mes"><button type="button" aria-label="Mês anterior" onclick="SimPlan.${fn}(+document.getElementById('${pfx}-mes').value-1)">−</button>
      <input id="${pfx}-mes" type="range" min="1" max="${n}" value="${ini}" oninput="SimPlan.${fn}(this.value)">
      <button type="button" aria-label="Próximo mês" onclick="SimPlan.${fn}(+document.getElementById('${pfx}-mes').value+1)">+</button>
      <div class="spl-mesn" id="${pfx}-mesv">${ini}º<small>mês</small></div></div>
    <div class="spl-chips" id="${pfx}-chips">${[1, 6, 12, 24, 36, 60, 120].filter(m => m <= n).concat(n > 120 ? [n] : []).map(m => `<button type="button" data-m="${m}" onclick="SimPlan.${fn}(${m})">${m === n ? 'Último' : m + 'º mês'}</button>`).join('')}</div>`;
  function marcaMes(pfx, m, n) {
    m = Math.max(1, Math.min(n, Math.round(+m) || 1));
    const r = document.getElementById(pfx + '-mes'); if (r) r.value = m;
    const v = document.getElementById(pfx + '-mesv'); if (v) v.innerHTML = m + 'º<small>mês</small>';
    document.querySelectorAll('#' + pfx + '-chips button').forEach(b => b.classList.toggle('on', +b.dataset.m === m));
    return m;
  }
  // recálculo automático enquanto digita (com pequena pausa)
  function autoCalc(el, fn) {
    let t; el.querySelectorAll('input[type=text]').forEach(i => {
      i.addEventListener('input', () => { clearTimeout(t); t = setTimeout(fn, 450); });
      i.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(t); fn(); i.blur(); } });
    });
  }
  const erroCard = msg => `<div class="card" style="padding:14px;color:var(--no);font-size:13px">⚠️ ${msg}</div>`;

  // ---------- MODO COMERCIAL × DETALHES TÉCNICOS (v166) ----------
  // Por padrão o simulador mostra só o que o time comercial usa com o cliente. O botão "Detalhes técnicos"
  // revela taxas, ROI, TIR, gráfico, tabela e fórmulas. A escolha fica lembrada neste aparelho.
  const TEC_KEY = 'chama-sim-tecnico';
  let _tec = false; try { _tec = localStorage.getItem(TEC_KEY) === '1'; } catch (e) { /* sem storage: começa no modo comercial */ }
  const botaoTec = () => `<button type="button" class="spl-btntec" onclick="SimPlan.alternarTec()">${_tec ? '🙈 Ocultar detalhes técnicos' : '🔍 Ver detalhes técnicos'}</button>`;
  api.alternarTec = function () {
    _tec = !_tec; try { localStorage.setItem(TEC_KEY, _tec ? '1' : '0'); } catch (e) { /* ok */ }
    document.querySelectorAll('.spl-root').forEach(r => r.classList.toggle('tec-on', _tec));
    document.querySelectorAll('.spl-btntec').forEach(b => { b.textContent = _tec ? '🙈 Ocultar detalhes técnicos' : '🔍 Ver detalhes técnicos'; });
    // o gráfico precisa da largura real, que só existe com o bloco visível
    if (_tec) { if (_carta && document.getElementById('spc-mes')) api.mesCarta(document.getElementById('spc-mes').value); if (_incc && document.getElementById('spi-mes')) api.mesIncc(document.getElementById('spi-mes').value); }
  };
  (function cssTec() {
    const st = document.createElement('style');
    st.textContent = '.spl-root:not(.tec-on) .spl-tec{display:none!important}'
      + '.spl-btntec{width:100%;margin-top:12px;padding:10px;border-radius:12px;border:1.5px dashed var(--bord);background:transparent;color:var(--mut);font-size:13px;font-weight:600;cursor:pointer}'
      + '.spl-root.tec-on .spl-btntec{border-style:solid;color:var(--txt)}'
      + '.spl-tecbox{border:1.5px dashed var(--bord);border-radius:14px;padding:12px;margin-top:10px}.spl-tecbox>.lbl{font-size:11px;font-weight:700;color:var(--mut);letter-spacing:.4px;text-transform:uppercase;margin-bottom:8px}'
      + '.spl-arg{background:var(--card2,#F2F3F5);border-left:4px solid var(--acc);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.5}'
      + '.spl-arg .acoes{display:flex;gap:8px;margin-top:10px}.spl-arg .acoes button{flex:1;padding:9px;border-radius:10px;border:0;font-size:13px;font-weight:600;cursor:pointer}';
    document.head.appendChild(st);
  })();
  function copiar(txt) {
    const ok = () => { if (window.toast) window.toast('Texto copiado ✓ — é só colar no WhatsApp'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => fallback());
    else fallback();
    function fallback() { const t = document.createElement('textarea'); t.value = txt; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* nada */ } t.remove(); }
  }
  let _argTxt = {};
  api.copiarArg = id => copiar(_argTxt[id] || '');
  api.whatsArg = id => { window.open('https://wa.me/?text=' + encodeURIComponent(_argTxt[id] || ''), '_blank', 'noopener'); };
  const caixaArg = (id, html, txt) => { _argTxt[id] = txt; return `<div class="spl-arg"><div style="font-size:11px;font-weight:700;color:var(--acc);margin-bottom:4px">💬 PARA FALAR COM O CLIENTE</div>${html}
    <div class="acoes"><button type="button" style="background:var(--card);color:var(--txt);border:1.5px solid var(--bord)" onclick="SimPlan.copiarArg('${id}')">📋 Copiar</button><button type="button" style="background:#25D366;color:#fff" onclick="SimPlan.whatsArg('${id}')">WhatsApp</button></div></div>`; };

  // ---------------- TELA: VENDA DA CARTA × CDI ----------------
  const MARCOS_C = [1, 3, 6, 12, 18, 24, 36, 48, 60, 72, 84, 96, 120, 144, 168, 180, 200, 220, 240];
  let _carta = null, _cartaTodos = false, _cartaModo = 'S';
  function montarCarta(el) {
    el.classList.add('spl-root'); el.classList.toggle('tec-on', _tec);
    el.innerHTML = `<div class="card" style="padding:14px;margin-bottom:10px">
      <div class="spl-top"><div class="spl-ic">💰</div><div><b>Venda da Carta × CDI</b><span>Mostre ao cliente quanto ele pode lucrar comprando a cota com parcela reduzida e vendendo a carta quando for contemplado — comparado a deixar o dinheiro no banco (CDI).</span></div></div>
      <div class="spl-g">
        ${campo('spc-credito', 'Valor do crédito', '100.000', { pre: 'R$' })}
        ${campo('spc-prazo', 'Prazo', '220', { suf: 'meses' })}
        ${campo('spc-rec', 'Venda da carta', '50', { suf: '%', dica: 'quanto do crédito o comprador paga' })}
      </div>
      <details class="spl-aj spl-tec"><summary><span>⚙️ Taxas e índices</span><small id="spc-ajres"></small></summary>
        <div class="spl-g">
          ${campo('spc-adm', 'Taxa adm total', '24,2', { suf: '%' })}
          ${campo('spc-red', 'Parcela reduzida', '50', { suf: '%', dica: 'redução do crédito na parcela' })}
          ${campo('spc-lance', 'Lance embutido', '44', { suf: 'parc.', dica: 'usado no modo lance fixo' })}
          ${campo('spc-incc', 'Correção INCC', '6', { suf: '% a.a.' })}
          ${campo('spc-cdi', 'CDI', '14,5', { suf: '% a.a.' })}
        </div></details>
      ${botaoTec()}
    </div><div id="spc-res"></div>`;
    autoCalc(el, api.calcularCarta);
    api.calcularCarta();
  }
  api.calcularCarta = function () {
    const p = { credito: num('spc-credito'), prazo: num('spc-prazo'), taxaAdm: num('spc-adm', 1) / 100, reducao: num('spc-red', 1) / 100,
      lanceParcelas: num('spc-lance'), incc: num('spc-incc', 1) / 100, recompra: num('spc-rec', 1) / 100, cdi: num('spc-cdi', 1) / 100 };
    const out = document.getElementById('spc-res');
    const aj = document.getElementById('spc-ajres');
    if (aj) aj.textContent = `adm ${pct(p.taxaAdm, 1)} · CDI ${pct(p.cdi, 1)} · INCC ${pct(p.incc, 1)}`;
    const erro = !(p.credito > 0) ? 'Informe o valor do crédito' : !(p.prazo >= 1 && p.prazo <= 400) ? 'O prazo precisa ficar entre 1 e 400 meses'
      : [p.taxaAdm, p.reducao, p.lanceParcelas, p.incc, p.recompra, p.cdi].some(v => !isFinite(v) || v < 0) ? 'Preencha todos os campos (use 0 quando não houver)'
      : p.reducao >= 1 ? 'A parcela reduzida precisa ser menor que 100%' : '';
    if (erro) { out.innerHTML = erroCard(erro); return; }
    const mesAnt = +(document.getElementById('spc-mes') || {}).value || 12;
    _carta = calcCarta(p);
    const n = _carta.linhas.length, mesIni = Math.min(mesAnt, n);
    const virada = (_carta.linhas.find(l => l.lucroCdi >= l.lucroS) || {}).mes;
    out.innerHTML = `<div id="spc-hero"></div>
      <div class="card" style="padding:14px;margin-bottom:10px">${seletorMes('spc', n, mesIni, 'mesCarta', 'Se o cliente for contemplado no')}
        <div class="spl-seg"><button type="button" data-m="S" onclick="SimPlan.modoCarta('S')">🎲 Por sorteio</button><button type="button" data-m="L" onclick="SimPlan.modoCarta('L')">🎯 Com lance</button></div>
        <div id="spc-mesres"></div>
        <div class="spl-tecbox spl-tec"><div class="lbl">🔍 Detalhes técnicos do mês</div><div id="spc-mestec"></div></div></div>
      <div class="card" style="padding:14px;margin-bottom:10px" id="spc-arg"></div>
      <div class="card" style="padding:14px;margin-bottom:10px">
        <div class="spl-sec">⏳ Até quando vale a pena?</div>
        <div style="font-size:14px;line-height:1.45">${virada ? `Se for contemplado <b>até o ${virada - 1}º mês</b>, vender a carta rende mais do que deixar o mesmo dinheiro no CDI. Depois disso, o CDI passa à frente.` : 'Em <b>todo o plano</b>, vender a carta rende mais do que deixar o dinheiro no CDI.'}</div>
        <div class="spl-tec" style="margin-top:12px"><div id="spc-graf"></div></div></div>
      <div class="card spl-tec" style="padding:14px;margin-bottom:10px"><div class="spl-sec">🔍 Dados do plano</div><div class="spl-k">
        ${kpi('Parcela original (cheia)', brl(_carta.parcelaOriginal))}${kpi('Parcela reduzida', brl(_carta.parcelaLiberada), { cor: 'var(--ok)' })}
        ${kpi('Crédito reduzido + taxa adm', brl(_carta.creditoReduzidoTx))}
        ${kpi('Lucro na venda até', _carta.ateQuandoSorteio ? _carta.ateQuandoSorteio + 'º mês' : 'nenhum mês', { sub: 'sorteio · lance: ' + (_carta.ateQuandoLance ? _carta.ateQuandoLance + 'º mês' : 'nenhum') })}</div>
        <div class="mut" style="font-size:11.5px;margin-top:10px;line-height:1.5"><b>Como é calculado:</b> parcela reduzida = [crédito × (1 − redução) + crédito × taxa adm] ÷ prazo. Crédito e parcela sobem pelo INCC a cada 12 meses.
          Venda da carta = crédito × % de venda. Lance fixo: crédito − (parcela cheia × nº de parcelas do lance). Lucro = venda − total investido; ROI = lucro ÷ investido.
          CDI: cada parcela é aplicada no mês em que seria paga, rendendo a taxa mensal equivalente (1 + CDI a.a.)^(1/12) − 1.</div></div>
      <details class="card spl-tab spl-tec" style="padding:14px;margin-bottom:10px"><summary>📋 Tabela mês a mês</summary>
        <button class="btn sec2" style="padding:5px 10px;font-size:12px;margin-top:10px" onclick="SimPlan.todosCarta()" id="spc-todos">Ver todos os meses</button>
        <div id="spc-tab"></div></details>`;
    _cartaTodos = false; api.mesCarta(mesIni);
  };
  api.modoCarta = function (m) { _cartaModo = m; api.mesCarta(document.getElementById('spc-mes').value); };
  api.mesCarta = function (m) {
    if (!_carta) return; m = marcaMes('spc', m, _carta.linhas.length); const l = _carta.linhas[m - 1];
    const S = _cartaModo === 'S', lucro = S ? l.lucroS : l.lucroL, roi = S ? l.roiS : l.roiL, venda = S ? l.brutoS : l.brutoL;
    document.querySelectorAll('.spl-seg button').forEach(b => b.classList.toggle('on', b.dataset.m === _cartaModo));
    const vezes = l.lucroCdi > 0 && lucro > 0 ? lucro / l.lucroCdi : null, vezesTxt = vezes ? vezes.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '×' : '';
    const top = Math.max(Math.abs(lucro), Math.abs(l.lucroCdi), 1);
    document.getElementById('spc-hero').innerHTML = `<div class="spl-hero${lucro < 0 ? ' neg' : ''}">
      <div class="t">${lucro >= 0 ? 'Lucro do cliente vendendo a carta' : 'Atenção: neste mês a venda dá prejuízo'} · contemplado ${S ? 'por sorteio' : 'com lance'} no ${m}º mês</div>
      <div class="v">${brl0(lucro)}</div>
      <div class="s">${lucro >= 0 ? `Paga ${brl0(l.investido)} em parcelas e recebe ${brl0(venda)} pela carta.` : `A venda (${brl0(venda)}) não cobre o que ele pagou (${brl0(l.investido)}).`}${vezes ? `<br>É <b>${vezesTxt}</b> o que o mesmo dinheiro renderia no CDI.` : ''}</div>
      <div class="spl-bars">
        <div class="spl-bar"><div><span>💰 Vendendo a carta</span><b>${brl0(lucro)}</b></div><em><u style="width:${Math.max(2, Math.abs(lucro) / top * 100)}%"></u></em></div>
        <div class="spl-bar"><div><span>🏦 Deixando no CDI</span><b>${brl0(l.lucroCdi)}</b></div><em><u style="width:${Math.max(2, Math.abs(l.lucroCdi) / top * 100)}%;opacity:.6"></u></em></div>
      </div></div>`;
    document.getElementById('spc-mesres').innerHTML = `<div class="spl-k">
      ${kpi('Parcela por mês', brl(l.parcela), { sub: m > 12 ? 'já com reajuste anual' : 'parcela reduzida' })}${kpi('Total pago até lá', brl0(l.investido))}
      ${kpi('Recebe pela carta', brl0(venda), { cor: 'var(--ok)', full: true })}</div>`;
    document.getElementById('spc-mestec').innerHTML = `<div class="spl-k">
      ${kpi(S ? 'Crédito no mês' : 'Crédito após o lance', brl(S ? l.credito : l.credLance))}${kpi('ROI', pct(roi, 0), { cor: cor(roi) })}
      ${kpi('No CDI teria', brl(l.cdiTotal), { sub: 'rendimento ' + brl(l.lucroCdi) })}${kpi('Rendimento CDI ÷ investido', pct(l.roiCdi))}</div>`;
    const txt = lucro >= 0
      ? `Com parcelas de ${brl(l.parcela)}, em ${m} meses você investe ${brl0(l.investido)}. Sendo contemplado ${S ? 'por sorteio' : 'com lance'}, pode vender a carta por ${brl0(venda)} e lucrar ${brl0(lucro)}${vezes ? ` — ${vezesTxt} o que esse dinheiro renderia no CDI (${brl0(l.lucroCdi)})` : ''}.`
      : `Contemplado no ${m}º mês, a venda da carta (${brl0(venda)}) não cobre o total pago (${brl0(l.investido)}). Vale mais a pena usar o crédito ou vender antes.`;
    document.getElementById('spc-arg').innerHTML = caixaArg('carta', txt.replace(/(R\$\s?\d[\d.,]*\d|\d+[,.]?\d*×)/g, '<b>$1</b>'), txt);
    document.getElementById('spc-graf').innerHTML = grafico([
      { v: _carta.linhas.map(x => x.lucroS), cor: '#3E8E6E', nome: 'Venda (sorteio)' },
      { v: _carta.linhas.map(x => x.lucroL), cor: '#E0A030', nome: 'Venda (lance fixo)' },
      { v: _carta.linhas.map(x => x.lucroCdi), cor: '#5B7BD5', nome: 'CDI' }], m - 1, ['1º mês', _carta.linhas.length + 'º mês'], document.getElementById('spc-graf').clientWidth);
    tabelaCarta(m);
  };
  api.todosCarta = function () { _cartaTodos = !_cartaTodos; document.getElementById('spc-todos').textContent = _cartaTodos ? 'Ver só os principais' : 'Ver todos os meses'; tabelaCarta(+document.getElementById('spc-mes').value); };
  function tabelaCarta(sel) {
    const ls = _carta.linhas.filter(l => _cartaTodos || MARCOS_C.includes(l.mes) || l.mes === sel || l.mes === _carta.linhas.length);
    document.getElementById('spc-tab').innerHTML = `<div class="spl-t" style="max-height:${_cartaTodos ? '420px' : 'none'}"><table><thead><tr><th>Mês</th><th>Crédito</th><th>Parcela</th><th>Investido</th><th>Lucro sorteio</th><th>ROI</th><th>Lucro lance</th><th>ROI</th><th>Rend. CDI</th></tr></thead><tbody>${ls.map(l => `<tr class="${l.mes === sel ? 'on' : ''}"><td>${l.mes}º</td><td>${brl(l.credito)}</td><td>${brl(l.parcela)}</td><td>${brl(l.investido)}</td><td style="color:${cor(l.lucroS)}">${brl(l.lucroS)}</td><td>${pct(l.roiS, 0)}</td><td style="color:${cor(l.lucroL)}">${brl(l.lucroL)}</td><td>${pct(l.roiL, 0)}</td><td>${brl(l.lucroCdi)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ---------------- TELA: INCC E ASSUNÇÃO ----------------
  const FAIXAS_PADRAO = [{ min: 160, desc: 50 }, { min: 100, desc: 40 }, { min: 70, desc: 30 }, { min: 60, desc: 25 }, { min: 0, desc: 0 }];
  const MARCOS_I = [1, 12, 24, 36, 48, 60, 90, 120, 160, 180, 200, 220, 240];
  let _incc = null;
  function montarIncc(el) {
    el.classList.add('spl-root'); el.classList.toggle('tec-on', _tec);
    el.innerHTML = `<div class="card" style="padding:14px;margin-bottom:10px">
      <div class="spl-top"><div class="spl-ic">🏗️</div><div><b>INCC e Assunção de Dívida</b><span>Mostre ao cliente quanto custa assumir uma cota em cada momento do plano, já com o reajuste anual do INCC e o desconto de assunção.</span></div></div>
      <div class="spl-g">
        ${campo('spi-saldo', 'Saldo devedor atual', '700.000', { pre: 'R$' })}
        ${campo('spi-credito', 'Valor do crédito', '450.000', { pre: 'R$' })}
        ${campo('spi-parcela', 'Parcela atual', '2.500', { pre: 'R$' })}
        ${campo('spi-prazo', 'Prazo total', '180', { suf: 'meses' })}
        ${campo('spi-incc', 'INCC', '6', { suf: '% a.a.', dica: 'reajuste anual do saldo' })}
      </div>
      <details class="spl-aj spl-tec"><summary><span>⚙️ Desconto de assunção por parcelas restantes</span><small>5 faixas</small></summary>
        <div class="spl-faixas"><div class="mut" style="font-size:11px">Parcelas restantes a partir de</div><div class="mut" style="font-size:11px">Desconto</div>
        ${FAIXAS_PADRAO.map((f, i) => `<span class="spl-in"><input id="spi-fmin${i}" type="text" inputmode="numeric" value="${f.min}"><i>parc.</i></span><span class="spl-in"><input id="spi-fdesc${i}" type="text" inputmode="decimal" value="${f.desc}"><i>%</i></span>`).join('')}</div>
        <div class="mut" style="font-size:11px;margin-top:6px">Ex.: 165 parcelas restantes → 50% de desconto. Abaixo de 60 → sem desconto (paga o saldo integral).</div>
      </details>
      ${botaoTec()}
    </div><div id="spi-res"></div>`;
    autoCalc(el, api.calcularIncc);
    api.calcularIncc();
  }
  api.calcularIncc = function () {
    const faixas = FAIXAS_PADRAO.map((_, i) => ({ min: num('spi-fmin' + i), desc: num('spi-fdesc' + i, 1) / 100 })).filter(f => isFinite(f.min) && isFinite(f.desc));
    const p = { prazo: num('spi-prazo'), parcela: num('spi-parcela'), saldo: num('spi-saldo'), credito: num('spi-credito'), incc: num('spi-incc', 1) / 100, faixas };
    const out = document.getElementById('spi-res');
    const erro = !(p.prazo >= 1 && p.prazo <= 400) ? 'O prazo precisa ficar entre 1 e 400 meses' : !(p.parcela > 0) ? 'Informe a parcela atual'
      : !(p.saldo > 0) ? 'Informe o saldo devedor' : !(p.credito > 0) ? 'Informe o valor do crédito' : !(p.incc >= 0) ? 'Informe o INCC (0 se não houver)' : '';
    if (erro) { out.innerHTML = erroCard(erro); return; }
    const mesAnt = +(document.getElementById('spi-mes') || {}).value || 12;
    _incc = calcIncc(p);
    const n = _incc.linhas.length, mesIni = Math.min(mesAnt, n), pJusta = p.saldo / p.prazo;
    const aviso = Math.abs(p.parcela - pJusta) / pJusta > 0.1 && p.prazo > 12
      ? `<div class="spl-dica">⚠️ Confira a parcela: ${brl(p.parcela)} ${p.parcela < pJusta ? 'não paga' : 'paga mais rápido'} o saldo de ${brl0(p.saldo)} em ${p.prazo} meses. O esperado seria cerca de <b>${brl(pJusta)}</b> — no 13º mês a parcela é recalculada e vai para ${brl(_incc.linhas[12].parcela)}.
         <br><button class="btn sec2" style="padding:5px 10px;font-size:12px;margin-top:6px" onclick="document.getElementById('spi-parcela').value='${pJusta.toFixed(2).replace('.', ',')}';SimPlan.calcularIncc()">Usar ${brl(pJusta)}</button></div>` : '';
    out.innerHTML = aviso + `<div class="card" style="padding:14px;margin-bottom:10px">${seletorMes('spi', n, mesIni, 'mesIncc', 'Assumir a cota no')}<div id="spi-mesres"></div>
        <div class="spl-tecbox spl-tec"><div class="lbl">🔍 Detalhes técnicos</div><div id="spi-mestec"></div></div></div>
      <div class="card" style="padding:14px;margin-bottom:10px" id="spi-arg"></div>
      <div class="card spl-tec" style="padding:14px;margin-bottom:10px"><div class="spl-sec">🔍 Custo do plano</div><div class="spl-k">
        ${kpi('Custo real (TIR)', pct(_incc.custoAA) + ' a.a.', { sub: pct(_incc.custoAM, 3) + ' ao mês' })}${kpi('Total pago até o fim', brl0(_incc.totalPago), { sub: _incc.pagoSobreCredito.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '× o crédito' })}
        ${kpi('Última parcela', brl(_incc.parcelaFinal), { sub: 'com todos os reajustes' })}</div>
        <div class="spl-sec" style="margin-top:14px">📉 Saldo devedor × valor de assunção</div><div id="spi-graf"></div>
        <div class="mut" style="font-size:11.5px;margin-top:10px;line-height:1.5"><b>Como é calculado:</b> a cada 12 meses o saldo é corrigido pelo INCC e a parcela é recalculada (saldo ÷ parcelas restantes).
          Valor de assunção = saldo do mês × (1 − desconto da faixa de parcelas restantes). Custo = taxa mensal (TIR) entre o crédito recebido e tudo o que foi pago até o mês, incluindo o valor final.</div></div>
      <details class="card spl-tab spl-tec" style="padding:14px;margin-bottom:10px"><summary>📋 Marcos do plano</summary><div id="spi-tab"></div></details>`;
    api.mesIncc(mesIni);
  };
  api.mesIncc = function (m) {
    if (!_incc) return; m = marcaMes('spi', m, _incc.linhas.length); const l = _incc.linhas[m - 1];
    const ass = Math.max(0, l.assuncao), saldo = Math.max(0, l.saldo), economia = saldo - ass;
    document.getElementById('spi-mesres').innerHTML = `<div class="spl-hero" style="margin-bottom:10px">
        <div class="t">Para assumir a cota no ${m}º mês</div>
        <div class="v">${brl0(ass)}</div>
        <div class="s">${l.desconto > 0 ? `Saldo devedor de ${brl0(saldo)} com <b>${pct(l.desconto, 0)} de desconto</b> — economia de ${brl0(economia)}.` : 'Nesta fase não há desconto: paga o saldo devedor integral.'}</div></div>
      <div class="spl-k">${kpi('Parcelas que faltam', l.restantes)}${kpi('Parcela atual', brl(l.parcela), { sub: l.reajuste ? '↑ reajustada pelo INCC neste mês' : '' })}</div>`;
    document.getElementById('spi-mestec').innerHTML = `<div class="spl-k">${kpi('Custo da assunção (TIR)', pct(l.custoAssuncao, 3) + ' a.m.', { cor: cor(-l.custoAssuncao), sub: l.custoAssuncao < 0 ? 'abaixo do crédito recebido' : '' })}
      ${kpi('Custo se quitar o saldo', pct(l.custoOp, 3) + ' a.m.')}${kpi('Já pago até o mês', brl0(l.pago))}</div>`;
    const txt = l.desconto > 0
      ? `Assumindo a cota no ${m}º mês, o valor fica em ${brl0(ass)}: saldo devedor de ${brl0(saldo)} com ${pct(l.desconto, 0)} de desconto (economia de ${brl0(economia)}). Restam ${l.restantes} parcelas, hoje de ${brl(l.parcela)}.`
      : `Assumindo a cota no ${m}º mês, o valor é o saldo devedor de ${brl0(ass)} (nesta fase não há desconto). Restam ${l.restantes} parcelas, hoje de ${brl(l.parcela)}.`;
    document.getElementById('spi-arg').innerHTML = caixaArg('incc', txt.replace(/(R\$\s?\d[\d.,]*\d|\d+% de desconto)/g, '<b>$1</b>'), txt);
    document.getElementById('spi-graf').innerHTML = grafico([
      { v: _incc.linhas.map(x => Math.max(0, x.saldo)), cor: '#C0484E', nome: 'Saldo devedor' },
      { v: _incc.linhas.map(x => Math.max(0, x.assuncao)), cor: '#3E8E6E', nome: 'Valor de assunção' }], m - 1, ['1º mês', _incc.linhas.length + 'º mês'], document.getElementById('spi-graf').clientWidth);
    const ls = _incc.linhas.filter(x => MARCOS_I.includes(x.mes) || x.mes === m || x.mes === _incc.linhas.length);
    document.getElementById('spi-tab').innerHTML = `<div class="spl-t"><table><thead><tr><th>Mês</th><th>Restantes</th><th>Parcela</th><th>Saldo devedor</th><th>Desconto</th><th>Valor de assunção</th><th>Custo a.m.</th></tr></thead><tbody>${ls.map(x => `<tr class="${x.mes === m ? 'on' : ''}"><td>${x.mes}º</td><td>${x.restantes}</td><td>${brl(x.parcela)}</td><td>${brl(Math.max(0, x.saldo))}</td><td>${pct(x.desconto, 0)}</td><td>${brl(Math.max(0, x.assuncao))}</td><td>${pct(x.custoAssuncao, 3)}</td></tr>`).join('')}</tbody></table></div>`;
  };

  // abre dentro do painel do simulador (chamado por abrirSimulador das telas)
  api.montar = function (id, el) {
    if (!el || el.dataset.ok) return; el.dataset.ok = '1';
    if (id === 'carta') montarCarta(el); else if (id === 'incc') montarIncc(el);
  };
})(typeof window !== 'undefined' ? window : globalThis);
