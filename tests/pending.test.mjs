import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {adaptClient} from '../lib/database.mjs';
import {migrate} from '../scripts/migrate.mjs';
import {createEngine,day,addDays} from '../core/engine.mjs';
const cnj=n=>String(n).padStart(20,'0');
const formatted=n=>cnj(n).replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/,'$1-$2.$3.$4.$5.$6');
async function setup(){
 const client=createClient({url:'file::memory:'}),db=adaptClient(client);await migrate(client);
 const engine=createEngine(db,{mode:'vercel'});
 const api=(path,method='GET',body,owner='office',instance=engine)=>instance.handle(new Request('https://juris.example/api/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),owner);
 const stamp=new Date().toISOString();
 for(const [id,name] of [['intern-a','Ana da equipe'],['intern-b','Bruno da equipe']])await client.execute({sql:"INSERT INTO members(id,owner,name,email,password_hash,active,session_version,created,updated) VALUES(?,?,?,?,?,1,1,?,?)",args:[id,'office',name,id+'@example.invalid','',stamp,stamp]});
 async function cases(numbers,oab='12345',uf='SP',owner='office'){
  return api('import','POST',{oab,uf,start:day(),end:day(),items:numbers.map(n=>({'Número':cnj(n),'Título':n===1?'Caso Alfa':n===2?'Caso Beta':'Caso '+n,'Tribunal':uf==='SP'?'TJSP':'TJRJ'}))},owner);
 }
 async function task(n,title,{assignee='intern-a',due=day(),status='todo',priority='normal',owner='office'}={}){
  let result=await api('tasks','POST',{cnj:cnj(n),title,assignee_id:assignee,due_date:due,priority},owner);
  if(status!=='todo')result=await api('tasks/'+result.task.id,'PATCH',{version:result.task.version,status},owner);
  return result.task;
 }
 return {client,db,engine,api,cases,task};
}
async function fixture(){
 const env=await setup();await env.cases([1,2]);await env.cases([3],'54321','RJ');await env.cases([1],'54321','RJ');
 const tasks=[
  await env.task(1,'Petição pendente',{due:addDays(day(),-1),priority:'high'}),
  await env.task(1,'Conferir documento',{assignee:'admin',status:'doing'}),
  await env.task(1,'Revisar manifestação',{assignee:'intern-b',due:addDays(day(),3),status:'review'}),
  await env.task(1,'Organizar documentos',{assignee:null,due:null,priority:'low'}),
  await env.task(1,'Providência concluída',{due:addDays(day(),-10),status:'done'}),
  await env.task(2,'Solicitar retorno',{due:addDays(day(),20)}),
  await env.task(3,'Trabalho encerrado',{due:addDays(day(),-10),status:'done'})
 ];
 return {...env,tasks};
}
test('pending groups use CNJ once, preserve completion history and prioritize overdue and today',async t=>{
 const {client,api,tasks}=await fixture();t.after(()=>client.close());
 const result=await api('tasks/pending');
 assert.equal(result.total,2);assert.equal(result.summary.open,5);assert.equal(result.summary.done,2);
 assert.equal(result.summary.overdue,1);assert.equal(result.summary.today,1);assert.equal(result.summary.week,2);
 assert.equal(result.summary.review,1);assert.equal(result.summary.unassigned,1);assert.equal(result.summary.no_date,1);
 assert.equal(result.rows[0].cnj,cnj(1));assert.equal(result.rows[0].summary.total,5);assert.equal(result.rows[0].summary.done,1);
 assert.equal(result.rows[0].matching,4);assert.equal(result.rows[0].oabs.length,2);
 assert.deepEqual(result.rows[0].tasks.map(task=>task.id),tasks.slice(0,4).map(task=>task.id));
 const done=await api('tasks/pending?focus=done');assert.equal(done.total,2);assert.equal(done.rows.every(row=>row.tasks.every(task=>task.status==='done')),true);
 const open=await api('tasks?cnj='+cnj(1)+'&open=1');assert.equal(open.total,4);assert.equal(open.summary.done,1);
 const all=await api('tasks?cnj='+cnj(1));assert.equal(all.total,5);
});
test('deadline, assignee, priority and review filters select the expected tasks',async t=>{
 const {client,api,tasks}=await fixture();t.after(()=>client.close());
 for(const [focus,id] of [['overdue',tasks[0].id],['today',tasks[1].id],['review',tasks[2].id],['unassigned',tasks[3].id],['no_date',tasks[3].id]]){
  const result=await api('tasks/pending?focus='+focus);assert.equal(result.total,1,focus);assert.deepEqual(result.rows[0].tasks.map(task=>task.id),[id],focus);
 }
 assert.equal((await api('tasks/pending?focus=week')).rows[0].matching,2);
 const byPerson=await api('tasks/pending?assignee=intern-a');assert.equal(byPerson.summary.open,2);assert.equal(byPerson.summary.done,2);
 const high=await api('tasks/pending?priority=high');assert.equal(high.total,1);assert.equal(high.rows[0].tasks[0].id,tasks[0].id);
 for(const query of ['focus=wrong','priority=wrong','sort=wrong'])await assert.rejects(()=>api('tasks/pending?'+query),error=>error.status===400);
});
test('pending searches recognize parties, confirmed clients, titles and formatted CNJ',async t=>{
 const {client,api}=await fixture();t.after(()=>client.close());
 await api('clients','POST',{name:'Cliente Confirmado',cnj:cnj(1)});
 for(const q of ['Caso Alfa','Cliente Confirmado',formatted(1),'Petição pendente']){
  const result=await api('tasks/pending?q='+encodeURIComponent(q));assert.equal(result.total,1,q);assert.equal(result.rows[0].cnj,cnj(1));
 }
 const context=await api('tasks/pending?monitor='+encodeURIComponent('office:RJ:54321'));
 assert.equal(context.total,1);assert.equal(context.rows[0].cnj,cnj(1));
 const sp=await api('tasks/pending?tribunal=TJSP');assert.equal(sp.total,2);
 const rj=await api('tasks/pending?tribunal=TJRJ');assert.equal(rj.total,0);
});
test('interns see only their assigned task counts and cannot conclude or access another task',async t=>{
 const {client,api,db,tasks}=await fixture();t.after(()=>client.close());
 const instance=createEngine(db,{mode:'vercel',actor:{id:'intern-a',role:'intern',name:'Ana da equipe'}});
 const call=(path,method='GET',body)=>api(path,method,body,'office',instance);
 const result=await call('tasks/pending?assignee=intern-b');assert.equal(result.summary.open,2);assert.equal(result.summary.done,2);
 assert.equal(result.rows[0].tasks.every(task=>task.assignee_id==='intern-a'),true);assert.equal(result.people.length,1);
 const state=await call('state?view=processes');const alfa=state.rows.find(row=>row.cnj===cnj(1));assert.equal(alfa.taskSummary.open,1);assert.equal(alfa.taskSummary.total,2);
 await assert.rejects(()=>call('tasks/'+tasks[0].id,'PATCH',{version:tasks[0].version,status:'done'}),error=>error.status===403);
 await assert.rejects(()=>call('tasks/'+tasks[2].id),error=>error.status===404);
 const updated=await call('tasks/'+tasks[0].id,'PATCH',{version:tasks[0].version,status:'review'});assert.equal(updated.task.status,'review');
 const done=await api('tasks/'+updated.task.id,'PATCH',{version:updated.task.version,status:'done'});assert.equal(done.task.status,'done');
});
test('quick status changes reject stale versions and record one successful history event',async t=>{
 const {client,api,tasks}=await fixture();t.after(()=>client.close());
 const result=await api('tasks/'+tasks[0].id,'PATCH',{version:tasks[0].version,status:'doing'});
 assert.equal(result.task.version,tasks[0].version+1);
 await assert.rejects(()=>api('tasks/'+tasks[0].id,'PATCH',{version:tasks[0].version,status:'done'}),error=>error.status===409);
 const history=await api('tasks/'+tasks[0].id);assert.equal(history.task.status,'doing');assert.equal(history.history.filter(event=>event.kind==='updated').length,1);
});
test('case pagination limits previews without dropping work and isolates office data',async t=>{
 const {client,api,cases,task}=await setup();t.after(()=>client.close());
 await cases(Array.from({length:14},(_,i)=>i+1));
 for(let i=1;i<=14;i++)await task(i,'Pendência '+i,{due:null});
 for(let i=0;i<5;i++)await task(1,'Outro item '+i,{due:null});
 await cases([1],'12345','SP','other-office');await task(1,'Privado de outro escritório',{owner:'other-office',assignee:'admin',due:null});
 const first=await api('tasks/pending');assert.equal(first.total,14);assert.equal(first.rows.length,12);
 const second=await api('tasks/pending?page=2');assert.equal(second.rows.length,2);
 assert.equal(new Set([...first.rows,...second.rows].map(row=>row.cnj)).size,14);
 const group=[...first.rows,...second.rows].find(row=>row.cnj===cnj(1));assert.equal(group.matching,6);assert.equal(group.tasks.length,4);
 assert.equal(JSON.stringify(first).includes('Privado de outro'),false);
 const other=await api('tasks/pending','GET',undefined,'other-office');assert.equal(other.total,1);assert.equal(other.rows[0].tasks[0].title,'Privado de outro escritório');
});
test('opening process history does not mark publications read; explicit acknowledgement preserves tasks',async t=>{
 const {client,api,engine,cases,task}=await setup();t.after(()=>client.close());
 const monitor=await cases([1]);await task(1,'Conferir publicação',{due:null});
 await engine.saveItems('office',monitor.monitorId,[{id:90,numero_processo:cnj(1),siglaTribunal:'TJSP',data_disponibilizacao:day(),texto:'Publicação a conferir'}]);
 const detail=await api('process/'+cnj(1));assert.equal(detail.rows[0].seen,0);
 assert.equal((await api('state')).stats.unread,1);
 await api('read','POST',{id:'90'});
 assert.equal((await api('state')).stats.unread,0);
 assert.equal((await api('tasks/pending')).summary.open,1);
});
