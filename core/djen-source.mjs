import {AppError} from './errors.mjs';
export class SourcePause extends AppError{
 constructor(retryAt){super('A fonte pediu uma pausa. A busca será retomada após o intervalo.',429);this.retryAt=retryAt;}
}
export async function readDjenPage(fetcher,params){
 const url=new URL('https://comunicaapi.pje.jus.br/api/v1/comunicacao');url.search=new URLSearchParams(params).toString();
 const response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
 if(response.status===429){const raw=response.headers.get('retry-after'),seconds=Number(raw);throw new SourcePause(Math.max(Date.now()+60000,Number.isFinite(seconds)&&seconds>0?Date.now()+seconds*1000:Date.parse(raw||'')||0));}
 if(response.status===403)throw new AppError('O DJEN recusou o acesso (HTTP 403). Retome em um ambiente autorizado pela fonte.',502);
 if(!response.ok)throw new AppError('DJEN indisponível (HTTP '+response.status+'). O ponto da busca foi preservado.',502);
 let body;try{body=await response.json()}catch{throw new AppError('O DJEN retornou um formato inesperado. Retome a busca para tentar novamente.',502)}
 if(!Array.isArray(body.items))throw new AppError('Resposta do DJEN sem a lista de publicações esperada. A busca não foi marcada como concluída.',502);
 if(body.items.length>100)throw new AppError('A fonte retornou uma página maior que o esperado.',502);
 return body;
}
