const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const testedSourcePath = path.join(__dirname, '..', 'content.js');
const source = fs.readFileSync(testedSourcePath, 'utf8');
function setup(body, saved={}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="movie_player" class="html5-video-player ad-showing"><video></video>${body}</div></body></html>`, {url:'https://www.youtube.com/watch?v=test', runScripts:'outside-only'});
  const {window:w} = dom;
  let now=1000;
  w.Date.now=()=>now;
  w.advance=ms=>{now+=ms;};
  w.requestAnimationFrame=fn=>{w.queue.push(fn);return w.queue.length;};
  w.queue=[];
  w.setInterval=()=>1;
  w.clearInterval=()=>{};
  w.setTimeout=()=>1;
  w.clearTimeout=()=>{};
  w.innerWidth=1280;w.innerHeight=720;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return this.tagName==='VIDEO'?{left:0,top:0,right:640,bottom:360,width:640,height:360}:{left:10,top:10,right:160,bottom:50,width:150,height:40};};
  let storageListener;
  w.chrome={runtime:{onMessage:{addListener(fn){w.messageListener=fn;} }},storage:{local:{get:async defaults=>({...defaults,trustedSkip:false,...saved}),set:async patch=>{Object.assign(saved,patch);}},onChanged:{addListener(fn){storageListener=fn;}}}};
  w.eval(source);
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();const index=w.queue.findIndex(fn=>fn.name==='scan');if(index<0)throw new Error('scheduled scan was not queued');const [scan]=w.queue.splice(index,1);scan();};
  const rescan=async()=>{const player=w.document.querySelector('#movie_player');player.classList.toggle('rescan');await flush();};
  const clickCount=el=>Number(el.dataset.clicks||0);
  const countClicks=selector=>{const el=w.document.querySelector(selector);el.addEventListener('click',()=>el.dataset.clicks=String(clickCount(el)+1));return el;};
  const getStatus=()=>{let result;w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,v=>result=v);return result;};
  return {dom,w,advance:ms=>{now+=ms;},flush,rescan,clickCount,countClicks,getStatus,getSaved:()=>saved,storageChanged:changes=>storageListener(changes,'local')};
}
async function wrapperFallback(){
  const h=setup('<div class="ytp-ad-skip-button-modern" id="wrap"><button id="dead" style="display:none">Pular</button></div>');
  const wrap=h.countClicks('#wrap'),dead=h.countClicks('#dead');
  await h.flush();assert.equal(h.clickCount(wrap),1,'known skip container should receive click when its only child is hidden');assert.equal(h.clickCount(dead),0,'hidden child must not receive click');
}
async function cooldownAndRetryFairness(){
  const h=setup('<button id="stale" aria-label="Skip ad">Skip ad</button><button id="real" aria-label="Skip ad">Skip ad</button>');
  const stale=h.countClicks('#stale'),real=h.countClicks('#real');
  await h.flush();assert.equal(h.clickCount(stale),1);
  h.advance(100);await h.rescan();assert.equal(h.clickCount(stale),1);assert.equal(h.clickCount(real),1,'a cooling first target must not starve a later eligible candidate');
  h.advance(600);await h.rescan();
  assert.equal(h.clickCount(real),1,'retry cooldown must not keep an unresponsive first target ahead of later candidates');
  assert.equal(h.clickCount(stale),2,'round-robin retry may revisit the earlier candidate once its 500ms cooldown passes');
}
async function countdownAndDisabledProtection(){
  const h=setup('<div class="ytp-ad-skip-button-modern" id="count" aria-label="Pular anúncio em 5 segundos"><button id="count-inner">Pular anúncio em 5 segundos</button></div><div class="ytp-ad-skip-button-container" id="parent-count" aria-label="Skip ad in 5 seconds"><button class="ytp-ad-skip-button-modern" id="parent-count-inner" aria-label="Skip ad">Skip ad</button></div><div class="ytp-ad-skip-button" id="blocked" aria-disabled="true"><button id="blocked-inner" disabled>Pular</button></div>');
  for(const selector of ['#count','#count-inner','#parent-count','#parent-count-inner','#blocked','#blocked-inner'])h.countClicks(selector);
  await h.flush();
  assert.equal(h.clickCount(h.w.document.querySelector('#count')),0);assert.equal(h.clickCount(h.w.document.querySelector('#parent-count-inner')),0);
  assert.equal(h.clickCount(h.w.document.querySelector('#blocked')),0);
  assert.equal(h.clickCount(h.w.document.querySelector('#blocked-inner')),0);
  assert.match(h.getStatus().status,/countdown is active/);
}
async function normalizedAccessibleName(){
  const h=setup('<button class="unrelated" id="spaced" aria-label="  Skip   ad  "></button>');
  const button=h.countClicks('#spaced');await h.flush();
  assert.equal(h.clickCount(button),1,'whitespace-normalized accessible names should match');
}
async function pendingStatusAndVersion(){
  const h=setup('<button class="unrelated" id="skip" aria-label="Pular anúncio"></button>');
  h.countClicks('#skip');await h.flush();const result=h.getStatus();
  const manifestPath=path.join(path.dirname(testedSourcePath),'manifest.json');
  assert.equal(result.version,JSON.parse(fs.readFileSync(manifestPath,'utf8')).version);
  assert.match(result.status,/Waiting for the button to disappear/,'a sent click must remain pending until the candidate disappears');
}
async function diagnosticCandidateIdentityAndHitTarget(){
  const h=setup('<div id="skip-wrap" class="ytp-ad-skip-button-modern"><button id="skip" aria-label="Pular anúncio">Pular</button></div>');
  const button=h.countClicks('#skip');
  const overlay=h.w.document.createElement('div');overlay.id='overlay';overlay.className='video-surface';
  h.w.document.body.append(overlay);
  h.w.document.elementFromPoint=()=>overlay;
  await h.flush();
  const diagnostics=h.getStatus().diagnostics;
  assert.equal(diagnostics.adDetected,true);
  assert.equal(diagnostics.playerFound,true);
  assert.equal(diagnostics.candidateCount,1);
  assert.equal(diagnostics.candidates[0].tag,'button');
  assert.equal(diagnostics.candidates[0].id,'skip');
  assert.equal(diagnostics.candidates[0].classes,'');
  assert.equal(diagnostics.candidates[0].visible,true);
  assert.equal(diagnostics.candidates[0].kind,'inner');
  assert.equal(diagnostics.candidates[0].wrapper.id,'skip-wrap');
  assert.equal(diagnostics.candidates[0].hit.tag,'div');
  assert.equal(diagnostics.candidates[0].hit.id,'overlay');
  assert.equal(diagnostics.candidates[0].hit.classes,'video-surface');
  assert.equal(diagnostics.candidates[0].hit.belongsToCandidate,false);
  assert.equal(diagnostics.candidates[0].hit.knownSkipControl,false);
  assert.equal(diagnostics.lastTarget.id,'skip');
  assert.equal(diagnostics.lastTarget.attempts,1);
  assert.equal(h.clickCount(button),1);
}
async function diagnosticLimitsAndCandidateKinds(){
  const markup=Array.from({length:14},(_,index)=>`<button id="skip-${index}" aria-label="Skip ad">skip</button>`).join('')+
    '<div id="wrap" class="ytp-ad-skip-button-modern"><button id="inner">Pular</button></div><button id="unrelated" aria-label="Skip ad please">Other</button>';
  const h=setup(markup,{autoSkip:false});
  h.w.document.elementFromPoint=()=>null;
  await h.flush();
  const diagnostics=h.getStatus().diagnostics;
  assert.equal(diagnostics.candidateCount,15,'exact skip labels are recognized while near matches are excluded');
  assert.equal(diagnostics.candidates.length,12,'candidate details are capped at twelve');
  const wrapped=diagnostics.candidates.find(candidate=>candidate.id==='inner');
  assert.ok(wrapped,'recognized inner button appears in diagnostics even with auto skip disabled');
  assert.equal(wrapped.kind,'inner');
  assert.equal(wrapped.wrapper.id,'wrap');
  assert.equal(wrapped.innerCount,1);
  assert.ok(wrapped.label.length<=100);
}
async function diagnosticBlockedStatesAndMissingHitTest(){
  const h=setup('<button id="disabled" class="ytp-ad-skip-button" disabled>Skip ad</button><button id="countdown" class="ytp-ad-skip-button-modern" aria-label="Pular anúncio em 5 segundos">Pular</button><button id="retry" aria-label="Skip ad">Skip ad</button>');
  await h.flush();
  let diagnostics=h.getStatus().diagnostics;
  const disabled=diagnostics.candidates.find(candidate=>candidate.id==='disabled');
  const countdown=diagnostics.candidates.find(candidate=>candidate.id==='countdown');
  assert.equal(disabled.disabled,true);
  assert.equal(countdown.countdown,true);
  assert.ok(diagnostics.candidates.every(candidate=>candidate.hit===null),'missing elementFromPoint is handled without throwing');
  h.advance(600);await h.rescan();
  diagnostics=h.getStatus().diagnostics;
  const retry=diagnostics.candidates.find(candidate=>candidate.id==='retry');
  assert.equal(retry.attempts,2);
}
async function diagnosticRetainsRemovedLastTargetSafely(){
  const h=setup('<button id="skip" aria-label="Skip ad">Skip ad</button>');
  await h.flush();
  h.w.document.querySelector('#skip').remove();
  await h.rescan();
  const diagnostics=h.getStatus().diagnostics;
  assert.equal(diagnostics.candidateCount,0);
  assert.equal(diagnostics.candidates.length,0);
  assert.equal(diagnostics.lastTarget.id,'skip');
  assert.equal(diagnostics.lastTarget.attempts,1);
}
async function retryEventsRemainUntrustedAndOrdered(){
  const h=setup('<button id="skip" aria-label="Skip ad">Skip ad</button>');
  const button=h.countClicks('#skip'),events=[];
  const trust=[];for(const type of ['pointerdown','mousedown','pointerup','mouseup'])button.addEventListener(type,event=>{events.push(type);trust.push(event.isTrusted);});
  await h.flush();h.advance(600);await h.rescan();
  assert.deepEqual(events,['pointerdown','mousedown','pointerup','mouseup']);
  assert.deepEqual(trust,[false,false,false,false],'synthetic pointer and mouse events are untrusted');
  assert.equal(h.clickCount(button),2);
  assert.match(h.getStatus().lastAction,/synthetic events/);
}
async function retryStopsWhenPointerHandlerDisablesButton(){
  const h=setup('<button id="skip" aria-label="Skip ad">Skip ad</button>');
  const button=h.countClicks('#skip'),events=[];
  button.addEventListener('pointerdown',()=>{events.push('pointerdown');if(h.clickCount(button)>0)button.disabled=true;});
  for(const type of ['mousedown','pointerup','mouseup'])button.addEventListener(type,()=>events.push(type));
  await h.flush();h.advance(600);await h.rescan();
  assert.equal(h.clickCount(button),1,'a disabled button must not receive the final native click');
  assert.deepEqual(events,['pointerdown'],'later synthetic events must stop when pointerdown changes the button');
  assert.match(h.getStatus().status,/disabled/);
  assert.match(h.getStatus().lastAction,/stopped before the native click/);
}
async function retryStopsWhenPointerHandlerHidesButton(){
  const h=setup('<button id="skip" aria-label="Skip ad">Skip ad</button>');
  const button=h.countClicks('#skip'),events=[];
  button.addEventListener('pointerdown',()=>{events.push('pointerdown');if(h.clickCount(button)>0)button.style.display='none';});
  for(const type of ['mousedown','pointerup','mouseup'])button.addEventListener(type,()=>events.push(type));
  await h.flush();h.advance(600);await h.rescan();
  assert.equal(h.clickCount(button),1,'a hidden button must not receive the final native click');
  assert.deepEqual(events,['pointerdown'],'later synthetic events must stop when pointerdown hides the button');
  assert.match(h.getStatus().status,/hidden/);
  assert.match(h.getStatus().lastAction,/stopped before the native click/);
}
async function disabledSetting(){
  const h=setup('<button id="own" aria-label="Skip ad">Skip ad</button>',{autoSkip:false});
  const own=h.countClicks('#own');await h.flush();
  assert.equal(h.clickCount(own),0);assert.match(h.getStatus().status,/Disabled/);
}
async function outsidePlayerIgnored(){
  const h=setup('<button id="own" aria-label="Skip ad">Skip ad</button>');
  const outside=h.w.document.createElement('div');outside.className='html5-video-player';outside.innerHTML='<button id="other" aria-label="Skip ad">Skip ad</button>';h.w.document.body.append(outside);
  const own=h.countClicks('#own'),other=h.countClicks('#other');await h.flush();
  assert.equal(h.clickCount(own),1);assert.equal(h.clickCount(other),0);
}
async function preferredSpeedRestoredAfterAd(){
  const h=setup('',{speed:1.5,remember:true});const video=h.w.document.querySelector('video');
  await h.flush();assert.equal(video.playbackRate,16);
  h.w.document.querySelector('#movie_player').classList.remove('ad-showing');await h.rescan();
  assert.equal(video.playbackRate,1.5);
}
async function adAccelerationPreferenceAndLiveToggle(){
  let h=setup('',{speed:1.5,remember:true});let video=h.w.document.querySelector('video');
  await h.flush();
  let controls=h.w.document.getElementById('video-turbo-controls').shadowRoot;
  let toggle=controls.getElementById('accelerateAds');
  assert.equal(toggle.checked,true,'acceleration is enabled by default');
  assert.equal(video.playbackRate,16);
  assert.equal(controls.getElementById('speed').value,'16');
  assert.match(controls.querySelector('.status').textContent,/Ad 16×/);
  toggle.click();
  assert.equal(video.playbackRate,1,'turning acceleration off applies 1× during the active ad');
  assert.equal(controls.getElementById('speed').value,'1');
  assert.match(controls.querySelector('.status').textContent,/Ad 1×/);
  assert.equal(h.getSaved().accelerateAds,false,'turning acceleration off saves the preference');
  toggle.click();
  assert.equal(h.getSaved().accelerateAds,true,'turning acceleration on saves the preference');
  assert.equal(video.playbackRate,16,'turning acceleration back on applies 16× during the active ad');
  assert.equal(video.defaultPlaybackRate,1.5,'temporary ad speed never replaces the desired speed');
  h.w.document.querySelector('#movie_player').classList.remove('ad-showing');await h.rescan();
  assert.equal(video.playbackRate,1.5,'the desired speed returns after the ad');

  h=setup('',{speed:1.75,remember:true,accelerateAds:false});video=h.w.document.querySelector('video');await h.flush();
  controls=h.w.document.getElementById('video-turbo-controls').shadowRoot;
  assert.equal(controls.getElementById('accelerateAds').checked,false,'an explicit opt-out is loaded');
  assert.equal(video.playbackRate,1,'explicit opt-out keeps the ad at normal speed');
  assert.match(controls.getElementById('speed').title,/Ad speed: 1×/);
  h.w.document.querySelector('#movie_player').classList.remove('ad-showing');await h.rescan();
  assert.equal(video.playbackRate,1.75,'the saved desired speed returns after a normal-speed ad');
}
async function visibleChildInsideZeroSizeWrapper(){
  const h=setup('<div class="ytp-ad-skip-button-modern" id="wrap"><button id="child">Pular</button></div>');
  h.w.document.querySelector('#wrap').getBoundingClientRect=()=>({left:0,top:0,right:0,bottom:0,width:0,height:0});
  const child=h.countClicks('#child');await h.flush();assert.equal(h.clickCount(child),1,'a visible child remains eligible even when its wrapper has no layout box');
}
(async()=>{let failed=0;for(const [name,test] of [['wrapper fallback',wrapperFallback],['retry fairness after 600ms',cooldownAndRetryFairness],['countdown and disabled protection',countdownAndDisabledProtection],['normalized accessible name',normalizedAccessibleName],['pending status and version',pendingStatusAndVersion],['diagnostic candidate identity and hit target',diagnosticCandidateIdentityAndHitTarget],['diagnostic limits and candidate kinds',diagnosticLimitsAndCandidateKinds],['diagnostic blocked states and missing hit test',diagnosticBlockedStatesAndMissingHitTest],['diagnostic removed last target',diagnosticRetainsRemovedLastTargetSafely],['retry event order',retryEventsRemainUntrustedAndOrdered],['disable during retry',retryStopsWhenPointerHandlerDisablesButton],['hide during retry',retryStopsWhenPointerHandlerHidesButton],['auto skip setting',disabledSetting],['outside player scope',outsidePlayerIgnored],['speed restore after ad',preferredSpeedRestoredAfterAd],['ad acceleration defaults and live toggle',adAccelerationPreferenceAndLiveToggle],['visible child in zero-size wrapper',visibleChildInsideZeroSizeWrapper]]){try{await test();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name,error.message);}}if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
