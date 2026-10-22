const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'..','content.js'),'utf8');

async function fixture({trustedSkip,workerResult={ok:true},covered=false,disabled=false}={}) {
  const dom=new JSDOM('<!doctype html><div id="movie_player" class="html5-video-player ad-showing"><video></video><button id="skip-button:2" class="ytp-skip-ad-button" aria-label="Pular">Pular</button></div>',{
    url:'https://www.youtube.com/watch?v=test',runScripts:'outside-only',pretendToBeVisual:true
  });
  const w=dom.window;
  const button=w.document.getElementById('skip-button:2');
  button.disabled=disabled;
  let clicks=0;
  const messages=[];
  button.addEventListener('click',()=>clicks++);
  w.document.elementFromPoint=()=>covered?w.document.body:button;
  w.HTMLElement.prototype.getBoundingClientRect=function(){
    return this.tagName==='VIDEO'?{left:0,top:0,right:640,bottom:360,width:640,height:360}:
      {left:10,top:10,right:160,bottom:50,width:150,height:40};
  };
  w.innerWidth=1280;w.innerHeight=720;
  w.queue=[];
  w.requestAnimationFrame=fn=>{w.queue.push(fn);return w.queue.length;};
  w.setInterval=()=>1;w.setTimeout=()=>1;
  w.chrome={
    runtime:{onMessage:{addListener(){}},sendMessage:async message=>{messages.push(message);return workerResult;}},
    storage:{local:{get:async defaults=>({...defaults,...(trustedSkip===undefined?{}:{trustedSkip})}),set:async()=>{}},onChanged:{addListener(){}}}
  };
  w.eval(source);
  for(let i=0;i<8;i++) await Promise.resolve();
  const index=w.queue.findIndex(fn=>fn.name==='scan');
  assert.ok(index>=0);
  w.queue.splice(index,1)[0]();
  for(let i=0;i<8;i++) await Promise.resolve();
  return {messages,clicks,dom};
}

(async()=>{
  let result=await fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(result.messages)),[{type:'VIDEO_TURBO_TRUSTED_SKIP',targetId:'skip-button:2'}]);
  assert.equal(result.clicks,0,'worker dispatch should take precedence over DOM click');
  result=await fixture({workerResult:{ok:false,reason:'debugger-unavailable'}});
  assert.equal(result.messages.length,1);
  assert.equal(result.clicks,1,'DOM click remains fallback when worker refuses');
  result=await fixture({trustedSkip:false});
  assert.equal(result.messages.length,0);
  assert.equal(result.clicks,1);
  result=await fixture({covered:true});
  assert.equal(result.messages.length,0,'a covered target must not request browser input');
  result=await fixture({disabled:true});
  assert.equal(result.messages.length,0,'a disabled target must not request browser input');
  console.log('trusted content: default on, explicit off, target gate, and fallback passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
