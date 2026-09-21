/** Readability and navigation on real Scout dish cards; no remote data or mutations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
async function runScoutMenuCardJourneys({ scenario, evidence, viewport }) {
  await scenario('trending dish inherits its matching public truck owner instead of linking to a missing restaurant', async ({page,state,origin})=>{
    const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
    state.trendingPayload={generatedAt:new Date().toISOString(),windowDays:7,
      items:[{id:'qa-truck-dish',name:'QA truck poke',restaurantId:id,restaurantName:'QA Truck',restaurantCity:'Pensacola',restaurantState:'FL',priceCents:1800,description:'Fixture dish'},
        {id:'qa-other-dish',name:'QA other dish',restaurantId:other,restaurantName:'QA Other',restaurantCity:'Pensacola',restaurantState:'FL',priceCents:1100}],
      places:[{id,name:'QA Truck',city:'Pensacola',state:'FL',businessType:'food_truck',isFoodTruck:true},{id:other,name:'QA Other',city:'Pensacola',state:'FL',businessType:'restaurant',isFoodTruck:false}]};
    state.profileBody={...state.profileBody,id,entity:'truck',profileType:'truck',displayName:'QA Truck'};state.requiredProfileType='truck';
    await page.goto(origin+'/scout');const dish=page.getByTestId('scout-local-menu-item-card').filter({hasText:'QA truck poke'}).first();
    await expect(dish).toBeVisible();await expect(dish).toHaveAttribute('href','/truck/qa-truck--'+id);
    await dish.click({position:{x:20,y:20}});await expect(page.getByRole('button',{name:'Save to favorites',exact:true})).toBeVisible();
    assert.equal(new URL(page.url()).pathname,'/truck/qa-truck--'+id);assert.equal(state.writes.length,0);
  });
  await scenario('Scout dish card text is readable and still opens its business', async ({ page, state, origin }) => {
    state.localMenuItems = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map((restaurantId, index) => ({
      id: restaurantId + '-dish', restaurantId, restaurantName: index ? 'QA OTHER Profile' : 'QA ONLY Profile',
      name: index ? 'QA avocado bowl' : 'QA dinner tacos', description: 'Fresh ingredients, prepared to order.', cuisineType: 'Tacos',
      businessType: 'restaurant', entityType: 'restaurant', profileType: 'restaurant', priceCents: 1500, imageUrl: null,
      latitude: 30.4213, longitude: -87.2169, restaurantLatitude: 30.4213, restaurantLongitude: -87.2169,
      distanceMiles: 1.2, isAvailable: true, recommendationCount: 0, category: 'Dinner',
    }));
    await page.goto(origin + '/scout?ref=qa');
    const card = page.getByTestId('scout-local-menu-item-card').first(); await expect(card).toBeVisible();
    const measurements = await card.evaluate(card => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const rgba = color => { context.clearRect(0,0,1,1); context.fillStyle = color; context.fillRect(0,0,1,1); return Array.from(context.getImageData(0,0,1,1).data); };
      const background = rgba(getComputedStyle(card).backgroundColor);
      const luminance = channels => channels.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      return [...card.querySelectorAll(':scope > div:nth-child(2) > p, :scope > div:nth-child(2) > div > span')].filter(node=>node.textContent.trim()).map(node=>{
        const foreground=rgba(getComputedStyle(node).color), alpha=foreground[3]/255;
        const displayed=foreground.slice(0,3).map((v,i)=>v*alpha+background[i]*(1-alpha));
        const a=luminance(displayed), b=luminance(background);
        return {text:node.textContent.trim(),color:getComputedStyle(node).color,background:getComputedStyle(card).backgroundColor,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};
      });
    });
    fs.writeFileSync(path.join(evidence, `menu-card-contrast-${viewport.width}.json`), JSON.stringify(measurements,null,2));
    await page.screenshot({ path:path.join(evidence,`menu-card-${viewport.width}.png`),fullPage:true });
    assert.ok(measurements.length >= 4, 'Actual title, business, category/distance and description must be checked');
    assert.ok(measurements.every(item=>item.ratio>=4.5), 'Small dish-card text contrast: '+JSON.stringify(measurements));
    const button=card.getByRole('button',{name:'Recommend',exact:true}); const box=await button.boundingBox();
    assert.ok(box && box.height>=44 && box.width>=44, 'Recommendation target must be at least 44px');
    const href=await card.getAttribute('href'); const selected=state.localMenuItems.find(item=>href.includes(item.restaurantId)); assert.ok(selected);
    state.profileBody={...state.profileBody,id:selected.restaurantId,displayName:selected.restaurantName,title:selected.restaurantName,profilePath:href,canonicalUrl:origin+href,seo:{...state.profileBody.seo,entityId:selected.restaurantId}};
    await card.click({position:{x:20,y:20}});
    await expect(page).toHaveURL(origin+href); await expect(page.getByRole('button',{name:'Save to favorites',exact:true})).toBeVisible();
    assert.equal(state.writes.length,0);
  });
}
module.exports = { runScoutMenuCardJourneys };
