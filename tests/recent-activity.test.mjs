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
test('new OAB searches clamp old starts and reject wholly expired periods before creating a monitor',async t=>{
 const {client,api}=await setup();t.after(()=>client.close());
 await assert.rejects(()=>api('search','POST',search({oab:'98765',start:'2000-01-01',end:twoYearsAgo(day())})),/dois anos/);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM monitors')).rows[0].n,0);
 const job=await api('search','POST',search({start:'2000-01-01'}));
 assert.equal(job.start,collectionStart(day()));assert.equal(job.cursor,collectionStart(day()));
});
test('legacy running searches resume at a recent cursor and reset the page',async t=>{
 let requested;
 const {client,api}=await setup(async url=>{requested=new URL(url);return Response.json({items:[],count:0})});t.after(()=>client.close());
 const job=await api('search','POST',search());
 await client.execute({sql:"UPDATE jobs SET start='2000-01-01',cursor='2000-01-01',page=7 WHERE id=?",args:[job.id]});
 const updated=await api('jobs/'+job.id+'/step','POST',{});
 assert.equal(requested.searchParams.get('dataDisponibilizacaoInicio'),collectionStart(day()));
 assert.equal(requested.searchParams.get('pagina'),'1');assert.equal(updated.page,1);
});
test('an expired legacy job finishes without querying the source',async t=>{
 let fetched=0;
 const {client,api}=await setup(async()=>{fetched++;throw Error('Should not fetch')});t.after(()=>client.close());
 const job=await api('search','POST',search());
 await client.execute({sql:"UPDATE jobs SET start='2000-01-01',cursor='2000-01-01',end='2000-01-02' WHERE id=?",args:[job.id]});
 const updated=await api('jobs/'+job.id+'/step','POST',{});
 assert.equal(fetched,0);assert.equal(updated.status,'done');assert.match(updated.error,/dois anos/);
});
test('source rows outside the cutoff are skipped without breaking pagination',async t=>{
 const first=collectionStart(day()),cutoff=twoYearsAgo(day()),pages=[];
 const {client,api}=await setup(async url=>{
  const page=Number(new URL(url).searchParams.get('pagina'));pages.push(page);
  return Response.json({count:101,items:page===1?Array.from({length:100},(_,i)=>publication(i+1,i+1,cutoff)):[publication(101,101,first)]});
 });t.after(()=>client.close());
 const job=await api('search','POST',search({start:first,end:first}));
 const step1=await api('jobs/'+job.id+'/step','POST',{});
 assert.equal(step1.status,'running');assert.equal(step1.page,2);
 assert.equal((await client.execute('SELECT COUNT(*) n FROM publications')).rows[0].n,0);
 const step2=await api('jobs/'+job.id+'/step','POST',{});assert.equal(step2.status,'done');
 assert.deepEqual(pages,[1,2]);
 const state=await api('state?view=processes');assert.equal(state.total,1);assert.equal(state.rows[0].cnj,cnj(101));
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
 assert.equal(state.rows[0].total,0);assert.equal(state.collectionPolicy.earliest,collectionStart(day()));
});
