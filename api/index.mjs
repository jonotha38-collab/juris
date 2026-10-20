import {createEngine,AppError} from '../core/engine.mjs';
import {ADMIN} from '../core/collaboration.mjs';
import {hashPassword,verifyPassword,digestToken,validatePassword} from '../core/member-passwords.mjs';
import {getDatabase} from '../lib/database.mjs';
import {authConfigured,secureEqual,createSession,readSession,sessionCookie,checkLoginLimit} from '../lib/auth.mjs';
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
async function readBody(request){const raw=await request.text();if(raw.length>4096)throw new AppError('Requisição inválida.');let body;try{body=JSON.parse(raw)}catch{throw new AppError('JSON inválido.')}if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('Requisição inválida.');return body;}
export function createHandler({env=process.env,database=getDatabase,fetcher=fetch,clock=Date.now}={}) {
 return async function handle(request){
 try {
  const url=new URL(request.url);const route=url.searchParams.get('route');if(route!==null){url.pathname='/api/'+route.replace(/^\/+/, '');url.searchParams.delete('route');}
  const path=url.pathname.replace(/^\/api\/?/,'');
  if(!authConfigured(env))return reply({error:'Configure APP_PASSWORD (mínimo 16 caracteres) e SESSION_SECRET (mínimo 32) na Vercel e faça um novo deploy.'},503);
  if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'Origem não autorizada.'},403);
  const ip=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
  if(['login','accept-invite'].includes(path)&&request.method==='POST'){
   const body=await readBody(request),db=await database();
   if(!await checkLoginLimit(db,ip,env.SESSION_SECRET,clock()))return reply({error:'Muitas tentativas. Aguarde 15 minutos.'},429,{'Retry-After':'900'});
   let identity=ADMIN;
   if(path==='accept-invite'){
    if(typeof body.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.token))throw new AppError('Convite inválido ou expirado. Peça um novo link ao administrador.');
    const tokenHash=await digestToken(body.token);const m=await db.prepare("SELECT id,session_version FROM members WHERE owner='office' AND invite_hash=? AND invite_expires>? AND active=1 AND password_hash=''").bind(tokenHash,clock()).first();
    if(!m)throw new AppError('Convite inválido ou expirado. Peça um novo link ao administrador.');
    try{validatePassword(body.password)}catch(e){throw new AppError(e.message)}
    const passwordHash=await hashPassword(body.password);
    const changed=await db.prepare("UPDATE members SET password_hash=?,invite_hash=NULL,invite_expires=NULL,session_version=session_version+1,updated=? WHERE owner='office' AND id=? AND invite_hash=? AND invite_expires>? AND active=1 AND password_hash='' AND session_version=? RETURNING id,session_version").bind(passwordHash,new Date(clock()).toISOString(),m.id,tokenHash,clock(),m.session_version).first();
    if(!changed)throw new AppError('Convite inválido ou expirado. Peça um novo link ao administrador.');identity=changed;
   }else if(body.email!==undefined){
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    const m=await db.prepare("SELECT id,password_hash,session_version FROM members WHERE owner='office' AND email=? AND active=1").bind(email).first();
    if(!m||!await verifyPassword(body.password,m.password_hash))return reply({error:'E-mail ou senha incorretos. Confira também se seu acesso está ativo.'},401);identity=m;
   }else if(typeof body.password!=='string'||!secureEqual(body.password,env.APP_PASSWORD))return reply({error:'Senha incorreta.'},401);
   return reply({ok:true},200,{'Set-Cookie':sessionCookie(createSession(env,clock(),identity),url.protocol==='https:')});
  }
  if(path==='logout'&&request.method==='POST')return reply({ok:true},200,{'Set-Cookie':sessionCookie('',url.protocol==='https:')});
  if(path==='cron'){
   if(request.method!=='GET')return reply({error:'Método não permitido.'},405);
   if((env.CRON_SECRET||'').length<32||!secureEqual(request.headers.get('authorization')||'','Bearer '+env.CRON_SECRET))return reply({error:'Não autorizado.'},401);
   const engine=createEngine(await database(),{fetcher,mode:'vercel',aiEnv:env});const deadline=clock()+150000;let steps=0;let last=null;
   while(clock()<deadline&&steps<100){last=await engine.tick();if(!last?.worked)break;steps++;if(last.job?.retry_at>clock())break;await new Promise(r=>setTimeout(r,1000));}
   const ai=await engine.aiTick('office');
   return reply({ok:true,steps,ai,message:'Lote encerrado. Buscas incompletas conservam o ponto de retomada.'});
  }
  const session=readSession(request.headers.get('cookie'),env,clock());
  const unauthorized=()=>reply({error:'Entre para acessar seu escritório.',loginUrl:'/login.html'},401,{'Set-Cookie':sessionCookie('',url.protocol==='https:')});
  if(!session)return unauthorized();const db=await database();let actor=ADMIN;
  if(session.sub!=='admin'){
   const m=await db.prepare("SELECT id,name,email,session_version FROM members WHERE owner='office' AND id=? AND active=1 AND password_hash!=''").bind(session.sub).first();
   if(!m||m.session_version!==session.version)return unauthorized();actor={id:m.id,name:m.name,email:m.email,role:'intern'};
  }
  if(path==='password'&&request.method==='POST'){
   if(actor.role!=='intern')throw new AppError('A senha do administrador é alterada na configuração da Vercel.',403);
   const body=await readBody(request);if(!await checkLoginLimit(db,ip,env.SESSION_SECRET,clock()))return reply({error:'Muitas tentativas. Aguarde 15 minutos.'},429,{'Retry-After':'900'});
   const member=await db.prepare("SELECT password_hash FROM members WHERE id=? AND owner='office'").bind(actor.id).first();
   if(!await verifyPassword(body.currentPassword,member.password_hash))throw new AppError('Senha atual incorreta.');
   try{validatePassword(body.password)}catch(e){throw new AppError(e.message)}
   const next=await db.prepare("UPDATE members SET password_hash=?,session_version=session_version+1,updated=? WHERE owner='office' AND id=? AND session_version=? RETURNING id,session_version").bind(await hashPassword(body.password),new Date(clock()).toISOString(),actor.id,session.version).first();
   if(!next)return unauthorized();return reply({ok:true},200,{'Set-Cookie':sessionCookie(createSession(env,clock(),next),url.protocol==='https:')});
  }
  const engine=createEngine(db,{fetcher,mode:'vercel',actor,aiEnv:env});
  const forwarded=new Request(url,request);return reply(await engine.handle(forwarded,'office'));
 }catch(e){if(e instanceof AppError)return reply({error:e.message},e.status);console.error('Juris API:',e.code||e.name);return reply({error:e.message==='CONFIG_MISSING'?'Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN e faça um novo deploy.':'Não foi possível concluir a operação. Confira a configuração e as migrações do banco.'},503);}
 };
}
export default {fetch:createHandler()};
