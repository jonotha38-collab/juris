import {AppError} from './errors.mjs';
import {partiesOf} from '../public/parties.mjs';
import {analyzeDeadlines,validDeadlineDate,suggestDeadline} from '../public/deadline-rules.mjs';
export function createDeadlineReviews(db,{owner,actor,resolveScope}){
 const q=(sql,...args)=>db.prepare(sql).bind(...args),first=(sql,...args)=>q(sql,...args).first(),all=async(sql,...args)=>(await q(sql,...args).all()).results;
 const stamp=()=>new Date().toISOString();
 const admin=()=>{if(actor.role!=='admin')throw new AppError('A conferência de prazos é feita pelo administrador do escritório.',403);};
 const text=(value,label,max,required=false)=>{if(typeof value!=='string'||value.trim().length>max||required&&!value.trim())throw new AppError('Confira '+label+'.');return value.trim();};
 function decode(row){const {raw,...rest}=row;let source={};try{source=JSON.parse(raw)}catch{}return {...rest,parties:partiesOf(source),analysis:analyzeDeadlines(row.text),certificate:row.hash?'https://comunicaapi.pje.jus.br/api/v1/comunicacao/'+encodeURIComponent(row.hash)+'/certidao':null};}
 async function base(url){
  const scope=await resolveScope(url);let where=scope.where,args=[...scope.params];
  const cnj=url.searchParams.get('cnj');if(cnj){if(!/^\d{20}$/.test(cnj))throw new AppError('Número CNJ inválido.');where+=' AND publications.cnj=?';args.push(cnj);}
  const query=(url.searchParams.get('q')||'').trim().slice(0,150);
  if(query){where+=` AND (publications.text LIKE ? OR publications.cnj LIKE ? OR json_extract(publications.raw,'$.destinatarios') LIKE ? OR EXISTS (SELECT 1 FROM client_processes cp JOIN clients c ON c.owner=cp.owner AND c.id=cp.client_id WHERE cp.owner=publications.owner AND cp.cnj=publications.cnj AND c.archived=0 AND c.name LIKE ?))`;const digits=query.replace(/\D/g,'');args.push('%'+query+'%','%'+(digits.length===20?digits:query)+'%','%'+query+'%','%'+query+'%');}
  return {where,args};
 }
 const from='FROM publications JOIN publication_reviews r ON r.owner=publications.owner AND r.publication_id=publications.id';
 const select='publications.id,publications.cnj,publications.tribunal,publications.date,publications.text,publications.type,publications.organ,publications.hash,publications.canceled,publications.seen,publications.raw,r.status,r.version,r.source_version,r.reviewer_id,r.reviewer_name,r.reviewed_at,r.reason,r.updated';
 async function summary(url){
  if(actor.role!=='admin')return null;
  const {where,args}=await base(url);
  return first(`SELECT COUNT(*) total,COALESCE(SUM(r.status='pending'),0) pending,COALESCE(SUM(r.status='confirmed'),0) confirmed,COALESCE(SUM(r.status='dismissed'),0) dismissed,COALESCE(SUM(r.status='pending' AND r.source_version>1),0) changed,COALESCE(SUM(r.status='pending' AND publications.canceled=1),0) canceled ${from} WHERE ${where}`,...args);
 }
 async function one(id){
  const row=await first(`SELECT ${select} ${from} WHERE publications.owner=? AND publications.id=?`,owner,id);
  if(!row)throw new AppError('Publicação não encontrada neste escritório.',404);
  return decode(row);
 }
 async function taskSource(taskId){
  const row=await first(`SELECT d.publication_id,d.source_version,d.details,r.source_version current_source_version,r.status review_status,p.cnj,p.tribunal,p.date,p.hash,p.canceled,p.text,r.reviewer_name,r.reviewed_at FROM deadline_task_links d JOIN tasks t ON t.owner=d.owner AND t.id=d.task_id JOIN publication_reviews r ON r.owner=d.owner AND r.publication_id=d.publication_id JOIN publications p ON p.owner=d.owner AND p.id=d.publication_id WHERE d.owner=? AND d.task_id=? ${actor.role!=='admin'?'AND t.assignee_id=?':''}`,owner,taskId,...(actor.role!=='admin'?[actor.id]:[]));
  if(!row)return null;
  return {...row,changed:row.source_version!==row.current_source_version,details:JSON.parse(row.details),certificate:row.hash?'https://comunicaapi.pje.jus.br/api/v1/comunicacao/'+encodeURIComponent(row.hash)+'/certidao':null};
 }
 async function detail(id){
  const review=await one(id);
  const tasks=await all("SELECT t.id,t.title,t.status,t.due_date,t.assignee_id,d.source_version,CASE WHEN t.assignee_id='admin' THEN 'Administrador do escritório' ELSE m.name END assignee_name FROM deadline_task_links d JOIN tasks t ON t.owner=d.owner AND t.id=d.task_id LEFT JOIN members m ON m.owner=t.owner AND m.id=t.assignee_id WHERE d.owner=? AND d.publication_id=? ORDER BY d.created,t.id",owner,id);
  const people=[{id:'admin',name:'Administrador do escritório',active:1},...await all('SELECT id,name,active FROM members WHERE owner=? ORDER BY name',owner)];
  const history=await all('SELECT actor_name,action,data,created,source_version FROM publication_review_events WHERE owner=? AND publication_id=? ORDER BY created DESC,id DESC LIMIT 30',owner,id);
  return {review,tasks,people,history:history.map(event=>({...event,data:JSON.parse(event.data)}))};
 }
 async function list(url){
  const {where,args}=await base(url),status=url.searchParams.get('status')||'pending';
  if(!['pending','confirmed','dismissed','all','changed'].includes(status))throw new AppError('Filtro de conferência inválido.');
  const selected=where+(status==='all'?'':status==='changed'?" AND r.status='pending' AND r.source_version>1":' AND r.status=?');
  const selectedArgs=[...args,...(['all','changed'].includes(status)?[]:[status])],page=Math.max(1,Math.min(1000000,Math.floor(Number(url.searchParams.get('page'))||1))),pageSize=15;
  const count=await first(`SELECT COUNT(*) n ${from} WHERE ${selected}`,...selectedArgs);
  const rows=await all(`SELECT ${select},(SELECT COUNT(*) FROM deadline_task_links d WHERE d.owner=r.owner AND d.publication_id=r.publication_id) linked_tasks ${from} WHERE ${selected} ORDER BY CASE WHEN r.status='pending' AND r.source_version>1 THEN 0 ELSE 1 END,publications.date DESC,r.updated DESC,publications.id DESC LIMIT ? OFFSET ?`,...selectedArgs,pageSize,(page-1)*pageSize);
  return {rows:rows.map(row=>{const decoded=decode(row);return {...decoded,text:row.text.slice(0,450),analysis:{...decoded.analysis,items:decoded.analysis.items.map(({excerpt,...item})=>item)}}}),summary:await summary(url),page,pageSize,total:count.n,status};
 }
 async function resolve(id,body){
  const review=await one(id);
  if(!Number.isInteger(body.version)||body.version!==review.version)throw new AppError('A publicação ou a conferência foi atualizada. Reabra antes de confirmar.',409);
  const action=body.action;
  if(!['confirm','dismiss','reopen'].includes(action))throw new AppError('Escolha como concluir a conferência.');
  if(action!=='reopen'&&review.status!=='pending')throw new AppError('Esta publicação já foi conferida. Reabra a conferência para alterá-la.',409);
  if(action==='reopen'&&review.status==='pending')throw new AppError('A publicação já está aguardando conferência.',409);
  if(action!=='reopen'&&body.source_checked!==true)throw new AppError('Confirme a leitura integral e a verificação na fonte oficial.');
  const reason=text(body.reason??'','a observação da conferência',2000,action==='dismiss');
  if(action==='dismiss'&&reason.length<8)throw new AppError('Explique por que não é necessário cadastrar um novo prazo (ao menos 8 caracteres).');
  if(action==='confirm'&&review.canceled)throw new AppError('Esta publicação está cancelada. Confira as tarefas já criadas e registre o motivo da conferência.');
  const candidates=review.analysis.items,items=[];
  if(action==='confirm'){
   if(!Array.isArray(body.tasks)||!body.tasks.length||body.tasks.length>12)throw new AppError('Confira de 1 a 12 providências nesta publicação.');
   const included=new Set();
   for(const item of body.tasks){
    if(!item||typeof item!=='object')throw new AppError('Confira os dados de cada prazo.');
    const title=text(item.title,'o título do prazo',200,true),description=text(item.description??'','as orientações',2000);
    const assignee=text(item.assignee_id??'','o responsável',150,true);
    if(assignee!=='admin'&&!await first('SELECT id FROM members WHERE owner=? AND id=? AND active=1',owner,assignee))throw new AppError('Escolha um responsável ativo deste escritório.');
    if(!validDeadlineDate(item.due_date))throw new AppError('Confirme o vencimento de cada providência antes de salvar.');
    const candidate=item.candidate_key?candidates.find(c=>c.key===item.candidate_key):null;
    if(item.candidate_key&&!candidate)throw new AppError('A indicação do prazo mudou. Reabra a publicação.',409);
    if(candidate){if(included.has(candidate.key))throw new AppError('A mesma indicação foi selecionada mais de uma vez.');included.add(candidate.key);}
    const dueTime=item.due_time||null;
    if(dueTime!==null&&(typeof dueTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)))throw new AppError('Confira o horário do vencimento.');
    if(candidate?.unit==='hour'&&!dueTime)throw new AppError('Prazos em horas exigem o horário de vencimento conferido (Brasília).');
    let calculation=null;
    if(item.calculation){
     if(candidate&&(candidate.unit!=='day'||candidate.ambiguous))throw new AppError('Este período exige data conferida manualmente.');
     try{calculation=suggestDeadline(item.calculation);}catch(error){throw new AppError(error.message);}
     if(candidate&&calculation.amount!==candidate.amount)throw new AppError('Use a quantidade de dias indicada na publicação ou informe uma data conferida manualmente.');
     if(candidate?.basis&&calculation.mode!==candidate.basis)throw new AppError('O modo de contagem difere do texto. Confira a regra e use data manual se houver exceção.');
     if(calculation.due_date!==item.due_date)throw new AppError('O vencimento difere da simulação. Atualize a contagem ou use data conferida manualmente.');
    }
    items.push({id:crypto.randomUUID(),title,description,assignee_id:assignee,due_date:item.due_date,candidate_key:candidate?.key||null,due_time:dueTime,calculation,excerpt:candidate?.excerpt||''});
   }
   if(candidates.some(item=>!included.has(item.key))&&reason.length<8)throw new AppError('Explique nas observações as indicações que não viraram tarefas.');
  }
  const at=stamp(),resolution=crypto.randomUUID(),status=action==='confirm'?'confirmed':action==='dismiss'?'dismissed':'pending';
  const statements=[q('UPDATE publication_reviews SET status=?,version=version+1,reviewer_id=?,reviewer_name=?,reviewed_at=?,reason=?,resolution_id=?,updated=? WHERE owner=? AND publication_id=? AND version=?',status,action==='reopen'?null:actor.id,action==='reopen'?null:actor.name,action==='reopen'?null:at,reason,resolution,at,owner,id,body.version)];
  const guard='EXISTS (SELECT 1 FROM publication_reviews WHERE owner=? AND publication_id=? AND resolution_id=?)',guardArgs=[owner,id,resolution];
  for(const item of items){
   const description=['Prazo conferido a partir de publicação do DJEN.','Disponibilização: '+review.date+' · '+review.tribunal,'Publicação: '+id,item.due_time?'Horário do vencimento: '+item.due_time+' (Brasília)':'','Trecho: '+item.excerpt,item.description,reason?'Conferência: '+reason:'',review.certificate?'Fonte: '+review.certificate:''].filter(Boolean).join('\n').slice(0,4000);
   statements.push(q(`INSERT INTO tasks(id,owner,cnj,title,description,assignee_id,status,priority,due_date,created_by,created,updated,version) SELECT ?,?,?,?,?,?,'todo','high',?,?,?,?,1 WHERE ${guard}`,item.id,owner,review.cnj,item.title,description,item.assignee_id,item.due_date,actor.id,at,at,...guardArgs));
   const details={candidate_key:item.candidate_key,excerpt:item.excerpt,calculation:item.calculation,confirmed_due_date:item.due_date,due_time:item.due_time,reviewer_id:actor.id,reviewer_name:actor.name,confirmed_at:at,source_date:review.date,source_text:review.text,reason};
   statements.push(q(`INSERT INTO deadline_task_links(owner,publication_id,task_id,source_version,details,created) SELECT ?,?,?,?,?,? WHERE ${guard}`,owner,id,item.id,review.source_version,JSON.stringify(details),at,...guardArgs));
   statements.push(q(`INSERT INTO task_events(id,owner,task_id,actor_id,actor_name,kind,data,created) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`,crypto.randomUUID(),owner,item.id,actor.id,actor.name,'created',JSON.stringify({title:item.title,assignee_id:item.assignee_id,status:'todo',source_publication_id:id,source_version:review.source_version,due_date:item.due_date}),at,...guardArgs));
  }
  statements.push(q(`INSERT INTO publication_review_events(id,owner,publication_id,source_version,actor_id,actor_name,action,data,created) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`,crypto.randomUUID(),owner,id,review.source_version,actor.id,actor.name,action,JSON.stringify({reason,tasks:items.map(item=>({id:item.id,title:item.title,due_date:item.due_date,assignee_id:item.assignee_id,candidate_key:item.candidate_key})),source_checked:body.source_checked===true}),at,...guardArgs));
  const result=await db.batch(statements);
  if(!result[0].meta.changes)throw new AppError('Outra pessoa atualizou esta conferência. Reabra para ver a versão atual.',409);
  return {...await detail(id),created_tasks:items.map(item=>item.id)};
 }
 async function handle(path,method,body,url){
  if(path[0]!=='deadlines')return undefined;admin();
  if(path.length===1&&method==='GET')return list(url);
  if(path.length===2&&method==='GET')return detail(path[1]);
  if(path.length===2&&method==='POST')return resolve(path[1],body);
  throw new AppError('Rota de conferência não encontrada.',404);
 }
 return {handle,summary,taskSource};
}
