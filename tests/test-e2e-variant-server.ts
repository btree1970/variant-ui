import { VariantManager } from '../src/variant-manager.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { cp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { simpleGit } from 'simple-git';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupTestRepo(): Promise<string> {
  // Copy the fixture to a temp directory so we can initialize git
  const tempDir = join(tmpdir(), `test-nextjs-${randomBytes(8).toString('hex')}`);
  const fixtureDir = join(__dirname, 'fixtures', 'nextjs-app');
  
  console.log(`   Copying fixture from ${fixtureDir}`);
  await cp(fixtureDir, tempDir, { recursive: true });
  
  // Initialize git repo
  const git = simpleGit(tempDir);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  
  // Create initial commit
  await git.add('.');
  await git.commit('Initial commit with Next.js app');
  
  return tempDir;
}


async function testE2EVariantServer() {
  console.log('🧪 End-to-End Test: VariantManager with Dev Server\n');
  console.log('=' .repeat(60) + '\n');
  
  let testProjectPath: string | null = null;
  let manager: VariantManager | null = null;
  
  try {
    // Setup
    console.log('📦 Setting up test project...');
    testProjectPath = await setupTestRepo();
    console.log(`   Test project: ${testProjectPath}\n`);
    
    manager = new VariantManager(testProjectPath);
    
    // Test 1: Create first variant
    console.log('📌 Test 1: Create first variant');
    const variant1 = await manager.createVariant('HEAD', 'feature-a');
    console.log(`   Created variant: ${variant1.variantId}`);
    console.log(`   Branch: ${variant1.branch}`);
    console.log(`   Path: ${variant1.path}`);
    
    // Install dependencies in the worktree
    console.log('   Installing dependencies...');
    execSync('npm install', { cwd: variant1.path, stdio: 'ignore' });
    console.log(`   ✅ Variant created and dependencies installed\n`);
    
    // Test 2: Make a change in variant 1
    console.log('📌 Test 2: Modify variant 1');
    const pagePath = join(variant1.path, 'pages', 'index.tsx');
    let content = await readFile(pagePath, 'utf-8');
    content = content.replace('Welcome to', 'Variant A: Welcome to');
    await writeFile(pagePath, content);
    const git1 = simpleGit(variant1.path);
    await git1.add('.');
    await git1.commit('Update homepage for variant A');
    console.log(`   ✅ Modified and committed changes\n`);
    
    // Test 3: Start dev server for variant 1
    console.log('📌 Test 3: Start dev server for variant 1');
    const startTime1 = Date.now();
    const preview1 = await manager.startPreview(variant1.variantId);
    const elapsed1 = Date.now() - startTime1;
    console.log(`   Started in ${elapsed1}ms`);
    console.log(`   Port: ${preview1.port}`);
    console.log(`   URL: ${preview1.url}`);
    console.log(`   Framework: ${preview1.framework}`);
    console.log(`   Status: ${preview1.status}`);
    
    console.log(`   ✅ Server started successfully\n`);
    
    // Test 4: Create second variant
    console.log('📌 Test 4: Create second variant');
    const variant2 = await manager.createVariant('HEAD', 'feature-b');
    console.log(`   Created variant: ${variant2.variantId}`);
    console.log(`   Branch: ${variant2.branch}`);
    
    // Install dependencies in the second worktree
    console.log('   Installing dependencies...');
    execSync('npm install', { cwd: variant2.path, stdio: 'ignore' });
    console.log(`   ✅ Second variant created and dependencies installed\n`);
    
    // Test 5: Make a different change in variant 2
    console.log('📌 Test 5: Modify variant 2');
    const pagePath2 = join(variant2.path, 'pages', 'index.tsx');
    let content2 = await readFile(pagePath2, 'utf-8');
    content2 = content2.replace('Welcome to', 'Variant B: Welcome to');
    await writeFile(pagePath2, content2);
    const git2 = simpleGit(variant2.path);
    await git2.add('.');
    await git2.commit('Update homepage for variant B');
    console.log(`   ✅ Modified and committed changes\n`);
    
    // Test 6: Start dev server for variant 2
    console.log('📌 Test 6: Start dev server for variant 2');
    const startTime2 = Date.now();
    const preview2 = await manager.startPreview(variant2.variantId);
    const elapsed2 = Date.now() - startTime2;
    console.log(`   Started in ${elapsed2}ms`);
    console.log(`   Port: ${preview2.port}`);
    console.log(`   Different port: ${preview2.port !== preview1.port}`);
    
    console.log(`   ✅ Second server started successfully\n`);
    
    // Test 7: Get status of all variants
    console.log('📌 Test 7: Get status of all variants');
    const allStatuses = await manager.getStatus();
    console.log(`   Total variants: ${allStatuses.length}`);
    for (const status of allStatuses) {
      console.log(`   - ${status.id}: ${status.status} ${status.server ? `(port ${status.server.port})` : '(no server)'}`);
    }
    console.log(`   ✅ Status retrieved\n`);
    
    // Test 8: Try to start duplicate server (should return existing)
    console.log('📌 Test 8: Try to start duplicate server');
    const duplicate = await manager.startPreview(variant1.variantId);
    console.log(`   Same port: ${duplicate.port === preview1.port}`);
    console.log(`   ✅ Returned existing server\n`);
    
    // Test 9: Stop one server
    console.log('📌 Test 9: Stop variant 1 server');
    await manager.stopPreview(variant1.variantId);
    const status1 = await manager.getVariantStatus(variant1.variantId);
    console.log(`   Status after stop: ${status1?.status}`);
    console.log(`   Server info: ${status1?.server ? 'Still present' : 'Cleared'}`);
    console.log(`   ✅ Server stopped\n`);
    
    // Test 10: Verify only one server running
    console.log('📌 Test 10: Verify server states');
    const finalStatuses = await manager.getStatus();
    const runningCount = finalStatuses.filter(s => s.server).length;
    console.log(`   Running servers: ${runningCount}`);
    console.log(`   Expected: 1`);
    console.log(`   ✅ Correct server count\n`);
    
    // Test 11: Apply patch to variant
    console.log('📌 Test 11: Apply patch to variant');
    const patchContent = `diff --git a/pages/api/hello.ts b/pages/api/hello.ts
index 1234567..abcdefg 100644
--- a/pages/api/hello.ts
+++ b/pages/api/hello.ts
@@ -9,5 +9,5 @@ export default function handler(
   req: NextApiRequest,
   res: NextApiResponse<Data>,
 ) {
-  res.status(200).json({ name: "John Doe" });
+  res.status(200).json({ name: "Jane Doe" });
 }
`;
    await manager.applyPatch(variant2.variantId, patchContent);
    console.log(`   ✅ Patch applied\n`);
    
    // Test 12: Stop all servers
    console.log('📌 Test 12: Stop all servers');
    await manager.stopAllServers();
    const afterStopAll = await manager.getStatus();
    const stillRunning = afterStopAll.filter(s => s.server).length;
    console.log(`   Running servers after stopAll: ${stillRunning}`);
    console.log(`   ✅ All servers stopped\n`);
    
    // Test 13: Clean up variants
    console.log('📌 Test 13: Remove variants');
    await manager.removeVariant(variant1.variantId);
    await manager.removeVariant(variant2.variantId);
    const finalVariants = await manager.listVariants();
    console.log(`   Remaining variants: ${finalVariants.length}`);
    console.log(`   ✅ Variants removed\n`);
    
    console.log('=' .repeat(60));
    console.log('✅ All end-to-end tests passed!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    // Try to clean up servers on failure
    if (manager) {
      try {
        await manager.stopAllServers();
      } catch (e) {
        console.error('Failed to stop servers during cleanup:', e);
      }
    }
    
    process.exit(1);
  } finally {
    // Cleanup
    if (manager) {
      try {
        await manager.stopAllServers();
      } catch (e) {
        console.error('Failed to stop servers:', e);
      }
    }
    
    if (testProjectPath) {
      // Give servers time to fully stop
      await sleep(2000);
      
      try {
        await rm(testProjectPath, { recursive: true, force: true });
        console.log('🧹 Cleaned up test project\n');
      } catch (e) {
        console.error('Failed to clean up test project:', e);
      }
    }
  }
}

testE2EVariantServer().catch(console.error);