// Only structured party recipients are used. Lawyers are never inferred as parties.
export function partiesOf(publication = {}) {
  const groups = { active: [], passive: [], other: [] };
  const seen = new Set();
  for (const recipient of Array.isArray(publication.destinatarios) ? publication.destinatarios : []) {
    if (!recipient || typeof recipient !== 'object') continue;
    if (/advogad/i.test(String(recipient.tipo || recipient.tipoDestinatario || ''))) continue;
    const name = typeof recipient.nome === 'string' ? recipient.nome.replace(/\s+/g, ' ').trim() : '';
    if (!name) continue;
    const role = String(recipient.polo || '').toUpperCase();
    const group = role === 'A' ? 'active' : role === 'P' ? 'passive' : 'other';
    const key = group + ':' + name.toLocaleLowerCase('pt-BR');
    if (!seen.has(key)) { groups[group].push(name); seen.add(key); }
  }
  const names = [...new Set([...groups.active, ...groups.passive, ...groups.other])];
  const short = list => list[0] + (list.length > 1 ? ` e mais ${list.length - 1}` : '');
  const title = groups.active.length && groups.passive.length
    ? `${short(groups.active)} × ${short(groups.passive)}`
    : names.length ? short(names) : 'Nome não informado pela fonte';
  return { ...groups, names, title };
}
export const formatCnj = value => String(value || '').replace(/\D/g, '').replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6');
