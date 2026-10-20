import {esc,cnj,fmt,today,number} from './ui.mjs';
export function createAIUI({api,notice,refresh,context,navigate,getCase}){
 const $=selector=>document.querySelector(selector),labels={todo:'A fazer · sugerido',deadline:'Prazo a conferir',hearing:'Compromisso a conferir',review:'Conferir providência'};
 let state=null,view='',focus='pending',page=1,caseFilter='',generation=0,settings=null,settingsVersion=0,current=null,dialogGeneration=0,working=false,stop=false,workingCase='';
 const admin=()=>state?.permissions?.admin===true;
 const empty=message=>'<div class="ai-empty"><p>'+esc(message)+'</p></div>';
 function params(){const p=context();p.set('focus',focus);p.set('page',String(page));if(caseFilter)p.set('cnj',caseFilter);return p;}
 function paintWorking(){
  $('#ai-run-batch').disabled=working||!settings?.configured||!settings?.enabled;$('#ai-stop').hidden=!working;
  $('#ai-run-batch').textContent=working?'Analisando publicações…':'Analisar carteira';
  $('#ai-section').classList.toggle('is-analyzing',working);
  $('#case-ai-analyze').textContent=workingCase===getCase().cnj?'Pausar após este lote':'Analisar com IA';
 }
 async function load(){
  if(!admin()||view!=='ai')return;const revision=++generation;$('#ai-list').setAttribute('aria-busy','true');
  try{
   const result=await api('ai?'+params());if(revision!==generation||view!=='ai')return;settings=result.config;
   if(page>1&&!result.rows.length&&result.total){page=Math.max(1,Math.ceil(result.total/result.pageSize));return load();}if(!result.total)page=1;
   const summary=result.summary;
   for(const key of ['pending','possible_overdue','needs_date','accepted','stale'])$('#ai-count-'+key).textContent=number(summary[key]);
   $('#ai-coverage').textContent=number(summary.analyzed)+' de '+number(summary.processes)+' processos com análise do histórico capturado concluída · '+number(summary.queued)+' aguardando análise ou retomada.';
   $('#ai-budget-label').textContent=number(settings.usage.charged_tokens)+' / '+number(settings.daily_limit)+' tokens no limite diário';
   $('#ai-budget').max=settings.daily_limit;$('#ai-budget').value=Math.min(settings.daily_limit,settings.usage.charged_tokens);
   $('#ai-configuration-note').hidden=!!settings.configured&&!!settings.enabled;
   $('#ai-case-filter').hidden=!caseFilter;$('#ai-case-number').textContent=caseFilter?cnj(caseFilter):'';
   $('#ai-focus').value=focus;
   $('#ai-list').innerHTML=result.rows.length?result.rows.map(s=>{
    const past=s.due_date&&s.due_date<result.today&&!s.stale&&s.status==='pending';
    return `<article class="ai-suggestion ${past?'possible-late':''} ${s.stale?'source-stale':''}"><div class="ai-card-meta"><span class="tag">${esc(s.tribunal)}</span><span class="ai-origin">Sugestão de IA</span>${s.stale?'<span class="pending-alert">Fonte alterada</span>':''}</div><p class="ai-client">${esc(s.parties.title)}</p><small>${esc(cnj(s.cnj))}</small><h3>${esc(s.title)}</h3><p class="ai-description">${esc(s.description.slice(0,240))}</p><blockquote>${esc(s.excerpt.slice(0,270))}${s.excerpt.length>270?'…':''}</blockquote><div class="ai-card-date ${past?'is-late':''}">${past?'Possível atraso · ':s.due_date?'Data no texto · ':''}${s.due_date?fmt(s.due_date):s.period?esc(s.period)+' · início a confirmar':'Sem vencimento identificado'}</div><div class="ai-card-foot"><span>${s.status==='accepted'?'Tratada pela equipe':s.status==='dismissed'?'Descartada com motivo':labels[s.category]}</span><button class="secondary" data-ai-suggestion="${esc(s.id)}">${s.status==='pending'?'Conferir e organizar':'Ver conferência'} ↗</button></div></article>`;
   }).join(''):empty(focus==='pending'?'Nenhuma sugestão pendente nesta seleção. Configure a IA e analise as publicações. Ausência de sugestão não significa ausência de providências.':'Nenhum item neste filtro. Experimente outra situação ou outro processo.');
   $('#ai-pagination-label').textContent=number(result.total)+' sugestões · página '+page;$('#ai-previous').disabled=page===1;$('#ai-next').disabled=page*result.pageSize>=result.total;
   document.querySelectorAll('[data-ai-focus]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.aiFocus===focus)));
   paintWorking();
  }catch(error){if(revision===generation)$('#ai-list').innerHTML=empty(error.message);}
  finally{if(revision===generation)$('#ai-list').setAttribute('aria-busy','false');}
 }
 async function openSettings(){
  if(!admin())return;$('#ai-settings-error').textContent='';$('#ai-settings-feedback').textContent='';
  if(!$('#ai-settings-modal').open)$('#ai-settings-modal').showModal();
  try{
   settings=await api('ai/config');settingsVersion=settings.version;const form=$('#ai-settings-form');
   form.elements.api_key.value='';form.elements.api_key.disabled=!settings.can_save_key;form.elements.enabled.checked=settings.enabled;form.elements.automatic.checked=settings.automatic;form.elements.daily_limit.value=settings.daily_limit;
   $('#ai-key-state').textContent=settings.key_source==='environment'?'Chave configurada no ambiente da Vercel.':settings.key_source==='saved'?'Chave salva de forma criptografada. Deixe o campo em branco para mantê-la.':'Cadastre uma chave da API da OpenAI para ativar a análise.';
   if(!settings.can_save_key)$('#ai-key-state').textContent+=' O servidor precisa de SESSION_SECRET para salvar uma chave pelo painel.';
   $('#ai-disconnect').hidden=settings.key_source!=='saved';$('#ai-settings-model').textContent=settings.model;
  }catch(error){$('#ai-settings-error').textContent=error.message;}
 }
 async function configure(remove=false){
  const form=$('#ai-settings-form'),button=$('#ai-settings-save');button.disabled=true;$('#ai-settings-error').textContent='';
  try{
   const body={version:settingsVersion,enabled:remove?false:form.elements.enabled.checked,automatic:form.elements.automatic.checked,daily_limit:Number(form.elements.daily_limit.value),...(remove?{remove_key:true}:{api_key:form.elements.api_key.value})};
   settings=await api('ai/config',body,'PUT');settingsVersion=settings.version;form.elements.api_key.value='';form.elements.enabled.checked=settings.enabled;
   $('#ai-settings-feedback').textContent=remove?'Chave removida e IA desativada. As análises e tarefas anteriores foram preservadas.':'Configuração salva. As análises usarão o limite diário informado.';
   $('#ai-key-state').textContent=settings.configured?'Chave configurada no servidor.':'Nenhuma chave configurada.';$('#ai-disconnect').hidden=settings.key_source!=='saved';
   await refresh();if($('#detail-modal').open)await loadCase();
  }catch(error){$('#ai-settings-error').textContent=error.message;}
  finally{button.disabled=false;}
 }
 async function analyze(cnjValue=''){
  if(working){stop=true;$('#ai-progress-message').textContent='A análise será pausada depois do lote em andamento.';$('#case-ai-feedback').textContent='A análise será pausada depois do lote em andamento.';return;}
  working=true;stop=false;workingCase=cnjValue;paintWorking();
  try{settings=await api('ai/config');if(!settings.configured||!settings.enabled){working=false;workingCase='';paintWorking();await openSettings();return;}}catch(error){working=false;workingCase='';paintWorking();notice(error.message,true);if(cnjValue)$('#case-ai-feedback').textContent=error.message;return;}
  let batches=0;
  const feedback=message=>{$('#ai-progress-message').textContent=message;if(cnjValue&&getCase().cnj===cnjValue)$('#case-ai-feedback').textContent=message;};
  try{
   for(let i=0;i<20&&!stop;i++){
    feedback('Lendo publicações · lote '+(i+1)+' em andamento…');
    const result=cnjValue?await api('ai/process/'+cnjValue,{}):await api('ai/run-next?'+context(),{});
    if(result.disabled){feedback('A IA está desativada. Confira a configuração.');break;}
    if(result.busy){feedback('Este processo já está sendo analisado. Aguarde e atualize o painel.');break;}
    if(result.worked)batches++;
    await refresh();if(cnjValue&&$('#detail-modal').open)await loadCase();
    if(!result.worked||cnjValue&&!result.coverage.remaining){feedback(result.cached?'O histórico disponível já foi analisado; nenhum novo consumo de IA.':'Análise concluída para este ciclo. Confira as sugestões antes de criar as tarefas.');break;}
    if(i===19)feedback('20 lotes concluídos. As sugestões estão disponíveis; continue a análise para ler os itens restantes.');
   }
   if(stop)feedback('Análise pausada. '+number(batches)+' lote(s) concluído(s); o progresso está salvo.');
  }catch(error){feedback(error.message);notice(error.message,true);}
  finally{working=false;workingCase='';paintWorking();await refresh();}
 }
 function renderSuggestion(result,message=''){
  current=result.suggestion;const s=current,pending=s.status==='pending',form=$('#ai-review-form');
  $('#ai-review-title').textContent=pending?'Conferir a sugestão da IA':'Sugestão tratada pela equipe';
  $('#ai-review-context').textContent=s.parties.title+' · '+cnj(s.cnj)+' · '+s.tribunal;
  $('#ai-review-meta').textContent='Disponibilização: '+fmt(s.date)+' · '+labels[s.category]+' · versão da fonte '+s.source_version;
  $('#ai-review-excerpt').textContent=s.excerpt;$('#ai-review-source').textContent=s.source_text||'';
  $('#ai-review-warning').textContent=s.stale?'A fonte mudou ou a publicação foi cancelada. A indicação anterior está preservada para histórico. Reanalise o processo antes de criar uma tarefa a partir da versão atual.':s.due_date&&s.due_date<today()?'A data citada no texto já passou. Confira a intimação, o cumprimento e a regra aplicável antes de considerar que existe prazo perdido.':'Esta é uma sugestão de IA. Confira o texto, o destinatário e o que já foi cumprido. Datas relativas dependem da conferência do termo inicial e do calendário.';
  const certificate=$('#ai-review-certificate');certificate.hidden=!s.certificate;if(s.certificate)certificate.href=s.certificate;else certificate.removeAttribute('href');
  form.elements.title.value=s.title;form.elements.description.value=s.description;form.elements.due_date.value=s.due_date||'';
  form.elements.assignee_id.innerHTML='<option value="">Escolha o responsável</option>'+result.people.filter(person=>person.active).map(person=>`<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('');
  form.elements.task_id.innerHTML='<option value="">Criar nova tarefa em A fazer</option>'+result.existing_tasks.map(task=>`<option value="${esc(task.id)}">${esc(task.title)} · ${task.status==='done'?'concluída':task.due_date?fmt(task.due_date):'sem data'}</option>`).join('');
  form.elements.reason.value='';$('#ai-source-checked').checked=false;$('#ai-accept').hidden=s.stale;form.hidden=!pending;
  for(const name of ['title','description','assignee_id','due_date'])form.elements[name].disabled=false;
  $('#ai-review-resolution').innerHTML=pending?'':`<p>${s.status==='accepted'?'Sugestão organizada nas tarefas':'Sugestão descartada'} por ${esc(s.decided_by)}.${s.decision_note?' '+esc(s.decision_note):''}</p>${s.task_id?`<button class="secondary" type="button" data-task-id="${esc(s.task_id)}">Abrir tarefa vinculada ↗</button>`:''}`;
  $('#ai-review-feedback').textContent=message;$('#ai-review-error').textContent='';$('#ai-review-reload').hidden=true;
 }
 async function openSuggestion(id){
  if(!admin())return;const revision=++dialogGeneration;current=null;
  $('#ai-review-title').textContent='Carregando sugestão…';$('#ai-review-form').hidden=true;$('#ai-review-resolution').innerHTML='';$('#ai-review-error').textContent='';$('#ai-review-feedback').textContent='';
  for(const id of ['#ai-review-context','#ai-review-meta','#ai-review-excerpt','#ai-review-source','#ai-review-warning'])$(id).textContent='';
  $('#ai-review-certificate').hidden=true;if($('#ai-review-modal').open)$('#ai-review-modal').close();$('#ai-review-modal').showModal();
  try{const result=await api('ai/suggestions/'+encodeURIComponent(id));if(revision===dialogGeneration&&$('#ai-review-modal').open)renderSuggestion(result);}
  catch(error){if(revision===dialogGeneration)$('#ai-review-error').textContent=error.message;}
 }
 async function decide(action){
  if(!current)return;const id=current.id,revision=dialogGeneration,form=$('#ai-review-form'),button=action==='accept'?$('#ai-accept'):$('#ai-dismiss');button.disabled=true;$('#ai-review-error').textContent='';
  try{
   const body={action,version:current.version,source_checked:$('#ai-source-checked').checked,reason:form.elements.reason.value,task_id:form.elements.task_id.value||null,title:form.elements.title.value,description:form.elements.description.value,assignee_id:form.elements.assignee_id.value,due_date:form.elements.due_date.value||null};
   const result=await api('ai/suggestions/'+encodeURIComponent(id),body);
   if(revision===dialogGeneration&&$('#ai-review-modal').open)renderSuggestion(result,action==='accept'?'Providência organizada. A tarefa já aparece em A fazer; datas vencidas registradas aparecem em Atrasadas.':'Sugestão descartada com o motivo registrado.');
   await refresh();
  }catch(error){if(revision===dialogGeneration){$('#ai-review-error').textContent=error.message;$('#ai-review-reload').hidden=error.status!==409;}}
  finally{button.disabled=false;}
 }
 async function loadCase(){
  if(!admin())return;const cnjValue=getCase().cnj;if(!cnjValue)return;
  try{const result=await api('ai/process/'+cnjValue);if(getCase().cnj!==cnjValue)return;settings=result.config;
   $('#case-ai-coverage').textContent=result.coverage.total?number(result.coverage.completed)+' de '+number(result.coverage.total)+' publicações analisadas · '+number(result.summary.pending)+' sugestões a conferir.':'Nenhuma publicação capturada para análise. O cadastro do processo não contém o teor dos autos.';
   $('#case-ai-analyze').disabled=!result.coverage.total;paintWorking();
  }catch(error){if(getCase().cnj===cnjValue)$('#case-ai-coverage').textContent=error.message;}
 }
 $('#ai-settings-open').onclick=openSettings;$('#ai-configuration-button').onclick=openSettings;
 $('#ai-settings-form').onsubmit=event=>{event.preventDefault();configure();};$('#ai-disconnect').onclick=()=>configure(true);
 $('#ai-run-batch').onclick=()=>analyze();$('#ai-stop').onclick=()=>{stop=true;$('#ai-progress-message').textContent='A análise será pausada depois do lote em andamento.';};
 $('#ai-focus').onchange=event=>{focus=event.target.value;page=1;load();};
 $('#ai-previous').onclick=()=>{page--;load();};$('#ai-next').onclick=()=>{page++;load();};
 $('#ai-clear-case').onclick=()=>{caseFilter='';page=1;load();};
 $('#ai-review-form').onsubmit=event=>{event.preventDefault();decide('accept');};$('#ai-dismiss').onclick=()=>decide('dismiss');
 $('#ai-review-form').elements.task_id.onchange=event=>{for(const name of ['title','description','assignee_id','due_date'])$('#ai-review-form').elements[name].disabled=!!event.target.value;};
 $('#ai-review-reload').onclick=()=>current&&openSuggestion(current.id);
 $('#case-ai-analyze').onclick=()=>analyze(getCase().cnj);
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.aiSuggestion)openSuggestion(button.dataset.aiSuggestion);
  if(button.dataset.aiFocus){focus=button.dataset.aiFocus;page=1;load();}
  if(button.hasAttribute('data-ai-case')){caseFilter=button.dataset.aiCase||getCase().cnj;page=1;focus='pending';if($('#detail-modal').open)$('#detail-modal').close();navigate('ai');}
 });
 return {render(data,nextView){state=data;view=nextView;$('#ai-section').hidden=view!=='ai'||!admin();$('#nav-ai').textContent=number(data.aiStats?.pending||0);if(view==='ai'&&admin())load();},loadCase,openSuggestion};
}
