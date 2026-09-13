/**
 * Race Condition Test - Verify deal claim limits work under concurrent load
 * Usage: node --import tsx scripts/raceConditionTest.ts
 */

const RACE_TEST_URL = process.env.TEST_URL || 'http://localhost:5200';
let authToken: string | null = null;

async function createTestUser(email: string): Promise<string> {
  const response = await fetch(`${RACE_TEST_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass123!',
      fullName: 'Load Test User'
    }),
    credentials: 'include'
  });
  
  if (!response.ok) {
    // User might already exist, try login
    const loginRes = await fetch(`${RACE_TEST_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'TestPass123!' }),
      credentials: 'include'
    });
    const cookies = loginRes.headers.get('set-cookie');
    return cookies?.split(';')[0]?.split('=')[1] || '';
  }
  
  const cookies = response.headers.get('set-cookie');
  return cookies?.split(';')[0]?.split('=')[1] || '';
}

async function claimDeal(dealId: string, userId: number): Promise<boolean> {
  const response = await fetch(`${RACE_TEST_URL}/api/deals/${dealId}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': authToken ? `connect.sid=${authToken}` : ''
    },
    credentials: 'include'
  });
  
  return response.ok;
}

async function testDealClaimRace() {
  console.log('\n🏁 Testing deal claim race conditions...\n');
  
  // Get a deal with limited uses
  const dealsRes = await fetch(`${RACE_TEST_URL}/api/deals/active`);
  const deals = await dealsRes.json();
  
  if (!deals || deals.length === 0) {
    console.log('⚠️  No active deals found. Create test deals first.');
    return;
  }
  
  const testDeal = deals.find((d: any) => d.maxUses && d.maxUses > 0 && d.maxUses <= 20);
  if (!testDeal) {
    console.log('⚠️  No suitable deal found (need deal with maxUses between 1-20)');
    return;
  }
  
  console.log(`Testing deal: ${testDeal.title}`);
  console.log(`Max uses: ${testDeal.maxUses}`);
  console.log(`Current uses: ${testDeal.currentUses || 0}`);
  console.log(`Remaining: ${testDeal.maxUses - (testDeal.currentUses || 0)}\n`);
  
  // Create test users
  const userCount = testDeal.maxUses * 3; // Attempt 3x the limit
  console.log(`Creating ${userCount} concurrent claim attempts...\n`);
  
  const claimPromises = Array(userCount).fill(null).map(async (_, i) => {
    const email = `loadtest${i}@test.com`;
    authToken = await createTestUser(email);
    return claimDeal(testDeal.id, i);
  });
  
  const results = await Promise.all(claimPromises);
  const successes = results.filter(r => r).length;
  
  console.log('━'.repeat(60));
  console.log(`Total attempts: ${userCount}`);
  console.log(`Successful claims: ${successes}`);
  console.log(`Rejected: ${userCount - successes}`);
  console.log(`Expected max: ${testDeal.maxUses}`);
  console.log('━'.repeat(60));
  
  if (successes <= testDeal.maxUses) {
    console.log('\n✅ PASS: Deal limit enforced correctly under concurrent load');
  } else {
    console.log('\n❌ FAIL: More claims succeeded than allowed!');
    console.log('⚠️  CRITICAL: Race condition detected in deal claiming logic');
    process.exit(1);
  }
}

testDealClaimRace().catch(console.error);
