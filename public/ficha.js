/* Ficha completa do consultor (v176) — desenhos em vetor (SVG), sem bibliotecas.
 * Chama.fichaVisual(p, { modo: 'gestor' | 'eu' }) devolve o HTML. p = resposta de /api/gestor/consultor ou /api/minha-ficha.
 * modo 'eu' = o próprio consultor: sem os atalhos de gestor e com o toque motivacional (ranking, 🔥). */
(function () {
  'use strict';
  const C = window.Chama = window.Chama || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NIV = { dono: ['#111318', 'Dono de loja'], socio: ['gradpc', 'Sócio de loja'], gestorLoja: ['#9CA3AF', 'Gestor de loja'], gestorEquipe: ['#A78BFA', 'Gestor de equipe'], supervisor: ['#FB923C', 'Supervisor'], consultor: ['#E23B3B', 'Consultor'] };
  const corN = n => { const c = (NIV[n] || NIV.consultor)[0]; return c === 'gradpc' ? '#4B5563' : c; };
  const nomeN = n => (NIV[n] || NIV.consultor)[1];
  const curto = v => { v = +v || 0; const a = Math.abs(v); return a >= 1e6 ? 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : a >= 1e3 ? 'R$ ' + Math.round(v / 1e3) + ' mil' : 'R$ ' + Math.round(v); };
  const brl = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  const corP = p => p >= 70 ? '#1D9E75' : p >= 40 ? '#EF9F27' : '#E24B4A';

  (function css() {
    if (document.getElementById('ficha-css')) return;
    const st = document.createElement('style'); st.id = 'ficha-css';
    st.textContent = '.fx{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}@media(min-width:560px){.fx{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(min-width:980px){.fx{grid-template-columns:repeat(3,minmax(0,1fr))}}'
      + '.fx-c{background:var(--card);border:1px solid var(--bord);border-radius:16px;padding:12px 13px;min-width:0;position:relative}'
      + '.fx-c.lk{cursor:pointer}.fx-c.lk:active{transform:scale(.99)}'
      + '.fx-t{font-size:11.5px;color:var(--mut);display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-weight:600}.fx-t span{font-weight:500;font-size:11px}'
      + '.fx-s{font-size:11px;color:var(--mut);line-height:1.45}'
      + '.fx-chips{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.fx-chips button{font-size:12.5px;padding:7px 12px;border-radius:999px;border:1px solid var(--bord);background:var(--card);cursor:pointer;color:var(--txt)}'
      // anéis/medidores "enchem" ao abrir (CSS puro)
      + '.fx-an{animation:fxEncher .9s ease-out both}@keyframes fxEncher{from{stroke-dashoffset:var(--de)}}'
      + '.fx-br{transform-origin:50% 100%;animation:fxBarra .7s ease-out both}@keyframes fxBarra{from{transform:scaleY(.05)}}'
      + '@media (prefers-reduced-motion:reduce){.fx-an,.fx-br{animation:none}}';
    document.head.appendChild(st);
  })();

  // ---- peças em vetor
  function avatar(p) {
    const n = (p.ficha && p.ficha.nivel) || 'consultor', cor = corN(n);
    const chefe = p.ficha && p.ficha.trilha && p.ficha.trilha.length > 1 ? p.ficha.trilha[p.ficha.trilha.length - 2] : null;
    const ini = esc(String(p.nome || '?').split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase());
    const foto = p.foto ? `<clipPath id="fxclip"><circle cx="34" cy="34" r="27"/></clipPath><image href="${esc(p.foto)}" x="7" y="7" width="54" height="54" clip-path="url(#fxclip)" preserveAspectRatio="xMidYMid slice"/>`
      : `<circle cx="34" cy="34" r="27" fill="${cor}22"/><text x="34" y="41" text-anchor="middle" font-size="18" font-weight="700" fill="${cor}">${ini}</text>`;
    return `<svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true" style="flex:none"><circle cx="34" cy="34" r="32" fill="none" stroke="${cor}" stroke-width="3.5"/>${foto}${chefe ? `<circle cx="56" cy="56" r="8" fill="${corN(chefe.nivel)}" stroke="#fff" stroke-width="2.5"/>` : ''}</svg>`;
  }
  function trilha(t) {
    if (!t || t.length < 2) return '';
    return `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:5px">${t.map((x, i) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:${i === t.length - 1 ? 'var(--txt)' : 'var(--mut)'};font-weight:${i === t.length - 1 ? 700 : 500}"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${corN(x.nivel)}"/></svg>${esc(String(x.nome).split(' ')[0])}</span>${i < t.length - 1 ? '<svg width="12" height="10" aria-hidden="true"><path d="M2 5h7M6 2l3 3-3 3" stroke="#B4B2A9" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>' : ''}`).join('')}</div>`;
  }
  function medidor(p) { // meta do mês em meia-lua
    const m = p.ficha.meta || {}; const L = 201;
    if (!m.valor) return `<div class="fx-t">🎯 Meta do mês</div><div style="font-size:22px;font-weight:800">${curto(m.vendido)}</div><div class="fx-s">vendidos no mês · meta ainda não definida</div>`;
    const v = Math.max(0, Math.min(100, m.pct || 0)), off = L - L * v / 100, cor = corP(m.pct || 0);
    return `<div class="fx-t">🎯 Meta do mês <span>${curto(m.valor)}</span></div>
      <svg viewBox="0 0 160 96" width="100%" height="96" aria-hidden="true"><path d="M16 86a64 64 0 0 1 128 0" fill="none" stroke="#EEF0F3" stroke-width="15" stroke-linecap="round"/>
      <path class="fx-an" style="--de:${L}" d="M16 86a64 64 0 0 1 128 0" fill="none" stroke="${cor}" stroke-width="15" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${off}"/>
      <text x="80" y="72" text-anchor="middle" font-size="25" font-weight="800" fill="currentColor">${m.pct || 0}%</text><text x="80" y="90" text-anchor="middle" font-size="11" fill="#7B828C">${curto(m.vendido)} vendidos</text></svg>`;
  }
  function checkin(p) {
    const h = p.checkinHoje || { feitas: 0, total: 0 }, L = 214, pc = pct(h.feitas, h.total), off = L - L * pc / 100;
    const dias = p.historico7d || [], mx = Math.max(1, ...dias.map(d => d.total || 0));
    const o = p.ficha.origemCheckin || {};
    const orig = o.tipo === 'pessoa' ? 'lista individual' : o.tipo === 'estrutura' ? 'lista da estrutura de ' + esc(String(o.nome || '').split(' ')[0]) : 'lista da equipe';
    const barras = dias.map((d, i) => { const hh = Math.max(3, Math.round(46 * (d.feitas || 0) / mx)); return `<rect class="fx-br" style="animation-delay:${i * 60}ms" x="${2 + i * 13}" y="${56 - hh}" width="9" height="${hh}" rx="3" fill="${i === dias.length - 1 ? '#E23B3B' : '#F4B9B9'}"/><text x="${6.5 + i * 13}" y="67" text-anchor="middle" font-size="7" fill="#7B828C">${esc((d.dia || '').slice(0, 1))}</text>`; }).join('');
    return `<div class="fx-t">✅ Check-in hoje <span>${orig}</span></div>
      <div style="display:flex;align-items:center;gap:10px"><svg width="84" height="84" viewBox="0 0 86 86" aria-hidden="true" style="flex:none"><circle cx="43" cy="43" r="34" fill="none" stroke="#EEF0F3" stroke-width="10"/>
      <circle class="fx-an" style="--de:${L}" cx="43" cy="43" r="34" fill="none" stroke="${corP(pc)}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${off}" transform="rotate(-90 43 43)"/>
      <text x="43" y="49" text-anchor="middle" font-size="18" font-weight="800" fill="currentColor">${h.feitas}/${h.total}</text></svg>
      <svg width="94" height="70" viewBox="0 0 94 70" aria-hidden="true">${barras}</svg></div>
      <div class="fx-s">Semana: ${p.execucao || 0}% da meta de execução</div>`;
  }
  function funil(p) {
    const v = p.ficha.vendas || {}, c = p.ficha.carteira || {};
    return `<div class="fx-t">💰 Vendas <span>ver ›</span></div>
      <svg viewBox="0 0 180 100" width="100%" height="100" aria-hidden="true">
      <path d="M6 6h168l-22 27H28z" fill="#FAEEDA"/><text x="90" y="24" text-anchor="middle" font-size="11.5" font-weight="600" fill="#854F0B">${v.negQtd || 0} em negociação · ${curto(v.negValor)}</text>
      <path d="M30 37h120l-18 26H48z" fill="#9FE1CB"/><text x="90" y="54" text-anchor="middle" font-size="11.5" font-weight="600" fill="#085041">${v.fechadasQtd || 0} fechada(s) no mês · ${curto(v.fechadasValor)}</text>
      <path d="M32 67h116l-14 25H46z" fill="#1D9E75"/><text x="90" y="83" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff">${c.contempladas || 0} contemplada(s)</text></svg>
      <div class="fx-s">${v.ultima ? 'Última: ' + esc(v.ultima.cliente) + ' · ' + curto(v.ultima.valor) + (v.ultima.data ? ' · ' + esc(String(v.ultima.data).split('-').reverse().slice(0, 2).join('/')) : '') : 'Nenhuma venda fechada ainda'}</div>`;
  }
  function carteira(p) {
    const c = p.ficha.carteira || {}, tot = Math.max(1, (c.contempladas || 0) + (c.ativas || 0) + (c.canceladas || 0)), L = 188.5;
    const seg = (n, cor, ini) => n ? `<circle class="fx-an" style="--de:${L}" cx="40" cy="40" r="30" fill="none" stroke="${cor}" stroke-width="12" stroke-dasharray="${L * n / tot} ${L}" stroke-dashoffset="${-L * ini / tot}" transform="rotate(-90 40 40)"/>` : '';
    return `<div class="fx-t">👥 Carteira <span>ver ›</span></div>
      <div style="display:flex;align-items:center;gap:10px"><svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true" style="flex:none"><circle cx="40" cy="40" r="30" fill="none" stroke="#EEF0F3" stroke-width="12"/>
      ${seg(c.ativas, '#5DCAA5', 0)}${seg(c.contempladas, '#7F77DD', c.ativas || 0)}${seg(c.canceladas, '#B4B2A9', (c.ativas || 0) + (c.contempladas || 0))}
      <text x="40" y="45" text-anchor="middle" font-size="16" font-weight="800" fill="currentColor">${c.cotas || 0}</text></svg>
      <div class="fx-s" style="line-height:1.75"><b style="color:var(--txt);font-size:12.5px">${c.clientes || 0} cliente(s)</b><br><span style="color:#0F6E56">● ${c.ativas || 0} ativas</span><br><span style="color:#534AB7">● ${c.contempladas || 0} contempladas</span><br><span style="color:#888780">● ${c.canceladas || 0} canceladas</span></div></div>`;
  }
  function agenda(p) {
    const at = (p.atividades && p.atividades.pendentes) || [], hoje = new Date().toISOString().slice(0, 10);
    const atras = at.filter(a => a.prazo && a.prazo < hoje).length, prox = ((p.reunioes && p.reunioes.proximas) || [])[0];
    const it = [[atras ? '#E24B4A' : '#B4B2A9', atras ? atras + ' atividade(s) atrasada(s)' : 'Nenhuma atrasada'], ['#EF9F27', prox ? 'Reunião ' + new Date(prox.inicio).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem reunião marcada'], ['#1D9E75', ((p.atividades && p.atividades.totalFeitas) || 0) + ' feita(s) · ' + at.length + ' aberta(s)']];
    return `<div class="fx-t">📝 Atividades e agenda <span>ver ›</span></div>
      <svg viewBox="0 0 190 76" width="100%" height="76" aria-hidden="true"><path d="M12 12v54" stroke="#E1E3E7" stroke-width="2"/>${it.map((x, i) => `<circle cx="12" cy="${14 + i * 24}" r="6.5" fill="${x[0]}"/><text x="26" y="${18 + i * 24}" font-size="11.5" fill="currentColor">${esc(x[1])}</text>`).join('')}</svg>`;
  }
  function comissoes(p) {
    const c = p.ficha.comissoes; if (!c) return '';
    const tot = Math.max(1, (c.recebido || 0) + (c.aReceber || 0)), w = Math.max(4, 170 * (c.recebido || 0) / tot);
    return `<div class="fx-c"><div class="fx-t">💸 Comissões <span>só p/ quem está acima</span></div>
      <svg viewBox="0 0 180 58" width="100%" height="58" aria-hidden="true"><rect x="5" y="8" width="170" height="16" rx="8" fill="#EEF0F3"/><rect x="5" y="8" width="${w}" height="16" rx="8" fill="#1D9E75"/>
      <text x="5" y="44" font-size="11.5" font-weight="600" fill="currentColor">Recebido ${curto(c.recebido)}</text><text x="175" y="44" text-anchor="end" font-size="11.5" fill="#7B828C">A receber ${curto(c.aReceber)}</text></svg></div>`;
  }
  function ranking(p, grande) {
    const r = p.ficha.ranking || {};
    const trofeu = `<svg width="${grande ? 54 : 40}" height="${grande ? 54 : 40}" viewBox="0 0 48 48" aria-hidden="true" style="flex:none"><path d="M14 6h20v10a10 10 0 0 1-20 0z" fill="#EF9F27"/><path d="M14 9H8a6 6 0 0 0 6 8M34 9h6a6 6 0 0 1-6 8" stroke="#BA7517" stroke-width="2.5" fill="none"/><rect x="21" y="25" width="6" height="9" fill="#BA7517"/><rect x="14" y="34" width="20" height="6" rx="2" fill="#854F0B"/></svg>`;
    const pos = r.posicao ? `<b style="font-size:${grande ? 26 : 20}px">${r.posicao}º</b> <span class="fx-s">de ${r.de} no mês</span>` : '<span class="fx-s">Ainda sem venda fechada no mês</span>';
    return `<div class="fx-c"><div class="fx-t">🏆 Ranking do mês</div><div style="display:flex;align-items:center;gap:10px">${trofeu}<div>${pos}${r.fogo ? '<div style="font-size:12px;margin-top:2px">🔥 Passou de R$ 1 milhão!</div>' : ''}</div></div>
      ${grande && r.posicao ? `<div class="fx-s" style="margin-top:6px">${r.posicao <= 3 ? 'Você está no pódio! Continue assim 💪' : 'Cada venda te aproxima do pódio. Bora! 🚀'}</div>` : ''}</div>`;
  }

  C.fichaVisual = function (p, o) {
    o = o || {}; const eu = o.modo === 'eu', f = p.ficha || {};
    const lk = (acao, html) => `<div class="fx-c${acao ? ' lk' : ''}"${acao ? ` onclick="${acao}"` : ''}>${html}</div>`;
    const chips = eu ? '' : `<div class="fx-chips">
      <button onclick="${o.acoes && o.acoes.mensagem || ''}">💬 Mensagem</button><button onclick="${o.acoes && o.acoes.checkin || ''}">✅ Check-in só dele(a)</button>
      <button onclick="${o.acoes && o.acoes.atividade || ''}">📝 Atividade</button><button onclick="${o.acoes && o.acoes.venda || ''}">➕ Venda</button><button onclick="${o.acoes && o.acoes.estrutura || ''}">⚙️ Estrutura</button></div>`;
    return `<div class="fx-c" style="display:flex;align-items:center;gap:13px;margin-bottom:${eu ? 10 : 0}px">${avatar(p)}<div style="min-width:0;flex:1">
        <div style="font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nome)}</div>
        <div class="fx-s">${esc(nomeN(f.nivel))}${p.time ? ' · ' + esc(p.time) : ''}</div>${trilha(f.trilha)}</div></div>
      ${chips}
      <div class="fx">
        ${eu ? ranking(p, true) : ''}
        ${lk(o.acoes && o.acoes.vendas, medidor(p))}
        ${lk(o.acoes && o.acoes.checkinVer, checkin(p))}
        ${lk(o.acoes && o.acoes.vendas, funil(p))}
        ${lk(o.acoes && o.acoes.clientes, carteira(p))}
        ${lk(o.acoes && o.acoes.atividades, agenda(p))}
        ${eu ? '' : ranking(p, false)}
        ${eu ? '' : comissoes(p)}
      </div>`;
  };
})();
