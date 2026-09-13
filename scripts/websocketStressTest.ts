/**
 * WebSocket Stress Test - Verify 1000 concurrent Socket.IO connections
 * Usage: node --import tsx scripts/websocketStressTest.ts
 */

import { io, Socket } from 'socket.io-client';

const BASE_URL = process.env.TEST_URL || 'http://localhost:5200';
const TARGET_CONNECTIONS = 1000;

interface ConnectionStats {
  connected: number;
  failed: number;
  avgConnectTime: number;
  errors: string[];
}

async function createConnection(id: number): Promise<{ success: boolean; connectTime: number; error?: string }> {
  const start = Date.now();
  
  return new Promise((resolve) => {
    const socket: Socket = io(BASE_URL, {
      transports: ['websocket'],
      path: '/socket.io',
      timeout: 10000
    });
    
    socket.on('connect', () => {
      const connectTime = Date.now() - start;
      socket.disconnect();
      resolve({ success: true, connectTime });
    });
    
    socket.on('connect_error', (error) => {
      socket.disconnect();
      resolve({ success: false, connectTime: Date.now() - start, error: error.message });
    });
    
    setTimeout(() => {
      if (!socket.connected) {
        socket.disconnect();
        resolve({ success: false, connectTime: Date.now() - start, error: 'Timeout' });
      }
    }, 10000);
  });
}

async function runWebSocketStressTest() {
  console.log('\n🔌 WebSocket Stress Test\n');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Connections: ${TARGET_CONNECTIONS}\n`);
  
  const batchSize = 100;
  const stats: ConnectionStats = {
    connected: 0,
    failed: 0,
    avgConnectTime: 0,
    errors: []
  };
  
  const connectTimes: number[] = [];
  
  for (let i = 0; i < TARGET_CONNECTIONS; i += batchSize) {
    const batch = Math.min(batchSize, TARGET_CONNECTIONS - i);
    console.log(`Connecting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(TARGET_CONNECTIONS / batchSize)} (${batch} connections)...`);
    
    const promises = Array(batch).fill(null).map((_, j) => createConnection(i + j));
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.success) {
        stats.connected++;
        connectTimes.push(result.connectTime);
      } else {
        stats.failed++;
        if (result.error && !stats.errors.includes(result.error)) {
          stats.errors.push(result.error);
        }
      }
    }
    
    // Brief pause between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  stats.avgConnectTime = connectTimes.reduce((a, b) => a + b, 0) / connectTimes.length;
  
  console.log('\n━'.repeat(60));
  console.log('RESULTS:');
  console.log('━'.repeat(60));
  console.log(`Total attempts:     ${TARGET_CONNECTIONS}`);
  console.log(`Successful:         ${stats.connected} (${(stats.connected / TARGET_CONNECTIONS * 100).toFixed(1)}%)`);
  console.log(`Failed:             ${stats.failed} (${(stats.failed / TARGET_CONNECTIONS * 100).toFixed(1)}%)`);
  console.log(`Avg connect time:   ${Math.round(stats.avgConnectTime)}ms`);
  console.log(`Max connect time:   ${Math.round(Math.max(...connectTimes))}ms`);
  console.log('━'.repeat(60));
  
  if (stats.errors.length > 0) {
    console.log('\nErrors encountered:');
    stats.errors.forEach(err => console.log(`  - ${err}`));
  }
  
  const successRate = (stats.connected / TARGET_CONNECTIONS * 100);
  if (successRate >= 95) {
    console.log('\n✅ PASS: WebSocket server handles 1000 concurrent connections');
  } else {
    console.log('\n❌ FAIL: WebSocket connection success rate too low');
    console.log('⚠️  Server may not handle production load');
    process.exit(1);
  }
}

runWebSocketStressTest().catch(console.error);
