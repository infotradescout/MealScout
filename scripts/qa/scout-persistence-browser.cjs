/** Actual React + persistence hook under continuous rerenders. Local browser storage only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { buildSync } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
const root = path.resolve(__dirname, '../..');
const evidence = process.env.QA_EVIDENCE_DIR || path.join(root, '.qa-evidence/scout-persistence-timing');
const source = `
import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useScoutJourneyPersistence} from './client/src/hooks/useScoutJourneyPersistence';
function View({moving}) {
  const [frame,setFrame]=useState(0), [query,setQuery]=useState('initial');
  useEffect(()=>{const t=setInterval(()=>setFrame(n=>n+1),20);return()=>clearInterval(t)},[]);
  useScoutJourneyPersistence('qa-account', {route:'/scout',search:{open:true,query,filter:null},scene:'for_you',craving:'tacos',radiusKm:25,
    layers:{openNow:true,foodTrucks:true,deals:true,happeningToday:true},map:{center:{lat:30.4,lng:-87.2+(moving?frame/100000:0)},zoom:14,expanded:false,selectedMarkerId:null},scrollY:0});
  return <><input aria-label="Search" value={query} onChange={e=>setQuery(e.target.value)}/><span id="frame">{frame}</span></>;
}
const app=createRoot(document.getElementById('root'));
window.mountView=moving=>app.render(<View moving={moving}/>);
window.unmountView=()=>app.unmount();
`;
const code = buildSync({ stdin:{contents:source,loader:'tsx',resolveDir:root},absWorkingDir:root,bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'} }).outputFiles[0].text;
const results = [];
async function main() {
  fs.mkdirSync(evidence,{recursive:true});
  const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div>')});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],executablePath:process.env.UI_CHROMIUM_EXECUTABLE||undefined});
  try {
    for(const moving of [false,true]) {
      const context=await browser.newContext({serviceWorkers:'block'}), errors=[];
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
      const name=moving?'continuous map changes cannot starve saved view':'unrelated rerenders cannot starve saved search';
      try {
        await page.goto(origin);
        await page.evaluate(()=>{window.__writes=0;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('mealscout:scout-journey:'))window.__writes++;return original.call(this,k,v)}});
        await page.addScriptTag({content:code}); await page.evaluate(value=>window.mountView(value),moving);
        const input=page.getByRole('textbox',{name:'Search',exact:true});
        await expect(input).toBeVisible(); await input.fill('fresh tacos');
        const read=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('mealscout:scout-journey:v1:qa-account')||'null'));
        await expect.poll(async()=>(await read())?.state.search.query,{timeout:1500}).toBe('fresh tacos');
        assert.ok(Number(await page.locator('#frame').textContent())>=3,'Rendering remained active');
        if(moving) assert.ok((await read()).state.map.center.lng>-87.2,'Latest moving map checkpoint was written');
        assert.ok(await page.evaluate(()=>window.__writes)<=8,'Storage writes must remain bounded');
        await page.evaluate(()=>window.unmountView());
        assert.equal((await read()).state.search.query,'fresh tacos','Unmount flush retains final view');
        const count=await page.evaluate(()=>window.__writes); await page.waitForTimeout(350);
        assert.equal(await page.evaluate(()=>window.__writes),count,'No timer may write after unmount');
        assert.deepEqual(errors,[]); results.push({name,passed:true});
        console.log('PERSISTENCE PASS '+name);
      } catch(error) {
        results.push({name,passed:false,error:error.message,errors}); console.log('PERSISTENCE FAIL '+name+': '+error.message);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
  fs.writeFileSync(path.join(evidence,'timing-results.json'),JSON.stringify({results,scope:'Actual React/hook/browser storage; no application API or provider'},null,2));
  if(results.some(result=>!result.passed)) process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
