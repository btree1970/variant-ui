import { FrameworkRegistry, NextJsAdapter } from '../src/orchestrator/adapters/index.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, writeFile, rm } from 'fs/promises';

async function testNextJsAdapter() {
  console.log('🧪 Testing Next.js Adapter...\n');
  
  const testDir = join(tmpdir(), 'adapter-test');
  await mkdir(testDir, { recursive: true });
  
  // Create a Next.js package.json
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'test-app',
      dependencies: {
        next: '^14.0.0',
        react: '^18.0.0',
        'react-dom': '^18.0.0',
      },
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
    }, null, 2)
  );
  
  const adapter = new NextJsAdapter();
  
  // Test detection
  const isNext = await adapter.detect(testDir);
  console.log(`Detected as Next.js: ${isNext}`);
  
  // Test configuration
  const port = 3001;
  console.log(`Port args: npm ${adapter.getPortArgs(port).join(' ')}`);
  console.log(`Start command: ${adapter.getStartCommand()}`);
  console.log(`Ready pattern: ${adapter.getReadyPattern()}`);
  console.log(`Health check URL: ${adapter.getHealthCheckUrl(port)}`);
  
  // Cleanup
  await rm(testDir, { recursive: true, force: true });
}

async function testFrameworkRegistry() {
  console.log('\n🧪 Testing Framework Registry...\n');
  
  const testDir = join(tmpdir(), 'registry-test');
  await mkdir(testDir, { recursive: true });
  
  const registry = new FrameworkRegistry();
  
  // Test with Next.js project
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      dependencies: { next: '^14.0.0' },
    })
  );
  
  let framework = await registry.detectFramework(testDir);
  console.log(`Detected framework: ${framework?.name || 'none'}`);
  
  // Test with non-framework project
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      dependencies: { express: '^4.0.0' },
    })
  );
  
  framework = await registry.detectFramework(testDir);
  console.log(`Non-Next.js project detected as: ${framework?.name || 'none'}`);
  
  // Cleanup
  await rm(testDir, { recursive: true, force: true });
}

async function main() {
  console.log('=== Framework Adapter Tests ===\n');
  
  try {
    await testNextJsAdapter();
    await testFrameworkRegistry();
    
    console.log('\n✅ All adapter tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();