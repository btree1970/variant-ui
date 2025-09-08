import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

server.stderr.on('data', (data) => {
  console.log('Server log:', data.toString());
});

// Send a request to list tools
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
};

setTimeout(() => {
  server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
}, 500);

server.stdout.on('data', (data) => {
  console.log('Server response:', data.toString());
  
  // Test the echo tool
  const callToolRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'test_echo',
      arguments: { message: 'Hello MCP!' }
    }
  };
  
  setTimeout(() => {
    server.stdin.write(JSON.stringify(callToolRequest) + '\n');
  }, 100);
});

setTimeout(() => {
  console.log('Test complete');
  server.kill();
  process.exit(0);
}, 3000);