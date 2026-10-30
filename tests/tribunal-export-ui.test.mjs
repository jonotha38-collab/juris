import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {reportFixture,zipEntries} from './report-fixture.mjs';

test('the actual Juris page selects tribunals, exports complete XLSX files, preserves retries and cancels downloads',async t=>{
 const {client,engine,api,second}=await reportFixture();
 const html=await readFile(new URL('../public/painel.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://juris.example/painel.html?view=tribunals',pretendToBeVisual:true}),win=dom.window,restore=new Map(),files=[],downloads=[],requests=[];
 let failProcess=false,failOptions=false,stall=false,pending=false,aborted=false;
 function bind(name,value){restore.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}
 win.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});win.HTMLElement.prototype.scrollIntoView=function(){};
 win.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 win.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new win.Event('close'));};
 win.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 for(const [name,value] of Object.entries({window:win,document:win.document,location:win.location,history:win.history,localStorage:win.localStorage,FormData:win.FormData,CustomEvent:win.CustomEvent,setInterval:()=>0}))bind(name,value);
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 URL.createObjectURL=blob=>{files.push(blob);return 'blob:juris-export-'+files.length;};URL.revokeObjectURL=()=>{};
 bind('fetch',async(path,options={})=>{
  const url=new URL(path,'https://juris.example');requests.push(url);
  if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(url.pathname==='/api/reports/tribunals'&&failOptions){failOptions=false;return Response.json({error:'Falha de carregamento de teste.'},{status:503});}
  if(url.pathname==='/api/reports/processes'&&failProcess){failProcess=false;return Response.json({error:'Falha temporária de teste.'},{status:503});}
  if(url.pathname==='/api/reports/processes'&&stall){pending=true;await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true}));}
  try{const value=await engine.handle(new Request(url,options),'office');if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');return Response.json(value);}catch(error){if(error.name==='AbortError')throw error;return Response.json({error:error.message},{status:error.status||500});}
 });
 t.after(()=>{dom.window.close();for(const [name,descriptor] of restore){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;client.close();});
 const $=selector=>win.document.querySelector(selector),inputs=()=>[...$('#tribunal-export-options').querySelectorAll('input')],names=entries=>[...new JSDOM(entries.get('xl/workbook.xml'),{contentType:'application/xml'}).window.document.querySelectorAll('sheet')].map(sheet=>sheet.getAttribute('name'));
 async function until(predicate,label){for(let i=0;i<200;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail(label||'UI did not settle');}
 const selectOnly=tribunal=>{$('#tribunal-export-none').click();inputs().find(input=>input.value===tribunal).click();};
 await import('../public/juris.js?tribunal-export-dom-test');
 await until(()=>$('#tribunal-cards').children.length===3,'Tribunal cards');
 $('#export-tribunals').focus();$('#export-tribunals').click();
 await until(()=>$('#tribunal-export-modal').open&&inputs().length===3,'Export selection');
 assert.match($('#tribunal-export-count').textContent,/3 de 3/);assert.equal($('#tribunal-export-modal').getAttribute('aria-labelledby'),'tribunal-export-title');
 $('#tribunal-export-none').click();assert.equal($('#tribunal-export-generate').disabled,true);
 $('#tribunal-export-search').value='SEEU';$('#tribunal-export-search').dispatchEvent(new win.Event('input',{bubbles:true}));
 assert.equal(inputs().length,1);inputs()[0].click();assert.match($('#tribunal-export-count').textContent,/1 de 3/);assert.equal(win.document.activeElement,inputs()[0]);
 $('#tribunal-export-form').elements.publications.checked=false;$('#tribunal-export-generate').click();
 await until(()=>downloads.length===1&&!$('#tribunal-export-modal').open,'Selected Excel download');
 assert.match(downloads[0].name,/juris-tribunais-1-.*\.xlsx/);assert.equal(win.document.activeElement,$('#export-tribunals'));
 let entries=zipEntries(await files[0].arrayBuffer());assert.deepEqual(names(entries),['Resumo','SEEU']);assert.match(entries.get('xl/worksheets/sheet2.xml'),/Cadastro sem publicações/);
 $('#export-tribunals').click();await until(()=>inputs().length===3&&!$('#tribunal-export-all').disabled,'Reopened selection');selectOnly('TJRJ');$('#tribunal-export-form').elements.publications.checked=true;
 failProcess=true;$('#tribunal-export-generate').click();
 await until(()=>$('#tribunal-export-error').textContent.includes('Falha temporária'),'Inline export error');
 assert.equal($('#tribunal-export-modal').open,true);assert.deepEqual(inputs().filter(input=>input.checked).map(input=>input.value),['TJRJ']);assert.equal(downloads.length,1);
 $('#tribunal-export-generate').click();await until(()=>downloads.length===2&&!$('#tribunal-export-modal').open,'Retry same selection');
 entries=zipEntries(await files[1].arrayBuffer());assert.deepEqual(names(entries),['Resumo','TJRJ','Publicações']);
 $('#tribunal').value='TJSP';$('#tribunal').dispatchEvent(new win.Event('change',{bubbles:true}));
 await until(()=>$('#context-description').textContent.includes('TJSP'),'Single-court context');$('#export-tribunals').click();
 await until(()=>inputs().length===3&&!$('#tribunal-export-all').disabled,'Single-court defaults');assert.deepEqual(inputs().filter(input=>input.checked).map(input=>input.value),['TJSP']);$('#tribunal-export-cancel').click();
 $('#oab-scope').value=second;$('#oab-scope').dispatchEvent(new win.Event('change',{bubbles:true}));
 await until(()=>$('#context-description').textContent.includes('54321'),'OAB change');$('#export-tribunals').click();
 await until(()=>inputs().length===2&&!$('#tribunal-export-all').disabled,'Scoped options');selectOnly('TJSP');$('#tribunal-export-generate').click();
 await until(()=>downloads.length===3&&!$('#tribunal-export-modal').open,'Scoped OAB download');
 const scoped=requests.filter(url=>url.pathname==='/api/reports/processes').at(-1);assert.equal(scoped.searchParams.get('monitor'),second);assert.deepEqual(scoped.searchParams.getAll('tribunals'),['TJSP']);
 assert.equal((await api('reports/publications?monitor='+encodeURIComponent(second)+'&tribunals=TJSP')).rows.length,1);
 $('#export-tribunals').click();await until(()=>inputs().length===2&&!$('#tribunal-export-all').disabled,'Cancellation selection');stall=true;$('#tribunal-export-generate').click();
 await until(()=>pending,'Pending export');assert.equal($('#tribunal-export-generate').disabled,true);$('#tribunal-export-cancel').click();
 await until(()=>aborted,'Abort request');assert.equal(downloads.length,3);stall=false;
 await new Promise(resolve=>setTimeout(resolve,30));failOptions=true;$('#export-tribunals').click();
 await until(()=>!$('#tribunal-export-retry').hidden,'Options failure recovery');assert.equal($('#tribunal-export-generate').disabled,true);
 $('#tribunal-export-retry').click();await until(()=>inputs().length===2&&!$('#tribunal-export-all').disabled,'Reload options');assert.match($('#tribunal-export-count').textContent,/2 de 2/);
 $('#tribunal-export-cancel').click();await new Promise(resolve=>setTimeout(resolve,100));
});
