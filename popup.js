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
        status.textContent = 'Settings saved.';
      } catch {
        showSetting(id,currentSettings[id]);
        status.textContent = 'Could not save settings. Try again.';
      } finally {el.disabled=false;}
    });
  }
}).catch(() => {status.textContent = 'Could not load settings.';});
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
const targetName = target => target ? [target.tag, target.id ? '#'+target.id : '', target.classes ? '.'+target.classes.split(/\s+/).join('.') : ''].join('').slice(0,250) : 'none';
const trustedReasons={
  'mode-disabled':'option disabled',
  'auto-skip-disabled':'auto-skip is disabled',
  'no-player':'player not found',
  'no-ad':'no ad detected',
  'document-hidden':'tab is not visible',
  'non-main-player':'main player not selected',
  'invalid-target-id':'button has no compatible identifier',
  'unsupported-target':'target is not a compatible button',
  'offscreen':'button center is off-screen',
  'covered':'another element covers the button',
  'hit-test-error':'could not verify the target',
  'no-eligible-target':'waiting for an available Skip button',
  'cooldown':'waiting for the retry interval',
  'eligible':'button ready for an attempt',
  'pending':'attempt in progress'
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
      skipStatus.textContent='This tab has an old or different script version. Refresh the YouTube page. Extension: '+installedVersion+'; script: '+(result.version || 'no version')+'.';
      return;
    }
    skipStatus.textContent='Script '+result.version+'. '+result.status+(result.lastAction ? ' Last attempt: '+result.lastAction : '');
    diagnosticSnapshot={version:result.version,status:result.status,lastAction:result.lastAction,diagnostics:result.diagnostics};
    copyDiagnostic.disabled=!result.diagnostics;
    const details=result.diagnostics;
    skipTarget.textContent=details ? 'Candidates: '+details.candidateCount+'. Last target: '+targetName(details.lastTarget)+(details.lastTarget ? ' ('+details.lastTarget.attempts+' attempts).' : '.') : '';
    if(details?.trustedMode) {
      const mode=details.trustedMode;
      skipTarget.textContent+=' Skip Ads (Chrome click): '+(mode.enabled ? 'enabled' : 'disabled')+'. '+(trustedReasons[mode.reason]||mode.reason)+'.';
    }
  } catch {
    diagnosticSnapshot=null;
    copyDiagnostic.disabled=true;
    skipTarget.textContent='';
    diagnosticText.hidden=true;
    skipStatus.textContent='Open a refreshed YouTube tab to see diagnostics.';
  }
}
copyDiagnostic.addEventListener('click', async () => {
  if (!diagnosticSnapshot?.diagnostics) return;
  const text=JSON.stringify(diagnosticSnapshot,null,2);
  try {
    await navigator.clipboard.writeText(text);
    diagnosticText.hidden=true;
    status.textContent='Diagnostics copied. Paste them into the conversation.';
  } catch {
    diagnosticText.value=text;
    diagnosticText.hidden=false;
    diagnosticText.focus();
    diagnosticText.select();
    status.textContent='Select and copy the diagnostics below with Ctrl+C.';
  }
});
refreshSkipStatus();
setInterval(refreshSkipStatus,1000);
