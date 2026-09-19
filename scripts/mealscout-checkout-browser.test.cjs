/** Real React/browser checkout regression with native primitive and storage/Stripe/API fixtures.
 * No live app, real storage permissions, routing library, authentication, Stripe SDK,
 * database or kitchen fulfillment is exercised. Network requests are blocked.
 * Normal runs bundle installed React in development mode. UI_REACT_RUNTIME is an explicit
 * offline override exporting window.ReactTestRuntime; its version is included in evidence.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { chromium } = require(process.env.UI_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
}}).outputText;
const source = fs.readFileSync(process.env.CHECKOUT_SOURCE_OVERRIDE || path.join(root, 'client/src/pages/pickup-checkout.tsx'), 'utf8');
assert.equal(ts.createSourceFile('checkout.tsx', source, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0);
const recoveryJS = compile(read('client/src/lib/pickupCheckoutRecovery.ts'));
const contactJS = compile(read('shared/orderContact.ts'));
const checkoutJS = compile(source.replace('import.meta.env.VITE_STRIPE_PUBLIC_KEY', '"pk_test_fixture"'));
const runtime = process.env.UI_REACT_RUNTIME ? fs.readFileSync(process.env.UI_REACT_RUNTIME, 'utf8') :
  require('esbuild').buildSync({ stdin: { contents: 'import * as React from "react"; import * as ReactDOM from "react-dom/client"; window.ReactTestRuntime = {React, ReactDOM};', resolveDir: root },
    bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' }).outputFiles[0].text;
const script = `
function fixtureStorage(){const data=new Map();return {getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear()};}
Object.defineProperty(window,'localStorage',{configurable:true,value:fixtureStorage()});
Object.defineProperty(window,'sessionStorage',{configurable:true,value:fixtureStorage()});
if(!crypto.randomUUID){let nextId=0;crypto.randomUUID=()=> 'fixture-request-'+(++nextId);}
window.fetch=async(url,options={})=>{const result=await window.__api(String(url),options);if(result.abort)throw new TypeError('Failed to fetch');return new Response(JSON.stringify(result.body),{status:result.status||200,headers:{'Content-Type':'application/json'}});};
const React = window.ReactTestRuntime.React;
const {createRoot} = window.ReactTestRuntime.ReactDOM;
let routePath = '/checkout/a'; const listeners = new Set();
const navigate = (p) => { routePath = p; listeners.forEach(fn => fn()); };
window.__navigate = navigate;
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const usePath = () => React.useSyncExternalStore(subscribe, () => routePath);
function primitive(tag) { return React.forwardRef(({children,variant,asChild,...props},ref) => React.createElement(tag,{...props,ref},children)); }
const radioContext = React.createContext({});
function RadioGroup({children,onValueChange,value}) { return React.createElement(radioContext.Provider,{value:{value,onValueChange}},children); }
function RadioGroupItem({value,id}) {const group=React.useContext(radioContext); return React.createElement('input',{type:'radio',id,value,checked:group.value===value,onChange:()=>group.onValueChange?.(value)});}
const Link = ({href,children,...props}) => React.createElement('a',{...props,href,onClick:e=>{e.preventDefault();navigate(href);}},children);
window.__confirmCalls = []; window.__confirm = async () => ({paymentIntent:{status:'succeeded'}});
const stripe = {confirmPayment: options => { window.__confirmCalls.push(options); return window.__confirm(options); }};
const modules = {
  react: React,
  wouter: {Link,useParams:()=>({restaurantId:usePath().split('/')[2]}),useLocation:()=>[usePath(),navigate]},
  '@stripe/react-stripe-js': {Elements:({children,options})=>React.createElement('section',{'data-payment-secret':options.clientSecret},children),PaymentElement:()=>React.createElement('div',{'data-testid':'payment-element'},'Payment details fixture'),useStripe:()=>stripe,useElements:()=>({fixture:true})},
  '@stripe/stripe-js': {loadStripe:()=>Promise.resolve(stripe)},
  '@/components/public-ordering/PublicOrderingTopBar': {PublicOrderingTopBar:({secondaryHref})=>React.createElement('nav',{},React.createElement(Link,{href:secondaryHref},'Menu'))},
  '@/components/ui/button':{Button:primitive('button')},'@/components/ui/input':{Input:primitive('input')},'@/components/ui/label':{Label:primitive('label')},
  '@/components/ui/card':{Card:primitive('section'),CardContent:primitive('div'),CardHeader:primitive('header'),CardTitle:primitive('h2')},
  '@/components/ui/radio-group':{RadioGroup,RadioGroupItem},
  'lucide-react':new Proxy({}, {get:()=>()=>null}),
  '@/components/payment-browser-gate':{__esModule:true,default:()=>React.createElement('p',{},'Browser gate fixture')},
  '@/lib/inAppBrowser':{isPaymentHostileBrowser:()=>false},
  '@/lib/pickupCheckoutTruth':{toAuthoritativePaymentOrder:order=>({...order})},
};
function load(code) { const module={exports:{}}; new Function('require','exports','module','React',code)(id=>{if(!(id in modules))throw new Error('Unexpected module '+id);return modules[id];},module.exports,module,React);return module.exports; }
modules['@/lib/pickupCheckoutRecovery']=load(${JSON.stringify(recoveryJS)});
modules['@shared/orderContact']=load(${JSON.stringify(contactJS)});
const Checkout=load(${JSON.stringify(checkoutJS)}).default;
window.__recovery=modules['@/lib/pickupCheckoutRecovery'];
function App(){const current=usePath();return current.startsWith('/checkout/')?React.createElement(Checkout):React.createElement('p',{'data-testid':'destination'},current);}
window.__start = (seed) => {
  routePath=seed.path||'/checkout/a';
  localStorage.setItem('mealscout_cart',JSON.stringify(seed.cart||[]));
  for(const recovery of seed.recoveries||[]) window.__recovery.writePickupCheckoutRecovery(recovery);
  createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,{},React.createElement(App)));
};
window.__ready=true;
`;
const cartItem = (id='a') => ({restaurantId:id,menuId:'menu-'+id,menuItemId:'item-'+id,itemName:'Test meal '+id,quantity:1,lineTotalCents:1200,selectedModifierIds:[]});
const saved = (id='a') => {
  const token=id.repeat(64), request='request-'+id;
  return {version:1,restaurantId:id,checkoutRequestId:request,customerAccessToken:token,checkoutPayload:{restaurantId:id,menuId:'menu-'+id,customerName:'Test customer',customerEmail:'test@example.com',orderType:'pickup',paymentMethod:'card',checkoutRequestId:request,customerAccessToken:token,items:[{menuItemId:'item-'+id,quantity:1}]},orderId:'order-'+id,clientSecret:'untrusted-old-'+id,serverTotals:null,authoritativePaymentOrder:null,updatedAt:Date.now()};
};
const verified = (id='a') => ({order:{id:'order-'+id,status:'pending',merchantNameSnapshot:'Merchant '+id,pickupAddressSnapshot:'Test location '+id,subtotalCents:1200,mealscoutFeeCents:50,processingFeeCents:65,totalCents:1315,pricesIncludeTax:true},clientSecret:'verified-'+id,customerAccessToken:id.repeat(64)});
const menu = (id='a') => ({readiness:{restaurantName:'Merchant '+id,blockingReasons:[]},menus:[{id:'menu-'+id,isActive:true,orderingEnabled:true,pricesIncludeTax:true,paymentMethods:{card:true}}]});
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.UI_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
  const results=[]; let version;
  const scenario = async (name,run) => {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage(); const calls=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let handler=async (url)=>({status:200,body:menu(url.split('/').pop())});
    await page.route('**/*',route=>route.abort());
    await page.exposeFunction('__api',async(url,options)=>{
      const request={url,method:options.method||'GET',body:options.body?JSON.parse(options.body):null};calls.push(request);
      return handler(url,request);
    });
    try {
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({type:'module',content:runtime});
      await page.waitForFunction(()=>!!window.ReactTestRuntime);
      await page.addScriptTag({type:'module',content:script});
      await page.waitForFunction(()=>window.__ready);version=await page.evaluate(()=>ReactTestRuntime.React.version);
      await run({page,context,calls,setHandler:h=>handler=h, start:seed=>page.evaluate(seed=>window.__start(seed),seed)});
      assert.deepEqual(errors,[], 'No uncaught browser errors');results.push({name,status:'pass'});
    }catch(e){results.push({name,status:'fail',error:e.message});}
    finally{await context.close();}
  };
  try{
    await scenario('availability failure retry preserves native input and recovery identity',async({page,setHandler,start})=>{
      let failures=true;setHandler(async()=>failures?{status:503,body:{}}:{body:menu()});await start({cart:[cartItem()]});
      await page.getByRole('button',{name:'Retry availability'}).waitFor();await page.locator('#customer-name').fill('Retained name');
      const before=await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a').checkoutRequestId);
      failures=false;await page.getByRole('button',{name:'Retry availability'}).click();await page.getByText('Merchant a',{exact:true}).waitFor();
      assert.equal(await page.locator('#customer-name').inputValue(),'Retained name');assert.equal(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a').checkoutRequestId),before);
    });
    await scenario('saved checkout renders verified payment even with empty cart',async({page,setHandler,start,calls})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({recoveries:[saved()]});
      await page.locator('[data-payment-secret="verified-a"]').waitFor();assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>c.body),[saved().checkoutPayload]);
    });
    await scenario('merchant switch isolates saved payment and preserves destination recovery',async({page,setHandler,start})=>{
      setHandler(async(url,r)=>({body:url==='/api/pickup-orders'?verified(r.body.restaurantId):menu(url.split('/').pop())}));
      await start({cart:[cartItem('b')],recoveries:[saved('a'),saved('b')]});await page.locator('[data-payment-secret="verified-a"]').waitFor();
      await page.evaluate(()=>window.__navigate('/checkout/b'));await page.locator('[data-payment-secret="verified-b"]').waitFor({timeout:2000});
      const recovery=await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('b'));assert.equal(recovery.checkoutPayload.restaurantId,'b');assert.equal(recovery.checkoutRequestId,'request-b');
    });
    await scenario('late saved response cannot navigate or overwrite a new merchant',async({page,setHandler,start})=>{
      let release; const waiting=new Promise(r=>release=r);
      setHandler(async(url,r)=>{if(url==='/api/pickup-orders'){await waiting;return {body:{...verified(),order:{...verified().order,status:'paid'}}};}return {body:menu(url.split('/').pop())};});
      await start({cart:[cartItem('b')],recoveries:[saved()]});await page.getByText('Checking your saved checkout',{exact:true}).waitFor();
      await page.evaluate(()=>window.__navigate('/checkout/b'));release();await page.getByText('Merchant b',{exact:true}).waitFor({timeout:2000});
      assert.equal(await page.locator('[data-testid="destination"]').count(),0);assert.equal(await page.locator('[data-payment-secret]').count(),0);
    });
    await scenario('processing response preserves cart and durable checkout for status reconciliation',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({cart:[cartItem()],recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.evaluate(()=>window.__confirm=async()=>({paymentIntent:{status:'processing'}}));await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();await page.getByTestId('destination').waitFor();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mealscout_cart')).length),1);assert.ok(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a')));
    });
    await scenario('confirmed success clears only this merchant cart and recovery',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({cart:[cartItem(),cartItem('b')],recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();await page.getByTestId('destination').waitFor();
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('mealscout_cart')).map(i=>i.restaurantId)),['b']);assert.equal(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a')),null);
    });
    await scenario('same-tick repeated form submission invokes Stripe once',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.evaluate(()=>{window.__confirm=()=>new Promise(()=>{});const form=document.querySelector('form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
      assert.equal(await page.evaluate(()=>window.__confirmCalls.length),1);
    });
    await scenario('ambiguous payment failure exposes status action instead of repeat charge',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({cart:[cartItem()],recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.evaluate(()=>window.__confirm=async()=>{throw new Error('Connection interrupted');});await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();
      await page.getByRole('button',{name:'Check order status',exact:true}).waitFor({timeout:2000});assert.ok(await page.getByRole('button',{name:'Confirm Payment',exact:true}).isDisabled());
      assert.ok(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a')));
    });
    await scenario('late new order response cannot redirect a different merchant',async({page,setHandler,start})=>{
      let release, posted;const waiting=new Promise(r=>release=r), started=new Promise(r=>posted=r);
      setHandler(async(url,r)=>{if(url==='/api/pickup-orders'){posted();await waiting;return {body:{...verified(),order:{...verified().order,status:'paid'}}};}return {body:menu(url.split('/').pop())};});
      await start({cart:[cartItem(),cartItem('b')]});await page.getByText('Merchant a',{exact:true}).waitFor();
      await page.locator('#customer-name').fill('Test Customer');await page.locator('#customer-email').fill('test@example.com');await page.locator('#ot-pickup').check();
      await page.getByRole('button',{name:'Continue to secure payment',exact:true}).click();await started;
      await page.evaluate(()=>window.__navigate('/checkout/b'));release();await page.getByText('Merchant b',{exact:true}).waitFor();
      assert.equal(await page.getByTestId('destination').count(),0);assert.equal(await page.locator('[data-payment-secret]').count(),0);
      assert.equal(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a').checkoutPayload.restaurantId),'a');
    });
    await scenario('late payment completion does not clear a merchant after leaving its checkout',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu(url.split('/').pop())}));
      await start({cart:[cartItem(),cartItem('b')],recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.evaluate(()=>window.__confirm=()=>new Promise(resolve=>window.__finishPayment=resolve));await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();
      await page.evaluate(()=>window.__navigate('/checkout/b'));await page.getByText('Merchant b',{exact:true}).waitFor();
      await page.evaluate(()=>window.__finishPayment({paymentIntent:{status:'succeeded'}}));
      assert.equal(await page.getByTestId('destination').count(),0);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mealscout_cart')).length),2);
      assert.ok(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a')));
    });
    await scenario('missing payment outcome cannot be treated as success',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({cart:[cartItem()],recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.evaluate(()=>window.__confirm=async()=>({}));await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();
      await page.getByRole('button',{name:'Check order status',exact:true}).waitFor();assert.ok(await page.getByRole('button',{name:'Confirm Payment',exact:true}).isDisabled());
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mealscout_cart')).length),1);
    });
    await scenario('card decline remains retryable and preserves recovery',async({page,setHandler,start})=>{
      setHandler(async url=>({body:url==='/api/pickup-orders'?verified():menu()}));await start({cart:[cartItem()],recoveries:[saved()]});await page.locator('[data-payment-secret]').waitFor();
      await page.evaluate(()=>window.__confirm=async()=>({error:{type:'card_error',message:'Card declined'}}));await page.getByRole('button',{name:'Confirm Payment',exact:true}).click();await page.getByText('Card declined',{exact:true}).waitFor();
      assert.ok(await page.getByRole('button',{name:'Confirm Payment',exact:true}).isEnabled());assert.ok(await page.evaluate(()=>window.__recovery.readPickupCheckoutRecovery('a')));
    });
  }finally{await browser.close();}
  const evidence={scope:'actual React and Chromium with native primitives and fixture storage/API/Stripe; no live transactions',reactVersion:version,runtimeOverride:!!process.env.UI_REACT_RUNTIME,results};
  console.log(JSON.stringify(evidence,null,2));if(results.some(r=>r.status!=='pass'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
