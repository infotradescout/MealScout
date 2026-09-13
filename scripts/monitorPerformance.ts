#!/usr/bin/env node

/**
 * MEALSCOUT PERFORMANCE MONITORING DASHBOARD
 * 
 * Real-time monitoring of key performance indicators during testing
 * Tracks response times, error rates, throughput, and resource usage
 * 
 * Run: npm run monitor
 * or: node --import tsx scripts/monitorPerformance.ts
 */

import http from 'http';
import https from 'https';

interface Metrics {
  timestamp: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  endpoints: Map<string, EndpointMetrics>;
}

interface EndpointMetrics {
  name: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  errorRate: number;
  responseTimes: number[];
}

interface HealthCheckResult {
  endpoint: string;
  status: 'UP' | 'DOWN' | 'SLOW';
  responseTime: number;
  timestamp: Date;
}

class PerformanceMonitor {
  private baseUrl: string;
  private metrics: Metrics;
  private endpointMetrics: Map<string, EndpointMetrics> = new Map();
  private responseTimes: number[] = [];
  private healthChecks: HealthCheckResult[] = [];
  private lastRequestTime: number = 0;
  private requestCount: number = 0;

  constructor(baseUrl: string = 'http://localhost:5000') {
    this.baseUrl = baseUrl;
    this.metrics = {
      timestamp: new Date(),
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      requestsPerSecond: 0,
      endpoints: new Map(),
    };
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

  private clearScreen() {
    console.clear();
  }

  private makeRequest(
    method: string,
    path: string,
    token?: string
  ): Promise<{ status: number; time: number }> {
    return new Promise((resolve, reject) => {
      const client = this.baseUrl.startsWith('https') ? https : http;
      const url = new URL(path, this.baseUrl);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'MealScout-Monitor/1.0',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        timeout: 10000,
        headers,
      };

      const startTime = Date.now();

      const req = client.request(options, (res) => {
        res.on('data', () => {
          // Drain response data
        });
        res.on('end', () => {
          const time = Date.now() - startTime;
          resolve({ status: res.statusCode || 500, time });
        });
      });

      req.on('error', () => {
        reject(new Error('Connection error'));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.end();
    });
  }

  private recordMetric(
    endpoint: string,
    status: number,
    responseTime: number
  ) {
    this.responseTimes.push(responseTime);
    this.metrics.totalRequests++;
    this.requestCount++;

    if (status >= 200 && status < 300) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    if (responseTime < this.metrics.minResponseTime) {
      this.metrics.minResponseTime = responseTime;
    }
    if (responseTime > this.metrics.maxResponseTime) {
      this.metrics.maxResponseTime = responseTime;
    }

    // Track per-endpoint metrics
    if (!this.endpointMetrics.has(endpoint)) {
      this.endpointMetrics.set(endpoint, {
        name: endpoint,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        errorRate: 0,
        responseTimes: [],
      });
    }

    const metrics = this.endpointMetrics.get(endpoint)!;
    metrics.totalRequests++;
    metrics.responseTimes.push(responseTime);

    if (status >= 200 && status < 300) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
    }

    metrics.avgResponseTime =
      metrics.responseTimes.reduce((a, b) => a + b, 0) /
      metrics.responseTimes.length;
    metrics.errorRate =
      (metrics.failedRequests / metrics.totalRequests) * 100;
  }

  private calculatePercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private async performHealthChecks() {
    const endpoints = [
      { name: 'Homepage', path: '/' },
      { name: 'Deal Search', path: '/api/deals/search?q=pizza' },
      { name: 'Restaurant Discovery', path: '/api/restaurants/nearby/40.7128/-74.0060' },
      { name: 'Awards - Golden Fork', path: '/api/awards/golden-fork/holders' },
      { name: 'Awards - Golden Plate', path: '/api/awards/golden-plate/winners' },
      { name: 'Action API', path: '/api/actions', method: 'POST' },
    ];

    for (const endpoint of endpoints) {
      try {
        const { status, time } = await this.makeRequest(
          endpoint.method || 'GET',
          endpoint.path
        );

        const result: HealthCheckResult = {
          endpoint: endpoint.name,
          status: status >= 200 && status < 300 ? 'UP' : status === 404 ? 'UP' : 'DOWN',
          responseTime: time,
          timestamp: new Date(),
        };

        if (time > 1000) {
          result.status = 'SLOW';
        }

        this.healthChecks.push(result);
        this.recordMetric(endpoint.name, status, time);

        // Keep only last 10 checks per endpoint
        if (this.healthChecks.filter((h) => h.endpoint === endpoint.name).length > 10) {
          this.healthChecks = this.healthChecks.filter(
            (h, idx) =>
              h.endpoint !== endpoint.name ||
              idx >=
              this.healthChecks.length -
              this.healthChecks.filter((h2) => h2.endpoint === endpoint.name).length +
              10
          );
        }
      } catch (error: any) {
        this.recordMetric(endpoint.name, 500, 0);
        this.healthChecks.push({
          endpoint: endpoint.name,
          status: 'DOWN',
          responseTime: 0,
          timestamp: new Date(),
        });
      }
    }
  }

  private printDashboard() {
    this.clearScreen();

    const now = new Date();
    const uptime = (now.getTime() - this.metrics.timestamp.getTime()) / 1000;

    console.log('\n' + '═'.repeat(100));
    this.log('  MEALSCOUT PERFORMANCE MONITOR', 'success');
    console.log('═'.repeat(100));

    console.log(
      `\n  Current Time: ${now.toLocaleTimeString()} | Uptime: ${uptime.toFixed(1)}s\n`
    );

    // Overall Metrics
    console.log('┌─ Overall Metrics ─────────────────────────────────────────────────────────────────────────────┐');

    const successRate =
      this.metrics.totalRequests === 0
        ? 0
        : (this.metrics.successfulRequests / this.metrics.totalRequests) * 100;

    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    this.metrics.p95ResponseTime = this.calculatePercentile(sorted, 95);
    this.metrics.p99ResponseTime = this.calculatePercentile(sorted, 99);
    this.metrics.avgResponseTime =
      this.responseTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.responseTimes.length);

    this.metrics.requestsPerSecond = this.requestCount / Math.max(1, uptime);

    console.log(`│  Total Requests:      ${this.metrics.totalRequests.toString().padEnd(20)} │`);
    console.log(
      `│  Success Rate:        ${successRate.toFixed(1)}% (${this.metrics.successfulRequests} OK, ${this.metrics.failedRequests} Failed)`
    );
    console.log(`│  Requests/Second:     ${this.metrics.requestsPerSecond.toFixed(2).toString().padEnd(15)} │`);
    console.log(`│  Avg Response Time:   ${this.metrics.avgResponseTime.toFixed(0)}ms`);
    console.log(`│  p95 Response Time:   ${this.metrics.p95ResponseTime.toFixed(0)}ms`);
    console.log(`│  p99 Response Time:   ${this.metrics.p99ResponseTime.toFixed(0)}ms`);
    console.log(`│  Min/Max Response:    ${this.metrics.minResponseTime.toFixed(0)}ms / ${this.metrics.maxResponseTime.toFixed(0)}ms`);
    console.log('└───────────────────────────────────────────────────────────────────────────────────────────────┘');

    // Health Checks
    console.log('\n┌─ Health Checks (Last Status) ─────────────────────────────────────────────────────────────────┐');
    const latestChecks = new Map<string, HealthCheckResult>();
    for (const check of this.healthChecks) {
      latestChecks.set(check.endpoint, check);
    }

    const checksArray = Array.from(latestChecks.entries());
    for (const [endpoint, check] of checksArray) {
      const statusColor =
        check.status === 'UP' ? '\x1b[32m' : check.status === 'SLOW' ? '\x1b[33m' : '\x1b[31m';
      const statusReset = '\x1b[0m';

      console.log(
        `│  ${endpoint.padEnd(30)} ${statusColor}${check.status.padEnd(5)}${statusReset}  ${check.responseTime.toString().padStart(4)}ms  ${check.timestamp.toLocaleTimeString()}`
      );
    }
    console.log('└───────────────────────────────────────────────────────────────────────────────────────────────┘');

    // Endpoint Breakdown
    console.log(
      '\n┌─ Top Endpoints by Request Count ──────────────────────────────────────────────────────────────────┐'
    );

    const sorted_endpoints = Array.from(this.endpointMetrics.values())
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 6);

    for (const metrics of sorted_endpoints) {
      const errRate = metrics.errorRate > 0 ? `\x1b[31m${metrics.errorRate.toFixed(1)}%\x1b[0m` : '0%';
      console.log(
        `│  ${metrics.name.padEnd(35)} ${metrics.totalRequests.toString().padStart(5)} req  ${metrics.avgResponseTime.toFixed(0).toString().padStart(5)}ms  Error: ${errRate}`
      );
    }
    console.log('└───────────────────────────────────────────────────────────────────────────────────────────────┘');

    // Status Bar
    console.log('\n' + '═'.repeat(100));
    if (successRate >= 99 && this.metrics.avgResponseTime < 300) {
      this.log('  ✓ System Status: EXCELLENT - Ready for production launch', 'success');
    } else if (successRate >= 95 && this.metrics.avgResponseTime < 500) {
      this.log('  ⚠ System Status: GOOD - Monitor performance', 'warn');
    } else {
      this.log('  ✗ System Status: DEGRADED - Investigate issues', 'error');
    }
    console.log('═'.repeat(100) + '\n');
  }

  async run() {
    this.log('Starting Performance Monitor...', 'info');
    this.log(`Monitoring: ${this.baseUrl}`, 'info');
    this.log('Press Ctrl+C to stop\n', 'info');

    // Initial health check
    await this.performHealthChecks();
    this.printDashboard();

    // Continuous monitoring
    const interval = setInterval(async () => {
      try {
        await this.performHealthChecks();
        this.printDashboard();
      } catch (error) {
        this.log(`Monitor error: ${error}`, 'error');
      }
    }, 10000); // Update every 10 seconds

    // Graceful shutdown
    process.on('SIGINT', () => {
      clearInterval(interval);
      this.log('\nMonitor stopped', 'info');
      process.exit(0);
    });
  }
}

// Main execution
const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
const monitor = new PerformanceMonitor(baseUrl);
monitor.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
