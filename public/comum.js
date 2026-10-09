// Gestão Chama — funções comuns às telas do consultor e do gestor (v155)
// - Pulso: pergunta ao servidor "mudou algo?" a cada 10 s (resposta minúscula) e só recarrega quando mudou.
// - PWA/Push: registra o service worker da raiz e liga as notificações no aparelho.
// - Loteria Federal: preenche os 5 prêmios com o resultado salvo na base (ou extrai da Caixa).
(function () {
  const C = window.Chama = {};
  // ---------- v178: VISUAL SÓBRIO (página com <body class="sobrio">) ----------
  // Mesma paleta em tons claros; emojis viram ícones de linha (public/icones.css: <i class=i-nome></i>).
  C.sobrio = function () { return !!(document.body && document.body.classList.contains('sobrio')); };
  C.E = function (emoji, icone) { return C.sobrio() ? '<i class=i-' + icone + '></i>' : emoji; };
  // tira emojis de textos que não aceitam ícone (título de janela, aviso rápido); mantém ✓ ✕ ★ ☆ ▲ ▼
  C.semEmoji = function (t) { return String(t == null ? '' : t).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B06}\u{2B07}\u{FE0F}\u{200D}]/gu, c => '✓✔✕★☆'.includes(c) ? c : '').replace(/\s{2,}/g, ' ').trim(); };

  // ---------- v178: SOM e ALERTA NA TELA (atividade/mensagem nova) ----------
  // O navegador só deixa tocar som depois que a pessoa tocar na tela uma vez — então "destrava" no 1º toque.
  let _audio = null;
  function ctxAudio() { try { if (!_audio) { const A = window.AudioContext || window.webkitAudioContext; if (A) _audio = new A(); } if (_audio && _audio.state === 'suspended') _audio.resume(); } catch (e) {} return _audio; }
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, function destravar() { ctxAudio(); }, { passive: true }));
  C.som = function () {
    const a = ctxAudio(); if (!a) return;
    try { [[880, 0], [1320, 0.17]].forEach(([f, t]) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f; const t0 = a.currentTime + t; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.28, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.42); o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + 0.45); }); } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
  };
  // janela no meio da tela: { icone, de, titulo, texto, botao, acao }
  C.alertaTela = function (o) {
    o = o || {}; const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let ov = document.getElementById('alerta-tela'); if (ov) ov.remove();
    ov = document.createElement('div'); ov.id = 'alerta-tela';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10003;background:rgba(20,22,28,.45);display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML = '<div role="alertdialog" aria-modal="true" style="background:#fff;border-radius:16px;padding:20px 18px 16px;max-width:360px;width:100%;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.25);animation:alertaEntra .22s ease-out">'
      + '<div style="width:52px;height:52px;border-radius:14px;background:#EEF4FD;color:#3E6FC4;display:grid;place-items:center;margin:0 auto 10px;font-size:26px">' + (o.icone || '') + '</div>'
      + (o.de ? '<div style="font-size:12px;color:#6B7280">' + esc(o.de) + '</div>' : '')
      + '<div style="font-size:17px;font-weight:650;color:#111318;margin:4px 0 6px;line-height:1.3">' + esc(o.titulo || '') + '</div>'
      + (o.texto ? '<div style="font-size:13.5px;color:#4B5563;line-height:1.5">' + esc(o.texto) + '</div>' : '')
      + '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn sec2" style="flex:1" data-fechar>Ok, entendi</button>' + (o.botao ? '<button class="btn" style="flex:1.4" data-acao>' + esc(o.botao) + '</button>' : '') + '</div></div>';
    if (!document.getElementById('alerta-css')) { const st = document.createElement('style'); st.id = 'alerta-css'; st.textContent = '@keyframes alertaEntra{from{transform:scale(.92);opacity:0}to{transform:none;opacity:1}}'; document.head.appendChild(st); }
    const fechar = () => ov.remove();
    ov.addEventListener('click', e => { if (e.target === ov || e.target.hasAttribute('data-fechar')) fechar(); if (e.target.hasAttribute('data-acao')) { fechar(); if (typeof o.acao === 'function') o.acao(); } });
    document.body.appendChild(ov);
    const b = ov.querySelector('[data-acao]') || ov.querySelector('[data-fechar]'); if (b) b.focus();
  };

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
    if (!suportaPush) { el.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:8px">' + C.E('📱', 'device-mobile') + ' No iPhone, adicione o app à Tela de Início para receber notificações.</div>'; return; }
    if (C.pushLigado()) el.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:8px"><span style="color:var(--ok)">✓ Notificações ativas neste aparelho</span><button class="btn sec2" style="padding:4px 8px;font-size:11px" onclick="Chama.desativarPush()">Desligar</button></div>';
    else if (Notification.permission === 'denied') el.innerHTML = '<div class="mut" style="font-size:11px;margin-bottom:8px">' + C.E('🔕', 'bell-off') + ' Notificações bloqueadas no navegador — libere nas configurações do site.</div>';
    else el.innerHTML = '<button class="btn full" style="margin-bottom:10px;padding:9px" onclick="Chama.ativarPush()">' + C.E('🔔', 'bell') + ' Ativar notificações neste aparelho</button>';
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
  // v177: cada recurso tem um quadradinho de cor suave (fácil de achar pela cor) e um grupo no "Mais"
  const TONS = { verde: ['#E1F5EE', '#0F6E56'], rosa: ['#FBEAF0', '#993556'], azul: ['#E6F1FB', '#185FA5'], roxo: ['#EEEDFE', '#534AB7'], dourado: ['#FAEEDA', '#854F0B'], coral: ['#FAECE7', '#993C1D'], cinza: ['#F1EFE8', '#5F5E5A'], vermelho: ['#FDE8EA', '#B71F2E'] };
  const TOM_DO = { vendas: 'verde', novavenda: 'verde', simuladores: 'verde', clientes: 'rosa', novocliente: 'rosa', agenda: 'azul', atividades: 'azul', novatarefa: 'azul', checkin: 'verde', novaatividade: 'coral', equipe: 'roxo', controle: 'roxo', minhaficha: 'vermelho', mural: 'dourado', ranking: 'dourado', comissoes: 'dourado', sorteio: 'dourado', config: 'cinza', arquivos: 'cinza' };
  const GRUPOS = [['Vendas e clientes', ['vendas', 'novavenda', 'clientes', 'novocliente', 'simuladores', 'sorteio']], ['Agenda e tarefas', ['agenda', 'atividades', 'novatarefa', 'novaatividade', 'checkin']], ['Equipe e gestão', ['equipe', 'controle', 'minhaficha']], ['Resultados', ['mural', 'ranking', 'comissoes']], ['Configurações e arquivos', ['config', 'arquivos']]];
  const TONS_SB = { verde: ['#ECF7F2', '#2E8A63'], rosa: ['#FCF0F4', '#A84A6D'], azul: ['#EEF4FD', '#3E6FC4'], roxo: ['#F3F1FD', '#5F55B8'], dourado: ['#FDF5E8', '#9A6A1F'], coral: ['#FDF1EC', '#B0573A'], cinza: ['#F3F4F6', '#5B616B'], vermelho: ['#FDF0F1', '#C2414B'] };
  const tom = id => (C.sobrio() ? TONS_SB : TONS)[TOM_DO[id] || 'cinza'];
  const icoDe = r => (C.sobrio() && r && r.ico) ? '<i class=i-' + r.ico + '></i>' : (r ? r.ic : ''); // v178: ícone de linha no modo sóbrio
  const quadrinho = (id, ic, tam) => { const t = tom(id); tam = tam || 38; return '<span class="qd" style="width:' + tam + 'px;height:' + tam + 'px;background:' + t[0] + ';color:' + t[1] + ';font-size:' + Math.round(tam * .52) + 'px">' + ic + '</span>'; };
  // ===== v177: TEMA do site (mesmo padrão da ficha) — claro, cartões brancos, cores suaves, toques grandes =====
  const TEMA = ''
    + ':root{--bg:#F4F5F8;--card2:#F4F5F8;--bord:#E9ECF0}'
    + 'body{background:var(--bg)!important;-webkit-font-smoothing:antialiased}'
    + '.card{border-radius:18px!important;border:1px solid var(--bord)!important;box-shadow:0 1px 2px rgba(16,24,40,.04)!important}'
    + '.h{font-size:14.5px!important;font-weight:750!important;color:#2A2F38!important;margin:18px 0 9px!important;letter-spacing:-.1px}'
    + '.top{padding-top:16px!important}.top .nome{font-size:20px!important;font-weight:800!important;letter-spacing:-.3px}'
    + '.btn{background:var(--acc)!important;border-radius:12px!important;min-height:38px;transition:transform .08s}.btn:active{transform:scale(.97)}'
    + '.btn.sec2{background:#fff!important;border:1px solid var(--bord)!important;color:var(--txt)!important}'
    + '.btn.no{background:#fff!important}'
    + 'input[type=text],input[type=search],input[type=number],input[type=date],input[type=time],input[type=email],input[type=password],input[type=tel],select,textarea{background-color:#fff!important;border:1px solid #E1E4E8!important;border-radius:12px!important;font-size:15px}'
    + 'input[type=text],input[type=search],input[type=number],input[type=date],input[type=time],input[type=email],input[type=password],input[type=tel],select{min-height:42px}'
    + '.spl-in input,.spl-faixas .spl-in input{background:transparent!important;border:0!important;min-height:0}'
    + '.chip{border-radius:999px!important;padding:7px 14px!important;background:#fff;border-color:var(--bord)!important}.chip.on{background:var(--acc)!important;border-color:var(--acc)!important;color:#fff!important}'
    + '.kpi{background:#fff!important;border:1px solid var(--bord)!important;border-radius:16px!important;padding:12px!important}.kpi .v{font-weight:800!important}'
    + '.badge{font-weight:600}.hoje .badge{white-space:normal;display:inline-block;line-height:1.35}'
    + 'table th{color:var(--mut);font-weight:600}'
    + '.qd{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;flex:none;line-height:1}'
    + '.atl .it{border-radius:18px!important;padding:12px 6px 10px!important;display:flex;flex-direction:column;align-items:center;gap:6px;font-weight:600!important;box-shadow:0 1px 2px rgba(16,24,40,.04)}'
    + '.atl .it .nm{font-size:12px;line-height:1.2}'
    + '.mais-busca{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--bord);border-radius:14px;padding:0 12px;margin:4px 0 12px}.mais-busca input{border:0!important;flex:1;min-height:44px!important;outline:0;background:transparent!important;font-size:15px}'
    + '.mais-sec{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:700;color:#2A2F38;margin:6px 2px 6px}'
    + '#chat-fab{width:50px!important;height:50px!important;font-size:21px!important;transition:transform .25s,opacity .25s}#chat-fab.fab-some{transform:translateY(150%);opacity:0}'
    + '#modal>div{border-radius:22px!important}'
    + '.hoje .cd{border-radius:18px!important;border:1px solid var(--bord)!important;box-shadow:0 1px 2px rgba(16,24,40,.04);padding:13px 14px!important}'
    + '.hoje .cd.esc{background:#fff!important;color:var(--txt)!important}.hoje .cd .t{font-size:12.5px!important;font-weight:650;color:var(--mut)!important;margin-bottom:6px!important}'
    // barra de baixo (celular): ícone grande, item aberto destacado, respeita a barrinha do iPhone
    + '@media (max-width:899px){.nav{padding:6px 4px calc(10px + env(safe-area-inset-bottom))!important;box-shadow:0 -2px 12px rgba(16,24,40,.06);border-top:1px solid var(--bord)}'
    + '.nav a{font-size:10.5px!important;font-weight:600;color:#8A919C!important;padding-top:2px}.nav a .ic{font-size:22px!important;display:block;margin:0 auto 1px;width:46px;border-radius:14px;padding:2px 0}'
    + '.nav a.on{color:var(--acc)!important;background:transparent!important}.nav a.on .ic{background:var(--accbg)}.nav .qd{display:none!important}}'
    // menu lateral (computador): quadradinho colorido por recurso
    + '@media (min-width:900px){.nav{background:#fff!important}.nav a .ic{display:none!important}.nav a .qd{display:inline-flex!important;font-size:16px}.nav a{padding:6px 10px!important;border-radius:12px!important;font-weight:550}'
    + '.nav a.on{background:var(--accbg)!important}.nav a.sem-qd .ic{display:inline-block!important;width:30px;text-align:center}}';
  // ===== v178: TEMA SÓBRIO (body.sobrio) — sério, tons claros, cantos menores, sem sombras =====
  const TEMA_SOBRIO = ''
    + 'body.sobrio{--bg:#F7F8FA;--card2:#F3F4F6;--bord:#E8EAEE;--txt:#1F2328;--mut:#6B7280;--accbg:rgba(214,40,57,.07);--okbg:#ECF7F2;--ok:#2E8A63;--warnbg:#FDF5E8;--warn:#9A6A1F;--nobg:#FDF0F1;--no:#C2414B;background:#F7F8FA!important;color:#1F2328}'
    + '.sobrio .card{border-radius:12px!important;box-shadow:none!important}'
    + '.sobrio .h{font-size:13.5px!important;font-weight:600!important;color:#374151!important;margin:16px 0 8px!important}'
    + '.sobrio .h i[class^=i-],.sobrio .titulo i[class^=i-]{color:#8A9099}'
    + '.sobrio .titulo{font-weight:600}.sobrio .top .nome{font-size:18px!important;font-weight:650!important;letter-spacing:-.2px}'
    + '.sobrio .btn{border-radius:8px!important;font-weight:550!important;min-height:36px}.sobrio .btn.sec2{border-color:#DDE1E6!important;color:#1F2328!important}.sobrio .btn i[class^=i-]{vertical-align:-.22em}'
    + '.sobrio .btn.no{border-color:#F3C4C8!important}'
    + '.sobrio .chip{border-radius:8px!important;padding:6px 12px!important;font-size:13px;color:#374151;border-color:#DDE1E6!important}.sobrio .chip.on{background:#FDF0F1!important;border-color:#F3C4C8!important;color:#C2414B!important;font-weight:600}'
    + '.sobrio .chip i[class^=i-]{vertical-align:-.22em}'
    + '.sobrio .badge{border-radius:6px!important;font-weight:500!important}'
    + '.sobrio input[type=text],.sobrio input[type=search],.sobrio input[type=number],.sobrio input[type=date],.sobrio input[type=time],.sobrio input[type=email],.sobrio input[type=password],.sobrio input[type=tel],.sobrio input[type=month],.sobrio input[type=datetime-local],.sobrio select,.sobrio textarea{border-radius:8px!important;border-color:#DDE1E6!important}'
    + '.sobrio .kpi{border-radius:12px!important}.sobrio .kpi .v{font-weight:650!important}'
    + '.sobrio #modal>div{border-radius:14px!important}.sobrio .toast{border-radius:10px!important}'
    + '.sobrio .hoje .cd{border-radius:12px!important;box-shadow:none!important}.sobrio .hoje .cd .t{font-size:12.5px!important;font-weight:600!important;color:#4B5563!important;display:flex;align-items:center;gap:6px}.sobrio .hoje .cd .t i[class^=i-]{color:#8A9099}'
    + '.sobrio .atl .it{border-radius:12px!important;box-shadow:none!important;font-weight:550!important}.sobrio .mais-busca{border-radius:10px}.sobrio .mais-busca i{color:#8A9099}'
    + '.sobrio .mais-sec{font-weight:600;color:#374151}.sobrio .mais-sec i{color:#8A9099}'
    + '.sobrio .qd{border-radius:8px!important}'
    + '.sobrio #chat-fab{box-shadow:0 4px 14px rgba(16,24,40,.18)!important}'
    + '.sobrio .seg{display:flex;background:#ECEEF1;border-radius:10px;padding:3px;gap:2px;margin:2px 0 12px}.sobrio .seg button{flex:1;border:0;background:transparent;border-radius:8px;padding:8px 6px;font-size:13px;color:#4B5563;cursor:pointer;font-family:inherit}.sobrio .seg button.on{background:#fff;color:#111318;font-weight:600;box-shadow:0 1px 2px rgba(16,24,40,.08)}'
    + '@media (max-width:899px){.sobrio .nav a .ic{font-size:21px!important}.sobrio .nav a.on .ic{background:transparent!important}.sobrio .nav a{color:#8A9099!important;font-weight:500}.sobrio .nav a.on{color:var(--acc)!important}}'
    + '@media (min-width:900px){.sobrio .nav a{color:#374151!important;font-weight:500!important;position:relative}.sobrio .nav a.on{background:#F3F4F6!important;color:#111318!important;font-weight:600!important}'
    + '.sobrio .nav a.on:before{content:"";position:absolute;left:-6px;top:9px;bottom:9px;width:3px;border-radius:2px;background:var(--acc)}'
    + '.sobrio .nav .nv-marca{color:#111318!important;font-weight:650!important;font-size:15px!important;align-items:center;gap:8px}.sobrio .nav .nv-marca b{width:9px;height:9px;border-radius:2px;background:var(--acc);display:inline-block}'
    + '.sobrio .nav .nv-tit{letter-spacing:0!important;font-weight:500!important;color:#9AA0A8!important}.sobrio .nav a .qd{width:26px!important;height:26px!important;font-size:14px!important}}';
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
    const st = document.createElement('style'); st.id = 'casca-css'; st.textContent = css + TEMA + TEMA_SOBRIO; document.head.appendChild(st);
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
  // v177: mudou a ordem no computador? ao voltar para o site no celular (ou vice-versa) ela já aparece
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !CAT.length) return;
    fetch('/api/preferencias').then(r => r.json()).then(j => {
      if (!j || j.erro) return; const novo = Array.isArray(j.atalhos) ? j.atalhos : null;
      if (JSON.stringify(novo) === JSON.stringify(FAV)) return;
      FAV = novo; try { if (FAV) localStorage.setItem(CHAVE_LOCAL(), JSON.stringify(FAV)); else localStorage.removeItem(CHAVE_LOCAL()); } catch (e) {}
      C.atualizarCasca();
    }).catch(() => {});
  });
  // v177: balão 💬 some enquanto a tela rola (não cobre os cartões) e volta quando para
  (function () { let t = null; window.addEventListener('scroll', function () { const f = document.getElementById('chat-fab'); if (!f) return; const box = document.getElementById('chat-box'); if (box && box.style.display === 'flex') return; f.classList.add('fab-some'); clearTimeout(t); t = setTimeout(() => f.classList.remove('fab-some'), 700); }, { passive: true }); })();
  const CHAVE_LOCAL = () => 'chama-atalhos:' + location.pathname; // separado por tela (/app, /gestor)
  // v178: data-aba pode ter mais de uma aba separada por espaço (ex.: "mural ranking" = Mural com a Premiação dentro)
  const itemNav = (r, cls, acao) => '<a href="#" class="' + cls + (r.id && TOM_DO[r.id] ? '' : ' sem-qd') + '" data-aba="' + escH(r.aba || '') + '" onclick="' + acao + ';return false" title="' + escH(r.nome) + '"><span class="ic">' + icoDe(r) + '</span>' + (r.id && TOM_DO[r.id] ? quadrinho(r.id, icoDe(r), 30).replace('class="qd"', 'class="qd so-desk"') : '') + '<span class="tx">' + escH(r.curto || r.nome) + '</span></a>';
  C.abaDoMenu = function (a, ab) { return !!ab && String(a.dataset.aba || '').split(' ').includes(ab); };
  C.renderNav = function () {
    const nav = document.querySelector('.nav'); if (!nav || !INICIO) return;
    const fav = favoritos();
    const atual = (document.querySelector('.aba.on') || {}).id || '';
    let h = '<div class="so-desk nv-marca">' + (C.sobrio() ? '<b></b>' : '🔥 ') + 'Gestão Chama</div>';
    h += itemNav(INICIO, '', "Chama.abrirInicio()");
    fav.forEach((id, i) => { h += itemNav(MAPA[id], i < NA_BARRA ? '' : 'so-desk', "Chama.abrir('" + id + "')"); });
    h += itemNav({ ic: '☰', ico: 'menu-2', nome: 'Mais', aba: 'mais' }, 'so-mob', "Chama.abrirMais()");
    const resto = CAT.filter(r => !fav.includes(r.id));
    if (resto.length) h += '<div class="so-desk nv-tit">' + (C.sobrio() ? 'Outros' : 'OUTROS') + '</div>' + resto.map(r => itemNav(r, 'so-desk', "Chama.abrir('" + r.id + "')")).join('');
    h += '<div class="so-desk nv-tit">&nbsp;</div>' + itemNav({ ic: '✏️', ico: 'adjustments-horizontal', nome: 'Personalizar menu', aba: '' }, 'so-desk', 'Chama.personalizar()');
    nav.innerHTML = h;
    const ab = atual.replace(/^aba-/, '');
    nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', C.abaDoMenu(a, ab)));
  };
  C.abrirInicio = function () { INICIO.abrir(); };
  C.renderAtalhos = function (elId) {
    const el = document.getElementById(elId); if (!el) return;
    const fav = favoritos();
    el.innerHTML = fav.length ? '<div class="atl">' + fav.map(id => tileItem(MAPA[id])).join('') + '</div>'
      : '<div class="mut" style="font-size:13px;padding:6px 2px 12px">Nenhum atalho escolhido. Toque em ' + C.E('✏️', 'adjustments-horizontal') + ' Personalizar.</div>';
  };
  const tileItem = r => { const b = BADGE(r.id); return '<div class="it" data-nome="' + escH(String(r.nome).toLowerCase()) + '" onclick="Chama.abrir(\'' + r.id + '\')">' + (b ? '<span class="bd">' + escH(b) + '</span>' : '') + quadrinho(r.id, icoDe(r)) + '<span class="nm">' + escH(r.curto || r.nome) + '</span></div>'; };
  // v177: "Mais" = busca + MEUS ATALHOS na ordem escolhida (a mesma do menu e da barra) + o resto por grupos
  C.renderMais = function (elId) {
    const el = document.getElementById(elId); if (!el) return;
    const fav = favoritos(), resto = CAT.filter(r => !fav.includes(r.id)), usados = new Set();
    let h = '<div class="mais-busca"><span>' + C.E('🔎', 'search') + '</span><input type="search" placeholder="Buscar recurso…" oninput="Chama._filtrarMais(this.value)"></div>';
    h += '<div class="mais-sec"><span>' + C.E('⭐', 'star') + ' Meus atalhos</span><button class="lnk" onclick="Chama.personalizar()">Organizar</button></div><div class="atl">' + fav.map(id => tileItem(MAPA[id])).join('') + '</div>';
    GRUPOS.forEach(([nome, ids]) => { const it = resto.filter(r => ids.includes(r.id)); it.forEach(r => usados.add(r.id)); if (it.length) h += '<div class="mais-sec"><span>' + escH(nome) + '</span></div><div class="atl">' + it.map(tileItem).join('') + '</div>'; });
    const outros = resto.filter(r => !usados.has(r.id)); if (outros.length) h += '<div class="mais-sec"><span>Outros</span></div><div class="atl">' + outros.map(tileItem).join('') + '</div>';
    el.innerHTML = h;
  };
  C._filtrarMais = function (q) { q = String(q || '').toLowerCase().trim(); document.querySelectorAll('#aba-mais .atl .it').forEach(it => { it.style.display = !q || (it.dataset.nome || '').includes(q) ? '' : 'none'; }); document.querySelectorAll('#aba-mais .mais-sec').forEach(sv => { const g = sv.nextElementSibling; sv.style.display = g && [...g.children].some(x => x.style.display !== 'none') ? '' : 'none'; }); };
  C.abrirMais = function () { if (window.irAba) irAba('mais'); C.renderMais('mais-grid'); };
  C.atualizarCasca = function () { C.renderNav(); C.renderAtalhos('atalhos-home'); if (document.getElementById('aba-mais') && document.getElementById('aba-mais').classList.contains('on')) C.renderMais('mais-grid'); };
  // ---- editor de atalhos: ⭐ escolhe, ▲▼ muda a ordem (fácil no celular, sem arrastar) ----
  let TMP = [];
  C.personalizar = function () { TMP = favoritos().slice(); desenharPers(); };
  function desenharPers() {
    const outros = CAT.filter(r => !TMP.includes(r.id));
    const temInicio = !!document.getElementById('atalhos-home');
    let h = '<div class="mut" style="font-size:12px;margin-bottom:8px">Marque ' + (C.sobrio() ? '★' : '⭐') + ' o que você mais usa (até ' + MAX_FAV + ') e ajuste a ordem com ▲▼. A ordem é do seu acesso: vale igual no celular e no computador. Os <b>3 primeiros</b> vão para a barra de baixo do celular; no computador, todos ficam no topo do menu lateral' + (temInicio ? ' e nos atalhos do Início' : '') + '.</div>';
    h += '<div style="font-weight:700;font-size:13px;margin:6px 0 2px">' + C.E('⭐', 'star') + ' Meus atalhos</div>';
    h += TMP.length ? TMP.map((id, i) => { const r = MAPA[id]; return '<div class="pers-li"><button class="st" title="Tirar dos atalhos" onclick="Chama._persTog(\'' + id + '\')"' + (C.sobrio() ? ' style="color:#E0A43A"' : '') + '>' + (C.sobrio() ? '★' : '⭐') + '</button><span class="nm" style="display:flex;align-items:center;gap:8px">' + quadrinho(id, icoDe(r), 30) + escH(r.nome) + (i < NA_BARRA ? ' <span class="tag-barra">barra</span>' : '') + '</span><button ' + (i === 0 ? 'disabled' : '') + ' onclick="Chama._persMov(' + i + ',-1)" aria-label="Subir">▲</button><button ' + (i === TMP.length - 1 ? 'disabled' : '') + ' onclick="Chama._persMov(' + i + ',1)" aria-label="Descer">▼</button></div>'; }).join('')
      : '<div class="mut" style="font-size:12px;padding:6px 4px">Nenhum ainda — marque abaixo.</div>';
    // prévia da barra de baixo do celular (Início + os 3 primeiros)
    h += '<div style="font-weight:700;font-size:13px;margin:12px 0 6px">' + C.E('📱', 'device-mobile') + ' Prévia da barra do celular</div><div style="display:flex;justify-content:space-around;background:#fff;border:1px solid var(--bord);border-radius:16px;padding:8px 2px">'
      + [INICIO].concat(TMP.slice(0, NA_BARRA).map(id => MAPA[id])).map(r => '<div style="text-align:center;font-size:10.5px;color:#5F646D;min-width:52px"><div style="font-size:21px">' + icoDe(r) + '</div>' + escH(r.curto || r.nome) + '</div>').join('')
      + '<div style="text-align:center;font-size:10.5px;color:#5F646D;min-width:52px"><div style="font-size:21px">' + C.E('☰', 'menu-2') + '</div>Mais</div></div>';
    if (outros.length) h += '<div style="font-weight:700;font-size:13px;margin:14px 0 2px">Outros recursos</div>' + outros.map(r => '<div class="pers-li"><button class="st" title="Adicionar aos atalhos" onclick="Chama._persTog(\'' + r.id + '\')">☆</button><span class="nm" style="display:flex;align-items:center;gap:8px">' + quadrinho(r.id, icoDe(r), 30) + escH(r.nome) + '</span></div>').join('');
    h += '<div style="display:flex;gap:8px;margin-top:14px"><button class="btn sec2" style="flex:1" onclick="Chama._persPadrao()">Restaurar padrão</button><button class="btn" style="flex:2" onclick="Chama._persSalvar()">Salvar</button></div>';
    if (window.abrirPop) abrirPop(C.sobrio() ? 'Personalizar atalhos' : '✏️ Personalizar atalhos', h);
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
    (extras || []).forEach(x => { h += bt(C.sobrio() && x.ico ? C.E('', x.ico) : x.ic, x.nome, 'fecharPop();' + x.acao); });
    h += bt(C.E('📷', 'camera'), 'Trocar minha foto', "document.getElementById('minha-foto-file').click()");
    h += bt(C.E('🔑', 'key'), 'Trocar minha senha', 'Chama.abrirSenha()');
    h += bt(C.E('✏️', 'adjustments-horizontal'), 'Personalizar meus atalhos', 'Chama.personalizar()');
    h += bt(C.E('🚪', 'logout'), 'Sair', 'sair()', 'var(--no)');
    if (window.abrirPop) abrirPop(C.sobrio() ? 'Meu perfil' : '👤 Meu perfil', h);
    C.renderBotaoPush();
  };
  // trocar a própria senha (igual para consultor e gestor)
  C.abrirSenha = function () {
    const inp = 'padding:11px;border:1px solid var(--bord);border-radius:10px;font-size:14px';
    if (window.abrirPop) abrirPop(C.sobrio() ? 'Trocar minha senha' : '🔑 Trocar minha senha', '<div style="display:flex;flex-direction:column;gap:10px"><input id="sn-atual" type="password" placeholder="Senha atual" autocomplete="current-password" style="' + inp + '"><input id="sn-nova" type="password" placeholder="Nova senha (mín. 4 caracteres)" autocomplete="new-password" style="' + inp + '"><input id="sn-conf" type="password" placeholder="Confirmar nova senha" autocomplete="new-password" style="' + inp + '"><div id="sn-erro" style="display:none;color:var(--no);font-size:13px"></div><button class="btn full" onclick="Chama._salvarSenha()">Salvar nova senha</button></div>');
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
