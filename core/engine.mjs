import {partiesOf} from '../public/parties.mjs';
import {activityWindow} from './activity.mjs';
import {readDjenPage,SourcePause} from './djen-source.mjs';
import {twoYearsAgo,collectionStart,isRecentActivityDate} from '../public/recency.mjs';
import {classifyImport} from '../public/import-format.mjs';
export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
import {AppError} from './errors.mjs';
export {AppError} from './errors.mjs';
import {createCollaboration,ADMIN,permissionsFor} from './collaboration.mjs';
import {createClients} from './clients.mjs';
const now=()=>new Date().toISOString();
export const day=(value=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
export function addDays(d,n){const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)throw new AppError('Informe uma data válida.');return v;}
export function validateSearch(b){let oab=String(b.oab||'').trim().toUpperCase();const uf=String(b.uf||'').toUpperCase();if(!/^\d{1,8}[A-Z]?$/.test(oab)||!UFS.includes(uf))throw new AppError('Informe a OAB (número e eventual letra) e uma UF válida.');oab=oab.replace(/^0+(?=\d)/,'');const start=date(b.start),end=date(b.end);if(start>end||end>day())throw new AppError('Confira o período: início anterior ao fim e sem datas futuras.');return {oab,uf,start,end};}
export function normalize(item){if(!item||typeof item!=='object'||!item.id&&!item.hash)throw new AppError('Publicação sem identificação oficial.');const cnj=String(item.numero_processo||'').replace(/\D/g,'');if(!/^\d{20}$/.test(cnj))throw new AppError('Publicação sem número CNJ válido.');return {id:String(item.id||item.hash),cnj,tribunal:String(item.siglaTribunal||item.sigla_tribunal||'Não informado'),date:String(item.data_disponibilizacao||item.dataDisponibilizacao||'').slice(0,10),text:String(item.texto||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(),type:String(item.tipoComunicacao||item.tipo_comunicacao||'Publicação'),organ:String(item.nomeOrgao||item.nome_orgao||''),hash:String(item.hash||''),canceled:!!item.motivo_cancelamento||item.ativo===false||item.status==='C',raw:JSON.stringify(item)};}
export function advance(job,length,count){const windowEnd=[addDays(job.cursor,6),job.end].sort()[0];if(length===0||length<100||(Number.isFinite(count)&&job.page*100>=count)){const cursor=addDays(windowEnd,1);return {cursor,page:1,status:cursor>job.end?'done':'running'};}return {cursor:job.cursor,page:job.page+1,status:'running'};}
export function createEngine(db,{fetcher=fetch,mode='hosted',actor=ADMIN}={}){
const q=(s,...args)=>db.prepare(s).bind(...args);const all=async(s,...a)=>(await q(s,...a).all()).results;const first=(s,...a)=>q(s,...a).first();const run=(s,...a)=>q(s,...a).run();
async function monitor(owner,b){const v=validateSearch(b);const id=owner+':'+v.uf+':'+v.oab;await run('INSERT INTO monitors(id,owner,oab,uf,enabled,created,next_run) VALUES(?,?,?,?,1,?,?) ON CONFLICT(id) DO NOTHING',id,owner,v.oab,v.uf,now(),now());return {...v,id};}
async function start(owner,b){const m=await monitor(owner,b);const existing=await first("SELECT * FROM jobs WHERE owner=? AND monitor_id=? AND status IN ('running','queued') ORDER BY created DESC LIMIT 1",owner,m.id);if(existing)return existing;const id=crypto.randomUUID();await run('INSERT INTO jobs(id,owner,monitor_id,start,end,cursor,page,status,processed,created,updated,error,locked_until,retry_at) VALUES(?,?,?,?,?,?,1,?,0,?,?,?,0,0) ON CONFLICT DO NOTHING',id,owner,m.id,m.start,m.end,m.start,'running',now(),now(),'');return (await first('SELECT * FROM jobs WHERE id=? AND owner=?',id,owner))||first("SELECT * FROM jobs WHERE monitor_id=? AND owner=? AND status='running'",m.id,owner);}
async function saveItems(owner,monitorId,items){const statements=[];for(const raw of items){const x=normalize(raw);statements.push(q('INSERT INTO publications(owner,id,cnj,tribunal,date,text,type,organ,hash,canceled,raw,seen,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?) ON CONFLICT(owner,id) DO UPDATE SET text=excluded.text,canceled=excluded.canceled,raw=excluded.raw,updated=excluded.updated',owner,x.id,x.cnj,x.tribunal,x.date,x.text,x.type,x.organ,x.hash,x.canceled?1:0,x.raw,now()));statements.push(q('INSERT OR IGNORE INTO links(owner,publication_id,monitor_id) VALUES(?,?,?)',owner,x.id,monitorId));}for(let i=0;i<statements.length;i+=80)await db.batch(statements.slice(i,i+80));}
async function eligibleKnown(owner,cnj){
 return first('SELECT id FROM publications WHERE owner=? AND cnj=? AND canceled=0 AND date>? AND date<=? AND length(date)=10 AND date(date)=date LIMIT 1',owner,cnj,twoYearsAgo(day()),day());
}
async function finishPage(owner,job){
 const pending=JSON.parse(job.pending_page),next=pending.next;
 const statements=[q('UPDATE jobs SET cursor=?,page=?,status=?,processed=processed+?,updated=?,error=?,locked_until=0,retry_at=0,pending_page=NULL WHERE id=? AND owner=?',next.cursor,next.page,next.status,pending.count,now(),'',job.id,owner)];
 if(next.status==='done')statements.push(q('UPDATE monitors SET last_success=?,next_run=? WHERE id=? AND owner=?',now(),new Date(Date.now()+6*3600000).toISOString(),job.monitor_id,owner));
 await db.batch(statements);
}
async function stagePage(owner,job,items,count){
 // Normalize and validate the whole source page before saving any checkpoint.
 const groups=new Map();
 for(const raw of items){const x=normalize(raw);let valid=true;try{date(x.date)}catch{valid=false}if(!valid||x.date>day())continue;
  if(!groups.has(x.cnj))groups.set(x.cnj,[]);groups.get(x.cnj).push(raw);
 }
 const entries=[...groups],statements=[];
 for(let i=0;i<entries.length;i+=20){
  const chunk=entries.slice(i,i+20),args=[];
  for(const [cnj,raw] of chunk)args.push(owner,job.id,cnj,JSON.stringify(raw));
  statements.push(q('INSERT INTO job_candidates(owner,job_id,cnj,raw) VALUES '+chunk.map(()=>'(?,?,?,?)').join(',')+' ON CONFLICT(owner,job_id,cnj) DO UPDATE SET raw=excluded.raw,check_page=1',...args));
 }
 const pending={next:advance(job,items.length,typeof count==='number'?count:NaN),count:items.length};
 statements.push(q("UPDATE jobs SET pending_page=?,error='',updated=? WHERE id=? AND owner=?",JSON.stringify(pending),now(),job.id,owner));
 await db.batch(statements);
 return {...job,pending_page:JSON.stringify(pending)};
}
async function verifyCandidate(owner,job){
 const candidate=await first('SELECT * FROM job_candidates WHERE owner=? AND job_id=? ORDER BY cnj LIMIT 1',owner,job.id);
 if(!candidate){await finishPage(owner,job);return;}
 const raw=JSON.parse(candidate.raw),known=await eligibleKnown(owner,candidate.cnj);
 const recentInPage=raw.some(item=>{const x=normalize(item);return !x.canceled&&isRecentActivityDate(x.date,day())});
 let accepted=!!known||recentInPage,proof=[];
 if(!accepted){
  const cached=await first('SELECT cnj FROM inactive_activity_checks WHERE owner=? AND cnj=? AND checked_day=?',owner,candidate.cnj,day());
  if(!cached){
   // Activity dates are independent from the historical period chosen for OAB discovery.
   const result=await readDjenPage(fetcher,{numeroProcesso:candidate.cnj,dataDisponibilizacaoInicio:collectionStart(day()),dataDisponibilizacaoFim:day(),pagina:String(candidate.check_page),itensPorPagina:'100'});
   const normalized=result.items.map(normalize);
   if(normalized.some(item=>item.cnj!==candidate.cnj))throw new AppError('A fonte retornou outro CNJ na verificação de atividade. O processo permanece pendente para conferência.',502);
   proof=result.items.filter((item,i)=>isRecentActivityDate(normalized[i].date,day()));
   accepted=proof.some(item=>!normalize(item).canceled);
   if(!accepted&&result.items.length===100&&(!Number.isFinite(result.count)||candidate.check_page*100<result.count)){
    await run('UPDATE job_candidates SET check_page=check_page+1 WHERE owner=? AND job_id=? AND cnj=?',owner,job.id,candidate.cnj);return;
   }
   if(!accepted)await run('INSERT INTO inactive_activity_checks(owner,cnj,checked_day) VALUES(?,?,?) ON CONFLICT(owner,cnj) DO UPDATE SET checked_day=excluded.checked_day',owner,candidate.cnj,day());
  }
 }
 if(accepted){
  // Both the historical entries and the activity evidence are real source records.
  await saveItems(owner,job.monitor_id,[...raw,...proof]);
  await run('DELETE FROM inactive_activity_checks WHERE owner=? AND cnj=?',owner,candidate.cnj);
 }
 await run('DELETE FROM job_candidates WHERE owner=? AND job_id=? AND cnj=?',owner,job.id,candidate.cnj);
 if(!await first('SELECT cnj FROM job_candidates WHERE owner=? AND job_id=? LIMIT 1',owner,job.id))await finishPage(owner,job);
}
async function step(owner,id){
 let job=await first('SELECT * FROM jobs WHERE id=? AND owner=?',id,owner);
 if(!job)throw new AppError('Busca não encontrada.',404);if(job.status==='done')return job;
 if(job.status==='error')throw new AppError('Retome a busca antes de continuar.',409);if(job.retry_at>Date.now())return job;
 const lease=Date.now()+90000,lock=await run('UPDATE jobs SET locked_until=? WHERE id=? AND owner=? AND locked_until<?',lease,id,owner,Date.now());if(!lock.meta.changes)return job;
 try{
  const monitor=await first('SELECT * FROM monitors WHERE id=? AND owner=?',job.monitor_id,owner);if(!monitor)throw new AppError('Monitor removido.',404);
  if(!job.pending_page){
   const end=[addDays(job.cursor,6),job.end].sort()[0];
   const result=await readDjenPage(fetcher,{numeroOab:monitor.oab,ufOab:monitor.uf,dataDisponibilizacaoInicio:job.cursor,dataDisponibilizacaoFim:end,pagina:String(job.page),itensPorPagina:'100'});
   job=await stagePage(owner,job,result.items,result.count);
  }
  await verifyCandidate(owner,job);
  await run('UPDATE jobs SET locked_until=0,updated=? WHERE id=? AND owner=?',now(),id,owner);
 }catch(error){
  if(error instanceof SourcePause)await run('UPDATE jobs SET retry_at=?,error=?,locked_until=0,updated=? WHERE id=? AND owner=?',error.retryAt,error.message,now(),id,owner);
  else{
   const message=error.name==='TimeoutError'?'O DJEN demorou para responder. A verificação foi preservada para retomada.':error instanceof AppError?error.message:'Falha de conexão com o DJEN. O progresso foi preservado; retome a busca.';
   await run("UPDATE jobs SET status='error',error=?,updated=?,locked_until=0 WHERE id=? AND owner=?",message,now(),id,owner);
  }
 }
 return first('SELECT * FROM jobs WHERE id=? AND owner=?',id,owner);
}
const recentCase=alias=>`(EXISTS (SELECT 1 FROM process_catalog manual WHERE manual.owner=${alias}.owner AND manual.cnj=${alias}.cnj) OR EXISTS (SELECT 1 FROM publications recent WHERE recent.owner=${alias}.owner AND recent.cnj=${alias}.cnj AND recent.canceled=0 AND recent.date>? AND recent.date<=? AND length(recent.date)=10 AND date(recent.date)=recent.date))`;
async function scope(owner,url,listFilters=false,catalog=false,activeOnly=true){
  let where='publications.owner=?';const params=[owner];
  if(activeOnly){where+=' AND '+recentCase('publications');params.push(twoYearsAgo(day()),day());}
  if(actor.role!=='admin'){where+=' AND EXISTS (SELECT 1 FROM tasks acl WHERE acl.owner=publications.owner AND acl.cnj=publications.cnj AND acl.assignee_id=?)';params.push(actor.id);}
  const monitorId=(url.searchParams.get('monitor')||'').slice(0,200);
  if(monitorId){
    if(!await first('SELECT id FROM monitors WHERE id=? AND owner=?',monitorId,owner))throw new AppError('OAB não encontrada neste escritório.',404);
    where+=' AND EXISTS (SELECT 1 FROM '+(catalog?'case_links':'links')+' sl WHERE sl.owner=publications.owner AND sl.publication_id=publications.id '+(catalog?'AND sl.is_import=publications.is_import ':'')+'AND sl.monitor_id=?)';params.push(monitorId);
  }
  const tribunal=(url.searchParams.get('tribunal')||'').slice(0,40);
  if(tribunal){where+=' AND tribunal=?';params.push(tribunal);}
  if(listFilters){
    const search=(url.searchParams.get('q')||'').trim().slice(0,150);
    if(search){where+=" AND (cnj LIKE ? OR text LIKE ? OR organ LIKE ? OR json_extract(raw, '$.destinatarios') LIKE ? OR EXISTS (SELECT 1 FROM client_processes cp JOIN clients c ON c.owner=cp.owner AND c.id=cp.client_id WHERE cp.owner=publications.owner AND cp.cnj=publications.cnj AND c.archived=0 AND c.name LIKE ?))";params.push(...Array(5).fill('%'+search+'%'));}
    if(url.searchParams.get('unread')==='1')where+=' AND seen=0';
    if(url.searchParams.get('favorite')==='1')where+=' AND EXISTS (SELECT 1 FROM process_meta pm WHERE pm.owner=publications.owner AND pm.cnj=publications.cnj AND pm.favorite=1)';
    const stage=url.searchParams.get('stage')||'';
    if(stage){if(!['active','waiting','archived'].includes(stage))throw new AppError('Situação de acompanhamento inválida.');where+=" AND COALESCE((SELECT pm.stage FROM process_meta pm WHERE pm.owner=publications.owner AND pm.cnj=publications.cnj),'active')=?";params.push(stage);}
  }
  return {where,params,monitorId,tribunal};
}
function withParties({raw,...row}){let source={};try{source=JSON.parse(raw)}catch{}return {...row,parties:partiesOf(source)};}
async function attachMeta(rows,owner){
  if(!rows.length)return rows;const cnjs=[...new Set(rows.map(x=>x.cnj))],meta=[],linked=[],clients=[],catalogs=[];const byPublication=rows.every(x=>x.id!==undefined);
  for(let i=0;i<cnjs.length;i+=80){const chunk=cnjs.slice(i,i+80),marks=chunk.map(()=>'?').join(',');
    clients.push(...await all(`SELECT cp.cnj,c.id,c.name FROM client_processes cp JOIN clients c ON c.owner=cp.owner AND c.id=cp.client_id WHERE cp.owner=? AND cp.cnj IN (${marks}) AND c.archived=0 ORDER BY c.name`,owner,...chunk));
    catalogs.push(...await all(`SELECT cnj,title FROM process_catalog WHERE owner=? AND cnj IN (${marks})`,owner,...chunk));
    meta.push(...await all(`SELECT cnj,favorite,note,stage,updated FROM process_meta WHERE owner=? AND cnj IN (${marks})`,owner,...chunk));
    if(!byPublication)linked.push(...await all(`SELECT DISTINCT p.cnj,m.id,m.oab,m.uf,m.label FROM case_records p JOIN case_links l ON l.owner=p.owner AND l.publication_id=p.id AND l.is_import=p.is_import JOIN monitors m ON m.owner=l.owner AND m.id=l.monitor_id WHERE p.owner=? AND p.cnj IN (${marks}) ORDER BY m.uf,m.oab`,owner,...chunk));
  }
  if(byPublication){const idToCnj=new Map(rows.map(x=>[String(x.id),x.cnj]));const ids=[...idToCnj.keys()];for(let i=0;i<ids.length;i+=80){const chunk=ids.slice(i,i+80);const refs=await all(`SELECT l.publication_id,m.id,m.oab,m.uf,m.label FROM links l JOIN monitors m ON m.owner=l.owner AND m.id=l.monitor_id WHERE l.owner=? AND l.publication_id IN (${chunk.map(()=>'?').join(',')}) ORDER BY m.uf,m.oab`,owner,...chunk);linked.push(...refs.map(r=>({...r,cnj:idToCnj.get(String(r.publication_id))})));}}
  const byCnj=new Map(meta.map(x=>[x.cnj,x]));
  return rows.map(x=>{const refs=linked.filter(r=>r.cnj===x.cnj&&(!x.id||String(r.publication_id)===String(x.id)));const unique=new Map(refs.map(r=>[r.id,{id:r.id,oab:r.oab,uf:r.uf,label:r.label||''}]));const catalog=catalogs.find(c=>c.cnj===x.cnj);return {...x,imported:!!catalog,parties:x.parties&&!x.parties.names.length&&catalog?.title?{...x.parties,title:catalog.title}:x.parties,clients:clients.filter(c=>c.cnj===x.cnj).map(({id,name})=>({id,name})),meta:byCnj.get(x.cnj)||{favorite:0,note:'',stage:'active',updated:null},oabs:[...unique.values()]};});
}
async function monitorsFor(owner){return all(`SELECT m.*,COUNT(DISTINCT p.cnj) processes,COALESCE(SUM(CASE WHEN p.is_import=0 THEN 1 ELSE 0 END),0) publications,COALESCE(SUM(CASE WHEN p.id IS NOT NULL AND p.seen=0 THEN 1 ELSE 0 END),0) unread FROM monitors m LEFT JOIN case_links l ON l.owner=m.owner AND l.monitor_id=m.id LEFT JOIN case_records p ON p.owner=l.owner AND p.id=l.publication_id AND p.is_import=l.is_import AND ${recentCase('p')} ${actor.role!=='admin'?'AND EXISTS (SELECT 1 FROM tasks acl WHERE acl.owner=p.owner AND acl.cnj=p.cnj AND acl.assignee_id=?)':''} WHERE m.owner=? GROUP BY m.id ${actor.role!=='admin'?'HAVING COUNT(p.id)>0':''} ORDER BY m.uf,m.oab`,twoYearsAgo(day()),day(),...(actor.role!=='admin'?[actor.id]:[]),owner);}
async function tribunalsFor(owner,url){const unfiltered=new URL(url);unfiltered.searchParams.delete('tribunal');const s=await scope(owner,unfiltered,false,true);return all(`SELECT tribunal,COUNT(DISTINCT cnj) processes,COALESCE(SUM(CASE WHEN is_import=0 THEN 1 ELSE 0 END),0) publications,COALESCE(SUM(CASE WHEN seen=0 THEN 1 ELSE 0 END),0) unread,MAX(date) last_date FROM case_records publications WHERE ${s.where} GROUP BY tribunal ORDER BY processes DESC,tribunal`,...s.params);}
async function state(owner,url){
  const view=url.searchParams.get('view')||'overview',page=Math.max(1,Math.min(1000000,Math.floor(Number(url.searchParams.get('page'))||1))),pageSize=[20,50].includes(Number(url.searchParams.get('pageSize')))?Number(url.searchParams.get('pageSize')):20;
  const s=await scope(owner,url,true,view==='processes'),context=await scope(owner,url,false,true),sort=url.searchParams.get('sort')||'newest';
  const group=view==='processes';const ordering=group?({tribunal:'tribunal ASC,date DESC,cnj ASC',oldest:'date ASC,cnj ASC',activity:'total DESC,date DESC,cnj ASC',unread:'unread DESC,date DESC,cnj ASC'}[sort]||'date DESC,cnj ASC'):sort==='oldest'?'date ASC,id ASC':'date DESC,id DESC';
  const count=await first(`SELECT COUNT(*) n FROM (${group?'SELECT cnj FROM case_records publications WHERE '+s.where+' GROUP BY cnj':'SELECT id FROM publications WHERE '+s.where})`,...s.params);
  const rows=group?await all(`SELECT cnj,MAX(tribunal) tribunal,MAX(organ) organ,COALESCE(MAX(CASE WHEN json_array_length(raw,'$.destinatarios')>0 THEN raw END),MAX(CASE WHEN is_import=1 THEN raw END),MAX(raw)) raw,MAX(date) date,SUM(CASE WHEN is_import=0 THEN 1 ELSE 0 END) total,SUM(CASE WHEN seen=0 THEN 1 ELSE 0 END) unread FROM case_records publications WHERE ${s.where} GROUP BY cnj ORDER BY ${ordering} LIMIT ? OFFSET ?`,...s.params,pageSize,(page-1)*pageSize):await all(`SELECT id,cnj,tribunal,date,text,type,organ,hash,canceled,seen,raw FROM publications WHERE ${s.where} ORDER BY ${ordering} LIMIT ? OFFSET ?`,...s.params,pageSize,(page-1)*pageSize);
  const jobs=actor.role!=='admin'?[]:await all(`SELECT j.*,m.oab,m.uf,m.label,(SELECT COUNT(*) FROM job_candidates jc WHERE jc.owner=j.owner AND jc.job_id=j.id) pending_cases FROM jobs j JOIN monitors m ON m.id=j.monitor_id AND m.owner=j.owner WHERE j.owner=? ${s.monitorId?'AND j.monitor_id=?':''} ORDER BY j.created DESC LIMIT 20`,owner,...(s.monitorId?[s.monitorId]:[]));
  return {mode,user:{id:actor.id,name:actor.name,role:actor.role},permissions:permissionsFor(actor),taskStats:await collaborationFor(owner).summary(url),stats:await first(`SELECT COALESCE(SUM(CASE WHEN is_import=0 THEN 1 ELSE 0 END),0) publications,COUNT(DISTINCT cnj) processes,COALESCE(SUM(CASE WHEN seen=0 THEN 1 ELSE 0 END),0) unread FROM case_records publications WHERE ${context.where}`,...context.params),monitors:await monitorsFor(owner),tribunals:await tribunalsFor(owner,url),jobs,rows:await attachMeta(rows.map(withParties),owner),total:count.n,page,pageSize,collectionPolicy:{cutoff:twoYearsAgo(day()),activityStart:collectionStart(day()),searchDatesUnrestricted:true,basis:'Publicações não canceladas capturadas no DJEN',manualImportsPreserved:true},context:{monitorId:s.monitorId,tribunal:s.tribunal}};
}
async function activity(owner,url){
  const w=activityWindow(url.searchParams.get('days')),s=await scope(owner,url,true);
  const rows=await all(`SELECT cnj,tribunal,COALESCE(MAX(CASE WHEN json_array_length(raw,'$.destinatarios')>0 THEN raw END),MAX(raw)) raw,MAX(CASE WHEN date BETWEEN ? AND ? THEN date END) last_date,SUM(CASE WHEN date BETWEEN ? AND ? THEN 1 ELSE 0 END) current,SUM(CASE WHEN date BETWEEN ? AND ? THEN 1 ELSE 0 END) previous,SUM(CASE WHEN seen=0 AND date BETWEEN ? AND ? THEN 1 ELSE 0 END) unread FROM publications WHERE ${s.where} AND canceled=0 AND date BETWEEN ? AND ? GROUP BY cnj,tribunal HAVING current>0 ORDER BY current DESC,last_date DESC,cnj ASC LIMIT 20`,w.start,w.end,w.start,w.end,w.previousStart,w.previousEnd,w.start,w.end,...s.params,w.previousStart,w.end);
  const daily=await all(`SELECT date,COUNT(*) count FROM publications WHERE ${s.where} AND canceled=0 AND date BETWEEN ? AND ? GROUP BY date ORDER BY date`,...s.params,w.start,w.end);const byDate=new Map(daily.map(x=>[x.date,x.count]));const timeline=Array.from({length:w.days},(_,i)=>{const date=addDays(w.start,i);return {date,count:byDate.get(date)||0}});
  const totals=await first(`SELECT COUNT(*) publications,COUNT(DISTINCT cnj) processes,COALESCE(SUM(CASE WHEN seen=0 THEN 1 ELSE 0 END),0) unread FROM publications WHERE ${s.where} AND canceled=0 AND date BETWEEN ? AND ?`,...s.params,w.start,w.end);
  return {window:w,rows:await attachMeta(rows.map(withParties),owner),timeline,totals,metric:'Publicações não canceladas capturadas no DJEN. Não representa todas as movimentações do tribunal.'};
}
const clientsFor=owner=>createClients(db,{owner,actor,resolveScope:url=>scope(owner,url),resolveCaseScope:url=>scope(owner,url,false,true)});
const collaborationFor=owner=>createCollaboration(db,{owner,actor,mode,resolveScope:url=>scope(owner,url,false,true,false)});
async function handle(request,owner){
  const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean).map(decodeURIComponent),method=request.method;let body={};
  if(!['GET','HEAD'].includes(method)){if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new AppError('Origem não autorizada.',403);const raw=await request.text();if(raw.length>2000000)throw new AppError('Arquivo muito grande. Importe até 2 MB por lote.',413);try{body=JSON.parse(raw||'{}');}catch{throw new AppError('JSON inválido.');}if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('Informe um objeto JSON válido.');}
  const clientsResult=await clientsFor(owner).handle(path,method,body,url);if(clientsResult!==undefined)return clientsResult;
  const collaborationResult=await collaborationFor(owner).handle(path,method,body,url);if(collaborationResult!==undefined)return collaborationResult;
  if(actor.role!=='admin'&&['meta','search','jobs','monitors','read','import','export'].includes(path[0]))throw new AppError('Esta ação é permitida apenas ao administrador.',403);
  if(path[0]==='state'&&method==='GET')return state(owner,url);
  if(path[0]==='activity'&&method==='GET')return activity(owner,url);
  if(path[0]==='meta'&&method==='PATCH'){
    const cnj=String(path[1]||'');if(!/^\d{20}$/.test(cnj))throw new AppError('CNJ inválido.');if(!await first('SELECT id FROM case_records WHERE owner=? AND cnj=? LIMIT 1',owner,cnj))throw new AppError('Processo não encontrado.',404);
    if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>10000))throw new AppError('Anotações devem ter até 10.000 caracteres.');if(body.favorite!==undefined&&typeof body.favorite!=='boolean')throw new AppError('Informe favorite como verdadeiro ou falso.');if(body.stage!==undefined&&!['active','waiting','archived'].includes(body.stage))throw new AppError('Situação de acompanhamento inválida.');
    await run('INSERT INTO process_meta(owner,cnj,favorite,note,stage,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,cnj) DO UPDATE SET favorite=CASE WHEN ? THEN excluded.favorite ELSE process_meta.favorite END,note=CASE WHEN ? THEN excluded.note ELSE process_meta.note END,stage=CASE WHEN ? THEN excluded.stage ELSE process_meta.stage END,updated=excluded.updated',owner,cnj,Number(body.favorite||false),body.note||'',body.stage||'active',now(),body.favorite===undefined?0:1,body.note===undefined?0:1,body.stage===undefined?0:1);return {ok:true};
  }
  if(path[0]==='search'&&method==='POST')return start(owner,body);
  if(path[0]==='jobs'&&method==='POST'){const job=await first('SELECT * FROM jobs WHERE id=? AND owner=?',path[1],owner);if(!job)throw new AppError('Busca não encontrada.',404);if(path[2]==='resume'){await run("UPDATE jobs SET status='running',error='',retry_at=0,locked_until=0 WHERE id=? AND owner=? AND status='error'",path[1],owner);return first('SELECT * FROM jobs WHERE id=? AND owner=?',path[1],owner);}if(path[2]==='step')return step(owner,path[1]);}
  if(path[0]==='monitors'&&method==='PATCH'){
    if(!await first('SELECT id FROM monitors WHERE id=? AND owner=?',path[1],owner))throw new AppError('OAB não encontrada.',404);
    if(body.enabled!==undefined){if(typeof body.enabled!=='boolean')throw new AppError('Informe enabled como verdadeiro ou falso.');await run('UPDATE monitors SET enabled=? WHERE id=? AND owner=?',Number(body.enabled),path[1],owner);}
    if(body.label!==undefined){if(typeof body.label!=='string'||body.label.length>120)throw new AppError('O nome da OAB deve ter até 120 caracteres.');await run('UPDATE monitors SET label=? WHERE id=? AND owner=?',body.label.trim(),path[1],owner);}return {ok:true};
  }
  if(path[0]==='read'&&method==='POST'){
    const s=await scope(owner,url,body.all===true);let where=s.where;const params=[...s.params];
    if(body.cnj){where+=' AND cnj=?';params.push(String(body.cnj));}else if(body.id){where+=' AND id=?';params.push(String(body.id));}else if(body.all!==true)throw new AppError('Informe a publicação.');
    const result=await run(`UPDATE publications SET seen=1 WHERE ${where} AND seen=0`,...params);return {ok:true,changed:result.meta.changes};
  }
  if(path[0]==='process'&&method==='GET'){
    const s=await scope(owner,url,false,false,false),where=s.where+' AND cnj=?',params=[...s.params,path[1]];
    const rows=await all(`SELECT id,cnj,tribunal,date,text,type,organ,hash,canceled,seen,raw FROM publications WHERE ${where} ORDER BY date DESC LIMIT 100 OFFSET ?`,...params,Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0)));
    if(actor.role!=='admin'&&!await first('SELECT id FROM tasks WHERE owner=? AND cnj=? AND assignee_id=? LIMIT 1',owner,path[1],actor.id))throw new AppError('Processo não encontrado.',404);
    const cs=await scope(owner,url,false,true,false);
    const catalog=await first(`SELECT c.* FROM process_catalog c WHERE c.owner=? AND c.cnj=? AND EXISTS (SELECT 1 FROM case_records publications WHERE ${cs.where} AND publications.cnj=c.cnj)`,owner,path[1],...cs.params);
    return {catalog:catalog?{cnj:catalog.cnj,title:catalog.title,fields:JSON.parse(catalog.raw)._juris_import.fields}:null,rows:await attachMeta(rows.map(withParties),owner),count:await first(`SELECT COUNT(*) n FROM publications WHERE ${where}`,...params),meta:await first('SELECT favorite,note,stage,updated FROM process_meta WHERE owner=? AND cnj=?',owner,path[1])||{favorite:0,note:'',stage:'active',updated:null}};
  }
  if(path[0]==='import'&&method==='POST'){
    let parsed;try{parsed=classifyImport(body.items);}catch(error){throw new AppError(error.message);}
    validateSearch(body);
    if(parsed.kind==='publications'){
      parsed.items.forEach(normalize);
      if(body.preview===true)return {kind:parsed.kind,total:parsed.items.length};
      const m=await monitor(owner,body);await saveItems(owner,m.id,parsed.items);
      return {ok:true,kind:parsed.kind,processed:parsed.items.length,monitorId:m.id};
    }
    const {records,duplicates}=parsed;let existing=0;
    for(let i=0;i<records.length;i+=80){
      const chunk=records.slice(i,i+80);
      existing+=(await first(`SELECT COUNT(DISTINCT cnj) n FROM case_records WHERE owner=? AND cnj IN (${chunk.map(()=>'?').join(',')})`,owner,...chunk.map(r=>r.cnj))).n;
    }
    const summary={kind:'processes',total:parsed.items.length,unique:records.length,duplicates,existing,added:records.length-existing};
    if(body.preview===true)return summary;
    const m=await monitor(owner,body);
    for(let i=0;i<records.length;i+=40){
      const statements=[],at=now();
      for(const r of records.slice(i,i+40)){
        statements.push(q('INSERT INTO process_catalog(owner,cnj,title,tribunal,raw,created,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,cnj) DO UPDATE SET title=excluded.title,tribunal=excluded.tribunal,raw=excluded.raw,updated=excluded.updated',owner,r.cnj,r.title,r.tribunal,r.raw,at,at));
        statements.push(q('INSERT OR IGNORE INTO catalog_monitors(owner,cnj,monitor_id) VALUES(?,?,?)',owner,r.cnj,m.id));
      }
      await db.batch(statements);
    }
    return {ok:true,...summary,processed:records.length,monitorId:m.id};
  }
  if(path[0]==='catalog'&&path[1]==='export'&&method==='GET'){
    if(actor.role!=='admin')throw new AppError('Esta ação é permitida apenas ao administrador.',403);
    const s=await scope(owner,url,false,true);
    const rows=await all(`SELECT c.raw FROM process_catalog c WHERE c.owner=? AND EXISTS (SELECT 1 FROM case_records publications WHERE ${s.where} AND publications.cnj=c.cnj) ORDER BY c.cnj LIMIT 500 OFFSET ?`,owner,...s.params,Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0)));
    return {pageSize:500,items:rows.map(r=>JSON.parse(r.raw)._juris_import.fields)};
  }
  if(path[0]==='export'&&method==='GET'){
    const s=await scope(owner,url,true);const rows=await all(`SELECT id,cnj,raw FROM publications WHERE ${s.where} ORDER BY tribunal,cnj,id LIMIT 500 OFFSET ?`,...s.params,Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0)));const annotated=await attachMeta(rows,owner);
    return {version:2,exportedAt:now(),pageSize:500,items:annotated.map(({raw,oabs})=>({...JSON.parse(raw),_juris_oabs:oabs}))};
  }
  throw new AppError('Rota não encontrada.',404);
}

async function tick(){const active=await all("SELECT id,owner FROM jobs WHERE status='running' AND retry_at<=? AND locked_until<? ORDER BY updated LIMIT 1",Date.now(),Date.now());if(active.length){const result=await step(active[0].owner,active[0].id);return {worked:true,job:result};}const due=await all('SELECT * FROM monitors WHERE enabled=1 AND next_run<=? ORDER BY next_run LIMIT 1',now());if(due.length){const m=due[0];const latest=await first('SELECT status FROM jobs WHERE monitor_id=? ORDER BY created DESC LIMIT 1',m.id);if(latest?.status==='error'){await run('UPDATE monitors SET next_run=? WHERE id=?',new Date(Date.now()+6*3600000).toISOString(),m.id);return {worked:true};}const job=await start(m.owner,{oab:m.oab,uf:m.uf,start:addDays(day(),-7),end:day()});return {worked:true,job};}return {worked:false};}
return {handle,tick,step,start,saveItems};}
