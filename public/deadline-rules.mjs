export function foldDeadlineText(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}

export function validDeadlineDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const time=Date.parse(value+'T12:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value&&value>='1900-01-01'&&value<='2200-12-31';}

export function deadlineNumber(value){
 const words={um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezessete:17,dezoito:18,dezenove:19,vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,noventa:90};
 const text=foldDeadlineText(value).trim();if(/^\d{1,4}$/.test(text))return Number(text);
 if(words[text])return words[text];const pair=text.split(/\s+e\s+/);return pair.length===2&&words[pair[0]]>=20&&words[pair[1]]<10?words[pair[0]]+words[pair[1]]:null;
}

export function analyzeDeadlines(value){
 const text=String(value??''),flat=foldDeadlineText(text),items=[],warnings=[];
 const signals=/\b(prazo|intim[aeoc]|citacao|cite-se|manifest|contest|defesa|respon|respost|junt|replica|cumpr|recolh|emende|emendar|regulariz|providenci|apresent|interpo|audiencia|sessao)\w*/;
 const context=(a,b)=>flat.slice(Math.max(0,a-110),Math.min(flat.length,b+55));
 const excerpt=(a,b)=>text.slice(Math.max(0,a-100),Math.min(text.length,b+125)).trim();
 const word='(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|noventa)(?:\\s+e\\s+(?:um|dois|tres|quatro|cinco|seis|sete|oito|nove))?';
 const duration=new RegExp('\\b(\\d{1,4}|'+word+')(?:\\s*\\(([^)]{1,45})\\))?\\s*(dias?|horas?|mes|meses|anos?)\\b(?:\\s+(uteis|corridos))?','g');
 for(const m of flat.matchAll(duration)){
  if(!signals.test(context(m.index,m.index+m[0].length)))continue;
  const amount=deadlineNumber(m[1]),written=m[2]?deadlineNumber(m[2]):null;
  if(!amount||amount>3650){warnings.push('Há um período que exige leitura e conferência manual.');continue;}
  const unit=m[3].startsWith('dia')?'day':m[3].startsWith('hora')?'hour':m[3].startsWith('mes')?'month':'year';
  const item={key:'item-'+items.length,kind:'relative',amount,unit,basis:m[4]==='uteis'?'business':m[4]==='corridos'?'calendar':null,explicit_date:null,excerpt:excerpt(m.index,m.index+m[0].length),label:m[0],title:('Conferir e cumprir prazo de '+m[0]).slice(0,200)};
  if(m[2]&&written!==amount){item.ambiguous=true;warnings.push('Número e valor por extenso divergentes: confira o texto original.');}
  if(unit!=='day')warnings.push('Prazos em horas, meses ou anos exigem data e horário conferidos manualmente.');
  items.push(item);
 }
 const dates=/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
 for(const m of flat.matchAll(dates)){
  const before=flat.slice(Math.max(0,m.index-90),m.index);
  if(!/\b(ate(?:\s+o)?(?:\s+dia)?|vencimento|encerra\w*|termin[oa]\w*|audiencia|sessao|designad[ao]\w*|data limite)\b/.test(before))continue;
  const iso=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  if(!validDeadlineDate(iso)){warnings.push('A publicação contém uma data inválida ou incompleta.');continue;}
  items.push({key:'item-'+items.length,kind:'date',amount:null,unit:null,basis:null,explicit_date:iso,excerpt:excerpt(m.index,m.index+m[0].length),label:m[0],title:('Conferir providência até '+m[0]).slice(0,200)});
 }
 if(items.length>12)warnings.push('Mais de 12 indicações encontradas. Leia o texto integral e acrescente os demais prazos manualmente.');
 if(!items.length)warnings.push('Nenhum prazo explícito foi reconhecido. Isso não dispensa a leitura integral nem significa ausência de providências.');
 warnings.push('Disponibilização no DJEN não define, por si só, a data inicial da contagem. Confirme a intimação e o regime aplicável; no SEEU podem existir regras penais.');
 return {version:1,items:items.slice(0,12),has_signals:signals.test(flat),warnings:[...new Set(warnings)],needs_review:true};
}

export function suggestDeadline({base_date,amount,mode,excluded_dates=[],suspended_dates=[],recess=false,roll_end=false}={}){
 if(!validDeadlineDate(base_date))throw new Error('Confirme a data do termo inicial, que será excluída da contagem.');
 if(!Number.isInteger(amount)||amount<1||amount>3650)throw new Error('Informe de 1 a 3.650 dias.');
 if(!['business','calendar'].includes(mode))throw new Error('Escolha expressamente dias úteis ou corridos.');
 if(!Array.isArray(excluded_dates)||excluded_dates.length>1200||excluded_dates.some(date=>!validDeadlineDate(date)))throw new Error('Confira as datas sem expediente ou de suspensão.');
 if(typeof recess!=='boolean'||typeof roll_end!=='boolean')throw new Error('Confira as opções da contagem.');
 if(!Array.isArray(suspended_dates)||suspended_dates.length>1200||suspended_dates.some(date=>!validDeadlineDate(date)))throw new Error('Confira as datas de suspensão.');
 const excluded=new Set(excluded_dates),suspensions=new Set(suspended_dates),trace=[],skipped=[];let date=base_date,remaining=amount,steps=0;
 const next=value=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};
 const weekend=value=>[0,6].includes(new Date(value+'T12:00:00Z').getUTCDay());
 const suspended=value=>suspensions.has(value)||recess&&(value.slice(5)>='12-20'||value.slice(5)<='01-20');
 while(remaining>0){
  if(++steps>20000)throw new Error('A contagem excedeu o limite. Confira as datas informadas.');
  date=next(date);
  const reason=suspended(date)?'Suspensão informada pelo escritório':mode==='business'&&excluded.has(date)?'Data excluída pelo escritório':mode==='business'&&weekend(date)?'Fim de semana':null;
  if(reason){if(skipped.length<80)skipped.push({date,reason});continue;}
  remaining--;if(trace.length<80)trace.push(date);
 }
 if(roll_end){while(weekend(date)||excluded.has(date)||suspended(date)){if(++steps>20000)throw new Error('Confira o calendário.');if(skipped.length<80)skipped.push({date,reason:'Vencimento prorrogado conforme opção informada'});date=next(date);}}
 if(!validDeadlineDate(date))throw new Error('A data calculada está fora do intervalo aceito.');
 return {due_date:date,base_date,amount,mode,excluded_dates:[...excluded].sort(),suspended_dates:[...suspensions].sort(),recess,roll_end,trace,skipped,notice:'Simulação conforme parâmetros informados. Feriados locais, suspensões e regras especiais precisam ser conferidos na fonte oficial.'};
}
