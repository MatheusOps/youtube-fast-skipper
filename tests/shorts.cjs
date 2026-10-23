const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const source=fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8');

async function fixture({url='https://www.youtube.com/shorts/one',cards=[],saved={}}={}) {
  const markup=cards.map((card,index)=>`<ytd-reel-video-renderer id="${card.id||`card${index}`}" ${card.attrs||''} ${card.style||''}><div class="html5-video-player ${card.playerClass||''}"><video id="${card.video||`video${index}`}" ${card.videoStyle||''}></video></div></ytd-reel-video-renderer>`).join('');
  const dom=new JSDOM(`<!doctype html><body>${markup}</body>`,{url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.innerWidth=1280;w.innerHeight=720;
  w.queue=[];
  w.requestAnimationFrame=fn=>{w.queue.push(fn);return w.queue.length;};
  w.setInterval=()=>1;w.setTimeout=()=>1;w.clearTimeout=()=>{};
  const rects=new Map();
  for(const [i,card] of cards.entries()) {
    const id=card.video||`video${i}`;
    rects.set(id,card.rect||{left:100,top:i*400,right:460,bottom:i*400+640,width:360,height:640});
    if(card.clipRect)rects.set(card.id||`card${i}`,card.clipRect);
  }
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    if(rects.has(this.id))return rects.get(this.id);
    if(this.id==='video-turbo-controls')return {left:0,top:0,right:115,bottom:24,width:115,height:24};
    return {left:0,top:0,right:1280,bottom:720,width:1280,height:720};
  };
  const writes=[];
  let onChanged;
  w.chrome={runtime:{onMessage:{addListener(){}}},storage:{local:{get:async defaults=>({...defaults,...saved}),set:async patch=>{writes.push({...patch});}},onChanged:{addListener(fn){onChanged=fn;}}}};
  w.eval(source);
  const flushMicrotasks=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const scan=async()=>{
    await flushMicrotasks();
    const index=w.queue.findIndex(fn=>fn.name==='scan');
    if(index>=0)w.queue.splice(index,1)[0]();
    await flushMicrotasks();
  };
  await scan();
  const host=w.document.getElementById('video-turbo-controls');
  assert.ok(host?.shadowRoot,'speed controls mount on the page');
  return {w,host,shadow:host.shadowRoot,writes,rects,scan,flushMicrotasks,fireChange(changes){onChanged(changes,'local');}};
}

(async()=>{
  let h=await fixture({cards:[{attrs:'is-active="true"'}]});
  let video=h.w.document.getElementById('video0');
  assert.equal(video.playbackRate,1,'the initial Short is controlled without a standard progress bar');
  assert.equal(h.host.style.display,'block','Shorts controls can appear without a progress bar');
  assert.equal(h.host.style.opacity,'1','Shorts controls stay visible without a progress bar opacity source');
  const plus=h.shadow.getElementById('plus'),minus=h.shadow.getElementById('minus'),speed=h.shadow.getElementById('speed'),custom=h.shadow.getElementById('customSpeed');
  plus.click();
  assert.equal(video.playbackRate,1.25,'the plus control changes Short speed');
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'+',bubbles:true,cancelable:true}));
  assert.equal(video.playbackRate,1.5,'the keyboard shortcut changes Short speed');
  minus.click();
  assert.equal(video.playbackRate,1.25,'the minus control changes Short speed');
  custom.value='2.5';custom.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.equal(video.playbackRate,2.5,'custom speed applies to Shorts');
  assert.deepEqual(h.writes.at(-1),{speed:2.5},'chosen speed follows the existing remember setting');
  speed.click();
  assert.equal(video.playbackRate,1,'the center control restores 1×');

  h=await fixture({cards:[{}, {attrs:'is-active="true"'}],saved:{speed:1.75}});
  video=h.w.document.getElementById('video1');
  assert.equal(video.playbackRate,1.75,'saved speed applies to the explicitly active card');
  h.w.document.getElementById('video0').dispatchEvent(new h.w.Event('playing'));
  await h.scan();
  assert.equal(h.w.document.getElementById('video1').playbackRate,1.75,'a stale preferred video does not beat the active card');

  h=await fixture({cards:[{attrs:'is-active="false"'}, {attrs:'active'}],saved:{speed:2}});
  assert.equal(h.w.document.getElementById('video1').playbackRate,2,'a bare active attribute selects its card');
  assert.equal(h.w.document.getElementById('video0').playbackRate,1,'is-active=false is ignored');

  h=await fixture({cards:[{attrs:'is-active="false"'}, {attrs:'is-active="false"'}],saved:{speed:2}});
  assert.equal(h.w.document.getElementById('video0').playbackRate,2,'viewport area selects the visible fallback card');
  assert.equal(h.w.document.getElementById('video1').playbackRate,1,'offscreen preloaded cards are not selected');

  h=await fixture({cards:[{attrs:'is-active="false"'}, {attrs:'is-active="false"'}],saved:{speed:2}});
  const stale=h.w.document.getElementById('video1');
  Object.defineProperty(stale,'paused',{value:false,configurable:true});
  stale.dispatchEvent(new h.w.Event('playing'));
  await h.scan();
  assert.equal(h.w.document.getElementById('video0').playbackRate,2,'a playing stale Short cannot beat the largest visible card');
  assert.equal(stale.playbackRate,1);

  h=await fixture({cards:[{attrs:'class="active" is-active="false"'}, {}],saved:{speed:2}});
  assert.equal(h.w.document.getElementById('video1').playbackRate,2,'an explicit false marker overrides a stale active class when falling back');

  h=await fixture({cards:[{attrs:'is-active="false"',style:'style="display:none"'}, {attrs:'is-active="false"'}],saved:{speed:2}});
  assert.equal(h.w.document.getElementById('video1').playbackRate,2,'a video under a hidden ancestor does not win viewport fallback');

  h=await fixture({cards:[{attrs:'is-active="true"',rect:{left:100,top:-20,right:460,bottom:620,width:360,height:640}}]});
  assert.equal(h.host.style.display,'block','a Short partially clipped at the viewport top can still show controls');
  assert.equal(h.host.style.top,'0px','controls stay within the visible clipped portion of the Short');

  h=await fixture({cards:[{attrs:'is-active="true"',style:'style="overflow:hidden"',rect:{left:80,top:80,right:460,bottom:720,width:380,height:640},clipRect:{left:100,top:100,right:350,bottom:500,width:250,height:400}}]});
  assert.equal(h.host.style.display,'block','controls remain eligible inside a clipped carousel card');
  assert.equal(h.host.style.top,'100px','controls respect the card clip top');
  assert.equal(Number.parseFloat(h.host.style.left)+115,342,'controls keep the existing 8px inset inside the clipped card');

  h=await fixture({cards:[{attrs:'is-active="false"'}, {attrs:'is-active="false"'}],saved:{speed:1.5}});
  const first=h.w.document.getElementById('card0'),second=h.w.document.getElementById('card1');
  first.setAttribute('is-active','false');second.setAttribute('is-active','true');
  await h.flushMicrotasks();await h.scan();
  assert.equal(h.w.document.getElementById('video1').playbackRate,1.5,'an active attribute-only mutation updates the selected Short');
  first.setAttribute('is-active','true');second.setAttribute('is-active','false');
  await h.flushMicrotasks();await h.scan();
  const next=h.w.document.getElementById('video0');
  assert.equal(next.playbackRate,1.5,'the selected setting carries over when Shorts advances');
  // Simulate YouTube reusing the active video element and resetting its rate.
  h.w.history.pushState({},'', '/shorts/two');
  next.playbackRate=1;next.dispatchEvent(new h.w.Event('ratechange'));
  await h.flushMicrotasks();await h.scan();
  assert.equal(next.playbackRate,1.5,'a reused Short cannot reset the saved preference to 1×');
  assert.equal(h.writes.some(write=>write.speed===1),false,'the reset rate is not saved as a user choice');

  h=await fixture({url:'https://www.youtube.com/watch?v=test',cards:[{id:'watch-card',attrs:'is-active'}],saved:{speed:1.5}});
  video=h.w.document.getElementById('video0');
  assert.equal(video.playbackRate,1.5,'the existing watch route still applies the saved speed');
  assert.equal(h.host.style.display,'none','watch route still requires its normal progress bar before showing controls');
  h.w.document.querySelector('.html5-video-player').insertAdjacentHTML('beforeend','<div class="ytp-progress-bar"></div>');
  await h.scan();
  assert.equal(h.host.style.display,'block','watch progress visibility behavior remains intact');
  h.w.history.pushState({},'', '/shorts/watch-transition');
  await h.scan();
  assert.equal(h.host.style.display,'block','SPA navigation to Shorts enables the Shorts controls');
  console.log('Shorts selection, controls, inheritance, reuse, visibility, and watch route: passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
