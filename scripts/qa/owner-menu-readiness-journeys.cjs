/** Owner menu readiness uses synthetic, read-only APIs; no claims or provider writes. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { expect } = require('@playwright/test');

function prepareOwner({ world, identity, state }) {
  identity.actorId = world.actors.owner.id;
  const menu = world.menuFor(world.restaurant.id).menus[0];
  state.ownerMenus = [menu];
  state.ownerMenuDetails = menu;
  return `/menu-builder?restaurantId=${encodeURIComponent(world.restaurant.id)}&src=onboarding`;
}
const readiness = (enabled = false) => ({
  orderingEnabled: enabled,
  publicMenuBusinessVisible: true,
  blockingReasons: enabled ? [] : ['merchant_not_ready'],
  paymentMethods: { card: enabled, cash: false },
  checks: [{ id: 'merchant_ready', label: 'Merchant setup', ok: enabled, blocking: true, action: 'Complete merchant setup before taking orders.' }],
});
const expectEditing = async page => {
  await expect(page.getByRole('heading', { name: 'Menus and items', exact: true })).toBeVisible();
  await expect(page.getByText('QA test tacos', { exact: true })).toBeVisible();
};
function assertReadOnly(state) {
  assert.deepEqual(state.requests.filter(request => request.pathname.startsWith('/api/owner/') && request.method !== 'GET'), []);
}

async function runOwnerMenuReadinessJourneys({ scenario, evidence, viewport }) {
  for (const failure of ['503', 'invalid-json', 'missing-checks', 'invalid-boolean', 'invalid-check', 'invalid-payment-method', 'invalid-payout', 'invalid-public-visibility']) {
    await scenario(`owner menu ${failure} readiness remains editable and recovers by retry`, async ({ page, world, identity, state, origin }) => {
      const route = prepareOwner({ world, identity, state });
      let repaired = false, reads = 0;
      state.ownerReadiness = ({ route, url, json }) => {
        reads += 1;
        assert.equal(url.pathname, `/api/owner/restaurants/${world.restaurant.id}/ordering-readiness`);
        if (repaired) return json(readiness());
        if (failure === '503') return json({ message: 'Synthetic readiness outage' }, 503);
        if (failure === 'invalid-json') return route.fulfill({ contentType: 'application/json', body: '{invalid' });
        const broken = readiness();
        if (failure === 'missing-checks') delete broken.checks;
        if (failure === 'invalid-boolean') broken.orderingEnabled = 'false';
        if (failure === 'invalid-check') broken.checks = [null];
        if (failure === 'invalid-payment-method') broken.paymentMethods.card = 'false';
        if (failure === 'invalid-payout') broken.payout = { message: { invalid: true } };
        if (failure === 'invalid-public-visibility') broken.publicMenuBusinessVisible = 'true';
        return json(broken);
      };
      await page.goto(origin + route);
      await expect(page.getByText('Online ordering status is unavailable. Menu editing still works.', { exact: true })).toBeVisible({ timeout: 6500 });
      await expectEditing(page);
      await expect(page.getByTestId('menu-ordering-readiness')).toHaveCount(0);
      await expect(page.getByTestId('menu-publication-badge')).toHaveText('Visibility unconfirmed');
      const retry = page.getByRole('button', { name: 'Check ordering status again', exact: true });
      await expect(retry).toBeVisible({ timeout: 1500 });
      const bounds = await retry.boundingBox();
      assert.ok(bounds.height >= 44 && bounds.width >= 44);
      const beforeRetry = reads;
      repaired = true;
      await retry.click();
      const panel = page.getByTestId('menu-ordering-readiness');
      await expect(panel).toContainText('Needs setup');
      await expect(page.getByTestId('menu-publication-badge')).toHaveText('Public menu');
      await panel.locator('summary').click();
      await expect(panel).toContainText('Complete merchant setup before taking orders.');
      await expectEditing(page);
      assert.ok(reads > beforeRetry);
      assertReadOnly(state);
      if (failure === '503') await page.screenshot({ path: path.join(evidence, `owner-readiness-recovered-${viewport.width}.png`), fullPage: true });
    });
  }
  for (const enabled of [false, true]) {
    await scenario(`owner menu preserves server ordering ${enabled ? 'ready' : 'blocked'} state separately from menu visibility`, async ({ page, world, identity, state, origin }) => {
      const route = prepareOwner({ world, identity, state });
      const payoutMessage = enabled
        ? 'Stripe Connect is ready for card-order settlement.'
        : 'Complete Stripe Connect so paid orders can settle to this business.';
      state.ownerReadiness = ({ json }) => json({
        ...readiness(enabled),
        payout: { connected: enabled, chargesEnabled: enabled, payoutsEnabled: enabled, status: enabled ? 'active' : 'not_connected', message: payoutMessage },
      });
      await page.goto(origin + route);
      await expectEditing(page);
      const panel = page.getByTestId('menu-ordering-readiness');
      await expect(panel).toContainText(enabled ? 'Customers can place pickup orders.' : 'Online ordering needs setup.');
      await expect(page.getByTestId('menu-publication-badge')).toHaveText('Public menu');
      await panel.locator('summary').click();
      await expect(panel.getByText(enabled ? 'Done' : 'Required', { exact: true })).toBeVisible();
      await expect(panel).toContainText(payoutMessage);
      await expect(page.getByRole('button', { name: 'Check ordering status again', exact: true })).toHaveCount(0);
      assertReadOnly(state);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    });
  }
  for (const publication of ['private-business', 'missing-visibility', 'disabled-menu']) {
    await scenario(`owner menu reports ${publication} without inventing public availability`, async ({ page, world, identity, state, origin }) => {
      const route = prepareOwner({ world, identity, state });
      if (publication === 'disabled-menu') {
        state.ownerMenus = state.ownerMenus.map(menu => ({ ...menu, isActive: false }));
        state.ownerMenuDetails = { ...state.ownerMenuDetails, isActive: false };
      }
      const payload = readiness();
      if (publication === 'private-business') payload.publicMenuBusinessVisible = false;
      if (publication === 'missing-visibility') delete payload.publicMenuBusinessVisible;
      state.ownerReadiness = ({ json }) => json(payload);
      await page.goto(origin + route);
      await expectEditing(page);
      const label = publication === 'private-business' ? 'Not public yet'
        : publication === 'missing-visibility' ? 'Visibility unconfirmed' : 'Menu disabled';
      await expect(page.getByTestId('menu-publication-badge')).toHaveText(label);
      await expect(page.getByTestId('menu-publication-message')).not.toContainText('Customers can view this menu.');
      await page.getByTestId('menu-settings').locator('summary').click();
      const toggle = page.getByRole('switch', { name: 'Enable this menu', exact: true });
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByTestId('menu-publication-badge')).toHaveText(label);
      await expect(page.getByTestId('menu-settings')).toContainText('when your business profile is public');
      if (publication === 'private-business') {
        payload.publicMenuBusinessVisible = true;
        await page.getByRole('button', { name: 'Check public visibility', exact: true }).click();
        await expect(page.getByTestId('menu-publication-badge')).toHaveText('Public menu');
        await expect(toggle).not.toBeChecked();
      }
      assertReadOnly(state);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    });
  }
}
module.exports = { runOwnerMenuReadinessJourneys };
