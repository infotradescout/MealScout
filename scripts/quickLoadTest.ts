/**
 * Quick Load Test - Run NOW to validate 1000-user readiness
 * Usage: node --import tsx scripts/quickLoadTest.ts
 */

const LOAD_TEST_URL = process.env.TEST_URL || 'https://mealscout.onrender.com';

interface TestResult {
  name: string;
  success: boolean;
  avgResponseTime: number;
  maxResponseTime: number;
  errorRate: number;
  totalRequests: number;
}

async function makeRequest(url: string): Promise<{ success: boolean; duration: number }> {
  const start = Date.now();
  try {
    const response = await fetch(url);
    const duration = Date.now() - start;
    return { success: response.ok, duration };
  } catch (error) {
    return { success: false, duration: Date.now() - start };
  }
}

async function concurrentRequests(url: string, count: number): Promise<TestResult> {
  console.log(`  Testing ${url} with ${count} concurrent requests...`);
  
  const promises = Array(count).fill(null).map(() => makeRequest(url));
  const results = await Promise.all(promises);
  
  const durations = results.map(r => r.duration);
  const errors = results.filter(r => !r.success).length;
  
  return {
    name: url.split('/').slice(-2).join('/'),
    success: errors === 0,
    avgResponseTime: durations.reduce((a, b) => a + b, 0) / durations.length,
    maxResponseTime: Math.max(...durations),
    errorRate: (errors / count) * 100,
    totalRequests: count
  };
}

async function testEndpoint(path: string, concurrentUsers: number): Promise<TestResult> {
  return await concurrentRequests(`${LOAD_TEST_URL}${path}`, concurrentUsers);
}

async function runLoadTest() {
  console.log('\n🚀 MealScout Quick Load Test\n');
    console.log(`Target: ${LOAD_TEST_URL}`);
  console.log(`Started: ${new Date().toISOString()}\n`);
  
  const tests: Promise<TestResult>[] = [
    // Critical read endpoints
    testEndpoint('/api/deals/active', 200),
    testEndpoint('/api/deals/nearby/40.7128/-74.0060', 150),
    testEndpoint('/api/restaurants/subscribed/40.7128/-74.0060', 100),
    testEndpoint('/api/deals/featured', 100),
    testEndpoint('/health', 500),
  ];
  
  const results = await Promise.all(tests);
  
  console.log('\n📊 RESULTS:\n');
  console.log('━'.repeat(80));
  console.log('Endpoint'.padEnd(40) + 'Avg (ms)'.padEnd(12) + 'Max (ms)'.padEnd(12) + 'Error %'.padEnd(10) + 'Status');
  console.log('━'.repeat(80));
  
  let allPassed = true;
  for (const result of results) {
    const status = result.errorRate === 0 && result.avgResponseTime < 500 ? '✅ PASS' : '❌ FAIL';
    if (status.includes('FAIL')) allPassed = false;
    
    console.log(
      result.name.padEnd(40) +
      Math.round(result.avgResponseTime).toString().padEnd(12) +
      Math.round(result.maxResponseTime).toString().padEnd(12) +
      result.errorRate.toFixed(1).padEnd(10) +
      status
    );
  }
  
  console.log('━'.repeat(80));
  console.log(`\n${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('\nCriteria:');
  console.log('  - Average response time < 500ms');
  console.log('  - Error rate = 0%');
  console.log('  - Handles concurrent load successfully\n');
  
  if (!allPassed) {
    console.log('⚠️  Fix failing endpoints before launching to 1000 users');
    process.exit(1);
  }
}

runLoadTest().catch(console.error);
