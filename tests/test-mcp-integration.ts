import { spawn } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { simpleGit } from 'simple-git';

async function setupTestRepo(path: string) {
  await mkdir(path, { recursive: true });
  const git = simpleGit(path);
  
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');
  
  await writeFile(join(path, 'index.html'), '<h1>Original Content</h1>\n');
  await writeFile(join(path, 'style.css'), 'body { margin: 0; }\n');
  
  await git.add('.');
  await git.commit('Initial commit');
  
  return git;
}

function sendRequest(server: any, request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestStr = JSON.stringify(request) + '\n';
    
    const handleResponse = (data: Buffer) => {
      try {
        const response = JSON.parse(data.toString());
        server.stdout.off('data', handleResponse);
        resolve(response);
      } catch (e) {
        // Partial response, wait for more
      }
    };
    
    server.stdout.on('data', handleResponse);
    server.stdin.write(requestStr);
    
    setTimeout(() => {
      server.stdout.off('data', handleResponse);
      reject(new Error('Request timeout'));
    }, 5000);
  });
}

async function testMCPIntegration() {
  const testDir = join(tmpdir(), 'mcp-integration-test');
  const repoDir = join(testDir, 'test-repo');
  
  console.log('Setting up test environment...');
  console.log('Test repo:', repoDir);
  
  try {
    await rm(testDir, { recursive: true, force: true });
    
    console.log('\n1. Creating test repository...');
    await setupTestRepo(repoDir);
    
    console.log('\n2. Starting MCP server...');
    // Get the path to the built server relative to where we're running
    const serverPath = join(process.cwd(), 'dist', 'index.js');
    
    // Start server with the test repo as working directory argument
    const server = spawn('node', [serverPath, repoDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });
    
    server.stderr.on('data', (data) => {
      const msg = data.toString();
      if (!msg.includes('MCP Server started')) {
        console.error('Server error:', msg);
      }
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n3. Testing check_status tool...');
    const statusRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'check_status',
        arguments: {}
      }
    };
    
    const statusResponse = await sendRequest(server, statusRequest);
    console.log('Status response:', statusResponse.result?.content?.[0]?.text || 'No response');
    
    console.log('\n4. Testing create_variation tool...');
    const createRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'create_variation',
        arguments: {
          baseRef: 'HEAD',
          description: 'new header design'
        }
      }
    };
    
    const createResponse = await sendRequest(server, createRequest);
    console.log('Create response:', createResponse.result?.content?.[0]?.text || 'No response');
    
    console.log('\n5. Testing list_variations tool...');
    const listRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'list_variations',
        arguments: {}
      }
    };
    
    const listResponse = await sendRequest(server, listRequest);
    console.log('List response:', listResponse.result?.content?.[0]?.text || 'No response');
    
    console.log('\n6. Testing list resources...');
    const resourcesRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/list',
      params: {}
    };
    
    const resourcesResponse = await sendRequest(server, resourcesRequest);
    console.log('Resources:', JSON.stringify(resourcesResponse.result?.resources || [], null, 2));
    
    console.log('\n7. Cleaning up...');
    server.kill();
    await rm(testDir, { recursive: true, force: true });
    
    console.log('\n✅ MCP integration test completed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {}
    process.exit(1);
  }
}

testMCPIntegration();