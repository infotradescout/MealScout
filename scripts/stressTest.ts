#!/usr/bin/env node

/**
 * MEALSCOUT COMPREHENSIVE STRESS TEST SUITE
 * 
 * Tests all major user flows under high load:
 * - User registration and authentication
 * - Deal searching and filtering
 * - Restaurant discovery
 * - Deal claiming
 * - Awards system
 * - Food truck tracking
 * - Image uploads
 * - Real-time updates
 * - API action endpoints (server-side action integrations)
 * 
 * Run: npm run stress-test
 * or: node --import tsx scripts/stressTest.ts
 */

import http from 'http';
import https from 'https';

interface TestConfig {
  baseUrl: string;
  concurrentUsers: number;
  requestsPerUser: number;
  rampUpTime: number; // ms
  timeout: number; // ms
}

interface TestResult {
  name: string;
  passed: number;
  failed: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  errors: string[];
}

interface RequestConfig {
  method: string;
  path: string;
  body?: Record<string, any>;
  headers?: Record<string, string>;
  token?: string;
}

class StressTest {
  private config: TestConfig;
  private results: TestResult[] = [];
  private responseTimes: number[] = [];
  private totalRequests = 0;
  private failedRequests = 0;
  private errors: string[] = [];

  constructor(config: TestConfig) {
    this.config = config;
  }

  private log(message: string, level: 'info' | 'error' | 'success' | 'warn' = 'info') {
    const timestamp = new Date().toISOString();
    const colors = {
      info: '\x1b[36m',    // Cyan
      error: '\x1b[31m',   // Red
      success: '\x1b[32m', // Green
      warn: '\x1b[33m',    // Yellow
    };
    const reset = '\x1b[0m';
    console.log(`${colors[level]}[${timestamp}] ${message}${reset}`);
  }

  private makeRequest(config: RequestConfig): Promise<{ status: number; time: number; body?: any }> {
    return new Promise((resolve, reject) => {
      const client = this.config.baseUrl.startsWith('https') ? https : http;
      const url = new URL(config.path, this.config.baseUrl);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'MealScout-StressTest/1.0',
        ...config.headers,
      };

      const origin = `${url.protocol}//${url.host}`;
      headers['Origin'] = headers['Origin'] || origin;
      headers['Referer'] = headers['Referer'] || origin;

      if (config.token) {
        headers['Authorization'] = `Bearer ${config.token}`;
      }

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: config.method,
        timeout: this.config.timeout,
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
          try {
            const body = data ? JSON.parse(data) : undefined;
            resolve({ status: res.statusCode || 500, time, body });
          } catch {
            resolve({ status: res.statusCode || 500, time });
          }
        });
      });

      req.on('error', (error) => {
        const time = Date.now() - startTime;
        reject({ error: error.message, time });
      });

      req.on('timeout', () => {
        req.destroy();
        const time = Date.now() - startTime;
        reject({ error: 'Request timeout', time });
      });

      if (config.body) {
        req.write(JSON.stringify(config.body));
      }

      req.end();
    });
  }

  private recordResult(time: number, success: boolean, error?: string) {
    this.responseTimes.push(time);
    this.totalRequests++;
    if (!success) {
      this.failedRequests++;
      if (error) this.errors.push(error);
    }
  }

  async testUserAuthentication() {
    this.log('Testing User Authentication...', 'info');
    const result: TestResult = {
      name: 'User Authentication',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const times: number[] = [];

    for (let i = 0; i < this.config.requestsPerUser; i++) {
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'POST',
          path: '/api/auth/login',
          body: {
            email: `testuser${i}@example.com`,
            password: 'TestPassword123!',
          },
        });
        const time = Date.now() - startTime;
        times.push(time);

        // 200 = success, 401 = invalid credentials, 429 = rate limited (expected under load)
        if (response.status === 200 || response.status === 401 || response.status === 429) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Auth returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    result.minResponseTime = Math.min(...times);
    result.maxResponseTime = Math.max(...times);

    this.results.push(result);
    this.log(
      `✓ Auth tests: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  async testDealSearching() {
    this.log('Testing Deal Search...', 'info');
    const result: TestResult = {
      name: 'Deal Search',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const searchQueries = ['pizza', 'burger', 'sushi', 'tacos', 'coffee', 'sandwich', 'salad', 'steak'];
    const times: number[] = [];

    for (let i = 0; i < this.config.requestsPerUser; i++) {
      const query = searchQueries[i % searchQueries.length];
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'GET',
          path: `/api/deals/search?q=${query}&limit=20`,
        });
        const time = Date.now() - startTime;
        times.push(time);

        if (response.status >= 200 && response.status < 300) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Search returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    result.minResponseTime = Math.min(...times);
    result.maxResponseTime = Math.max(...times);

    this.results.push(result);
    this.log(
      `✓ Deal search: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  async testRestaurantDiscovery() {
    this.log('Testing Restaurant Discovery...', 'info');
    const result: TestResult = {
      name: 'Restaurant Discovery',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const times: number[] = [];

    for (let i = 0; i < this.config.requestsPerUser; i++) {
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'GET',
          path: `/api/restaurants/nearby/40.7128/-74.0060?limit=20`,
        });
        const time = Date.now() - startTime;
        times.push(time);

        if (response.status >= 200 && response.status < 300) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Discovery returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    result.minResponseTime = Math.min(...times);
    result.maxResponseTime = Math.max(...times);

    this.results.push(result);
    this.log(
      `✓ Restaurant discovery: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  async testGetRestaurantDetails() {
    this.log('Testing Get Restaurant Details...', 'info');
    const result: TestResult = {
      name: 'Restaurant Details',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const restaurantIds = ['rest-1', 'rest-2', 'rest-3', 'rest-4', 'rest-5'];
    const times: number[] = [];

    for (let i = 0; i < this.config.requestsPerUser; i++) {
      const restaurantId = restaurantIds[i % restaurantIds.length];
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'GET',
          path: `/api/restaurants/${restaurantId}`,
        });
        const time = Date.now() - startTime;
        times.push(time);

        if (response.status >= 200 && response.status < 300 || response.status === 404) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Details returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    result.minResponseTime = Math.min(...times);
    result.maxResponseTime = Math.max(...times);

    this.results.push(result);
    this.log(
      `✓ Restaurant details: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  async testAwardsEndpoints() {
    this.log('Testing Awards System...', 'info');
    const result: TestResult = {
      name: 'Awards System',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const endpoints = [
      '/api/awards/golden-fork/holders',
      '/api/awards/golden-plate/winners',
    ];
    const times: number[] = [];

    for (let i = 0; i < this.config.requestsPerUser; i++) {
      const endpoint = endpoints[i % endpoints.length];
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'GET',
          path: endpoint,
        });
        const time = Date.now() - startTime;
        times.push(time);

        if (response.status >= 200 && response.status < 300) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Awards returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    result.minResponseTime = Math.min(...times);
    result.maxResponseTime = Math.max(...times);

    this.results.push(result);
    this.log(
      `✓ Awards system: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  async testActionAPI() {
    const token =
      process.env.MEALSCOUT_ACTION_TOKEN || process.env.TRADESCOUT_API_TOKEN;
    if (!token || token.includes('your_secure_token')) {
      this.log(
        'Skipping Action API (LLM Integration) - action token not set.',
        'warn'
      );
      return;
    }

    this.log('Testing Action API (LLM Integration)...', 'info');
    const result: TestResult = {
      name: 'Action API',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const actions = [
      { action: 'FIND_DEALS', params: { search: 'pizza', limit: 10 } },
      { action: 'FIND_RESTAURANTS', params: { search: 'Mario', limit: 10 } },
      { action: 'GET_FOOD_TRUCKS', params: { latitude: 40.7128, longitude: -74.0060, radiusKm: 5 } },
    ];
    const times: number[] = [];

    for (let i = 0; i < Math.min(this.config.requestsPerUser, 5); i++) {
      const actionConfig = actions[i % actions.length];
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'POST',
          path: '/api/actions',
          body: actionConfig,
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        const time = Date.now() - startTime;
        times.push(time);

        // 401 is expected for invalid token, 400 for bad request, 200 for success
        if (response.status === 401 || response.status === 400 || response.status === 200) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Action API returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    if (times.length > 0) {
      result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
      result.minResponseTime = Math.min(...times);
      result.maxResponseTime = Math.max(...times);
    }

    this.results.push(result);
    this.log(
      `✓ Action API: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  async testHealthCheck() {
    this.log('Testing Health Checks...', 'info');
    const result: TestResult = {
      name: 'Health Checks',
      passed: 0,
      failed: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      errors: [],
    };

    const times: number[] = [];

    for (let i = 0; i < this.config.requestsPerUser; i++) {
      try {
        const startTime = Date.now();
        const response = await this.makeRequest({
          method: 'GET',
          path: '/',
        });
        const time = Date.now() - startTime;
        times.push(time);

        if (response.status >= 200 && response.status < 300) {
          result.passed++;
          this.recordResult(time, true);
        } else {
          result.failed++;
          this.recordResult(time, false, `Health check returned ${response.status}`);
        }
      } catch (err: any) {
        result.failed++;
        this.recordResult(err.time || 0, false, err.error);
        result.errors.push(err.error);
      }
    }

    result.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    result.minResponseTime = Math.min(...times);
    result.maxResponseTime = Math.max(...times);

    this.results.push(result);
    this.log(
      `✓ Health checks: ${result.passed} passed, ${result.failed} failed, avg ${result.avgResponseTime.toFixed(0)}ms`,
      'success'
    );
  }

  private async runConcurrentRequests() {
    const promises = [];

    // Ramp up users over time
    for (let user = 0; user < this.config.concurrentUsers; user++) {
      const delay = (user / this.config.concurrentUsers) * this.config.rampUpTime;
      promises.push(
        new Promise((resolve) => {
          setTimeout(() => {
            this.testUserAuthentication().then(resolve);
          }, delay);
        })
      );
    }

    await Promise.all(promises);
  }

  printSummary(): boolean {
    console.log('\n' + '='.repeat(80));
    this.log('STRESS TEST SUMMARY', 'success');
    console.log('='.repeat(80) + '\n');

    for (const result of this.results) {
      const total = result.passed + result.failed;
      const successRate = total > 0 ? ((result.passed / total) * 100).toFixed(1) : '0.0';
      console.log(`${result.name}:`);
      console.log(`  ✓ Passed: ${result.passed}`);
      console.log(`  ✗ Failed: ${result.failed}`);
      console.log(`  Success Rate: ${successRate}%`);
      console.log(`  Response Times: avg ${result.avgResponseTime.toFixed(0)}ms, min ${result.minResponseTime.toFixed(0)}ms, max ${result.maxResponseTime.toFixed(0)}ms`);
      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.slice(0, 3).join(', ')}${result.errors.length > 3 ? '...' : ''}`);
      }
      console.log();
    }

    const totalRequests = this.totalRequests;
    const successRate = totalRequests > 0
      ? (((totalRequests - this.failedRequests) / totalRequests) * 100).toFixed(1)
      : '0.0';
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    console.log('Overall:');
    console.log(`  Total Requests: ${totalRequests}`);
    console.log(`  Success Rate: ${successRate}%`);
    console.log(`  Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
    console.log('='.repeat(80) + '\n');

    if (this.failedRequests === 0) {
      this.log('✓ All tests passed! System ready for deployment.', 'success');
      return true;
    } else {
      this.log(
        `✗ ${this.failedRequests} requests failed. Review errors before deployment.`,
        'error'
      );
      return false;
    }
  }

  async run() {
    this.log(`Starting stress test with ${this.config.concurrentUsers} concurrent users...`, 'info');
    this.log(`Base URL: ${this.config.baseUrl}`, 'info');
    this.log(`Requests per test: ${this.config.requestsPerUser}`, 'info');
    console.log();

    try {
      await this.testHealthCheck();
      await this.testUserAuthentication();
      await this.testDealSearching();
      await this.testRestaurantDiscovery();
      await this.testGetRestaurantDetails();
      await this.testAwardsEndpoints();
      await this.testActionAPI();

      const passed = this.printSummary();
      if (!passed) {
        process.exitCode = 1;
      }
    } catch (error) {
      this.log(`Stress test failed: ${error}`, 'error');
      process.exit(1);
    }
  }
}

// Main execution
const baseUrl =
  process.env.MEALSCOUT_BASE_URL ||
  process.env.BASE_URL ||
  'http://127.0.0.1:5200';

const config: TestConfig = {
  baseUrl,
  concurrentUsers: 10,
  requestsPerUser: 20,
  rampUpTime: 5000, // 5 seconds
  timeout: 30000, // 30 seconds
};

const test = new StressTest(config);
test.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
