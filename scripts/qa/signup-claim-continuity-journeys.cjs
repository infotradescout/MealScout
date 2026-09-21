/** Authenticated claim handoff in the compiled app; synthetic reads only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');

const earlier = { id: 'qa-signup-earlier-listing', name: 'QA Earlier Selected Truck', externalId: 'QA-EARLIER', address: '1 Synthetic Street', city: 'Austin', state: 'TX', phone: '5125550101', canClaim: true, invited: false };
const current = { ...earlier, id: 'qa-signup-current-listing', name: 'QA Current Selected Truck', externalId: 'QA-CURRENT', address: '2 Synthetic Street' };
const routePath = '/restaurant-signup?' + new URLSearchParams({ businessType: 'food_truck', intent: 'claim', claim: '1', claimListingId: earlier.id, q: earlier.name, source: 'claim-business' });
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const assertNoBusinessWrites = state => assert.deepEqual(
  state.requests.filter(request => request.method !== 'GET' && !(request.method === 'POST' && ['/api/funnel/events', '/api/telemetry/track'].includes(request.pathname))),
  [],
  'Listing selection may emit isolated telemetry but must not write ownership or send messages',
);
async function expectCurrentSelection(page) {
  await expect(page.getByTestId('input-claim-search')).toHaveValue(current.externalId);
  await expect(page.getByTestId('button-claim-clear')).toBeVisible();
  await expect(page.getByTestId('input-business-name')).toHaveValue(current.name);
  await expect(page.getByTestId('input-address')).toHaveValue(current.address);
}

async function runSignupClaimContinuityJourneys({ scenario, evidence, viewport }) {
  await scenario('signup claim handoff cannot restore the old listing after a query edit', async ({ page, state, origin }) => {
    let release, received = false;
    const pending = new Promise(resolve => { release = resolve; });
    state.claimSearch = async ({ url, json }) => {
      if (url.searchParams.get('listingId') === earlier.id) { received = true; await pending; return json([earlier]); }
      assert.equal(url.searchParams.get('q'), 'current selection');
      assert.equal(url.searchParams.has('listingId'), false, 'Manual recovery must drop the old exact listing ID');
      return json([current]);
    };
    try {
      await page.goto(origin + routePath);
      await expect.poll(() => received).toBe(true);
      await page.getByTestId('input-claim-search').fill('current selection');
      const response = page.waitForResponse(value => new URL(value.url()).searchParams.get('listingId') === earlier.id);
      release(); await (await response).finished(); await paint(page);
      await expect(page.getByTestId('input-claim-search')).toHaveValue('current selection', { timeout: 2500 });
      await expect(page.getByTestId('button-claim-clear')).toHaveCount(0);
      await expect(page.getByTestId('button-claim-select-' + earlier.id)).toHaveCount(0);
      await page.getByTestId('button-claim-search').click();
      await page.getByTestId('button-claim-select-' + current.id).click();
      await expectCurrentSelection(page);
      await page.screenshot({ path: path.join(evidence, `signup-claim-current-${viewport.width}.png`), fullPage: true });
      assertNoBusinessWrites(state);
    } finally { release(); }
  });

  await scenario('signup manual claim results cannot reappear after the query is cleared', async ({ page, state, origin }) => {
    let release, received = false;
    const pending = new Promise(resolve => { release = resolve; });
    state.claimSearch = async ({ url, json }) => {
      if (url.searchParams.get('listingId') === earlier.id) return json([earlier]);
      received = true; await pending; return json([current]);
    };
    try {
      await page.goto(origin + routePath);
      await expect(page.getByTestId('button-claim-clear')).toBeVisible();
      await page.getByTestId('button-claim-clear').click();
      await page.getByTestId('input-claim-search').fill('manual query');
      await page.getByTestId('button-claim-search').click();
      await expect.poll(() => received).toBe(true);
      await page.getByTestId('input-claim-search').fill('');
      const response = page.waitForResponse(value => new URL(value.url()).searchParams.get('q') === 'manual query');
      release(); await (await response).finished(); await paint(page);
      await expect(page.getByTestId('input-claim-search')).toHaveValue('');
      await expect(page.getByTestId('button-claim-select-' + current.id)).toHaveCount(0, { timeout: 2500 });
      await expect(page.getByTestId('button-claim-clear')).toHaveCount(0);
      await expect(page.getByTestId('button-claim-search')).toBeEnabled();
      assertNoBusinessWrites(state);
    } finally { release(); }
  });

  await scenario('signup delayed failed search cannot replace a newer selected listing', async ({ page, state, origin }) => {
    let release, received = false;
    const pending = new Promise(resolve => { release = resolve; });
    state.claimSearch = async ({ url, json }) => {
      if (url.searchParams.get('listingId') === earlier.id) return json([earlier]);
      if (url.searchParams.get('q') === 'delayed query') {
        received = true; await pending; return json({ message: 'Synthetic stale failure' }, 503);
      }
      assert.equal(url.searchParams.get('q'), 'current selection');
      assert.equal(url.searchParams.has('listingId'), false);
      return json([current]);
    };
    try {
      await page.goto(origin + routePath);
      await expect(page.getByTestId('button-claim-clear')).toBeVisible();
      await page.getByTestId('button-claim-clear').click();
      await page.getByTestId('input-claim-search').fill('delayed query');
      await page.getByTestId('button-claim-search').click();
      await expect.poll(() => received).toBe(true);
      await page.getByTestId('input-claim-search').fill('current selection');
      await page.getByTestId('button-claim-search').click();
      await page.getByTestId('button-claim-select-' + current.id).click();
      await expectCurrentSelection(page);
      const response = page.waitForResponse(value => new URL(value.url()).searchParams.get('q') === 'delayed query');
      release(); await (await response).finished(); await paint(page);
      await expectCurrentSelection(page);
      await expect(page.getByText('Synthetic stale failure', { exact: false })).toHaveCount(0);
      await expect(page.getByTestId('button-claim-search')).toBeEnabled();
      assertNoBusinessWrites(state);
    } finally { release(); }
  });
}

module.exports = { runSignupClaimContinuityJourneys };
