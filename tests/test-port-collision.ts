import { createServer } from 'net';
import { allocatePort, portForVariant } from '../src/orchestrator/ports.js';

async function testPortCollision() {
  console.log('🧪 Testing Port Collision Handling...\n');
  
  const projectKey = '/test/project';
  
  // Get the preferred port for variant 001
  const preferredPort = portForVariant(projectKey, '001');
  console.log(`Preferred port for variant 001: ${preferredPort}`);
  
  // Occupy that port
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject);
    blocker.once('listening', resolve);
    blocker.listen(preferredPort, '127.0.0.1');
  });
  
  console.log(`Blocked port ${preferredPort} with test server`);
  
  // Try to allocate - should fallback
  const allocated = await allocatePort(projectKey, '001');
  console.log(`Allocated port (with fallback): ${allocated}`);
  console.log(`Fallback worked: ${allocated !== preferredPort}`);
  
  // Clean up
  await new Promise<void>((resolve) => blocker.close(() => resolve()));
  
  // Now it should get the preferred port again
  const allocatedAgain = await allocatePort(projectKey, '001');
  console.log(`\nAfter cleanup, allocated: ${allocatedAgain}`);
  console.log(`Got preferred port back: ${allocatedAgain === preferredPort}`);
}

testPortCollision().catch(console.error);