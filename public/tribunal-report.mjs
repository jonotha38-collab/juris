import {createWorkbook} from './excel.mjs';
import {formatCnj,partiesOf} from './parties.mjs';

const textList=values=>[...new Set(values.filter(Boolean))].join('; ');
const oabs=values=>textList((values||[]).map(m=>`${m.oab}/${m.uf}${m.label?' · '+m.label:''}`));
const principal=p=>textList((p.clients||[]).map(c=>c.name))||p.parties?.title||'Nome não informado pela fonte';
const stage={active:'Em acompanhamento',waiting:'Aguardando retorno',archived:'Arquivado no escritório'};
function processSheet(name,rows) {
 return {name,headers:['Cliente / partes do processo','Número CNJ','Tribunal','Clientes vinculados','Polo ativo','Polo passivo','Órgão julgador','OABs vinculadas ao processo','Situação no escritório','Publicações capturadas','Última publicação capturada','Pendências em aberto','Prazos atrasados registrados','Próximo vencimento registrado','Anotações'],widths:[52,31,20,45,45,45,40,40,28,22,25,22,25,27,65],dates:[10,13],rows:rows.map(p=>[principal(p),formatCnj(p.cnj),p.tribunal,textList((p.clients||[]).map(c=>c.name)),textList(p.parties?.active||[]),textList(p.parties?.passive||[]),p.organ||'',oabs(p.oabs),stage[p.meta?.stage]||stage.active,Number(p.total)||0,p.date||'',Number(p.taskSummary?.open)||0,Number(p.taskSummary?.overdue)||0,p.taskSummary?.next_due||'',p.meta?.note||''])};
}
function consolidated(processes) {
 const grouped=new Map();
 for(const p of processes){if(!grouped.has(p.cnj))grouped.set(p.cnj,[]);grouped.get(p.cnj).push(p);}
 return [...grouped.values()].map(group=>{
  const base=group[0],clients=[...new Map(group.flatMap(p=>p.clients||[]).map(c=>[c.id,c])).values()];
  const people=partiesOf({destinatarios:['active','passive','other'].flatMap(role=>[...new Set(group.flatMap(p=>p.parties?.[role]||[]))].map(nome=>({nome,polo:role==='active'?'A':role==='passive'?'P':''})))});
  return {...base,clients,parties:people.names.length?people:base.parties,tribunal:textList(group.map(p=>p.tribunal)),organ:textList(group.map(p=>p.organ)),oabs:[...new Map(group.flatMap(p=>p.oabs||[]).map(m=>[m.id||m.uf+':'+m.oab,m])).values()],total:group.reduce((n,p)=>n+(Number(p.total)||0),0),date:group.map(p=>p.date||'').sort().at(-1)};
 }).sort((a,b)=>principal(a).localeCompare(principal(b),'pt-BR')||a.cnj.localeCompare(b.cnj));
}
export function buildTribunalSheets({tribunals,processes,publications=[],split=true,includePublications=true,oabLabel='Todas as OABs'}) {
 if(!Array.isArray(tribunals)||!tribunals.length)throw new Error('Selecione ao menos um tribunal.');
 const selected=[...new Set(tribunals)].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const allowed=new Set(selected),cases=processes.filter(p=>allowed.has(p.tribunal)),pubs=publications.filter(p=>allowed.has(p.tribunal));
 const byTribunal=selected.map(tribunal=>({tribunal,rows:cases.filter(p=>p.tribunal===tribunal)}));
 const summary={name:'Resumo',headers:['Tribunal / seleção','Processos (CNJs únicos)','Publicações capturadas','OAB da exportação'],widths:[44,28,27,60],dates:[],rows:[['Total da seleção (CNJs únicos)',new Set(cases.map(p=>p.cnj)).size,cases.reduce((n,p)=>n+Number(p.total||0),0),oabLabel],...byTribunal.map(({tribunal,rows})=>[tribunal,new Set(rows.map(p=>p.cnj)).size,rows.reduce((n,p)=>n+Number(p.total||0),0),oabLabel])]};
 const sheets=[summary,...(split?byTribunal.map(({tribunal,rows})=>processSheet(tribunal,rows.sort((a,b)=>principal(a).localeCompare(principal(b),'pt-BR')||a.cnj.localeCompare(b.cnj)))):[processSheet('Processos',consolidated(cases))])];
 if(includePublications)sheets.push({name:'Publicações',headers:['Cliente / partes do processo','Número CNJ','Tribunal','Clientes vinculados','OABs vinculadas à captura','Disponibilização','Tipo de comunicação','Órgão julgador','Situação da publicação','Teor da publicação (até 32.767 caracteres)','Certidão oficial (URL)','Identificação na fonte'],widths:[52,31,20,45,42,22,26,40,25,100,65,28],dates:[5],rows:pubs.map(p=>[principal(p),formatCnj(p.cnj),p.tribunal,textList((p.clients||[]).map(c=>c.name)),oabs(p.oabs),p.date||'',p.type,p.organ,p.canceled?'Cancelada':'Publicada',p.text||'',p.hash?'https://comunicaapi.pje.jus.br/api/v1/comunicacao/'+encodeURIComponent(p.hash)+'/certidao':'',String(p.id)])});
 return sheets;
}
export function createTribunalExcel(report){return createWorkbook(buildTribunalSheets(report));}

export function checkReportCounts(options,tribunals,processes,publications,includePublications) {
 for(const tribunal of tribunals){
  const expected=options.find(row=>row.tribunal===tribunal),rows=processes.filter(row=>row.tribunal===tribunal);
  if(!expected||new Set(rows.map(row=>row.cnj)).size!==expected.processes||rows.length!==expected.processes||rows.reduce((sum,row)=>sum+Number(row.total||0),0)!==expected.publications||includePublications&&publications.filter(row=>row.tribunal===tribunal).length!==expected.publications)throw new Error('Os dados mudaram durante a exportação. Gere o Excel novamente para incluir todos os registros.');
 }
 if(includePublications&&new Set(publications.map(p=>p.id)).size!==publications.length)throw new Error('A exportação recebeu publicações repetidas. Gere o Excel novamente.');
}
