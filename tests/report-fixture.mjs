import {createClient} from '@libsql/client';
import {adaptClient} from '../lib/database.mjs';
import {migrate} from '../scripts/migrate.mjs';
import {createEngine,day} from '../core/engine.mjs';
export const cnj=n=>String(n).padStart(20,'0');
export async function reportFixture(){
 const client=createClient({url:'file::memory:'}),db=adaptClient(client);await migrate(client);
 const engine=createEngine(db,{mode:'vercel'});
 const api=(path,method='GET',body,owner='office',instance=engine)=>instance.handle(new Request('https://juris.example/api/'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),owner);
 const imported=await api('import','POST',{oab:'12345',uf:'SP',start:day(),end:day(),items:[{'Número':cnj(1),'Título':'Caso Alfa','Tribunal':'TJSP'},{'Número':cnj(2),'Título':'Caso Beta','Tribunal':'TJRJ'},{'Número':cnj(3),'Título':'Cadastro sem publicações','Tribunal':'SEEU'}]});
 const second=await api('import','POST',{oab:'54321',uf:'RJ',start:day(),end:day(),items:[{'Número':cnj(1),'Título':'Caso Alfa','Tribunal':'TJSP'}]});
 const publication=(id,n,tribunal,text='Intimação de teste para conferência.')=>({id,numero_processo:cnj(n),siglaTribunal:tribunal,data_disponibilizacao:day(),texto:text,destinatarios:[{nome:'Pessoa '+n,polo:'A'},{nome:'Outra parte '+n,polo:'P'}],hash:'synthetic-hash-'+id});
 await engine.saveItems('office',imported.monitorId,[publication('a',1,'TJSP'),publication('b',1,'TJRJ'),publication('c',2,'TJRJ')]);
 await engine.saveItems('office',second.monitorId,[publication('a',1,'TJSP')]);
 await api('clients','POST',{name:'Cliente confirmado',cnj:cnj(1)});
 return {client,db,engine,api,publication,monitor:imported.monitorId,second:second.monitorId};
}
export function zipEntries(bytes){
 const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),view=new DataView(data.buffer,data.byteOffset,data.byteLength),decoder=new TextDecoder(),entries=new Map();let offset=0;
 while(offset+30<=data.length&&view.getUint32(offset,true)===0x04034b50){
  if(view.getUint16(offset+8,true)!==0)throw new Error('Expected stored ZIP entries');
  const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),start=offset+30+nameSize+extra;
  const name=decoder.decode(data.slice(offset+30,offset+30+nameSize));entries.set(name,decoder.decode(data.slice(start,start+size)));offset=start+size;
 }
 return entries;
}
