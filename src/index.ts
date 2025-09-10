#!/usr/bin/env node
import { MCPServer } from './mcp/server.js';

async function main() {
  // Optional: accept working directory as command line argument for testing
  // Usage: node dist/index.js [working-directory]
  const workingDirectory = process.argv[2] || process.cwd();
  const server = new MCPServer(workingDirectory);

  const shutdown = async (signal: string) => {
    console.error(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await server.shutdown();
      console.error('Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
