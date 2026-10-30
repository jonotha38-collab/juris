import {AppError} from './errors.mjs';
import {partiesOf} from '../public/parties.mjs';

export function createReports(db,{owner,actor,resolveScope,decorate}) {
 const q=(sql,...args)=>db.prepare(sql).bind(...args);
 const all=async(sql,...args)=>(await q(sql,...args).all()).results;
 const first=(sql,...args)=>q(sql,...args).first();
 const pageSize=500;
 async function scope(url,selected=false) {
  const clean=new URL(url);clean.searchParams.delete('tribunal');clean.searchParams.delete('tribunals');
  const base=await resolveScope(clean);
  const tribunals=[...new Set(url.searchParams.getAll('tribunals'))];
  if(!selected)return {...base,tribunals};
  if(!tribunals.length||tribunals.length>200||tribunals.some(value=>!value.trim()||value.length>200))throw new AppError('Selecione de 1 a 200 tribunais para exportar.');
  const available=await all(`SELECT DISTINCT tribunal FROM case_records publications WHERE ${base.where}`,...base.params);
  const allowed=new Set(available.map(row=>row.tribunal));
  if(tribunals.some(value=>!allowed.has(value)))throw new AppError('Um tribunal não está disponível nesta seleção. Atualize a lista e tente novamente.');
  return {...base,tribunals,where:base.where+` AND tribunal IN (${tribunals.map(()=>'?').join(',')})`,params:[...base.params,...tribunals]};
 }
 async function options(url) {
  const s=await scope(url);
  const rows=await all(`SELECT tribunal,COUNT(DISTINCT cnj) processes,COALESCE(SUM(is_import=0),0) publications FROM case_records publications WHERE ${s.where} GROUP BY tribunal ORDER BY tribunal`,...s.params);
  const totals=await first(`SELECT COUNT(DISTINCT cnj) processes,COALESCE(SUM(is_import=0),0) publications FROM case_records publications WHERE ${s.where}`,...s.params);
  return {rows,totals,pageSize};
 }
 function cursor(url,size,tribunals) {
  const value=url.searchParams.get('after');if(!value)return null;
  let parts;try{parts=JSON.parse(value);}catch{throw new AppError('A página da exportação é inválida. Reinicie a exportação.');}
  if(value.length>2048||!Array.isArray(parts)||parts.length!==size||!tribunals.includes(parts[0])||typeof parts[1]!=='string'||!/^\d{20}$/.test(parts[1])||size===3&&(typeof parts[2]!=='string'||parts[2].length>500))throw new AppError('A página da exportação é inválida. Reinicie a exportação.');
  return parts;
 }
 function parties(row) {let raw={};try{raw=JSON.parse(row.raw);}catch{}const {raw:ignored,...rest}=row;return {...rest,parties:partiesOf(raw)};}
 async function processes(url) {
  const s=await scope(url,true),after=cursor(url,2,s.tribunals),args=[...s.params];let where=s.where;
  if(after){where+=' AND (tribunal>? OR tribunal=? AND cnj>?)';args.push(after[0],after[0],after[1]);}
  const rows=await all(`SELECT cnj,tribunal,MAX(organ) organ,COALESCE(MAX(CASE WHEN json_array_length(raw,'$.destinatarios')>0 THEN raw END),MAX(CASE WHEN is_import=1 THEN raw END),MAX(raw)) raw,MIN(CASE WHEN is_import=0 THEN date END) first_date,MAX(CASE WHEN is_import=0 THEN date END) date,SUM(is_import=0) total,SUM(CASE WHEN is_import=0 AND canceled=1 THEN 1 ELSE 0 END) canceled FROM case_records publications WHERE ${where} GROUP BY tribunal,cnj ORDER BY tribunal,cnj LIMIT ?`,...args,pageSize+1);
  const more=rows.length>pageSize,visible=rows.slice(0,pageSize),last=visible.at(-1);
  return {rows:await decorate(visible.map(parties)),pageSize,next:more?JSON.stringify([last.tribunal,last.cnj]):null};
 }
 async function publications(url) {
  const s=await scope(url,true),after=cursor(url,3,s.tribunals),args=[...s.params];let where=s.where+' AND is_import=0';
  if(after){where+=' AND (tribunal>? OR tribunal=? AND (cnj>? OR cnj=? AND id>?))';args.push(after[0],after[0],after[1],after[1],after[2]);}
  const rows=await all(`SELECT id,cnj,tribunal,date,text,type,organ,hash,canceled,raw FROM case_records publications WHERE ${where} ORDER BY tribunal,cnj,id LIMIT ?`,...args,pageSize+1);
  const more=rows.length>pageSize,visible=rows.slice(0,pageSize),last=visible.at(-1);
  return {rows:await decorate(visible.map(parties)),pageSize,next:more?JSON.stringify([last.tribunal,last.cnj,last.id]):null};
 }
 async function handle(path,method,url) {
  if(path[0]!=='reports')return undefined;
  if(actor.role!=='admin')throw new AppError('A exportação é permitida apenas ao administrador.',403);
  if(method!=='GET'||path.length!==2)throw new AppError('Rota de exportação não encontrada.',404);
  if(path[1]==='tribunals')return options(url);
  if(path[1]==='processes')return processes(url);
  if(path[1]==='publications')return publications(url);
  throw new AppError('Rota de exportação não encontrada.',404);
 }
 return {handle};
}
