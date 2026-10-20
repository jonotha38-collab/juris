import {esc,cnj,fmt,today,number,oabBadges} from './ui.mjs';
function pendingAction(task,admin){
 if(task.status==='todo')return {status:'doing',label:'Iniciar'};
 if(task.status==='doing')return {status:'review',label:'Enviar para revisão'};
 if(task.status==='review'&&admin)return {status:'done',label:'Concluir'};
 if(task.status==='done'&&admin)return {status:'todo',label:'Reabrir'};
 return null;
}
export function pendingTaskRow(task,{admin=false}={}){
 const labels={todo:'A fazer',doing:'Em andamento',review:'Para revisão',done:'Concluída'},late=task.status!=='done'&&task.due_date&&task.due_date<today(),action=pendingAction(task,admin);
 return `<article class="pending-item ${task.status==='done'?'is-done':''}" data-pending-item="${esc(task.id)}"><span class="pending-item-mark ${esc(task.status)}" aria-hidden="true">${task.status==='done'?'✓':task.status==='review'?'↗':task.status==='doing'?'•':'○'}</span><div class="pending-item-content"><div class="pending-item-title"><button data-task-id="${esc(task.id)}">${esc(task.title)}</button>${task.priority==='high'?'<span class="pending-priority">Alta prioridade</span>':''}</div>${task.description?`<p class="pending-item-description">${esc(task.description.slice(0,150))}${task.description.length>150?'…':''}</p>`:''}<div class="pending-item-meta"><span class="task-status ${esc(task.status)}">${labels[task.status]||esc(task.status)}</span><span class="${!task.assignee_id?'pending-unassigned':''}">${esc(task.assignee_name||'Sem responsável')}${task.assignee_active===0?' · acesso desativado':''}</span><span class="pending-date ${late?'is-late':''}">${late?'Atrasada · ':task.due_date===today()?'Hoje · ':''}${task.due_date?`<time datetime="${esc(task.due_date)}">${fmt(task.due_date)}</time>`:'Sem prazo definido'}</span></div></div>${action?`<button class="pending-step ${action.status==='done'?'is-complete':''}" data-pending-step="${esc(task.id)}" data-pending-status="${action.status}" data-pending-version="${esc(task.version)}" aria-label="${action.label}: ${esc(task.title)}">${action.label}</button>`:`<span class="pending-passive">${task.status==='review'?'Aguardando revisão':'Concluída'}</span>`}</article>`;
}
export function pendingCaseCard(row,{admin=false}={}){
 const summary=row.summary||{open:0,overdue:0,done:0,total:0},main=row.clients?.length?row.clients[0].name+(row.clients.length>1?' e mais '+(row.clients.length-1):''):row.parties.title;
 return `<article class="pending-case ${summary.overdue?'needs-attention':''}" data-pending-card="${esc(row.cnj)}"><div class="pending-case-heading"><div class="pending-case-heading-main"><div class="pending-case-label"><span class="tag">${esc(row.tribunal)}</span>${summary.overdue?`<span class="pending-alert">${number(summary.overdue)} atrasada${summary.overdue===1?'':'s'}</span>`:''}</div><h3><button data-pending-case="${esc(row.cnj)}">${esc(main)} <span aria-hidden="true">↗</span></button></h3><p class="pending-case-number">${esc(cnj(row.cnj))}</p><div class="oab-badges">${oabBadges(row.oabs||[])}</div></div>${admin?`<button class="secondary pending-add" data-pending-add="${esc(row.cnj)}">+ Pendência</button>`:''}</div><div class="pending-case-progress"><span><strong>${number(summary.open)}</strong> em aberto <span>· ${number(summary.done)} de ${number(summary.total)} concluídas na seleção</span></span><progress value="${Number(summary.done)||0}" max="${Math.max(1,Number(summary.total)||0)}" aria-label="${number(summary.done)} de ${number(summary.total)} tarefas concluídas na seleção"></progress></div><div class="pending-case-items">${row.tasks.map(task=>pendingTaskRow(task,{admin})).join('')}</div><div class="pending-case-footer"><span>${row.matching>row.tasks.length?`+${number(row.matching-row.tasks.length)} ${row.matching-row.tasks.length===1?'item':'itens'} neste filtro`:`${number(row.matching)} ${row.matching===1?'item':'itens'} neste filtro`}</span><button class="text-btn" data-pending-case="${esc(row.cnj)}">Ver pendências do processo ↗</button></div></article>`;
}
export function createPendingUI({api,notice,refresh,openCase,newTask,chooseProcesses}){
 const $=selector=>document.querySelector(selector);
 let state=null,view='',page=1,generation=0,timer=null,contextKey='';
 const filters={q:'',assignee:'',priority:'',focus:'open',sort:'attention'},writing=new Set();
 const admin=()=>state?.permissions?.admin===true;
 function renderSummary(summary){
  const cards=[['open','Em aberto',summary.open,'O trabalho que ainda falta'],['overdue','Atrasadas',summary.overdue,'Prazos informados já vencidos'],['today','Vencem hoje',summary.today,'Confira antes de encerrar o dia'],['review','Para revisar',summary.review,'Entregas aguardando conferência'],['unassigned','Sem responsável',summary.unassigned,'Defina quem dará o próximo passo'],['no_date','Sem data',summary.no_date,'Confira se há prazo a cadastrar']];
  $('#pending-metrics').innerHTML=cards.map(([focus,title,count,description])=>`<button class="pending-metric ${focus} ${filters.focus===focus?'selected':''}" data-pending-focus="${focus}" aria-pressed="${filters.focus===focus}"><span>${title}</span><strong>${number(count)}</strong><small>${description}</small></button>`).join('');
  document.querySelectorAll('[data-pending-focus]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.pendingFocus===filters.focus)));
 }
 async function load(){
  const revision=++generation;$('#pending-list').setAttribute('aria-busy','true');$('#pending-load-error').textContent='';
  try{
   const params=new URLSearchParams(stateContext());for(const [key,value] of Object.entries({...filters,page}))if(value)params.set(key,String(value));
   const result=await api('tasks/pending?'+params);
   if(revision!==generation||view!=='pending')return;
   if(page>1&&!result.rows.length&&result.total){page=Math.ceil(result.total/result.pageSize);return load();}
   if(!result.total)page=1;
   renderSummary(result.summary);
   $('#pending-assignee').innerHTML='<option value="">Todos os responsáveis</option><option value="unassigned">Sem responsável</option>'+result.people.map(person=>`<option value="${esc(person.id)}">${esc(person.name)}${!person.active?' (desativado)':''}</option>`).join('');
   $('#pending-assignee').value=filters.assignee;$('#pending-assignee').hidden=!admin();
   $('#pending-list').innerHTML=result.rows.length?result.rows.map(row=>pendingCaseCard(row,{admin:admin()})).join(''):`<div class="pending-empty"><span class="pending-empty-mark" aria-hidden="true">✓</span><h3>${filters.focus==='done'?'Nenhuma pendência concluída nesta seleção.':'Nenhuma pendência neste filtro.'}</h3><p>${filters.q||filters.assignee||filters.priority||filters.focus!=='open'?'Experimente limpar os filtros para consultar a carteira.':admin()?'Escolha um processo e registre o que precisa ser feito, com responsável e prazo.':'As pendências dos processos atribuídas a você aparecerão aqui.'}</p>${admin()?'<button class="secondary" data-pending-pick>Escolher um processo ↗</button>':''}</div>`;
   $('#pending-count').textContent=number(result.total)+' '+(result.total===1?'processo':'processos');
   $('#pending-page').textContent=String(page);$('#pending-previous').disabled=page===1;$('#pending-next').disabled=page*result.pageSize>=result.total;
   $('#pending-caption').textContent=(admin()?'':'Suas tarefas: ')+number(result.summary.open)+' pendências em aberto em '+number(result.summary.processes)+' processos na seleção. Os prazos são definidos pela equipe.';
   $('#pending-clear').hidden=!filters.q&&!filters.assignee&&!filters.priority&&filters.focus==='open'&&filters.sort==='attention';
  }catch(error){if(revision===generation&&view==='pending'){$('#pending-load-error').textContent=error.message;$('#pending-list').innerHTML='<div class="pending-empty"><h3>Não foi possível carregar as pendências.</h3><button class="secondary" data-pending-retry>Tentar novamente</button></div>';$('#pending-previous').disabled=true;$('#pending-next').disabled=true;}}
  finally{if(revision===generation)$('#pending-list').setAttribute('aria-busy','false');}
 }
 // Keep the OAB and tribunal selected in the main application.
 function stateContext(){return state?.pendingContext||{};}
 function change(key,value){filters[key]=value;page=1;load();}
 $('#pending-search').addEventListener('input',event=>{filters.q=event.target.value;page=1;clearTimeout(timer);timer=setTimeout(load,300);});
 $('#pending-assignee').addEventListener('change',event=>change('assignee',event.target.value));
 $('#pending-priority').addEventListener('change',event=>change('priority',event.target.value));
 $('#pending-sort').addEventListener('change',event=>change('sort',event.target.value));
 $('#pending-previous').addEventListener('click',()=>{if(page>1){page--;load();}});
 $('#pending-next').addEventListener('click',()=>{page++;load();});
 $('#pending-clear').addEventListener('click',()=>{Object.assign(filters,{q:'',assignee:'',priority:'',focus:'open',sort:'attention'});$('#pending-search').value='';$('#pending-priority').value='';$('#pending-sort').value='attention';page=1;load();});
 document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.pendingFocus){change('focus',button.dataset.pendingFocus);return;}
  if(button.dataset.pendingCase){openCase(button.dataset.pendingCase);return;}
  if(button.dataset.pendingAdd){if(admin())newTask(button.dataset.pendingAdd);return;}
  if(button.hasAttribute('data-pending-pick')){notice('Escolha um processo e registre o que falta tratar.');chooseProcesses();return;}
  if(button.hasAttribute('data-pending-retry')){load();return;}
  const id=button.dataset.pendingStep;if(!id||writing.has(id))return;
  writing.add(id);button.disabled=true;const feedback=$('#case-pending-feedback');if(feedback)feedback.textContent='';
  try{await api('tasks/'+encodeURIComponent(id),{status:button.dataset.pendingStatus,version:Number(button.dataset.pendingVersion)},'PATCH');notice('Pendência atualizada.');if(feedback)feedback.textContent='Pendência atualizada.';await refresh();}
  catch(error){notice(error.message,true);if(feedback)feedback.textContent=error.message;if(error.status===409)await refresh();}
  finally{writing.delete(id);if(button.isConnected)button.disabled=false;}
 });
 return {render(data,nextView,context){
  const prior=view;state={...data,pendingContext:context};view=nextView;
  $('#pending-section').hidden=view!=='pending';$('#pending-pick-process').hidden=!admin();
  const counts=data.taskStats||{},open=(counts.todo||0)+(counts.doing||0)+(counts.review||0);
  $('#nav-pending').textContent=number(open);$('#overview-pending-open').textContent=number(open);$('#overview-pending-overdue').textContent=number(counts.overdue||0);$('#overview-pending-unread').textContent=number(data.stats?.unread||0);
  $('#overview-pending').hidden=view!=='overview';
  const key=JSON.stringify(context||{});if(prior!==view||contextKey!==key){contextKey=key;page=1;generation++;if(view!=='pending')$('#pending-list').setAttribute('aria-busy','false');}
  if(view==='pending')load();
 },load};
}
