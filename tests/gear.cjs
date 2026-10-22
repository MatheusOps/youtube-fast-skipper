const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8');
const version=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8')).version;

async function fixture(saved={}, {adShowing=false,controls=''}={}) {
  const adClass=adShowing?' ad-showing':'';
  const dom=new JSDOM(`<!doctype html><div id="movie_player" class="html5-video-player${adClass}"><video></video>${controls}</div>`,{
    url:'https://www.youtube.com/watch?v=gear-test',runScripts:'outside-only',pretendToBeVisual:true
  });
  const w=dom.window;
  w.innerWidth=1280;w.innerHeight=720;
  w.queue=[];
  w.requestAnimationFrame=fn=>{w.queue.push(fn);return w.queue.length;};
  w.setInterval=()=>1;w.setTimeout=()=>1;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return this.tagName==='VIDEO'?{left:0,top:0,right:640,bottom:360,width:640,height:360}:{left:10,top:10,right:160,bottom:50,width:150,height:40};};
  let onChanged;
  const writes=[];
  w.chrome={
    runtime:{onMessage:{addListener(fn){w.messageListener=fn;}},sendMessage:async()=>({ok:false,reason:'test'})},
    storage:{local:{get:async defaults=>({...defaults,...saved}),set:async patch=>{writes.push({...patch});}},onChanged:{addListener(fn){onChanged=fn;}}}
  };
  w.eval(source);
  for(let i=0;i<10;i++) await Promise.resolve();
  const scanIndex=w.queue.findIndex(fn=>fn.name==='scan');
  assert.ok(scanIndex>=0,'startup schedules a scan');
  w.queue.splice(scanIndex,1)[0]();
  for(let i=0;i<4;i++) await Promise.resolve();
  const host=w.document.getElementById('video-turbo-controls');
  assert.ok(host?.shadowRoot,'in-video controls should be mounted');
  return {w,shadow:host.shadowRoot,writes,fireChange(changes){onChanged(changes,'local');}};
}

(async()=>{
  const h=await fixture();
  const trusted=h.shadow.getElementById('trustedSkip');
  assert.ok(trusted,'the in-video gear includes the Chrome click option');
  assert.equal(trusted.checked,true,'the Chrome click option starts enabled');
  const mute=h.shadow.getElementById('muteAds');
  assert.equal(mute.checked,true,'ad muting starts enabled');
  assert.equal(h.shadow.getElementById('autoSkip').checked,true);
  assert.equal(h.shadow.getElementById('remember').checked,true);

  trusted.checked=false;
  trusted.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.deepEqual(h.writes.at(-1),{trustedSkip:false},'turning off persists a boolean setting');
  trusted.checked=true;
  trusted.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.deepEqual(h.writes.at(-1),{trustedSkip:true},'turning on persists a boolean setting');
  let response;
  h.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>response=value);
  assert.equal(response.diagnostics.trustedMode.enabled,true);
  assert.equal(response.diagnostics.trustedMode.reason,'no-ad','the current page gate is reflected immediately');
  assert.equal(h.shadow.getElementById('autoSkip').checked,true,'other controls stay unchanged');
  assert.equal(h.shadow.getElementById('remember').checked,true,'other controls stay unchanged');

  h.fireChange({trustedSkip:{newValue:true}});
  assert.equal(trusted.checked,true,'Chrome storage changes update the gear checkbox');
  h.fireChange({autoSkip:{newValue:false}});
  assert.equal(h.shadow.getElementById('autoSkip').checked,false);
  h.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>response=value);
  assert.equal(response.diagnostics.trustedMode.reason,'auto-skip-disabled','the existing auto skip guard is visible immediately');
  h.fireChange({autoSkip:{newValue:true}});
  h.fireChange({trustedSkip:{newValue:false}});
  assert.equal(trusted.checked,false,'Chrome storage can turn the option back off');
  h.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>response=value);
  assert.equal(response.diagnostics.trustedMode.enabled,false);
  assert.equal(response.diagnostics.trustedMode.reason,'mode-disabled','turning the option off refreshes its gate immediately');
  assert.equal(h.shadow.getElementById('autoSkip').checked,true);
  assert.equal(h.shadow.getElementById('remember').checked,true);

  trusted.checked=true;
  trusted.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  h.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>response=value);
  assert.equal(response.diagnostics.trustedMode.reason,'no-ad','turning the option back on refreshes the gate immediately');
  trusted.checked=false;
  trusted.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  h.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>response=value);
  assert.equal(response.version,version);
  assert.deepEqual(JSON.parse(JSON.stringify(response.diagnostics.trustedMode)),{enabled:false,pending:false,reason:'mode-disabled'});
  const savedOn=await fixture({trustedSkip:true});
  let savedResponse;
  savedOn.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>savedResponse=value);
  assert.equal(savedResponse.diagnostics.trustedMode.enabled,true);
  assert.equal(savedResponse.diagnostics.trustedMode.reason,'no-ad','a saved enabled setting reports the current page gate');

  const noTarget=await fixture({trustedSkip:true},{adShowing:true});
  let noTargetResponse;
  noTarget.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>noTargetResponse=value);
  assert.equal(noTargetResponse.diagnostics.trustedMode.reason,'no-eligible-target','an ad with no skip controls does not appear ready');
  const disabledTarget=await fixture({trustedSkip:true},{adShowing:true,controls:'<button id="skip" class="ytp-ad-skip-button" disabled>Pular</button>'});
  let disabledResponse;
  disabledTarget.w.messageListener({type:'VIDEO_TURBO_SKIP_STATUS'},null,value=>disabledResponse=value);
  assert.equal(disabledResponse.diagnostics.trustedMode.reason,'no-eligible-target','a disabled skip control does not appear ready');
  const savedOff=await fixture({trustedSkip:false,muteAds:false});
  assert.equal(savedOff.shadow.getElementById('trustedSkip').checked,false);
  assert.equal(savedOff.shadow.getElementById('muteAds').checked,false);
  mute.checked=false;
  mute.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.deepEqual(h.writes.at(-1),{muteAds:false});
  h.fireChange({muteAds:{newValue:true}});
  assert.equal(mute.checked,true,'muting follows external storage updates');
  console.log('in-video trusted setting and status gate: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
