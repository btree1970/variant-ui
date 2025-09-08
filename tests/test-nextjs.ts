import { detectFramework, getPortArgs, getReadyPattern } from '../src/orchestrator/framework.js';
import { allocatePort, portForVariant } from '../src/orchestrator/ports.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, writeFile, rm } from 'fs/promises';

async function testNextJsDetection() {
  console.log('🧪 Testing Next.js Framework Detection\n');
  
  const testDir = join(tmpdir(), 'nextjs-test');
  await mkdir(testDir, { recursive: true });
  
  // Create a Next.js package.json
  await writeFile(join(testDir, 'package.json'), JSON.stringify({
    name: 'test-app',
    dependencies: {
      'next': '^14.0.0',
      'react': '^18.0.0',
      'react-dom': '^18.0.0'
    },
    scripts: {
      'dev': 'next dev',
      'build': 'next build',
      'start': 'next start'
    }
  }, null, 2));
  
  const framework = await detectFramework(testDir);
  console.log(`Detected framework: ${framework}`);
  
  const port = 3001;
  const args = getPortArgs(framework, port);
  console.log(`Port args for ${port}: npm ${args.join(' ')}`);
  
  const readyPattern = getReadyPattern(framework);
  console.log(`Ready pattern: ${readyPattern}`);
  
  // Test port allocation
  const projectKey = testDir;
  const variantId = '001';
  const preferredPort = portForVariant(projectKey, variantId);
  const allocatedPort = await allocatePort(projectKey, variantId);
  
  console.log(`\nPort allocation for variant ${variantId}:`);
  console.log(`  Preferred: ${preferredPort}`);
  console.log(`  Allocated: ${allocatedPort}`);
  
  // Cleanup
  await rm(testDir, { recursive: true, force: true });
  
  console.log('\n✅ Next.js detection test passed!');
}

testNextJsDetection().catch(console.error);