const addDays=(d,n)=>{const t=new Date(d+'T12:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10);};
export function activityWindow(value,reference=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())) {
  const days=[7,30,90].includes(Number(value))?Number(value):30;
  return {days,end:reference,start:addDays(reference,-days+1),previousStart:addDays(reference,-2*days+1),previousEnd:addDays(reference,-days)};
}
