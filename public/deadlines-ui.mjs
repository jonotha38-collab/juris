import {esc,cnj,fmt,number} from './ui.mjs';
import {suggestDeadline} from './deadline-rules.mjs';
export function createDeadlineUI({api,notice,refresh,context,navigate,getCase}){
 const $=selector=>document.querySelector(selector),statusLabels={pending:'A conferir',confirmed:'Prazos cadastrados',dismissed:'Conferida sem novo prazo'};
 let state=null,view='',page=1,status='pending',search='',caseFilter='',generation=0,dialogGeneration=0,current=null,people=[],nextEntry=0,entries=new Map();
 const admin=()=>state?.permissions?.admin===true;
 const error=message=>'<div class="collab-empty"><p>'+esc(message)+'</p></div>';
 const options=()=>'<option value="">Escolha o responsável</option>'+people.filter(person=>person.active).map(person=>`<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('');
 function queries(){const params=context();params.set('page',String(page));params.set('status',status);if(search)params.set('q',search);if(caseFilter)params.set('cnj',caseFilter);return params;}
 async function load(){
  if(!admin()||view!=='deadlines')return;const revision=++generation;$('#deadline-list').setAttribute('aria-busy','true');
  try{
   const result=await api('deadlines?'+queries());if(revision!==generation||view!=='deadlines')return;
   for(const key of ['pending','changed','confirmed'])$('#deadline-stat-'+key).textContent=number(result.summary[key]);
   $('#deadline-case-filter').hidden=!caseFilter;$('#deadline-case-number').textContent=caseFilter?cnj(caseFilter):'';
   $('#deadline-status').value=status;$('#deadline-list').innerHTML=result.rows.length?result.rows.map(row=>{
    const count=row.analysis.items.length;
    return `<article class="deadline-card ${row.source_version>1&&row.status==='pending'?'source-changed':''}"><div class="deadline-card-content"><div class="deadline-card-tags"><span class="tag">${esc(row.tribunal)}</span><span class="deadline-state ${esc(row.status)}">${statusLabels[row.status]}</span>${row.canceled?'<span class="tag warn">Cancelada na fonte</span>':''}${row.source_version>1&&row.status==='pending'?'<span class="pending-alert">Publicação alterada · conferir novamente</span>':''}</div><h3>${esc(row.parties.title)}</h3><p class="deadline-case-number">${esc(cnj(row.cnj))} · Disponibilização: ${fmt(row.date)}</p><p class="deadline-excerpt">${esc(row.text.slice(0,220))}${row.text.length>220?'…':''}</p><div class="deadline-indications">${count?row.analysis.items.map(item=>`<span>${item.kind==='date'?'Data explícita: ':'Período: '}${esc(item.label)}</span>`).join(''):'<span class="deadline-no-period">Sem prazo explícito reconhecido · leitura integral necessária</span>'}</div>${row.linked_tasks?`<small>${number(row.linked_tasks)} tarefa(s) ligada(s) a esta publicação.</small>`:''}</div><button class="secondary" data-deadline-review="${esc(row.id)}">${row.status==='pending'?'Conferir publicação':'Ver conferência'} ↗</button></article>`;
   }).join(''):error('Nenhuma publicação nesta seleção de conferência. A fila abrange apenas as publicações capturadas pelo Juris.');
   $('#deadline-pagination-label').textContent=number(result.total)+' publicações · página '+page;
   $('#deadline-previous').disabled=page===1;$('#deadline-next').disabled=page*result.pageSize>=result.total;
  }catch(cause){if(revision===generation)$('#deadline-list').innerHTML=error(cause.message);}
  finally{if(revision===generation)$('#deadline-list').setAttribute('aria-busy','false');}
 }
 function addEntry(candidate=null){
  if(entries.size>=12){$('#deadline-review-error').textContent='Cadastre até 12 providências por conferência. Registre as demais nas pendências do processo.';return;}
  const id='entry-'+nextEntry++,relative=candidate?.kind==='relative',canSimulate=relative&&candidate.unit==='day'&&!candidate.ambiguous,hour=relative&&candidate.unit==='hour';
  entries.set(id,{candidate,calculation:null});
  $('#deadline-entries').insertAdjacentHTML('beforeend',`<fieldset class="deadline-entry" data-deadline-entry="${id}"><legend>${candidate?'Indicação encontrada no texto':'Providência acrescentada na conferência'}</legend><label class="deadline-check"><input type="checkbox" data-deadline-include checked> Cadastrar esta providência</label>${candidate?`<blockquote>${esc(candidate.excerpt)}</blockquote>`:''}<label>Título<input data-field="title" maxlength="200" required value="${esc(candidate?.title||'Conferir e cumprir providência da publicação')}"></label><div class="form-grid"><label>Responsável<select data-field="assignee" required>${options()}</select></label><label>Vencimento conferido<input data-field="due" type="date" min="1900-01-01" max="2200-12-31" value="${esc(candidate?.explicit_date||'')}" required></label>${hour?'<label>Horário conferido (Brasília)<input data-field="time" type="time" required></label>':''}</div>${hour?'<p class="deadline-warning">Prazo em horas: confira o início, o horário e a regra na fonte. O painel de tarefas destaca a data; acompanhe também o horário informado.</p>':''}${canSimulate?`<details class="deadline-simulation"><summary>Simular contagem de ${number(candidate.amount)} dias</summary><p>O termo inicial abaixo é excluído. Escolha a regra aplicável e informe o calendário oficial. Nenhuma regra é presumida pelo tribunal.</p><div class="form-grid"><label>Termo inicial confirmado<input data-field="base" type="date" min="1900-01-01" max="2200-12-31"></label><label>Quantidade de dias<input data-field="amount" type="number" readonly min="1" max="3650" value="${candidate.amount}"></label><label>Modo de contagem<select data-field="mode"><option value="">Escolha após conferir</option><option value="business" ${candidate.basis==='business'?'selected':''}>Dias úteis</option><option value="calendar" ${candidate.basis==='calendar'?'selected':''}>Dias corridos</option></select></label></div><div class="form-grid"><label>Datas sem expediente (AAAA-MM-DD, uma por linha)<textarea data-field="holidays" rows="2" placeholder="2026-11-20"></textarea><small>Excluídas nos dias úteis; nos corridos, usadas apenas se optar por prorrogar o vencimento.</small></label><label>Datas de suspensão (AAAA-MM-DD, uma por linha)<textarea data-field="suspensions" rows="2"></textarea><small>Excluídas da contagem em ambos os modos.</small></label></div><label class="deadline-check"><input data-field="recess" type="checkbox"> Aplicar suspensão de 20/12 a 20/01, se cabível ao caso</label><label class="deadline-check"><input data-field="roll" type="checkbox"> Prorrogar o vencimento se cair em fim de semana ou data sem expediente</label><button class="secondary" type="button" data-deadline-calculate="${id}">Simular e preencher data</button><p class="deadline-calculation" data-calculation-result role="status">Feriados locais e suspensões não são carregados automaticamente.</p></details>`:candidate&&relative?'<p class="field-help">Esta indicação exige cálculo manual. Confira a data na fonte antes de cadastrar.</p>':''}<label>Orientações e entrega esperada<textarea data-field="description" rows="2" maxlength="2000"></textarea></label></fieldset>`);
 }
 function renderReview(result,message=''){
  current=result.review;people=result.people;nextEntry=0;entries=new Map();
  const pending=current.status==='pending',existing=result.tasks;
  $('#deadline-review-title').textContent=pending?'Conferir publicação e prazos':'Conferência registrada';
  $('#deadline-review-context').textContent=current.parties.title+' · '+cnj(current.cnj)+' · '+current.tribunal;
  $('#deadline-review-meta').textContent='Disponibilização: '+fmt(current.date)+' · '+current.type+' · versão da fonte '+current.source_version;
  $('#deadline-review-source').textContent=current.text||'Teor não informado pela fonte. Confira a certidão oficial.';
  const certificate=$('#deadline-review-certificate');certificate.hidden=!current.certificate;if(current.certificate)certificate.href=current.certificate;else certificate.removeAttribute('href');
  $('#deadline-review-flags').innerHTML=(current.canceled?'<p class="deadline-warning">PUBLICAÇÃO CANCELADA. Confira e ajuste as tarefas já cadastradas antes de registrar a revisão.</p>':'')+(current.source_version>1?'<p class="deadline-warning">A fonte alterou esta publicação. Os prazos anteriores foram preservados e precisam ser conferidos novamente.</p>':'');
  $('#deadline-review-warnings').innerHTML=current.analysis.warnings.map(warning=>'<li>'+esc(warning)+'</li>').join('');
  $('#deadline-linked-tasks').innerHTML=existing.length?'<h3>Tarefas ligadas a esta publicação</h3>'+existing.map(task=>`<button class="deadline-linked-task" type="button" data-task-id="${esc(task.id)}"><strong>${esc(task.title)} ↗</strong><span>${fmt(task.due_date)} · ${esc(task.assignee_name||'Sem responsável')} · ${task.status==='done'?'Concluída':'Em aberto'}${task.source_version!==current.source_version?' · criada antes da alteração':''}</span></button>`).join(''):'';
  $('#deadline-entries').innerHTML='';
  $('#deadline-review-form').hidden=!pending;$('#deadline-review-resolution').hidden=pending;
  $('#deadline-review-reason').value='';$('#deadline-source-checked').checked=false;
  $('#deadline-confirm').hidden=!!current.canceled;$('#deadline-add-entry').hidden=!!current.canceled;
  if(pending&&!current.canceled){if(current.analysis.items.length)current.analysis.items.forEach(item=>addEntry(item));else addEntry();}
  $('#deadline-review-resolution').innerHTML=pending?'':`<p><strong>${statusLabels[current.status]}</strong> por ${esc(current.reviewer_name)} em ${esc(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(current.reviewed_at)))}.</p>${current.reason?'<p>'+esc(current.reason)+'</p>':''}<button type="button" class="secondary" id="deadline-reopen">Reabrir conferência</button>`;
  $('#deadline-review-history').innerHTML=result.history.length?'<summary>Histórico da conferência</summary>'+result.history.map(event=>`<p><strong>${esc(event.actor_name)}</strong> · ${esc({confirm:'Cadastrou prazos',dismiss:'Conferiu sem criar novo prazo',reopen:'Reabriu a conferência'}[event.action]||event.action)} · ${esc(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(event.created)))}${event.data.reason?'<br>'+esc(event.data.reason):''}</p>`).join(''):'';
  $('#deadline-review-error').textContent='';$('#deadline-review-feedback').textContent=message;$('#deadline-review-reload').hidden=true;
 }
 async function openReview(id){
  if(!admin())return;const revision=++dialogGeneration;current=null;
  $('#deadline-review-title').textContent='Carregando publicação…';$('#deadline-review-form').hidden=true;$('#deadline-review-resolution').hidden=true;$('#deadline-review-error').textContent='';$('#deadline-review-feedback').textContent='';
  for(const id of ['#deadline-review-context','#deadline-review-meta','#deadline-review-source','#deadline-review-flags','#deadline-review-warnings','#deadline-linked-tasks','#deadline-review-history'])$(id).textContent='';$('#deadline-review-certificate').hidden=true;$('#deadline-review-reload').hidden=true;
  if($('#deadline-review-modal').open)$('#deadline-review-modal').close();$('#deadline-review-modal').showModal();
  try{const result=await api('deadlines/'+encodeURIComponent(id));if(revision!==dialogGeneration||!$('#deadline-review-modal').open)return;renderReview(result);}
  catch(cause){if(revision===dialogGeneration){$('#deadline-review-title').textContent='Conferência indisponível';$('#deadline-review-error').textContent=cause.message;}}
 }
 function calculate(id){
  const fieldset=$('[data-deadline-entry="'+id+'"]'),entry=entries.get(id),field=name=>fieldset.querySelector('[data-field="'+name+'"]');
  try{
   const dates=name=>field(name).value.split(/[\s,;]+/).filter(Boolean);
   const calculation=suggestDeadline({base_date:field('base').value,amount:Number(field('amount').value),mode:field('mode').value,excluded_dates:dates('holidays'),suspended_dates:dates('suspensions'),recess:field('recess').checked,roll_end:field('roll').checked});
   entry.calculation=calculation;field('due').value=calculation.due_date;
   fieldset.querySelector('[data-calculation-result]').textContent='Data sugerida: '+fmt(calculation.due_date)+'. '+calculation.notice;
  }catch(cause){entry.calculation=null;fieldset.querySelector('[data-calculation-result]').textContent=cause.message;}
 }
 async function save(action){
  if(!current)return;
  const source=current,revision=dialogGeneration,button=action==='dismiss'?$('#deadline-dismiss'):$('#deadline-confirm');button.disabled=true;$('#deadline-review-error').textContent='';$('#deadline-review-feedback').textContent='';
  try{
   const tasks=[];
   if(action==='confirm')for(const [id,entry] of entries){
    const fieldset=$('[data-deadline-entry="'+id+'"]');if(!fieldset.querySelector('[data-deadline-include]').checked)continue;
    const field=name=>fieldset.querySelector('[data-field="'+name+'"]');
    tasks.push({title:field('title').value,description:field('description').value,assignee_id:field('assignee').value,due_date:field('due').value,due_time:field('time')?.value||null,candidate_key:entry.candidate?.key||null,calculation:entry.calculation});
   }
   const result=await api('deadlines/'+encodeURIComponent(source.id),{version:source.version,action,tasks,source_checked:$('#deadline-source-checked').checked,reason:$('#deadline-review-reason').value});
   if(revision===dialogGeneration&&$('#deadline-review-modal').open)renderReview(result,action==='confirm'?number(result.created_tasks.length)+' prazo(s) cadastrado(s) nas pendências do processo.':'Conferência registrada com o motivo informado.');
   await refresh();if($('#detail-modal').open)loadCaseSummary();
  }catch(cause){if(revision===dialogGeneration){$('#deadline-review-error').textContent=cause.message;$('#deadline-review-reload').hidden=cause.status!==409;}}
  finally{button.disabled=false;}
 }
 async function loadCaseSummary(){
  if(!admin())return;const process=getCase().cnj;if(!process)return;
  try{const result=await api('deadlines?'+new URLSearchParams({cnj:process,status:'pending'}));if(getCase().cnj!==process)return;$('#case-deadline-count').textContent=number(result.summary.pending)+' publicação(ões) a conferir'+(result.summary.changed?' · '+number(result.summary.changed)+' alterada(s)':'');}
  catch(cause){if(getCase().cnj===process)$('#case-deadline-count').textContent='Não foi possível verificar a fila: '+cause.message;}
 }
 $('#deadline-status').onchange=event=>{status=event.target.value;page=1;load();};
 let timer;$('#deadline-search').oninput=event=>{search=event.target.value;page=1;clearTimeout(timer);timer=setTimeout(load,300);};
 $('#deadline-clear-case').onclick=()=>{caseFilter='';page=1;load();};
 $('#deadline-previous').onclick=()=>{page--;load();};$('#deadline-next').onclick=()=>{page++;load();};
 $('#deadline-review-form').onsubmit=event=>{event.preventDefault();save('confirm');};
 $('#deadline-dismiss').onclick=()=>save('dismiss');
 $('#deadline-add-entry').onclick=()=>addEntry();
 $('#deadline-review-reload').onclick=()=>current&&openReview(current.id);
 $('#deadline-review-form').addEventListener('input',event=>{
  const fieldset=event.target.closest('[data-deadline-entry]');if(!fieldset)return;const entry=entries.get(fieldset.dataset.deadlineEntry);
  if(event.target.matches('[data-deadline-include]')){const included=event.target.checked;fieldset.querySelectorAll('[data-field]').forEach(field=>{field.disabled=!included});fieldset.querySelectorAll('[data-deadline-calculate]').forEach(button=>button.disabled=!included);return;}
  if(event.target.closest('.deadline-simulation')||event.target.dataset.field==='due'){
   if(entry.calculation){if(event.target.closest('.deadline-simulation'))fieldset.querySelector('[data-field="due"]').value='';entry.calculation=null;const feedback=fieldset.querySelector('[data-calculation-result]');if(feedback)feedback.textContent='Parâmetros alterados. Simule novamente ou informe uma data conferida manualmente.';}
  }
 });
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.deadlineReview)openReview(button.dataset.deadlineReview);
  if(button.dataset.deadlineCalculate)calculate(button.dataset.deadlineCalculate);
  if(button.hasAttribute('data-deadline-case')){
   caseFilter=button.dataset.deadlineCase||getCase().cnj;page=1;status='pending';search='';$('#deadline-search').value='';if($('#detail-modal').open)$('#detail-modal').close();navigate('deadlines');
  }
  if(button.id==='deadline-reopen'&&current)save('reopen');
 });
 return {render(data,nextView){state=data;view=nextView;$('#deadlines-section').hidden=view!=='deadlines'||!admin();$('#nav-deadlines').textContent=number(data.deadlineStats?.pending||0);$('#overview-deadline-count').textContent=number(data.deadlineStats?.pending||0);$('#overview-deadline-review').hidden=!admin();if(view==='deadlines'&&admin())load();},openReview,loadCaseSummary};
}
