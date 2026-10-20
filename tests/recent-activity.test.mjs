import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {adaptClient} from '../lib/database.mjs';
import {migrate} from '../scripts/migrate.mjs';
import {createEngine,day,addDays} from '../core/engine.mjs';
import {twoYearsAgo,collectionStart,isRecentActivityDate} from '../public/recency.mjs';
const cnj=n=>String(n).padStart(20,'0');
const publication=(id,n,date=day(),extra={})=>({id,numero_processo:cnj(n),siglaTribunal:'SEEU',data_disponibilizacao:date,texto:'Publicação de teste',...extra});
const search=(extra={})=>({oab:'12345',uf:'SP',start:collectionStart(day()),end:day(),...extra});
async function setup(fetcher){
 const client=createClient({url:'file::memory:'}),db=adaptClient(client);await migrate(client);
 const engine=createEngine(db,{mode:'vercel',...(fetcher?{fetcher}:{})});
 const api=(path,method='GET',body,owner='office')=>engine.handle(new Request('https://juris.example/api/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),owner);
 return {client,db,engine,api};
}
test('calendar cutoff excludes exactly two years and handles leap dates',()=>{
 assert.equal(twoYearsAgo('2026-10-20'),'2024-10-20');
 assert.equal(collectionStart('2026-10-20'),'2024-10-21');
 assert.equal(twoYearsAgo('2024-02-29'),'2022-02-28');
 assert.equal(collectionStart('2024-02-29'),'2022-03-01');
 assert.equal(isRecentActivityDate('2024-10-20','2026-10-20'),false);
 assert.equal(isRecentActivityDate('2024-10-21','2026-10-20'),true);
 assert.equal(isRecentActivityDate('2026-10-21','2026-10-20'),false);
 assert.equal(isRecentActivityDate('2025-02-30','2026-10-20'),false);
 assert.equal(isRecentActivityDate('','2026-10-20'),false);
});

test('new OAB searches preserve all chosen dates, including a wholly historical period',async t=>{
 const {client,api}=await setup();t.after(()=>client.close());
 const job=await api('search','POST',search({start:'1990-01-01',end:'1990-02-01'}));
 assert.equal(job.start,'1990-01-01');assert.equal(job.end,'1990-02-01');assert.equal(job.cursor,'1990-01-01');
});
test('resuming keeps the original historical cursor and page',async t=>{
 let requested;
 const {client,api}=await setup(async url=>{requested=new URL(url);return Response.json({items:[],count:0})});t.after(()=>client.close());
 const job=await api('search','POST',search({start:'1990-01-01',end:'1990-01-02'}));
 await client.execute({sql:'UPDATE jobs SET page=7 WHERE id=?',args:[job.id]});
 const result=await api('jobs/'+job.id+'/step','POST',{});
 assert.equal(requested.searchParams.get('dataDisponibilizacaoInicio'),'1990-01-01');
 assert.equal(requested.searchParams.get('dataDisponibilizacaoFim'),'1990-01-02');
 assert.equal(requested.searchParams.get('pagina'),'7');assert.equal(result.status,'done');
});
test('a process found in 2018 is admitted with its older history after separate recent activity verification',async t=>{
 const calls=[];
 const {client,api}=await setup(async url=>{
  const params=new URL(url).searchParams;calls.push(params);
  if(params.has('numeroOab'))return Response.json({items:[publication(10,1,'2018-04-02')],count:1});
  assert.equal(params.get('numeroProcesso'),cnj(1));assert.equal(params.has('numeroOab'),false);
  assert.equal(params.get('dataDisponibilizacaoInicio'),collectionStart(day()));assert.equal(params.get('dataDisponibilizacaoFim'),day());
  return Response.json({items:[publication(11,1)],count:1});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 const finished=await api('jobs/'+job.id+'/step','POST',{});assert.equal(finished.status,'done');
 assert.equal(calls[0].get('dataDisponibilizacaoInicio'),'2018-04-01');assert.equal(calls.length,2);
 const state=await api('state?view=processes');assert.equal(state.total,1);assert.equal(state.rows[0].total,2);
 assert.equal((await api('process/'+cnj(1))).rows.some(r=>r.date==='2018-04-02'),true);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM job_candidates')).rows[0].n,0);
});
test('a historical process with no recent activity is not inserted into the portfolio',async t=>{
 const {client,api}=await setup(async url=>Response.json(new URL(url).searchParams.has('numeroOab')?{items:[publication(10,1,'2018-04-02')],count:1}:{items:[],count:0}));t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');
 assert.equal((await api('state?view=processes')).total,0);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM publications')).rows[0].n,0);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM job_candidates')).rows[0].n,0);
});
test('one page verifies cases incrementally before advancing the historical cursor',async t=>{
 const {client,api}=await setup(async url=>{
  const p=new URL(url).searchParams;
  if(p.has('numeroOab'))return Response.json({items:[publication(10,1,'2018-04-02'),publication(20,2,'2018-04-02')],count:2});
  return Response.json(p.get('numeroProcesso')===cnj(1)?{items:[publication(11,1)],count:1}:{items:[],count:0});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 const first=await api('jobs/'+job.id+'/step','POST',{});assert.equal(first.cursor,'2018-04-01');assert.equal(first.status,'running');
 let state=await api('state?view=processes');assert.equal(state.total,1);assert.equal(state.jobs[0].pending_cases,1);
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');
 state=await api('state?view=processes');assert.equal(state.total,1);assert.equal(state.rows[0].cnj,cnj(1));
});
test('filtering a whole historical page never skips the next source page',async t=>{
 const pages=[];
 const {client,api}=await setup(async url=>{
  const p=new URL(url).searchParams;
  if(p.has('numeroOab')){
   const page=Number(p.get('pagina'));pages.push(page);
   return Response.json({count:101,items:page===1?Array.from({length:100},(_,i)=>publication(i+1,1,'2018-04-02')):[publication(101,2,'2018-04-02')]});
  }
  return Response.json(p.get('numeroProcesso')===cnj(2)?{items:[publication(102,2)],count:1}:{items:[],count:0});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 const first=await api('jobs/'+job.id+'/step','POST',{});assert.equal(first.page,2);assert.equal(first.status,'running');
 assert.equal((await client.execute('SELECT COUNT(*) n FROM publications')).rows[0].n,0);
 const last=await api('jobs/'+job.id+'/step','POST',{});assert.equal(last.status,'done');assert.deepEqual(pages,[1,2]);
 const state=await api('state?view=processes');assert.equal(state.total,1);assert.equal(state.rows[0].cnj,cnj(2));
});
test('rate limits during activity verification preserve the hidden candidate for retry',async t=>{
 let discovery=0,verification=0;
 const {client,api}=await setup(async url=>{
  if(new URL(url).searchParams.has('numeroOab')){discovery++;return Response.json({items:[publication(10,1,'2018-04-02')],count:1})}
  verification++;return verification===1?new Response('',{status:429,headers:{'Retry-After':'60'}}):Response.json({items:[publication(11,1)],count:1});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 const paused=await api('jobs/'+job.id+'/step','POST',{});assert.equal(paused.status,'running');assert.ok(paused.retry_at>Date.now());assert.ok(paused.pending_page);
 assert.equal((await api('state?view=processes')).total,0);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM job_candidates')).rows[0].n,1);
 await client.execute({sql:'UPDATE jobs SET retry_at=0 WHERE id=?',args:[job.id]});
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');
 assert.equal(discovery,1);assert.equal(verification,2);assert.equal((await api('state?view=processes')).total,1);
});
test('source failures are not treated as inactivity and resume verification without repeating discovery',async t=>{
 let discovery=0,verification=0;
 const {client,api}=await setup(async url=>{
  if(new URL(url).searchParams.has('numeroOab')){discovery++;return Response.json({items:[publication(10,1,'2018-04-02')],count:1})}
  verification++;return verification===1?new Response('',{status:500}):Response.json({items:[publication(11,1)],count:1});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 const failed=await api('jobs/'+job.id+'/step','POST',{});assert.equal(failed.status,'error');
 assert.equal((await client.execute('SELECT COUNT(*) n FROM inactive_activity_checks')).rows[0].n,0);
 await api('jobs/'+job.id+'/resume','POST',{});
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');assert.equal(discovery,1);assert.equal(verification,2);
});
test('a full page of canceled publications continues verification on its next page',async t=>{
 const pages=[];
 const {client,api}=await setup(async url=>{
  const p=new URL(url).searchParams;
  if(p.has('numeroOab'))return Response.json({items:[publication(10,1,'2018-04-02')],count:1});
  const page=Number(p.get('pagina'));pages.push(page);
  return Response.json({count:101,items:page===1?Array.from({length:100},(_,i)=>publication(100+i,1,day(),{ativo:false})):[publication(200,1)]});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'running');assert.equal((await api('state?view=processes')).total,0);
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');assert.deepEqual(pages,[1,2]);assert.equal((await api('state?view=processes')).total,1);
});
test('a mismatched CNJ from the verification endpoint is kept pending and never imported',async t=>{
 const {client,api}=await setup(async url=>Response.json(new URL(url).searchParams.has('numeroOab')?{items:[publication(10,1,'2018-04-02')],count:1}:{items:[publication(11,2)],count:1}));t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 const failed=await api('jobs/'+job.id+'/step','POST',{});assert.equal(failed.status,'error');assert.match(failed.error,/outro CNJ/);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM publications')).rows[0].n,0);assert.equal((await client.execute('SELECT COUNT(*) n FROM job_candidates')).rows[0].n,1);
});
test('same-day negative checks are reused but a newly discovered recent publication overrides them',async t=>{
 let verification=0;
 const {client,api}=await setup(async url=>{
  const p=new URL(url).searchParams;
  if(p.has('numeroOab'))return Response.json({items:[publication(p.get('dataDisponibilizacaoInicio')===day()?11:10,1,p.get('dataDisponibilizacaoInicio')===day()?day():'2018-04-02')],count:1});
  verification++;return Response.json({items:[],count:0});
 });t.after(()=>client.close());
 for(let i=0;i<2;i++){const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done')}
 assert.equal(verification,1);assert.equal((await api('state?view=processes')).total,0);
 const job=await api('search','POST',search({start:day(),end:day()}));assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');
 assert.equal((await api('state?view=processes')).total,1);assert.equal((await client.execute('SELECT COUNT(*) n FROM inactive_activity_checks')).rows[0].n,0);
});
test('known recent activity avoids an extra request while retaining an old discovery publication',async t=>{
 let fetched=0;
 const {client,api,engine}=await setup(async url=>{fetched++;assert.ok(new URL(url).searchParams.has('numeroOab'));return Response.json({items:[publication(10,1,'2018-04-02')],count:1})});t.after(()=>client.close());
 const job=await api('search','POST',search({start:'2018-04-01',end:'2018-04-05'}));
 await engine.saveItems('office',job.monitor_id,[publication(11,1)]);
 assert.equal((await api('jobs/'+job.id+'/step','POST',{})).status,'done');assert.equal(fetched,1);
 assert.equal((await api('process/'+cnj(1))).count.n,2);
});
test('inactive and canceled-only cases disappear from portfolios but an active case keeps its older history',async t=>{
 const {client,api,engine}=await setup();t.after(()=>client.close());
 const job=await api('search','POST',search());
 const cutoff=twoYearsAgo(day()),old=addDays(cutoff,-1);
 await engine.saveItems('office',job.monitor_id,[
  publication(1,1,old),publication(2,2,cutoff),
  publication(3,3,day(),{ativo:false}),
  publication(4,4,old),publication(5,4),
  publication(6,5,addDays(day(),1))
 ]);
 let state=await api('state?view=processes');
 assert.equal(state.total,1);assert.equal(state.rows[0].cnj,cnj(4));assert.equal(state.rows[0].total,2);
 assert.equal(state.stats.processes,1);assert.equal(state.stats.publications,2);
 assert.equal(state.monitors[0].processes,1);assert.equal(state.monitors[0].publications,2);
 assert.equal(state.tribunals[0].processes,1);
 const selected=await api('state?view=processes&monitor='+encodeURIComponent(job.monitor_id));assert.equal(selected.total,1);
 assert.equal((await api('state?view=publications')).total,2);
 assert.equal((await api('export')).items.length,2);
 assert.equal((await api('process/'+cnj(4))).count.n,2);
 assert.equal((await api('process/'+cnj(1))).count.n,1);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM publications')).rows[0].n,6);
 await engine.saveItems('office',job.monitor_id,[publication(7,1)]);
 state=await api('state?view=processes');assert.equal(state.total,2);
 assert.equal(state.rows.find(r=>r.cnj===cnj(1)).total,2);
});
test('another office cannot make a stale case eligible and explicit spreadsheet imports remain available',async t=>{
 const {client,api,engine}=await setup();t.after(()=>client.close());
 const a=await api('search','POST',search());
 const b=await api('search','POST',search(),'other-office');
 await engine.saveItems('office',a.monitor_id,[publication(1,1,twoYearsAgo(day()))]);
 await engine.saveItems('other-office',b.monitor_id,[publication(2,1)]);
 assert.equal((await api('state?view=processes')).total,0);
 await api('import','POST',{...search(),items:[{'Número':cnj(2),'Título':'Cadastro manual','Data do último histórico':'01/01/2000'}]});
 const state=await api('state?view=processes');assert.equal(state.total,1);assert.equal(state.rows[0].cnj,cnj(2));
 assert.equal(state.rows[0].total,0);assert.equal(state.collectionPolicy.activityStart,collectionStart(day()));
});
