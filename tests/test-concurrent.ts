import { DirectoryManager } from '../src/git/directory.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { rm } from 'fs/promises';

async function testConcurrent() {
  const testBaseDir = join(tmpdir(), 'parallel-ui-concurrent-test');
  const dm = new DirectoryManager(testBaseDir);
  
  console.log('Testing concurrent operations...');
  console.log('Base directory:', dm.getBaseDir());
  
  const projectPath = '/Users/test/concurrent-app';
  
  console.log('\n1. Testing concurrent variant creation:');
  
  const createVariant = async (id: string, delay: number) => {
    await new Promise(resolve => setTimeout(resolve, delay));
    await dm.addVariant(projectPath, {
      id,
      branch: `ui-var/${id}-concurrent`,
      description: `Concurrent variant ${id}`,
      createdAt: new Date().toISOString(),
      status: 'created',
    });
    console.log(`  - Created variant ${id}`);
  };
  
  const promises = [
    createVariant('001', 0),
    createVariant('002', 10),
    createVariant('003', 5),
    createVariant('004', 15),
    createVariant('005', 2),
  ];
  
  await Promise.all(promises);
  
  console.log('\n2. Checking final metadata:');
  const metadata = await dm.readMetadata(projectPath);
  console.log(`  - Total variants: ${metadata?.variants.length}`);
  console.log(`  - Variant IDs: ${metadata?.variants.map(v => v.id).join(', ')}`);
  
  console.log('\n3. Testing concurrent read/write:');
  
  const updateVariant = async (id: string) => {
    await dm.updateVariant(projectPath, id, (variant) => {
      variant.port = 5173 + parseInt(id);
      variant.lastUpdatedAt = new Date().toISOString();
      return variant;
    });
    console.log(`  - Updated variant ${id} with port ${5173 + parseInt(id)}`);
  };
  
  const updatePromises = [
    updateVariant('001'),
    updateVariant('002'),
    updateVariant('003'),
  ];
  
  await Promise.all(updatePromises);
  
  console.log('\n4. Final metadata check:');
  const finalMetadata = await dm.readMetadata(projectPath);
  finalMetadata?.variants.forEach(v => {
    if (v.port) {
      console.log(`  - Variant ${v.id}: port ${v.port}`);
    }
  });
  
  console.log('\n5. Testing concurrent removal:');
  
  const removePromises = [
    dm.removeVariant(projectPath, '001'),
    dm.removeVariant(projectPath, '003'),
    dm.removeVariant(projectPath, '005'),
  ];
  
  await Promise.all(removePromises);
  
  const afterRemoval = await dm.readMetadata(projectPath);
  console.log(`  - Remaining variants: ${afterRemoval?.variants.map(v => v.id).join(', ')}`);
  
  console.log('\n6. Cleaning up test directory...');
  await rm(testBaseDir, { recursive: true, force: true });
  console.log('Concurrent test completed successfully!');
}

testConcurrent().catch(console.error);