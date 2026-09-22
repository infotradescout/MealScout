import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const expected=String(process.env.MEAL_SIGNUP_HANDOFF_SHA||'');
assert.match(expected,/^[a-f0-9]{40}$/);
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'meal-handoff-live-')),checkout=path.join(temp,'source');
const out=path.join(root,'test-results/recovery-isolated-report');
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','PLAYWRIGHT_BROWSERS_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const report={expected,startedAt:new Date().toISOString(),result:'fail',cases:[],productionMutations:0,realRegistrations:0,realAuthenticatedSession:false,scope:'Actual deployed application with browser-local session and registration fixtures. No server authorization bypass, account creation, verification email or host publication.'};
let browser;
function run(command,args,cwd=checkout){const r=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});assert.equal(r.status,0,String(r.error||r.stderr));return(r.stdout||'').trim();}
async function version(){const r=await fetch('https://www.mealscout.us/api/version',{headers:{'user-agent':'mealscout-runtime-proof/signup-handoff','x-mealscout-qa':'1'},signal:AbortSignal.timeout(15000),redirect:'error'});assert.equal(r.status,200);const b=await r.json();assert.equal(b.version?.commit,expected);return {status:r.status,commit:b.version.commit};}
try {
  for(const key of ['DATABASE_URL','TEST_DATABASE_URL','SESSION_SECRET','STRIPE_SECRET_KEY','BREVO_API_KEY','SENDGRID_API_KEY','SMTP_PASS'])assert(!process.env[key],'Observer cannot inherit '+key);
  run('git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);
  run('git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',expected]);
  run('git',['checkout','--detach',expected]);assert.equal(run('git',['rev-parse','HEAD']),expected);
  assert.equal(run('git',['status','--porcelain']),'');
  run('npm',['ci','--include=dev','--no-audit','--no-fund']);
  run(process.execPath,['node_modules/playwright/cli.js','install','chromium']);
  const {chromium}=createRequire(path.join(checkout,'package.json'))('playwright');
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  report.before=await version();
  for(const width of [390,1440]) for(const scenario of ['storage-normal','storage-remove-denied','storage-unavailable','session-pending','session-error-retry','confirmed-guest']) {
    const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});
    const registration=scenario.startsWith('storage-');
    let authMode=registration?'guest':scenario==='session-error-retry'?'error':'hold';
    let release,localRegistrationResponses=0,blockedWrites=0,authReads=0;
    const errors=[];
    await context.addInitScript(mode=>{
      if(mode==='storage-remove-denied'){
        const remove=Storage.prototype.removeItem;
        Storage.prototype.removeItem=function(key){if(key==='mealscout:customer-signup-draft')throw new DOMException('Isolated storage denial','SecurityError');return remove.call(this,key);};
      } else if(mode==='storage-unavailable') {
        for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{configurable:true,get(){throw new DOMException('Isolated storage denial','SecurityError');}});
      }
    },scenario);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!=='https://www.mealscout.us')return route.abort();
      if(url.pathname==='/api/auth/user' && request.method()==='GET'){
        authReads++;if(authMode==='hold')await new Promise(resolve=>release=resolve);
        if(authMode==='error')return route.fulfill({status:500,contentType:'application/json',body:'{"message":"Authentication unavailable"}'});
        if(authMode==='guest')return route.fulfill({status:401,contentType:'application/json',body:'{"message":"Isolated guest session"}'});
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'local-ui-fixture',userType:'host',emailVerified:true,firstName:'Fixture',lastName:'User',email:'fixture@example.invalid',phone:'2025550146'})});
      }
      if(registration && request.method()==='POST' && url.pathname==='/api/auth/customer/register'){
        const p=request.postDataJSON();assert.equal(p.accountType,'host');assert.equal(p.intendedNextPath,'/host-signup');
        localRegistrationResponses++;
        return route.fulfill({status:201,contentType:'application/json',body:'{"message":"Browser-local fixture. Verification is still required."}'});
      }
      if(!['GET','HEAD'].includes(request.method())){blockedWrites++;return route.abort();}
      if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,contentType:'application/json',body:'{"message":"No live account data used in this observation"}'});
      return route.continue();
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    try {
      await page.goto('https://www.mealscout.us'+(registration?'/customer-signup?role=host':'/host-signup'),{waitUntil:'domcontentloaded',timeout:30000});
      if(registration){
        for(const [id,value] of [['input-email','fixture@example.invalid'],['input-first-name','Fixture'],['input-last-name','User'],['input-phone','2025550146'],['input-host-location-name','Local-only fixture'],['input-password','TestOnly!Route2026'],['input-confirm-password','TestOnly!Route2026']])await page.getByTestId(id).fill(value);
        await page.getByTestId('checkbox-phone-contact-consent').uncheck();
        await page.getByTestId('button-create-account').click();
        await page.waitForURL(url=>url.pathname==='/post-verification',{timeout:10000});
        const url=new URL(page.url());assert.equal(url.searchParams.get('redirect'),'/host-signup');assert.equal(url.searchParams.get('status'),'check-email');assert.equal(url.searchParams.get('verified'),null);
        assert.equal(localRegistrationResponses,1);await page.getByText('Parking host setup',{exact:true}).waitFor();
      }else if(scenario==='session-error-retry'){
        await page.getByRole('button',{name:'Retry session check'}).waitFor();assert.equal(new URL(page.url()).pathname,'/host-signup');
        authMode='authenticated';await page.getByRole('button',{name:'Retry session check'}).click();await page.locator('#businessName').waitFor();
      }else{
        await page.waitForTimeout(400);assert.equal(new URL(page.url()).pathname,'/host-signup');assert.equal(await page.locator('#businessName').count(),0);
        for(let i=0;i<50&&typeof release!=='function';i++)await page.waitForTimeout(50);
        assert.equal(typeof release,'function');authMode=scenario==='confirmed-guest'?'guest':'authenticated';release();
        if(scenario==='confirmed-guest'){await page.waitForURL(url=>url.pathname==='/customer-signup');assert.equal(new URL(page.url()).searchParams.get('role'),'host');}
        else await page.locator('#businessName').waitFor();
      }
      assert.deepEqual(errors,[]);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      if(!registration&&scenario!=='confirmed-guest')assert.equal(overflow,false);
      report.cases.push({width,scenario,passed:true,localRegistrationResponses,blockedWrites,authReads,backendWriteMade:false,overflow});
    } catch(error){report.cases.push({width,scenario,passed:false,localRegistrationResponses,blockedWrites,authReads,errors,error:String(error)});throw error;}
    finally{await context.close();}
  }
  report.after=await version();assert.equal(report.cases.length,12);report.result='pass';
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}
finally{
  await browser?.close();fs.rmSync(temp,{recursive:true,force:true});report.ownedCheckoutRemoved=!fs.existsSync(temp);report.finishedAt=new Date().toISOString();
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'signup-handoff-live.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>Live signup handoff observation</h1><a href="signup-handoff-live.json">Observed scope and results</a>');
  fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');console.log('SIGNUP_HANDOFF_LIVE '+JSON.stringify(report));
}
