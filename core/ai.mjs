import {AppError} from './errors.mjs';
import {partiesOf} from '../public/parties.mjs';
import {validDeadlineDate} from '../public/deadline-rules.mjs';
import {AI_MODEL,aiDigest,encryptAIKey,decryptAIKey,buildAIRequest,requestAIAnalysis} from './ai-provider.mjs';
export function createAI(db,{owner,actor,env={},fetcher=fetch,resolveScope,clock=Date.now}){
 const q=(sql,...args)=>db.prepare(sql).bind(...args),first=(sql,...args)=>q(sql,...args).first(),all=async(sql,...args)=>(await q(sql,...args).all()).results,run=(sql,...args)=>q(sql,...args).run();
 const stamp=()=>new Date(clock()).toISOString(),day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(clock()));
 const admin=()=>{if(actor.role!=='admin')throw new AppError('A análise e a conferência de IA são gerenciadas pelo administrador.',403);};
 const field=(value,name,max,required=false)=>{if(typeof value!=='string'||value.trim().length>max||required&&!value.trim())throw new AppError('Confira '+name+'.');return value.trim();};
 async function rawConfig(){
  const row=await first('SELECT * FROM ai_config WHERE owner=?',owner);
  return row||{owner,key_cipher:null,enabled:env.OPENAI_API_KEY?1:0,automatic:1,daily_limit:200000,version:0};
 }
 async function config(){
  const row=await rawConfig(),usage=await first('SELECT charged_tokens,input_tokens,output_tokens,calls FROM ai_usage WHERE owner=? AND day=?',owner,day());
  return {configured:!!(row.key_cipher||env.OPENAI_API_KEY),enabled:!!row.enabled,automatic:!!row.automatic,daily_limit:row.daily_limit,version:row.version,key_source:row.key_cipher?'saved':env.OPENAI_API_KEY?'environment':'none',can_save_key:(env.SESSION_SECRET||'').length>=32,model:AI_MODEL,usage:usage||{charged_tokens:0,input_tokens:0,output_tokens:0,calls:0},day:day()};
 }
 async function configure(body){
  const previous=await rawConfig();
  if(!Number.isInteger(body.version)||body.version!==previous.version)throw new AppError('A configuração foi alterada. Recarregue antes de salvar.',409);
  if(typeof body.enabled!=='boolean'||typeof body.automatic!=='boolean'||!Number.isInteger(body.daily_limit)||body.daily_limit<5000||body.daily_limit>2000000)throw new AppError('Confira a ativação e o limite diário (5.000 a 2.000.000 tokens).');
  let cipher=previous.key_cipher;
  if(body.remove_key===true)cipher=null;
  if(body.api_key!==undefined&&body.api_key!==''){
   const key=field(body.api_key,'a chave da API',512,true);if(!/^sk-[A-Za-z0-9_-]{12,}$/.test(key))throw new AppError('Informe uma chave válida da API da OpenAI.');
   cipher=await encryptAIKey(key,env.SESSION_SECRET,owner);
  }
  if(body.enabled&&!cipher&&!env.OPENAI_API_KEY)throw new AppError('Cadastre uma chave da API ou configure OPENAI_API_KEY no servidor.');
  const written=previous.version===0?await run('INSERT INTO ai_config(owner,key_cipher,enabled,automatic,daily_limit,version,updated) VALUES(?,?,?,?,?,1,?) ON CONFLICT(owner) DO NOTHING',owner,cipher,Number(body.enabled),Number(body.automatic),body.daily_limit,stamp()):await run('UPDATE ai_config SET key_cipher=?,enabled=?,automatic=?,daily_limit=?,version=version+1,updated=? WHERE owner=? AND version=?',cipher,Number(body.enabled),Number(body.automatic),body.daily_limit,stamp(),owner,body.version);
  if(!written.meta.changes)throw new AppError('Outra pessoa alterou a configuração. Recarregue antes de salvar.',409);
  return config();
 }
 async function caseScope(url,alias){
  const scope=await resolveScope(url);let where=`${alias}.owner=? AND EXISTS (SELECT 1 FROM case_records publications WHERE ${scope.where} AND publications.cnj=${alias}.cnj)`,args=[owner,...scope.params];
  const cnj=url.searchParams.get('cnj');if(cnj){if(!/^\d{20}$/.test(cnj))throw new AppError('Número CNJ inválido.');where+=` AND ${alias}.cnj=?`;args.push(cnj);}
  const query=(url.searchParams.get('q')||'').trim().slice(0,150);
  if(query){where+=` AND (${alias}.cnj LIKE ? OR EXISTS (SELECT 1 FROM case_records names WHERE names.owner=${alias}.owner AND names.cnj=${alias}.cnj AND (json_extract(names.raw,'$.destinatarios') LIKE ? OR json_extract(names.raw,'$._juris_import.title') LIKE ?)) OR EXISTS (SELECT 1 FROM client_processes cp JOIN clients c ON c.owner=cp.owner AND c.id=cp.client_id WHERE cp.owner=${alias}.owner AND cp.cnj=${alias}.cnj AND c.archived=0 AND c.name LIKE ?)${alias==='s'?' OR s.title LIKE ? OR s.description LIKE ?':''})`;const digits=query.replace(/\D/g,'');args.push('%'+(digits.length===20?digits:query)+'%',...Array(alias==='s'?5:3).fill('%'+query+'%'));}
  return {where,args};
 }
 const join='FROM ai_suggestions s JOIN publications p ON p.owner=s.owner AND p.id=s.publication_id JOIN publication_reviews r ON r.owner=p.owner AND r.publication_id=p.id';
 const current="s.source_version=r.source_version AND p.canceled=0";
 async function summary(url){
  if(actor.role!=='admin')return null;const s=await caseScope(url,'s'),j=await caseScope(url,'j'),today=day();
  const suggestions=await first(`SELECT COALESCE(SUM(s.status='pending' AND ${current}),0) pending,COALESCE(SUM(s.status='pending' AND ${current} AND s.due_date<?),0) possible_overdue,COALESCE(SUM(s.status='pending' AND ${current} AND s.due_date IS NULL AND s.category IN ('deadline','hearing')),0) needs_date,COALESCE(SUM(s.status='accepted'),0) accepted,COALESCE(SUM(s.status='pending' AND NOT (${current})),0) stale ${join} WHERE ${s.where}`,today,...s.args);
  const jobs=await first(`SELECT COUNT(*) processes,COALESCE(SUM(j.status!='done'),0) queued,COALESCE(SUM(j.status='done'),0) analyzed,COALESCE(SUM(j.status='error'),0) errors FROM ai_jobs j WHERE ${j.where}`,...j.args);
  return {...suggestions,...jobs};
 }
 function sourceOf(row){let raw={};try{raw=JSON.parse(row.raw||'{}')}catch{}const {raw:ignored,...rest}=row;return {...rest,parties:partiesOf(raw),stale:row.source_version!==row.current_source_version||!!row.canceled,certificate:row.hash?'https://comunicaapi.pje.jus.br/api/v1/comunicacao/'+encodeURIComponent(row.hash)+'/certidao':null};}
 async function list(url){
  const {where,args}=await caseScope(url,'s'),focus=url.searchParams.get('focus')||'pending';
  if(!['pending','todo','possible_overdue','needs_date','accepted','dismissed','stale'].includes(focus))throw new AppError('Filtro de IA inválido.');
  let selected=where;const params=[...args];
  if(['accepted','dismissed'].includes(focus)){selected+=' AND s.status=?';params.push(focus);}
  else if(focus==='stale')selected+=` AND s.status='pending' AND NOT (${current})`;
  else{
   selected+=` AND s.status='pending' AND ${current}`;
   if(focus==='possible_overdue'){selected+=' AND s.due_date<?';params.push(day());}
   if(focus==='needs_date')selected+=" AND s.due_date IS NULL AND s.category IN ('deadline','hearing')";
   if(focus==='todo'){selected+=" AND (s.due_date>=? OR s.due_date IS NULL AND s.category NOT IN ('deadline','hearing'))";params.push(day());}
  }
  const page=Math.max(1,Math.min(1000000,Math.floor(Number(url.searchParams.get('page'))||1))),pageSize=12,total=(await first(`SELECT COUNT(*) n ${join} WHERE ${selected}`,...params)).n;
  const rows=await all(`SELECT s.*,p.tribunal,p.date,p.hash,p.canceled,p.raw,r.source_version current_source_version ${join} WHERE ${selected} ORDER BY CASE WHEN s.due_date<? THEN 0 ELSE 1 END,s.due_date IS NULL,s.due_date,s.created DESC,s.id LIMIT ? OFFSET ?`,...params,day(),pageSize,(page-1)*pageSize);
  return {rows:rows.map(sourceOf),total,page,pageSize,focus,today:day(),summary:await summary(url),config:await config()};
 }
 async function coverage(cnj){
  return first("SELECT COUNT(*) total,COALESCE(SUM(c.complete=1),0) completed,COALESCE(SUM(c.complete IS NULL OR c.complete=0),0) remaining FROM publications p JOIN publication_reviews r ON r.owner=p.owner AND r.publication_id=p.id LEFT JOIN ai_checks c ON c.owner=p.owner AND c.publication_id=p.id AND c.source_version=r.source_version WHERE p.owner=? AND p.cnj=?",owner,cnj);
 }
 async function process(cnj){
  if(!/^\d{20}$/.test(cnj)||!await first('SELECT id FROM case_records WHERE owner=? AND cnj=? LIMIT 1',owner,cnj))throw new AppError('Processo não encontrado.',404);
  const job=await first('SELECT status,error_code,retry_at,updated FROM ai_jobs WHERE owner=? AND cnj=?',owner,cnj),scope=new URL('https://juris.invalid/api/ai?cnj='+cnj);
  const runs=await all('SELECT id,status,error_code,summary,input_tokens,output_tokens,coverage,created FROM ai_runs WHERE owner=? AND cnj=? ORDER BY created DESC,id DESC LIMIT 4',owner,cnj);
  return {cnj,job,coverage:await coverage(cnj),summary:await summary(scope),runs:runs.map(row=>({...row,coverage:JSON.parse(row.coverage)})),config:await config()};
 }
 async function suggestion(id){
  const row=await first(`SELECT s.*,p.tribunal,p.date,p.hash,p.canceled,p.raw,p.text source_text,r.source_version current_source_version ${join} WHERE s.owner=? AND s.id=?`,owner,id);
  if(!row)throw new AppError('Sugestão não encontrada.',404);
  const existing=await all("SELECT id,title,status,due_date,assignee_id FROM tasks WHERE owner=? AND cnj=? ORDER BY status='done',updated DESC LIMIT 50",owner,row.cnj);
  const people=[{id:'admin',name:'Administrador do escritório',active:1},...await all('SELECT id,name,active FROM members WHERE owner=? ORDER BY name',owner)];
  return {suggestion:sourceOf(row),existing_tasks:existing,people};
 }
 async function taskSource(id){
  const row=await first(`SELECT s.*,p.tribunal,p.date,p.hash,p.canceled,r.source_version current_source_version ${join} JOIN tasks t ON t.owner=s.owner AND t.id=s.task_id WHERE s.owner=? AND s.task_id=? ${actor.role!=='admin'?'AND t.assignee_id=?':''} ORDER BY s.decided_at DESC LIMIT 1`,owner,id,...(actor.role!=='admin'?[actor.id]:[]));
  return row?sourceOf(row):null;
 }
 async function decide(id,body){
  const s=(await suggestion(id)).suggestion;
  if(!Number.isInteger(body.version)||body.version!==s.version||s.status!=='pending')throw new AppError('Esta sugestão já foi alterada. Reabra para conferir a versão atual.',409);
  if(!['accept','dismiss'].includes(body.action))throw new AppError('Escolha como tratar a sugestão.');
  if(body.source_checked!==true)throw new AppError('Confirme a leitura da origem antes de tratar a sugestão.');
  const note=field(body.reason??'','as observações da conferência',2000,body.action==='dismiss');
  if(body.action==='dismiss'&&note.length<8)throw new AppError('Informe por que a sugestão foi descartada (ao menos 8 caracteres).');
  if(body.action==='accept'&&s.stale)throw new AppError('A fonte mudou ou foi cancelada. Reanalise o processo e confira a publicação atual.',409);
  const at=stamp(),token=crypto.randomUUID(),status=body.action==='accept'?'accepted':'dismissed';let taskId=null,newTask=null;
  if(body.action==='accept'){
   if(body.task_id){
    taskId=field(body.task_id,'a tarefa vinculada',150,true);
    if(!await first('SELECT id FROM tasks WHERE owner=? AND cnj=? AND id=?',owner,s.cnj,taskId))throw new AppError('Escolha uma tarefa deste processo.');
   }else{
    const assignee=field(body.assignee_id??'','o responsável',150,true);
    if(assignee!=='admin'&&!await first('SELECT id FROM members WHERE owner=? AND id=? AND active=1',owner,assignee))throw new AppError('Escolha um responsável ativo do escritório.');
    const due=body.due_date||null;if(due!==null&&!validDeadlineDate(due))throw new AppError('Informe uma data válida ou deixe o prazo a conferir.');
    const needsDate=['deadline','hearing'].includes(s.category)&&!due,title=field(body.title??s.title,'o título',200,true);
    newTask={id:crypto.randomUUID(),title:(needsDate?'Conferir prazo: ':'')+title,description:field(body.description??s.description,'as orientações',2000),assignee_id:assignee,due_date:due,priority:needsDate?'high':s.priority,origin:['deadline','hearing'].includes(s.category)?'ai_deadline':'ai_task'};
    newTask.title=newTask.title.slice(0,200);taskId=newTask.id;
   }
  }
  const sourceGuard=body.action==='accept'?' AND EXISTS (SELECT 1 FROM publications p JOIN publication_reviews r ON r.owner=p.owner AND r.publication_id=p.id WHERE p.owner=ai_suggestions.owner AND p.id=ai_suggestions.publication_id AND r.source_version=ai_suggestions.source_version AND p.canceled=0)':'';
  const statements=[q('UPDATE ai_suggestions SET status=?,task_id=?,decided_by=?,decision_note=?,decided_at=?,decision_token=?,updated=?,version=version+1 WHERE owner=? AND id=? AND version=? AND status=\'pending\''+sourceGuard,status,taskId,actor.name,note,at,token,at,owner,id,body.version)];
  const guard='EXISTS (SELECT 1 FROM ai_suggestions WHERE owner=? AND id=? AND decision_token=?)',guardArgs=[owner,id,token];
  if(newTask){
   const description=['Providência sugerida por IA e conferida pelo escritório.',newTask.due_date?'Vencimento conferido: '+newTask.due_date:'DATA A CONFERIR: não existe vencimento validado para esta providência.','Publicação: '+s.publication_id+' · '+s.tribunal+' · disponibilização '+s.date,'Trecho: '+s.excerpt,newTask.description,note?'Conferência: '+note:'',s.certificate?'Fonte: '+s.certificate:''].filter(Boolean).join('\n').slice(0,4000);
   statements.push(q(`INSERT INTO tasks(id,owner,cnj,title,description,assignee_id,status,priority,due_date,created_by,created,updated,version,origin,ai_suggestion_id) SELECT ?,?,?,?,?,?,'todo',?,?,?,?,?,1,?,? WHERE ${guard}`,newTask.id,owner,s.cnj,newTask.title,description,newTask.assignee_id,newTask.priority,newTask.due_date,actor.id,at,at,newTask.origin,id,...guardArgs));
   statements.push(q(`INSERT INTO task_events(id,owner,task_id,actor_id,actor_name,kind,data,created) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`,crypto.randomUUID(),owner,newTask.id,actor.id,actor.name,'created',JSON.stringify({title:newTask.title,assignee_id:newTask.assignee_id,status:'todo',source:'ai_reviewed',suggestion_id:id,due_date:newTask.due_date,source_publication_id:s.publication_id,source_version:s.source_version}),at,...guardArgs));
  }else if(taskId){
   statements.push(q(`INSERT INTO task_comments(id,owner,task_id,author_id,author_name,text,created) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,crypto.randomUUID(),owner,taskId,actor.id,actor.name,'Sugestão de IA vinculada após conferência: '+s.title+'\nOrigem: '+s.publication_id+'\n'+s.excerpt+(note?'\n'+note:''),at,...guardArgs));
  }
  const result=await db.batch(statements);
  if(!result[0].meta.changes)throw new AppError('A sugestão ou a publicação foi alterada. Reabra antes de confirmar.',409);
  return {...await suggestion(id),task_id:taskId};
 }
 async function reserve(amount,limit,cnj,coverageInfo){
  const usageDay=day();
  await run('INSERT OR IGNORE INTO ai_usage(owner,day) VALUES(?,?)',owner,usageDay);
  const id=crypto.randomUUID(),at=stamp();
  const result=await db.batch([q('UPDATE ai_usage SET charged_tokens=charged_tokens+?,calls=calls+1 WHERE owner=? AND day=? AND charged_tokens+?<=?',amount,owner,usageDay,amount,limit),q("INSERT INTO ai_runs(id,owner,cnj,model,status,reserved_tokens,coverage,created,updated) SELECT ?,?,?,?,'running',?,?,?,? WHERE changes()=1",id,owner,cnj,AI_MODEL,amount,JSON.stringify(coverageInfo),at,at)]);
  if(!result[0].meta.changes)throw new AppError('O limite diário de tokens do escritório foi atingido ou é insuficiente para este lote. Ajuste o limite ou retome no próximo dia.',429);
  return {id,day:usageDay,reserved:amount};
 }
 async function finishUsage(reservation,result,error=''){
  const validUsage=result?.usage&&Number.isSafeInteger(result.usage.input)&&Number.isSafeInteger(result.usage.output)&&result.usage.input>=0&&result.usage.output>=0&&result.usage.input+result.usage.output>0;
  const input=validUsage?result.usage.input:0,output=validUsage?result.usage.output:0,charged=validUsage?input+output:reservation.reserved;
  await db.batch([q('UPDATE ai_usage SET charged_tokens=MAX(0,charged_tokens+?),input_tokens=input_tokens+?,output_tokens=output_tokens+? WHERE owner=? AND day=?',charged-reservation.reserved,input,output,owner,reservation.day),q('UPDATE ai_runs SET status=?,error_code=?,input_tokens=?,output_tokens=?,summary=?,updated=? WHERE owner=? AND id=?',error?'error':'success',error,input,output,result?.summary||'',stamp(),owner,reservation.id)]);
 }
 async function step(cnj,{automatic=false}={}){
  await process(cnj);const settings=await rawConfig();if(!settings.enabled||!settings.key_cipher&&!env.OPENAI_API_KEY)throw new AppError('Ative a IA e configure sua chave antes de analisar os processos.',400);
  if(automatic&&!settings.automatic)return {worked:false};
  await run("INSERT OR IGNORE INTO ai_jobs(owner,cnj,status,updated) VALUES(?,?,'queued',?)",owner,cnj,stamp());
  const lease=clock()+90000,written=await run("UPDATE ai_jobs SET status='running',lease_until=?,error_code='',retry_at=0 WHERE owner=? AND cnj=? AND lease_until<=?",lease,owner,cnj,clock());
  if(!written.meta.changes)return {worked:false,busy:true,cnj};
  let reservation=null,usageFinished=false;
  try{
   const records=await all("SELECT p.id,p.text,p.tribunal,p.date,p.canceled,r.source_version,COALESCE(c.next_offset,0) next_offset FROM publications p JOIN publication_reviews r ON r.owner=p.owner AND r.publication_id=p.id LEFT JOIN ai_checks c ON c.owner=p.owner AND c.publication_id=p.id AND c.source_version=r.source_version WHERE p.owner=? AND p.cnj=? AND (c.complete IS NULL OR c.complete=0) ORDER BY p.date DESC,p.id DESC LIMIT 12",owner,cnj);
   if(!records.length){await run("UPDATE ai_jobs SET status='done',lease_until=0,updated=? WHERE owner=? AND cnj=? AND lease_until=?",stamp(),owner,cnj,lease);return {worked:false,cached:true,...await process(cnj)};}
   const segments=[],consumed=[];let available=24000;
   for(const row of records){
    if(row.canceled||!row.text.trim()){consumed.push({...row,end:row.text.length,complete:1});continue;}
    if(available<1000)break;
    const start=row.next_offset,end=Math.min(row.text.length,start+Math.min(12000,available));
    if(end<=start){consumed.push({...row,end:row.text.length,complete:1});continue;}
    const text=row.text.slice(start,end);available-=text.length;
    segments.push({ref:String(segments.length+1),id:row.id,source_version:row.source_version,tribunal:row.tribunal,date:row.date,text,start,end,length:row.text.length});
    consumed.push({...row,end,complete:end>=row.text.length?1:0});
   }
   let analysis={summary:'Publicações canceladas ou sem texto foram registradas sem chamada à IA.',suggestions:[]};
   if(segments.length){
    const tasks=await all('SELECT title,status,due_date FROM tasks WHERE owner=? AND cnj=? ORDER BY updated DESC LIMIT 30',owner,cnj);
    const body=buildAIRequest(segments,tasks),amount=new TextEncoder().encode(JSON.stringify(body)).byteLength+5024;
    const key=settings.key_cipher?await decryptAIKey(settings.key_cipher,env.SESSION_SECRET,owner):env.OPENAI_API_KEY;
    reservation=await reserve(amount,settings.daily_limit,cnj,{publications:consumed.map(row=>({id:row.id,source_version:row.source_version,start:row.next_offset,end:row.end,complete:!!row.complete})),characters:24000-available});
    analysis=await requestAIAnalysis(fetcher,key,segments,tasks);
    await finishUsage(reservation,analysis,analysis.error?'invalid_output':'');usageFinished=true;
    if(analysis.error)throw new AppError(analysis.error,502);
   }
   const sourceCondition=consumed.map(()=>'(p.id=? AND r.source_version=?)').join(' OR '),sourceArgs=consumed.flatMap(row=>[row.id,row.source_version]);
   const guard=`EXISTS (SELECT 1 FROM ai_jobs WHERE owner=? AND cnj=? AND lease_until=?) AND (SELECT COUNT(*) FROM publications p JOIN publication_reviews r ON r.owner=p.owner AND r.publication_id=p.id WHERE p.owner=? AND p.cnj=? AND (${sourceCondition}))=?`;
   const guardArgs=[owner,cnj,lease,owner,cnj,...sourceArgs,consumed.length];
   const statements=[q('UPDATE ai_jobs SET status=\'running\' WHERE owner=? AND cnj=? AND '+guard,owner,cnj,...guardArgs)];
   for(const item of analysis.suggestions){
    const fingerprint=await aiDigest(item.category+'\0'+item.excerpt.replace(/\s+/g,' ').trim());
    statements.push(q(`INSERT INTO ai_suggestions(id,owner,cnj,publication_id,source_version,fingerprint,category,title,description,excerpt,due_date,period,priority,created,updated) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(owner,publication_id,source_version,fingerprint) DO NOTHING`,crypto.randomUUID(),owner,cnj,item.publication_id,item.source_version,fingerprint,item.category,item.title,item.description,item.excerpt,item.due_date,item.period,item.priority,stamp(),stamp(),...guardArgs));
   }
   for(const row of consumed)statements.push(q(`INSERT INTO ai_checks(owner,publication_id,source_version,next_offset,complete,updated) SELECT ?,?,?,?,?,? WHERE ${guard} ON CONFLICT(owner,publication_id,source_version) DO UPDATE SET next_offset=MAX(ai_checks.next_offset,excluded.next_offset),complete=MAX(ai_checks.complete,excluded.complete),updated=excluded.updated`,owner,row.id,row.source_version,row.end,row.complete,stamp(),...guardArgs));
   statements.push(q(`UPDATE ai_jobs SET status=CASE WHEN EXISTS (SELECT 1 FROM publications p JOIN publication_reviews r ON r.owner=p.owner AND r.publication_id=p.id LEFT JOIN ai_checks c ON c.owner=p.owner AND c.publication_id=p.id AND c.source_version=r.source_version WHERE p.owner=? AND p.cnj=? AND (c.complete IS NULL OR c.complete=0)) THEN 'queued' ELSE 'done' END,lease_until=0,error_code='',retry_at=0,updated=? WHERE owner=? AND cnj=? AND ${guard}`,owner,cnj,stamp(),owner,cnj,...guardArgs));
   const result=await db.batch(statements);
   if(!result[0].meta.changes){if(reservation)await run("UPDATE ai_runs SET status='error',error_code='source_changed',updated=? WHERE owner=? AND id=?",stamp(),owner,reservation.id);await run("UPDATE ai_jobs SET status='queued',lease_until=0,updated=? WHERE owner=? AND cnj=? AND lease_until=?",stamp(),owner,cnj,lease);throw new AppError('A fonte mudou durante a análise. O lote não foi aplicado; reanalise a versão atual.',409);}
   return {worked:true,new_suggestions:analysis.suggestions.length,...await process(cnj)};
  }catch(error){
   if(reservation&&!usageFinished)await finishUsage(reservation,null,'provider_error');
   await run("UPDATE ai_jobs SET status='error',lease_until=0,error_code=?,retry_at=?,updated=? WHERE owner=? AND cnj=? AND lease_until=?",error.status===429?'limit':error.status===409?'source_changed':'analysis_failed',clock()+3600000,stamp(),owner,cnj,lease);
   throw error;
  }
 }
 async function runNext(url,{automatic=false}={}){
  const settings=await rawConfig();if(!settings.enabled||!settings.key_cipher&&!env.OPENAI_API_KEY||automatic&&!settings.automatic)return {worked:false,disabled:true};
  const scope=await caseScope(url,'j');
  const job=await first(`SELECT j.cnj FROM ai_jobs j WHERE ${scope.where} AND j.status!='done' AND j.lease_until<=? AND j.retry_at<=? ORDER BY j.updated,j.cnj LIMIT 1`,...scope.args,clock(),clock());
  if(!job)return {worked:false,empty:true};
  return step(job.cnj,{automatic});
 }
 async function tick(){
  try{return await runNext(new URL('https://juris.invalid/api/ai'),{automatic:true});}
  catch(error){return {worked:false,error:true,message:error instanceof AppError?error.message:'Não foi possível analisar o próximo lote.'};}
 }
 async function handle(path,method,body,url){
  if(path[0]!=='ai')return undefined;admin();
  if(path.length===1&&method==='GET')return list(url);
  if(path[1]==='config'&&path.length===2){if(method==='GET')return config();if(method==='PUT')return configure(body);}
  if(path[1]==='run-next'&&path.length===2&&method==='POST')return runNext(url);
  if(path[1]==='process'&&path[2]&&path.length===3){if(method==='GET')return process(path[2]);if(method==='POST')return step(path[2]);}
  if(path[1]==='suggestions'&&path[2]&&path.length===3){if(method==='GET')return suggestion(path[2]);if(method==='POST')return decide(path[2],body);}
  throw new AppError('Rota de IA não encontrada.',404);
 }
 return {handle,summary,taskSource,tick};
}
