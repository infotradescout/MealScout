// Additional component scenarios only. All HTTP/Stripe/storage are fixtures;
// no actual booking, payment, cancellation, or provider call is performed.
const assert = require('node:assert/strict');
module.exports = async ({ test, paymentSetup }) => {
  const requestCalls = calls => calls.filter(c => c.url.endsWith('/book'));
  const common = url => ({ body: url === '/api/payout/balance' ? { balance: 5 } : paymentSetup });
  const startRequest = async page => page.getByRole('button', { name: 'Continue', exact: true }).click();
  const retry = async page => page.getByRole('button', { name: 'Retry same booking request', exact: true }).click();
  await test('lost initial response retries identical saved key and input', async ({ page, calls, setHandler, start }) => {
    let first = true;
    setHandler(async url => url.endsWith('/book') && first ? (first = false, { abort: true }) : common(url));
    await start(); await page.locator('#parking-pass-promo').fill('ORIGINAL'); await startRequest(page);
    await page.getByText('Unfinished booking request', { exact: true }).waitFor();
    assert.ok(await page.locator('#parking-pass-promo').isDisabled());
    await retry(page); await page.getByTestId('card-field').waitFor();
    const [a,b] = requestCalls(calls); assert.equal(requestCalls(calls).length, 2);
    assert.equal(a.headers['Idempotency-Key'], b.headers['Idempotency-Key']); assert.deepEqual(a.body, b.body);
    assert.equal(a.body.promoCode, 'ORIGINAL'); assert.equal(await page.evaluate(() => window.__stripeCalls.length), 0);
  });
  await test('remount recovers the original initial request from session storage', async ({ page, calls, setHandler, start }) => {
    let first = true; setHandler(async url => url.endsWith('/book') && first ? (first=false,{abort:true}) : common(url));
    await start(); await startRequest(page); await page.getByText('Unfinished booking request',{exact:true}).waitFor();
    await page.evaluate(() => window.__remount()); await page.getByText('Unfinished booking request',{exact:true}).waitFor();
    await retry(page); await page.getByTestId('card-field').waitFor();
    const [a,b]=requestCalls(calls); assert.equal(a.headers['Idempotency-Key'],b.headers['Idempotency-Key']); assert.deepEqual(a.body,b.body);
  });
  await test('in-progress server response retains one replay identity', async ({ page,calls,setHandler,start }) => {
    let first=true;setHandler(async url=>url.endsWith('/book')&&first?(first=false,{status:409,body:{code:'request_in_progress',message:'A matching request is already in progress.'}}):common(url));
    await start();await startRequest(page);await page.getByRole('alert').waitFor();await retry(page);await page.getByTestId('card-field').waitFor();
    assert.equal(requestCalls(calls)[0].headers['Idempotency-Key'],requestCalls(calls)[1].headers['Idempotency-Key']);
  });
  await test('same-tick initial submits and dismissal cannot duplicate or abandon an in-flight request',async({page,calls,setHandler,start})=>{
    setHandler(async url=>url.endsWith('/book')?new Promise(()=>{}):common(url));await start();
    await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue');button.click();button.click();});
    await page.getByText('Unfinished booking request',{exact:true}).waitFor();await page.getByRole('button',{name:'Close dialog'}).click();
    assert.equal(await page.getByRole('dialog').count(),1);assert.equal(requestCalls(calls).length,1);
  });
  await test('blocked recovery storage prevents an initial POST',async({page,calls,start})=>{
    await page.evaluate(()=>{const original=sessionStorage.setItem;sessionStorage.setItem=(key,value)=>{if(key.startsWith('mealscout:parking-request:'))throw new Error('Storage disabled');return original(key,value);};});
    await start();await startRequest(page);await page.getByRole('alert').waitFor();assert.equal(requestCalls(calls).length,0);
    assert.match(await page.getByRole('alert').innerText(),/storage is unavailable/);
  });
  await test('malformed successful response retains the initial request for recovery',async({page,calls,setHandler,start})=>{
    let first=true;setHandler(async url=>url.endsWith('/book')&&first?(first=false,{body:{}}):common(url));
    await start();await startRequest(page);await page.getByRole('alert').waitFor();await retry(page);await page.getByTestId('card-field').waitFor();
    assert.equal(requestCalls(calls)[0].headers['Idempotency-Key'],requestCalls(calls)[1].headers['Idempotency-Key']);
  });
  await test('definitive input rejection allows corrected input with a new identity',async({page,calls,setHandler,start})=>{
    let first=true;setHandler(async url=>url.endsWith('/book')&&first?(first=false,{status:400,body:{message:'Invalid promo code'}}):common(url));
    await start();await page.locator('#parking-pass-promo').fill('BAD');await startRequest(page);await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('#parking-pass-promo').isDisabled(),false);await page.locator('#parking-pass-promo').fill('CORRECT');
    await startRequest(page);await page.getByTestId('card-field').waitFor();const [a,b]=requestCalls(calls);
    assert.notEqual(a.headers['Idempotency-Key'],b.headers['Idempotency-Key']);assert.equal(b.body.promoCode,'CORRECT');
  });
  await test('another account cannot load the saved initial request',async({page,calls,setHandler,start})=>{
    setHandler(async url=>url.endsWith('/book')?{abort:true}:common(url));await start();await startRequest(page);await page.getByRole('alert').waitFor();
    await page.evaluate(()=>{window.__userId='qa-other-account';window.__remount();});await page.getByRole('button',{name:'Continue',exact:true}).waitFor();
    assert.equal(await page.getByText('Unfinished booking request',{exact:true}).count(),0);assert.equal(requestCalls(calls).length,1);
  });
  await test('expired initial request is retained but cannot be replayed automatically',async({page,calls,setHandler,start})=>{
    setHandler(async url=>url.endsWith('/book')?{abort:true}:common(url));await start();await startRequest(page);await page.getByRole('alert').waitFor();
    await page.evaluate(()=>{for(const [key,value] of window.__storage){if(key.startsWith('mealscout:parking-request:')){const row=JSON.parse(value);row.createdAt=Date.now()-24*60*60*1000;window.__storage.set(key,JSON.stringify(row));}}window.__remount();});
    await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/too old/);
    assert.ok(await page.getByRole('button',{name:'Retry same booking request',exact:true}).isDisabled());assert.equal(requestCalls(calls).length,1);
  });
  await test('manual-review response remains pending rather than confirmed',async({page,calls,setHandler,start})=>{
    setHandler(async url=>url.endsWith('/book')?{status:202,body:{paymentPending:true,bookingIds:['qa-pending']}}:common(url));
    await start();await startRequest(page);await page.waitForFunction(()=>window.__outcomes.length===1);
    assert.deepEqual(await page.evaluate(()=>window.__outcomes),[{outcome:'pending'}]);assert.equal(await page.evaluate(()=>window.__stripeCalls.length),0);
    assert.equal(await page.evaluate(()=>[...window.__storage.keys()].filter(k=>k.startsWith('mealscout:parking-request:')).length),1);
  });
};
