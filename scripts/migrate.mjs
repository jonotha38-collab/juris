import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getDatabase} from '../lib/database.mjs';
export async function migrate(clientOverride){
 const client=clientOverride||(await getDatabase()).client;await client.execute('CREATE TABLE IF NOT EXISTS juris_migrations(name TEXT PRIMARY KEY)');
 const directory=fileURLToPath(new URL('../migrations/',import.meta.url));
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()){
  const existing=await client.execute({sql:'SELECT name FROM juris_migrations WHERE name=?',args:[name]});if(existing.rows.length)continue;
  const sql=await readFile(directory+'/'+name,'utf8');const statements=sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean);
  await client.batch([...statements,{sql:'INSERT INTO juris_migrations(name) VALUES(?)',args:[name]}],'write');
  console.log('Migração aplicada:',name);
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url))await migrate();
