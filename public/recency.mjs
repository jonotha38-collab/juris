// Calendar dates in São Paulo are supplied by the caller; never use a fixed 730-day year.
export function twoYearsAgo(reference){
 const [year,month,day]=reference.split('-').map(Number),target=year-2;
 const last=new Date(Date.UTC(target,month,0)).getUTCDate();
 return String(target).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(Math.min(day,last)).padStart(2,'0');
}
export function collectionStart(reference){
 const date=new Date(twoYearsAgo(reference)+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);
}
export function isRecentActivityDate(value,reference){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=new Date(value+'T12:00:00Z');
 return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value&&value>twoYearsAgo(reference)&&value<=reference;
}
