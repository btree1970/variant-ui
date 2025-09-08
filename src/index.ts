#!/usr/bin/env node
import { MCPServer } from './mcp/server.js';

async function main() {
  const server = new MCPServer();
  await server.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
