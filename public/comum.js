// Gestão Chama — funções comuns às telas do consultor e do gestor (v155)
// - Pulso: pergunta ao servidor "mudou algo?" a cada 10 s (resposta minúscula) e só recarrega quando mudou.
// - PWA/Push: registra o service worker da raiz e liga as notificações no aparelho.
// - Loteria Federal: preenche os 5 prêmios com o resultado salvo na base (ou extrai da Caixa).
(function () {
  const C = window.Chama = {};

  // ---------- PULSO ----------
  // cb: { mudou(), avisos(naoLidas), chat(qtd) } — cada um chamado só quando o valor muda
  let ultimo = null, timer = null, emCurso = false;
  C.iniciarPulso = function (cb) {
    async function bater() {
      if (document.hidden || emCurso) return;
      emCurso = true;
      try {
        const r = await fetch('/api/pulso', { cache: 'no-store' });
        if (r.status === 401) { location.href = '/login'; return; }
        const j = await r.json();
        if (!ultimo) { ultimo = j; cb.chat && cb.chat(j.chat); return; } // 1ª batida: a tela acabou de carregar tudo
        if (j.rev !== ultimo.rev && cb.mudou) cb.mudou();
        if (j.naoLidas !== ultimo.naoLidas && cb.avisos) cb.avisos(j.naoLidas);
        if (j.chat !== ultimo.chat && cb.chat) cb.chat(j.chat);
        ultimo = j;
      } catch (e) { /* sem rede: tenta na próxima */ } finally { emCurso = false; }
    }
    clearInterval(timer);
    timer = setInterval(bater, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) bater(); });
    setTimeout(bater, 1500);
  };

  // ---------- SERVICE WORKER + PUSH ----------
  const suportaPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let reg = null;
  C.registrarSW = async function () {
    if (!('serviceWorker' in navigator)) return null;
    try {
      // remove o SW antigo (/public/sw.js), que só controlava a pasta /public
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter(r => /\/public\/$/.test(r.scope)).map(r => r.unregister()));
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      return reg;
    } catch (e) { return null; }
  };
  C.pushLigado = function () { try { return localStorage.getItem('chama-push') === '1' && Notification.permission === 'granted'; } catch (e) { return false; } };
  function b64uParaBytes(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
  // silencioso=true: só renova a inscrição se a permissão já foi dada (não pergunta nada)
  C.ativarPush = async function (silencioso) {
    if (!suportaPush) { if (!silencioso) alert('Este aparelho/navegador não recebe notificações push. No iPhone: adicione o app à Tela de Início (Compartilhar › Adicionar à Tela de Início) e abra por lá.'); return false; }
    try {
      if (Notification.permission !== 'granted') {
        if (silencioso) return false;
        const p = await Notification.requestPermission();
        if (p !== 'granted') { alert('Notificações bloqueadas. Libere nas configurações do navegador para este site.'); C.renderBotaoPush(); return false; }
      }
      const r = reg || await C.registrarSW() || await navigator.serviceWorker.ready;
      const { chave } = await (await fetch('/api/push/chave')).json();
      let sub = await r.pushManager.getSubscription();
      if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uParaBytes(chave) });
      const res = await fetch('/api/push/inscrever', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inscricao: sub.toJSON() }) });
      const j = await res.json();
      if (!j.ok) throw new Error(j.erro || 'falha');
      try { localStorage.setItem('chama-push', '1'); } catch (e) {}
      C.renderBotaoPush();
      if (!silencioso && window.toast) toast('Notificações ativadas neste aparelho ✓');
      return true;
    } catch (e) {
      if (!silencioso) alert('Não consegui ativar as notificações: ' + (e.message || e));
      return false;
    }
  };
  C.desativarPush = async function () {
    try {
      const r = reg || await navigator.serviceWorker.getRegistration('/');
      const sub = r && await r.pushManager.getSubscription();
      if (sub) { await fetch('/api/push/cancelar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
    } catch (e) {}
    try { localStorage.removeItem('chama-push'); } catch (e) {}
    C.renderBotaoPush();
    if (window.toast) toast('Notificações desligadas neste aparelho');
  };
  // botão dentro do painel 🔔 (div#push-cta)
  C.renderBotaoPush = function () {
    const alvos = document.querySelectorAll('#push-cta,.push-cta'); if (!alvos.length) return;
    const el = { set innerHTML(v) { alvos.forEach(x => { x.innerHTML = v; }); } };
    if (!suportaPush) { el.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:8px">📱 No iPhone, adicione o app à Tela de Início para receber notificações.</div>'; return; }
    if (C.pushLigado()) el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:8px"><span style="color:var(--ok)">✓ Notificações ativas neste aparelho</span><button class="btn sec2" style="padding:4px 8px;font-size:11px" onclick="Chama.desativarPush()">Desligar</button></div>';
    else if (Notification.permission === 'denied') el.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:8px">🔕 Notificações bloqueadas no navegador — libere nas configurações do site.</div>';
    else el.innerHTML = '<button class="btn full" style="margin-bottom:10px;padding:9px" onclick="Chama.ativarPush()">🔔 Ativar notificações neste aparelho</button>';
  };
  C.iniciarPWA = async function () {
    await C.registrarSW();
    C.renderBotaoPush();
    if (C.pushLigado()) C.ativarPush(true); // renova a inscrição no servidor (pode ter expirado)
  };

  // ---------- LOTERIA FEDERAL ----------
  function preencher(classe, res) {
    const ins = [...document.querySelectorAll('.' + classe)];
    (res.premios || []).slice(0, 5).forEach((n, i) => { if (ins[i]) ins[i].value = String(n).replace(/\D/g, '').slice(-5); });
  }
  function info(elId, res, msg) {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = res ? `<span style="color:var(--ok)">✓ Concurso <b>${res.concurso}</b> de ${res.data}</span>${res.extraidoPor ? ' <span class="mut">· extraído por ' + String(res.extraidoPor).replace(/[<>&"]/g, '') + '</span>' : ''}${msg ? '<br><span class="mut">' + msg + '</span>' : ''}` : (msg ? '<span class="mut">' + msg + '</span>' : '');
  }
  // ao abrir o sorteio: usa o que já está salvo na base (não consulta a Caixa)
  C.carregarLoteria = async function (classe, elId) {
    try { const j = await (await fetch('/api/loteria/federal')).json(); if (j.resultado) { preencher(classe, j.resultado); info(elId, j.resultado, ''); } } catch (e) {}
  };
  C.extrairLoteria = async function (classe, elId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Extraindo…'; }
    try {
      const j = await (await fetch('/api/loteria/federal', { method: 'POST' })).json();
      if (j.resultado) preencher(classe, j.resultado);
      info(elId, j.resultado, j.erro || j.msg || '');
      if (window.toast) toast(j.erro ? j.erro : (j.novo ? 'Números salvos para todos ✓' : 'Números preenchidos ✓'));
    } catch (e) { if (window.toast) toast('Sem conexão — digite os números'); }
    if (btn) { btn.disabled = false; btn.textContent = '📥 Extrair números da Loteria'; }
  };
  // ---------- FICHA DO CLIENTE (contato, observações, lembrete de retorno) ----------
  const e = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  C.fichaHTML = function () { return '<div id="ficha-cli" class="card" style="padding:10px 12px;margin:10px 0"><div class="mut" style="font-size:12px">Carregando contato…</div></div>'; };
  C.carregarFicha = async function (cpf, nome) {
    C._ficha = { cpf: cpf || '', nome: nome || '' };
    const el = document.getElementById('ficha-cli'); if (!el) return;
    let f = {};
    try { f = await (await fetch('/api/clientes/ficha?cpf=' + encodeURIComponent(cpf || '') + '&nome=' + encodeURIComponent(nome || ''))).json(); } catch (x) {}
    if (f.erro) { el.innerHTML = '<div class="mut" style="font-size:12px">' + e(f.erro) + '</div>'; return; }
    const inp = 'width:100%;padding:9px;border:1px solid var(--bord);border-radius:10px;font-size:14px;background:var(--bg);box-sizing:border-box;margin-bottom:6px;font-family:inherit';
    const amanha = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const tel = String(f.telefone || '').replace(/\D/g, '');
    el.innerHTML = '<div style="font-weight:700;font-size:13px;margin-bottom:6px">📇 Contato e anotações</div>'
      + '<input id="fc-tel" inputmode="tel" placeholder="Telefone / WhatsApp" value="' + e(f.telefone) + '" style="' + inp + '">'
      + '<input id="fc-email" inputmode="email" placeholder="E-mail" value="' + e(f.email) + '" style="' + inp + '">'
      + '<textarea id="fc-obs" rows="3" placeholder="Observações (preferências, histórico da conversa…)" style="' + inp + ';resize:vertical">' + e(f.obs) + '</textarea>'
      + '<div style="display:flex;gap:6px"><button class="btn" style="flex:2;padding:9px" onclick="Chama.salvarFicha()">Salvar contato</button>'
      + (tel ? '<a class="btn sec2" style="flex:1;padding:9px;text-align:center;text-decoration:none" target="_blank" rel="noopener" href="https://wa.me/' + (tel.length <= 11 ? '55' + tel : tel) + '">WhatsApp</a>' : '') + '</div>'
      + '<div style="font-weight:700;font-size:13px;margin:12px 0 6px">📅 Lembrete de retorno</div>'
      + '<div style="display:flex;gap:6px"><input type="date" id="fc-data" value="' + amanha + '" style="' + inp + ';flex:1;margin:0"><button class="btn sec2" style="padding:9px 12px" onclick="Chama.agendarRetorno()">Agendar</button></div>'
      + '<div class="mut" style="font-size:11px;margin-top:4px">Vira uma atividade sua com prazo nessa data.</div>'
      + (f.atualizadoEm ? '<div class="mut" style="font-size:10px;margin-top:6px">Atualizado ' + new Date(f.atualizadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) + (f.atualizadoPor ? ' por ' + e(f.atualizadoPor) : '') + '</div>' : '');
  };
  C.salvarFicha = async function () {
    const b = { ...C._ficha, telefone: document.getElementById('fc-tel').value, email: document.getElementById('fc-email').value, obs: document.getElementById('fc-obs').value };
    const j = await (await fetch('/api/clientes/ficha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
    if (window.toast) toast(j.ok ? 'Contato salvo ✓' : (j.erro || 'Erro'));
    if (j.ok) C.carregarFicha(C._ficha.cpf, C._ficha.nome);
  };
  C.agendarRetorno = async function () {
    const prazo = document.getElementById('fc-data').value;
    const j = await (await fetch('/api/atividade/propria', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'Retorno: ' + (C._ficha.nome || 'cliente'), prazo, tipo: 'Retorno' }) })).json();
    if (window.toast) toast(j.ok ? 'Retorno agendado para ' + prazo.split('-').reverse().join('/') + ' ✓' : (j.erro || 'Erro'));
  };
  C.exportarClientes = function () { const a = document.createElement('a'); a.href = '/api/clientes/export'; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); if (window.toast) toast('Gerando planilha… ⬇️'); };
  // ---------- FOGO DO MURAL — v161 (chama animada do pódio retirada a pedido) ----------
  (function estilosFogo() {
    const css = '.fogo-lado{display:inline-block;flex:none;font-size:18px;line-height:1;transform-origin:50% 100%;animation:chmL .7s ease-in-out infinite alternate}'
      + '@keyframes chmL{from{transform:scale(1,.92) rotate(-4deg)}to{transform:scale(.95,1.1) rotate(4deg)}}'
      + '@media (prefers-reduced-motion:reduce){.fogo-lado{animation:none}}';
    const st = document.createElement('style'); st.id = 'chama-css'; st.textContent = css; document.head.appendChild(st);
  })();
  // pódio: só a foto, sem chama
  C.chamaHTML = function (inner) { return inner; };
  // ================= CASCA DAS TELAS (v158) =================
  // Menu (barra de baixo no celular / lateral no computador), atalhos personalizáveis, "Mais" e "Meu perfil".
  // Cada página informa o CATÁLOGO dos seus recursos; o usuário escolhe os favoritos (⭐) e a ordem (▲▼).
  // Favoritos ficam salvos no servidor por pessoa (valem em qualquer aparelho).
  const escH = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let CAT = [], MAPA = {}, PADRAO = [], INICIO = null, BADGE = () => '', FAV = null;
  const MAX_FAV = 8, NA_BARRA = 3;
  (function estilosCasca() {
    const css = ''
      + '.nav .so-desk{display:none}.btn.full{width:100%}'
      + '.nav a{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.lnk{border:none;background:transparent;color:var(--acc);font-size:13px;font-weight:600;cursor:pointer;padding:4px 0}'
      + '.atl{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:4px 0 12px}'
      + '.atl .it{position:relative;background:var(--card);border:1px solid var(--bord);border-radius:14px;padding:12px 6px;text-align:center;cursor:pointer;font-size:12px;font-weight:600;color:var(--txt)}'
      + '.atl .it .e{display:block;font-size:24px;line-height:1.2;margin-bottom:3px}'
      + '.atl .it .bd{position:absolute;top:5px;right:6px;background:var(--acc);color:#fff;border-radius:99px;font-size:10px;padding:0 6px;line-height:16px}'
      + '.atl .it:active{transform:scale(.97)}'
      + '.pers-li{display:flex;align-items:center;gap:8px;padding:8px 4px;border-top:1px solid var(--bord)}'
      + '.pers-li .nm{flex:1;font-size:14px}.pers-li button{border:1px solid var(--bord);background:var(--card);border-radius:8px;width:34px;height:32px;font-size:14px;cursor:pointer}'
      + '.pers-li button:disabled{opacity:.3}.pers-li .st{border:none;background:transparent;font-size:20px;width:30px}'
      + '.tag-barra{font-size:10px;background:var(--accbg);color:var(--acc);border-radius:6px;padding:1px 6px}'
      + '.chips-linha{display:flex;gap:6px;overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px;margin-bottom:10px;scrollbar-width:none}'
      + '.chips-linha::-webkit-scrollbar{display:none}.chips-linha>*{flex:none}'
      + '.hoje{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:6px}'
      + '.hoje .cd{background:var(--card);border:1px solid var(--bord);border-radius:16px;padding:12px 14px;cursor:pointer}'
      + '.hoje .cd .t{font-size:12px;color:var(--mut);margin-bottom:4px}.hoje .cd .v{font-size:18px;font-weight:700}'
      + '.hoje .cd.esc{background:#1B1D22;color:#fff;border-color:#1B1D22}.hoje .cd.esc .t{color:#B8BCC6}'
      + '.hoje .br{height:7px;border-radius:7px;background:rgba(127,127,127,.18);overflow:hidden;margin-top:8px}.hoje .br>div{height:100%;border-radius:7px}'
      + '.hoje .ln{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:7px 0;border-top:1px solid var(--bord)}'
      + '.hoje .ln:first-of-type{border-top:none}.hoje .pl{background:var(--acc);color:#fff;border-radius:99px;font-size:11px;padding:1px 8px;font-weight:700}'
      // ---- COMPUTADOR: menu lateral fixo + conteúdo centralizado e em colunas ----
      + '@media (min-width:900px){'
      + 'body{padding-left:236px!important;padding-bottom:30px!important}'
      + '.nav{top:0;bottom:0;left:0;right:auto;width:224px;flex-direction:column;justify-content:flex-start;align-items:stretch;border-top:none;border-right:1px solid var(--bord);padding:16px 10px;gap:2px;overflow-y:auto;z-index:50}'
      + '.nav .so-desk{display:flex}.nav .so-mob{display:none!important}'
      + '.nav a{flex:none;display:flex;align-items:center;gap:10px;font-size:14px;text-align:left;padding:9px 12px;border-radius:10px;color:var(--txt)}'
      + '.nav a:hover{background:var(--card2)}.nav a.on{background:var(--accbg);color:var(--acc);font-weight:600}'
      + '.nav .ic{font-size:18px!important;display:inline-block!important;width:24px;text-align:center}'
      + '.nav .nv-tit{font-size:11px;color:var(--mut);padding:14px 12px 4px;font-weight:600;letter-spacing:.3px}'
      + '.nav .nv-marca{font-size:16px;font-weight:800;color:var(--acc);padding:4px 12px 10px}'
      + '.top,.aba{max-width:1080px;margin-left:auto;margin-right:auto}'
      + '.hoje{grid-template-columns:1fr 1fr}.hoje .larga{grid-column:1/-1}'
      + '.atl{grid-template-columns:repeat(6,1fr)}'
      + '.gamif{display:none!important}'
      + '#chat-fab{bottom:24px!important}#chat-box{bottom:92px!important}'
      + '#modal>div{max-width:560px!important}'
      + '.desk-2{display:grid!important;grid-template-columns:1fr 1fr;gap:12px;align-items:start}'
      + '}';
    const st = document.createElement('style'); st.id = 'casca-css'; st.textContent = css; document.head.appendChild(st);
  })();
  function favoritos() {
    const f = (FAV || PADRAO).filter(id => MAPA[id]);
    return f.length ? f : PADRAO.filter(id => MAPA[id]);
  }
  // cfg: { catalogo:[{id,ic,nome,curto?,aba?,abrir()}], padrao:[ids], inicio:{ic,nome,aba,abrir}, badge:(id)=>'' }
  C.iniciarCasca = function (cfg) {
    CAT = cfg.catalogo; MAPA = {}; CAT.forEach(r => { MAPA[r.id] = r; });
    PADRAO = cfg.padrao; INICIO = cfg.inicio; BADGE = cfg.badge || (() => '');
    // cópia local só para abrir rápido; quem manda é o servidor (atalhos de QUEM está logado)
    try { const c = JSON.parse(localStorage.getItem(CHAVE_LOCAL()) || 'null'); if (Array.isArray(c)) FAV = c; } catch (e) {}
    C.renderNav();
    fetch('/api/preferencias').then(r => r.json()).then(j => {
      if (!j || j.erro) return;
      FAV = Array.isArray(j.atalhos) ? j.atalhos : null; // null = ainda não personalizou → padrão
      try { if (FAV) localStorage.setItem(CHAVE_LOCAL(), JSON.stringify(FAV)); else localStorage.removeItem(CHAVE_LOCAL()); } catch (e) {}
      C.atualizarCasca();
    }).catch(() => {});
  };
  C.abrir = function (id) { const r = MAPA[id]; if (r) r.abrir(); };
  const CHAVE_LOCAL = () => 'chama-atalhos:' + location.pathname; // separado por tela (/app, /gestor)
  const itemNav = (r, cls, acao) => '<a href="#" class="' + cls + '" data-aba="' + escH(r.aba || '') + '" onclick="' + acao + ';return false" title="' + escH(r.nome) + '"><span class="ic">' + r.ic + '</span>' + escH(r.curto || r.nome) + '</a>';
  C.renderNav = function () {
    const nav = document.querySelector('.nav'); if (!nav || !INICIO) return;
    const fav = favoritos();
    const atual = (document.querySelector('.aba.on') || {}).id || '';
    let h = '<div class="so-desk nv-marca">🔥 Gestão Chama</div>';
    h += itemNav(INICIO, '', "Chama.abrirInicio()");
    fav.forEach((id, i) => { h += itemNav(MAPA[id], i < NA_BARRA ? '' : 'so-desk', "Chama.abrir('" + id + "')"); });
    h += itemNav({ ic: '☰', nome: 'Mais', aba: 'mais' }, 'so-mob', "Chama.abrirMais()");
    const resto = CAT.filter(r => !fav.includes(r.id));
    if (resto.length) h += '<div class="so-desk nv-tit">OUTROS</div>' + resto.map(r => itemNav(r, 'so-desk', "Chama.abrir('" + r.id + "')")).join('');
    h += '<div class="so-desk nv-tit">&nbsp;</div>' + itemNav({ ic: '✏️', nome: 'Personalizar menu', aba: '' }, 'so-desk', 'Chama.personalizar()');
    nav.innerHTML = h;
    const ab = atual.replace(/^aba-/, '');
    nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', !!ab && a.dataset.aba === ab));
  };
  C.abrirInicio = function () { INICIO.abrir(); };
  C.renderAtalhos = function (elId) {
    const el = document.getElementById(elId); if (!el) return;
    const fav = favoritos();
    el.innerHTML = fav.length ? '<div class="atl">' + fav.map(id => { const r = MAPA[id]; const b = BADGE(id); return '<div class="it" onclick="Chama.abrir(\'' + id + '\')">' + (b ? '<span class="bd">' + escH(b) + '</span>' : '') + '<span class="e">' + r.ic + '</span>' + escH(r.nome) + '</div>'; }).join('') + '</div>'
      : '<div class="mut" style="font-size:13px;padding:6px 2px 12px">Nenhum atalho escolhido. Toque em ✏️ Personalizar.</div>';
  };
  C.renderMais = function (elId) {
    const el = document.getElementById(elId); if (!el) return;
    el.innerHTML = '<div class="atl">' + CAT.map(r => { const b = BADGE(r.id); return '<div class="it" onclick="Chama.abrir(\'' + r.id + '\')">' + (b ? '<span class="bd">' + escH(b) + '</span>' : '') + '<span class="e">' + r.ic + '</span>' + escH(r.nome) + '</div>'; }).join('') + '</div>';
  };
  C.abrirMais = function () { if (window.irAba) irAba('mais'); C.renderMais('mais-grid'); };
  C.atualizarCasca = function () { C.renderNav(); C.renderAtalhos('atalhos-home'); if (document.getElementById('aba-mais') && document.getElementById('aba-mais').classList.contains('on')) C.renderMais('mais-grid'); };
  // ---- editor de atalhos: ⭐ escolhe, ▲▼ muda a ordem (fácil no celular, sem arrastar) ----
  let TMP = [];
  C.personalizar = function () { TMP = favoritos().slice(); desenharPers(); };
  function desenharPers() {
    const outros = CAT.filter(r => !TMP.includes(r.id));
    const temInicio = !!document.getElementById('atalhos-home');
    let h = '<div class="mut" style="font-size:12px;margin-bottom:8px">Marque ⭐ o que você mais usa (até ' + MAX_FAV + ') e ajuste a ordem com ▲▼. Os <b>3 primeiros</b> ficam na barra de baixo do celular; no computador, todos ficam no topo do menu lateral' + (temInicio ? ' e nos atalhos do Início' : '') + '.</div>';
    h += '<div style="font-weight:700;font-size:13px;margin:6px 0 2px">⭐ Meus atalhos</div>';
    h += TMP.length ? TMP.map((id, i) => { const r = MAPA[id]; return '<div class="pers-li"><button class="st" title="Tirar dos atalhos" onclick="Chama._persTog(\'' + id + '\')">⭐</button><span class="nm">' + r.ic + ' ' + escH(r.nome) + (i < NA_BARRA ? ' <span class="tag-barra">barra</span>' : '') + '</span><button ' + (i === 0 ? 'disabled' : '') + ' onclick="Chama._persMov(' + i + ',-1)" aria-label="Subir">▲</button><button ' + (i === TMP.length - 1 ? 'disabled' : '') + ' onclick="Chama._persMov(' + i + ',1)" aria-label="Descer">▼</button></div>'; }).join('')
      : '<div class="mut" style="font-size:12px;padding:6px 4px">Nenhum ainda — marque abaixo.</div>';
    if (outros.length) h += '<div style="font-weight:700;font-size:13px;margin:14px 0 2px">Outros recursos</div>' + outros.map(r => '<div class="pers-li"><button class="st" title="Adicionar aos atalhos" onclick="Chama._persTog(\'' + r.id + '\')">☆</button><span class="nm">' + r.ic + ' ' + escH(r.nome) + '</span></div>').join('');
    h += '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn sec2" style="flex:1" onclick="Chama._persPadrao()">Restaurar padrão</button><button class="btn" style="flex:2" onclick="Chama._persSalvar()">Salvar</button></div>';
    if (window.abrirPop) abrirPop('✏️ Personalizar atalhos', h);
  }
  C._persTog = function (id) {
    const i = TMP.indexOf(id);
    if (i >= 0) TMP.splice(i, 1);
    else if (TMP.length >= MAX_FAV) { if (window.toast) toast('Máximo de ' + MAX_FAV + ' atalhos'); return; }
    else TMP.push(id);
    desenharPers();
  };
  C._persMov = function (i, d) { const j = i + d; if (j < 0 || j >= TMP.length) return; const x = TMP[i]; TMP[i] = TMP[j]; TMP[j] = x; desenharPers(); };
  C._persPadrao = function () { TMP = PADRAO.slice(); desenharPers(); };
  C._persSalvar = async function () {
    FAV = TMP.slice();
    try { localStorage.setItem(CHAVE_LOCAL(), JSON.stringify(FAV)); } catch (e) {}
    try { const r = await fetch('/api/preferencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ atalhos: FAV }) }); const j = await r.json(); if (!j.ok) throw new Error(j.erro || 'erro'); }
    catch (e) { if (window.toast) toast('Salvo neste aparelho (sem conexão com o servidor)'); }
    if (window.fecharPop) fecharPop();
    C.atualizarCasca();
    if (window.toast) toast('Atalhos salvos ✓');
  };
  // ---- menu "Meu perfil" (toque na foto do topo) ----
  // extras: [{ic,nome,acao}] (ex.: Configurações do gestor)
  C.abrirPerfil = function (info, extras) {
    const i = info || {};
    const foto = i.foto ? '<div style="width:52px;height:52px;border-radius:50%;background:url(\'' + String(i.foto).replace(/['"\\()]/g, '') + '\') center/cover;flex:none"></div>' : '<div class="avatar" style="width:52px;height:52px;font-size:16px;flex:none">' + escH(String(i.nome || '?').slice(0, 2).toUpperCase()) + '</div>';
    const bt = (ic, nome, acao, cor) => '<button class="btn sec2" style="width:100%;margin-bottom:8px;text-align:left;padding:11px 14px;' + (cor ? 'color:' + cor : '') + '" onclick="' + acao + '">' + ic + ' ' + escH(nome) + '</button>';
    let h = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' + foto + '<div><div style="font-weight:700;font-size:16px">' + escH(i.nome || '') + '</div><div class="mut" style="font-size:12px">' + escH(i.sub || '') + '</div></div></div>';
    h += '<div class="push-cta"></div>';
    (extras || []).forEach(x => { h += bt(x.ic, x.nome, 'fecharPop();' + x.acao); });
    h += bt('📷', 'Trocar minha foto', "document.getElementById('minha-foto-file').click()");
    h += bt('🔑', 'Trocar minha senha', 'Chama.abrirSenha()');
    h += bt('✏️', 'Personalizar meus atalhos', 'Chama.personalizar()');
    h += bt('🚪', 'Sair', 'sair()', 'var(--no)');
    if (window.abrirPop) abrirPop('👤 Meu perfil', h);
    C.renderBotaoPush();
  };
  // trocar a própria senha (igual para consultor e gestor)
  C.abrirSenha = function () {
    const inp = 'padding:11px;border:1px solid var(--bord);border-radius:10px;font-size:14px';
    if (window.abrirPop) abrirPop('🔑 Trocar minha senha', '<div style="display:flex;flex-direction:column;gap:10px"><input id="sn-atual" type="password" placeholder="Senha atual" autocomplete="current-password" style="' + inp + '"><input id="sn-nova" type="password" placeholder="Nova senha (mín. 4 caracteres)" autocomplete="new-password" style="' + inp + '"><input id="sn-conf" type="password" placeholder="Confirmar nova senha" autocomplete="new-password" style="' + inp + '"><div id="sn-erro" style="display:none;color:var(--no);font-size:13px"></div><button class="btn full" onclick="Chama._salvarSenha()">Salvar nova senha</button></div>');
  };
  C._salvarSenha = async function () {
    const g = id => document.getElementById(id).value, err = document.getElementById('sn-erro');
    const mostra = m => { err.textContent = m; err.style.display = 'block'; };
    if (!g('sn-atual') || !g('sn-nova')) return mostra('Preencha a senha atual e a nova.');
    if (g('sn-nova').length < 4) return mostra('A nova senha precisa ter pelo menos 4 caracteres.');
    if (g('sn-nova') !== g('sn-conf')) return mostra('A confirmação não bate com a nova senha.');
    const j = await (await fetch('/api/senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ atual: g('sn-atual'), nova: g('sn-nova') }) })).json();
    if (j.ok) { if (window.fecharPop) fecharPop(); if (window.toast) toast('Senha alterada ✓'); } else mostra(j.erro || 'Não foi possível trocar a senha.');
  };
  // data de hoje no fuso de Brasília (YYYY-MM-DD) — evita "virar o dia" às 21h
  C.hojeBR = function () { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); };
})();
