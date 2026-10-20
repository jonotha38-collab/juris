import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
export const COOKIE='juris_session';
const hash=x=>createHash('sha256').update(String(x)).digest();
export function secureEqual(a,b){return timingSafeEqual(hash(a),hash(b));}
export function authConfigured(env=process.env){return (env.APP_PASSWORD||'').length>=16&&(env.SESSION_SECRET||'').length>=32;}
const key=env=>hash(env.SESSION_SECRET+'\0'+env.APP_PASSWORD);
export function createSession(env=process.env,now=Date.now(),identity={id:'admin'}){
  const payload=Buffer.from(JSON.stringify({office:'office',sub:identity.id,version:identity.session_version,exp:now+12*3600000})).toString('base64url');
  return payload+'.'+createHmac('sha256',key(env)).update(payload).digest('base64url');
}
export function readSession(cookie,env=process.env,now=Date.now()){
  if(!authConfigured(env))return null;const token=String(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);if(!token||token.length>2000)return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const expected=createHmac('sha256',key(env)).update(parts[0]).digest('base64url');if(!secureEqual(parts[1],expected))return null;
  try{const p=JSON.parse(Buffer.from(parts[0],'base64url').toString());return p.office==='office'&&typeof p.exp==='number'&&p.exp>now&&p.exp<=now+12*3600000&&(!p.sub||typeof p.sub==='string')?{...p,sub:p.sub||'admin'}:null;}catch{return null;}
}
export function verifySession(cookie,env=process.env,now=Date.now()){return !!readSession(cookie,env,now);}
export function sessionCookie(token,secure=true){return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?43200:0}${secure?'; Secure':''}`;}
export async function checkLoginLimit(db,ip,secret,now=Date.now()){
 const ipKey=createHmac('sha256',secret).update(ip).digest('hex');const keys=['ip:'+ipKey,'global'];
 for(const [i,key] of keys.entries()){
  const row=await db.prepare('INSERT INTO auth_limits(key,hits,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN reset_at<=? THEN 1 ELSE hits+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING hits,reset_at').bind(key,now+15*60000,now,now).first();
  if(row.hits>(i===0?10:100))return false;
 }
 await db.prepare('DELETE FROM auth_limits WHERE reset_at<?').bind(now-86400000).run();return true;
}
