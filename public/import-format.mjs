// Shared by the browser and the API. Spreadsheet records remain separate from DJEN.
export function importItems(value) {
 const items=Array.isArray(value)?value:value?.items;
 if(!Array.isArray(items))throw new Error('Formato não reconhecido. Use uma lista JSON de processos ou um objeto com a lista items de publicações.');
 if(!items.length)throw new Error('O arquivo não contém registros para importar.');
 if(items.length>1000)throw new Error('O arquivo contém mais de 1.000 registros. Divida-o em lotes de até 1.000.');
 return items;
}
export function parseCaseImport(items) {
 if(!Array.isArray(items)||!items.length)throw new Error('Informe uma lista de processos.');
 const unique=new Map();let duplicates=0;
 for(let i=0;i<items.length;i++){
  const item=items[i];
  if(!item||typeof item!=='object'||Array.isArray(item)||!Object.hasOwn(item,'Número'))throw new Error('Linha '+(i+1)+': informe um registro da planilha com a coluna Número. Não misture processos e publicações.');
  const value=item['Número'];
  if(typeof value!=='string'||!/^\d{20}$|^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(value.trim()))throw new Error('Linha '+(i+1)+': o Número deve ser um CNJ de 20 dígitos, guardado como texto.');
  const cnj=value.replace(/\D/g,'');
  if(unique.has(cnj)){duplicates++;continue;}
  const title=typeof item['Título']==='string'?item['Título'].trim():'';
  const tribunal=typeof item.Tribunal==='string'&&item.Tribunal.trim()?item.Tribunal.trim():'Não informado';
  if(title.length>1000||tribunal.length>40)throw new Error('Linha '+(i+1)+': título ou tribunal muito longo.');
  unique.set(cnj,{cnj,title,tribunal,raw:JSON.stringify({_juris_import:{title,fields:item}})});
 }
 return {records:[...unique.values()],duplicates};
}
export function classifyImport(value) {
 const items=importItems(value);
 const spreadsheet=items.some(item=>item&&typeof item==='object'&&Object.hasOwn(item,'Número'));
 if(spreadsheet){const parsed=parseCaseImport(items);return {kind:'processes',items,...parsed};}
 return {kind:'publications',items};
}
