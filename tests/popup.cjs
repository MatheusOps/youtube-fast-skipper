const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const extension = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8')).version;

async function openPopup(response, failMessage = false, failClipboard = false, options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(extension, 'popup.html'), 'utf8'), {runScripts:'outside-only'});
  let copied = null;
  let storageListener;
  const writes=[];
  dom.window.setInterval = () => 1;
  Object.defineProperty(dom.window.navigator,'clipboard',{value:{writeText:async text=>{
    if(failClipboard) throw new Error('Clipboard unavailable');
    copied=text;
  }}});
  dom.window.chrome = {
    storage:{local:{get:async defaults => ({...defaults,...options.saved}),set:async patch => {
      if(options.failSave) throw new Error('Save failed');
      writes.push({...patch});
    }},onChanged:{addListener:listener=>{storageListener=listener;}}},
    tabs:{query:async () => [{id:7}],sendMessage:async () => {
      if (failMessage) throw new Error('No receiving end');
      return response;
    }},
    runtime:{getManifest:() => ({version})}
  };
  dom.window.eval(fs.readFileSync(path.join(extension, 'popup.js'), 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  return {dom,document:dom.window.document,copied:()=>copied,writes,changeStorage:changes=>storageListener(changes,'local')};
}

async function renderPopup(response, failMessage = false) {
  const popup = await openPopup(response,failMessage);
  try { return popup.document.getElementById('skipStatus').textContent; }
  finally { popup.dom.window.close(); }
}

test('popup identifies a matching script and preserves its diagnostic', async () => {
  const text = await renderPopup({version,status:'Waiting for button.',lastAction:'Click sent.'});
  assert.ok(text.includes('Script '+version));
  assert.match(text,/Waiting for button/);
  assert.match(text,/Click sent/);
});

test('popup detects an old injected script with no version', async () => {
  const text = await renderPopup({status:'Button found; click sent.'});
  assert.match(text,/old or different script/);
  assert.match(text,/Refresh the YouTube page/);
  assert.match(text,/no version/);
});

test('popup detects a different script version', async () => {
  const text = await renderPopup({version:'2.7.0',status:'Waiting for button.'});
  assert.match(text,/old or different script/);
  assert.match(text,/script: 2\.7\.0/);
});

test('popup explains that there is no reachable content script', async () => {
  assert.match(await renderPopup(null,true),/Open a refreshed YouTube tab/);
});

const diagnosticResponse = {
  version,status:'Waiting to retry.',lastAction:'Click sent.',
  diagnostics:{candidateCount:2,lastTarget:{tag:'DIV',id:'skip',classes:'ytp-ad-skip-button-container',attempts:3}},
  url:'https://should-not-be-copied.invalid/'
};

test('popup shows the selected target and copies only the diagnostic response fields', async () => {
  const popup = await openPopup(diagnosticResponse);
  try {
    assert.match(popup.document.getElementById('skipTarget').textContent,/DIV#skip\.ytp-ad-skip-button-container/);
    assert.match(popup.document.getElementById('skipTarget').textContent,/3 attempts/);
    const button=popup.document.getElementById('copyDiagnostic');
    assert.equal(button.disabled,false);
    button.click();
    await new Promise(resolve=>setImmediate(resolve));
    const copied=JSON.parse(popup.copied());
    assert.deepEqual(copied.diagnostics,diagnosticResponse.diagnostics);
    assert.equal(Object.hasOwn(copied,'url'),false);
    assert.match(popup.document.getElementById('status').textContent,/Diagnostics copied/);
  } finally { popup.dom.window.close(); }
});

test('popup provides selectable text when clipboard access is unavailable', async () => {
  const popup = await openPopup(diagnosticResponse,false,true);
  try {
    popup.document.getElementById('copyDiagnostic').click();
    await new Promise(resolve=>setImmediate(resolve));
    const field=popup.document.getElementById('diagnosticText');
    assert.equal(field.hidden,false);
    assert.deepEqual(JSON.parse(field.value).diagnostics,diagnosticResponse.diagnostics);
    assert.equal(field.selectionStart,0);
    assert.equal(field.selectionEnd,field.value.length);
  } finally { popup.dom.window.close(); }
});

test('popup cannot copy a stale or missing diagnostic', async () => {
  for(const response of [{version:'2.7.1',diagnostics:diagnosticResponse.diagnostics},{version,status:'Waiting.'}]) {
    const popup=await openPopup(response);
    try {
      assert.equal(popup.document.getElementById('copyDiagnostic').disabled,true);
      popup.document.getElementById('copyDiagnostic').click();
      assert.equal(popup.copied(),null);
    } finally { popup.dom.window.close(); }
  }
});

test('popup shows whether browser click mode is enabled and explains its gate', async () => {
  for(const [enabled,reason,expected] of [[false,'mode-disabled','option disabled'],[true,'non-main-player','main player not selected']]) {
    const popup=await openPopup({...diagnosticResponse,diagnostics:{...diagnosticResponse.diagnostics,trustedMode:{enabled,pending:false,reason}}});
    try {
      const text=popup.document.getElementById('skipTarget').textContent;
      assert.ok(text.includes('Skip Ads (Chrome click): '+(enabled?'enabled':'disabled')));
      assert.ok(text.includes(expected));
      popup.document.getElementById('copyDiagnostic').click();
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(JSON.parse(popup.copied()).diagnostics.trustedMode.reason,reason);
    } finally {popup.dom.window.close();}
  }
});

test('popup labels the ad speed control and distinguishes the automatic skip setting', async () => {
  const popup=await openPopup(diagnosticResponse);
  try {
    assert.match(popup.document.querySelector('label[for="accelerateAds"]')?.textContent||popup.document.getElementById('accelerateAds').parentElement.textContent,/Speed up ads/);
    assert.match(popup.document.querySelector('#autoSkip').parentElement.textContent,/Controls all automatic skip attempts/);
    assert.match(popup.document.querySelector('#trustedSkip').parentElement.textContent,/Skip Ads/);
    assert.match(popup.document.querySelector('.permission-note').textContent,/Chrome debugging permission/);
    assert.equal(popup.document.documentElement.lang,'en');
    assert.deepEqual([...popup.document.querySelectorAll('#step option')].map(option=>option.textContent),['0.05×','0.10×','0.25×','0.50×','1.00×']);
  } finally {popup.dom.window.close();}
});

test('new audio, Chrome click, and ad acceleration defaults are on while explicit opt-outs stay off', async () => {
  for(const saved of [{},{trustedSkip:false,muteAds:false,accelerateAds:false}]) {
    const popup=await openPopup(diagnosticResponse,false,false,{saved});
    try {
      assert.equal(popup.document.getElementById('trustedSkip').checked,saved.trustedSkip!==false);
      assert.equal(popup.document.getElementById('muteAds').checked,saved.muteAds!==false);
      assert.equal(popup.document.getElementById('accelerateAds').checked,saved.accelerateAds!==false);
      assert.equal(popup.writes.length,0,'displaying defaults does not overwrite preferences');
    } finally {popup.dom.window.close();}
  }
});

test('popup saves mute preference and follows changes from the in-video menu', async () => {
  const popup=await openPopup(diagnosticResponse);
  try {
    const mute=popup.document.getElementById('muteAds');
    mute.click();
    assert.equal(mute.disabled,true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(popup.writes.at(-1).muteAds,false);
    assert.equal(mute.disabled,false);
    popup.changeStorage({muteAds:{newValue:true},trustedSkip:{newValue:false}});
    assert.equal(mute.checked,true);
    assert.equal(popup.document.getElementById('trustedSkip').checked,false);
  } finally {popup.dom.window.close();}
});

test('popup saves ad acceleration and follows changes from the in-video menu', async () => {
  const popup=await openPopup(diagnosticResponse);
  try {
    const accelerate=popup.document.getElementById('accelerateAds');
    accelerate.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(popup.writes.at(-1).accelerateAds,false);
    assert.equal(accelerate.disabled,false);
    popup.changeStorage({accelerateAds:{newValue:true}});
    assert.equal(accelerate.checked,true);
  } finally {popup.dom.window.close();}
});

test('failed preference writes restore the displayed state', async () => {
  const popup=await openPopup(diagnosticResponse,false,false,{failSave:true});
  try {
    const mute=popup.document.getElementById('muteAds');
    mute.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(mute.checked,true);
    assert.equal(mute.disabled,false);
    assert.match(popup.document.getElementById('status').textContent,/Could not save settings/);
  } finally {popup.dom.window.close();}
});
