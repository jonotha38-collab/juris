import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {adaptClient} from '../lib/database.mjs';
import {migrate} from '../scripts/migrate.mjs';
import {createEngine,day} from '../core/engine.mjs';
import {createHandler} from '../api/index.mjs';
import {buildAIRequest,encryptAIKey,decryptAIKey} from '../core/ai-provider.mjs';
const CNJ='00000000000000000001';
async function aiFixture({output,provider,env:overrides={}}={}){
 const client=createClient({url:'file::memory:'}),db=adaptClient(client);await migrate(client);
 const env={OPENAI_API_KEY:'sk-test-only-not-a-real-key',SESSION_SECRET:'synthetic-session-secret-for-ai-tests-only-123456',...overrides},calls=[];
 let behavior=provider;
 const fetcher=async(url,options={})=>{
  if(String(url)!=='https://api.openai.com/v1/responses')throw new Error('Unexpected network request in AI test');
  const body=JSON.parse(options.body),input=JSON.parse(body.input);calls.push({url,body,input,headers:options.headers});
  if(behavior)return behavior({body,input,options});
  const first=input.publications[0];
  const value=output?output({body,input}):{summary:'Providência encontrada para conferência.',suggestions:[{source_ref:first.source_ref,category:'deadline',title:'Apresentar manifestação',description:'Conferir destinatário, prazo e providência antes do protocolo.',excerpt:first.text.slice(0,Math.min(180,first.text.length)),due_date:null,period:'15 dias',priority:'high'}]};
  return Response.json({status:'completed',usage:{input_tokens:140,output_tokens:110},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 };
 const engine=createEngine(db,{mode:'vercel',fetcher,aiEnv:env});
 const api=(path,method='GET',body,owner='office',instance=engine)=>instance.handle(new Request('https://juris.example/api/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),owner);
 const at=new Date().toISOString();
 await client.execute({sql:"INSERT INTO members(id,owner,name,email,password_hash,active,session_version,created,updated) VALUES('intern-a','office','Ana','ana@example.invalid','',1,1,?,?)",args:[at,at]});
 const monitor=await api('import','POST',{oab:'12345',uf:'SP',start:day(),end:day(),items:[{'Número':CNJ,'Título':'Cliente de teste','Tribunal':'TJSP'}]});
 const source=(id,text='Intime-se para apresentar manifestação no prazo de 15 dias. Confira o cumprimento da providência.',extra={})=>({id,numero_processo:CNJ,siglaTribunal:'TJSP',data_disponibilizacao:day(),texto:text,hash:'synthetic-hash-'+id,...extra});
 const publish=(...rows)=>engine.saveItems('office',monitor.monitorId,rows);
 return {client,db,env,fetcher,engine,api,calls,source,publish,monitor,setProvider:fn=>{behavior=fn}};
}

test("API keys are encrypted with random IVs and bound to the office and server secret",async function testAIEncryption(){
 const secret='synthetic-secret-with-more-than-thirty-two-characters',key='sk-synthetic-key-never-a-live-credential';
 const first=await encryptAIKey(key,secret,'office'),second=await encryptAIKey(key,secret,'office');
 assert.notEqual(first,second);assert.equal(first.includes(key),false);assert.equal(await decryptAIKey(first,secret,'office'),key);
 await assert.rejects(()=>decryptAIKey(first,secret,'other'),error=>error.status===503);
 await assert.rejects(()=>decryptAIKey(first,secret+'changed','office'),error=>error.status===503);
 await assert.rejects(()=>encryptAIKey(key,'short','office'),error=>error.status===503);
});

test("AI configuration is versioned and never returns the saved key",async function testAIConfiguration(t){
 const {client,api,env,publish,source,calls}=await aiFixture({env:{OPENAI_API_KEY:''}});t.after(()=>client.close());
 let config=await api('ai/config');assert.equal(config.configured,false);assert.equal(config.enabled,false);
 await publish(source(1));await assert.rejects(()=>api('ai/process/'+CNJ,'POST',{}),error=>error.status===400);assert.equal(calls.length,0);
 config=await api('ai/config','PUT',{version:config.version,enabled:true,automatic:true,daily_limit:200000,api_key:'sk-synthetic-saved-key-for-testing-only'});
 assert.equal(config.configured,true);assert.equal(config.key_source,'saved');assert.equal(JSON.stringify(config).includes('sk-'),false);
 const row=(await client.execute('SELECT key_cipher FROM ai_config')).rows[0];assert.equal(row.key_cipher.includes('sk-'),false);
 await api('ai/process/'+CNJ,'POST',{});assert.equal(calls.length,1);assert.equal(calls[0].headers.Authorization,'Bearer sk-synthetic-saved-key-for-testing-only');
 await assert.rejects(()=>api('ai/config','PUT',{version:0,enabled:true,automatic:true,daily_limit:200000}),error=>error.status===409);
 await api('ai/config','PUT',{version:config.version,enabled:false,automatic:false,daily_limit:200000,remove_key:true});
 assert.equal((await api('ai/config')).configured,false);assert.equal((await api('ai')).total,1,'Disconnecting preserves suggestions');
 assert.equal(env.OPENAI_API_KEY,'');
});

test("real Responses protocol is bounded, source based and cached without repeated billing",async function testAIRealProtocolAndCache(t){
 const {client,api,publish,source,calls}=await aiFixture();t.after(()=>client.close());await publish(source(1));
 const result=await api('ai/process/'+CNJ,'POST',{});
 assert.equal(result.worked,true);assert.equal(result.coverage.completed,1);assert.equal(result.coverage.remaining,0);assert.equal(calls.length,1);
 const call=calls[0];assert.equal(call.body.store,false);assert.equal(call.body.text.format.type,'json_schema');assert.equal(call.body.text.format.strict,true);assert.equal(call.body.max_output_tokens,4000);
 assert.equal(call.input.publications[0].text.includes('15 dias'),true);assert.equal(call.body.tools,undefined);
 assert.equal((await api('ai')).rows[0].due_date,null);assert.equal((await api('tasks')).total,0,'A draft must not create an unreviewed task');
 assert.equal((await api('deadlines')).summary.pending,1,'AI analysis cannot resolve the source review');
 const again=await api('ai/process/'+CNJ,'POST',{});assert.equal(again.cached,true);assert.equal(calls.length,1);
 await api('read','POST',{all:true});await api('ai/process/'+CNJ,'POST',{});assert.equal(calls.length,1,'Reading is not a content change');
 const config=await api('ai/config');assert.equal(config.usage.charged_tokens,250);assert.equal(config.usage.calls,1);
});

test("new source versions reopen analysis without rewriting previously accepted tasks",async function testAISourceChanges(t){
 const {client,api,publish,source,calls}=await aiFixture();t.after(()=>client.close());await publish(source(1));await api('ai/process/'+CNJ,'POST',{});
 const s=(await api('ai')).rows[0];
 const accepted=await api('ai/suggestions/'+s.id,'POST',{version:s.version,action:'accept',source_checked:true,assignee_id:'intern-a',due_date:null});
 assert.equal(accepted.task_id!==null,true);assert.equal((await api('tasks/'+accepted.task_id)).task.origin,'ai_deadline');
 assert.match((await api('tasks/'+accepted.task_id)).task.title,/^Conferir prazo:/);
 assert.equal((await api('tasks/pending?focus=todo')).summary.no_date,1);
 await publish(source(1,'Intime-se para apresentar documentos no prazo de cinco dias. Confira a determinação atual.'));
 assert.equal((await api('ai/process/'+CNJ)).coverage.remaining,1);
 assert.equal((await api('tasks/'+accepted.task_id)).aiSource.stale,true);
 await api('ai/process/'+CNJ,'POST',{});assert.equal(calls.length,2);
 assert.equal((await api('ai')).total,1);assert.equal((await api('tasks')).total,1,'Reanalysis cannot silently replace tasks');
});

test("past dates remain possible delays until a human registers a confirmed deadline",async function testAIExplicitPastDate(t){
 const output=({input})=>({summary:'Há uma data a conferir.',suggestions:[{source_ref:input.publications[0].source_ref,category:'deadline',title:'Conferir entrega de documentos',description:'Verificar se a entrega já foi cumprida.',excerpt:input.publications[0].text,due_date:'2020-01-10',period:null,priority:'high'}]});
 const {client,api,publish,source}=await aiFixture({output});t.after(()=>client.close());
 await publish(source(1,'Intime-se para apresentar documentos até o dia 10/01/2020, conforme a determinação judicial.'));await api('ai/process/'+CNJ,'POST',{});
 const queue=await api('ai?focus=possible_overdue');assert.equal(queue.total,1);assert.equal(queue.summary.possible_overdue,1);
 assert.equal((await api('tasks/pending')).summary.overdue,0,'A model date remains a possible delay until reviewed');
 const s=queue.rows[0];
 await assert.rejects(()=>api('ai/suggestions/'+s.id,'POST',{version:s.version,action:'accept',source_checked:false,assignee_id:'admin',due_date:'2020-01-10'}),error=>error.status===400);
 const result=await api('ai/suggestions/'+s.id,'POST',{version:s.version,action:'accept',source_checked:true,assignee_id:'admin',due_date:'2020-01-10'});
 assert.equal((await api('tasks/pending?focus=overdue')).total,1);
 assert.equal((await api('tasks/'+result.task_id)).task.due_date,'2020-01-10');
 await assert.rejects(()=>api('ai/suggestions/'+s.id,'POST',{version:s.version,action:'accept',source_checked:true,assignee_id:'admin',due_date:'2020-01-10'}),error=>error.status===409);
});

test("unprovided publications, invented excerpts and unsupported dates are rejected",async function testAIInvalidEvidenceAndDates(t){
 const {client,api,publish,source,setProvider}=await aiFixture();t.after(()=>client.close());await publish(source(1));
 const bad=[
  {source_ref:'unprovided-ref',excerpt:'Intime-se para apresentar manifestação no prazo de 15 dias.',due_date:null},
  {source_ref:'1',excerpt:'Uma determinação que não existe na publicação original.',due_date:null},
  {source_ref:'1',excerpt:'Intime-se para apresentar manifestação no prazo de 15 dias.',due_date:'2026-10-31'}
 ];
 for(const invalid of bad){
  setProvider(async()=>Response.json({status:'completed',usage:{input_tokens:140,output_tokens:110},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Teste de validação.',suggestions:[{category:'deadline',title:'Conferir prazo',description:'Orientação.',period:'15 dias',priority:'high',...invalid}]})}]}]}));
  await assert.rejects(()=>api('ai/process/'+CNJ,'POST',{}),error=>error.status===502);
  assert.equal((await api('ai')).total,0);assert.equal((await api('ai/process/'+CNJ)).coverage.completed,0);
 }
});

test("daily limits reserve atomically and provider errors back off without leaking details",async function testAIBudgetAndErrors(t){
 const {client,api,publish,source,calls,setProvider}=await aiFixture();t.after(()=>client.close());await publish(source(1));
 let config=await api('ai/config');
 config=await api('ai/config','PUT',{version:config.version,enabled:true,automatic:true,daily_limit:5000});
 await assert.rejects(()=>api('ai/process/'+CNJ,'POST',{}),error=>error.status===429);assert.equal(calls.length,0);
 config=await api('ai/config','PUT',{version:config.version,enabled:true,automatic:true,daily_limit:200000});
 setProvider(async()=>Response.json({error:{message:'Provider detail must not escape: sk-fake-secret'}},{status:429}));
 await assert.rejects(()=>api('ai/process/'+CNJ,'POST',{}),error=>error.status===429&&!error.message.includes('sk-fake'));
 assert.equal((await api('ai/process/'+CNJ)).coverage.completed,0);assert.equal((await api('ai')).total,0);
 const usage=(await api('ai/config')).usage;assert.equal(usage.charged_tokens>5000,true,'An unknown provider usage retains the reservation');
 assert.equal((await api('ai/run-next','POST',{})).empty,true,'A failed job backs off instead of retrying repeatedly');
});

test("incomplete model output preserves the cursor and records actual usage",async function testAIIncompleteOutput(t){
 const {client,api,publish,source,setProvider}=await aiFixture();t.after(()=>client.close());await publish(source(1));
 setProvider(async()=>Response.json({status:'incomplete',usage:{input_tokens:140,output_tokens:4000},output:[]}));
 await assert.rejects(()=>api('ai/process/'+CNJ,'POST',{}),error=>error.status===502);assert.equal((await api('ai')).total,0);
 assert.equal((await api('ai/config')).usage.charged_tokens,4140);assert.equal((await api('ai/process/'+CNJ)).coverage.completed,0);
});

test("source changes during a provider request cannot apply stale output",async function testAICorrectionDuringAnalysis(t){
 const env=await aiFixture(),{client,api,publish,source,setProvider}=env;t.after(()=>client.close());await publish(source(1));
 setProvider(async({input})=>{
  await publish(source(1,'Intime-se para conferir uma determinação nova em cinco dias. Esta é a versão corrigida.'));
  return Response.json({status:'completed',usage:{input_tokens:140,output_tokens:110},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Versão anterior.',suggestions:[{source_ref:'1',category:'todo',title:'Conferir publicação',description:'Conferir.',excerpt:input.publications[0].text,due_date:null,period:null,priority:'normal'}]})}]}]});
 });
 await assert.rejects(()=>api('ai/process/'+CNJ,'POST',{}),error=>error.status===409);
 assert.equal((await api('ai')).total,0);assert.equal((await api('ai/process/'+CNJ)).coverage.completed,0);
 assert.equal((await client.execute('SELECT status FROM ai_runs')).rows[0].status,'error');
});

test("long publications resume without silently dropping their remaining text",async function testAILongPublicationResumes(t){
 const {client,api,publish,source,calls}=await aiFixture();t.after(()=>client.close());
 const text='Intime-se para apresentar documentos no prazo indicado e conferir o cumprimento. '.repeat(380);
 await publish(source(1,text));let result=await api('ai/process/'+CNJ,'POST',{});
 assert.equal(result.coverage.completed,0);assert.equal(result.coverage.remaining,1);
 for(let i=0;i<5&&result.coverage.remaining;i++)result=await api('ai/process/'+CNJ,'POST',{});
 assert.equal(result.coverage.remaining,0);assert.equal(calls.length>=3,true);
 assert.equal(calls.reduce((n,call)=>n+call.input.publications[0].text.length,0),text.trim().length);
 const check=(await client.execute('SELECT next_offset,complete FROM ai_checks')).rows[0];assert.equal(Number(check.next_offset),text.trim().length);assert.equal(Number(check.complete),1);
});

test("analysis locks prevent duplicate requests and keep different case jobs independent",async function testAIJobsAreIndependentAndLocked(t){
 const {client,api,publish,source,engine,monitor,calls,setProvider}=await aiFixture();t.after(()=>client.close());await publish(source(1));
 const second='00000000000000000002';
 await api('import','POST',{oab:'54321',uf:'RJ',start:day(),end:day(),items:[{'Número':second,'Título':'Outro caso','Tribunal':'TJRJ'}]});
 await engine.saveItems('office',monitor.monitorId,[source(2,undefined,{numero_processo:second,siglaTribunal:'TJRJ'})]);
 let release;const gate=new Promise(resolve=>{release=resolve});
 setProvider(async({input})=>{await gate;return Response.json({status:'completed',usage:{input_tokens:140,output_tokens:110},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Sem indicação adicional.',suggestions:[]})}]}]});});
 const first=api('ai/process/'+CNJ,'POST',{});
 for(let i=0;i<100&&calls.length===0;i++)await new Promise(resolve=>setTimeout(resolve,5));
 const parallel=await api('ai/process/'+CNJ,'POST',{});assert.equal(parallel.busy,true);assert.equal(calls.length,1);release();await first;
 assert.equal((await api('ai/process/'+CNJ)).job.status,'done');assert.equal((await api('ai/process/'+second)).job.status,'queued');
 await api('ai/process/'+second,'POST',{});assert.equal(calls.length,2);
});

test("AI management is admin only and existing task links preserve dates and access permissions",async function testAIPermissionsAndTaskLinking(t){
 const {client,db,env,fetcher,api,publish,source}=await aiFixture();t.after(()=>client.close());await publish(source(1));await api('ai/process/'+CNJ,'POST',{});
 const s=(await api('ai')).rows[0];
 const task=(await api('tasks','POST',{cnj:CNJ,title:'Já cadastrado',assignee_id:'intern-a',due_date:'2026-11-20'})).task;
 const linked=await api('ai/suggestions/'+s.id,'POST',{version:s.version,action:'accept',source_checked:true,task_id:task.id,reason:'Providência já acompanhada nesta tarefa.'});
 assert.equal(linked.task_id,task.id);assert.equal((await api('tasks')).total,1);assert.equal((await api('tasks/'+task.id)).task.due_date,'2026-11-20');
 const intern=createEngine(db,{mode:'vercel',fetcher,aiEnv:env,actor:{id:'intern-a',name:'Ana',role:'intern'}});
 for(const path of ['ai','ai/config','ai/process/'+CNJ,'ai/suggestions/'+s.id])await assert.rejects(()=>api(path,'GET',undefined,'office',intern),error=>error.status===403);
 assert.equal((await api('tasks/'+task.id,'GET',undefined,'office',intern)).aiSource.id,s.id);
 assert.equal((await api('state','GET',undefined,'office',intern)).aiStats,null);
 assert.equal((await api('ai','GET',undefined,'other')).total,0);
 await assert.rejects(()=>api('ai/suggestions/'+s.id,'GET',undefined,'other'),error=>error.status===404);
});

test("canceled and empty publications consume no model calls and remain for source review",async function testAICanceledAndEmptyDoNotSpend(t){
 const {client,api,publish,source,calls}=await aiFixture();t.after(()=>client.close());await publish(source(1,undefined,{status:'C'}),source(2,''));
 const result=await api('ai/process/'+CNJ,'POST',{});assert.equal(result.coverage.completed,2);assert.equal(calls.length,0);assert.equal((await api('ai')).total,0);
 assert.equal((await api('deadlines')).summary.pending,2,'Canceled source review still requires a human decision');
});

test("concurrent reviews create one task and discards require an explicit reason",async function testAIConcurrentDecisionsAndDiscard(t){
 const {client,api,publish,source}=await aiFixture();t.after(()=>client.close());await publish(source(1),source(2));
 await api('ai/process/'+CNJ,'POST',{});const s=(await api('ai')).rows[0];
 const body={version:s.version,action:'accept',source_checked:true,assignee_id:'admin',due_date:null};
 const results=await Promise.allSettled([api('ai/suggestions/'+s.id,'POST',body),api('ai/suggestions/'+s.id,'POST',body)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.status,409);assert.equal((await api('tasks')).total,1);
 await publish(source(3));await api('ai/process/'+CNJ,'POST',{});const pending=(await api('ai')).rows[0];
 await assert.rejects(()=>api('ai/suggestions/'+pending.id,'POST',{version:pending.version,action:'dismiss',source_checked:true,reason:''}),error=>error.status===400);
 await api('ai/suggestions/'+pending.id,'POST',{version:pending.version,action:'dismiss',source_checked:true,reason:'Providência já foi cumprida conforme protocolo conferido.'});
 assert.equal((await api('ai?focus=dismissed')).total,1);
});

test("the daily token reservation is shared atomically across concurrent case analyses",async function testAIBudgetAcrossConcurrentCases(t){
 const {client,api,publish,source,engine,monitor,calls,setProvider}=await aiFixture();t.after(()=>client.close());
 const text='Intime-se para apresentar manifestação no prazo de 15 dias. Confira o cumprimento da providência.';
 await publish(source(1,text));const other='00000000000000000002';
 await api('import','POST',{oab:'54321',uf:'RJ',start:day(),end:day(),items:[{'Número':other,'Título':'Outro processo','Tribunal':'TJRJ'}]});
 await engine.saveItems('office',monitor.monitorId,[source(2,text,{numero_processo:other,siglaTribunal:'TJRJ'})]);
 const reservation=new TextEncoder().encode(JSON.stringify(buildAIRequest([{ref:'1',id:'1',source_version:1,tribunal:'TJSP',date:day(),text,start:0,end:text.length,length:text.length}],[]))).byteLength+5024;
 const config=await api('ai/config');await api('ai/config','PUT',{version:config.version,enabled:true,automatic:true,daily_limit:reservation+1});
 let release;const gate=new Promise(resolve=>{release=resolve});
 setProvider(async()=>{await gate;return Response.json({status:'completed',usage:{input_tokens:140,output_tokens:110},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Lote conferido pela IA.',suggestions:[]})}]}]});});
 const running=api('ai/process/'+CNJ,'POST',{});
 for(let i=0;i<100&&calls.length===0;i++)await new Promise(resolve=>setTimeout(resolve,5));
 await assert.rejects(()=>api('ai/process/'+other,'POST',{}),error=>error.status===429);assert.equal(calls.length,1);release();await running;
 assert.equal((await api('ai/config')).usage.charged_tokens,250);
 await api('ai/process/'+other,'POST',{});assert.equal(calls.length,2);
});

test("the authenticated API protects AI and the existing cron respects automatic analysis settings",async function testAICronAndAuthentication(t){
 const {client,db,api,publish,source,env,fetcher,calls}=await aiFixture();t.after(()=>client.close());await publish(source(1));
 await client.execute('UPDATE monitors SET enabled=0');
 const serverEnv={...env,APP_PASSWORD:'synthetic-office-password-for-tests',CRON_SECRET:'synthetic-cron-secret-more-than-thirty-two'};
 const handler=createHandler({env:serverEnv,database:async()=>db,fetcher});
 const blocked=await handler(new Request('https://juris.example/api/ai'));assert.equal(blocked.status,401);assert.equal(calls.length,0);
 const cron=await handler(new Request('https://juris.example/api/cron',{headers:{Authorization:'Bearer '+serverEnv.CRON_SECRET}}));
 assert.equal(cron.status,200);const result=await cron.json();assert.equal(result.ai.worked,true);assert.equal(calls.length,1);
 assert.equal((await api('ai/process/'+CNJ)).coverage.completed,1);
 const config=await api('ai/config');await api('ai/config','PUT',{version:config.version,enabled:true,automatic:false,daily_limit:200000});
 await publish(source(2));const again=await handler(new Request('https://juris.example/api/cron',{headers:{Authorization:'Bearer '+serverEnv.CRON_SECRET}}));
 assert.equal(again.status,200);assert.equal(calls.length,1,'Automatic analysis must respect the office setting');
});
