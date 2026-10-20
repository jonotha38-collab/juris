import { partiesOf, formatCnj } from './parties.mjs';
const missing = 'Não informado pela fonte';
export function buildReport(items) {
  const processes = new Map();
  const publications = [];
  for (const item of items) {
    const parties = partiesOf(item);
    const cnj = formatCnj(item.numero_processo);
    const date = String(item.data_disponibilizacao || item.dataDisponibilizacao || '').slice(0, 10);
    const tribunal = String(item.siglaTribunal || item.sigla_tribunal || missing);
    const organ = String(item.nomeOrgao || item.nome_orgao || missing);
    const type = String(item.tipoComunicacao || item.tipo_comunicacao || 'Publicação');
    const canceled = !!item.motivo_cancelamento || item.ativo === false || item.status === 'C';
    const text = String(item.texto || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const certificate = item.hash ? 'https://comunicaapi.pje.jus.br/api/v1/comunicacao/' + encodeURIComponent(item.hash) + '/certidao' : '';
    publications.push([parties.title, cnj, parties.active.join('; ') || missing, parties.passive.join('; ') || missing,
      parties.other.join('; '), tribunal, organ, date, type, canceled ? 'Cancelada' : 'Publicada', text, certificate, String(item.id || item.hash || '')]);
    let process = processes.get(cnj);
    if (!process) {
      process = { cnj, active: new Set(), passive: new Set(), other: new Set(), tribunals: new Set(), organs: new Set(), first: date, last: date, count: 0, canceled: 0 };
      processes.set(cnj, process);
    }
    for (const role of ['active', 'passive', 'other']) for (const name of parties[role]) process[role].add(name);
    process.tribunals.add(tribunal); process.organs.add(organ); process.count++; process.canceled += Number(canceled);
    if (date && (!process.first || date < process.first)) process.first = date;
    if (date && (!process.last || date > process.last)) process.last = date;
  }
  publications.sort((a, b) => b[7].localeCompare(a[7]) || a[0].localeCompare(b[0], 'pt-BR'));
  const processRows = [...processes.values()].map(p => {
    const parties = partiesOf({ destinatarios: ['active', 'passive', 'other'].flatMap(role => [...p[role]].map(nome => ({ nome, polo: role === 'active' ? 'A' : role === 'passive' ? 'P' : '' }))) });
    return [parties.title, p.cnj, [...p.active].join('; ') || missing, [...p.passive].join('; ') || missing,
      [...p.other].join('; '), [...p.tribunals].join('; '), [...p.organs].join('; '), p.first, p.last, p.count, p.canceled];
  }).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  return [
    { name: 'Processos', headers: ['Nome / partes do processo', 'Número CNJ', 'Polo ativo', 'Polo passivo', 'Outras partes', 'Tribunal', 'Órgão julgador', 'Primeira publicação capturada', 'Última publicação capturada', 'Publicações capturadas', 'Publicações canceladas'], widths: [55, 31, 45, 45, 35, 19, 45, 24, 24, 22, 23], dates: [7, 8], rows: processRows },
    { name: 'Publicações', headers: ['Nome / partes do processo', 'Número CNJ', 'Polo ativo', 'Polo passivo', 'Outras partes', 'Tribunal', 'Órgão julgador', 'Disponibilização', 'Tipo de comunicação', 'Situação da publicação', 'Teor da publicação (até 32.767 caracteres)', 'Certidão oficial (URL)', 'Identificação na fonte'], widths: [55, 31, 45, 45, 35, 19, 45, 20, 26, 24, 100, 65, 26], dates: [7], rows: publications }
  ];
}
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function column(i) { let name = ''; for (i++; i; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + (i - 1) % 26) + name; return name; }
function sheetXml(sheet) {
  if (sheet.rows.length > 1048575) throw new Error('O Excel aceita até 1.048.575 registros por aba, além do cabeçalho. Divida a exportação.');
  const end = column(sheet.headers.length - 1) + (sheet.rows.length + 1);
  const rows = [sheet.headers, ...sheet.rows].map((row, r) => '<row r="' + (r + 1) + '"' + (r === 0 ? ' ht="32" customHeight="1"' : '') + '>' + row.map((value, c) => {
    const ref = column(c) + (r + 1);
    const date = r > 0 && sheet.dates.includes(c) && /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && Number.isFinite(Date.parse(value));
    const style = r === 0 ? 1 : date ? (r % 2 ? 3 : 5) : (r % 2 ? 2 : 4);
    if (date) return `<c r="${ref}" s="${style}"><v>${(Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000}</v></c>`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    // inlineStr preserves CNJ leading zeros and prevents formula injection.
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value ?? '').slice(0, 32767))}</t></is></c>`;
  }).join('') + '</row>').join('');
  return declaration + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${end}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`;
}
const styles = declaration + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF263E34"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF20735E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F5F1"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
// Small standards-based ZIP writer; stored entries require no CDN or runtime dependency.
function zip(entries) {
  const encoder = new TextEncoder(); const chunks = [], central = []; let offset = 0;
  const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  for (const [path, content] of entries) {
    const name = encoder.encode(path), bytes = encoder.encode(content); let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint16(12, 33, true); l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
    const center = new Uint8Array(46 + name.length), c = new DataView(center.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); center.set(name, 46);
    chunks.push(local, bytes); central.push(center); offset += local.length + bytes.length;
    if (offset > 0xFFFFFFFF) throw new Error('Arquivo maior que 4 GB. Divida a exportação.');
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export function createExcel(items) {
  const sheets = buildReport(items);
  const entries = [
    ['[Content_Types].xml', declaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', declaration + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', declaration + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)])
  ];
  return zip(entries);
}
