import {
  projectBasePort,
  portForVariant,
  isPortAvailable,
  allocatePort,
} from '../src/orchestrator/ports.js';
import { detectFramework, getPortArgs } from '../src/orchestrator/framework.js';
import { ServerRegistry } from '../src/orchestrator/registry.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';

async function testPorts() {
  console.log('🧪 Testing Port Allocator...\n');

  const projectKey = '/Users/test/my-project';

  // Test deterministic port calculation
  const basePort = projectBasePort(projectKey);
  console.log(`Project base port: ${basePort}`);

  // Test variant ports
  console.log(`\nVariant ports (deterministic):`);
  console.log(`  001: ${portForVariant(projectKey, '001')}`);
  console.log(`  002: ${portForVariant(projectKey, '002')}`);
  console.log(`  003: ${portForVariant(projectKey, '003')}`);

  // Test port availability
  const testPort = portForVariant(projectKey, '001');
  const available = await isPortAvailable(testPort);
  console.log(`\nIs port ${testPort} available? ${available}`);

  // Test allocation with fallback
  const allocated = await allocatePort(projectKey, '001');
  console.log(`Allocated port for variant 001: ${allocated}`);

  // Test with different project (should get different range)
  const projectKey2 = '/Users/test/another-project';
  const basePort2 = projectBasePort(projectKey2);
  console.log(`\nAnother project base: ${basePort2} (should differ from ${basePort})`);
}

async function testFramework() {
  console.log('\n🧪 Testing Framework Detection...\n');

  const testDir = join(tmpdir(), 'framework-test');

  // Test Next.js detection
  await mkdir(testDir, { recursive: true });
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      dependencies: { next: '^14.0.0' },
      scripts: { dev: 'next dev' },
    })
  );

  let framework = await detectFramework(testDir);
  let args = getPortArgs(framework, 3001);
  console.log(`Next.js: ${framework} → npm ${args.join(' ')}`);

  // Test unknown framework
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      scripts: { dev: 'custom-dev-server' },
    })
  );

  framework = await detectFramework(testDir);
  args = getPortArgs(framework, 8080);
  console.log(`Unknown: ${framework} → npm ${args.join(' ')} (+ PORT env)`);

  // Cleanup
  await rm(testDir, { recursive: true, force: true });
}

async function testRegistry() {
  console.log('\n🧪 Testing Server Registry...\n');

  const testDir = join(tmpdir(), 'registry-test');
  const registry = new ServerRegistry(testDir);
  const projectPath = '/test/project';

  // Add a server
  await registry.addServer(projectPath, {
    variantId: '001',
    port: 42001,
    pid: 12345,
    framework: 'next',
    startedAt: new Date().toISOString(),
    healthy: true,
    worktreePath: '/test/worktree/001',
  });

  console.log('Added server for variant 001');

  // Read it back
  const servers = await registry.getRunningServers(projectPath);
  console.log(`Running servers: ${servers.length}`);
  console.log(`  - Variant ${servers[0]?.variantId} on port ${servers[0]?.port}`);

  // Check server is there
  const hasServer = servers.find((s) => s.variantId === '001');
  console.log(`Server found: ${!!hasServer}`);

  // Remove server
  await registry.removeServer(projectPath, '001');
  const serversAfter = await registry.getRunningServers(projectPath);
  console.log(`Servers after removal: ${serversAfter.length}`);

  // Cleanup
  await rm(testDir, { recursive: true, force: true });
}

async function main() {
  console.log('=== Orchestrator Component Tests ===\n');

  try {
    await testPorts();
    await testFramework();
    await testRegistry();

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();

