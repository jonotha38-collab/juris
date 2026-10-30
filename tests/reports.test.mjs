import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine,day} from '../core/engine.mjs';
import {reportFixture,cnj} from './report-fixture.mjs';

test('tribunal options include imported cases and multi-selection returns only selected courts',async t=>{
 const {client,api}=await reportFixture();t.after(()=>client.close());
 const options=await api('reports/tribunals');
 assert.deepEqual(options.rows.map(row=>[row.tribunal,row.processes,row.publications]),[['SEEU',1,0],['TJRJ',2,2],['TJSP',1,1]]);
 assert.equal(options.totals.processes,3);assert.equal(options.totals.publications,3);
 const selection='tribunals=SEEU&tribunals=TJSP';
 const processes=await api('reports/processes?'+selection);assert.equal(processes.rows.length,2);assert.equal(processes.next,null);
 assert.deepEqual(processes.rows.map(row=>[row.tribunal,row.cnj]),[['SEEU',cnj(3)],['TJSP',cnj(1)]]);
 const imported=processes.rows[0];assert.equal(imported.total,0);assert.equal(imported.date,null);assert.equal(imported.parties.title,'Cadastro sem publicações');
 assert.equal(processes.rows[1].clients[0].name,'Cliente confirmado');assert.equal(processes.rows[1].oabs.length,2);
 const publications=await api('reports/publications?'+selection);assert.deepEqual(publications.rows.map(row=>row.id),['a']);
 const repeated=await api('reports/processes?tribunals=TJSP&tribunals=TJSP');assert.equal(repeated.rows.length,1);
});
test('report scope respects OAB, search, favorites and read state without forcing the current tribunal',async t=>{
 const {client,api,second}=await reportFixture();t.after(()=>client.close());
 const monitor='monitor='+encodeURIComponent(second);
 const options=await api('reports/tribunals?'+monitor+'&tribunal=SEEU');assert.deepEqual(options.rows.map(row=>row.tribunal),['TJRJ','TJSP']);
 const selected=await api('reports/processes?'+monitor+'&tribunals=TJSP&tribunals=TJRJ');assert.equal(selected.rows.every(row=>row.cnj===cnj(1)),true);
 const publications=await api('reports/publications?'+monitor+'&tribunals=TJSP&tribunals=TJRJ');assert.deepEqual(publications.rows.map(row=>row.id),['a']);
 await api('meta/'+cnj(1),'PATCH',{favorite:true,stage:'waiting',note:'Orientação interna'});
 assert.deepEqual((await api('reports/tribunals?favorite=1&stage=waiting')).rows.map(row=>row.tribunal),['TJRJ','TJSP']);
 assert.equal((await api('reports/tribunals?q=Cliente%20confirmado')).totals.processes,1);
 assert.equal((await api('reports/tribunals?unread=1')).rows.some(row=>row.tribunal==='SEEU'),false);
 await api('read','POST',{all:true});assert.equal((await api('reports/tribunals?unread=1')).rows.length,0);
});
test('export endpoints enforce office and administrator permissions and validate selection and cursors',async t=>{
 const {client,db,api}=await reportFixture();t.after(()=>client.close());
 const intern=createEngine(db,{mode:'vercel',actor:{id:'intern-a',name:'Ana',role:'intern'}});
 for(const path of ['reports/tribunals','reports/processes?tribunals=TJSP','reports/publications?tribunals=TJSP'])await assert.rejects(()=>api(path,'GET',undefined,'office',intern),error=>error.status===403);
 assert.equal((await api('reports/tribunals','GET',undefined,'another-office')).rows.length,0);
 for(const query of ['', 'tribunals=UNKNOWN','tribunals=TJSP&after=invalid','tribunals=TJSP&after='+encodeURIComponent(JSON.stringify(['TJRJ',cnj(1)]))])await assert.rejects(()=>api('reports/processes?'+query),error=>error.status===400);
 await assert.rejects(()=>api('reports/processes?tribunals=TJSP','GET',undefined,'another-office'),error=>error.status===400);
});
test('report keyset pagination exports every case and publication beyond the first 500 records',async t=>{
 const {client,api,engine,publication,monitor}=await reportFixture();t.after(()=>client.close());
 const items=Array.from({length:503},(_,i)=>({'Número':cnj(i+10),'Título':'Caso '+i,'Tribunal':'TJSP'}));
 await api('import','POST',{oab:'12345',uf:'SP',start:day(),end:day(),items});
 await engine.saveItems('office',monitor,items.map((_,i)=>publication('page-'+i,i+10,'TJSP')));
 for(const kind of ['processes','publications']){
  let next=null,rows=[],pages=0;
  do{const result=await api('reports/'+kind+'?tribunals=TJSP'+(next?'&after='+encodeURIComponent(next):''));rows.push(...result.rows);next=result.next;pages++;}while(next);
  assert.equal(pages,2);assert.equal(rows.length,504);assert.equal(new Set(rows.map(row=>kind==='processes'?row.cnj:row.id)).size,504);
 }
});
