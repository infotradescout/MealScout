/** Actual compiled app; synthetic profile/auth/API data only. No backend, emails or payments. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, expect } = require('@playwright/test');
const { createTestWorld } = require('./test-world.cjs');
const { runCustomerMenuJourneys } = require('./customer-menu-journeys.cjs');
const { runScoutMenuCardJourneys } = require('./scout-menu-card-journeys.cjs');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'client/dist');
const evidence = process.env.QA_EVIDENCE_DIR || path.join(root, '.qa-evidence/scout-continuity-20260917');
const id = '11111111-1111-4111-8111-111111111111';
const profilePath = `/restaurant/qa-only--${id}`;
const profile = { id, entity: 'restaurant', profileType: 'restaurant', title: 'QA ONLY Profile', displayName: 'QA ONLY Profile',
  slug: 'qa-only', subtitle: null, description: 'Isolated frontend fixture, not a real listing.', cuisineTags: ['Tacos'], serviceType: null,
  profilePath, canonicalUrl: `https://www.mealscout.us${profilePath}`, addressPublicLabel: null, city: null, state: null,
  latitude: null, longitude: null, distanceLabel: null, phonePublic: null, phone: null, websiteUrl: null,
  socialLinks: { instagramUrl: null, facebookPageUrl: null, xUrl: null }, operatingHoursSummary: null, hours: null, openStatus: null,
  coverImageUrl: null, logoUrl: null, imageUrl: null, galleryImages: [], verifiedProfile: false, claimedProfile: true, locallyOwned: false,
  menuSections: [], menuVariants: [], activeMenuId: null, menuContextNote: null, menuLastUpdatedAt: null,
  menuApproval: { status: 'unavailable', label: 'Unavailable', ownerApproved: false, ownerApprovalRequired: true, reviewedAt: null, sourceAttribution: null },
  menuImageUrl: null, menuPdfUrl: null, menuUrl: null, featuredMenuItems: [], deals: { totalActive: 0, items: [] }, events: { totalUpcoming: 0, items: [] },
  reviewSummary: { count: 0 }, recommendations: { total: 0, likes: 0, shares: 0 }, truckPresence: null, truckSchedule: null, cta: [],
  seo: { canonicalUrl: `https://www.mealscout.us${profilePath}`, seoTitle: 'QA ONLY Profile', seoDescription: 'Isolated fixture', ogImageUrl: null, entityType: 'restaurant', entityId: id, slug: 'qa-only' } };
const results = [];
async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Compiled frontend required');
  fs.mkdirSync(evidence, { recursive: true });
  const leakedApi = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) { leakedApi.push({ path: url.pathname, scenario: req.headers['x-qa-scenario'] || null }); res.writeHead(503); res.end('Unintercepted API'); return; }
    let file = path.resolve(dist, '.' + url.pathname);
    if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.UI_CHROMIUM_EXECUTABLE || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      async function scenario(name, run, options = {}) {
        const world = createTestWorld(), identity = { actorId: options.guest ? null : world.actors.customer.id };
        const state = { profileStatus: 200, resolverStatus: 200, profileBody: profile, actionStatus: 200, delay: 0, saved: false, writes: [], requests: [], holdFeatured: false, featuredSeen: 0, featuredWaiters: [] };
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', extraHTTPHeaders: { 'x-qa-scenario': encodeURIComponent(viewport.width + ':' + name) } }); context.setDefaultTimeout(12000);
        let closing = false;
        const errors = []; const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await context.routeWebSocket('**/*', socket => socket.close());
        await context.route('**/*', async route => {
          if (closing) return route.abort();
          const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
          const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          if (pathname.startsWith('/api/')) {
            state.requests.push({ pathname, method: request.method() });
            if (pathname.startsWith('/api/menus/') && state.menuPayload !== undefined) return json(state.menuPayload, state.menuStatus || 200);
            if (pathname === '/api/public/trending' && state.trendingPayload) return json(state.trendingPayload);
            if (pathname === '/api/menus/local-items' && state.localMenuItems) return json({items:state.localMenuItems});
            if (pathname.endsWith('/related')) return json({ items: [] });
            if (/\/api\/restaurants\/[^/]+\/featured-item$/.test(pathname)) {
              state.featuredSeen += 1;
              if (state.holdFeatured) await new Promise(resolve => state.featuredWaiters.push(resolve));
              if (closing) return route.abort().catch(() => {});
              return json({ item: null });
            }
            if (pathname.startsWith('/api/public/profiles/') && state.requiredProfileType && !pathname.startsWith('/api/public/profiles/' + state.requiredProfileType + '/')) return json({message:'Fixture profile type mismatch'},404);
            if (pathname.startsWith('/api/public/profiles/')) return json(state.profileBody, state.profileStatus);
            if (pathname.startsWith('/api/public/resolve-business/')) return json({ id, entityType: 'truck', businessSlug: 'qa-only' }, state.resolverStatus);
            if (pathname === '/api/favorites/restaurants') return json(state.saved ? [{ restaurantId: id }] : []);
            if (/\/api\/restaurants\/[^/]+\/(favorite|recommend)$/.test(pathname)) {
              state.writes.push({ pathname, method: request.method() });
              if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
              if (state.actionStatus < 300 && pathname.endsWith('/favorite')) state.saved = request.method() === 'POST';
              return json({ success: state.actionStatus < 300, contextAlreadySaved: false }, state.actionStatus);
            }
            const coreDiscovery = pathname === '/api/trucks/live' || /^\/api\/restaurants\/(nearby|subscribed)\//.test(pathname);
            if (coreDiscovery && state.discoveryOverride != null) {
              if (state.discoveryOverride === 'empty') return json([]);
              if (state.discoveryOverride === 'malformed') return json({ invalidCollection: true });
              return json({ message: 'Synthetic discovery unavailable' }, state.discoveryOverride);
            }
            if (pathname === '/api/trucks/live' && state.trucksUnavailable) return json({ message: 'Synthetic truck failure' }, 503);
            if (pathname.startsWith('/api/restaurants/nearby/')) return json([{ id, name: profile.displayName, businessName: profile.displayName,
              businessType: 'restaurant', profileType: 'restaurant', entityType: 'restaurant', isFoodTruck: false, isActive: true,
              latitude: 30.4213, longitude: -87.2169, city: 'Pensacola', state: 'FL', cuisineType: 'Tacos', cuisineTags: ['Tacos'],
              address: 'QA fixture location', isOpenNow: false, isVerified: false, imageUrl: null, logoUrl: null, coverImageUrl: null }]);
            if (['/api/trucks/live', '/api/deals/featured', '/api/events/public', '/api/menus/local-items', '/api/public/trending', '/api/following/restaurants', '/api/recommendations/restaurants', '/api/search', '/api/map/locations'].includes(pathname) || /^\/api\/(restaurants\/(nearby|subscribed)|deals\/nearby)\//.test(pathname)) return json([]);
            if (pathname === '/api/map/runtime') return json({ hasGoogleMapsKey: false, googleMapsApiKey: null });
            if (['/api/public/profile-analytics', '/api/public/profile-quality-signals', '/api/funnel/events'].includes(pathname)) return json({ success: true });
            if (request.method() !== 'GET' && !['/api/auth/login', '/api/login', '/api/auth/logout', '/api/logout'].includes(pathname)) return json({ message: 'Unexpected fixture write' }, 503);
            let body = {}; try { body = request.postDataJSON() || {}; } catch {}
            const response = world.handle(identity, url.href, request.method(), body, request.headers());
            return json(response.body, response.status);
          }
          if (url.origin !== origin || pathname.startsWith('/socket.io')) return route.abort();
          return route.continue();
        });
        const started = Date.now();
        try {
          await run({ page, context, state, world, identity, origin });
          assert.deepEqual(errors, [], 'No browser exceptions');
          results.push({ name, width: viewport.width, passed: true, elapsedMs: Date.now() - started, writes: state.writes.length });
          console.log(`PROFILE PASS ${viewport.width} ${name}`);
        } catch (error) {
          results.push({ name, width: viewport.width, passed: false, error: error.message, errors, body: (await page.locator('body').innerText().catch(() => '')).slice(0, 6000), requests: state.requests.slice(-15) });
          await page.screenshot({ path: path.join(evidence, `profile-failed-${viewport.width}-${results.length}.png`), fullPage: true }).catch(() => {});
          console.log(`PROFILE FAIL ${viewport.width} ${name}: ${error.message.slice(0, 1200)}`);
        } finally { closing = true; state.featuredWaiters.forEach(resume => resume());
          // Discard the document while interception is still active. Page close alone
          // can release a paused fetch before Chromium destroys its target.
          await Promise.all(context.pages().map(openPage => openPage.goto('about:blank', { waitUntil: 'commit' })));
          await Promise.all(context.pages().map(openPage => openPage.close()));
          await context.close(); fs.writeFileSync(path.join(evidence, 'profile-browser-results.json'), JSON.stringify({ results, isolation: 'Compiled frontend with synthetic APIs/auth; no production or provider writes' }, null, 2)); }
      }
      await runScoutMenuCardJourneys({ scenario, evidence, viewport });
      await runCustomerMenuJourneys({ scenario, profile, profilePath, evidence, viewport });
      for (const action of ['Save to favorites', 'Recommend this place']) {
        await scenario(`guest ${action}: login returns to exact profile, then explicit action`, async ({ page, state, world, origin }) => {
          const destination = profilePath + '?ref=qa#menu';
          await page.goto(origin + destination); await page.getByRole('button', { name: action, exact: true }).click();
          await expect(page).toHaveURL(/\/login\?redirect=/);
          assert.equal(new URL(page.url()).searchParams.get('redirect'), destination);
          await page.getByTestId('button-email-login').click();
          await page.getByTestId('input-email').fill(world.actors.customer.email);
          await page.getByTestId('input-password').fill(`QA-${world.runId}-only`);
          await page.getByTestId('button-login-submit').click(); await expect(page).toHaveURL(origin + destination);
          assert.equal(state.writes.length, 0, 'Login does not automatically repeat a mutation');
          await page.getByRole('button', { name: action, exact: true }).click();
          if (action === 'Recommend this place') { const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Done', exact: true }).click(); await expect(dialog).toHaveCount(0); }
          await expect(page.getByRole('button', { name: action === 'Save to favorites' ? 'Remove from favorites' : 'Recommended', exact: true })).toHaveAttribute('aria-pressed', 'true');
          assert.equal(state.writes.length, 1);
        }, { guest: true });
        await scenario(`${action}: failure never reports success and duplicate clicks are bounded`, async ({ page, state, origin }) => {
          state.actionStatus = 503; state.delay = 400; await page.goto(origin + profilePath);
          const button = page.getByRole('button', { name: action, exact: true }); await expect(button).toBeVisible();
          await button.evaluate(element => { element.click(); element.click(); });
          await expect(button).toHaveAttribute('aria-busy', 'true'); await expect(button).toHaveAttribute('aria-pressed', 'false');
          await expect(page.getByText(action === 'Save to favorites' ? 'Save not confirmed' : 'Recommendation not confirmed', { exact: true })).toBeVisible();
          assert.equal(state.writes.length, 1); await expect(button).toBeEnabled();
          state.actionStatus = 200; await button.click();
          if (action === 'Recommend this place') { const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Done', exact: true }).click(); await expect(dialog).toHaveCount(0); }
          await expect(page.getByRole('button', { name: action === 'Save to favorites' ? 'Remove from favorites' : 'Recommended', exact: true })).toHaveAttribute('aria-pressed', 'true');
          assert.equal(state.writes.length, 2);
        });
      }
      for (const failure of [503, 'malformed']) {
        await scenario(`profile ${failure} is retryable on the same route`, async ({ page, state, origin }) => {
          if (failure === 'malformed') state.profileBody = {}; else state.profileStatus = failure;
          await page.goto(origin + profilePath); await expect(page.getByRole('button', { name: 'Retry profile' })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Profile not found', exact: true })).toHaveCount(0);
          state.profileStatus = 200; state.profileBody = profile; await page.getByRole('button', { name: 'Retry profile' }).click();
          await expect(page.getByRole('button', { name: 'Save to favorites', exact: true })).toBeVisible(); await expect(page).toHaveURL(origin + profilePath);
        });
      }
      for (const status of [401, 403, 404, 410]) {
        await scenario(`HTTP ${status} is not a public profile or a successful action`, async ({ page, state, origin }) => {
          state.profileStatus = status; await page.goto(origin + profilePath);
          if ([404, 410].includes(status)) await expect(page.getByRole('heading', { name: 'Profile not found', exact: true })).toBeVisible();
          else await expect(page.getByRole('button', { name: 'Retry profile' })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Save to favorites', exact: true })).toHaveCount(0);
          assert.equal(state.writes.length, 0);
        }, { guest: true });
      }
      await scenario('slug resolver retries without losing typed route', async ({ page, state, origin }) => {
        state.resolverStatus = 503; const route = '/truck/qa-only'; await page.goto(origin + route);
        await expect(page.getByRole('button', { name: 'Retry profile' })).toBeVisible();
        state.resolverStatus = 200; state.profileBody = { ...profile, entity: 'truck', profileType: 'truck' };
        await page.getByRole('button', { name: 'Retry profile' }).click();
        await expect(page.getByRole('button', { name: 'Save to favorites', exact: true })).toBeVisible(); await expect(page).toHaveURL(origin + route);
      });
      await scenario('profile return restores search, scene, map view and reload state', async ({ page, context, identity, origin }) => {
        const key = 'mealscout:scout-journey:v1:' + encodeURIComponent(identity.actorId);
        const snapshot = { route: '/scout?ref=qa', search: { open: true, query: 'tacos', filter: 'restaurants' },
          scene: 'restaurants', craving: 'sit-down', radiusKm: 25, layers: { openNow: true, foodTrucks: false, deals: true, happeningToday: false },
          map: { center: { lat: 30.4, lng: -87.2 }, zoom: 15, expanded: false, selectedMarkerId: null }, scrollY: 0 };
        await context.addInitScript(({ key, account, snapshot }) => {
          if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ version: 1, account, savedAt: Date.now(), state: snapshot }));
        }, { key, account: identity.actorId, snapshot });
        await page.goto(origin + profilePath); const back = page.locator('header').getByRole('link', { name: 'Scout', exact: true });
        await expect(back).toHaveAttribute('href', '/scout?ref=qa'); await back.click();
        const search = page.getByRole('textbox', { name: 'Search dishes, cravings, places, trucks, and events', exact: true });
        await expect(search).toHaveValue('tacos');
        await search.fill('fresh tacos');
        await expect.poll(async () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).state.search.query, key)).toBe('fresh tacos');
        const actual = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).state, key);
        assert.deepEqual(actual.map, snapshot.map); assert.deepEqual(actual.layers, snapshot.layers); assert.equal(actual.scene, 'restaurants');
        assert.equal(actual.search.filter, 'restaurants'); assert.equal(actual.radiusKm, 25);
        await page.reload(); await expect(search).toHaveValue('fresh tacos');
        await page.goto(origin + profilePath); await page.locator('header').getByRole('link', { name: 'Scout', exact: true }).click();
        await expect(search).toHaveValue('fresh tacos');
        await page.goto(origin + profilePath); await page.goBack(); await expect(search).toHaveValue('fresh tacos');
      });
      await scenario('actual thin-market Scout result opens its profile and returns to discovery', async ({ page, origin }) => {
        await page.goto(origin + '/scout?ref=qa');
        const result = page.getByRole('link', { name: 'View profile', exact: true }).first();
        await expect(result).toBeVisible(); await expect(result).toHaveAttribute('href', new RegExp(id)); await result.click();
        await expect(page.getByRole('button', { name: 'Save to favorites', exact: true })).toBeVisible();
        const scout = page.locator('header').getByRole('link', { name: 'Scout', exact: true });
        await expect(scout).toHaveAttribute('href', '/scout?ref=qa'); await scout.click();
        await expect(page).toHaveURL(origin + '/scout?ref=qa');
        await expect(page.getByRole('link', { name: 'View profile', exact: true }).first()).toHaveAttribute('href', new RegExp(id));
        await page.screenshot({ path: path.join(evidence, 'scout-roundtrip-' + viewport.width + '.png'), fullPage: true });
      });
      for (const reason of ['other account', 'expired']) {
        await scenario('does not restore ' + reason + ' Scout context', async ({ page, context, identity, origin }) => {
          const storedAccount = reason === 'other account' ? 'qa-other-account' : identity.actorId;
          await context.addInitScript(({ account, reason }) => {
            const state = { route: '/scout?ref=private-context', search: { open: true, query: 'private query', filter: 'restaurants' },
              scene: 'restaurants', craving: 'sit-down', radiusKm: 25, layers: { openNow: true, foodTrucks: false, deals: true, happeningToday: false },
              map: { center: { lat: 30.4, lng: -87.2 }, zoom: 15, expanded: false, selectedMarkerId: null }, scrollY: 0 };
            sessionStorage.setItem('mealscout:scout-journey:v1:' + encodeURIComponent(account), JSON.stringify({ version: 1, account,
              savedAt: Date.now() - (reason === 'expired' ? 31 * 60_000 : 0), state }));
          }, { account: storedAccount, reason });
          await page.goto(origin + profilePath);
          const scout = page.locator('header').getByRole('link', { name: 'Scout', exact: true });
          await expect(scout).toHaveAttribute('href', '/scout'); await scout.click();
          await expect(page.getByRole('textbox', { name: 'Search dishes, cravings, places, trucks, and events', exact: true })).toHaveValue('');
        });
      }
      await scenario('leaving Scout cancels an in-flight featured-menu read', async ({ page, context, state, origin }) => {
        state.holdFeatured = true;
        await context.addInitScript(() => {
          window.__featuredSignalAborts = 0;
          const original = window.fetch;
          window.fetch = function(input, init) {
            if (String(input).endsWith('/featured-item') && init?.signal) {
              init.signal.addEventListener('abort', () => { window.__featuredSignalAborts += 1; }, { once: true });
            }
            return original.call(this, input, init);
          };
        });
        await page.goto(origin + '/scout?ref=qa');
        await page.evaluate(() => { window.__sameScoutDocument = true; });
        await expect.poll(() => state.featuredSeen).toBeGreaterThan(0);
        await page.getByRole('link', { name: 'View profile', exact: true }).first().click();
        await expect(page.getByRole('button', { name: 'Save to favorites', exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => window.__sameScoutDocument), true, 'Actual client-side navigation, not a reload');
        await expect.poll(() => page.evaluate(() => window.__featuredSignalAborts), { timeout: 1500 }).toBeGreaterThan(0);
      });
      for (const failure of [503, 'malformed']) {
        await scenario('discovery '+failure+' is retryable without inventing an empty market', async ({page,state,origin}) => {
          state.discoveryOverride = failure;
          await page.goto(origin+'/scout?ref=qa');
          await expect(page.getByTestId('scout-data-status')).toHaveAttribute('data-state','unavailable');
          await expect(page.getByText('No food results yet',{exact:true})).toHaveCount(0);
          await expect(page.getByText('Nearby food is quiet right now.',{exact:true})).toHaveCount(0);
          if (failure === 503) await page.screenshot({path:path.join(evidence,`discovery-unavailable-${viewport.width}.png`),fullPage:true});
          state.discoveryOverride=null; await page.getByRole('button',{name:'Retry discovery',exact:true}).click();
          await expect(page.getByRole('link',{name:'View profile',exact:true}).first()).toBeVisible();
          await expect(page.getByTestId('scout-data-status')).toHaveCount(0);
          await expect(page).toHaveURL(origin+'/scout?ref=qa');assert.equal(state.writes.length,0);
        });
      }
      await scenario('partial discovery keeps readable results without claiming complete coverage',async ({page,state,origin})=>{
        state.trucksUnavailable=true;await page.goto(origin+'/scout');
        await expect(page.getByTestId('scout-data-status')).toHaveAttribute('data-state','unavailable');
        await expect(page.getByRole('link',{name:'View profile',exact:true}).first()).toBeVisible();
        await expect(page.getByTestId('scout-thin-market-state')).toHaveCount(0);
        assert.equal(state.writes.length,0);
      });
      await scenario('a successful empty discovery remains distinct from unavailable data',async ({page,state,origin})=>{
        state.discoveryOverride='empty';await page.goto(origin+'/scout');
        await expect(page.getByTestId('scout-fallback-market-notice')).toContainText(/No nearby listings yet/i);
        await expect(page.getByText('No nearby listings are available for this area yet',{exact:true})).toBeVisible();
        await page.screenshot({path:path.join(evidence,`discovery-empty-${viewport.width}.png`),fullPage:true});
        await expect(page.getByTestId('scout-data-status')).toHaveCount(0);assert.equal(state.writes.length,0);
      });
      await scenario('profile actions have 44px targets without horizontal overflow', async ({ page, origin }) => {
        await page.goto(origin + profilePath); const save = page.getByRole('button', { name: 'Save to favorites', exact: true });
        await expect(save).toBeVisible(); const saveBox = await save.boundingBox(); assert.ok(saveBox.height >= 44 && saveBox.width >= 44);
        const recommendBox = await page.getByRole('button', { name: 'Recommend this place', exact: true }).boundingBox(); assert.ok(recommendBox.height >= 44);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        await page.screenshot({ path: path.join(evidence, `profile-controls-${viewport.width}.png`), fullPage: true });
      });
    }
    fs.writeFileSync(path.join(evidence, 'profile-browser-suite.json'), JSON.stringify({
      completed: true, scenarios: results.length, failedScenarios: results.filter(result => !result.passed).length,
      uninterceptedApi: leakedApi, passed: leakedApi.length === 0 && results.every(result => result.passed),
      scope: 'Compiled UI with synthetic APIs; the isolation guard is part of suite acceptance',
    }, null, 2));
    assert.deepEqual(leakedApi, [], 'Every API request must be intercepted');
    const failed = results.filter(result => !result.passed);
    console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, total: results.length }));
    if (failed.length) process.exitCode = 1;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
