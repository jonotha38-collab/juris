import {classifyImport} from './import-format.mjs';
import {today,number} from './ui.mjs';
export function createImportUI({api,completed}){
 const $=s=>document.querySelector(s),form=$('#import-form'),button=form.querySelector('.primary');
 let prepared=null,busy=false;
 function reset(){prepared=null;$('#import-preview').hidden=true;$('#import-progress').textContent='';button.textContent='Analisar arquivo';}
 function lock(value){busy=value;for(const el of form.elements)if(el.name)el.disabled=value;button.disabled=value;}
 function failure(error){$('#import-error').textContent=error instanceof SyntaxError?'Arquivo JSON inválido.':error.message;}
 form.addEventListener('input',reset);
 form.addEventListener('change',reset);
 $('#import-modal').addEventListener('close',()=>{if(!busy)reset()});
 async function analyze(){
  const file=form.elements.file.files[0];
  if(!file?.size)throw new Error('Escolha um arquivo JSON com registros.');
  if(file.size>2000000)throw new Error('Use um arquivo de até 2 MB por lote.');
  const parsed=classifyImport(JSON.parse(await file.text()));
  const body={oab:form.elements.oab.value,uf:form.elements.uf.value,start:today(),end:today()};
  const preview=await api('import',{...body,items:parsed.items,preview:true});
  prepared={body,items:parsed.kind==='processes'?parsed.records.map(r=>JSON.parse(r.raw)._juris_import.fields):parsed.items,preview};
  $('#import-preview').hidden=false;
  $('#import-preview-text').textContent=preview.kind==='processes'
   ?number(preview.total)+' linhas: '+number(preview.added)+' processos novos, '+number(preview.existing)+' já cadastrados e '+number(preview.duplicates)+' repetições no arquivo. O primeiro registro de cada CNJ será usado. Nenhuma publicação oficial será criada.'
   :number(preview.total)+' publicações oficiais para vincular à OAB informada. Identificadores já cadastrados serão atualizados.';
  button.textContent='Confirmar importação';
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;$('#import-error').textContent='';
  if(!prepared){lock(true);try{await analyze()}catch(error){failure(error)}finally{lock(false)}return;}
  lock(true);const current=prepared;let processed=0,monitorId='';
  try{
   for(let i=0;i<current.items.length;i+=100){
    $('#import-progress').textContent='Importando '+number(processed)+' de '+number(current.items.length)+' registros…';
    const result=await api('import',{...current.body,items:current.items.slice(i,i+100)});
    monitorId=result.monitorId;processed+=current.items.slice(i,i+100).length;
   }
   $('#import-modal').close();reset();await completed({monitorId,kind:current.preview.kind,processed});
  }catch(error){failure(new Error(error.message+' Os lotes concluídos foram preservados. Você pode tentar novamente; o mesmo CNJ não cria outro processo.'));}
  finally{lock(false);$('#import-progress').textContent='';}
 });
 return {open(monitor){if(busy)return;reset();$('#import-error').textContent='';if(monitor){form.elements.oab.value=monitor.oab;form.elements.uf.value=monitor.uf;}$('#import-modal').showModal();}};
}
