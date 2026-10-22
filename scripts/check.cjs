'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.name,'YouTube Fast Skipper');
assert.equal(manifest.version,pkg.version,'Package and extension versions must match');
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.permissions,['storage','debugger']);
assert.deepEqual(manifest.host_permissions,['https://www.youtube.com/*']);
const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
assert(content.includes("const SCRIPT_VERSION = '"+manifest.version+"'"),'Content script version must match');
assert(popup.includes('v'+manifest.version),'Popup version must match');
assert(popup.includes('<title>'+manifest.name+'</title>'),'Popup title must match');
const refs=[manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(c=>[...c.js,...c.css])];
for(const size of [16,32,48,128]) {
  const icon=manifest.icons[String(size)];
  assert.equal(manifest.action.default_icon[String(size)],icon);
  const png=fs.readFileSync(path.join(root,icon));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),size);
  assert.equal(png.readUInt32BE(20),size);
}
for(const match of popup.matchAll(/(?:src|href)="([^"]+)"/g)) refs.push(match[1]);
for(const ref of refs) {
  assert(!ref.includes('..')&&!path.isAbsolute(ref),'References must stay inside package');
  assert(fs.existsSync(path.join(root,ref)),'Missing extension file: '+ref);
}
for(const file of ['content.js','background.js','popup.js']) {
  const result=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
}
console.log('Manifest, versions, permissions, local assets, PNG sizes and JavaScript syntax passed.');
