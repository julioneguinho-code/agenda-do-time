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
    const el = document.getElementById('push-cta'); if (!el) return;
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
})();
