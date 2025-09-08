import { allocatePortWithReservation } from '../src/orchestrator/ports.js';
import { createServer } from 'net';

async function testPortReservation() {
  console.log('🧪 Testing Port Reservation...\n');
  
  const projectKey = '/test/project';
  
  // Test 1: Reserve a port
  console.log('1. Reserving port for variant 001...');
  const reservation1 = await allocatePortWithReservation(projectKey, '001');
  console.log(`   Reserved port: ${reservation1.port}`);
  
  // Test 2: Try to allocate same variant (should get different port due to reservation)
  console.log('\n2. Trying to reserve same variant again...');
  const reservation2 = await allocatePortWithReservation(projectKey, '001');
  console.log(`   Got different port: ${reservation2.port} (expected != ${reservation1.port})`);
  console.log(`   Success: ${reservation2.port !== reservation1.port}`);
  
  // Test 3: Release first reservation
  console.log('\n3. Releasing first reservation...');
  await reservation1.release();
  console.log('   Released!');
  
  // Test 4: Now we should be able to get the original port back
  console.log('\n4. Trying to reserve variant 001 again...');
  const reservation3 = await allocatePortWithReservation(projectKey, '001');
  console.log(`   Got port: ${reservation3.port} (should match original ${reservation1.port})`);
  console.log(`   Success: ${reservation3.port === reservation1.port}`);
  
  // Cleanup
  await reservation2.release();
  await reservation3.release();
  
  // Test 5: Verify the reservation actually blocks the port
  console.log('\n5. Testing that reservation actually blocks port...');
  const reservation4 = await allocatePortWithReservation(projectKey, '002');
  console.log(`   Reserved port ${reservation4.port} for variant 002`);
  
  // Try to create a server on the same port (should fail)
  const testServer = createServer();
  let blocked = false;
  await new Promise<void>((resolve) => {
    testServer.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        blocked = true;
      }
      resolve();
    });
    testServer.once('listening', () => {
      testServer.close();
      resolve();
    });
    testServer.listen(reservation4.port, '127.0.0.1');
  });
  
  console.log(`   Port is blocked: ${blocked} (expected: true)`);
  
  await reservation4.release();
  
  console.log('\n✅ Port reservation test passed!');
}

testPortReservation().catch(console.error);