/** Customer menu journeys on the compiled UI. All records and responses are isolated fixtures. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
function fixtureMenu(restaurantId = id) {
  const item = { id: restaurantId + '-dish', name: 'QA dinner tacos', description: 'Fresh fixture tacos', priceCents: 1500, itemType: 'food', imageUrl: null, isAvailable: true, calories: null, dietaryTags: [], allergens: [], variants: [], modifiers: [] };
  const menu = { id: restaurantId + '-dinner', name: 'QA Dinner', serviceType: 'dinner', isActive: true, acceptsCash: false, hidePlatformFee: false, pricesIncludeTax: true, orderingEnabled: true, orderingBlockingReasons: [], paymentMethods: { card: true, cash: false }, categories: [{ id: restaurantId + '-category', name: 'Tacos', description: null, items: [item] }] };
  return { restaurantName: restaurantId === id ? 'QA ONLY Profile' : 'QA OTHER Profile', restaurantCity: 'Pensacola', isFoodTruck: false, orderingEnabled: true, readiness: { orderingEnabled: true, blockingReasons: [], checks: [], paymentMethods: { card: true, cash: false } }, menus: [{ ...menu, id: restaurantId + '-lunch', name: 'QA Lunch', categories: [{ ...menu.categories[0], items: [{ ...item, name: 'QA lunch tacos' }] }] }, menu] };
}
async function runCustomerMenuJourneys({ scenario, profile, profilePath, evidence, viewport }) {
  for (const failure of [503, 'malformed']) {
    await scenario(`menu ${failure}: retry keeps the route and existing cart`, async ({ page, context, state, origin }) => {
      state.menuPayload = failure === 'malformed' ? { menus: {} } : fixtureMenu(); state.menuStatus = failure === 503 ? 503 : 200;
      const cart = [{ restaurantId:id, menuId:id+'-dinner', menuItemId:id+'-dish', itemName:'QA dinner tacos', priceCents:1500, quantity:2, selectedVariantId:null, variantLabel:null, variantAddCents:0, selectedModifierIds:[], modifierLabels:[], modifierAddCents:0, lineTotalCents:3000, specialInstructions:'' }];
      await context.addInitScript(cart => { if (!localStorage.getItem('mealscout_cart')) localStorage.setItem('mealscout_cart', JSON.stringify(cart)); }, cart);
      const destination = '/menu/' + id + '?menuId=' + id + '-dinner&ref=qa';
      await page.goto(origin + destination);
      await expect(page.getByRole('button', { name: 'Retry menu', exact: true })).toBeVisible();
      await expect(page.getByText('Menu coming soon', { exact: true })).toHaveCount(0);
      state.menuPayload = fixtureMenu(); state.menuStatus = 200;
      await page.getByRole('button', { name: 'Retry menu', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Add QA dinner tacos to cart', exact: true })).toBeVisible();
      await expect(page).toHaveURL(origin + destination); assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mealscout_cart'))), cart); assert.equal(state.writes.length, 0);
    });
  }
  await scenario('profile-selected menu survives cart, reload and return', async ({ page, state, origin }) => {
    state.menuPayload = fixtureMenu();
    state.profileBody = { ...profile, activeMenuId: id + '-dinner', menuSections: [{ name: 'Tacos', items: [{ name: 'QA dinner tacos', priceLabel: '$15', priceCents: 1500, description: null, imageUrl: null, featured: true }] }] };
    await page.goto(origin + profilePath + '?ref=qa#menu');
    await page.getByRole('link', { name: 'View full menu', exact: false }).first().click();
    await expect(page.getByRole('button', { name: 'Add QA dinner tacos to cart', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add QA dinner tacos to cart', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Add to Cart/i }).click();
    await page.getByRole('button', { name: /View Cart/ }).click();
    await expect(page.getByRole('dialog')).toContainText('QA dinner tacos');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mealscout_cart')));
    assert.equal(stored.length, 1); assert.equal(stored[0].restaurantId, id); assert.equal(stored[0].menuId, id + '-dinner');
    await page.reload(); await expect(page.getByRole('button', { name: 'Add QA dinner tacos to cart', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to profile', exact: true }).click();
    await expect(page).toHaveURL(origin + profilePath + '?ref=qa#menu');
    assert.equal(state.writes.length, 0, 'Cart browsing does not place an order or charge');
  });
  await scenario('Scout to profile to menu to cart and back preserves discovery', async ({ page, state, origin }) => {
    state.menuPayload = fixtureMenu();
    state.profileBody = { ...profile, activeMenuId: id + '-dinner', menuSections: [{ name:'Tacos', items:[{name:'QA dinner tacos',priceLabel:'$15',priceCents:1500,description:null,imageUrl:null,featured:true}] }] };
    await page.goto(origin + '/scout?ref=qa');
    await page.getByRole('link', {name:'View profile',exact:true}).first().click(); const originalProfile=page.url();
    await page.getByRole('link', {name:'View full menu',exact:false}).first().click();
    await page.getByRole('button', {name:'Add QA dinner tacos to cart',exact:true}).click();
    await page.getByRole('dialog').getByRole('button', {name:/Add to Cart/i}).click();
    await page.reload(); await page.getByRole('link', {name:'Back to profile',exact:true}).click();
    await expect(page).toHaveURL(originalProfile);
    await page.locator('header').getByRole('link', {name:'Scout',exact:true}).click();
    await expect(page).toHaveURL(origin + '/scout?ref=qa');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mealscout_cart')).length),1); assert.equal(state.writes.length,0);
  });
  await scenario('menu tabs persist selected menu without discarding attribution', async ({ page, state, origin }) => {
    state.menuPayload = fixtureMenu(); await page.goto(origin + '/menu/' + id + '?ref=qa');
    await page.getByRole('button', { name: 'QA Dinner', exact: true }).click();
    await expect(page.getByRole('button', { name: 'QA Dinner', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(new URL(page.url()).searchParams.get('ref'), 'qa');
    await page.reload(); await expect(page.getByRole('button', { name: 'Add QA dinner tacos to cart', exact: true })).toBeVisible();
    assert.equal(state.writes.length, 0);
  });
  for (const status of [401, 403, 404]) {
    await scenario(`menu HTTP ${status} is not an empty published menu`, async ({ page, state, origin }) => {
      state.menuStatus = status; state.menuPayload = fixtureMenu(); await page.goto(origin + '/menu/' + id);
      await expect(page.getByRole('heading', { name: status === 404 ? 'Menu not found' : 'Menu access unavailable', exact: true })).toBeVisible();
      await expect(page.getByText('Menu coming soon', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Add .* to cart/ })).toHaveCount(0); assert.equal(state.writes.length, 0);
    });
  }
  await scenario('merchant history change clears the old item dialog and selects a current menu', async ({ page, state, origin }) => {
    state.menuPayload = fixtureMenu(); await page.goto(origin + '/menu/' + id);
    await page.getByRole('button', { name: 'Add QA lunch tacos to cart', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); state.menuPayload = fixtureMenu(otherId);
    await page.evaluate(href => { history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, '/menu/' + otherId);
    await expect(page.getByRole('heading', { name: 'QA OTHER Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add QA lunch tacos to cart', exact: true })).toBeVisible();
    assert.equal(state.writes.length, 0);
  });
  await scenario('successful empty menu remains coming soon, not an outage', async ({page,state,origin}) => {
    state.menuPayload = { menus: [], orderingEnabled: false }; await page.goto(origin + '/menu/' + id);
    await expect(page.getByRole('heading', {name:'Menu coming soon',exact:true})).toBeVisible();
    await expect(page.getByRole('button', {name:'Retry menu',exact:true})).toHaveCount(0); assert.equal(state.writes.length,0);
  });
  await scenario('published browse-only menu cannot enable ordering', async ({page,state,origin}) => {
    state.menuPayload = fixtureMenu(); state.menuPayload.orderingEnabled = false;
    state.menuPayload.menus.forEach(menu => { menu.orderingEnabled = false; menu.orderingBlockingReasons = ['Ordering unavailable']; });
    await page.goto(origin + '/menu/' + id); await expect(page.getByText('Browse the menu', {exact:true})).toBeVisible();
    await expect(page.getByRole('button', {name:/Add .* to cart/})).toHaveCount(0); assert.equal(state.writes.length,0);
  });
}
module.exports = { runCustomerMenuJourneys, fixtureMenu };
