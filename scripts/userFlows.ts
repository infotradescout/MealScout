#!/usr/bin/env node

/**
 * MEALSCOUT USER FLOW SCENARIOS
 * 
 * Simulates realistic complete user journeys:
 * - New user signup → search → view details → claim deal
 * - Food truck discovery → view location → check status
 * - Restaurant owner → create restaurant → add deals
 * - Award tracking → view winners → understand eligibility
 * - Search with filters → sort results → compare
 * 
 * Run: npm run test:flows
 * or: npx tsx scripts/userFlows.ts
 */

import http from 'http';
import https from 'https';

interface FlowResult {
  name: string;
  steps: StepResult[];
  duration: number;
  success: boolean;
}

interface StepResult {
  name: string;
  success: boolean;
  statusCode?: number;
  responseTime: number;
  error?: string;
}

interface RequestConfig {
  method: string;
  path: string;
  body?: Record<string, any>;
  headers?: Record<string, string>;
  token?: string;
}

type CookieJar = Map<string, string>;

class UserFlowTester {
  private baseUrl: string;
  private origin: string;
  private flows: FlowResult[] = [];
  private forwardedFor: string;

  constructor(
    baseUrl: string = process.env.MEALSCOUT_BASE_URL || 'http://localhost:5200',
  ) {
    this.baseUrl = baseUrl;
    this.origin = new URL(baseUrl).origin;
    this.forwardedFor = process.env.MEALSCOUT_TEST_IP || this.buildRunScopedTestIp();
  }

  private buildRunScopedTestIp(): string {
    // Generate high-entropy TEST-NET style address to avoid auth limiter collisions across runs.
    const seed = `${Date.now()}-${process.pid}-${Math.random()}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const third = ((hash >> 8) % 254) + 1;
    const fourth = (hash % 254) + 1;
    return `198.51.${third}.${fourth}`;
  }

  private log(message: string, level: 'info' | 'error' | 'success' | 'warn' = 'info') {
    const colors = {
      info: '\x1b[36m',
      error: '\x1b[31m',
      success: '\x1b[32m',
      warn: '\x1b[33m',
    };
    const reset = '\x1b[0m';
    console.log(`${colors[level]}${message}${reset}`);
  }

  private makeRequest(
    config: RequestConfig,
    cookieJar?: CookieJar,
  ): Promise<{ status: number; time: number; body?: any }> {
    return new Promise((resolve, reject) => {
      const client = this.baseUrl.startsWith('https') ? https : http;
      const url = new URL(config.path, this.baseUrl);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'MealScout-UserFlow/1.0',
        'Origin': this.origin,
        'Referer': `${this.origin}/`,
        'X-Forwarded-For': this.forwardedFor,
        ...config.headers,
      };

      if (config.token) {
        headers['Authorization'] = `Bearer ${config.token}`;
      }

      if (cookieJar && cookieJar.size > 0) {
        headers['Cookie'] = this.serializeCookies(cookieJar);
      }

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: config.method,
        timeout: 30000,
        headers,
      }

      const startTime = Date.now();

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const time = Date.now() - startTime;
          if (cookieJar) {
            this.storeSetCookie(cookieJar, res.headers['set-cookie']);
          }
          try {
            const body = data ? JSON.parse(data) : undefined;
            resolve({ status: res.statusCode || 500, time, body });
          } catch {
            resolve({ status: res.statusCode || 500, time });
          }
        });
      });

      req.on('error', (error: any) => {
        const detail =
          error?.code ||
          error?.message ||
          (typeof error === 'string' ? error : '');
        reject(new Error(detail || 'Request error'));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (config.body) {
        req.write(JSON.stringify(config.body));
      }

      req.end();
    });
  }

  async recordStep(
    name: string,
    method: string,
    path: string,
    expectedStatus: number | number[] = 200,
    body?: Record<string, any>,
    token?: string,
    cookieJar?: CookieJar,
    headers?: Record<string, string>,
  ): Promise<StepResult> {
    const startTime = Date.now();
    try {
      const response = await this.makeRequest({
        method,
        path,
        body,
        token,
        headers,
      }, cookieJar);

      const responseTime = Date.now() - startTime;
      const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
      const success = statuses.includes(response.status);

      return {
        name,
        success,
        statusCode: response.status,
        responseTime,
        error: success
          ? undefined
          : `Expected ${expectedStatus}, got ${response.status}${
              response.body?.message
                ? ` (${response.body.message})`
                : response.body?.error
                  ? ` (${response.body.error})`
                  : ''
            }`,
      };
    } catch (error: any) {
      return {
        name,
        success: false,
        responseTime: Date.now() - startTime,
        error:
          error?.message ||
          error?.code ||
          (typeof error === 'string' ? error : 'Unknown error'),
      };
    }
  }

  private makeStep(
    name: string,
    success: boolean,
    responseTime: number,
    statusCode?: number,
    error?: string,
  ): StepResult {
    return {
      name,
      success,
      responseTime,
      statusCode,
      error,
    };
  }

  private serializeCookies(cookieJar: CookieJar): string {
    return Array.from(cookieJar.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  private storeSetCookie(cookieJar: CookieJar, setCookie: string[] | string | undefined) {
    if (!setCookie) return;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const cookie of cookies) {
      const first = cookie.split(';')[0] || '';
      const eqIndex = first.indexOf('=');
      if (eqIndex === -1) continue;
      const name = first.slice(0, eqIndex).trim();
      const value = first.slice(eqIndex + 1).trim();
      if (name) {
        cookieJar.set(name, value);
      }
    }
  }

  private getAdminCredentials() {
    const email =
      process.env.MEALSCOUT_ADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      '';
    const password =
      process.env.MEALSCOUT_ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD ||
      '';
    if (!email || !password) {
      return null;
    }
    return { email, password };
  }

 /**
   * FLOW 1: New User Journey
   * - Visit homepage
   * - Search for deals
   * - View restaurant details
   * - Check awards
   */
  async flowNewUserJourney() {
    this.log('\n→ Flow 1: New User Discovery Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    steps.push(await this.recordStep('1. Visit homepage', 'GET', '/', 200));

    steps.push(
      await this.recordStep('2. Search for pizza deals', 'GET', '/api/deals/search?q=pizza&limit=10', 200)
    );

    steps.push(
      await this.recordStep('3. Search for restaurants', 'GET', '/api/restaurants/search?q=Mario', [200, 404])
    );

    steps.push(
      await this.recordStep('4. Get nearby restaurants', 'GET', '/api/restaurants/nearby/40.7128/-74.0060?limit=10', 200)
    );

    steps.push(
      await this.recordStep('5. View award holders', 'GET', '/api/awards/golden-fork/holders', 200)
    );

    steps.push(
      await this.recordStep('6. View golden plate winners', 'GET', '/api/awards/golden-plate/winners', 200)
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'New User Discovery', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 2: Deal Seeker Journey
   * - Search with multiple queries
   * - Filter by category
   * - Check featured deals
   * - View deal detail
   */
  async flowDealSeekerJourney() {
    this.log('\n→ Flow 2: Deal Seeker Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    const queries = ['pizza', 'sushi', 'burger', 'tacos'];
    for (const query of queries) {
      steps.push(
        await this.recordStep(`Search: ${query}`, 'GET', `/api/deals/search?q=${query}&limit=20`, 200)
      );
    }

    steps.push(
      await this.recordStep('Get featured deals', 'GET', '/api/deals/featured?limit=20', 200)
    );

    steps.push(
      await this.recordStep('Get recommended deals (auth optional)', 'GET', '/api/deals/recommended', [200, 401])
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Deal Seeker Journey', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 3: Food Truck Tracker Journey
   * - View upcoming events
   * - Validate events discovery
   */
  async flowFoodTruckJourney() {
    this.log('\n→ Flow 3: Food Truck Tracker Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    steps.push(
      await this.recordStep('1. Get upcoming events', 'GET', '/api/events/upcoming', 200)
    );

    steps.push(
      await this.recordStep('2. Get events discovery', 'GET', '/api/events', [200, 401])
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Food Truck Tracker', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 4: Restaurant Owner Journey
   * - Verify auth gates for owner endpoints
   */
  async flowRestaurantOwnerJourney() {
    this.log('\n→ Flow 4: Restaurant Owner Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    steps.push(
      await this.recordStep(
        '1. Create restaurant (auth required)',
        'POST',
        '/api/restaurants',
        [401, 403],
        {
          name: 'Test Restaurant',
          address: '123 Main St',
          latitude: 40.7128,
          longitude: -74.0060,
          cuisine: 'Italian',
        }
      )
    );

    steps.push(
      await this.recordStep(
        '2. Create deal (auth required)',
        'POST',
        '/api/deals',
        [401, 403],
        {
          restaurantId: 'rest-1',
          title: 'Happy Hour',
          description: '50% off drinks',
          discount: 50,
        }
      )
    );

    steps.push(
      await this.recordStep(
        '3. Get my active deals (auth required)',
        'GET',
        '/api/deals/my-active',
        [401, 403]
      )
    );

    steps.push(
      await this.recordStep(
        '4. Get claimed deals (auth required)',
        'GET',
        '/api/deals/claimed',
        [401, 403]
      )
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Restaurant Owner', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 5: Award Tracking Journey
   * - View award categories
   * - Check eligibility
   * - View holder profiles
   */
  async flowAwardTrackingJourney() {
    this.log('\n→ Flow 5: Award Tracking Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    steps.push(
      await this.recordStep('1. Get Golden Fork holders', 'GET', '/api/awards/golden-fork/holders', 200)
    );

    steps.push(
      await this.recordStep('2. Get awards history', 'GET', '/api/awards/history', 200)
    );

    steps.push(
      await this.recordStep('3. Get Golden Plate winners', 'GET', '/api/awards/golden-plate/winners', 200)
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Award Tracking', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 6: Action API (LLM) Journey
   * - Use find deals action
   * - Use find restaurants action
   * - Use food truck action
   * - Use redemption action
   */
  async flowLLMIntegration() {
    this.log('\n→ Flow 6: LLM Integration (Action API)', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    steps.push(
      await this.recordStep(
        '1. Find deals via LLM',
        'POST',
        '/api/actions',
        [200, 400, 401, 403],
        { action: 'FIND_DEALS', params: { search: 'pizza', limit: 10 } }
      )
    );

    steps.push(
      await this.recordStep(
        '2. Find restaurants via LLM',
        'POST',
        '/api/actions',
        [200, 400, 401, 403],
        { action: 'FIND_RESTAURANTS', params: { search: 'Mario', limit: 10 } }
      )
    );

    steps.push(
      await this.recordStep(
        '3. Get food trucks via LLM',
        'POST',
        '/api/actions',
        [200, 400, 401, 403],
        { action: 'GET_FOOD_TRUCKS', params: { latitude: 40.7128, longitude: -74.0060, radiusKm: 5 } }
      )
    );

    steps.push(
      await this.recordStep(
        '4. Get credits balance via LLM',
        'POST',
        '/api/actions',
        [200, 400, 401, 403],
        { action: 'GET_CREDITS_BALANCE', params: { userId: 'user-1' } }
      )
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'LLM Integration', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 7: Affiliate Sharing Journey
   * - Generate affiliate tag
   * - Create share link
   * - Track click redirect
   */
  async flowAffiliateJourney() {
    this.log('\nâ†’ Flow 7: Affiliate Sharing Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];
    const session: CookieJar = new Map();

    const adminCreds = this.getAdminCredentials();
    if (!adminCreds) {
      steps.push(
        this.makeStep(
          '1. Admin login',
          false,
          0,
          undefined,
          'Set MEALSCOUT_ADMIN_EMAIL/MEALSCOUT_ADMIN_PASSWORD or ADMIN_EMAIL/ADMIN_PASSWORD',
        ),
      );
      const duration = Date.now() - flowStart;
      const flow: FlowResult = { name: 'Affiliate Sharing', steps, duration, success: false };
      this.flows.push(flow);
      this.printFlowResult(flow);
      return;
    }

    steps.push(
      await this.recordStep(
        '1. Admin login',
        'POST',
        '/api/auth/login',
        200,
        { email: adminCreds.email, password: adminCreds.password },
        undefined,
        session,
      ),
    );

    steps.push(
      await this.recordStep('2. Get affiliate tag', 'GET', '/api/affiliate/tag', 200, undefined, undefined, session),
    );

    let affiliateCode: string | undefined;
    {
      const start = Date.now();
      const created = await this.makeRequest(
        {
          method: 'POST',
          path: '/api/affiliate/generate-link',
          body: {
            baseUrl: this.baseUrl,
            resourceType: 'page',
            resourceId: 'home',
          },
        },
        session,
      );
      const ok = created.status === 200 && created.body?.code;
      affiliateCode = created.body?.code;
      steps.push(
        this.makeStep(
          '3. Generate affiliate link',
          ok,
          Date.now() - start,
          created.status,
          ok ? undefined : `Expected 200 with code, got ${created.status}`,
        ),
      );
    }

    if (affiliateCode) {
      steps.push(
        await this.recordStep(
          '4. Track affiliate click (redirect)',
          'GET',
          `/api/affiliate/click/${affiliateCode}`,
          [302, 301],
          undefined,
          undefined,
          session,
        ),
      );
    } else {
      steps.push(
        this.makeStep(
          '4. Track affiliate click (redirect)',
          false,
          0,
          undefined,
          'Missing affiliate code from link generation',
        ),
      );
    }

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Affiliate Sharing', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 8: Analytics & Reporting Journey
   * - Validate health/monitoring endpoints
   */
  async flowAnalyticsJourney() {
    this.log('\n→ Flow 7: Analytics & Reporting Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];

    steps.push(
      await this.recordStep('1. API health check', 'GET', '/api/health', 200)
    );

    steps.push(
      await this.recordStep('2. API head check', 'HEAD', '/api', [200, 204])
    );

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Analytics & Reporting', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  /**
   * FLOW 8: Host + Truck Booking Journey (Direct Booking)
   * - Host creates parking pass listing
   * - Truck books an available spot (no host acceptance)
   * - Booking appears in truck schedule
   */
  async flowHostTruckBooking() {
    this.log('\nâ†’ Flow 9: Host + Truck Booking Journey', 'info');
    const flowStart = Date.now();
    const steps: StepResult[] = [];
    const session: CookieJar = new Map();

    const adminCreds = this.getAdminCredentials();
    if (!adminCreds) {
      steps.push(
        this.makeStep(
          '1. Admin login',
          false,
          0,
          undefined,
          'Set MEALSCOUT_ADMIN_EMAIL/MEALSCOUT_ADMIN_PASSWORD or ADMIN_EMAIL/ADMIN_PASSWORD',
        ),
      );
      const duration = Date.now() - flowStart;
      const flow: FlowResult = { name: 'Host + Truck Booking', steps, duration, success: false };
      this.flows.push(flow);
      this.printFlowResult(flow);
      return;
    }

    {
      const start = Date.now();
      let loginStatus = 0;
      let loginOk = false;
      let attempts = 0;
      while (attempts < 2 && !loginOk) {
        attempts += 1;
        const response = await this.makeRequest(
          {
            method: 'POST',
            path: '/api/auth/login',
            body: { email: adminCreds.email, password: adminCreds.password },
          },
          session,
        );
        loginStatus = response.status;
        if (response.status === 200) {
          loginOk = true;
          break;
        }
        // If rate-limited, wait briefly and retry once.
        if (response.status === 429 && attempts < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        } else {
          break;
        }
      }

      steps.push(
        this.makeStep(
          '1. Admin login',
          loginOk,
          Date.now() - start,
          loginStatus,
          loginOk ? undefined : `Expected 200, got ${loginStatus}`,
        ),
      );
    }

    if (!steps[steps.length - 1].success) {
      const duration = Date.now() - flowStart;
      const flow: FlowResult = { name: 'Host + Truck Booking', steps, duration, success: false };
      this.flows.push(flow);
      this.printFlowResult(flow);
      return;
    }

    let hostId: string | undefined;
    {
      const start = Date.now();
      const response = await this.makeRequest({ method: 'GET', path: '/api/hosts/me' }, session);
      if (response.status === 200 && response.body?.id) {
        hostId = response.body.id;
        steps.push(this.makeStep('2. Load host profile', true, Date.now() - start, response.status));
      } else if (response.status === 404) {
        const hostPayload = {
          businessName: `Test Host ${Date.now()}`,
          address: '100 Test Way',
          city: 'Austin',
          state: 'TX',
          locationType: 'office',
          contactPhone: '555-000-0000',
          latitude: '30.2672',
          longitude: '-97.7431',
          spotCount: 2,
        };
        const createStart = Date.now();
        const created = await this.makeRequest(
          { method: 'POST', path: '/api/hosts', body: hostPayload },
          session,
        );
        const ok = created.status === 201 && created.body?.id;
        hostId = created.body?.id;
        steps.push(
          this.makeStep(
            '2. Create host profile',
            ok,
            Date.now() - createStart,
            created.status,
            ok ? undefined : `Expected 201, got ${created.status}`,
          ),
        );
      } else {
        steps.push(
          this.makeStep(
            '2. Load host profile',
            false,
            Date.now() - start,
            response.status,
            `Expected 200 or 404, got ${response.status}`,
          ),
        );
      }
    }

    if (!hostId) {
      const duration = Date.now() - flowStart;
      const flow: FlowResult = { name: 'Host + Truck Booking', steps, duration, success: false };
      this.flows.push(flow);
      this.printFlowResult(flow);
      return;
    }

    let passId: string | undefined;
    let bookingDateKey: string | undefined;
    {
      const payload = {
        hostId,
        name: 'Test Parking Pass',
        description: 'Test parking pass listing',
        requiresPayment: true,
        breakfastPriceCents: 1200,
        lunchPriceCents: 1500,
        dinnerPriceCents: 1800,
        dailyPriceCents: 3000,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        maxTrucks: 2,
      };
      const start = Date.now();
      const created = await this.makeRequest(
        { method: 'POST', path: '/api/hosts/parking-pass', body: payload },
        session,
      );
      const ok =
        created.status === 201 &&
        Array.isArray(created.body) &&
        created.body.length > 0 &&
        created.body[0]?.id;
      if (ok) {
        const datedPasses = created.body
          .map((item: any) => {
            const dateText = String(item?.date || '');
            const dateKey = /^\d{4}-\d{2}-\d{2}/.test(dateText)
              ? dateText.slice(0, 10)
              : String(item?.id || '').split(':').pop();
            return { item, dateKey };
          })
          .filter((candidate: any) => /^\d{4}-\d{2}-\d{2}$/.test(candidate.dateKey || ''))
          .sort((left: any, right: any) => left.dateKey.localeCompare(right.dateKey));
        const selected = datedPasses.at(-1);
        const selectedPass = selected?.item || created.body.at(-1);
        passId = selectedPass.id;
        bookingDateKey = selected?.dateKey;
        if (!bookingDateKey && typeof passId === 'string') {
          const idDate = passId.split(':').pop();
          if (idDate && /^\d{4}-\d{2}-\d{2}$/.test(idDate)) {
            bookingDateKey = idDate;
          }
        }
      } else {
        passId = undefined;
      }
      steps.push(
        this.makeStep(
          '3. Create parking pass listing',
          ok,
          Date.now() - start,
          created.status,
          ok ? undefined : `Expected 201 with listing array, got ${created.status}`,
        ),
      );
    }

    if (!passId) {
      const duration = Date.now() - flowStart;
      const flow: FlowResult = { name: 'Host + Truck Booking', steps, duration, success: false };
      this.flows.push(flow);
      this.printFlowResult(flow);
      return;
    }

    let truckId: string | undefined;
    {
      const createStart = Date.now();
      const truckPayload = {
        name: `Test Truck ${Date.now()}`,
        address: '200 Truck Rd',
        city: 'Austin',
        state: 'TX',
        businessType: 'food_truck',
        isFoodTruck: true,
        cuisineType: 'Street Food',
        latitude: '30.2672',
        longitude: '-97.7431',
      };
      const created = await this.makeRequest(
        { method: 'POST', path: '/api/restaurants', body: truckPayload },
        session,
      );
      const ok = created.status === 200 && created.body?.id;
      truckId = created.body?.id;
      steps.push(
        this.makeStep(
          '4. Create food truck',
          ok,
          Date.now() - createStart,
          created.status,
          ok ? undefined : `Expected 200, got ${created.status}`,
        ),
      );
    }

    if (!truckId) {
      const duration = Date.now() - flowStart;
      const flow: FlowResult = { name: 'Host + Truck Booking', steps, duration, success: false };
      this.flows.push(flow);
      this.printFlowResult(flow);
      return;
    }

    steps.push(
      await this.recordStep(
        '5. Book available slot',
        'POST',
        `/api/parking-pass/${passId}/book`,
        200,
        {
          truckId,
          slotTypes: ['daily'],
          ...(bookingDateKey ? { selectedDates: [bookingDateKey] } : {}),
        },
        undefined,
        session,
        {
          'Idempotency-Key': `flow-book-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
        },
      ),
    );

    {
      const start = Date.now();
      const response = await this.makeRequest(
        { method: 'GET', path: '/api/bookings/my-truck' },
        session,
      );
      const ok =
        response.status === 200 &&
        Array.isArray(response.body) &&
        response.body.some((booking: any) => booking?.eventId === passId);
      steps.push(
        this.makeStep(
          '6. Booking shows in truck schedule',
          ok,
          Date.now() - start,
          response.status,
          ok ? undefined : 'Booking not found in /api/bookings/my-truck',
        ),
      );
    }

    const duration = Date.now() - flowStart;
    const success = steps.every((s) => s.success);
    const flow: FlowResult = { name: 'Host + Truck Booking', steps, duration, success };
    this.flows.push(flow);
    this.printFlowResult(flow);
  }

  private printFlowResult(flow: FlowResult) {
    const passCount = flow.steps.filter((s) => s.success).length;
    const failCount = flow.steps.length - passCount;
    const avgTime = flow.steps.reduce((a, b) => a + b.responseTime, 0) / flow.steps.length;

    if (failCount === 0) {
      this.log(
        `  ✓ ${flow.name}: ${passCount}/${flow.steps.length} passed (${avgTime.toFixed(0)}ms avg)`,
        'success'
      );
    } else {
      this.log(
        `  ✗ ${flow.name}: ${passCount}/${flow.steps.length} passed, ${failCount} failed (${avgTime.toFixed(0)}ms avg)`,
        'warn'
      );
      flow.steps.forEach((step) => {
        if (!step.success) {
          console.log(`    - ${step.name}: ${step.error}`);
        }
      });
    }
  }

  printSummary(): boolean {
    console.log('\n' + '='.repeat(80));
    this.log('USER FLOW TEST SUMMARY', 'success');
    console.log('='.repeat(80));

    let totalSteps = 0;
    let successfulSteps = 0;

    for (const flow of this.flows) {
      totalSteps += flow.steps.length;
      successfulSteps += flow.steps.filter((s) => s.success).length;
    }

    const successRate = Number(((successfulSteps / totalSteps) * 100).toFixed(1));
    console.log(`\nTotal Flows: ${this.flows.length}`);
    console.log(`Total Steps: ${totalSteps}`);
    console.log(`Successful Steps: ${successfulSteps}`);
    console.log(`Success Rate: ${successRate}%\n`);

    if (successRate >= 95) {
      this.log('✓ User flows are stable! Ready for production launch.', 'success');
    } else if (successRate >= 75) {
      this.log('⚠ Most flows working, but some issues detected. Review failures.', 'warn');
    } else {
      this.log('✗ Multiple flow failures detected. Fix issues before launch.', 'error');
    }

    console.log('='.repeat(80) + '\n');
    return successRate >= 95;
  }

  async run() {
    this.log('Starting User Flow Tests...', 'info');
    this.log(`Testing: ${this.baseUrl}\n`, 'info');

    try {
      await this.flowNewUserJourney();
      await this.flowDealSeekerJourney();
      await this.flowFoodTruckJourney();
      await this.flowRestaurantOwnerJourney();
      await this.flowAwardTrackingJourney();
      await this.flowLLMIntegration();
      await this.flowAffiliateJourney();
      await this.flowAnalyticsJourney();
      await this.flowHostTruckBooking();

      const passed = this.printSummary();
      if (!passed) {
        process.exitCode = 1;
      }
    } catch (error) {
      this.log(`Test failed: ${error}`, 'error');
      process.exit(1);
    }
  }
}

// Main execution
const baseUrl =
  process.env.MEALSCOUT_BASE_URL ||
  process.env.BASE_URL ||
  'http://127.0.0.1:5200';
const tester = new UserFlowTester(baseUrl);
tester.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
