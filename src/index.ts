#!/usr/bin/env node
import { MCPServer } from './mcp/server.js';

async function main() {
  // Optional: accept working directory as command line argument for testing
  // Usage: node dist/index.js [working-directory]
  const workingDirectory = process.argv[2] || process.cwd();
  const server = new MCPServer(workingDirectory);
  await server.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
