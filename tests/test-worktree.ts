import { WorktreeManager } from '../src/git/worktree.js';
import { DirectoryManager } from '../src/git/directory.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, writeFile, rm } from 'fs/promises';
import { simpleGit } from 'simple-git';

async function setupTestRepo(path: string) {
  await mkdir(path, { recursive: true });
  const git = simpleGit(path);
  
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  
  await writeFile(join(path, 'README.md'), '# Test Project\n');
  await writeFile(join(path, 'index.html'), '<h1>Hello World</h1>\n');
  
  await git.add('.');
  await git.commit('Initial commit');
  
  return git;
}

async function testWorktree() {
  const testDir = join(tmpdir(), 'parallel-ui-worktree-test');
  const repoDir = join(testDir, 'test-repo');
  const parallelUiDir = join(testDir, '.parallel-ui');  // This mimics ~/.parallel-ui
  
  console.log('Setting up test environment...');
  console.log('Test repo:', repoDir);
  console.log('Parallel UI dir:', parallelUiDir);
  
  try {
    await rm(testDir, { recursive: true, force: true });
    
    console.log('\n1. Creating test repository...');
    await setupTestRepo(repoDir);
    
    const dm = new DirectoryManager(parallelUiDir);  // Pass base dir, not variants dir
    const wm = new WorktreeManager(repoDir, dm);
    
    console.log('\n2. Checking if it\'s a git repo...');
    const isGit = await wm.isGitRepo();
    console.log('Is git repo:', isGit);
    
    console.log('\n3. Getting current branch...');
    const branch = await wm.getCurrentBranch();
    console.log('Current branch:', branch);
    
    console.log('\n4. Checking working directory...');
    const dirStatus = await wm.checkWorkingDirectory();
    console.log('Working directory clean:', dirStatus.isClean);
    if (dirStatus.message) console.log('Message:', dirStatus.message);
    
    console.log('\n5. Creating first worktree...');
    const worktree1 = await wm.createWorktree('HEAD', 'new-header');
    console.log('Created worktree:', worktree1);
    
    console.log('\n6. Creating second worktree...');
    const worktree2 = await wm.createWorktree('HEAD', 'sidebar-update');
    console.log('Created worktree:', worktree2);
    
    console.log('\n7. Listing managed worktrees...');
    const worktrees = await wm.listManagedWorktrees();
    console.log('Managed worktrees:');
    worktrees.forEach(w => {
      console.log(`  - ${w.branch} at ${w.path} (variant: ${w.variantId})`);
    });
    
    console.log('\n8. Checking metadata...');
    const metadata = await dm.readMetadata(repoDir);
    console.log('Variants in metadata:', metadata?.variants.length);
    metadata?.variants.forEach(v => {
      console.log(`  - ${v.id}: ${v.branch} (${v.description})`);
    });
    
    console.log('\n9. Making changes in worktree 001...');
    const worktree1Path = dm.getVariantDir(repoDir, worktree1.variantId);
    await writeFile(join(worktree1Path, 'style.css'), 'body { color: blue; }\n');
    const worktree1Git = simpleGit(worktree1Path);
    await worktree1Git.add('.');
    await worktree1Git.commit('Add styles');
    
    console.log('\n10. Testing patch application...');
    const patch = `diff --git a/README.md b/README.md
index 2965834..1234567 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,3 @@
 # Test Project
+
+This is a test project for worktree functionality.
`;
    await wm.applyPatchToWorktree(worktree2.variantId, patch);
    console.log('Patch applied successfully');
    
    console.log('\n11. Removing worktree 002...');
    await wm.removeWorktree(worktree2.variantId);
    
    console.log('\n12. Final worktree list...');
    const finalWorktrees = await wm.listManagedWorktrees();
    console.log('Remaining managed worktrees:', finalWorktrees.length);
    finalWorktrees.forEach(w => {
      console.log(`  - ${w.branch} (variant: ${w.variantId})`);
    });
    
    console.log('\n13. Cleaning up...');
    await wm.removeWorktree(worktree1.variantId);
    await rm(testDir, { recursive: true, force: true });
    
    console.log('\n✅ Worktree test completed successfully!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {}
    process.exit(1);
  }
}

testWorktree();