/** Full server/index.ts, real Passport/PostgreSQL sessions and native PostgreSQL.
 * Run only against the fresh owned MealScout runtime named by
 * MEALSCOUT_NATIVE_ORDERS_RUNTIME with MEALSCOUT_NATIVE_ORDERS_WIDTH=1440 or 390.
 * Use one fresh runtime per viewport to preserve the real login rate limit.
 * Account/claim handlers are real; email delivery
 * is a local sink. Orders are explicitly seeded fixtures, not paid purchases.
 * Only named response faults are intercepted. Recovery reads hit the real server.
 * Never runs against a deployed app, existing customer database, or payment API.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium, expect, request } = require('@playwright/test');
const { Pool } = require('pg');
require('tsx/cjs');
const { readOwnerOrdersResponse } = require('../../client/src/lib/owner-orders-response.ts');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = text => createHash('sha256').update(text).digest('hex');

async function main() {
  assert.equal(process.env.MEALSCOUT_NATIVE_ORDERS_TEST, '1', 'Explicit native fixture opt-in required');
  const runtimePath = path.resolve(process.env.MEALSCOUT_NATIVE_ORDERS_RUNTIME || '');
  const allowedRoot = path.join(root, '.qa-evidence/native-orders/runs') + path.sep;
  assert.ok(runtimePath.startsWith(allowedRoot), 'Runtime must be inside this task-owned evidence directory');
  const config = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
  assert.equal(path.resolve(config.root), root);
  const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(config.source, source, 'Runtime and checked-out source must match');
  const target = new URL(config.databaseUrl), base = new URL(config.base);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/mealscout_owner_journey_test');
  assert.equal(target.port, String(config.databasePort));
  assert.equal(target.searchParams.get('sslmode'), 'disable');
  assert.equal(base.protocol, 'http:'); assert.equal(base.hostname, '127.0.0.1');
  assert.equal(base.port, String(config.appPort));
  const out = path.join(config.output, 'native-orders-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await fs.mkdir(out);
  const report = { scope: 'Actual MealScout server/index.ts, native PostgreSQL and real persisted password sessions; seeded orders and local email sink; not Stripe payment or migration replay acceptance',
    source, startedAt: new Date().toISOString(), cases: [], http: [], browserHttp: [], injectedFaults: [], blockedBrowserOrigins: [], pageErrors: [], evidence: [] };
  const pool = new Pool({ connectionString: config.databaseUrl });
  const contexts = []; let browser; let ordersBefore; let renamed = false;
  const stage = async (name, fn, page) => {
    const started = Date.now();
    try { await fn(); report.cases.push({ name, status: 'pass', elapsedMs: Date.now()-started }); console.log('NATIVE PASS ' + name); return true; }
    catch(error) { report.cases.push({ name, status: 'fail', error: error.stack || String(error), elapsedMs: Date.now()-started }); console.error('NATIVE FAIL ' + name + ': ' + error.message);
      if(page) await shot(page, 'failure-' + report.cases.length).catch(()=>{}); return false; }
  };
  async function shot(page, name) {
    const file=name+'.png'; await page.screenshot({ path:path.join(out,file),fullPage:true }); report.evidence.push(file);
  }
  async function call(ctx, method, endpoint, data, expected=200) {
    assert.ok(endpoint.startsWith('/api/'));
    const res=await ctx.fetch(base.origin+endpoint,{method,data,maxRedirects:0});
    const body=await res.json(); report.http.push({method,endpoint,status:res.status()});
    assert.equal(res.status(),expected,endpoint+': '+JSON.stringify(body)); return {res,body};
  }
  async function account(label, listingId) {
    const ctx=await request.newContext({baseURL:base.origin,extraHTTPHeaders:{Origin:base.origin}}); contexts.push(ctx);
    const email=label+'-'+randomUUID()+'@example.test', password='Native-Test-'+randomBytes(16).toString('hex')+'!9aA';
    const phone=label==='owner'?'8505550123':'8505550124';
    await call(ctx,'POST','/api/auth/restaurant/register',{email,password,phone,firstName:'Synthetic',lastName:'Orders Owner',acceptTerms:true,businessType:'food_truck'},201);
    let link;
    for(let i=0;i<50;i++) {
      const messages=(await fs.readFile(config.mailbox,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
      const message=messages.find(x=>x.to===email&&JSON.stringify(x).includes('/api/auth/verify-email'));
      link=String(message?.text||message?.html).match(/http:\/\/127\.0\.0\.1:\d+\/api\/auth\/verify-email\?[^\s"<>]+/)?.[0]?.replaceAll('&amp;','&');
      if(link)break; await pause(100);
    }
    assert.ok(link,'Verification must reach the local delivery sink'); assert.equal(new URL(link).origin,base.origin);
    assert.equal((await ctx.get(link,{maxRedirects:0})).status(),302);
    await call(ctx,'POST','/api/auth/restaurant/login',{email,password});
    const {body:claimed}=await call(ctx,'POST','/api/truck-claims',{listingId,restaurantData:{name:config.listingName+(label==='owner'?'':' Annex'),address:label==='owner'?config.listingAddress:'202 Synthetic Fixture Way',city:'Pensacola',state:'FL',phone,businessType:'food_truck',cuisineType:'american',acceptTerms:true}});
    const {body:user}=await call(ctx,'GET','/api/auth/user');
    assert.equal(user.emailVerified,true);assert.equal(user.userType,'food_truck');assert.equal(claimed.restaurant.ownerId,user.id);
    return {ctx,user,restaurant:claimed.restaurant,email,password};
  }
  async function snapshotOrders() {
    const rows=(await pool.query('select row_to_json(o) as value from pickup_orders o order by id')).rows;
    const items=(await pool.query('select row_to_json(i) as value from pickup_order_items i order by id')).rows;
    return sha(JSON.stringify({rows,items}));
  }
  async function login(page,actor,destination) {
    await page.goto(base.origin+'/login?redirect='+encodeURIComponent(destination));
    const chooser=page.getByTestId('button-email-login');
    await expect(chooser).toBeVisible();await chooser.click();
    await page.getByTestId('input-email').fill(actor.email);
    await page.getByTestId('input-password').fill(actor.password);
    const reply=page.waitForResponse(r=>r.url().includes('/api/auth/')&&r.url().endsWith('/login')&&r.request().method()==='POST');
    await page.getByTestId('button-login-submit').click();assert.equal((await reply).status(),200);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await page.goto(base.origin+destination);
  }
  function endpoint(view,id){return '/api/owner/'+(view==='kitchen'?'kitchen-queue':'orders')+'/'+id;}
  function destination(view,id){return '/'+view+'?restaurantId='+encodeURIComponent(id);}
  async function unverified(page,view,access=false){
    await expect(page.getByRole('heading',{name:access?'Order access is unavailable':'Orders could not be loaded',exact:true})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText:access?'Order access is unavailable':'Orders could not be loaded'})).toBeVisible();
    await expect(page.getByText('No orders yet',{exact:true})).toHaveCount(0);
    await expect(page.locator('[data-testid^="owner-order-"]')).toHaveCount(0);
    await expect(page.locator('[data-owner-orders-workspace] section').first().getByText('\u2014',{exact:true})).toHaveCount(4);
    if(view==='kitchen'){await expect(page.getByText('Updates unverified',{exact:true})).toBeVisible();await expect(page.getByText('Live updates',{exact:true})).toHaveCount(0);}
  }
  try {
    assert.equal((await pool.query("select current_database() as db, (select count(*)::int from users) as users, (select count(*)::int from pickup_orders) as orders")).rows[0].users,0,'Use a new runtime for each attempt');
    const version=(await pool.query("select version(),current_database(),current_setting('listen_addresses') as listen,current_setting('TimeZone') as timezone")).rows[0];
    assert.equal(version.current_database,'mealscout_owner_journey_test');assert.equal(version.listen,'127.0.0.1');report.database=version;
    let owner,other;
    if(!await stage('real owner registration, local verification, password session and exact claim',async()=>{owner=await account('owner',config.listingId);}))return;
    if(!await stage('second real owner has an isolated business/session',async()=>{other=await account('other',config.otherListingId);}))return;
    const emptyId=randomUUID(), orderIds=[], now=Date.now();let confirmedId;
    if(!await stage('seed 55 explicit order fixtures without activating ordering or Stripe',async()=>{
      await pool.query("insert into restaurants (id,owner_id,name,address,business_type,is_food_truck) values ($1,$2,'Synthetic Empty Kitchen','202 Synthetic Fixture Way','food_truck',true)",[emptyId,owner.user.id]);
      const statuses=['confirmed','preparing','ready','completed','cancelled','cancellation_pending','payment_disputed','pending','out_for_delivery','delivered'];
      for(let i=0;i<55;i++){
        const id=randomUUID(),status=statuses[i]||'completed';orderIds.push(id);if(i===0)confirmedId=id;
        await pool.query('insert into pickup_orders (id,restaurant_id,customer_name,status,subtotal_cents,platform_fee_cents,total_cents,payment_method,payout_status,special_instructions,created_at) values ($1,$2,$3,$4,1250,100,1350,\'card\',$5,$6,$7)',
          [id,owner.restaurant.id,'Synthetic Native Customer '+i,status,status==='pending'?'pending':status==='cancellation_pending'?'reversal_pending':status==='payment_disputed'?'disputed':'transferred','No nuts. Keep item notes.',new Date(now-i*1000)]);
        await pool.query('insert into pickup_order_items (order_id,item_name,base_price_cents,quantity,line_total_cents,special_instructions,selected_variant,selected_modifiers) values ($1,$2,1250,1,1250,$3,$4,$5)',
          [id,'Native Fixture Lunch '+i,'No sauce',JSON.stringify({label:'Regular'}),JSON.stringify([{groupName:'Side',label:'Rice'}])]);
      }
      const truth=(await pool.query('select ordering_approved_at,stripe_charges_enabled,stripe_payouts_enabled from restaurants where id=$1',[owner.restaurant.id])).rows[0];
      assert.equal(truth.ordering_approved_at,null);assert.equal(truth.stripe_charges_enabled,false);assert.equal(truth.stripe_payouts_enabled,false);
      ordersBefore=await snapshotOrders();report.fixture={businessId:owner.restaurant.id,otherBusinessId:other.restaurant.id,emptyBusinessId:emptyId,orderCount:55,confirmedId,ordersBefore};
    }))return;
    await stage('actual PostgreSQL history: 50 + 5 records, preserved notes, distinct page identities',async()=>{
      const pages=[];
      for(const page of [1,2]){
        const {res,body}=await call(owner.ctx,'GET',endpoint('orders',owner.restaurant.id)+'?page='+page);
        const parsed=await readOwnerOrdersResponse(new Response(await res.body(),{status:res.status()}),owner.restaurant.id);
        assert.equal(parsed.page,page);assert.equal(parsed.orders.length,page===1?50:5);assert.equal(parsed.hasMore,page===1);
        assert.deepEqual(parsed.orders,body.orders);pages.push(...parsed.orders);
        await fs.writeFile(path.join(out,'actual-history-page-'+page+'.json'),JSON.stringify(body,null,2));
      }
      assert.equal(new Set(pages.map(x=>x.id)).size,55);
      assert.ok(pages.every(x=>x.totalCents===1350&&x.items[0].specialInstructions==='No sauce'));
    });
    await stage('actual kitchen response is accepted without invented unpaid/completed entries',async()=>{
      const {res,body}=await call(owner.ctx,'GET',endpoint('kitchen',owner.restaurant.id));
      const parsed=await readOwnerOrdersResponse(new Response(await res.body(),{status:res.status()}),owner.restaurant.id);
      assert.equal(parsed.orders.length,6);assert.deepEqual(new Set(parsed.orders.map(x=>x.status)),new Set(['confirmed','preparing','ready','cancellation_pending','payment_disputed','out_for_delivery']));
      await fs.writeFile(path.join(out,'actual-kitchen-response.json'),JSON.stringify(body,null,2));
    });
    await stage('real guest and wrong-owner reads return 401/403 without exposing order rows',async()=>{
      const guest=await request.newContext({baseURL:base.origin});contexts.push(guest);
      for(const view of ['orders','kitchen']){
        for(const [ctx,status]of[[guest,401],[other.ctx,403]]){
          const {body}=await call(ctx,'GET',endpoint(view,owner.restaurant.id),undefined,status);assert.ok(!Array.isArray(body.orders));
        }
      }
    });
    browser=await chromium.launch({headless:true});
    const width=Number(process.env.MEALSCOUT_NATIVE_ORDERS_WIDTH);
    assert.ok([1440,390].includes(width),'One explicitly selected viewport per fresh native runtime is required');
    report.viewport={width,height:width===1440?900:844};
    for(const viewport of [report.viewport])for(const view of ['orders','kitchen']){
      const label=view+' '+viewport.width;
      const context=await browser.newContext({viewport,serviceWorkers:'block'});contexts.push(context);
      await context.route('**/*',route=>{
        const u=new URL(route.request().url());
        if(u.origin===base.origin||['data:','blob:'].includes(u.protocol))return route.continue();
        report.blockedBrowserOrigins.push(u.origin);return route.abort('blockedbyclient');
      });
      await context.tracing.start({screenshots:true,snapshots:true,sources:true});
      const page=await context.newPage();const pageErrors=[];const writes=[];
      page.on('pageerror',error=>{pageErrors.push(error.message);report.pageErrors.push({label,message:error.message});});
      page.on('request',req=>{const u=new URL(req.url());if(u.origin===base.origin&&/\/api\/(?:owner\/(?:orders|kitchen-queue)|pickup-orders)/.test(u.pathname)&&req.method()!=='GET')writes.push({method:req.method(),path:u.pathname});});
      page.on('response',res=>{const u=new URL(res.url());if(u.origin===base.origin&&u.pathname.startsWith('/api/'))report.browserHttp.push({label,method:res.request().method(),path:u.pathname,status:res.status()});});
      const routePath=destination(view,owner.restaurant.id),pattern='**'+endpoint(view,owner.restaurant.id)+'*';
      const card=page.getByTestId('owner-order-'+confirmedId);
      try{
        if(!await stage(label+': real browser password login and server-owned order details',async()=>{
          await login(page,owner,routePath);await expect(card).toContainText('Native Fixture Lunch 0');await expect(card).toContainText('No sauce');await expect(card).toContainText('Rice');await expect(card).toContainText('$13.50');
          assert.ok((await pool.query('select count(*)::int as n from sessions')).rows[0].n>0,'Real PostgreSQL session storage required');
          await shot(page,label+'-normal');
        },page))continue;
        await stage(label+': real native SQL read failure hides stale actions and retries successfully',async()=>{
          await pool.query('ALTER TABLE pickup_order_items RENAME TO pickup_order_items_native_read_outage');renamed=true;
          try{await page.getByRole('button',{name:'Refresh',exact:true}).click();await unverified(page,view);await shot(page,label+'-database-failure');}
          finally{await pool.query('ALTER TABLE pickup_order_items_native_read_outage RENAME TO pickup_order_items');renamed=false;}
          await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(card).toContainText('Native Fixture Lunch 0');
        },page);
        for(const fault of ['html','mixed-business'])await stage(label+': '+fault+' read fault is rejected and the next real server read recovers',async()=>{
          const handler=async route=>{
            const upstream=await route.fetch();assert.equal(upstream.status(),200);const payload=await upstream.json();assert.ok(payload.orders.some(x=>x.id===confirmedId));
            report.injectedFaults.push({label,type:fault,method:'GET',upstreamStatus:200});
            if(fault==='html')return route.fulfill({status:200,contentType:'text/html',body:'<html>Temporary upstream response</html>'});
            return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...payload,orders:[...payload.orders,{...payload.orders[0],id:'synthetic-foreign-row',restaurantId:other.restaurant.id}]})});
          };
          await page.route(pattern,handler);
          try{await page.getByRole('button',{name:'Refresh',exact:true}).click();await unverified(page,view);}
          finally{await page.unroute(pattern,handler);}
          await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(card).toContainText('No sauce');
        },page);
        await stage(label+': a held real response cannot announce zero counts or accept duplicate retry',async()=>{
          let release,reached;const pending=new Promise(r=>{release=r;}),hit=new Promise(r=>{reached=r;});let reads=0;
          const fault=async route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Explicit native-recovery transport fixture'})});
          await page.route(pattern,fault);await page.getByRole('button',{name:'Refresh',exact:true}).click();await unverified(page,view);await page.unroute(pattern,fault);
          const hold=async route=>{reads++;const upstream=await route.fetch();assert.equal(upstream.status(),200);reached();await pending;return route.fulfill({response:upstream});};
          await page.route(pattern,hold);
          try{
            await page.getByRole('button',{name:'Try again',exact:true}).click();await hit;
            await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Refresh',exact:true})).toHaveAttribute('aria-busy','true');
            await expect(page.getByRole('button',{name:/^(All|Needs attention|Completed|Cancelled) [0-9]+$/})).toHaveCount(0);await expect(page.getByText('No orders yet',{exact:true})).toHaveCount(0);assert.equal(reads,1);
          }finally{release();}
          await expect(card).toContainText('Native Fixture Lunch 0');await page.unroute(pattern,hold);report.injectedFaults.push({label,type:'503 then held real 200',method:'GET'});
        },page);
        await stage(label+': a different owned business has a truly empty database response',async()=>{
          await page.goto(base.origin+destination(view,emptyId));await expect(page.getByText('No orders yet',{exact:true})).toBeVisible();await expect(page.locator('[data-testid^="owner-order-"]')).toHaveCount(0);
          await page.goto(base.origin+routePath);await expect(card).toContainText('Native Fixture Lunch 0');
        },page);
        await stage(label+': a real expired session provides a sign-in route back to this exact business',async()=>{
          const cookie=(await context.cookies(base.origin)).find(x=>x.name==='tradescout.sid');
          assert.ok(cookie,'An actual signed session cookie is required');
          const sid=decodeURIComponent(cookie.value).replace(/^s:/,'').split('.')[0];
          const expired=await pool.query("UPDATE sessions SET expire=NOW()-INTERVAL '1 second' WHERE sid=$1 RETURNING sid",[sid]);
          assert.equal(expired.rowCount,1,'Expire only this browser session in the actual PostgreSQL store');
          await page.getByRole('button',{name:'Refresh',exact:true}).click();await unverified(page,view,true);await shot(page,label+'-expired-session');
          const signin=page.getByRole('link',{name:'Sign in again',exact:true});await expect(signin).toBeVisible();
          const href=await signin.getAttribute('href');assert.ok(href.startsWith('/login?'));assert.ok(decodeURIComponent(href).includes(routePath));
          await signin.click();
          const chooser=page.getByTestId('button-email-login');await expect(chooser).toBeVisible();await chooser.click();
          await page.getByTestId('input-email').fill(owner.email);await page.getByTestId('input-password').fill(owner.password);await page.getByTestId('button-login-submit').click();
          await expect(page).toHaveURL(base.origin+routePath);await expect(card).toContainText('Native Fixture Lunch 0');await shot(page,label+'-session-recovered');
        },page);
        await stage(label+': recovery made no order writes and raised no page exceptions',async()=>{assert.deepEqual(writes,[]);assert.deepEqual(pageErrors,[]);});
      }finally{await context.tracing.stop({path:path.join(out,label+'-trace.zip')});await context.close();contexts.splice(contexts.indexOf(context),1);}
    }
    await stage('all order/item/financial fields remain byte-identical after recovery',async()=>{report.ordersAfter=await snapshotOrders();assert.equal(report.ordersAfter,ordersBefore);});
  }catch(error){report.fatal=error.stack||String(error);console.error(error);process.exitCode=1;}
  finally{
    if(renamed)await pool.query('ALTER TABLE pickup_order_items_native_read_outage RENAME TO pickup_order_items').catch(e=>{report.cleanupError=e.message;});
    for(const context of contexts)await(context.dispose?context.dispose():context.close()).catch(()=>{});
    await browser?.close();await pool.end();
    report.finishedAt=new Date().toISOString();report.pass=report.cases.filter(x=>x.status==='pass').length;report.fail=report.cases.filter(x=>x.status==='fail').length;
    await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2));
    console.log('NATIVE SUMMARY '+JSON.stringify({output:out,source,pass:report.pass,fail:report.fail,pageErrors:report.pageErrors.length,fatal:report.fatal||null}));
    if(report.fail||report.fatal||report.cleanupError)process.exitCode=1;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
