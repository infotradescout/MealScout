/** Real installed MapLibre attribution sanitization and production-worker proof.
 * Loopback only; adversarial attribution writes only a disposable in-page flag.
 * QA_MAPLIBRE_BASELINE_ROOT names the unchanged5.24.0 worktree for retaining a
 * failing before-upgrade observation; it never weakens these assertions.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { buildSync } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function run() {
  const evidence = path.resolve(process.env.QA_EVIDENCE_DIR || path.join(root, '.qa-evidence/map-security'));
  fs.mkdirSync(evidence, { recursive:true });
  const baselineRoot = process.env.QA_MAPLIBRE_BASELINE_ROOT;
  const packageRoot = baselineRoot ? path.resolve(baselineRoot) : root;
  const installed = JSON.parse(fs.readFileSync(path.join(packageRoot, 'node_modules/maplibre-gl/package.json'), 'utf8'));
  if (baselineRoot) assert.equal(installed.version, '5.24.0', 'Only the preserved vulnerable baseline is permitted');
  else assert.equal(installed.version, '6.10.0');
  const assets = path.join(root, 'client/dist/assets');
  const workers = baselineRoot ? [] : fs.readdirSync(assets).filter(file => /^maplibre-gl-worker-.*\.js$/.test(file));
  if (!baselineRoot) assert.equal(workers.length,1,'Exactly one Vite-bundled production worker required');
  const workerName = workers[0];
  const bridge = path.join(evidence, 'maplibre-worker-url.fixture.js');
  if (workerName) fs.writeFileSync(bridge, 'export default '+JSON.stringify('/assets/'+workerName)+';');
  const entry = baselineRoot
    ? 'import * as module from '+JSON.stringify(path.join(packageRoot,'node_modules/maplibre-gl/dist/maplibre-gl.js').replaceAll('\\','/'))+';const lib=module.default||module;'
    : 'import * as lib from "./client/src/lib/maplibre-runtime";';
  const source = entry + String.raw`
    lib.setWorkerCount(1);
    window.__qaAttributionExecuted=0;
    window.boot=async attribution=>{
      const map=new lib.Map({container:'map',center:[0,0],zoom:3,attributionControl:false,
        style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eee8de'}}]}});
      window.qaMap=map;
      map.on('error',e=>window.mapErrors.push(String(e.error?.message||e.error)));
      map.addControl(new lib.AttributionControl({compact:false,customAttribution:attribution}));
      await new Promise(resolve=>map.once('load',resolve));
    };
    window.mapErrors=[];
    window.loadWorkerFeatures=()=>{
      window.qaMap.addSource('qa-worker',{type:'geojson',cluster:true,clusterRadius:80,
        data:{type:'FeatureCollection',features:[0,1].map(id=>({type:'Feature',id,properties:{id},geometry:{type:'Point',coordinates:[id*0.001,0]}}))}});
      window.qaMap.addLayer({id:'qa-points',type:'circle',source:'qa-worker',paint:{'circle-radius':16,'circle-color':'#ff5a1f'}});
    };
  `;
  const compiled = buildSync({stdin:{contents:source,loader:'js',resolveDir:root},absWorkingDir:root,bundle:true,write:false,
    platform:'browser',format:'iife',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},
    alias:workerName?{'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url':bridge}:{}}).outputFiles[0].text;
  const observedWorkers=[],results=[];
  const server=http.createServer((req,res)=>{
    if(req.url==='/assets/'+workerName && workerName){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(assets,workerName)));return;}
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(compiled);return;}
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="map" style="width:100%;height:400px"></div><script src="/fixture.js"></script></body></html>');return;}
    res.statusCode=404;res.end('Not a fixture asset');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.UI_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const cases=[
    {name:'consecutive event attributes cannot survive attribution sanitization',html:'<details open onload="1" ontoggle="window.__qaAttributionExecuted++">QA attribution</details>',check:async page=>{
      const attrs=await page.locator('.maplibregl-ctrl-attrib-inner details').evaluate(el=>Array.from(el.attributes).map(a=>a.name));
      assert.ok(!attrs.some(name=>/^on/i.test(name)),'All dangerous attributes must be removed, not only every other attribute');
      await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.__qaAttributionExecuted),0);
    }},
    {name:'adjacent unsafe link and event attributes are both removed',html:'<a onclick="window.__qaAttributionExecuted++" href="javascript:window.__qaAttributionExecuted++">QA link</a>',check:async page=>{
      const attrs=await page.locator('.maplibregl-ctrl-attrib-inner a').evaluate(el=>Array.from(el.attributes).map(a=>[a.name,a.value]));
      assert.ok(!attrs.some(([name,value])=>/^on/i.test(name)||/^javascript:/i.test(value)),'Adjacent unsafe attributes must not survive');
    }},
    {name:'legitimate attribution text and HTTPS credit links remain visible',html:'<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | <a href="https://carto.com/attributions">CARTO</a>',check:async page=>{
      await expect(page.getByRole('link',{name:'OpenStreetMap',exact:true})).toHaveAttribute('href','https://www.openstreetmap.org/copyright');
      await expect(page.getByRole('link',{name:'CARTO',exact:true})).toHaveAttribute('href','https://carto.com/attributions');
    }},
    {name:'real worker parses clustered GeoJSON and returns rendered feature data',html:'QA worker fixture',check:async page=>{
      await page.evaluate(()=>window.loadWorkerFeatures());
      await expect.poll(()=>page.evaluate(()=>window.qaMap.queryRenderedFeatures({layers:['qa-points']}).filter(x=>x.properties.cluster).length),{timeout:15000}).toBeGreaterThan(0);
      const leaves=await page.evaluate(async()=>{const feature=window.qaMap.queryRenderedFeatures({layers:['qa-points']}).find(x=>x.properties.cluster);return(await window.qaMap.getSource('qa-worker').getClusterLeaves(feature.properties.cluster_id,10,0)).map(x=>x.properties.id).sort();});
      assert.deepEqual(leaves,[0,1]);
      if(!baselineRoot)assert.ok(observedWorkers.some(url=>url===origin+'/assets/'+workerName),'The emitted production worker must execute');
    }},
  ];
  try{
    for(const width of [390,1440])for(const spec of cases){
      const context=await browser.newContext({viewport:{width,height:700},serviceWorkers:'block'});const errors=[],escaped=[];
      await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['blob:','data:'].includes(url.protocol))return route.continue();escaped.push(url.origin);return route.abort();});
      await context.routeWebSocket('**/*',socket=>socket.close());
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>observedWorkers.push(worker.url()));
      const name=width+' '+spec.name;
      try{await page.goto(origin);await page.evaluate(html=>window.boot(html),spec.html);await spec.check(page);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.mapErrors),[]);assert.deepEqual(escaped,[]);results.push({name,passed:true});console.log('MAP SECURITY PASS '+name);}
      catch(error){results.push({name,passed:false,error:error.message,pageErrors:errors});console.log('MAP SECURITY FAIL '+name+': '+error.message);await page.screenshot({path:path.join(evidence,'security-'+width+'-'+results.length+'.png'),fullPage:true}).catch(()=>{});}
      finally{await page.evaluate(()=>window.qaMap?.remove()).catch(()=>{});await context.close();}
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  const receipt={scope:'Real installed MapLibre, native browser DOM/WebGL2 and actual emitted worker; no provider traffic or real data',version:installed.version,packageSha256:hash(path.join(packageRoot,'node_modules/maplibre-gl/package.json')),worker:workerName?{file:workerName,sha256:hash(path.join(assets,workerName))}:null,baseline:Boolean(baselineRoot),results,pass:results.filter(x=>x.passed).length,fail:results.filter(x=>!x.passed).length,observedWorkers};
  fs.writeFileSync(path.join(evidence,'maplibre-security-browser.json'),JSON.stringify(receipt,null,2));console.log('MAP SECURITY SUMMARY '+JSON.stringify({version:installed.version,pass:receipt.pass,fail:receipt.fail}));
  return receipt;
}
module.exports={run};
if(require.main===module)run().then(receipt=>{if(receipt.fail)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});
