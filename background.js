// Entrada do navegador é usada apenas quando a pessoa ativa a opção
// experimental. A página e o content script não escolhem métodos CDP,
// coordenadas, expressões, abas ou URLs.
(() => {
  'use strict';
  const REQUEST = 'VIDEO_TURBO_TRUSTED_SKIP';
  const ORIGIN = 'https://www.youtube.com';
  const busy = new Set();
  const locked = new Set();
  const cleaning = new Set();
  const lastAttempt = new Map();

  function youtubeUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === ORIGIN;
    } catch { return false; }
  }

  async function currentTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.active || !youtubeUrl(tab.url)) return false;
    const window = await chrome.windows.get(tab.windowId);
    return !!window?.focused;
  }

  // This function is serialized into the fixed Runtime.evaluate expression.
  // The sole argument is an ID constrained by the message validator.
  function inspectTarget(targetId) {
    if (location.origin !== 'https://www.youtube.com' || document.visibilityState !== 'visible') return {ok:false,reason:'inactive-page'};
    const player = document.querySelector('#movie_player.html5-video-player');
    if (!player?.matches('.ad-showing,.ad-interrupting')) return {ok:false,reason:'no-ad'};
    const button = document.getElementById(targetId);
    if (!button || !player.contains(button) || !button.matches('button,[role="button"]')) return {ok:false,reason:'target-changed'};
    const known = '.ytp-ad-skip-button-modern,.ytp-ad-skip-button,.ytp-skip-ad-button,.ytp-ad-skip-button-container,.ytp-ad-skip-button-slot';
    const label = value => String(value || '').replace(/\s+/g,' ').trim();
    const skipLabel = /^(?:pular(?: (?:anúncio|anúncios|publicidade))?|skip(?: (?:ad|ads|advertisement))?|saltar(?: (?:anuncio|anuncios|publicidad))?)$/i;
    const countdown = /\b(?:skip (?:ad )?in|pular (?:anúncio )?em|saltar en)\b/i;
    const names = [button.getAttribute('aria-label'),button.textContent];
    if (!button.matches(known) && !names.some(value=>skipLabel.test(label(value)))) return {ok:false,reason:'unknown-control'};
    for (let node=button; node; node=node.parentElement) {
      if (node.matches(':disabled') || node.getAttribute('aria-disabled')==='true' || node.hidden || node.hasAttribute('inert')) return {ok:false,reason:'disabled'};
      if ((node===button || node.matches(known)) && countdown.test(label((node.getAttribute('aria-label') || '') + ' ' + node.textContent))) return {ok:false,reason:'countdown'};
      const css = getComputedStyle(node);
      if (css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse' || Number(css.opacity)<=0.01) return {ok:false,reason:'hidden'};
      if (node===player) break;
    }
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width/2;
    const y = rect.top + rect.height/2;
    if (!rect.width || !rect.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight) return {ok:false,reason:'offscreen'};
    const hit = document.elementFromPoint(x,y);
    if (!hit || !button.contains(hit)) return {ok:false,reason:'covered'};
    return {ok:true,x,y};
  }

  async function inspect(tabId, targetId) {
    const expression = '(' + inspectTarget.toString() + ')(' + JSON.stringify(targetId) + ')';
    const reply = await chrome.debugger.sendCommand({tabId},'Runtime.evaluate',{expression,returnByValue:true,awaitPromise:false});
    if (reply?.exceptionDetails) return {ok:false,reason:'inspection-error'};
    const value = reply?.result?.value;
    if (!value || typeof value.ok !== 'boolean') return {ok:false,reason:'inspection-error'};
    if (value.ok && (!Number.isFinite(value.x) || !Number.isFinite(value.y))) return {ok:false,reason:'inspection-error'};
    return value;
  }

  async function dispatch(tabId, targetId) {
    if (!await currentTab(tabId)) return {ok:false,reason:'inactive-tab'};
    const settings = await chrome.storage.local.get({autoSkip:true,trustedSkip:true});
    if (settings.autoSkip !== true || settings.trustedSkip !== true) return {ok:false,reason:'disabled-setting'};
    if (locked.has(tabId)) return {ok:false,reason:'debugger-locked'};
    if (busy.has(tabId)) return {ok:false,reason:'busy'};
    const now=Date.now();
    if (now-(lastAttempt.get(tabId)||0)<1500) return {ok:false,reason:'cooldown'};
    busy.add(tabId);
    lastAttempt.set(tabId,now);
    let attached=false;
    let pressed=false;
    let point=null;
    try {
      if (!await currentTab(tabId)) return {ok:false,reason:'inactive-tab'};
      try {
        await chrome.debugger.attach({tabId},'1.3');
        attached=true;
      } catch {
        locked.add(tabId);
        return {ok:false,reason:'debugger-unavailable'};
      }
      if (!await currentTab(tabId)) return {ok:false,reason:'inactive-tab'};
      if (locked.has(tabId)) return {ok:false,reason:'debugger-locked'};
      const found=await inspect(tabId,targetId);
      if (!found.ok) return {ok:false,reason:found.reason};
      if (!await currentTab(tabId)) return {ok:false,reason:'inactive-tab'};
      if (locked.has(tabId)) return {ok:false,reason:'debugger-locked'};
      const enabled=await chrome.storage.local.get({autoSkip:true,trustedSkip:true});
      if (enabled.autoSkip!==true || enabled.trustedSkip!==true) return {ok:false,reason:'disabled-setting'};
      point={x:found.x,y:found.y};
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
      pressed=true;
      if (!await currentTab(tabId)) return {ok:false,reason:'inactive-tab'};
      if (locked.has(tabId)) return {ok:false,reason:'debugger-locked'};
      const afterPress=await inspect(tabId,targetId);
      if (!afterPress.ok || afterPress.x!==point.x || afterPress.y!==point.y) return {ok:false,reason:'target-changed'};
      if (!await currentTab(tabId)) return {ok:false,reason:'inactive-tab'};
      if (locked.has(tabId)) return {ok:false,reason:'debugger-locked'};
      const stillEnabled=await chrome.storage.local.get({autoSkip:true,trustedSkip:true});
      if (stillEnabled.autoSkip!==true || stillEnabled.trustedSkip!==true) return {ok:false,reason:'disabled-setting'};
      await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
      pressed=false;
      return {ok:true,reason:'input-dispatched'};
    } catch {
      return {ok:false,reason:'debugger-error'};
    } finally {
      if (attached) {
        if (pressed && point) {
          try {
            // Solta longe de qualquer controle, inclusive se a aba navegou.
            await chrome.debugger.sendCommand({tabId},'Input.dispatchMouseEvent',{type:'mouseReleased',x:-1,y:-1,button:'left',buttons:0,clickCount:0});
          } catch { /* O debugger já pode ter sido desconectado. */ }
        }
        cleaning.add(tabId);
        try { await chrome.debugger.detach({tabId}); } catch { /* Já desconectado. */ }
        cleaning.delete(tabId);
      }
      busy.delete(tabId);
    }
  }

  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if (message?.type!==REQUEST) return;
    const targetId=message.targetId;
    if (sender?.id!==chrome.runtime.id || sender.frameId!==0 ||
        !Number.isInteger(sender.tab?.id) || !youtubeUrl(sender.url) ||
        typeof targetId!=='string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(targetId) ||
        Object.keys(message).length!==2) {
      respond({ok:false,reason:'invalid-request'});
      return;
    }
    dispatch(sender.tab.id,targetId).then(respond,()=>respond({ok:false,reason:'debugger-error'}));
    return true;
  });
  chrome.debugger.onDetach.addListener((source)=>{
    if (Number.isInteger(source?.tabId) && !cleaning.has(source.tabId)) locked.add(source.tabId);
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area==='local' && changes.trustedSkip?.newValue===true && changes.trustedSkip.oldValue!==true) locked.clear();
  });
  chrome.tabs.onRemoved.addListener(tabId=>{busy.delete(tabId);locked.delete(tabId);lastAttempt.delete(tabId);});
})();
