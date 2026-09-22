import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root=process.cwd(),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'meal-quality-browser-'));
let server,browser;
const evidence={passed:false,cases:[],scope:'Actual Discovery wrapper and retained components with production CSS and intercepted read-only API fixtures. No production login, database writes or analytics.'};
function payload(hours){const end=new Date();return {report:{version:1,product:'mealscout',hours,from:new Date(end.getTime()-hours*3600000).toISOString(),toExclusive:end.toISOString(),recordedRows:5,entryEvents:2,actionEvents:1,profileQualityReports:2,otherRecords:0,classifiedAcquisitionEvents:2,candidateJourneys:1,candidateJourneysWithAction:1,quality:[{classification:'browser_candidate',entryEvents:1,actionEvents:1,qualityReports:0,otherRecords:0},{classification:'legacy_unclassified',entryEvents:1,actionEvents:0,qualityReports:1,otherRecords:0},{classification:'qa_signal',entryEvents:0,actionEvents:0,qualityReports:1,otherRecords:0}],sources:[{source:'search_labeled',journeys:1,journeysWithAction:1}],verifiedPeople:null,searchImpressions:null,searchClicks:null,verifiedCustomerOutcomes:null,coverage:'available_retained_records_not_guaranteed_complete'}};}
try{
  await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Page from './client/src/pages/admin-discovery-observatory';const client=new QueryClient({defaultOptions:{queries:{retry:false}}});createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><Page/></QueryClientProvider>);",resolveDir:root,loader:'tsx'},bundle:true,format:'esm',platform:'browser',jsx:'automatic',alias:{'@':path.join(root,'client/src'),'@shared':path.join(root,'shared')},define:{'process.env.NODE_ENV':'"production"'},outfile:path.join(temporary,'app.js'),logLevel:'silent'});
  const output=path.join(root,'dist/public');const css=fs.readdirSync(output,{recursive:true}).filter(file=>String(file).endsWith('.css'));assert(css.length,'Production CSS required');fs.writeFileSync(path.join(temporary,'app.css'),css.map(file=>fs.readFileSync(path.join(output,String(file)),'utf8')).join('\n'));
  const app=express();app.use(express.static(temporary));app.get('*',(_req,res)=>res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});const page=await context.newPage();page.setDefaultTimeout(10000);
    let mode='hold',release,calls=0,writes=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());if(request.method()!=='GET'){writes++;return route.abort();}if(url.origin!==base)return route.abort();
      if(url.pathname==='/api/admin/discovery-observatory/traffic-quality'){
        calls++;if(mode==='hold')await new Promise(resolve=>release=resolve);
        if(mode==='fail'||mode==='denied')return route.fulfill({status:mode==='fail'?503:401,contentType:'application/json',body:'{"message":"unavailable"}'});
        const result=payload(Number(url.searchParams.get('hours')));
        if(mode==='malformed')result.report.entryEvents=-1;
        if(mode==='empty')Object.assign(result.report,{recordedRows:0,entryEvents:0,actionEvents:0,profileQualityReports:0,classifiedAcquisitionEvents:0,candidateJourneys:null,candidateJourneysWithAction:null,quality:[],sources:[]});
        return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
      }
      if(url.pathname==='/api/admin/discovery-observatory')return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Isolated legacy evidence unavailable"}'});
      if(url.pathname.startsWith('/api/'))return route.abort();return route.continue();
    });
    await page.goto(base+'/admin/discovery-observatory');await page.getByRole('status').waitFor();assert.equal(await page.getByTestId('traffic-quality-results').count(),0);
    mode='success';release();await page.getByTestId('traffic-quality-results').waitFor();await page.getByText('Retention limit: 48 hours.',{exact:true}).waitFor();
    mode='fail';await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('button',{name:'Retry report'}).waitFor();assert.equal(await page.getByTestId('traffic-quality-results').count(),0);
    mode='success';await page.getByRole('button',{name:'Retry report'}).click();await page.getByTestId('traffic-quality-results').waitFor();
    await page.getByLabel('Rolling window').selectOption('6');await page.getByRole('button',{name:'Apply window'}).click();await page.getByText('Applied window: 6 hours.',{exact:false}).waitFor();
    await page.getByLabel('Rolling window').selectOption('48');await page.getByRole('button',{name:'Existing evidence',exact:true}).click();await page.getByText('Isolated legacy evidence unavailable',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Traffic quality',exact:true}).click();assert.equal(await page.getByLabel('Rolling window').inputValue(),'48');
    mode='malformed';await page.getByRole('button',{name:'Apply window'}).click();await page.getByRole('button',{name:'Retry report'}).waitFor();assert.equal(await page.getByTestId('traffic-quality-results').count(),0);
    mode='empty';await page.getByRole('button',{name:'Retry report'}).click();await page.getByText('No classified acquisition events are available',{exact:false}).waitFor();
    mode='denied';await page.getByTestId('traffic-quality-panel').getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Administrator access is required. Sign in again.').waitFor();assert.equal(await page.getByTestId('traffic-quality-results').count(),0);
    mode='success';await page.getByRole('button',{name:'Retry report'}).click();await page.getByTestId('traffic-quality-results').waitFor();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);assert.deepEqual(errors,[]);assert.equal(writes,0);
    if(process.env.MEAL_QUALITY_BROWSER_OUTPUT){fs.mkdirSync(process.env.MEAL_QUALITY_BROWSER_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.MEAL_QUALITY_BROWSER_OUTPUT,`meal-quality-${width}.png`),fullPage:true});}
    evidence.cases.push({width,passed:true,calls,writes,retentionVisible:true,loadingNoZeros:true,failedRefreshHidesData:true,retry:true,hoursDraftPreserved:true,malformedRejected:true,emptyUnavailable:true,permissionLossHidesData:true,overflow,pageErrors:errors});await context.close();
  }
  evidence.passed=true;
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});console.log('MEAL_QUALITY_BROWSER '+JSON.stringify(evidence));}
