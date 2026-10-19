/* v185: SORTEIO POR CLIENTE — mesma tela para gestor e consultor (cada um vê as cotas que já enxerga em Vendas).
 * Uso: Chama.sorteio.montar('id-do-container'). A conta fica no servidor (/api/sorteio-clientes). */
const srtEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const srtBRL = v => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
// ===== v184: SORTEIO POR CLIENTE =====
(function(){if(document.getElementById('srt-css'))return;const st=document.createElement('style');st.id='srt-css';st.textContent=''
 +'.srt-ass{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px}'
 +'.srt-ass button{border:1.5px solid var(--bord);background:#fff;border-radius:14px;padding:11px 8px;font-size:15px;font-weight:650;cursor:pointer;color:var(--txt);text-align:center}.srt-ass button small{display:block;font-size:12px;font-weight:500;color:var(--mut);margin-top:2px}'
 +'.srt-pr{background:#F4F5F7;border:1px solid var(--bord);border-radius:10px;padding:5px 9px;font-size:12px;color:var(--mut)}.srt-pr b{color:var(--txt);font-size:14px;letter-spacing:1px}.srt-pr.on{background:#FFF4D6;border-color:#F1D48A}'
 +'.srt-seg{display:inline-flex;border:1px solid var(--bord);border-radius:99px;overflow:hidden}.srt-seg button{border:none;background:#fff;padding:6px 11px;font-size:12.5px;cursor:pointer;color:var(--txt)}.srt-seg button.on{background:#111318;color:#fff}'
 +'.srt-res{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.srt-res div{border-radius:10px;padding:8px 4px;text-align:center;cursor:pointer}.srt-res b{display:block;font-size:20px}.srt-res span{font-size:11.5px;font-weight:600}'
 +'.srt-leg{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--mut);margin:2px 0 10px}.srt-leg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px}'
 +'.srt-fil{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 10px}.srt-fil button{border:1px solid var(--bord);background:#fff;border-radius:99px;padding:7px 12px;font-size:13px;cursor:pointer;color:var(--txt)}.srt-fil button.on{background:#111318;color:#fff;border-color:#111318}.srt-fil input{flex:1;min-width:150px;padding:9px 12px;border:1px solid var(--bord);border-radius:99px;font-size:14px;background:#fff}'
 +'.srt-cli{display:flex;gap:11px;align-items:center;background:#fff;border:1px solid var(--bord);border-left:6px solid;border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer}.srt-cli:hover{box-shadow:0 3px 10px rgba(16,24,40,.08)}.srt-cli.sort{background:#FFF8E6;border-color:#F1D48A}'
 +'.srt-med{width:30px;text-align:center;font-size:22px;flex:none;font-weight:700;color:#8A9099}.srt-nm{font-size:16.5px;font-weight:650;line-height:1.2}.srt-sub{font-size:12.5px;color:var(--mut);margin-top:3px;line-height:1.35}'
 +'.srt-mais{display:inline-block;font-size:11.5px;font-weight:600;color:#6A55D8;background:#F0EDFD;border-radius:99px;padding:1px 8px;margin-top:4px}'
 +'.srt-d{flex:none;text-align:right;margin-left:auto}.srt-d .n{font-size:21px;font-weight:750;line-height:1}.srt-d .l{font-size:11px;font-weight:600;margin-top:3px;white-space:nowrap}'
 +'.srt-cota{border:1px solid var(--bord);border-left:5px solid;border-radius:10px;padding:9px 11px;margin-top:8px}';document.head.appendChild(st);})();
const SRT_TIPOS=[['veiculo','🚗 Veículos','assembleia dia 7','#E4ECF5','#5E82AC','#2F4F78'],['imovel','🏠 Imóveis','assembleia dia 15','#F4E7E5','#B5645C','#7A3A33'],['servicos','🛠️ Serviços','cotas de serviços','#EDF3E6','#7FA05A','#3F5F22'],['semtipo','❔ Sem tipo','cadastre o tipo da cota','#F4F5F7','#9AA0A8','#4B5563']];
// tipo inicial pela data: do dia 8 ao 15 → imóveis; senão → veículos
const _srt={tipo:(()=>{const d=+Chama.hojeBR().slice(8,10);return d>=8&&d<=15?'imovel':'veiculo';})(),modo:'1',lim:5,q:'',dados:null,cont:null};
const srtCor=d=>{const a=Math.abs(d);return a===0?'#E0A91A':a<=5?'#17915F':a<=20?'#F0A030':'#C9CDD3';};
const srtTxt=d=>d===0?'🏆':(d>0?'+':'−')+Math.abs(d);
const srtLbl=d=>d===0?'COTA SORTEADA':(Math.abs(d)===1?'casa ':'casas ')+(d>0?'▲ à frente':'▼ atrás');
const srtPremios=()=>[...document.querySelectorAll('.srt-premio')].map(i=>i.value.trim());
async function srtAbrir(){srtInputs();if(!srtPremios().some(Boolean))await Chama.carregarLoteria('srt-premio','srt-lot-info');if(!srtPremios().some(Boolean))document.getElementById('srt-edit').style.display='block';srtCalcular();}
function srtEditar(){const e=document.getElementById('srt-edit');e.style.display=e.style.display==='none'?'block':'none';}
function srtChips(){const p=srtPremios(),el=document.getElementById('srt-chips');if(!el)return;
  el.innerHTML=p.some(Boolean)?p.map((n,i)=>n?`<span class="srt-pr ${(_srt.modo==='1'&&i===0)||(_srt.modo==='5')?'on':''}">${i+1}º <b>${srtEsc(n)}</b></span>`:'').join(''):'<span class="mut" style="font-size:12.5px">Nenhum número ainda — toque em ✏️ editar e extraia o resultado.</span>';
  document.getElementById('srt-modo').innerHTML=`<span class="srt-seg"><button class="${_srt.modo==='1'?'on':''}" onclick="_srt.modo='1';srtCalcular()">1º prêmio</button><button class="${_srt.modo==='5'?'on':''}" onclick="_srt.modo='5';srtCalcular()">Mais perto dos 5</button></span>`;}
function srtAss(){const c=_srt.cont||{};document.getElementById('srt-ass').innerHTML=SRT_TIPOS.filter(t=>t[0]!=='semtipo'||c.semtipo).map(t=>{const on=_srt.tipo===t[0];return `<button style="${on?`background:${t[3]};border-color:${t[4]};color:${t[5]}`:''}" onclick="_srt.tipo='${t[0]}';srtCalcular()">${t[1]}<small>${t[2]}${c[t[0]]!=null?' · '+c[t[0]]+' cota'+(c[t[0]]===1?'':'s'):''}</small></button>`;}).join('');}
async function srtCalcular(){
  srtChips();srtAss();const lista=document.getElementById('srt-lista');if(!lista)return;
  const premios=srtPremios();
  if(!(_srt.modo==='1'?premios[0]:premios.some(Boolean))){_srt.dados=null;document.getElementById('srt-resumo').innerHTML='<div class="mut" style="font-size:12.5px">'+(_srt.modo==='1'?'Falta o 1º prêmio.':'Falta o resultado da Federal.')+'</div>';document.getElementById('srt-fil').innerHTML='';lista.innerHTML='';return;}
  lista.innerHTML='<div class="mut" style="padding:10px">Calculando…</div>';
  let j;try{j=await(await fetch('/api/sorteio-clientes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({premios,tipo:_srt.tipo,modo:_srt.modo})})).json();}catch(e){j={erro:'Sem conexão'};}
  if(j.erro){lista.innerHTML=`<div class="card" style="padding:12px;color:var(--no)">${srtEsc(j.erro)}</div>`;return;}
  _srt.dados=j;_srt.cont=j.contagem;srtAss();document.getElementById('srt-edit').style.display='none';srtRender();
}
function srtRender(){
  const j=_srt.dados;if(!j)return;const cs=j.clientes||[];
  const ab=c=>Math.abs(c.cotas[0].d),n0=cs.filter(c=>ab(c)===0).length,n5=cs.filter(c=>ab(c)>0&&ab(c)<=5).length,n20=cs.filter(c=>ab(c)>5&&ab(c)<=20).length;
  document.getElementById('srt-resumo').innerHTML=`<div class="srt-res">${[[n0,'🏆 sorteada(s)','#FFF4D6','#8A5A00',0],[n5,'🔥 até 5 casas','#E7F6EF','#17915F',5],[n20,'⏳ 6 a 20 casas','#FDF3E1','#C47F0E',20],[cs.length,'👥 clientes','#F4F5F7','#5F646D',1e9]].map(x=>`<div style="background:${x[2]};color:${x[3]}" onclick="_srt.lim=${x[4]||5};srtRender()"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('')}</div>${j.ignoradas?`<div class="mut" style="font-size:11.5px;margin-top:6px">⚠️ ${j.ignoradas} cota(s) deste tipo sem grupo, cota ou tamanho do grupo — não entram na conta.</div>`:''}`;
  document.getElementById('srt-fil').innerHTML=[[5,'Até 5 casas'],[20,'Até 20'],[1e9,'Todos']].map(f=>`<button class="${_srt.lim===f[0]?'on':''}" onclick="_srt.lim=${f[0]};srtRender()">${f[1]}</button>`).join('')+`<input id="srt-q" placeholder="🔎 Cliente ou consultor" value="${srtEsc(_srt.q)}" oninput="_srt.q=this.value;srtLista()">`;
  srtLista();
}
function srtLista(){
  const j=_srt.dados,el=document.getElementById('srt-lista');if(!j||!el)return;
  const q=_srt.q.trim().toLowerCase(),cs=j.clientes||[];let rk=0;
  const vis=cs.map((c,i)=>({c,i,pos:c.cotas[0].d===0?0:++rk})).filter(x=>Math.abs(x.c.cotas[0].d)<=_srt.lim&&(!q||x.c.nome.toLowerCase().includes(q)||String(x.c.consultor).toLowerCase().includes(q)));
  el.innerHTML=vis.map(({c,i,pos})=>{const m=c.cotas[0],k=srtCor(m.d);const med=m.d===0?'🏆':pos<=3?['🥇','🥈','🥉'][pos-1]:pos+'º';
    return `<div class="srt-cli ${m.d===0?'sort':''}" style="border-left-color:${k}" onclick="srtVer(${i})"><div class="srt-med">${med}</div><div style="min-width:0"><div class="srt-nm">${srtEsc(c.nome)}</div><div class="srt-sub">Grupo ${srtEsc(m.grupo)} · cota <b style="color:var(--txt)">${m.cota}</b> · sorteado ${m.sorteado}${j.modo==='5'?' ('+m.premio+'º prêmio)':''} · ${srtEsc(c.consultor)}</div>${c.cotas.length>1?`<span class="srt-mais">＋${c.cotas.length-1} outra${c.cotas.length>2?'s':''} cota${c.cotas.length>2?'s':''}</span>`:''}</div><div class="srt-d" style="color:${m.d===0?'#8A5A00':Math.abs(m.d)<=20?k:'#8A9099'}"><div class="n">${srtTxt(m.d)}</div><div class="l">${srtLbl(m.d)}</div></div></div>`;}).join('')
    ||`<div class="mut" style="padding:10px">${cs.length?'Nenhum cliente nessa distância — toque em "Todos".':'Nenhuma cota ativa deste tipo.'}</div>`;
}
function srtVer(i){
  const c=((_srt.dados||{}).clientes||[])[i];if(!c)return;
  window.abrirPop('👤 '+c.nome,`<div class="mut" style="font-size:13px">Consultor(a) ${srtEsc(c.consultor)}${c.telefone?' · 📞 <b style="color:var(--txt)">'+srtEsc(c.telefone)+'</b>':''}</div>`
    +c.cotas.map(q=>{const k=srtCor(q.d);return `<div class="srt-cota" style="border-left-color:${k}"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><div style="font-weight:650">Grupo ${srtEsc(q.grupo)} · cota ${q.cota}</div><div class="srt-sub">sorteado ${q.sorteado}${_srt.dados.modo==='5'?' ('+q.premio+'º prêmio)':''} · ${srtBRL(q.valor)}</div></div><div class="srt-d" style="color:${q.d===0?'#8A5A00':Math.abs(q.d)<=20?k:'#8A9099'}"><div class="n" style="font-size:18px">${srtTxt(q.d)}</div><div class="l">${srtLbl(q.d)}</div></div></div><button class="btn sec2 ok-s" style="width:100%;margin-top:8px;padding:8px" onclick="srtContemplar('${srtEsc(q.id)}','${q.grupo.replace(/'/g,'')}',${q.cota})">🏆 Marcar esta cota como contemplada</button></div>`;}).join('')
    +`<button class="btn sec2" style="width:100%;margin-top:12px" onclick="fecharPop()">Fechar</button>`);
}
async function srtContemplar(id,grupo,cota){
  if(!confirm('Marcar a cota '+cota+' do grupo '+grupo+' como CONTEMPLADA? Ela sai das próximas apurações.'))return;
  const r=await(await fetch('/api/vendas/editar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,situacao:'contemplado'})})).json();
  if(r.ok){window.fecharPop();window.toast('Cota marcada como contemplada 🏆');srtCalcular();}else window.toast(r.erro||'Erro');
}
function srtInputs(){const el=document.getElementById('srt-premios');if(!el||el.dataset.done)return;el.innerHTML=['1º','2º','3º','4º','5º'].map(o=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span class="mut" style="width:26px;font-size:13px;font-weight:600">${o}</span><input type="text" class="srt-premio" inputmode="numeric" maxlength="5" placeholder="00000" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,5)" style="flex:1;padding:11px;border:1px solid var(--bord);border-radius:10px;font-size:15px;letter-spacing:2px;background:#fff"></div>`).join('');el.dataset.done='1';}
window.Chama = window.Chama || {};
Chama.sorteio = {
  montar(id) {
    const box = document.getElementById(id); if (!box) return;
    if (!box.dataset.montado) { box.innerHTML = `<div class="srt-ass" id="srt-ass"></div>
<div class="card" style="padding:12px;margin-bottom:10px">
<div class="row" style="gap:8px"><div style="font-weight:650;font-size:14.5px">🎰 Loteria Federal</div><button class="btn sec2" style="padding:6px 11px;min-height:30px;font-size:12.5px" onclick="srtEditar()">✏️ editar</button></div>
<div id="srt-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"></div>
<div id="srt-lot-info" style="font-size:11.5px;margin-top:6px"></div>
<div id="srt-edit" style="display:none;margin-top:10px">
<button class="btn sec2" style="width:100%;margin-bottom:8px;padding:9px" onclick="Chama.extrairLoteria('srt-premio','srt-lot-info',this).then(()=>srtCalcular())">📥 Extrair números da Loteria</button>
<div id="srt-premios"></div>
<button class="btn" style="width:100%;margin-top:4px" onclick="srtCalcular()">Calcular</button>
</div>
<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:12.5px;color:var(--mut)">Conta pelo: <span id="srt-modo"></span></div>
</div>
<div class="card" style="padding:12px;margin-bottom:10px"><div style="font-weight:650;font-size:14.5px;margin-bottom:8px">📊 Resumo dos clientes</div><div id="srt-resumo"></div></div>
<div class="srt-leg"><span><i style="background:#E0A91A"></i>cota sorteada</span><span><i style="background:#17915F"></i>até 5 casas</span><span><i style="background:#F0A030"></i>6 a 20 casas</span><span><i style="background:#C9CDD3"></i>mais longe</span></div>
<div class="srt-fil" id="srt-fil"></div>
<div id="srt-lista"></div>
<div class="mut" style="font-size:12px;background:#fff;border:1px dashed #C9CDD3;border-radius:12px;padding:10px 12px;margin-top:12px;line-height:1.5"><b>Como ler:</b> <b>+2</b> = a cota está 2 números <b>acima</b> do sorteado (▲ à frente) · <b>−2</b> = 2 números <b>abaixo</b> (▼ atrás). A ordem é a mesma de antes: +1, −1, +2, −2… <i>Não é contemplação oficial — confira na administradora.</i></div>`; box.dataset.montado = '1'; }
    srtAbrir();
  },
};
