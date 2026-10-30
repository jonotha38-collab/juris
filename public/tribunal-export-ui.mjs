import {esc,number,today} from './ui.mjs';
import {createTribunalExcel,checkReportCounts} from './tribunal-report.mjs';

export function createTribunalExportUI({api,notice,getContext}) {
 const $=selector=>document.querySelector(selector),modal=$('#tribunal-export-modal'),form=$('#tribunal-export-form');
 let rows=[],selected=new Set(),context=null,loading=false,busy=false,generation=0,controller=null,opener=null;
 const error=message=>{$('#tribunal-export-error').textContent=message;};
 function paint(){
  const query=$('#tribunal-export-search').value.trim().toLocaleLowerCase('pt-BR');
  const visible=rows.filter(row=>row.tribunal.toLocaleLowerCase('pt-BR').includes(query));
  $('#tribunal-export-options').innerHTML=visible.length?visible.map(row=>`<label class="tribunal-export-option"><input type="checkbox" name="tribunals" value="${esc(row.tribunal)}" ${selected.has(row.tribunal)?'checked':''} ${busy?'disabled':''}><span><strong>${esc(row.tribunal)}</strong><small>${number(row.processes)} processo${row.processes===1?'':'s'} · ${number(row.publications)} publicaç${row.publications===1?'ão':'ões'}</small></span></label>`).join(''):`<p class="tribunal-export-empty">${loading?'Carregando tribunais…':rows.length?'Nenhum tribunal corresponde à busca. Limpe o texto para ver todos.':'Nenhum tribunal nesta seleção. Ajuste a OAB ou os filtros da carteira.'}</p>`;
  $('#tribunal-export-clear-search').hidden=!query;
  $('#tribunal-export-count').textContent=number(selected.size)+' de '+number(rows.length)+' tribunais selecionados';
  $('#tribunal-export-total').textContent=selected.size?number(rows.filter(row=>selected.has(row.tribunal)).reduce((sum,row)=>sum+row.processes,0))+' vínculos de processos com tribunais. Um CNJ pode constar em mais de um tribunal.':'Selecione ao menos um tribunal para gerar o arquivo.';
  $('#tribunal-export-generate').disabled=busy||loading||!selected.size;
  for(const id of ['#tribunal-export-all','#tribunal-export-none','#tribunal-export-search'])$(id).disabled=busy||loading||!rows.length;
  form.elements.split.disabled=busy;form.elements.publications.disabled=busy;
 }
 async function open(trigger){
  if(busy){if(!modal.open)modal.showModal();return;}
  opener=trigger||document.activeElement;controller?.abort();controller=new AbortController();const revision=++generation;
  const current=getContext();context={...current,params:new URLSearchParams(current.params)};context.params.delete('tribunal');context.params.delete('tribunals');
  rows=[];selected=new Set();loading=true;error('');$('#tribunal-export-progress').textContent='';$('#tribunal-export-search').value='';
  $('#tribunal-export-context').textContent=context.oabLabel+(context.params.get('q')?' · Busca: '+context.params.get('q'):'')+(context.params.get('favorite')==='1'?' · Favoritos':'')+(context.params.get('unread')==='1'?' · Não lidas':'')+(context.params.get('stage')?' · Situação filtrada':'');
  $('#tribunal-export-retry').hidden=true;if(!modal.open)modal.showModal();paint();
  try{
   const result=await api('reports/tribunals?'+context.params,undefined,undefined,{signal:controller.signal});
   if(revision!==generation||!modal.open)return;rows=result.rows;selected=new Set(rows.filter(row=>!context.selectedTribunal||row.tribunal===context.selectedTribunal).map(row=>row.tribunal));
   if(!selected.size&&rows.length)selected=new Set(rows.map(row=>row.tribunal));
  }catch(cause){if(revision===generation&&!controller.signal.aborted){error(cause.message);$('#tribunal-export-retry').hidden=false;}}
  finally{if(revision===generation){loading=false;paint();if(modal.open)$('#tribunal-export-search').focus();}}
 }
 async function collect(kind,params,signal){
  const collected=[],seen=new Set();let cursor=null;
  do{
   if(signal.aborted)throw new DOMException('Exportação cancelada.','AbortError');
   const request=new URLSearchParams(params);if(cursor)request.set('after',cursor);
   const result=await api('reports/'+kind+'?'+request,undefined,undefined,{signal});collected.push(...result.rows);
   $('#tribunal-export-progress').textContent='Preparando arquivo · '+number(collected.length)+(kind==='processes'?' vínculos de processos carregados…':' publicações carregadas…');
   if(result.next&&seen.has(result.next))throw new Error('Não foi possível avançar a exportação. Tente gerar novamente.');
   if(result.next)seen.add(result.next);cursor=result.next;
  }while(cursor);
  return collected;
 }
 async function generate(){
  if(busy||loading||!selected.size)return;
  const chosen=[...selected],includePublications=form.elements.publications.checked,split=form.elements.split.checked;
  controller?.abort();controller=new AbortController();const signal=controller.signal,params=new URLSearchParams(context.params);
  chosen.forEach(tribunal=>params.append('tribunals',tribunal));busy=true;paint();error('');$('#tribunal-export-retry').hidden=true;
  $('#tribunal-export-progress').textContent='Preparando a seleção…';$('#tribunal-export-generate').setAttribute('aria-busy','true');
  try{
   const fresh=await api('reports/tribunals?'+context.params,undefined,undefined,{signal});
   const processes=await collect('processes',params,signal);
   const publications=includePublications?await collect('publications',params,signal):[];
   if(signal.aborted)return;checkReportCounts(fresh.rows,chosen,processes,publications,includePublications);
   const file=createTribunalExcel({tribunals:chosen,processes,publications,split,includePublications,oabLabel:context.oabLabel});
   const link=document.createElement('a'),url=URL.createObjectURL(file);link.href=url;link.download='juris-tribunais-'+chosen.length+'-'+today()+'.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
   notice('Excel gerado com '+number(chosen.length)+' '+(chosen.length===1?'tribunal':'tribunais')+' e '+number(new Set(processes.map(row=>row.cnj)).size)+' processos únicos.');modal.close();
  }catch(cause){if(signal.aborted){if(modal.open)$('#tribunal-export-progress').textContent='Exportação cancelada. Nenhum arquivo foi gerado.';}else{error(cause.message);$('#tribunal-export-progress').textContent='Sua seleção foi preservada. Tente gerar novamente.';$('#tribunal-export-error').focus();}}
  finally{busy=false;$('#tribunal-export-generate').removeAttribute('aria-busy');paint();}
 }
 form.addEventListener('submit',event=>{event.preventDefault();generate();});
 $('#tribunal-export-options').addEventListener('change',event=>{const input=event.target;if(input.name!=='tribunals'||busy)return;input.checked?selected.add(input.value):selected.delete(input.value);paint();[...$('#tribunal-export-options').querySelectorAll('input')].find(item=>item.value===input.value)?.focus();});
 $('#tribunal-export-search').addEventListener('input',paint);
 $('#tribunal-export-clear-search').onclick=()=>{$('#tribunal-export-search').value='';paint();$('#tribunal-export-search').focus();};
 $('#tribunal-export-all').onclick=()=>{selected=new Set(rows.map(row=>row.tribunal));paint();};
 $('#tribunal-export-none').onclick=()=>{selected.clear();paint();};
 $('#tribunal-export-retry').onclick=()=>open(opener);
 $('#tribunal-export-cancel').onclick=()=>modal.close();
 modal.addEventListener('cancel',()=>controller?.abort());
 modal.addEventListener('close',()=>{generation++;controller?.abort();loading=false;opener?.focus?.();});
 return {open};
}
