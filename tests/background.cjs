const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8');

function fixture(options={}) {
  const dom=new JSDOM('<!doctype html><div id="movie_player" class="html5-video-player ad-showing"><button id="skip-button:2" class="ytp-skip-ad-button" aria-label="Pular">Pular</button></div>',{
    url:'https://www.youtube.com/watch?v=fixture',runScripts:'outside-only',pretendToBeVisual:true
  });
  const w=dom.window;
  const button=w.document.getElementById('skip-button:2');
  button.getBoundingClientRect=()=>({left:10,top:10,right:110,bottom:40,width:100,height:30});
  w.document.elementFromPoint=()=>options.covered?w.document.body:button;
  if(options.offscreen) button.getBoundingClientRect=()=>({left:-200,top:10,right:-100,bottom:40,width:100,height:30});
  if(options.countdown) button.setAttribute('aria-label','Pular anúncio em 5 segundos');
  if(options.noAd) w.document.getElementById('movie_player').classList.remove('ad-showing');
  if(options.disabled) button.disabled=true;
  if(options.accessibilityWrapper) {
    const player=w.document.getElementById('movie_player');
    player.setAttribute('aria-hidden','true');
    player.style.pointerEvents='none';
    button.style.pointerEvents='auto';
  }
  const state={
    tab:{id:5,active:true,url:'https://www.youtube.com/watch?v=fixture',windowId:3},
    focused:true,settings:{autoSkip:true,...(options.trustedSkip===undefined?{}:{trustedSkip:options.trustedSkip})},
    calls:[],attachCount:0,detachCount:0,detached:null,storageChanged:null,inspectCount:0
  };
  let listener;
  const chrome={
    runtime:{id:'extension-id',onMessage:{addListener(fn){listener=fn;}}},
    tabs:{get:async()=>state.tab,onRemoved:{addListener(){}}},
    windows:{get:async()=>({focused:state.focused})},
    storage:{local:{get:async defaults=>({...defaults,...state.settings})},onChanged:{addListener(fn){state.storageChanged=fn;}}},
    debugger:{
      attach:async()=>{state.attachCount++;if(options.attachFails)throw Error('busy');if(options.cancelDuringAttach)state.detached({tabId:5},'canceled_by_user');},
      detach:async()=>{state.detachCount++;},
      onDetach:{addListener(fn){state.detached=fn;}},
      sendCommand:async(target,method,params)=>{
        state.calls.push({method,params});
        if(method==='Runtime.evaluate') {
          state.inspectCount++;
          const value=w.eval(params.expression);
          if(options.navigateAfterInspect) state.tab.url='https://example.com/';
          if(options.trustedOffAfterInspect===state.inspectCount) state.settings.trustedSkip=false;
          return {result:{value}};
        }
        if(method==='Input.dispatchMouseEvent' && params.type==='mousePressed' && options.navigateAfterPress)
          state.tab.url='https://example.com/';
        return {};
      }
    }
  };
  vm.runInNewContext(source,{chrome,URL,Date,Number,Object,Set,Map,JSON});
  const sender={id:'extension-id',frameId:0,url:'https://www.youtube.com/watch?v=fixture',tab:{id:5}};
  const request=(message={type:'VIDEO_TURBO_TRUSTED_SKIP',targetId:'skip-button:2'},from=sender)=>
    new Promise(resolve=>{const result=listener(message,from,resolve);if(result!==true && result!==undefined) throw Error('Unexpected listener return');});
  return {state,w,button,request,sender};
}

async function run() {
  let f=fixture();
  let reply=await f.request();
  assert.equal(reply.ok,true);
  assert.deepEqual(f.state.calls.filter(c=>c.method==='Input.dispatchMouseEvent').map(c=>c.params.type),['mousePressed','mouseReleased']);
  assert.equal(f.state.detachCount,1);
  assert.equal(f.state.calls[0].params.expression.includes('skip-button:2'),true);
  reply=await f.request();
  assert.equal(reply.reason,'cooldown');
  assert.equal(f.state.attachCount,1);

  f=fixture({trustedSkip:false});reply=await f.request();
  assert.equal(reply.reason,'disabled-setting');assert.equal(f.state.attachCount,0);
  f=fixture();reply=await f.request({type:'VIDEO_TURBO_TRUSTED_SKIP',targetId:'skip-button:2',expression:'1+1'});
  assert.equal(reply.reason,'invalid-request');assert.equal(f.state.attachCount,0);
  for(const targetId of [5,['skip-button:2'],{toString(){return 'skip-button:2';}}]) {
    f=fixture();reply=await f.request({type:'VIDEO_TURBO_TRUSTED_SKIP',targetId});
    assert.equal(reply.reason,'invalid-request');assert.equal(f.state.attachCount,0);
  }
  f=fixture();reply=await f.request(undefined,{...f.sender,frameId:1});
  assert.equal(reply.reason,'invalid-request');assert.equal(f.state.attachCount,0);
  for(const [name,expected] of [
    [{noAd:true},'no-ad'],[{disabled:true},'disabled'],[{countdown:true},'countdown'],
    [{offscreen:true},'offscreen'],[{covered:true},'covered']
  ]) {
    f=fixture(name);reply=await f.request();
    assert.equal(reply.reason,expected);
    assert.equal(f.state.calls.some(c=>c.method==='Input.dispatchMouseEvent'),false);
    assert.equal(f.state.detachCount,1);
  }
  f=fixture({navigateAfterInspect:true});reply=await f.request();
  assert.equal(reply.reason,'inactive-tab');assert.equal(f.state.calls.some(c=>c.method==='Input.dispatchMouseEvent'),false);
  f=fixture({navigateAfterPress:true});reply=await f.request();
  assert.equal(reply.reason,'inactive-tab');
  assert.deepEqual(f.state.calls.filter(c=>c.method==='Input.dispatchMouseEvent').map(c=>[c.params.type,c.params.x,c.params.y]),[['mousePressed',60,25],['mouseReleased',-1,-1]]);
  assert.equal(f.state.detachCount,1);
  f=fixture({trustedOffAfterInspect:1});reply=await f.request();
  assert.equal(reply.reason,'disabled-setting');
  assert.equal(f.state.calls.some(c=>c.method==='Input.dispatchMouseEvent'),false);
  f=fixture({trustedOffAfterInspect:2});reply=await f.request();
  assert.equal(reply.reason,'disabled-setting');
  assert.deepEqual(f.state.calls.filter(c=>c.method==='Input.dispatchMouseEvent').map(c=>[c.params.type,c.params.x]),[['mousePressed',60],['mouseReleased',-1]]);
  f=fixture({cancelDuringAttach:true});reply=await f.request();
  assert.equal(reply.reason,'debugger-locked');
  assert.equal(f.state.calls.some(c=>c.method==='Input.dispatchMouseEvent'),false);
  f=fixture({accessibilityWrapper:true});reply=await f.request();
  assert.equal(reply.ok,true,'hit tested button is clickable despite ancestor aria-hidden or pointer-events:none');
  f=fixture({attachFails:true});reply=await f.request();
  assert.equal(reply.reason,'debugger-unavailable');
  reply=await f.request();assert.equal(reply.reason,'debugger-locked');
  assert.equal(f.state.attachCount,1);
  f=fixture();f.state.focused=false;reply=await f.request();
  assert.equal(reply.reason,'inactive-tab');assert.equal(f.state.attachCount,0);
  console.log('background: default trusted on, explicit off, target checks, races, throttling, lockout, cleanup passed');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
