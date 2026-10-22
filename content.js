(() => {
  'use strict';
  if (location.hostname !== 'www.youtube.com') return;
  const defaults = {speed: 1, step: 0.25, remember: true, autoSkip: true, trustedSkip: true, muteAds: true, accelerateAds: true};
  let settings = {...defaults};
  let desired = 1;
  let active = null;
  let frame = 0;
  let visibilityFrame = 0;
  let ready = false;
  let adBefore = false;
  let adSettling = false;
  let adTimer;
  let navigating = false;
  let navigationTimer;
  const attached = new WeakSet();
  const audioListeners = new WeakSet();
  let adAudio = null;
  let audioSuspendedPlayer = null;
  const skipAttempts = new WeakMap();
  const candidates = new Set();
  const roots = new Map();
  let preferred = null;
  let lastSkipStatus = null;
  let lastSkipAction = null;
  let lastSkipButton = null;
  let trustedPending = false;
  let lastTrustedReason = 'mode-disabled';
  let lastSkipDiagnostics = {adDetected:false,playerFound:false,candidateCount:0,candidates:[],lastTarget:null};
  const SCRIPT_VERSION = '2.9.2';
  const clamp = n => Math.round(Math.min(16, Math.max(0.25, n)) * 100) / 100;
  const host = document.createElement('div');
  host.id = 'video-turbo-controls';
  const shadow = host.attachShadow({mode: 'open'});
  shadow.innerHTML = `
    <style>
      :host {all:initial;position:fixed;z-index:2147483647!important;font:13px Arial,sans-serif!important;color:#e7eef5!important;line-height:normal!important;}
      .panel {display:flex;gap:1px;height:24px;align-items:stretch;opacity:.8;}
      button,input,select {font:inherit;box-sizing:border-box;border:0;}
      button {width:24px;height:24px;padding:0;background:rgba(35,48,62,.86);color:#e7eef5;cursor:pointer;border-radius:0;}
      button:hover {background:rgba(55,91,120,.94);} button:focus-visible,input:focus-visible,select:focus-visible {outline:2px solid #67bdff;outline-offset:2px;}
      #gear {font-size:18px;border-radius:5px 0 0 5px;line-height:24px;}
      #plus {border-radius:0 5px 5px 0;}
      #speed {width:40px;height:24px;padding:0 1px;background:rgba(35,48,62,.86);color:white;text-align:center;border-radius:0;appearance:textfield;font-weight:600;}
      #speed::-webkit-inner-spin-button,#speed::-webkit-outer-spin-button {appearance:none;margin:0;}
      #speed.ad {background:rgba(26,112,190,.88);}
      #customSpeed {width:65px;padding:5px;background:#223240;color:#e7eef5;border:1px solid #46617a;border-radius:5px;}
      .settings {position:absolute;right:0;top:29px;box-sizing:border-box;width:min(270px,calc(100vw - 16px));max-height:calc(100vh - 40px);overflow-y:auto;padding:14px;background:#17232f;color:#e7eef5;border:1px solid #344c62;border-radius:8px;box-shadow:0 8px 24px #0009;}
      .settings[hidden] {display:none;}
      label {display:flex;justify-content:space-between;align-items:center;gap:10px;margin:9px 0;font:12px Arial,sans-serif;color:#e7eef5;}
      input[type="checkbox"] {accent-color:#55b7ff;}
      select {background:#223240;color:#e7eef5;border:1px solid #46617a;border-radius:5px;padding:5px;}
      .note {font:11px/1.5 Arial,sans-serif;color:#b5c9d9;margin:9px 0 0;}
      .status {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
    </style>
    <div class="panel" role="group" aria-label="Video speed">
      <button id="gear" title="Settings" aria-label="Settings" aria-expanded="false">⚙</button>
      <button id="minus" title="Decrease speed (−)" aria-label="Decrease speed">&lt;&lt;</button>
      <button id="speed" aria-label="Restore speed to 1×" title="Click to return to 1×">1</button>
      <button id="plus" title="Increase speed (+)" aria-label="Increase speed">&gt;&gt;</button>
    </div>
    <div id="settings" class="settings" hidden>
      <label>Speed <input id="customSpeed" type="number" min="0.25" max="16" step="0.05" aria-label="Custom speed"></label>
      <label>Speed step <select id="step"><option value="0.05">0.05</option><option value="0.1">0.10</option><option value="0.25">0.25</option><option value="0.5">0.50</option><option value="1">1.00</option></select></label>
      <label>Remember speed <input id="remember" type="checkbox"></label>
      <label>Auto-skip ads <input id="autoSkip" type="checkbox"></label>
      <p class="note">Controls all automatic skip attempts.</p>
      <label>Mute ads <input id="muteAds" type="checkbox"></label>
      <label>Skip Ads <input id="trustedSkip" type="checkbox"></label>
      <p class="note">Uses a Chrome click to support some Skip buttons.</p>
      <p class="note">This click uses Chrome debugging permission; a browser warning may appear.</p>
      <label>Speed up ads <input id="accelerateAds" type="checkbox"></label>
      <p class="note">During ads, use 16× when enabled or 1× when disabled. Your preferred speed returns afterward.</p>
    </div>
    <div class="status" role="status" aria-live="polite"></div>`;
  const input = shadow.getElementById('speed');
  const status = shadow.querySelector('.status');
  const customSpeed = shadow.getElementById('customSpeed');
  const isYouTube = /(^|\.)youtube(?:-nocookie)?\.com$/.test(location.hostname);
  const isAd = () => isYouTube && !!active?.closest('.html5-video-player')?.matches('.ad-showing, .ad-interrupting');
  function restoreAdAudio() {
    if (!adAudio) return;
    const session=adAudio;
    adAudio=null;
    for (const video of session.videos) {
      try { video.muted=session.originalMuted; } catch { /* The video may have been removed. */ }
    }
  }
  function syncAdAudio() {
    if (!ready) return;
    let player=active?.isConnected ? active.closest('.html5-video-player') : null;
    // While the scan chooses a new video, the session still belongs to the
    // same player. This covers an element swap during an ad.
    if (!player && !active?.isConnected)
      player=adAudio?.player?.isConnected ? adAudio.player :
        location.pathname==='/watch' ? document.querySelector('#movie_player.html5-video-player') : null;
    if (player && player===audioSuspendedPlayer) {restoreAdAudio(); return;}
    const videos=player ? [...player.querySelectorAll('video')].filter(video=>video.isConnected) : [];
    if (!settings.muteAds || !player?.matches('.ad-showing,.ad-interrupting') || !videos.length) {
      restoreAdAudio();
      return;
    }
    if (adAudio?.player!==player) {
      restoreAdAudio();
      const original=active?.isConnected && player.contains(active) ? active : videos[0];
      adAudio={player,originalMuted:!!original.muted,videos:new Set()};
    }
    for (const oldVideo of adAudio.videos) {
      if (videos.includes(oldVideo)) continue;
      adAudio.videos.delete(oldVideo);
      try {oldVideo.muted=adAudio.originalMuted;} catch { /* The previous video may have been removed. */ }
    }
    for (const video of videos) {
      if (!adAudio.videos.has(video)) {
        adAudio.videos.add(video);
        if (!audioListeners.has(video)) {
          audioListeners.add(video);
          video.addEventListener('volumechange', () => {
            if (adAudio?.videos.has(video) && !video.muted) syncAdAudio();
          });
        }
      }
      if (!video.muted) video.muted=true;
    }
  }
  function render() {
    position();
    const ad = isAd();
    const adRate = settings.accelerateAds ? 16 : 1;
    input.value = String(ad ? adRate : desired);
    input.textContent = input.value;
    if (shadow.activeElement !== customSpeed) customSpeed.value = String(desired);
    input.classList.toggle('ad', ad);
    input.title = ad ? `Ad speed: ${adRate}×. After the ad: ${desired}×. Click to set the return speed to 1×.` : 'Click to return to 1×';
    shadow.getElementById('step').value = String(settings.step);
    shadow.getElementById('remember').checked = settings.remember;
    shadow.getElementById('autoSkip').checked = settings.autoSkip;
    shadow.getElementById('trustedSkip').checked = settings.trustedSkip;
    shadow.getElementById('muteAds').checked = settings.muteAds;
    shadow.getElementById('accelerateAds').checked = settings.accelerateAds;
    status.textContent = ad ? `Ad ${adRate}× · then ${desired}×` : '';
  }
  function persist(patch) {
    Object.assign(settings, patch);
    try {
      chrome.storage.local.set(patch).catch(() => {});
    } catch { /* The tab may have remained open after the extension reloaded. */ }
  }
  function apply() {
    syncAdAudio();
    if (!active) {render(); return;}
    try {
      active.preservesPitch = true;
      // Automatic speed never replaces the user preference.
      const rate = isAd() ? (settings.accelerateAds ? 16 : 1) : desired;
      if (Math.abs(active.defaultPlaybackRate - desired) > 0.001) active.defaultPlaybackRate = desired;
      if (Math.abs(active.playbackRate - rate) > 0.001) active.playbackRate = rate;
      render();
    } catch {status.textContent = 'This video rejected the selected speed.';}
  }
  function choose(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0.25 || n > 16) {
      status.textContent = 'Enter a speed from 0.25 to 16.';
      input.value = String(desired);
      return;
    }
    desired = clamp(n);
    input.value = String(desired);
    if (settings.remember) persist({speed: desired});
    apply();
  }
  function adjust(delta) {choose(clamp(desired + delta));}
  shadow.getElementById('minus').onclick = () => adjust(-settings.step);
  shadow.getElementById('plus').onclick = () => adjust(settings.step);
  const gear = shadow.getElementById('gear');
  const settingsPanel = shadow.getElementById('settings');
  gear.onclick = () => {
    settingsPanel.hidden = !settingsPanel.hidden;
    gear.setAttribute('aria-expanded', String(!settingsPanel.hidden));
  };
  shadow.getElementById('step').addEventListener('change', e => persist({step:Number(e.target.value)}));
  shadow.getElementById('remember').addEventListener('change', e => persist({remember:e.target.checked}));
  document.addEventListener('pointerdown', e => {
    if (!e.composedPath().includes(host)) {
      settingsPanel.hidden = true;
      gear.setAttribute('aria-expanded', 'false');
    }
  }, true);
  shadow.getElementById('autoSkip').addEventListener('change', e => persist({autoSkip:e.target.checked}));
  shadow.getElementById('trustedSkip').addEventListener('change', e => {persist({trustedSkip:e.target.checked});render();});
  shadow.getElementById('muteAds').addEventListener('change', e => {persist({muteAds:e.target.checked});syncAdAudio();render();});
  shadow.getElementById('accelerateAds').addEventListener('change', e => {persist({accelerateAds:e.target.checked});apply();});
  input.addEventListener('click', () => choose(1));
  customSpeed.addEventListener('change', () => choose(customSpeed.value));
  customSpeed.addEventListener('keydown', e => {
    if (e.key === 'Enter') {choose(customSpeed.value); customSpeed.blur();}
    e.stopPropagation();
  });
  // Control clicks should not pause the video or trigger player shortcuts.
  for (const type of ['click', 'dblclick', 'pointerdown', 'keyup']) {
    host.addEventListener(type, e => e.stopPropagation());
  }
  function fullscreen() {
    let el = document.fullscreenElement;
    while (el?.shadowRoot?.fullscreenElement) el = el.shadowRoot.fullscreenElement;
    return el;
  }
  function within(parent, node) {
    for (let el=node; el; el=el.parentNode || el.host) if (el===parent) return true;
    return false;
  }
  function area(video) {
    if (!video.isConnected || video.hidden) return 0;
    const fs = fullscreen();
    if (fs && !within(fs, video)) return 0;
    const style = getComputedStyle(video);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return 0;
    const r = video.getBoundingClientRect();
    const width = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const height = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return width * height;
  }
  function position() {
    const fs = fullscreen();
    const rect = active?.getBoundingClientRect();
    const width = host.getBoundingClientRect().width || 115;
    const inset = 8;
    const topInset = 0;
    // Anchor the panel to the video so it does not move to the page header.
    const bar = progressVisibility();
    const visible = bar.visible && active?.isConnected && area(active)>0 && rect.top>=0 &&
      rect.top+topInset+24<=innerHeight && rect.width>=width+inset*2 &&
      fs?.tagName !== 'VIDEO' && (!fs || within(fs,active));
    host.style.setProperty('display', visible ? 'block' : 'none', 'important');
    host.style.setProperty('opacity', String(bar.opacity), 'important');
    if (!visible) {settingsPanel.hidden=true; gear.setAttribute('aria-expanded','false');}
    if (!active) return;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    const base = fs ? fs.getBoundingClientRect() : {left:0,top:0,width:innerWidth,height:innerHeight};
    const scaleX = fs && base.width && fs.clientWidth ? fs.clientWidth/base.width : 1;
    const scaleY = fs && base.height && fs.clientHeight ? fs.clientHeight/base.height : 1;
    host.style.setProperty('position', fs ? 'absolute' : 'fixed', 'important');
    host.style.setProperty('top', ((rect.top-base.top+topInset)*scaleY)+'px', 'important');
    host.style.setProperty('left', ((rect.right-base.left-width-inset)*scaleX)+'px', 'important');
    host.style.setProperty('right', 'auto', 'important');
  }
  function discover(node) {
    if (node === host || node.nodeType !== 1 && node.nodeType !== 11 && node.nodeType !== 9) return;
    if (node.matches?.('video')) candidates.add(node);
    for (const video of node.querySelectorAll('video')) candidates.add(video);
    const elements = node.nodeType === 1 ? [node, ...node.querySelectorAll('*')] : node.querySelectorAll('*');
    for (const el of elements) {
      if (el !== host && el.shadowRoot && !roots.has(el.shadowRoot)) observeRoot(el.shadowRoot);
    }
  }
  function observeRoot(root) {
    const observer = new MutationObserver(records => {
      let changed=false;
      for (const record of records) {
        if (record.target===host || host.contains(record.target)) continue;
        if (record.type==='childList') {
          for (const node of record.addedNodes) discover(node);
          if ([...record.addedNodes,...record.removedNodes].some(n=>n!==host)) changed=true;
        } else changed=true;
      }
      if (changed) {syncAdAudio(); schedule();}
    });
    roots.set(root, observer);
    observer.observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['class','style','hidden','disabled','aria-disabled','aria-hidden','inert']});
    discover(root);
    root.addEventListener('playing', schedule, true);
    root.addEventListener('pause', schedule, true);
  }
  function renderedState(element, boundary) {
    if (!element?.isConnected) return {visible:false,opacity:0};
    const rect=element.getBoundingClientRect();
    if (rect.width<=0 || rect.height<=0) return {visible:false,opacity:0};
    let opacity=1;
    for (let el=element; el; el=el.parentElement) {
      const css=getComputedStyle(el);
      if (el.hidden || css.display==='none' || css.visibility==='hidden' || css.visibility==='collapse') return {visible:false,opacity:0};
      const value=Number.parseFloat(css.opacity);
      if (Number.isFinite(value)) opacity*=value;
      if (opacity<=0.01) return {visible:false,opacity:0};
      if (el===boundary) break;
    }
    return {visible:true,opacity};
  }
  function progressVisibility() {
    const player=active?.closest('.html5-video-player');
    if (!player) return {visible:false,opacity:0};
    let opacity=0;
    for (const bar of player.querySelectorAll('.ytp-progress-bar, .ytp-progress-bar-container, .ytp-ad-progress-list, .ytp-ad-progress')) {
      if (bar.matches('.ytp-progress-bar-container') && bar.querySelector('.ytp-progress-bar')) continue;
      const state=renderedState(bar,player);
      if (state.visible) opacity=Math.max(opacity,state.opacity);
    }
    return {visible:opacity>0.01,opacity};
  }
  function syncVisibility() {
    visibilityFrame=0;
    if (!active?.isConnected || document.hidden) return;
    position();
    visibilityFrame=requestAnimationFrame(syncVisibility);
  }
  function trySkipAd() {
    const player=active?.closest('.html5-video-player');
    if (!player) {lastTrustedReason=trustedGlobalGate(null).reason;lastSkipDiagnostics={adDetected:isAd(),playerFound:false,candidateCount:0,candidates:[],lastTarget:describeLastTarget()};reportSkip(settings.autoSkip ? 'Video player not found.' : 'Disabled in settings.'); return;}
    const targets=new Set();
    const targetMeta=new Map();
    const selector='.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-container, .ytp-ad-skip-button-slot';
    const skipLabel=/^(?:pular(?: (?:anúncio|anúncios|publicidade))?|skip(?: (?:ad|ads|advertisement))?|saltar(?: (?:anuncio|anuncios|publicidad))?)$/i;
    const countdownLabel=/\b(?:skip (?:ad )?in|pular (?:anúncio )?em|saltar en)\b/i;
    const labelOf=button=>((button.getAttribute('aria-label')||'')+' '+button.textContent).replace(/\s+/g,' ').trim();
    function blockedReason(button) {
      for (let el=button; el; el=el.parentElement) {
        if (el.matches(':disabled') || el.getAttribute('aria-disabled')==='true' || el.hidden || el.hasAttribute('inert')) return 'disabled';
        if ((el===button || el.matches(selector)) && countdownLabel.test(labelOf(el))) return 'countdown';
        if (el===player) break;
      }
      return '';
    }
    const initialTrustedGate=trustedGlobalGate(player);
    lastTrustedReason=initialTrustedGate.eligible ? 'no-eligible-target' : initialTrustedGate.reason;
    for (const wrapper of player.querySelectorAll(selector)) {
      const inner=[...wrapper.querySelectorAll('button,[role="button"]')];
      if (inner.length) {
        inner.forEach(button=>{targets.add(button);targetMeta.set(button,{kind:'inner',wrapper,innerCount:inner.length});});
        // A known container can receive the click when its buttons
        // are hidden; blocked states take priority.
        const wrapperBlocked=!!blockedReason(wrapper);
        const childrenBlocked=inner.some(button=>!!blockedReason(button));
        if (!wrapperBlocked && !childrenBlocked && inner.every(button=>!renderedState(button,player).visible)) {targets.add(wrapper);targetMeta.set(wrapper,{kind:'wrapper',wrapper,innerCount:inner.length});}
      } else {targets.add(wrapper);targetMeta.set(wrapper,{kind:'wrapper',wrapper,innerCount:0});}
    }
    // Accessible names cover layouts without a known class.
    for (const button of player.querySelectorAll('button,[role="button"]')) {
      const names=[button.getAttribute('aria-label'),button.textContent];
      if (names.some(name=>skipLabel.test((name||'').replace(/\s+/g,' ').trim()))) {
        targets.add(button);
        if (!targetMeta.has(button)) targetMeta.set(button,{kind:'label',wrapper:null,innerCount:0});
      }
    }
    if (!settings.autoSkip) {updateSkipDiagnostics(player,[...targets],targetMeta,blockedReason);reportSkip('Disabled in settings.'); return;}
    let hidden=0, disabled=0, countdown=0, cooling=0;
    const ordered=[...targets];
    const lastIndex=ordered.indexOf(lastSkipButton);
    if (lastIndex>=0) ordered.push(...ordered.splice(0,lastIndex+1));
    for (const button of ordered) {
      if (!button.isConnected) continue;
      const initialBlock=blockedReason(button);
      if (initialBlock==='disabled') {disabled++; continue;}
      if (initialBlock==='countdown') {countdown++; continue;}
      if (!renderedState(button,player).visible) {hidden++; continue;}
      const now=Date.now();
      const previous=skipAttempts.get(button);
      if (previous && now-previous.time<500) {if (trustedGlobalGate(player).eligible) lastTrustedReason='cooldown';cooling++; continue;}
      if (settings.trustedSkip && trustedPending) {
        lastTrustedReason='pending';
        updateSkipDiagnostics(player,[...targets],targetMeta,blockedReason);
        reportSkip('Chrome click in progress.');
        return;
      }
      const attempts=previous ? previous.attempts+1 : 1;
      skipAttempts.set(button,{time:now,attempts});
      // The service worker receives only the ID. It finds and verifies the button
      // again in the browser before sending any input event.
      const trustGate=trustedTargetGate(button,player);
      lastTrustedReason=trustGate.reason;
      const trustedHit=trustGate.eligible;
      if (trustedHit) {
        trustedPending=true;
        lastSkipButton=button;
        updateSkipDiagnostics(player,[...targets],targetMeta,blockedReason);
        lastSkipAction='Requesting Chrome click; waiting for verification.';
        reportSkip('Verifying the Skip button for a Chrome click.');
        const fallback=reason=>{
          let sent=false;
          try {
            if (settings.autoSkip && button.isConnected && isAd() && !blockedReason(button) && renderedState(button,player).visible) {
              button.click();
              sent=true;
            }
          } catch { /* The target may change while the asynchronous response is pending. */ }
          lastSkipAction=`Chrome click not sent (${reason}); ${sent ? 'DOM click sent' : 'target is no longer available'}.`;
          reportSkip(sent ? 'Chrome click unavailable; DOM click sent.' : 'Chrome click unavailable; button is not available.');
        };
        Promise.resolve().then(()=>chrome.runtime.sendMessage({type:'VIDEO_TURBO_TRUSTED_SKIP',targetId:button.id})).then(result=>{
          if (result?.ok) {
            lastSkipAction='Chrome click sent; waiting for visual confirmation.';
            reportSkip('Chrome click sent. Waiting for the button to disappear.');
          } else {
            fallback(result?.reason||'unavailable');
          }
        }).catch(()=>{
          fallback('communication error');
        }).finally(()=>{trustedPending=false; schedule();});
        return;
      }
      // Synthetic events remain untrusted by the browser; they only
      // accompany the DOM click on a retry.
      if (attempts>1) {
        const rect=button.getBoundingClientRect();
        const options={bubbles:true,cancelable:true,composed:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,button:0};
        for (const type of ['pointerdown','mousedown','pointerup','mouseup']) {
          if (!button.isConnected || blockedReason(button) || !renderedState(button,player).visible) break;
          const EventClass=type.startsWith('pointer') && typeof PointerEvent!=='undefined' ? PointerEvent : MouseEvent;
          button.dispatchEvent(new EventClass(type,{...options,buttons:type.endsWith('down')?1:0,pointerType:'mouse',isPrimary:true}));
        }
      }
      const finalBlock=blockedReason(button);
      const finalVisible=button.isConnected && renderedState(button,player).visible;
      if (!button.isConnected || finalBlock || !finalVisible) {
        lastSkipAction='Attempt stopped before the native click.';
        if (finalBlock==='disabled') disabled++;
        if (finalBlock==='countdown') countdown++;
        if (!finalVisible) hidden++;
        continue;
      }
      button.click();
      lastSkipButton=button;
      updateSkipDiagnostics(player,[...targets],targetMeta,blockedReason);
      lastSkipAction=attempts===1 ? 'Native click sent; waiting for visual confirmation.' : 'Native click and synthetic events sent; waiting for visual confirmation.';
      reportSkip('Button found; click sent. Waiting for the button to disappear.');
      schedule();
      return;
    }
    const reason=countdown ? 'Skip button countdown is active.' : disabled ? 'Skip button is disabled.' : cooling ? 'Waiting to retry.' : hidden ? 'Skip button is hidden.' :
      (isAd() ? 'Ad detected; waiting for an available Skip button.' : 'No available Skip button in the player.');
    updateSkipDiagnostics(player,[...targets],targetMeta,blockedReason);
    reportSkip(reason);
  }
  function trustedGlobalGate(player) {
    if (!settings.trustedSkip) return {eligible:false,reason:'mode-disabled'};
    if (!settings.autoSkip) return {eligible:false,reason:'auto-skip-disabled'};
    if (!player) return {eligible:false,reason:'no-player'};
    if (!isAd()) return {eligible:false,reason:'no-ad'};
    if (document.visibilityState!=='visible') return {eligible:false,reason:'document-hidden'};
    if (player.id!=='movie_player') return {eligible:false,reason:'non-main-player'};
    if (trustedPending) return {eligible:false,reason:'pending'};
    return {eligible:true,reason:'eligible'};
  }
  function trustedTargetGate(button,player) {
    const global=trustedGlobalGate(player);
    if (!global.eligible) return global;
    if (!button || !/^[A-Za-z0-9:_-]{1,80}$/.test(button.id)) return {eligible:false,reason:'invalid-target-id'};
    if (!button.matches('button,[role="button"]')) return {eligible:false,reason:'unsupported-target'};
    try {
      const rect=button.getBoundingClientRect();
      const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      if (!(rect.width>0 && rect.height>0 && x>=0 && y>=0 && x<innerWidth && y<innerHeight)) return {eligible:false,reason:'offscreen'};
      if (typeof document.elementFromPoint!=='function') return {eligible:false,reason:'hit-test-error'};
      const hit=document.elementFromPoint(x,y);
      if (!hit || !button.contains(hit)) return {eligible:false,reason:'covered'};
      return {eligible:true,reason:'eligible'};
    } catch {return {eligible:false,reason:'hit-test-error'};}
  }
  function describeTrustedMode() {
    const global=trustedGlobalGate(active?.closest('.html5-video-player'));
    const reason=!settings.trustedSkip ? 'mode-disabled' : trustedPending ? 'pending' : !settings.autoSkip ? 'auto-skip-disabled' :
      !global.eligible ? global.reason :
      ['mode-disabled','auto-skip-disabled','no-player','no-ad','document-hidden','non-main-player','pending'].includes(lastTrustedReason) ? 'no-eligible-target' : lastTrustedReason;
    return {enabled:settings.trustedSkip,pending:trustedPending,reason};
  }
  function shortText(value, limit=80) {return String(value||'').replace(/\s+/g,' ').trim().slice(0,limit);}
  function describeElement(element) {
    if (!element || element.nodeType!==1) return null;
    return {tag:shortText(element.tagName,16).toLowerCase(),id:shortText(element.id,60),classes:shortText(element.getAttribute('class'),80)};
  }
  function describeLastTarget() {
    const target=describeElement(lastSkipButton);
    if (!target) return null;
    const previous=skipAttempts.get(lastSkipButton);
    return {...target,attempts:previous?.attempts||0};
  }
  function updateSkipDiagnostics(player,targets,targetMeta,blockedReason) {
    const selector='.ytp-ad-skip-button-modern, .ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-container, .ytp-ad-skip-button-slot';
    const knownLabels=/^(?:pular(?: (?:anúncio|anúncios|publicidade))?|skip(?: (?:ad|ads|advertisement))?|saltar(?: (?:anuncio|anuncios|publicidad))?)$/i;
    const hitIsKnown=element=>{
      for(let node=element;node && node!==player.parentElement;node=node.parentElement) {
        try {if(node.matches?.(selector)) return true;} catch {}
        if(node.matches?.('button,[role="button"]')) {
          const label=shortText(node.getAttribute('aria-label')||node.textContent,100);
          if(knownLabels.test(label)) return true;
        }
        if(node===player) break;
      }
      return false;
    };
    const entries=targets.slice(0,12).map(element=>{
      const meta=targetMeta.get(element)||{kind:'label',wrapper:null,innerCount:0};
      let label='';
      try {label=shortText((element.getAttribute('aria-label')||'')+' '+element.textContent,100);} catch {}
      let reason='';
      try {reason=blockedReason(element);} catch {}
      let visible=false;
      try {visible=!!element.isConnected && renderedState(element,player).visible;} catch {}
      let cooldown=false,attempts=0;
      try {const previous=skipAttempts.get(element);attempts=previous?.attempts||0;cooldown=!!previous && Date.now()-previous.time<500;} catch {}
      let hit=null;
      try {
        if(typeof document.elementFromPoint==='function' && element.isConnected) {
          const rect=element.getBoundingClientRect();
          const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
          const hitElement=document.elementFromPoint(x,y);
          const descriptor=describeElement(hitElement);
          if(descriptor) hit={...descriptor,belongsToCandidate:hitElement===element || within(element,hitElement),knownSkipControl:hitIsKnown(hitElement)};
        }
      } catch {}
      const wrap=meta.wrapper===element ? null : describeElement(meta.wrapper);
      return {...describeElement(element),label,visible,disabled:reason==='disabled',countdown:reason==='countdown',cooldown,attempts,kind:meta.kind,wrapper:wrap,innerCount:meta.innerCount,hit};
    });
    const candidateCount=targets.length;
    lastSkipDiagnostics={adDetected:isAd(),playerFound:true,candidateCount,candidates:entries.slice(0,12),lastTarget:describeLastTarget()};
  }
  function reportSkip(message) {
    if (message===lastSkipStatus) return;
    lastSkipStatus=message;

  }
  function scan() {
    frame = 0;
    if (!ready) return;
    for (const video of candidates) if (!video.isConnected) candidates.delete(video);
    if (preferred && !candidates.has(preferred)) preferred=null;
    for (const [root, observer] of roots) if (root.host && !root.host.isConnected) {
      observer.disconnect(); roots.delete(root);
    }
    const videos = [...candidates];
    const visible = videos.filter(v => area(v) > 0);
    visible.sort((a,b) => Number(a.paused) - Number(b.paused) || area(b)-area(a));
    const main = location.pathname==='/watch' ? videos.find(v=>v.closest('#movie_player')) : null;
    const next = main || (preferred && visible.includes(preferred) ? preferred : visible[0] || (active?.isConnected ? active : null));
    if (next !== active) {
      active = next;
      if (active) apply(); else host.remove();
    }
    syncAdAudio();
    for (const video of videos) {
      if (attached.has(video)) continue;
      attached.add(video);
      video.addEventListener('loadedmetadata', () => {schedule(); if(video === active) apply();});
      video.addEventListener('playing', () => {preferred=video; schedule(); if(video === active) apply();});
      video.addEventListener('pointerdown', () => {preferred=video; schedule();}, true);
      video.addEventListener('ratechange', () => {
        if (video !== active) return;
        // Ads and their transitions may reset the player to 1×.
        // Nesses momentos preservamos a escolha feita nos nossos controles.
        if (isAd() || adBefore || adSettling || navigating) {apply(); return;}
        const n = video.playbackRate;
        if (Number.isFinite(n) && n >= 0.25 && n <= 16 && Math.abs(n-desired)>0.001) {
          desired = clamp(n);
          if (settings.remember) persist({speed: desired});
          render();
        }
      });
    }
    const adNow = isAd();
    if (adNow !== adBefore) {
      adBefore = adNow;
      adSettling = true;
      clearTimeout(adTimer);
      apply();
      adTimer = setTimeout(() => {apply(); adSettling=false;}, 800);
    }
    render();
    if (!visibilityFrame && active && !document.hidden) visibilityFrame=requestAnimationFrame(syncVisibility);
    trySkipAd();
  }
  function schedule() {if (!frame) frame = requestAnimationFrame(scan);}
  document.addEventListener('keydown', e => {
    const path = e.composedPath();
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || path.some(el => el === host || el?.matches?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))) return;
    if (!active?.isConnected) return;
    let action;
    if (!e.altKey && ['+', '='].includes(e.key)) action = () => adjust(settings.step);
    if (!e.altKey && ['-', '_'].includes(e.key)) action = () => adjust(-settings.step);
    if (action) {e.preventDefault(); e.stopImmediatePropagation(); action();}
  }, true);
  chrome.runtime?.onMessage?.addListener((message,sender,respond)=>{
    if (message?.type==='VIDEO_TURBO_SKIP_STATUS') respond({version:SCRIPT_VERSION,status:lastSkipStatus || 'Waiting for player.',lastAction:lastSkipAction,diagnostics:{...lastSkipDiagnostics,trustedMode:describeTrustedMode()}});
  });
  observeRoot(document);
  document.addEventListener('yt-navigate-start', () => {
    navigating = true;
    audioSuspendedPlayer=active?.closest('.html5-video-player') || adAudio?.player || null;
    clearTimeout(navigationTimer);
    restoreAdAudio();
  });
  document.addEventListener('yt-navigate-finish', () => {
    audioSuspendedPlayer=null;
    syncAdAudio();
    schedule(); apply();
    clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => {apply(); navigating=false;}, 800);
  });
  document.addEventListener('visibilitychange', () => {syncAdAudio(); schedule();});
  document.addEventListener('fullscreenchange', () => {schedule(); apply();});
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, {passive:true, capture:true});
  // Update the position in animated players and detect shadow roots created later.
  let discoveryTick=0;
  setInterval(() => {
    if (document.hidden) return;
    if (++discoveryTick % 8 === 0) discover(document);
    if (active || candidates.size) schedule();
  }, 250);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if(areaName !== 'local' || !Object.keys(defaults).some(key=>changes[key])) return;
    for(const key of Object.keys(defaults)) if(changes[key]) settings[key] = changes[key].newValue ?? defaults[key];
    settings.step = Number(settings.step) > 0 && Number(settings.step) <= 1 ? Number(settings.step) : 0.25;
    if(changes.speed && settings.remember && Number.isFinite(Number(settings.speed))) desired = clamp(Number(settings.speed));
    apply();
  });
  chrome.storage.local.get(defaults).then(saved => {
    settings = saved;
    settings.step = Number(saved.step)>0 && Number(saved.step)<=1 ? Number(saved.step) : 0.25;
    desired = saved.remember && Number.isFinite(Number(saved.speed)) ? clamp(Number(saved.speed)) : 1;
  }).catch(() => {}).finally(() => {ready=true; syncAdAudio(); schedule();});
})();
