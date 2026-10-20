import {AppError} from './errors.mjs';
import {partiesOf} from '../public/parties.mjs';
function officeDay(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function plusDays(value,n){const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10);}
function totals(alias='t'){return `COUNT(*) total,
 COALESCE(SUM(CASE WHEN ${alias}.status='done' THEN 1 ELSE 0 END),0) done,
 COALESCE(SUM(CASE WHEN ${alias}.status!='done' THEN 1 ELSE 0 END),0) open,
 COALESCE(SUM(CASE WHEN ${alias}.status='todo' THEN 1 ELSE 0 END),0) todo,
 COALESCE(SUM(CASE WHEN ${alias}.status='doing' THEN 1 ELSE 0 END),0) doing,
 COALESCE(SUM(CASE WHEN ${alias}.status='review' THEN 1 ELSE 0 END),0) review,
 COALESCE(SUM(CASE WHEN ${alias}.status!='done' AND ${alias}.due_date<? THEN 1 ELSE 0 END),0) overdue,
 COALESCE(SUM(CASE WHEN ${alias}.status!='done' AND ${alias}.due_date=? THEN 1 ELSE 0 END),0) today,
 COALESCE(SUM(CASE WHEN ${alias}.status!='done' AND ${alias}.due_date BETWEEN ? AND ? THEN 1 ELSE 0 END),0) week,
 COALESCE(SUM(CASE WHEN ${alias}.status!='done' AND ${alias}.assignee_id IS NULL THEN 1 ELSE 0 END),0) unassigned,
 COALESCE(SUM(CASE WHEN ${alias}.status!='done' AND ${alias}.due_date IS NULL THEN 1 ELSE 0 END),0) no_date,
 MIN(CASE WHEN ${alias}.status!='done' THEN ${alias}.due_date END) next_due`;}
export function createPendingBoard(db,{owner,actor,taskContext,directory}){
 const q=(sql,...args)=>db.prepare(sql).bind(...args),all=async(sql,...args)=>(await q(sql,...args).all()).results,first=(sql,...args)=>q(sql,...args).first();
 async function list(url){
  const today=officeDay(),dates=[today,today,today,plusDays(today,6)],base=await taskContext(url);
  let where=base.where,args=[...base.args];
  const assignee=(url.searchParams.get('assignee')||'').slice(0,150);
  if(assignee&&actor.role==='admin'){if(assignee==='unassigned')where+=' AND t.assignee_id IS NULL';else{where+=' AND t.assignee_id=?';args.push(assignee==='me'?actor.id:assignee);}}
  const priority=url.searchParams.get('priority')||'';
  if(priority){if(!['low','normal','high'].includes(priority))throw new AppError('Prioridade inválida.');where+=' AND t.priority=?';args.push(priority);}
  const text=(url.searchParams.get('q')||'').trim().slice(0,150);
  if(text){
   where+=` AND (t.title LIKE ? OR t.description LIKE ? OR t.cnj LIKE ? OR EXISTS (SELECT 1 FROM case_records pc WHERE pc.owner=t.owner AND pc.cnj=t.cnj AND (json_extract(pc.raw,'$.destinatarios') LIKE ? OR json_extract(pc.raw,'$._juris_import.title') LIKE ?)) OR EXISTS (SELECT 1 FROM client_processes cp JOIN clients c ON c.owner=cp.owner AND c.id=cp.client_id WHERE cp.owner=t.owner AND cp.cnj=t.cnj AND c.archived=0 AND c.name LIKE ?))`;
   const digits=text.replace(/\D/g,'');args.push('%'+text+'%','%'+text+'%','%'+(digits.length===20?digits:text)+'%','%'+text+'%','%'+text+'%','%'+text+'%');
  }
  const summary=await first(`SELECT ${totals()},COUNT(DISTINCT CASE WHEN t.status!='done' THEN t.cnj END) processes FROM tasks t WHERE ${where}`,...dates,...args);
  const focus=url.searchParams.get('focus')||'open';
  if(!['open','overdue','today','week','review','unassigned','no_date','done'].includes(focus))throw new AppError('Filtro de pendências inválido.');
  let selected=where;const selectedArgs=[...args];
  if(focus==='done')selected+=" AND t.status='done'";
  else{
   selected+=" AND t.status!='done'";
   if(focus==='overdue'){selected+=' AND t.due_date<?';selectedArgs.push(today);}
   if(focus==='today'){selected+=' AND t.due_date=?';selectedArgs.push(today);}
   if(focus==='week'){selected+=' AND t.due_date BETWEEN ? AND ?';selectedArgs.push(today,plusDays(today,6));}
   if(focus==='review')selected+=" AND t.status='review'";
   if(focus==='unassigned')selected+=' AND t.assignee_id IS NULL';
   if(focus==='no_date')selected+=' AND t.due_date IS NULL';
  }
  const sort=url.searchParams.get('sort')||'attention';
  if(!['attention','due','updated'].includes(sort))throw new AppError('Ordenação de pendências inválida.');
  const ordering=sort==='updated'?'updated DESC,cnj':sort==='due'?'next_due IS NULL,next_due,updated DESC,cnj':"CASE WHEN overdue>0 THEN 0 WHEN today>0 THEN 1 WHEN week>0 THEN 2 WHEN review>0 THEN 3 WHEN next_due IS NOT NULL THEN 4 ELSE 5 END,next_due IS NULL,next_due,updated DESC,cnj";
  const page=Math.max(1,Math.min(1000000,Math.floor(Number(url.searchParams.get('page'))||1))),pageSize=12;
  const count=(await first(`SELECT COUNT(DISTINCT t.cnj) n FROM tasks t WHERE ${selected}`,...selectedArgs)).n;
  const groups=await all(`SELECT t.cnj,${totals()},MAX(t.updated) updated FROM tasks t WHERE ${selected} GROUP BY t.cnj ORDER BY ${ordering} LIMIT ? OFFSET ?`,...dates,...selectedArgs,pageSize,(page-1)*pageSize);
  if(!groups.length)return {rows:[],total:count,page,pageSize,summary,people:await directory(),focus,today};
  const cnjs=groups.map(row=>row.cnj),marks=cnjs.map(()=>'?').join(',');
  const counts=await all(`SELECT t.cnj,${totals()} FROM tasks t WHERE ${where} AND t.cnj IN (${marks}) GROUP BY t.cnj`,...dates,...args,...cnjs);
  const cases=await all(`SELECT cnj,MAX(tribunal) tribunal,COALESCE(MAX(CASE WHEN json_array_length(raw,'$.destinatarios')>0 THEN raw END),MAX(CASE WHEN is_import=1 THEN raw END),MAX(raw)) raw FROM case_records WHERE owner=? AND cnj IN (${marks}) GROUP BY cnj`,owner,...cnjs);
  const clients=await all(`SELECT cp.cnj,c.id,c.name FROM client_processes cp JOIN clients c ON c.owner=cp.owner AND c.id=cp.client_id WHERE cp.owner=? AND cp.cnj IN (${marks}) AND c.archived=0 ORDER BY c.name`,owner,...cnjs);
  const oabs=await all(`SELECT DISTINCT p.cnj,m.id,m.oab,m.uf,m.label FROM case_records p JOIN case_links l ON l.owner=p.owner AND l.publication_id=p.id AND l.is_import=p.is_import JOIN monitors m ON m.owner=l.owner AND m.id=l.monitor_id WHERE p.owner=? AND p.cnj IN (${marks}) ORDER BY m.uf,m.oab`,owner,...cnjs);
  const previews=await all(`SELECT r.*,CASE WHEN r.assignee_id='admin' THEN 'Administrador do escritório' ELSE m.name END assignee_name,m.active assignee_active FROM (SELECT t.*,ROW_NUMBER() OVER (PARTITION BY t.cnj ORDER BY CASE WHEN t.status!='done' AND t.due_date<? THEN 0 WHEN t.status!='done' AND t.due_date=? THEN 1 WHEN t.status!='done' AND t.due_date BETWEEN ? AND ? THEN 2 WHEN t.status='review' THEN 3 ELSE 4 END,t.due_date IS NULL,t.due_date,CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,t.created,t.id) pending_rank FROM tasks t WHERE ${selected} AND t.cnj IN (${marks})) r LEFT JOIN members m ON m.owner=r.owner AND m.id=r.assignee_id WHERE r.pending_rank<=4 ORDER BY r.cnj,r.pending_rank`,...dates,...selectedArgs,...cnjs);
  const byCnj=new Map(cases.map(row=>[row.cnj,row])),byCounts=new Map(counts.map(row=>[row.cnj,row]));
  return {rows:groups.map(group=>{
   const record=byCnj.get(group.cnj);let raw={};try{raw=JSON.parse(record?.raw||'{}');}catch{}
   return {cnj:group.cnj,tribunal:record?.tribunal||'Não informado',parties:partiesOf(raw),matching:group.total,summary:byCounts.get(group.cnj),tasks:previews.filter(row=>row.cnj===group.cnj),clients:clients.filter(row=>row.cnj===group.cnj).map(({id,name})=>({id,name})),oabs:oabs.filter(row=>row.cnj===group.cnj).map(({id,oab,uf,label})=>({id,oab,uf,label:label||''}))};
  }),total:count,page,pageSize,summary,people:await directory(),focus,today};
 }
 return {list};
}
