// Built frontend, immutable synthetic booking reads. No booking/payment/cancel writes.
const assert=require('node:assert/strict');
const {expect}=require('@playwright/test');
module.exports=async function scheduleReliability(scenario){
  function setup(world){
    const date=new Date();date.setMonth(date.getMonth()+1,18);const day=date.toISOString().slice(0,10);
    const host='QA ONLY reliable schedule host';
    const rows=['confirmed','pending','cancelled'].map(status=>({type:'booking',status,bookingId:`qa-${world.runId}-${status}`,slotType:'lunch',event:{id:`qa-${status}`,date:day,startTime:'11:00',endTime:'14:00',status:'open',requiresPayment:true},host:{id:'qa-host',businessName:status==='confirmed'?host:`QA ONLY ${status} not reserved`,address:'QA fixture',locationType:'other'}}));
    const endpoint=`/api/bookings/truck/${world.truck.id}/schedule`;
    let response={status:200,body:{schedule:rows}};
    const original=world.handle;
    world.handle=(identity,url,method='GET',body={},headers={})=>{
      const p=new URL(url).pathname;
      if(method==='GET'&&p===endpoint){world.requests.push({actor:identity.actorId,method,path:p});return response;}
      if(method==='GET'&&[ `/api/trucks/${world.truck.id}/manual-schedule`, `/api/trucks/${world.truck.id}/parking-reports`].includes(p))return {status:200,body:[]};
      if(method==='GET'&&p==='/api/map/locations')return {status:200,body:{hostLocations:[],eventLocations:[],supplierLocations:[]}};
      return original(identity,url,method,body,headers);
    };
    return {day,host,rows,endpoint,set:value=>{response=value;},route:`/parking-pass?tab=schedule&truckId=${world.truck.id}&date=${day}`};
  }
  const readonly=world=>assert.equal(world.requests.filter(r=>r.method!=='GET').length,0);
  await scenario('Schedule failed initial load is not reported as an empty day',async({world,openActor})=>{
    const f=setup(world);f.set({status:503,body:{}});const page=await openActor(world.actors.truck,f.route);
    await expect(page.getByRole('region',{name:'Booked stops status'}).getByRole('alert')).toBeVisible();
    await expect(page.getByText('No stops scheduled',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Add stop',exact:true})).toBeVisible();readonly(world);
  });
  await scenario('Schedule retry restores confirmed stops without changing the selected date',async({world,openActor})=>{
    const f=setup(world);f.set({status:503,body:{}});const page=await openActor(world.actors.truck,f.route);
    await expect(page.getByRole('button',{name:'Retry booked stops',exact:true})).toBeVisible();f.set({status:200,body:{schedule:f.rows}});
    await page.getByRole('button',{name:'Retry booked stops',exact:true}).click();await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('date'),f.day);await expect(page.getByText('QA ONLY pending not reserved',{exact:true})).toHaveCount(0);await expect(page.getByText('QA ONLY cancelled not reserved',{exact:true})).toHaveCount(0);readonly(world);
  });
  await scenario('Schedule stale refresh retains last-known stops and disables cancellation until recovered',async({world,openActor})=>{
    const f=setup(world),page=await openActor(world.actors.truck,f.route);await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    f.set({status:503,body:{}});await page.getByRole('button',{name:'Refresh bookings',exact:true}).click();await expect(page.getByRole('button',{name:'Retry booked stops',exact:true})).toBeVisible();
    await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();await expect(page.getByRole('button',{name:'Cancel booking',exact:true})).toBeDisabled();
    f.set({status:200,body:{schedule:f.rows}});await page.getByRole('button',{name:'Retry booked stops',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel booking',exact:true})).toBeEnabled();readonly(world);
  });
  await scenario('Schedule permission failure clears previously displayed booking details',async({world,openActor})=>{
    const f=setup(world),page=await openActor(world.actors.truck,f.route);await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    f.set({status:403,body:{}});await page.getByRole('button',{name:'Refresh bookings',exact:true}).click();
    await expect(page.getByRole('region',{name:'Booked stops status'}).getByRole('alert')).toBeVisible();await expect(page.getByText(f.host,{exact:true})).toHaveCount(0);
    await expect(page.getByText('No stops scheduled',{exact:true})).toHaveCount(0);readonly(world);
  });
  await scenario('Schedule malformed response differs from a verified empty schedule',async({world,openActor})=>{
    const f=setup(world);f.set({status:200,body:{}});const page=await openActor(world.actors.truck,f.route);
    await expect(page.getByRole('button',{name:'Retry booked stops',exact:true})).toBeVisible();await expect(page.getByText('No stops scheduled',{exact:true})).toHaveCount(0);
    f.set({status:200,body:{schedule:[]}});await page.getByRole('button',{name:'Retry booked stops',exact:true}).click();await expect(page.getByText('No stops scheduled',{exact:true})).toBeVisible();readonly(world);
  });
  await scenario('Schedule slow refresh keeps context visible and blocks stale booking actions',async({world,openActor})=>{
    const f=setup(world),page=await openActor(world.actors.truck,f.route);await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    let release;const gate=new Promise(resolve=>{release=resolve;});
    await page.route('**'+f.endpoint,async route=>{await gate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({schedule:f.rows})});},{times:1});
    try{await page.getByRole('button',{name:'Refresh bookings',exact:true}).click();await expect(page.getByRole('region',{name:'Booked stops status'}).getByText('Checking booked stops…',{exact:true})).toBeVisible();await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();await expect(page.getByRole('button',{name:'Cancel booking',exact:true})).toBeDisabled();}finally{release();}
    await expect(page.getByRole('button',{name:'Refresh bookings',exact:true})).toBeEnabled();readonly(world);
  });
  await scenario('Schedule invalid booked date recovers without crashing the calendar',async({world,openActor})=>{
    const f=setup(world);f.set({status:200,body:{schedule:[{...f.rows[0],event:{...f.rows[0].event,date:'not-a-date'}}]}});
    const page=await openActor(world.actors.truck,f.route);await expect(page.getByRole('button',{name:'Retry booked stops',exact:true})).toBeVisible();
    await expect(page.getByText('No stops scheduled',{exact:true})).toHaveCount(0);f.set({status:200,body:{schedule:f.rows}});
    await page.getByRole('button',{name:'Retry booked stops',exact:true}).click();await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();readonly(world);
  });
  await scenario('Schedule Today and next scheduled day preserve navigation through reload',async({world,openActor})=>{
    const f=setup(world),page=await openActor(world.actors.truck,f.route);await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    await page.getByRole('button',{name:'Today',exact:true}).click();
    const today=await page.evaluate(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');});
    assert.equal(new URL(page.url()).searchParams.get('date'),today);
    const next=page.getByRole('button',{name:'Next scheduled day',exact:true});await expect(next).toBeEnabled();await next.click();
    assert.equal(new URL(page.url()).searchParams.get('date'),f.day);await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    const cellText=await page.locator('.pp-calendar-day--active').locator('div').first().locator('span').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));
    assert.ok(cellText.length===2 && cellText[1].left-cellText[0].right>=2,'Day number and stop count must not collide');
    for(const name of ['Today','Previous month','Next month']){const box=await page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(box&&box.height>=44,name+' touch target');}
    await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByText(f.host,{exact:true}).last()).toBeVisible();
    const region=page.getByRole('region',{name:'Booked stops status'});await region.evaluate(e=>e.scrollIntoView({block:'start'}));
    const evidence=process.env.QA_EVIDENCE_DIR;if(evidence)await page.screenshot({path:require('node:path').join(evidence,page.viewportSize().width+'-parking-schedule.png')});
    readonly(world);
  });
};
