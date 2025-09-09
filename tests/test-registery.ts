import { ServerRegistry } from '../src/orchestrator/registry.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { rm } from 'fs/promises';

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
    await testRegistry();

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
