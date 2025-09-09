import { DevServerManager } from '../src/orchestrator/dev-server.js';
import { createHash } from 'crypto';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function testDevServer() {
  console.log('🧪 Testing DevServerManager with Next.js Fixture\n');
  console.log('=' .repeat(60) + '\n');
  
  const testAppPath = join(__dirname, 'fixtures', 'nextjs-app');
  const projectKey = createHash('sha256').update(testAppPath).digest('hex').slice(0, 12);
  
  console.log(`Test app path: ${testAppPath}\n`);
  
  const manager = new DevServerManager();
  
  try {
    // Test 1: Start dev server
    console.log('📌 Test 1: Starting dev server\n');
    
    const startTime = Date.now();
    const info = await manager.startServer({
      projectPath: testAppPath,
      variantId: '001',
      projectKey,
      onReady: (info) => {
        const elapsed = Date.now() - startTime;
        console.log(`✅ Server ready in ${elapsed}ms`);
        console.log(`   URL: ${info.url}`);
        console.log(`   Port: ${info.port}\n`);
      },
      onError: (error) => {
        console.error('❌ Server error:', error.message);
      },
    });
    
    console.log('Server info:', {
      port: info.port,
      framework: info.framework,
      status: info.status,
    });
    
    // Test 2: Framework detection
    console.log('\n📌 Test 2: Framework detection');
    console.log(`   Detected: ${info.framework}`);
    console.log(`   Correct: ${info.framework === 'next'}`);
    
    // Test 3: Duplicate start prevention
    console.log('\n📌 Test 3: Duplicate start prevention');
    const duplicate = await manager.startServer({
      projectPath: testAppPath,
      variantId: '001',
      projectKey,
    });
    console.log(`   Same port: ${duplicate.port === info.port}`);
    console.log(`   Same status: ${duplicate.status === info.status}`);
    
    // Test 4: Multiple variants with different ports
    console.log('\n📌 Test 4: Multiple variants');
    const info2 = await manager.startServer({
      projectPath: testAppPath,
      variantId: '002',
      projectKey,
    });
    console.log(`   Variant 002 port: ${info2.port}`);
    console.log(`   Different ports: ${info2.port !== info.port}`);
    
    // Test 5: List servers
    console.log('\n📌 Test 5: Server listing');
    const servers = manager.listServers();
    console.log(`   Active servers: ${servers.length}`);
    servers.forEach(s => {
      console.log(`   - ${s.variantId}: port ${s.port} (${s.status})`);
    });
    
    // Test 6: Get specific server
    console.log('\n📌 Test 6: Get specific server');
    const retrieved = manager.getServer(projectKey, '001');
    console.log(`   Found: ${retrieved !== null}`);
    console.log(`   Port matches: ${retrieved?.port === info.port}`);
    
    // Test 7: Stop individual server
    console.log('\n📌 Test 7: Stop individual server');
    await manager.stopServer(projectKey, '001');
    const afterStop = manager.getServer(projectKey, '001');
    console.log(`   Stopped: ${afterStop === null}`);
    console.log(`   Remaining: ${manager.listServers().length}`);
    
    // Test 8: Stop all
    console.log('\n📌 Test 8: Stop all servers');
    await manager.stopAll();
    console.log(`   All stopped: ${manager.listServers().length === 0}`);
    
    console.log('\n' + '=' .repeat(60));
    console.log('✅ All tests passed!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await manager.stopAll();
    process.exit(1);
  }
}

testDevServer().catch(console.error);