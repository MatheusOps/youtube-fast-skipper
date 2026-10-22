const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8');

async function fixture({initialMuted=false,ad=false,saved={},playerId='movie_player',url='https://www.youtube.com/watch?v=audio-test'}={}) {
  const dom=new JSDOM(`<!doctype html><body><div id="${playerId}" class="html5-video-player${ad?' ad-showing':''}"><video id="main"></video></div><div id="preview" class="html5-video-player ad-showing"><video id="other"></video></div></body>`,{
    url,runScripts:'outside-only',pretendToBeVisual:true
  });
  const w=dom.window;
  const player=w.document.getElementById(playerId);
  const video=w.document.getElementById('main');
  const preview=w.document.getElementById('other');
  video.muted=initialMuted;
  video.volume=.37;
  preview.volume=.62;
  w.innerWidth=1280;w.innerHeight=720;
  w.queue=[];
  w.requestAnimationFrame=fn=>{w.queue.push(fn);return w.queue.length;};
  w.setInterval=()=>1;w.setTimeout=()=>1;w.clearTimeout=()=>{};
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    return this.tagName==='VIDEO'?{left:0,top:0,right:640,bottom:360,width:640,height:360}:
      {left:10,top:10,right:160,bottom:50,width:150,height:40};
  };
  let storageChange;
  w.chrome={
    runtime:{onMessage:{addListener(){}},sendMessage:async()=>({ok:false,reason:'test'})},
    storage:{local:{get:async defaults=>({...defaults,...saved}),set:async()=>{}},onChanged:{addListener(fn){storageChange=fn;}}}
  };
  w.eval(source);
  const microtasks=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  await microtasks();
  const index=w.queue.findIndex(fn=>fn.name==='scan');
  assert.ok(index>=0,'initial scan exists');
  w.queue.splice(index,1)[0]();
  await microtasks();
  const change=async(name,value)=>{
    storageChange({[name]:{newValue:value}},'local');
    await microtasks();
  };
  return {w,player,video,preview,change,microtasks,dom};
}

(async()=>{
  let h=await fixture();
  assert.equal(h.video.muted,false,'content remains unmuted');
  h.player.classList.add('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,true,'detected ad is muted by class mutation');
  assert.equal(h.video.volume,.37,'volume is untouched');
  assert.equal(h.preview.muted,false,'preview player is untouched');
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,false,'prior mute state returns as soon as ad ends');
  h.player.classList.add('ad-interrupting');
  await h.microtasks();
  assert.equal(h.video.muted,true,'second ad is muted');
  h.player.classList.remove('ad-interrupting');
  await h.microtasks();
  assert.equal(h.video.muted,false,'second ad also restores original state');

  h=await fixture({initialMuted:true,ad:true});
  assert.equal(h.video.muted,true);
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,true,'originally muted content stays muted');

  h=await fixture({ad:true});
  const old=h.video;
  const replacement=h.w.document.createElement('video');
  replacement.id='replacement';
  replacement.muted=true; // Player transferred the extension-forced state.
  replacement.volume=.81;
  old.remove();
  h.player.append(replacement);
  await h.microtasks();
  assert.equal(old.muted,false,'detached old video is released promptly');
  assert.equal(replacement.muted,true,'replacement stays muted during the same ad');
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(replacement.muted,false,'replacement restores the session original, not inherited forced mute');
  assert.equal(replacement.volume,.81);

  h=await fixture({ad:true});
  const coexisting=h.w.document.createElement('video');
  coexisting.muted=true; // Novo vídeo pode herdar o mute forçado.
  h.player.append(coexisting);
  await h.microtasks();
  assert.equal(h.video.muted,true);
  assert.equal(coexisting.muted,true,'both videos in the active ad player stay muted during coexistence');
  h.video.remove();
  await h.microtasks();
  assert.equal(h.video.muted,false,'detached old video is restored during coexistence');
  assert.equal(coexisting.muted,true);
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(coexisting.muted,false,'new video restores the original session state');

  h=await fixture({ad:true,playerId:'embedded-player',url:'https://www.youtube.com/embed/audio-test'});
  assert.equal(h.video.muted,true,'active ad player is muted outside the watch route');
  assert.equal(h.preview.muted,false,'other ad-marked preview remains untouched');
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,false);

  h=await fixture({ad:true});
  const gearMute=h.w.document.getElementById('video-turbo-controls').shadowRoot.getElementById('muteAds');
  assert.equal(gearMute.checked,true);
  gearMute.checked=false;
  gearMute.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.equal(h.video.muted,false,'gear switch restores immediately');
  gearMute.checked=true;
  gearMute.dispatchEvent(new h.w.Event('change',{bubbles:true}));
  assert.equal(h.video.muted,true,'gear switch reapplies immediately');
  await h.change('muteAds',false);
  assert.equal(h.video.muted,false,'turning the setting off restores audio during the ad');
  await h.change('muteAds',true);
  assert.equal(h.video.muted,true,'turning the setting on mutes the current ad');
  h.video.muted=false;
  h.video.volume=.29;
  h.video.dispatchEvent(new h.w.Event('volumechange'));
  assert.equal(h.video.muted,true,'manual unmute during ad is reasserted');
  assert.equal(h.video.volume,.29,'manual volume changes are preserved');
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,false);

  h=await fixture({ad:true,saved:{muteAds:false}});
  assert.equal(h.video.muted,false,'saved opt-out is preserved');
  h=await fixture({ad:true});
  const nextPlayer=h.w.document.createElement('div');
  nextPlayer.id='movie_player';
  nextPlayer.className='html5-video-player ad-showing';
  const nextVideo=h.w.document.createElement('video');
  nextPlayer.append(nextVideo);
  h.player.replaceWith(nextPlayer);
  await h.microtasks();
  assert.equal(h.video.muted,false,'changing players releases the previous video');
  assert.equal(nextVideo.muted,true,'the new ad player gets its own audio session');
  nextPlayer.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(nextVideo.muted,false);
  h=await fixture({ad:true});
  h.w.document.dispatchEvent(new h.w.Event('yt-navigate-start'));
  assert.equal(h.video.muted,false,'navigation immediately releases the controlled video');
  await h.microtasks();
  assert.equal(h.video.muted,false,'the old player stays released while navigation is pending');
  h.player.remove();
  await h.microtasks();
  assert.equal(h.video.muted,false,'player removal does not leave audio muted');

  h=await fixture();
  Object.defineProperty(h.w.document,'hidden',{value:true,configurable:true});
  h.player.classList.add('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,true,'background tab reacts without animation frame');
  h.player.classList.remove('ad-showing');
  await h.microtasks();
  assert.equal(h.video.muted,false,'background tab restores without animation frame');
  console.log('audio: ad lifecycle, original mute, replacement, settings, navigation, preview, volume, hidden tab passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
