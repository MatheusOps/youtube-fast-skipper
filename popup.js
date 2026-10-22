'use strict';
const defaults = {remember:true, step:0.25, autoSkip:true, trustedSkip:true, muteAds:true, accelerateAds:true};
const ids = Object.keys(defaults);
const status = document.getElementById('status');
let currentSettings = {...defaults};
function showSetting(id,value) {
  const el=document.getElementById(id);
  if(el.type==='checkbox') el.checked=!!value; else el.value=String(value);
}
for (const id of ids) document.getElementById(id).disabled = true;
chrome.storage.local.get(defaults).then(settings => {
  currentSettings={...defaults,...settings};
  for (const id of ids) {
    const el = document.getElementById(id);
    showSetting(id,currentSettings[id]);
    el.disabled = false;
    el.addEventListener('change', async () => {
      const next=el.type==='checkbox' ? el.checked : Number(el.value);
      el.disabled=true;
      try {
        await chrome.storage.local.set({[id]:next});
        currentSettings[id]=next;
        status.textContent = 'Configuração salva.';
      } catch {
        showSetting(id,currentSettings[id]);
        status.textContent = 'Não foi possível salvar. Tente novamente.';
      } finally {el.disabled=false;}
    });
  }
}).catch(() => {status.textContent = 'Não foi possível carregar as configurações.';});
chrome.storage.onChanged?.addListener((changes,area)=>{
  if(area!=='local') return;
  for(const id of ids) if(changes[id]) {
    currentSettings[id]=changes[id].newValue ?? defaults[id];
    showSetting(id,currentSettings[id]);
  }
});

const skipStatus = document.getElementById('skipStatus');
const skipTarget = document.getElementById('skipTarget');
const copyDiagnostic = document.getElementById('copyDiagnostic');
const diagnosticText = document.getElementById('diagnosticText');
let diagnosticSnapshot = null;
const targetName = target => target ? [target.tag, target.id ? '#'+target.id : '', target.classes ? '.'+target.classes.split(/\s+/).join('.') : ''].join('').slice(0,250) : 'nenhum';
const trustedReasons={
  'mode-disabled':'opção desativada',
  'auto-skip-disabled':'Pular automaticamente está desativado',
  'no-player':'player não encontrado',
  'no-ad':'sem anúncio detectado',
  'document-hidden':'aba não visível',
  'non-main-player':'player principal não selecionado',
  'invalid-target-id':'botão sem identificador compatível',
  'unsupported-target':'alvo não é um botão compatível',
  'offscreen':'centro do botão fora da tela',
  'covered':'outro elemento cobre o botão',
  'hit-test-error':'não foi possível verificar o alvo',
  'no-eligible-target':'aguardando um botão Pular disponível',
  'cooldown':'aguardando o intervalo entre tentativas',
  'eligible':'botão pronto para a tentativa',
  'pending':'tentativa em andamento'
};
async function refreshSkipStatus() {
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id) throw new Error('no-tab');
    const result=await chrome.tabs.sendMessage(tab.id,{type:'VIDEO_TURBO_SKIP_STATUS'});
    const installedVersion=chrome.runtime.getManifest().version;
    if (result.version !== installedVersion) {
      diagnosticSnapshot=null;
      copyDiagnostic.disabled=true;
      skipTarget.textContent='';
      diagnosticText.hidden=true;
      skipStatus.textContent='A aba usa um script antigo ou de outra versão. Atualize a página do YouTube. Extensão: '+installedVersion+'; script: '+(result.version || 'sem versão')+'.';
      return;
    }
    skipStatus.textContent='Script '+result.version+'. '+result.status+(result.lastAction ? ' Última tentativa: '+result.lastAction : '');
    diagnosticSnapshot={version:result.version,status:result.status,lastAction:result.lastAction,diagnostics:result.diagnostics};
    copyDiagnostic.disabled=!result.diagnostics;
    const details=result.diagnostics;
    skipTarget.textContent=details ? 'Candidatos: '+details.candidateCount+'. Último alvo: '+targetName(details.lastTarget)+(details.lastTarget ? ' ('+details.lastTarget.attempts+' tentativas).' : '.') : '';
    if(details?.trustedMode) {
      const mode=details.trustedMode;
      skipTarget.textContent+=' Pular Anúncios (clique pelo Chrome): '+(mode.enabled ? 'ativado' : 'desativado')+'. '+(trustedReasons[mode.reason]||mode.reason)+'.';
    }
  } catch {
    diagnosticSnapshot=null;
    copyDiagnostic.disabled=true;
    skipTarget.textContent='';
    diagnosticText.hidden=true;
    skipStatus.textContent='Abra uma aba do YouTube atualizada para ver o diagnóstico.';
  }
}
copyDiagnostic.addEventListener('click', async () => {
  if (!diagnosticSnapshot?.diagnostics) return;
  const text=JSON.stringify(diagnosticSnapshot,null,2);
  try {
    await navigator.clipboard.writeText(text);
    diagnosticText.hidden=true;
    status.textContent='Diagnóstico copiado. Cole na conversa.';
  } catch {
    diagnosticText.value=text;
    diagnosticText.hidden=false;
    diagnosticText.focus();
    diagnosticText.select();
    status.textContent='Selecione e copie o diagnóstico abaixo com Ctrl+C.';
  }
});
refreshSkipStatus();
setInterval(refreshSkipStatus,1000);
