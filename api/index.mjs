import {createEngine,AppError} from '../core/engine.mjs';
import {getDatabase} from '../lib/database.mjs';
import {authConfigured,secureEqual,createSession,verifySession,sessionCookie,checkLoginLimit} from '../lib/auth.mjs';
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function createHandler({env=process.env,database=getDatabase,fetcher=fetch,clock=Date.now}={}) {
 return async function handle(request){
 try {
  const url=new URL(request.url);const route=url.searchParams.get('route');if(route!==null){url.pathname='/api/'+route.replace(/^\/+/, '');url.searchParams.delete('route');}
  const path=url.pathname.replace(/^\/api\/?/,'');
  if(!authConfigured(env))return reply({error:'Configure APP_PASSWORD (mínimo 16 caracteres) e SESSION_SECRET (mínimo 32) na Vercel e faça um novo deploy.'},503);
  if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return reply({error:'Origem não autorizada.'},403);
  if(path==='login'&&request.method==='POST'){
   const raw=await request.text();if(raw.length>2048)return reply({error:'Requisição inválida.'},400);let body;try{body=JSON.parse(raw)}catch{return reply({error:'JSON inválido.'},400)}
   const db=await database();const ip=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
   if(!await checkLoginLimit(db,ip,env.SESSION_SECRET,clock()))return reply({error:'Muitas tentativas. Aguarde 15 minutos.'},429,{'Retry-After':'900'});
   if(typeof body.password!=='string'||!secureEqual(body.password,env.APP_PASSWORD))return reply({error:'Senha incorreta.'},401);
   return reply({ok:true},200,{'Set-Cookie':sessionCookie(createSession(env,clock()),url.protocol==='https:')});
  }
  if(path==='logout'&&request.method==='POST')return reply({ok:true},200,{'Set-Cookie':sessionCookie('',url.protocol==='https:')});
  if(path==='cron'){
   if(request.method!=='GET')return reply({error:'Método não permitido.'},405);
   if((env.CRON_SECRET||'').length<32||!secureEqual(request.headers.get('authorization')||'','Bearer '+env.CRON_SECRET))return reply({error:'Não autorizado.'},401);
   const engine=createEngine(await database(),{fetcher,mode:'vercel'});const deadline=clock()+240000;let steps=0;let last=null;
   while(clock()<deadline&&steps<100){last=await engine.tick();if(!last?.worked)break;steps++;if(last.job?.retry_at>clock())break;await new Promise(r=>setTimeout(r,1000));}
   return reply({ok:true,steps,message:'Lote encerrado. Buscas incompletas conservam o ponto de retomada.'});
  }
  if(!verifySession(request.headers.get('cookie'),env,clock()))return reply({error:'Entre para acessar seu escritório.',loginUrl:'/login.html'},401);
  const engine=createEngine(await database(),{fetcher,mode:'vercel'});
  const forwarded=new Request(url,request);return reply(await engine.handle(forwarded,'office'));
 }catch(e){if(e instanceof AppError)return reply({error:e.message},e.status);console.error('Juris API:',e.code||e.name);return reply({error:e.message==='CONFIG_MISSING'?'Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN e faça um novo deploy.':'Não foi possível concluir a operação. Confira a configuração e as migrações do banco.'},503);}
 };
}
export default {fetch:createHandler()};
