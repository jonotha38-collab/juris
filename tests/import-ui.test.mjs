import test from 'node:test';
import assert from 'node:assert/strict';
import {createImportUI} from '../public/import-ui.mjs';
function element(){const handlers={};return {handlers,hidden:false,disabled:false,textContent:'',addEventListener(type,handler){handlers[type]=handler;}};}
function screen(rows){
 const button=element(),form=element(),dialog=element(),nodes={};
 const oab={name:'oab',value:'12345'},uf={name:'uf',value:'SP'},file={name:'file',files:[{size:1000,text:async()=>JSON.stringify(rows)}]};
 form.elements=Object.assign([oab,uf,file],{oab,uf,file});form.querySelector=()=>button;
 dialog.showModal=()=>{dialog.open=true};dialog.close=()=>{dialog.open=false;dialog.handlers.close?.()};
 for(const id of ['import-preview','import-preview-text','import-progress','import-error'])nodes['#'+id]=element();
 nodes['#import-form']=form;nodes['#import-modal']=dialog;
 globalThis.document={querySelector:selector=>{assert.ok(nodes[selector],selector);return nodes[selector]}};
 return {nodes,form,button,dialog,submit:()=>form.handlers.submit({preventDefault(){}})};
}
test('analyze then confirm sends 720 rows in small batches, with no writes during analysis',async()=>{
 const rows=Array.from({length:720},(_,i)=>({'Número':String(i+1).padStart(20,'0'),'Título':'Pessoa '+i}));
 const s=screen(rows),calls=[],completed=[];
 const importer=createImportUI({api:async(path,body)=>{assert.equal(body.oab,'12345');assert.equal(body.uf,'SP');calls.push(body);return body.preview?{kind:'processes',total:720,added:720,existing:0,duplicates:0}:{monitorId:'office:SP:12345'}},completed:async result=>completed.push(result)});
 importer.open();await s.submit();
 assert.equal(calls.length,1);assert.equal(calls[0].preview,true);assert.equal(completed.length,0);
 assert.equal(s.button.textContent,'Confirmar importação');assert.equal(s.nodes['#import-preview'].hidden,false);
 await s.submit();
 assert.deepEqual(calls.slice(1).map(c=>c.items.length),[100,100,100,100,100,100,100,20]);
 assert.equal(completed[0].processed,720);assert.equal(s.dialog.open,false);assert.equal(s.button.disabled,false);
 delete globalThis.document;
});
test('a changed form invalidates analysis and a failed batch can be retried',async()=>{
 const s=screen([{'Número':'00000000000000000001','Título':'Teste'}]);let failing=false,done=0;
 createImportUI({api:async(path,body)=>{if(body.preview)return {kind:'processes',total:1,added:1,existing:0,duplicates:0};if(failing)throw new Error('Falha de conexão');return {monitorId:'office:SP:12345'}},completed:async()=>done++});
 await s.submit();s.form.handlers.input();assert.equal(s.button.textContent,'Analisar arquivo');
 await s.submit();failing=true;await s.submit();assert.equal(done,0);
 assert.match(s.nodes['#import-error'].textContent,/tentar novamente/);assert.equal(s.button.disabled,false);
 failing=false;await s.submit();assert.equal(done,1);
 delete globalThis.document;
});
