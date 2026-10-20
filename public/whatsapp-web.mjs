import {publicationMessage} from './clients-ui.mjs';
import {cnj,fmt} from './ui.mjs';
export function whatsappChooserLinks(message){
 if(typeof message!=='string'||!message.trim()||message.length>6000)throw new Error('Escreva uma mensagem com até 6.000 caracteres.');
 const query=new URLSearchParams({text:message}).toString();
 return {web:'https://web.whatsapp.com/send?'+query,universal:'https://wa.me/?'+query};
}
export function createWhatsAppWebUI({api}){
 const $=s=>document.querySelector(s),dialog=$('#whatsapp-web-modal');let generation=0;
 function clearLinks(){for(const id of ['#whatsapp-web-open','#whatsapp-web-alternative']){$(id).removeAttribute('href');$(id).setAttribute('aria-disabled','true')}$('#whatsapp-web-copy').disabled=true;}
 function updateLinks(){clearLinks();$('#whatsapp-web-error').textContent='';$('#whatsapp-web-feedback').textContent='';try{const links=whatsappChooserLinks($('#whatsapp-web-text').value);$('#whatsapp-web-open').href=links.web;$('#whatsapp-web-alternative').href=links.universal;for(const id of ['#whatsapp-web-open','#whatsapp-web-alternative'])$(id).setAttribute('aria-disabled','false');$('#whatsapp-web-copy').disabled=false;}catch(e){$('#whatsapp-web-error').textContent=e.message}}
 async function open(publicationId,processNumber){
  const revision=++generation;clearLinks();$('#whatsapp-web-content').hidden=true;$('#whatsapp-web-text').value='';$('#whatsapp-web-load-error').textContent='';$('#whatsapp-web-source').classList.remove('source-canceled');$('#whatsapp-web-source').textContent='Carregando a publicação…';if(!dialog.open)dialog.showModal();
  try{const result=await api('clients/publications/'+encodeURIComponent(publicationId)+'?'+new URLSearchParams({cnj:processNumber}));if(revision!==generation||!dialog.open)return;const p=result.publication;$('#whatsapp-web-source').textContent=`${cnj(p.cnj)} · ${p.tribunal} · ${fmt(p.date)}${p.canceled?' · PUBLICAÇÃO CANCELADA NA FONTE':''}`;$('#whatsapp-web-source').classList.toggle('source-canceled',!!p.canceled);$('#whatsapp-web-text').value=publicationMessage(null,p);$('#whatsapp-web-content').hidden=false;updateLinks();}catch(e){if(revision===generation&&dialog.open){$('#whatsapp-web-source').textContent='Não foi possível preparar a publicação.';$('#whatsapp-web-load-error').textContent=e.message;}}
 }
 $('#whatsapp-web-text').addEventListener('input',updateLinks);
 $('#whatsapp-web-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#whatsapp-web-text').value);$('#whatsapp-web-feedback').textContent='Mensagem copiada. Se precisar, cole na conversa escolhida.';}catch{$('#whatsapp-web-text').select();$('#whatsapp-web-feedback').textContent='Selecione e copie o texto acima.';}};
 for(const id of ['#whatsapp-web-open','#whatsapp-web-alternative'])$(id).addEventListener('click',e=>{if(e.currentTarget.getAttribute('aria-disabled')==='true'){e.preventDefault();return}$('#whatsapp-web-feedback').textContent='No WhatsApp, procure o contato, confira a mensagem e clique em Enviar.';});
 dialog.addEventListener('close',()=>{generation++;clearLinks()});
 document.addEventListener('click',e=>{const button=e.target.closest('button[data-share-web-publication]');if(button)open(button.dataset.shareWebPublication,button.dataset.shareCnj)});
 return {open};
}
