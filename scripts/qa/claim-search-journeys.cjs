/** Claim search behavior in the compiled app; synthetic reads only. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');
const oldTruck = { id: 'qa-old-truck', name: 'QA Earlier Truck', city: 'Austin', state: 'TX', canClaim: true, canRequest: false };
const newTruck = { ...oldTruck, id: 'qa-new-truck', name: 'QA Current Truck' };
const input = page => page.getByLabel('Search by food truck name, license ID, city, or state', { exact: true });
const search = async (page, q) => { await input(page).fill(q); await input(page).press('Enter'); };
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function runClaimSearchJourneys({ scenario, evidence, viewport }) {
  for (const status of [200, 503]) {
    await scenario(`late setup response ${status} cannot replace the current claim search`, async ({ page, state, origin }) => {
      let release, received = false;
      const pending = new Promise(resolve => { release = resolve; });
      state.claimSearch = ({ url, json }) => json([url.searchParams.get('q') === 'earlier' ? { ...oldTruck, canRequest: true } : newTruck]);
      state.claimRequest = async ({ request, json }) => {
        assert.equal(request.postDataJSON().listingId, oldTruck.id);
        received = true; await pending;
        return json({ message: status === 200 ? 'Synthetic setup receipt; no message sent' : 'Synthetic setup failure' }, status);
      };
      try {
        await page.goto(origin + '/claim-business'); await search(page, 'earlier');
        await page.getByRole('button', { name: 'Request setup', exact: true }).click();
        await expect.poll(() => received).toBe(true);
        await search(page, 'current'); await expect(page.getByText(newTruck.name, { exact: true })).toBeVisible();
        const setupResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/truck-claims/request');
        release(); await (await setupResponse).finished(); await paint(page);
        await expect(page.getByText(newTruck.name, { exact: true })).toBeVisible();
        await expect(page.getByText(oldTruck.name, { exact: true })).toHaveCount(0);
        await expect(page.locator('[role="alert"].text-destructive')).toHaveCount(0);
        assert.equal(state.requests.filter(r => r.pathname === '/api/truck-claims/request').length, 1);
      } finally { release(); }
    });
  }
  for (const failure of ['503', 'invalid-json', 'invalid-collection', 'invalid-row']) {
    await scenario(`claim search ${failure} clears prior results and remains retryable`, async ({ page, state, origin }) => {
      let failed = false;
      state.claimSearch = ({ route, json }) => {
        if (!failed) return json([oldTruck]);
        if (failure === '503') return json({ message: 'Synthetic failure' }, 503);
        if (failure === 'invalid-json') return route.fulfill({ contentType: 'application/json', body: '{invalid' });
        return json(failure === 'invalid-row' ? [{ name: 'Missing truck identity' }] : { invalidCollection: true });
      };
      await page.goto(origin + '/claim-business');
      await search(page, 'earlier'); await expect(page.getByText(oldTruck.name, { exact: true })).toBeVisible();
      failed = true; await search(page, 'current');
      await expect(page.getByRole('alert')).toContainText('Search is temporarily unavailable', { timeout: 2500 });
      await expect(page.getByText(oldTruck.name, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Claim', exact: true })).toHaveCount(0);
      await expect(page.getByText('No matching trucks found.', { exact: false })).toHaveCount(0);
      failed = false; await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByText(oldTruck.name, { exact: true })).toBeVisible();
      assert.equal(state.writes.length, 0);
    });
  }
  await scenario('claim search keeps the latest result when responses arrive out of order', async ({ page, state, origin }) => {
    let release, received = false;
    const pending = new Promise(resolve => { release = resolve; });
    state.claimSearch = async ({ url, json }) => {
      if (url.searchParams.get('q') === 'earlier') { received = true; await pending; return json([oldTruck]); }
      return json([newTruck]);
    };
    try {
      await page.goto(origin + '/claim-business'); await search(page, 'earlier');
      await expect.poll(() => received).toBe(true);
      await search(page, 'current'); await expect(page.getByText(newTruck.name, { exact: true })).toBeVisible();
      const oldResponse = page.waitForResponse(response => response.url().includes('q=earlier'));
      release(); await (await oldResponse).finished(); await paint(page);
      await expect(page.getByText(newTruck.name, { exact: true })).toBeVisible({ timeout: 2500 });
      await expect(page.getByText(oldTruck.name, { exact: true })).toHaveCount(0);
      await page.screenshot({ path: path.join(evidence, `claim-latest-${viewport.width}.png`), fullPage: true });
    } finally { release(); }
  });
  await scenario('editing a claim query invalidates results and an outstanding search', async ({ page, state, origin }) => {
    let release, received = false;
    const pending = new Promise(resolve => { release = resolve; });
    state.claimSearch = async ({ url, json }) => {
      if (url.searchParams.get('q') === 'pending') { received = true; await pending; }
      return json([oldTruck]);
    };
    try {
      await page.goto(origin + '/claim-business'); await search(page, 'earlier');
      await expect(page.getByText(oldTruck.name, { exact: true })).toBeVisible();
      await input(page).fill('edited');
      await expect(page.getByText(oldTruck.name, { exact: true })).toHaveCount(0, { timeout: 2500 });
      await search(page, 'pending'); await expect.poll(() => received).toBe(true);
      await input(page).fill('');
      const oldResponse = page.waitForResponse(response => response.url().includes('q=pending'));
      release(); await (await oldResponse).finished(); await paint(page);
      await expect(page.getByText(oldTruck.name, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();
      await expect(page.getByRole('alert')).toHaveCount(0);
    } finally { release(); }
  });
  await scenario('successful empty claim search is distinct from unavailable search', async ({ page, state, origin }) => {
    state.claimSearch = ({ json }) => json([]);
    await page.goto(origin + '/claim-business'); await search(page, 'no-match');
    await expect(page.getByRole('alert')).toContainText('No matching trucks found.');
    await expect(page.getByText('Search is temporarily unavailable', { exact: false })).toHaveCount(0);
    assert.equal(state.writes.length, 0);
  });
}
module.exports = { runClaimSearchJourneys };
