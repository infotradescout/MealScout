import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=process.cwd(),candidate=String(process.env.MEAL_TRAFFIC_DASHBOARD_SHA||'');assert.match(candidate,/^[a-f0-9]{40}$/);
for(const key of ['DATABASE_URL','TEST_DATABASE_URL','STRIPE_SECRET_KEY','BREVO_API_KEY','SMTP_PASS','SESSION_SECRET'])assert(!process.env[key],'No production credentials: '+key);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'meal-traffic-dashboard-')),checkout=path.join(temp,'source'),tools=path.join(temp,'tools');
const output=path.join(root,'test-results/recovery-isolated-report');fs.mkdirSync(output,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));Object.assign(env,{CI:'true',TZ:'UTC',NODE_ENV:'development',NODE_OPTIONS:'--max-old-space-size=3072'});
const report={candidate,base:'d64ef420f537b78e00fc93c8d8aa1baba84a976f',harness:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),startedAt:new Date().toISOString(),result:'fail',steps:[],productionWrites:0,scope:'New read-only retained-traffic report and actual admin component API fixtures; not native PostgreSQL concurrency, production login or customer growth.'};
function run(label,command,args,cwd=checkout,extra={}){
 console.log('MEAL_DASHBOARD_START '+label);const result=spawnSync(command,args,{cwd,env:{...env,...extra},encoding:'utf8',timeout:900000,maxBuffer:96*1024*1024});
 fs.writeFileSync(path.join(output,label+'.log'),(result.stdout||'')+(result.stderr||''));const step={label,exit:result.status,at:new Date().toISOString()};report.steps.push(step);console.log((result.stdout||'').slice(-16000));console.log((result.stderr||'').slice(-8000));console.log('MEAL_DASHBOARD_STEP '+JSON.stringify(step));assert.equal(result.status,0,label+' failed: '+(result.error||'see log'));return(result.stdout||'').trim();
}
try{
 run('clone','git',['clone','--no-hardlinks','--no-checkout',root,checkout],temp);run('fetch','git',['fetch','--no-tags','https://github.com/infotradescout/MealScout.git',candidate]);run('checkout','git',['checkout','--detach',candidate]);assert.equal(run('identity','git',['rev-parse','HEAD']),candidate);assert.equal(run('initial-clean','git',['status','--porcelain']),'');
 const allowed=new Set(['shared/acquisitionQuality.ts','server/services/acquisitionQuality.ts','server/routes/acquisitionQualityRoutes.ts','server/routes/analyticsEvidenceRoutes.ts','server/routes/analyticsRoutes.ts','client/src/pages/admin-discovery-evidence.tsx','client/src/pages/admin-discovery-observatory.tsx','client/src/components/TrafficQualityPanel.tsx','scripts/traffic-quality-dashboard.test.mjs','scripts/traffic-quality-dashboard.browser.mjs']);
 assert(run('bounded-diff','git',['diff','--name-only',report.base,candidate]).split('\n').every(file=>allowed.has(file)));
 run('npm-ci','npm',['ci','--include=dev','--no-audit','--no-fund']);fs.mkdirSync(tools);fs.writeFileSync(path.join(tools,'package.json'),'{"private":true,"type":"module"}');run('disposable-sql-tool','npm',['install','--no-audit','--no-fund','--save-exact','@electric-sql/pglite@0.5.4'],tools);
 const module=createRequire(path.join(tools,'package.json')).resolve('@electric-sql/pglite');
 run('new-api-and-sql',process.execPath,['--import','tsx','--test','scripts/traffic-quality-dashboard.test.mjs'],checkout,{MEAL_QUALITY_PGLITE_MODULE:pathToFileURL(module).href});
 run('typecheck','npm',['run','check']);
 run('changed-lint',process.execPath,['node_modules/eslint/bin/eslint.js','shared/acquisitionQuality.ts','server/services/acquisitionQuality.ts','server/routes/acquisitionQualityRoutes.ts','server/routes/analyticsRoutes.ts','client/src/pages/admin-discovery-observatory.tsx','client/src/components/TrafficQualityPanel.tsx']);
 run('platform-build','npm',['run','build:platform']);
 for(const script of ['test:discovery-observatory','test:public-data-boundary','test:public-discovery-contract','test:public-restaurant-indexability','test:profile-action-policy'])run(script.replaceAll(':','-'),'npm',['run',script]);
 run('chromium',process.execPath,['node_modules/playwright/cli.js','install','chromium']);run('actual-dashboard-browser',process.execPath,['scripts/traffic-quality-dashboard.browser.mjs'],checkout,{MEAL_QUALITY_BROWSER_OUTPUT:output});
 assert.equal(run('tracked-source-clean','git',['diff','--exit-code']),'');assert.equal(run('final-clean','git',['status','--porcelain']),'');report.result='pass';
}catch(error){report.error=String(error.stack||error);}
finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'traffic-dashboard-evidence.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'index.html'),'<meta name="robots" content="noindex,nofollow"><h1>Retained-traffic dashboard checks</h1><a href="traffic-dashboard-evidence.json">Execution receipt</a>');fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');console.log('MEAL_DASHBOARD_SUMMARY '+JSON.stringify(report));fs.rmSync(temp,{recursive:true,force:true});if(report.result!=='pass')process.exitCode=1;}
