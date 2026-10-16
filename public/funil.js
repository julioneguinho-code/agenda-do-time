/* v182: FUNIL DE LEADS — usado pelo gestor e pelo consultor.
 * Quadro com 4 colunas (Lead → Sem retorno → Em andamento → Excluídos). O cartão só muda de coluna pelos
 * botões (sem arrastar). Quem vira venda sai do quadro e conta na ficha.
 * Também monta o "Vínculo de lead" + telefone obrigatório do formulário de venda (Chama.funil.vinculoHTML).
 * A página precisa ter: <div class="aba" id="aba-funil"><div id="funil-box"></div></div>, irAba(), abrirPop(), fecharPop(), toast(). */
(function () {
  'use strict';
  const C = window.Chama = window.Chama || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const js = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const COLS = [
    { id: 'lead', nome: 'Lead', em: '🌱', bg: '#EEDDF9', bd: '#DDC3F1', tx: '#4A1D6E' },
    { id: 'semretorno', nome: 'Sem retorno', em: '⏳', bg: '#F7EB9C', bd: '#EADA6C', tx: '#5C4800' },
    { id: 'andamento', nome: 'Em andamento', em: '🤝', bg: '#C6F1E0', bd: '#9FE2C7', tx: '#0D5A3E' },
    { id: 'excluido', nome: 'Excluídos', em: '🗑️', bg: '#EFF0F3', bd: '#DDE0E5', tx: '#2B2F36' },
  ];
  const COL = {}; COLS.forEach(c => { COL[c.id] = c; });
  // cor pelo tempo de cadastro (pedido do Julio): até 6 meses azul, 6 a 12 amarelo, mais de 12 vermelho
  const IDADE = [{ cor: '#2D6CDF', rot: 'até 6 meses' }, { cor: '#E0A91A', rot: '6 a 12 meses' }, { cor: '#D93B48', rot: 'mais de 12 meses' }];
  function idade(iso) {
    const d = new Date(iso); if (isNaN(d)) return 0;
    const a6 = new Date(d); a6.setMonth(a6.getMonth() + 6);
    const a12 = new Date(d); a12.setMonth(a12.getMonth() + 12);
    const n = new Date(); return n < a6 ? 0 : n < a12 ? 1 : 2;
  }
  const dataCurta = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); };
  const dataLonga = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR'); };
  const dig = v => String(v == null ? '' : v).replace(/\D/g, '');
  // (11) 98888-7777 enquanto digita; com DDI (+55…) deixa como está
  function fmtTel(v) {
    const s = String(v == null ? '' : v); if (/^\s*\+/.test(s)) return s;
    const d = dig(s).slice(0, 11); if (!d) return '';
    if (d.length <= 2) return '(' + d;
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  const msg = m => { if (typeof window.toast === 'function') window.toast(m); };
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());

  (function css() {
    if (document.getElementById('funil-css')) return;
    const st = document.createElement('style'); st.id = 'funil-css';
    st.textContent = ''
      + '.fn-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px}'
      + '.fn-tit{font-size:20px;font-weight:700;color:#111318}'
      + '.fn-de{display:flex;align-items:center;gap:6px;font-size:13px;color:#5F646D;margin:2px 0 8px;flex-wrap:wrap}.fn-de select{padding:8px 10px;border:1px solid var(--bord);border-radius:10px;font-size:14px;background:#fff;color:var(--txt);max-width:100%}'
      + '.fn-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#5F646D;align-items:center;margin:2px 0 10px}.fn-leg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}'
      + '.fn-leg .fn-conv{margin-left:auto;font-weight:600;color:#17915F}'
      + '.fn-board{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;align-items:flex-start;scrollbar-width:none;padding-bottom:4px}.fn-board::-webkit-scrollbar{display:none}'
      + '.fn-col{flex:0 0 80%;max-width:320px;scroll-snap-align:start;border-radius:14px;padding:10px 9px;border:1px solid;min-width:0}'
      + '@media(min-width:768px){.fn-col{flex:1 1 0;min-width:215px;max-width:none}}'
      + '.fn-ch{display:flex;align-items:center;justify-content:space-between;gap:6px;font-weight:700;font-size:15.5px;padding:2px 4px 9px}'
      + '.fn-n{font-size:12.5px;font-weight:650;background:rgba(255,255,255,.7);border-radius:99px;padding:2px 9px}'
      + '.fn-card{background:#fff;border-radius:10px;padding:10px 11px 5px 12px;margin-bottom:8px;box-shadow:0 1px 2px rgba(16,24,40,.13);cursor:pointer;border-left:5px solid;min-height:60px;display:flex;flex-direction:column}'
      + '.fn-card:hover{box-shadow:0 3px 8px rgba(16,24,40,.16)}.fn-card:active{transform:scale(.99)}'
      + '.fn-card .nm{font-size:17px;font-weight:650;color:#111318;line-height:1.25;word-break:break-word}'
      + '.fn-card .dt{font-size:10.5px;color:#8A9099;text-align:right;margin-top:auto;padding-top:5px}'
      + '.fn-add{display:flex;align-items:center;gap:6px;width:100%;border:none;background:transparent;font-size:14px;font-weight:600;padding:8px 6px;border-radius:8px;cursor:pointer;color:inherit}.fn-add:hover{background:rgba(255,255,255,.55)}'
      + '.fn-vazio{font-size:12.5px;opacity:.75;padding:4px 4px 10px}'
      // barra de rolagem própria (no celular a do sistema some): arrasta ou toca para navegar entre as colunas
      + '.fn-sb{height:12px;background:#E3E6EA;border-radius:99px;position:relative;margin:8px 2px 2px;touch-action:none;cursor:pointer}.fn-sb-t{position:absolute;top:1px;bottom:1px;background:#7B828C;border-radius:99px;min-width:36px}'
      // detalhe do lead
      + '.fn-pill{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:650;border-radius:99px;padding:4px 10px;border:1px solid}'
      + '.fn-ct{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:650;margin:10px 0 2px;word-break:break-all}.fn-ct span{font-size:13px;font-weight:500;color:#5F646D}'
      + '.fn-obs{background:#F7F8FA;border:1px solid var(--bord);border-radius:10px;padding:9px 11px;font-size:14px;white-space:pre-wrap;margin-top:10px;line-height:1.45}'
      + '.fn-mv-t{font-size:13px;font-weight:650;color:#111318;margin:14px 0 6px}'
      + '.fn-mv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.fn-mv .btn{padding:11px 4px;font-size:13px;margin:0;width:100%;white-space:normal;line-height:1.2}'
      + '.fn-in{width:100%;padding:11px;border:1px solid var(--bord);border-radius:10px;font-size:14px;background:#fff;color:var(--txt);box-sizing:border-box;font-family:inherit}'
      + '.fn-lb{display:block;font-size:12.5px;font-weight:600;color:#374151;margin:10px 0 4px}.fn-lb .rq{color:#D93B48}.fn-lb .op{font-weight:400;color:#8A9099}'
      // vínculo de lead (formulário de venda)
      + '.fn-vinc{border:1.5px solid #DDC3F1;background:#FAF5FE;border-radius:12px;padding:8px 10px 10px;margin-bottom:10px}.fn-vinc .fn-lb{margin-top:2px}'
      + '.fn-res{margin-top:4px;max-height:220px;overflow-y:auto}.fn-res button{display:block;width:100%;text-align:left;border:1px solid var(--bord);background:#fff;border-radius:10px;padding:8px 10px;margin-bottom:5px;cursor:pointer;font-size:13px;color:var(--txt)}.fn-res button b{font-size:14.5px}.fn-res button:hover{border-color:#B98BE0}'
      + '.fn-esc{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #DDC3F1;border-radius:10px;padding:8px 10px}.fn-esc .tx{flex:1;min-width:0;font-size:13px}.fn-esc .tx b{font-size:15px}'
      + '.fn-sem{display:flex;align-items:center;gap:8px;font-size:13.5px;margin-top:8px;cursor:pointer}.fn-sem input{width:19px;height:19px;accent-color:#6A55D8}';
    document.head.appendChild(st);
  })();

  const F = C.funil = {};
  let ST = { de: '', dados: null };
  const meuFunil = () => !ST.dados || !ST.dados.pessoas || ST.dados.pessoas.some(p => p.eu && p.login === ST.dados.de);

  // abre a aba do funil (de = login de quem ver; o gestor pode abrir o de alguém da equipe)
  F.abrir = function (de) {
    if (typeof window.irAba === 'function') window.irAba('funil');
    if (de != null) ST.de = String(de);
    F.carregar();
  };
  F.carregar = async function () {
    const box = document.getElementById('funil-box'); if (!box) return;
    if (!ST.dados) box.innerHTML = '<div class="mut" style="padding:10px 4px">Carregando…</div>';
    let j; try { j = await (await fetch('/api/leads' + (ST.de ? '?de=' + encodeURIComponent(ST.de) : ''))).json(); } catch (e) { j = { erro: 'Sem conexão' }; }
    if (j.erro) { if (ST.de) { ST.de = ''; return F.carregar(); } box.innerHTML = '<div class="mut" style="padding:10px 4px">' + esc(j.erro) + '</div>'; return; }
    ST.dados = j; F.render();
  };
  F.render = function () {
    const box = document.getElementById('funil-box'), d = ST.dados; if (!box || !d) return;
    const meu = meuFunil();
    let h = '<div class="fn-top"><div class="fn-tit">🎯 Funil de leads</div><button class="btn sec2 ok-s" style="padding:9px 14px" onclick="Chama.funil.novo()">＋ Novo lead</button></div>';
    if (d.pessoas && d.pessoas.length > 1) {
      h += '<div class="fn-de">👀 Ver o funil de <select onchange="Chama.funil.abrir(this.value)">' + d.pessoas.map(p => '<option value="' + esc(p.login) + '"' + (p.login === d.de ? ' selected' : '') + '>' + esc(p.eu ? 'Eu (' + p.nome.split(' ')[0] + ')' : p.nome) + ' · ' + p.abertos + '</option>').join('') + '</select></div>';
    }
    if (!meu) h += '<div class="fn-de" style="color:#6A55D8;font-weight:600">Você está vendo o funil de ' + esc(d.deNome) + '.</div>';
    h += '<div class="fn-leg">Tempo de cadastro: ' + IDADE.map(x => '<span><i style="background:' + x.cor + '"></i>' + x.rot + '</span>').join('') + (d.viraramVenda ? '<span class="fn-conv">🏆 ' + d.viraramVenda + (d.viraramVenda === 1 ? ' virou venda' : ' viraram venda') + '</span>' : '') + '</div>';
    h += '<div class="fn-board" id="fn-board" onscroll="Chama.funil._sb()">' + COLS.map(c => {
      const ls = d.leads.filter(l => l.status === c.id);
      const cards = ls.map(l => '<div class="fn-card" style="border-left-color:' + IDADE[idade(l.criadoEm)].cor + '" onclick="Chama.funil.ver(\'' + js(l.id) + '\')"><div class="nm">' + esc(l.nome) + '</div><div class="dt">' + dataCurta(l.criadoEm) + '</div></div>').join('');
      return '<div class="fn-col" style="background:' + c.bg + ';border-color:' + c.bd + ';color:' + c.tx + '"><div class="fn-ch"><span>' + c.em + ' ' + c.nome + '</span><span class="fn-n">' + ls.length + '</span></div>'
        + (cards || '<div class="fn-vazio">Nenhum lead aqui</div>')
        + (c.id === 'lead' && meu ? '<button class="fn-add" onclick="Chama.funil.novo()">＋ Adicionar lead</button>' : '') + '</div>';
    }).join('') + '</div><div class="fn-sb" id="fn-sb"><div class="fn-sb-t" id="fn-sb-t"></div></div>';
    box.innerHTML = h;
    ligarBarra(); F._sb();
  };
  // ---- barra de rolagem própria ----
  F._sb = function () {
    const b = document.getElementById('fn-board'), sb = document.getElementById('fn-sb'), t = document.getElementById('fn-sb-t'); if (!b || !sb || !t) return;
    const max = b.scrollWidth - b.clientWidth;
    if (max <= 2) { sb.style.display = 'none'; return; }
    sb.style.display = 'block';
    const W = sb.clientWidth, tw = Math.max(36, W * b.clientWidth / b.scrollWidth);
    t.style.width = tw + 'px'; t.style.left = ((W - tw) * b.scrollLeft / max) + 'px';
  };
  function ligarBarra() {
    const b = document.getElementById('fn-board'), sb = document.getElementById('fn-sb'), t = document.getElementById('fn-sb-t'); if (!b || !sb) return;
    let arrastando = false, dx = 0;
    const ir = x => { const r = sb.getBoundingClientRect(), tw = t.offsetWidth, max = b.scrollWidth - b.clientWidth; b.scrollLeft = Math.max(0, Math.min(1, (x - r.left - dx) / Math.max(1, r.width - tw))) * max; };
    sb.addEventListener('pointerdown', e => {
      const tr = t.getBoundingClientRect();
      dx = (e.clientX >= tr.left && e.clientX <= tr.right) ? e.clientX - tr.left : t.offsetWidth / 2;
      arrastando = true; b.style.scrollSnapType = 'none'; try { sb.setPointerCapture(e.pointerId); } catch (_) {} ir(e.clientX); e.preventDefault();
    });
    sb.addEventListener('pointermove', e => { if (arrastando) ir(e.clientX); });
    const fim = () => { if (!arrastando) return; arrastando = false; b.style.scrollSnapType = ''; };
    sb.addEventListener('pointerup', fim); sb.addEventListener('pointercancel', fim);
    if (!F._rs) { F._rs = true; window.addEventListener('resize', () => F._sb()); }
  }

  // ---- cadastro / edição ----
  function formLead(l) {
    l = l || {};
    return '<label class="fn-lb">Nome <span class="rq">*</span></label><input class="fn-in" id="fn-nome" value="' + esc(l.nome) + '" placeholder="Nome do lead" maxlength="80">'
      + '<div style="display:flex;gap:8px"><div style="flex:1;min-width:0"><label class="fn-lb">📞 Telefone</label><input class="fn-in" id="fn-tel" inputmode="tel" value="' + esc(l.telefone ? fmtTel(l.telefone) : '') + '" placeholder="(11) 99999-9999" oninput="this.value=Chama.funil.fmtTel(this.value)"></div>'
      + '<div style="flex:1;min-width:0"><label class="fn-lb">📸 Instagram</label><input class="fn-in" id="fn-insta" value="' + esc(l.insta) + '" placeholder="@perfil" autocapitalize="off"></div></div>'
      + '<div class="mut" style="font-size:11.5px;margin-top:4px">Preencha o telefone ou o @ — pelo menos um.</div>'
      + '<label class="fn-lb">📝 Observação</label><textarea class="fn-in" id="fn-obs" rows="3" maxlength="1000" placeholder="Como chegou, o que procura…">' + esc(l.obs) + '</textarea>';
  }
  const lerForm = () => ({ nome: document.getElementById('fn-nome').value.trim(), telefone: document.getElementById('fn-tel').value.trim(), insta: document.getElementById('fn-insta').value.trim(), obs: document.getElementById('fn-obs').value.trim() });
  function validar(b) {
    if (!b.nome) return 'Informe o nome do lead';
    if (dig(b.telefone).length < 8 && !b.insta.replace('@', '')) return 'Informe o telefone ou o @ do Instagram';
    if (b.telefone && dig(b.telefone).length < 8) return 'Telefone incompleto — confira os números';
    return '';
  }
  F.novo = function () {
    window.abrirPop('🎯 Novo lead', formLead() + '<button class="btn full" style="margin-top:12px" onclick="Chama.funil.salvarNovo()">Salvar lead</button>');
    setTimeout(() => { const i = document.getElementById('fn-nome'); if (i) i.focus(); }, 50);
  };
  F.salvarNovo = async function (forcar) {
    const b = lerForm(), e = validar(b); if (e) { msg(e); return; }
    if (forcar) b.forcar = true;
    const j = await post('/api/leads', b);
    if (j.duplicado) {
      const dd = j.duplicado;
      if (confirm('Já existe um lead com este ' + dd.por + ':\n\n' + dd.nome + ' — ' + dd.rotulo + ' (cadastrado em ' + dataLonga(dd.criadoEm) + ')\n\nCadastrar mesmo assim?')) return F.salvarNovo(true);
      return;
    }
    if (!j.ok) { msg(j.erro || 'Erro ao salvar'); return; }
    window.fecharPop(); msg('Lead cadastrado ✓ — está na coluna Lead');
    if (abaAberta()) { ST.de = ''; F.carregar(); }
  };
  const abaAberta = () => { const a = document.getElementById('aba-funil'); return !!(a && a.classList.contains('on')); };
  F.editar = function (id) {
    const l = acha(id); if (!l) return;
    window.abrirPop('✏️ Editar lead', formLead(l) + '<div style="display:flex;gap:6px;margin-top:12px"><button class="btn sec2" style="flex:1" onclick="Chama.funil.ver(\'' + js(id) + '\')">Voltar</button><button class="btn" style="flex:2" onclick="Chama.funil.salvarEdicao(\'' + js(id) + '\')">Salvar alterações</button></div>');
  };
  F.salvarEdicao = async function (id) {
    const b = lerForm(), e = validar(b); if (e) { msg(e); return; }
    b.id = id; const j = await post('/api/leads/editar', b);
    if (!j.ok) { msg(j.erro || 'Erro ao salvar'); return; }
    msg('Lead atualizado ✓'); await F.carregar(); F.ver(id);
  };
  const acha = id => ((ST.dados && ST.dados.leads) || []).find(l => l.id === id);

  // ---- detalhe: contato + 3 botões para as outras colunas ----
  const BTN = {
    lead: (de) => ['btn sec2', de === 'excluido' ? '↩️ Recuperar' : '↩️ Lead'],
    semretorno: () => ['btn warn', '⏳ Sem retorno'],
    andamento: () => ['btn', '🤝 Em andamento'],
    excluido: () => ['btn sec2 no-s', '🗑️ Excluir'],
  };
  F.ver = function (id) {
    const l = acha(id); if (!l) return;
    const c = COL[l.status] || COLS[0], ida = IDADE[idade(l.criadoEm)];
    let h = '<span class="fn-pill" style="background:' + c.bg + ';border-color:' + c.bd + ';color:' + c.tx + '">' + c.em + ' ' + c.nome + (l.movidoEm && l.movidoEm !== l.criadoEm ? ' · desde ' + dataCurta(l.movidoEm) : '') + '</span>';
    if (l.telefone) h += '<div class="fn-ct">📞 ' + esc(fmtTel(l.telefone)) + '</div>';
    if (l.insta) h += '<div class="fn-ct">📸 ' + esc(l.insta) + '</div>';
    h += l.obs ? '<div class="fn-obs">📝 ' + esc(l.obs) + '</div>' : '<div class="mut" style="font-size:12.5px;margin-top:8px">Sem observação.</div>';
    h += '<div class="mut" style="font-size:12px;margin-top:8px"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + ida.cor + ';vertical-align:-1px"></i> Cadastrado em ' + dataLonga(l.criadoEm) + ' · ' + ida.rot + '</div>';
    h += '<div class="fn-mv-t">Mover para</div><div class="fn-mv">' + COLS.filter(x => x.id !== l.status).map(x => { const b = BTN[x.id](l.status); return '<button class="' + b[0] + '" onclick="Chama.funil.mover(\'' + js(l.id) + '\',\'' + x.id + '\')">' + b[1] + '</button>'; }).join('') + '</div>';
    if (l.status !== 'excluido' && meuFunil() && typeof window.novaVendaComLead === 'function') h += '<button class="btn full" style="margin-top:10px" onclick="Chama.funil.venda(\'' + js(l.id) + '\')">💰 Lançar venda deste lead</button>';
    h += '<button class="btn sec2" style="width:100%;margin-top:8px" onclick="Chama.funil.editar(\'' + js(l.id) + '\')">✏️ Editar dados</button>';
    window.abrirPop('👤 ' + l.nome, h);
  };
  F.mover = async function (id, status) {
    const j = await post('/api/leads/mover', { id, status });
    if (!j.ok) { msg(j.erro || 'Erro ao mover'); return; }
    window.fecharPop(); msg('Movido para ' + (COL[status] ? COL[status].nome : status) + ' ✓');
    const l = acha(id); if (l) { l.status = status; l.movidoEm = new Date().toISOString(); F.render(); }
    F.carregar();
  };
  F.venda = function (id) { const l = acha(id); if (!l) return; window.fecharPop(); window.novaVendaComLead(l); };

  // ===== VÍNCULO DE LEAD no formulário de venda (px = prefixo dos campos: 'vf' consultor, 'vgf' gestor) =====
  F.fmtTel = fmtTel;
  F.vinculoHTML = function (px, o) {
    o = o || {};
    const tel = '<label class="fn-lb">📞 Telefone do cliente ' + (o.carteira ? '<span class="op">(opcional)</span>' : '<span class="rq">*</span>') + '</label><input class="fn-in" id="' + px + '-tel" inputmode="tel" value="' + esc(o.tel ? fmtTel(o.tel) : '') + '" placeholder="(11) 99999-9999" oninput="this.value=Chama.funil.fmtTel(this.value)" style="margin-bottom:8px">';
    if (o.carteira) return tel;
    return '<div class="fn-vinc"><label class="fn-lb">🎯 Vínculo de lead <span class="rq">*</span></label>'
      + '<input type="hidden" id="' + px + '-lead" value="">'
      + '<div id="' + px + '-lead-esc" style="display:none"></div>'
      + '<div id="' + px + '-lead-busca"><input class="fn-in" id="' + px + '-lead-q" placeholder="🔎 Buscar lead pelo nome" autocomplete="off" oninput="Chama.funil._buscar(\'' + px + '\')" onfocus="Chama.funil._buscar(\'' + px + '\')"><div class="fn-res" id="' + px + '-lead-res"></div></div>'
      + '<label class="fn-sem"><input type="checkbox" id="' + px + '-semlead" onchange="Chama.funil._semLead(\'' + px + '\')"> Sem lead <span class="mut" style="font-size:12px">(a venda não veio do funil)</span></label></div>' + tel;
  };
  const tmr = {};
  F._buscar = function (px) {
    clearTimeout(tmr[px]);
    tmr[px] = setTimeout(async () => {
      const q = (document.getElementById(px + '-lead-q') || {}).value || '', res = document.getElementById(px + '-lead-res'); if (!res) return;
      const dono = (document.getElementById(px + '-consultor') || {}).value || '';
      let j; try { j = await (await fetch('/api/leads/busca?q=' + encodeURIComponent(q) + (dono ? '&dono=' + encodeURIComponent(dono) : ''))).json(); } catch (e) { j = { erro: 'Sem conexão' }; }
      if (j.erro) { res.innerHTML = '<div class="mut" style="font-size:12.5px;padding:4px">' + esc(j.erro) + '</div>'; return; }
      F._res = F._res || {}; F._res[px] = j.leads;
      res.innerHTML = j.leads.length ? j.leads.map((l, i) => { const c = COL[l.status] || COLS[0]; return '<button type="button" onclick="Chama.funil._escolher(\'' + px + '\',' + i + ')"><b>' + esc(l.nome) + '</b> <span class="fn-pill" style="font-size:11px;padding:1px 7px;background:' + c.bg + ';border-color:' + c.bd + ';color:' + c.tx + '">' + esc(c.nome) + '</span><div class="mut" style="font-size:12px;margin-top:2px">' + esc([l.telefone ? fmtTel(l.telefone) : '', l.insta].filter(Boolean).join(' · ')) + ' · cadastrado ' + dataCurta(l.criadoEm) + '</div></button>'; }).join('')
        : '<div class="mut" style="font-size:12.5px;padding:4px 2px">' + (q ? 'Nenhum lead com esse nome.' : 'Nenhum lead em aberto.') + ' Se a venda não veio do funil, marque <b>Sem lead</b>.</div>';
    }, 180);
  };
  F._escolher = function (px, i) {
    const l = ((F._res || {})[px] || [])[i]; if (!l) return;
    document.getElementById(px + '-lead').value = l.id;
    const c = COL[l.status] || COLS[0], esc1 = document.getElementById(px + '-lead-esc');
    esc1.innerHTML = '<div class="fn-esc"><div class="tx"><b>🎯 ' + esc(l.nome) + '</b><div class="mut" style="font-size:12px">' + esc([l.telefone ? fmtTel(l.telefone) : '', l.insta, c.nome].filter(Boolean).join(' · ')) + '</div></div><button type="button" class="btn sec2" style="padding:6px 10px;margin:0;font-size:12.5px" onclick="Chama.funil._trocar(\'' + px + '\')">Trocar</button></div>';
    esc1.style.display = 'block'; document.getElementById(px + '-lead-busca').style.display = 'none';
    const sem = document.getElementById(px + '-semlead'); if (sem) sem.checked = false;
    // o sistema puxa o telefone do lead e já preenche
    const tel = document.getElementById(px + '-tel'); if (tel && l.telefone) tel.value = fmtTel(l.telefone);
    const nome = document.getElementById(px + '-nome'); if (nome && !nome.readOnly && !nome.value.trim()) nome.value = l.nome;
  };
  F._trocar = function (px) {
    const h = document.getElementById(px + '-lead'); if (!h) return;
    h.value = ''; document.getElementById(px + '-lead-esc').style.display = 'none';
    const sem = document.getElementById(px + '-semlead');
    document.getElementById(px + '-lead-busca').style.display = sem && sem.checked ? 'none' : 'block';
    const q = document.getElementById(px + '-lead-q'); if (q) q.value = '';
    const r = document.getElementById(px + '-lead-res'); if (r) r.innerHTML = '';
  };
  F._semLead = function (px) {
    const sem = document.getElementById(px + '-semlead'); if (!sem) return;
    if (sem.checked) { document.getElementById(px + '-lead').value = ''; document.getElementById(px + '-lead-esc').style.display = 'none'; document.getElementById(px + '-lead-busca').style.display = 'none'; }
    else F._trocar(px);
  };
  // já abre a venda com o lead escolhido (botão "Lançar venda deste lead")
  F.preVincular = function (px, l) { F._res = F._res || {}; F._res[px] = [l]; F._escolher(px, 0); };
  // nova cota de cliente já cadastrado: traz o telefone da ficha do cliente
  F.telDaFicha = async function (px, cpf, nome) {
    try {
      const j = await (await fetch('/api/clientes/ficha?cpf=' + encodeURIComponent(cpf || '') + '&nome=' + encodeURIComponent(nome || ''))).json();
      const t = document.getElementById(px + '-tel'); if (j && j.telefone && t && !t.value) t.value = fmtTel(j.telefone);
    } catch (e) {}
  };
  // valores para enviar + conferência (venda nova exige telefone e lead ou "Sem lead")
  F.vinculo = function (px, carteira) {
    const tel = (document.getElementById(px + '-tel') || {}).value || '';
    const leadId = (document.getElementById(px + '-lead') || {}).value || '';
    const semLead = !!((document.getElementById(px + '-semlead') || {}).checked);
    let erro = '';
    if (!carteira) {
      if (!leadId && !semLead) erro = 'Vincule a venda a um lead (ou marque "Sem lead")';
      else if (dig(tel).length < 10) erro = 'Informe o telefone do cliente com DDD';
    }
    const v = { telefone: tel.trim() }; if (!carteira) { if (leadId) v.leadId = leadId; else v.semLead = true; }
    return { erro, valores: v };
  };

  // ===== card da ficha (consultor/gestor): leads que viraram venda =====
  F.cardFicha = function (lf, acao) {
    if (!lf) return '';
    const tot = Math.max(1, lf.total || 0);
    const seg = [['lead', lf.lead], ['semretorno', lf.semretorno], ['andamento', lf.andamento], ['excluido', lf.excluido]];
    const barra = '<div style="display:flex;height:9px;border-radius:99px;overflow:hidden;background:#EEF0F3;margin:8px 0 6px">'
      + '<div style="width:' + (100 * (lf.venda || 0) / tot) + '%;background:#17915F"></div>' + seg.map(s => '<div style="width:' + (100 * (s[1] || 0) / tot) + '%;background:' + COL[s[0]].bd + '"></div>').join('') + '</div>';
    return '<div class="fx-c' + (acao ? ' lk' : '') + '"' + (acao ? ' onclick="' + acao + '"' : '') + '><div class="fx-t"><span style="font-size:inherit;color:inherit;font-weight:inherit">🎯 Leads</span>' + (acao ? '<span>ver funil ›</span>' : '') + '</div>'
      + '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="font-size:24px;color:#17915F">🏆 ' + (lf.venda || 0) + '</b><span class="fx-s">' + ((lf.venda || 0) === 1 ? 'virou venda' : 'viraram venda') + ' de ' + (lf.total || 0) + ' lead' + ((lf.total || 0) === 1 ? '' : 's') + ' · <b style="color:#17915F">' + (lf.pct || 0) + '%</b></span></div>'
      + barra
      + '<div class="fx-s">' + seg.map(s => COL[s[0]].em + ' ' + COL[s[0]].nome + ' ' + (s[1] || 0)).join(' · ') + '</div>'
      + (lf.ultimos && lf.ultimos.length ? '<div class="fx-s" style="margin-top:5px">Últimos: ' + lf.ultimos.map(u => esc(u.nome) + (u.data ? ' (' + u.data.split('-').reverse().slice(0, 2).join('/') + ')' : '')).join(', ') + '</div>' : '')
      + '</div>';
  };
})();
