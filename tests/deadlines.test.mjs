import {readdir,readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {adaptClient} from '../lib/database.mjs';
import {migrate} from '../scripts/migrate.mjs';
import {createEngine,day} from '../core/engine.mjs';
import {analyzeDeadlines,suggestDeadline,validDeadlineDate} from '../public/deadline-rules.mjs';
const CNJ='00000000000000000001';
async function deadlineFixture(){
 const client=createClient({url:'file::memory:'}),db=adaptClient(client);await migrate(client);
 const engine=createEngine(db,{mode:'vercel'});
 const api=(path,method='GET',body,owner='office',instance=engine)=>instance.handle(new Request('https://juris.example/api/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),owner);
 const at=new Date().toISOString();
 for(const [id,name] of [['intern-a','Ana'],['intern-b','Bruno']])await client.execute({sql:"INSERT INTO members(id,owner,name,email,password_hash,active,session_version,created,updated) VALUES(?,?,?,?,?,1,1,?,?)",args:[id,'office',name,id+'@example.invalid','',at,at]});
 const monitor=await api('import','POST',{oab:'12345',uf:'SP',start:day(),end:day(),items:[{'Número':CNJ,'Título':'Cliente do processo','Tribunal':'TJSP'}]});
 const source=(id,text='Intime-se para apresentar defesa em 15 dias úteis.',extra={})=>({id,numero_processo:CNJ,siglaTribunal:'TJSP',data_disponibilizacao:day(),texto:text,...extra});
 const publish=(...sources)=>engine.saveItems('office',monitor.monitorId,sources);
 const payload=(review,overrides={})=>({version:review.version,action:'confirm',source_checked:true,reason:'Conferência da intimação e do calendário oficial.',tasks:[{title:'Apresentar defesa',candidate_key:review.analysis.items[0]?.key||null,assignee_id:'intern-a',due_date:'2026-11-20'}],...overrides});
 return {client,db,engine,api,source,publish,payload,monitor};
}

test("explicit periods and dates are extracted without inventing legal deadlines",function testDeadlineParser(){
 const result=analyzeDeadlines('Intime-se para defesa em 15 (quinze) dias úteis e juntar documentos em cinco dias. Apresente até o dia 20/11/2026.');
 assert.equal(result.items.length,3);assert.equal(result.items[0].amount,15);assert.equal(result.items[0].basis,'business');
 assert.equal(result.items[1].amount,5);assert.equal(result.items[1].basis,null);assert.equal(result.items[2].explicit_date,'2026-11-20');
 assert.match(result.items[0].excerpt,/15 \(quinze\) dias úteis/);
 for(const text of ['Intime-se no prazo legal.','Pena de 5 anos de reclusão.','Julgado procedente o pedido.']){
  const analysis=analyzeDeadlines(text);assert.equal(analysis.items.length,0);assert.equal(analysis.needs_review,true);assert.ok(analysis.warnings.length,'Unrecognized text must retain warnings and require review');
 }
 assert.equal(analyzeDeadlines('Resposta em cinco dias.').items[0].amount,5);
 assert.equal(analyzeDeadlines('Intime-se para se manifestar em 48 horas.').items[0].unit,'hour');
 assert.equal(analyzeDeadlines('Prazo de 15 (dez) dias.').items[0].ambiguous,true);
 assert.equal(analyzeDeadlines('Apresente até o dia 31/02/2026.').items.length,0);
 assert.equal(analyzeDeadlines('Resposta em quinze dias.').items[0].amount,15);
});

test("date simulation requires an explicit regime and respects supplied exclusions",function testDeadlineCalendar(){
 const base={base_date:'2026-10-16',amount:2};
 assert.throws(()=>suggestDeadline(base),/Escolha/);
 assert.throws(()=>suggestDeadline({...base,base_date:'2026-02-30',mode:'business'}),/termo inicial/);
 assert.equal(suggestDeadline({...base,mode:'business'}).due_date,'2026-10-20');
 assert.equal(suggestDeadline({...base,mode:'business',excluded_dates:['2026-10-19']}).due_date,'2026-10-21');
 assert.equal(suggestDeadline({...base,mode:'calendar'}).due_date,'2026-10-18');
 assert.equal(suggestDeadline({...base,amount:1,mode:'calendar',roll_end:true}).due_date,'2026-10-19');
 assert.equal(suggestDeadline({...base,amount:1,mode:'calendar',suspended_dates:['2026-10-17']}).due_date,'2026-10-18');
 assert.equal(suggestDeadline({base_date:'2026-12-18',amount:2,mode:'business',recess:true}).due_date,'2027-01-22');
 assert.equal(suggestDeadline({base_date:'2026-12-18',amount:2,mode:'calendar'}).due_date,'2026-12-20','No recess or civil regime may be presumed');
 assert.throws(()=>suggestDeadline({...base,mode:'business',excluded_dates:['31/10/2026']}),/datas/);
 assert.equal(validDeadlineDate('2024-02-29'),true);assert.equal(validDeadlineDate('2026-02-29'),false);
});

test("every real publication enters review and reading never resolves it",async function testAllPublicationsEnterReview(t){
 const env=await deadlineFixture(),{client,api,publish,source}=env;t.after(()=>client.close());
 await publish(source(1),source(2,'Intime-se no prazo legal.'),source(3,'Sem período explícito.',{data_disponibilizacao:'2019-01-01'}));
 assert.equal((await api('deadlines')).summary.pending,3);assert.equal((await api('deadlines')).total,3);
 assert.equal((await api('deadlines/1')).review.analysis.items[0].amount,15);
 assert.equal((await api('deadlines/2')).review.analysis.items.length,0);
 assert.equal((await api('tasks')).total,0,'Detection must not fabricate confirmed tasks or due dates');
 await api('read','POST',{all:true});assert.equal((await api('deadlines')).summary.pending,3,'Reading does not resolve deadlines');
 assert.equal((await api('state')).deadlineStats.pending,3);
 const migrated=await client.execute('SELECT COUNT(*) n FROM juris_migrations WHERE name=\'0010_publication_deadline_reviews.sql\'');assert.equal(Number(migrated.rows[0].n),1);
 await migrate(client);assert.equal((await api('deadlines')).summary.pending,3);
});

test("confirmation atomically creates assigned tasks and records source and calculation",async function testConfirmAndAudit(t){
 const {client,api,publish,source,payload}=await deadlineFixture();t.after(()=>client.close());
 await publish(source(1,'Intime-se para apresentar defesa em 2 dias úteis.'));
 const original=(await api('deadlines/1')).review;
 const calculation={base_date:'2026-10-16',amount:2,mode:'business',excluded_dates:['2026-10-19']};
 const body=payload(original);body.tasks[0].due_date='2026-10-21';body.tasks[0].calculation=calculation;
 const result=await api('deadlines/1','POST',body);
 assert.equal(result.review.status,'confirmed');assert.equal(result.created_tasks.length,1);
 const task=await api('tasks/'+result.created_tasks[0]);
 assert.equal(task.task.due_date,'2026-10-21');assert.equal(task.task.assignee_id,'intern-a');assert.equal(task.task.priority,'high');
 assert.equal(task.deadlineSource.publication_id,'1');assert.equal(task.deadlineSource.changed,false);
 assert.equal(task.deadlineSource.details.calculation.due_date,'2026-10-21');assert.match(task.deadlineSource.details.source_text,/2 dias/);
 assert.equal(task.history[0].kind,'created');assert.equal(result.history[0].action,'confirm');
 assert.equal((await api('tasks/pending')).summary.open,1);assert.equal((await api('deadlines')).summary.pending,0);
 await assert.rejects(()=>api('deadlines/1','POST',body),error=>error.status===409);
 assert.equal((await api('tasks')).total,1,'Repeated confirmation cannot duplicate tasks');
});

test("missing data and inconsistent calculations leave review pending",async function testInvalidConfirmation(t){
 const {client,api,publish,source,payload}=await deadlineFixture();t.after(()=>client.close());await publish(source(1));
 const review=(await api('deadlines/1')).review,body=payload(review);
 for(const invalid of [
  {...body,source_checked:false},
  {...body,tasks:[{...body.tasks[0],assignee_id:''}]},
  {...body,tasks:[{...body.tasks[0],assignee_id:'not-from-office'}]},
  {...body,tasks:[{...body.tasks[0],due_date:'2026-02-30'}]},
  {...body,tasks:[{...body.tasks[0],calculation:{base_date:'2026-10-16',amount:2,mode:'business'}}]},
  {...body,tasks:[]},
  {...body,tasks:[{...body.tasks[0],candidate_key:'old-source-key'}]}
 ]){
  await assert.rejects(()=>api('deadlines/1','POST',invalid),error=>[400,409].includes(error.status));
  assert.equal((await api('deadlines/1')).review.status,'pending');assert.equal((await api('tasks')).total,0);
 }
 await api('deadlines/1','POST',body);assert.equal((await api('tasks')).total,1);
});

test("multiple periods must be reviewed and create separate linked tasks",async function testMultiplePeriods(t){
 const {client,api,publish,source,payload}=await deadlineFixture();t.after(()=>client.close());
 await publish(source(1,'Intime-se para resposta em 5 dias e apresentar documentos em 15 dias úteis.'));
 const review=(await api('deadlines/1')).review;assert.equal(review.analysis.items.length,2);
 const body=payload(review,{reason:''});await assert.rejects(()=>api('deadlines/1','POST',body),error=>error.status===400);
 body.tasks.push({...body.tasks[0],title:'Apresentar documentos',candidate_key:review.analysis.items[1].key});
 const result=await api('deadlines/1','POST',body);assert.equal(result.created_tasks.length,2);
 assert.equal((await api('tasks')).total,2);
});

test("source corrections and cancellations reopen review without losing task history",async function testSourceChanges(t){
 const {client,api,publish,source,payload}=await deadlineFixture();t.after(()=>client.close());
 const original=source(1);await publish(original);
 let review=(await api('deadlines/1')).review;
 const confirmed=await api('deadlines/1','POST',payload(review)),id=confirmed.created_tasks[0];
 await publish(original);
 review=(await api('deadlines/1')).review;assert.equal(review.status,'confirmed');assert.equal(review.source_version,1);
 await publish(source(1,'Intime-se para apresentar defesa no prazo de 5 dias corridos.'));
 review=(await api('deadlines/1')).review;
 assert.equal(review.status,'pending');assert.equal(review.source_version,2);assert.equal(review.analysis.items[0].amount,5);
 assert.equal((await api('tasks/'+id)).deadlineSource.changed,true);
 assert.equal((await api('tasks/'+id)).task.due_date,'2026-11-20','A correction cannot silently overwrite a confirmed due date');
 assert.equal((await api('deadlines?status=changed')).total,1);
 const dismissed=await api('deadlines/1','POST',{version:review.version,action:'dismiss',source_checked:true,reason:'Prazo anterior ajustado após conferência da correção.'});
 assert.equal(dismissed.tasks.length,1);assert.equal(dismissed.history.length,2);
 await publish(source(1,'Intime-se para apresentar defesa no prazo de 5 dias corridos.',{status:'C'}));
 review=(await api('deadlines/1')).review;assert.equal(review.status,'pending');assert.equal(review.canceled,1);assert.equal(review.source_version,3);
 await assert.rejects(()=>api('deadlines/1','POST',payload(review)),error=>error.status===400);
 assert.equal((await api('tasks/'+id)).deadlineSource.canceled,1);assert.equal((await api('tasks')).total,1);
});

test("review decisions are audited, reopenable and isolated by owner and role",async function testDismissReopenAndPermissions(t){
 const {client,db,api,publish,source,engine,payload}=await deadlineFixture();t.after(()=>client.close());
 await publish(source(1,'Intime-se no prazo legal.'));
 const review=(await api('deadlines/1')).review;
 await assert.rejects(()=>api('deadlines/1','POST',{version:review.version,action:'dismiss',source_checked:true,reason:''}),error=>error.status===400);
 const dismissed=await api('deadlines/1','POST',{version:review.version,action:'dismiss',source_checked:true,reason:'Providência já atendida; conferido o protocolo na fonte.'});
 assert.equal(dismissed.review.status,'dismissed');assert.equal((await api('deadlines?status=dismissed')).total,1);
 const reopened=await api('deadlines/1','POST',{version:dismissed.review.version,action:'reopen'});
 assert.equal(reopened.review.status,'pending');
 const confirmed=await api('deadlines/1','POST',payload(reopened.review));
 const intern=createEngine(db,{mode:'vercel',actor:{id:'intern-a',name:'Ana',role:'intern'}}),other=createEngine(db,{mode:'vercel',actor:{id:'intern-b',name:'Bruno',role:'intern'}});
 for(const [path,method,body] of [['deadlines','GET'],['deadlines/1','GET'],['deadlines/1','POST',payload(reopened.review)]]){
  await assert.rejects(()=>api(path,method,body,'office',intern),error=>error.status===403);
 }
 assert.equal((await api('tasks/'+confirmed.created_tasks[0],'GET',undefined,'office',intern)).deadlineSource.publication_id,'1');
 await assert.rejects(()=>api('tasks/'+confirmed.created_tasks[0],'GET',undefined,'office',other),error=>error.status===404);
 assert.equal((await api('state','GET',undefined,'office',intern)).deadlineStats,null);
 assert.equal((await api('deadlines','GET',undefined,'another-office',engine)).total,0);
 await assert.rejects(()=>api('deadlines/1','GET',undefined,'another-office',engine),error=>error.status===404);
});

test("hours require a manual time and contradictory quantities cannot be simulated",async function testHoursAndAmbiguity(t){
 const {client,api,publish,source,payload}=await deadlineFixture();t.after(()=>client.close());
 await publish(source(1,'Prazo de 48 horas para cumprimento.'),source(2,'Intime-se em 15 (dez) dias.'));
 const review=(await api('deadlines/1')).review,body=payload(review);
 await assert.rejects(()=>api('deadlines/1','POST',body),error=>error.status===400);
 body.tasks[0].due_time='17:30';const result=await api('deadlines/1','POST',body);
 const task=await api('tasks/'+result.created_tasks[0]);assert.match(task.task.description,/17:30 \(Brasília\)/);assert.equal(task.deadlineSource.details.due_time,'17:30');
 const ambiguous=(await api('deadlines/2')).review,invalid=payload(ambiguous);
 invalid.tasks[0].calculation={base_date:'2026-10-16',amount:2,mode:'business'};
 await assert.rejects(()=>api('deadlines/2','POST',invalid),error=>error.status===400);
});

test("queue pagination and tribunal, CNJ and OAB scopes do not duplicate records",async function testQueuePaginationAndScope(t){
 const {client,api,publish,source,engine}=await deadlineFixture();t.after(()=>client.close());
 await publish(...Array.from({length:18},(_,index)=>source(index+1)));
 assert.equal((await api('deadlines')).rows.length,15);assert.equal((await api('deadlines?page=2')).rows.length,3);
 assert.equal((await api('deadlines?tribunal=TJSP')).total,18);assert.equal((await api('deadlines?tribunal=SEEU')).total,0);
 assert.equal((await api('deadlines?monitor='+encodeURIComponent('office:SP:12345'))).total,18);
 assert.equal((await api('deadlines?cnj='+CNJ)).total,18);assert.equal((await api('deadlines?q=defesa')).total,18);
 assert.equal((await api('deadlines?q='+encodeURIComponent('0000000-00.0000.0.00.0001'))).total,18);
 assert.equal((await api('deadlines?status=all')).total,18);
 const second=await api('import','POST',{oab:'54321',uf:'RJ',start:day(),end:day(),items:[{'Número':CNJ,'Título':'Cliente do processo','Tribunal':'TJSP'}]});
 await engine.saveItems('office',second.monitorId,[source(1)]);
 assert.equal((await api('deadlines')).total,18,'Multiple OABs cannot duplicate the publication review');
});

test('migration queues existing read, canceled and historical publications for every owner',async function testDeadlineMigrationBackfill(t){
 const client=createClient({url:'file::memory:'});t.after(()=>client.close());
 await client.execute('CREATE TABLE juris_migrations(name TEXT PRIMARY KEY)');
 const directory=new URL('../migrations/',import.meta.url);
 for(const name of (await readdir(directory)).filter(name=>name.endsWith('.sql')&&name<'0010').sort()){
  const sql=await readFile(new URL(name,directory),'utf8');
  await client.batch([...sql.split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean),{sql:'INSERT INTO juris_migrations(name) VALUES(?)',args:[name]}],'write');
 }
 for(const owner of ['office','other']){
  await client.execute({sql:'INSERT INTO publications(owner,id,cnj,tribunal,date,text,type,organ,hash,canceled,raw,seen,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',args:[owner,'old-publication',CNJ,'SEEU','2019-01-01','Intime-se no prazo de 3 dias.','Intimação','','',1,'{}',1,new Date().toISOString()]});
 }
 await migrate(client);
 const reviews=await client.execute('SELECT owner,publication_id,status,source_version FROM publication_reviews ORDER BY owner');
 assert.equal(reviews.rows.length,2);assert.equal(reviews.rows.every(row=>row.status==='pending'&&Number(row.source_version)===1),true);
 assert.equal(Number((await client.execute('SELECT COUNT(*) n FROM publications')).rows[0].n),2);
 await migrate(client);assert.equal(Number((await client.execute('SELECT COUNT(*) n FROM publication_reviews')).rows[0].n),2);
});

test('concurrent confirmations create one task set and one review event',async function testDeadlineConcurrentConfirmation(t){
 const {client,api,publish,source,payload}=await deadlineFixture();t.after(()=>client.close());await publish(source(1));
 const review=(await api('deadlines/1')).review;
 const results=await Promise.allSettled([api('deadlines/1','POST',payload(review)),api('deadlines/1','POST',payload(review))]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const failure=results.find(result=>result.status==='rejected');assert.equal(failure.reason.status,409);
 assert.equal((await api('tasks')).total,1);assert.equal((await api('deadlines/1')).history.length,1);
 const links=await client.execute('SELECT COUNT(*) n FROM deadline_task_links');assert.equal(Number(links.rows[0].n),1);
});
