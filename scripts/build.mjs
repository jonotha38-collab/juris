import {cp,mkdir} from 'node:fs/promises';
import {migrate} from './migrate.mjs';
import {authConfigured} from '../lib/auth.mjs';
if(!authConfigured())throw new Error('Defina APP_PASSWORD (16+ caracteres) e SESSION_SECRET (32+ caracteres) no painel Environment Variables antes de publicar.');
if((process.env.CRON_SECRET||'').length<32)throw new Error('Defina CRON_SECRET com pelo menos 32 caracteres para proteger a coleta agendada.');
await migrate();await mkdir('dist',{recursive:true});await cp('public','dist',{recursive:true});await cp('public/painel.html','dist/index.html');console.log('Juris pronto: frontend estático + API Node.js + banco persistente.');
