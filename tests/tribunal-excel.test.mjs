import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildTribunalSheets,createTribunalExcel,checkReportCounts} from '../public/tribunal-report.mjs';
import {createWorkbook} from '../public/excel.mjs';
import {reportFixture,zipEntries,cnj} from './report-fixture.mjs';
const xml=value=>new JSDOM(value,{contentType:'application/xml'}).window.document;
test('tribunal Excel has summary, selected court sheets, real publications and unique relationship IDs',async t=>{
 const {client,api}=await reportFixture();t.after(()=>client.close());
 const query='tribunals=SEEU&tribunals=TJSP';const processes=(await api('reports/processes?'+query)).rows,publications=(await api('reports/publications?'+query)).rows;
 const file=createTribunalExcel({tribunals:['SEEU','TJSP'],processes,publications,oabLabel:'12345/SP'}),entries=zipEntries(await file.arrayBuffer());
 const workbook=xml(entries.get('xl/workbook.xml')),names=[...workbook.querySelectorAll('sheet')].map(sheet=>sheet.getAttribute('name'));
 assert.deepEqual(names,['Resumo','SEEU','TJSP','Publicações']);
 const relations=[...xml(entries.get('xl/_rels/workbook.xml.rels')).querySelectorAll('Relationship')];assert.equal(new Set(relations.map(row=>row.getAttribute('Id'))).size,relations.length);
 assert.equal(relations.filter(row=>row.getAttribute('Type').endsWith('/styles')).length,1);
 const imported=entries.get('xl/worksheets/sheet2.xml');assert.match(imported,/Cadastro sem publicações/);assert.match(imported,/0000000-00.0000.0.00.0003/);
 const cases=xml(entries.get('xl/worksheets/sheet3.xml'));assert.match(cases.documentElement.textContent,/Cliente confirmado/);assert.equal(cases.querySelector('[r="B2"]').getAttribute('t'),'inlineStr');assert.equal(cases.querySelector('pane').getAttribute('state'),'frozen');assert.ok(cases.querySelector('autoFilter'));
 assert.equal(xml(entries.get('xl/worksheets/sheet4.xml')).querySelectorAll('sheetData row').length,2);
});
test('consolidated output counts a shared CNJ once and preserves imported-only cases',async t=>{
 const {client,api}=await reportFixture();t.after(()=>client.close());
 const query='tribunals=SEEU&tribunals=TJSP&tribunals=TJRJ',processes=(await api('reports/processes?'+query)).rows;
 const sheets=buildTribunalSheets({tribunals:['SEEU','TJSP','TJRJ'],processes,split:false,includePublications:false});
 assert.deepEqual(sheets.map(sheet=>sheet.name),['Resumo','Processos']);assert.equal(sheets[0].rows[0][1],3);assert.equal(sheets[1].rows.length,3);
 const shared=sheets[1].rows.find(row=>row[1].endsWith('0001'));assert.match(shared[2],/TJSP/);assert.match(shared[2],/TJRJ/);assert.equal(shared[9],2);
 assert.equal(sheets[1].rows.some(row=>row[1].endsWith('0003')&&row[9]===0),true);
});
test('generated workbooks preserve text safely, reject invalid dates as dates and sanitize sheet names',async()=>{
 const dangerous='=HYPERLINK("https://example.invalid","text")',names=['Resumo','Resumo','A/B:*?[] tribunal with a very long name','a b    tribunal with a very long name'];
 const file=createWorkbook(names.map(name=>({name,headers:['Texto','Data','CNJ'],widths:[50,20,30],dates:[1],rows:[[dangerous,'2026-02-30',cnj(1)],['A & <B>','2024-02-29',cnj(2)]]}))),entries=zipEntries(await file.arrayBuffer());
 const actual=[...xml(entries.get('xl/workbook.xml')).querySelectorAll('sheet')].map(node=>node.getAttribute('name'));
 assert.equal(new Set(actual.map(name=>name.toLowerCase())).size,4);assert.equal(actual.every(name=>name.length<=31&&!/[\\/?*\[\]:]/.test(name)),true);
 const sheet=xml(entries.get('xl/worksheets/sheet1.xml'));assert.equal(sheet.querySelectorAll('f').length,0);assert.equal(sheet.querySelector('[r="A2"]').textContent,dangerous);assert.equal(sheet.querySelector('[r="B2"]').getAttribute('t'),'inlineStr');assert.equal(sheet.querySelector('[r="B3"]').getAttribute('t'),null);assert.equal(sheet.querySelector('[r="C2"]').textContent,cnj(1));
});
test('count reconciliation refuses incomplete, duplicate and changed exports',()=>{
 const options=[{tribunal:'TJSP',processes:1,publications:1}],processes=[{tribunal:'TJSP',cnj:cnj(1),total:1}],publications=[{tribunal:'TJSP',cnj:cnj(1),id:'1'}];
 assert.doesNotThrow(()=>checkReportCounts(options,['TJSP'],processes,publications,true));
 assert.throws(()=>checkReportCounts(options,['TJSP'],[],publications,true),/mudaram/);
 assert.throws(()=>checkReportCounts(options,['TJSP'],processes,[],true),/mudaram/);
 assert.throws(()=>checkReportCounts(options,['TJSP'],[...processes,...processes],publications,true),/mudaram/);
});
