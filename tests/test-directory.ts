import { DirectoryManager } from '../src/git/directory.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { rm } from 'fs/promises';

async function test() {
  const testBaseDir = join(tmpdir(), 'parallel-ui-test');
  const dm = new DirectoryManager(testBaseDir);
  
  console.log('Testing DirectoryManager...');
  console.log('Base directory:', dm.getBaseDir());
  
  const projectPath = '/Users/test/my-app';
  
  console.log('\n1. Testing project directory creation:');
  const projectDirName = dm.getProjectDirName(projectPath);
  console.log('Project dir name:', projectDirName);
  console.log('Project dir path:', dm.getProjectDir(projectPath));
  
  console.log('\n2. Initializing metadata:');
  await dm.ensureDirectories(projectPath);
  const metadata = await dm.initializeMetadata(projectPath, 'git@github.com:test/my-app.git');
  console.log('Initial metadata:', JSON.stringify(metadata, null, 2));
  
  console.log('\n3. Getting next variant ID:');
  const nextId = await dm.getNextVariantId(projectPath);
  console.log('Next variant ID:', nextId);
  
  console.log('\n4. Adding a variant:');
  await dm.addVariant(projectPath, {
    id: nextId,
    branch: `ui-var/${nextId}-test`,
    description: 'Test variant',
    createdAt: new Date().toISOString(),
    status: 'created',
    port: 5173
  });
  
  const updatedMetadata = await dm.readMetadata(projectPath);
  console.log('Updated metadata:', JSON.stringify(updatedMetadata, null, 2));
  
  console.log('\n5. Getting next ID after adding variant:');
  const nextId2 = await dm.getNextVariantId(projectPath);
  console.log('Next variant ID:', nextId2);
  
  console.log('\n6. Listing projects:');
  const projects = await dm.listProjects();
  console.log('Projects:', projects);
  
  console.log('\n7. Removing variant:');
  await dm.removeVariant(projectPath, nextId);
  const finalMetadata = await dm.readMetadata(projectPath);
  console.log('Final metadata:', JSON.stringify(finalMetadata, null, 2));
  
  console.log('\n8. Cleaning up test directory...');
  await rm(testBaseDir, { recursive: true, force: true });
  console.log('Test completed successfully!');
}

test().catch(console.error);