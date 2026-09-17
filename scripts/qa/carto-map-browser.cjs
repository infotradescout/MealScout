/** Real React/MapLibre components, synthetic tile responses; no live provider calls. */
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http');
const {buildSync}=require('esbuild'); const {chromium,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'../..');
const evidence=process.env.QA_EVIDENCE_DIR||path.join(root,'.qa-evidence/scout-map-read-truth');
const assets=path.join(root,'client/dist/assets');
const css=fs.readdirSync(assets).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(path.join(assets,f),'utf8')).join('\n');
function bundle(key){
 const source=`import React from 'react';import{createRoot}from'react-dom/client';
 import{ThemedScoutMapV2}from'./client/src/components/maps/themed-scout-map-v2';
 import{ThemedScoutMap}from'./client/src/components/maps/themed-scout-map';
 const pin={id:'qa-place',kind:'restaurant',sourceId:'qa-place',lat:30.42,lng:-87.21,title:'QA fixture'};
 const app=createRoot(document.getElementById('root'));
 window.mountMap=legacy=>app.render(<div style={{position:'relative',width:'100%',height:360}}>{React.createElement(legacy?ThemedScoutMap:ThemedScoutMapV2,{userLocation:{lat:30.42,lng:-87.21},markers:[pin],onMarkerTap:m=>window.selected=m.id})}</div>);
 window.unmountMap=()=>app.unmount();`;
 return buildSync({stdin:{contents:source,loader:'tsx',resolveDir:root},absWorkingDir:root,bundle:true,write:false,outfile:'map-fixture.js',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_CARTO_BASEMAPS_API_KEY':JSON.stringify(key)}}).outputFiles.find(f=>f.path.endsWith('.js')).text;
}
const codeMissing=bundle(''),codeConfigured=bundle('qa-carto-fixture');
let tile=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=','base64');
const results=[];
async function main(){
 fs.mkdirSync(evidence,{recursive:true}); const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r)); const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:process.env.UI_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{for(const legacy of [false,true])for(const width of [390,1440])for(const mode of ['missing','configured','denied']){
  const context=await browser.newContext({viewport:{width,height:700},serviceWorkers:'block'}); const requests=[],errors=[];let denied=mode==='denied';
  await context.routeWebSocket('**/*',s=>s.close());
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname.endsWith('.cartocdn.com')){requests.push({host:u.hostname,path:u.pathname,key:u.searchParams.get('key')});return route.fulfill({status:denied?403:200,contentType:denied?'text/plain':'image/png',body:denied?'Denied fixture':tile,headers:{'Access-Control-Allow-Origin':'*'}});}return u.origin===origin?route.continue():route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const name=`${legacy?'legacy':'active'} ${width} ${mode}`;
  try{
   await page.goto(origin);tile=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');x.fillStyle='#eee8de';x.fillRect(0,0,256,256);return c.toDataURL('image/png').split(',')[1]}),'base64');await page.addStyleTag({content:css});await page.addScriptTag({content:mode==='missing'?codeMissing:codeConfigured});await page.evaluate(v=>window.mountMap(v),legacy);
   const unavailable=page.getByTestId('scout-street-map-unavailable');
   if(mode==='missing'){
    await expect(unavailable).toBeVisible();assert.equal(requests.length,0,'No anonymous tile requests');
    await page.locator('.msm-fallback-pin').click();assert.equal(await page.evaluate(()=>window.selected),'qa-place');
    await expect(page.getByRole('button',{name:'Retry street map'})).toHaveCount(0,'Missing configuration is not repaired by retry');
   }else{
    await expect.poll(()=>requests.length,{timeout:12000}).toBeGreaterThan(0);assert.ok(requests.every(r=>r.key==='qa-carto-fixture'));
    if(denied){await expect(unavailable).toBeVisible();denied=false;await page.getByRole('button',{name:'Retry street map'}).click();}
    await expect(unavailable).toHaveCount(0);await expect(page.locator('.maplibregl-canvas')).toBeVisible();
   }
   assert.deepEqual(errors,[]);results.push({name,passed:true,tileRequests:requests.length});console.log('MAP PASS '+name);
  }catch(error){results.push({name,passed:false,error:error.message,errors});console.log('MAP FAIL '+name+': '+error.message);}
  finally{await page.goto('about:blank').catch(()=>{});await page.close();await context.close();}
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
 fs.writeFileSync(path.join(evidence,'carto-map-browser.json'),JSON.stringify({results,scope:'Real React/MapLibre; locally intercepted tile fixtures; no provider credentials'},null,2));
 console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length}));if(results.some(r=>!r.passed))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
