import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { VariantManager } from '../variant-manager.js';
import { simpleGit } from 'simple-git';
import { realpath } from 'fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import {
  CreateVariationSchema,
  ListVariationsSchema,
  RemoveVariationSchema,
  CheckStatusSchema,
  StartPreviewSchema,
  StopPreviewSchema,
  PreviewStatusSchema,
} from './validation.js';

export class MCPServer {
  private server: Server;
  private workingDirectory: string;
  private gitRoot?: string;
  private variantManager?: VariantManager;
  private httpServer?: ReturnType<typeof createServer>;
  private httpPort = 5400;
  private sseClients: Set<ServerResponse> = new Set();

  constructor(workingDirectory?: string) {
    this.workingDirectory = workingDirectory || process.cwd();

    this.server = new Server(
      {
        name: 'mcp-ui-variants',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async getGitRoot(): Promise<string> {
    if (!this.gitRoot) {
      try {
        // Get the canonical git root directory
        const git = simpleGit(this.workingDirectory);
        const root = (await git.raw(['rev-parse', '--show-toplevel'])).trim();
        this.gitRoot = await realpath(root);
      } catch (error) {
        throw new Error(`Not in a git repository: ${(error as Error).message}`);
      }
    }
    return this.gitRoot;
  }

  private async getVariantManager(): Promise<VariantManager> {
    if (!this.variantManager) {
      const gitRoot = await this.getGitRoot();
      this.variantManager = new VariantManager(gitRoot);
      this.setupEventListeners();
    }
    return this.variantManager;
  }

  private setupEventListeners() {
    if (!this.variantManager) return;

    this.variantManager.on('variant:created', (event) => {
      console.error(`[Event] Variant created: ${event.variant.id} - ${event.variant.description}`);
      this.broadcastSSE({ type: 'variant:created', data: event });
    });

    this.variantManager.on('variant:removed', (event) => {
      console.error(`[Event] Variant removed: ${event.variantId}`);
      this.broadcastSSE({ type: 'variant:removed', data: event });
    });

    this.variantManager.on('variant:updated', (event) => {
      console.error(
        `[Event] Variant updated: ${event.variant.id} - status: ${event.variant.status}`
      );
      this.broadcastSSE({ type: 'variant:updated', data: event });
    });

    this.variantManager.on('preview:starting', (event) => {
      console.error(`[Event] Preview starting: ${event.variantId}`);
      this.broadcastSSE({ type: 'preview:starting', data: event });
    });

    this.variantManager.on('preview:ready', (event) => {
      console.error(`[Event] Preview ready: ${event.variantId} at ${event.url}`);
      this.broadcastSSE({ type: 'preview:ready', data: event });
    });

    this.variantManager.on('preview:failed', (event) => {
      console.error(`[Event] Preview failed: ${event.variantId} - ${event.error}`);
      this.broadcastSSE({ type: 'preview:failed', data: event });
    });

    this.variantManager.on('preview:stopped', (event) => {
      console.error(`[Event] Preview stopped: ${event.variantId}`);
      this.broadcastSSE({ type: 'preview:stopped', data: event });
    });
  }

  private broadcastSSE(event: { type: string; data: unknown }) {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    const deadClients: ServerResponse[] = [];

    this.sseClients.forEach((client) => {
      try {
        client.write(message);
      } catch {
        deadClients.push(client);
      }
    });

    deadClients.forEach((client) => this.sseClients.delete(client));
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_variation',
            description: 'Create a new UI variation in a git worktree',
            inputSchema: {
              type: 'object',
              properties: {
                baseRef: {
                  type: 'string',
                  description: 'Git reference to base variation on (e.g., HEAD, main, commit-hash)',
                  default: 'HEAD',
                },
                description: {
                  type: 'string',
                  description: 'Description of the variation (used in branch name)',
                },
              },
              required: ['description'],
            },
          },
          {
            name: 'list_variations',
            description: 'List all active UI variations',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'remove_variation',
            description: 'Remove a UI variation and its worktree',
            inputSchema: {
              type: 'object',
              properties: {
                variantId: {
                  type: 'string',
                  description: 'ID of the variation to remove (e.g., 001, 002)',
                },
              },
              required: ['variantId'],
            },
          },
          {
            name: 'check_status',
            description: 'Check git status and working directory state',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'start_preview',
            description: 'Start a development server for a UI variation',
            inputSchema: {
              type: 'object',
              properties: {
                variantId: {
                  type: 'string',
                  description: 'ID of the variation to preview',
                },
              },
              required: ['variantId'],
            },
          },
          {
            name: 'stop_preview',
            description: 'Stop the development server for a UI variation',
            inputSchema: {
              type: 'object',
              properties: {
                variantId: {
                  type: 'string',
                  description: 'ID of the variation to stop previewing',
                },
              },
              required: ['variantId'],
            },
          },
          {
            name: 'preview_status',
            description: 'Get the status of all preview servers',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool execution
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_variation':
            return await this.handleCreateVariation(args);

          case 'list_variations':
            return await this.handleListVariations(args);

          case 'remove_variation':
            return await this.handleRemoveVariation(args);

          case 'check_status':
            return await this.handleCheckStatus(args);

          case 'start_preview':
            return await this.handleStartPreview(args);

          case 'stop_preview':
            return await this.handleStopPreview(args);

          case 'preview_status':
            return await this.handlePreviewStatus(args);

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${(error as Error).message}`,
            },
          ],
        };
      }
    });

    // Handle resource listing
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const vm = await this.getVariantManager();
      const variants = await vm.listVariants();

      const resources = [
        {
          uri: 'variant://list',
          name: 'Active Variations',
          description: 'List of all active UI variations',
          mimeType: 'application/json',
        },
      ];

      for (const variant of variants) {
        resources.push({
          uri: `variant://${variant.id}`,
          name: `Variation ${variant.id}`,
          description: variant.description || variant.branch,
          mimeType: 'application/json',
        });
      }

      return { resources };
    });

    // Handle resource reading
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'variant://list') {
        const vm = await this.getVariantManager();
        const variants = await vm.listVariants();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(variants, null, 2),
            },
          ],
        };
      }

      if (uri.startsWith('variant://')) {
        const variantId = uri.replace('variant://', '');
        const vm = await this.getVariantManager();
        const status = await vm.getVariantStatus(variantId);

        if (!status) {
          throw new Error(`Variant ${variantId} not found`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  private async handleCreateVariation(args: unknown) {
    const input = CreateVariationSchema.parse(args);
    const { baseRef, description } = input;

    const vm = await this.getVariantManager();

    // Create the variant
    const result = await vm.createVariant(baseRef || 'HEAD', description);

    return {
      content: [
        {
          type: 'text',
          text: `Created variation ${result.variantId}:
- Branch: ${result.branch}
- Path: ${result.path}
- Base commit: ${result.baseCommit}
- Description: ${description}

You can now cd into ${result.path} to make changes directly, or start a preview server.`,
        },
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: {
                variantId: result.variantId,
                branch: result.branch,
                path: result.path,
                baseCommit: result.baseCommit,
                description,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleListVariations(args: unknown = {}) {
    ListVariationsSchema.parse(args);
    const vm = await this.getVariantManager();
    const statuses = await vm.getStatus();

    if (statuses.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No active variations',
          },
          {
            type: 'text',
            text: JSON.stringify({ success: true, data: [] }, null, 2),
          },
        ],
      };
    }

    let output = `Active variations (${statuses.length}):\n\n`;

    for (const variant of statuses) {
      output += `${variant.id}: ${variant.description || 'No description'}\n`;
      output += `  Branch: ${variant.branch}\n`;
      output += `  Path: ${variant.path}\n`;
      output += `  Created: ${new Date(variant.createdAt).toLocaleString()}\n`;
      if (variant.server) {
        output += `  🚀 Server: http://127.0.0.1:${variant.server.port} (${variant.server.status})\n`;
      }
      output += '\n';
    }

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: statuses }, null, 2),
        },
      ],
    };
  }

  private async handleRemoveVariation(args: unknown) {
    const input = RemoveVariationSchema.parse(args);
    const { variantId } = input;

    const vm = await this.getVariantManager();
    await vm.removeVariant(variantId);

    return {
      content: [
        {
          type: 'text',
          text: `Removed variation ${variantId} and its worktree`,
        },
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: { variantId, removed: true },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handleCheckStatus(args: unknown = {}) {
    CheckStatusSchema.parse(args);
    const gitRoot = await this.getGitRoot();
    const git = simpleGit(gitRoot);
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']);
    const vm = await this.getVariantManager();
    const variants = await vm.listVariants();

    const statusData = {
      gitRoot,
      currentBranch: branch.trim(),
      activeVariations: variants.length,
    };

    let output = `Git Repository Status:\n`;
    output += `- Current branch: ${branch.trim()}\n`;
    output += `- Git root: ${gitRoot}\n`;
    output += `- Active variations: ${variants.length}\n`;

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: statusData }, null, 2),
        },
      ],
    };
  }

  private async handleStartPreview(args: unknown) {
    const input = StartPreviewSchema.parse(args);
    const { variantId } = input;

    const vm = await this.getVariantManager();
    const preview = await vm.startPreview(variantId);

    return {
      content: [
        {
          type: 'text',
          text: `Started preview server for variation ${variantId}:
- URL: ${preview.url}
- Port: ${preview.port}
- Framework: ${preview.framework}
- Status: ${preview.status}`,
        },
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: preview }, null, 2),
        },
      ],
    };
  }

  private async handleStopPreview(args: unknown) {
    const input = StopPreviewSchema.parse(args);
    const { variantId } = input;

    const vm = await this.getVariantManager();
    await vm.stopPreview(variantId);

    return {
      content: [
        {
          type: 'text',
          text: `Stopped preview server for variation ${variantId}`,
        },
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: { variantId, stopped: true },
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async handlePreviewStatus(args: unknown = {}) {
    PreviewStatusSchema.parse(args);
    const vm = await this.getVariantManager();
    const statuses = await vm.getStatus();
    const serversRunning = statuses.filter((s) => s.server);

    let output = `Preview Server Status:\n\n`;

    if (serversRunning.length === 0) {
      output += 'No preview servers running\n';
    } else {
      for (const variant of serversRunning) {
        if (variant.server) {
          output += `Variation ${variant.id}:\n`;
          output += `  URL: http://127.0.0.1:${variant.server.port}\n`;
          output += `  Framework: ${variant.server.framework}\n`;
          output += `  Status: ${variant.server.status}\n`;
          output += `  Started: ${new Date(variant.server.startedAt).toLocaleString()}\n\n`;
        }
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: serversRunning }, null, 2),
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Server started on stdio');
    console.error(`Working directory: ${this.workingDirectory}`);

    // Start HTTP server for review UI
    this.startReviewUI();
  }

  private startReviewUI() {
    this.httpServer = createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.httpServer.listen(this.httpPort, () => {
      console.error(`Review UI available at http://localhost:${this.httpPort}`);
    });
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://localhost:${this.httpPort}`);

    // Enable CORS for API requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(this.getReviewHTML());
      } else if (url.pathname === '/api/variants') {
        const variants = await this.getVariantsData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(variants));
      } else if (url.pathname === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        res.write('data: {"type":"connected"}\n\n');

        this.sseClients.add(res);

        req.on('close', () => {
          this.sseClients.delete(res);
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    } catch (error) {
      console.error('HTTP request error:', error);
      res.writeHead(500);
      res.end('Internal server error');
    }
  }

  private async getVariantsData() {
    if (!this.variantManager) {
      return [];
    }

    try {
      const variants = await this.variantManager.getStatus();
      return variants.map((v) => ({
        id: v.id,
        description: v.description,
        branch: v.branch,
        status: v.status,
        port: v.server?.port,
        url: v.server?.url,
        path: v.path,
      }));
    } catch (error) {
      console.error('Error getting variants:', error);
      return [];
    }
  }

  private getReviewHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Parallel UI - Review</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
            padding: 20px;
        }
        
        h1 {
            color: #333;
            margin-bottom: 30px;
            font-size: 28px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .variant-grid {
            display: grid;
            gap: 20px;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
        }
        
        .variant-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #ddd;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .variant-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        
        .variant-card.running {
            border-left-color: #10b981;
        }
        
        .variant-card.stopped {
            border-left-color: #6b7280;
        }
        
        .variant-card.failed {
            border-left-color: #ef4444;
        }
        
        .variant-header {
            display: flex;
            justify-content: space-between;
            align-items: start;
            margin-bottom: 15px;
        }
        
        .variant-id {
            font-size: 20px;
            font-weight: 600;
            color: #333;
        }
        
        .variant-status {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .variant-status.running {
            background: #10b98120;
            color: #059669;
        }
        
        .variant-status.stopped {
            background: #6b728020;
            color: #4b5563;
        }
        
        .variant-status.failed {
            background: #ef444420;
            color: #dc2626;
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
        }
        
        .variant-info {
            margin-bottom: 15px;
        }
        
        .info-row {
            display: flex;
            gap: 10px;
            margin-bottom: 8px;
            font-size: 14px;
            color: #666;
        }
        
        .info-label {
            font-weight: 500;
            min-width: 80px;
        }
        
        .info-value {
            color: #333;
            word-break: break-all;
        }
        
        .variant-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #e5e7eb;
        }
        
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .btn-primary {
            background: #3b82f6;
            color: white;
        }
        
        .btn-primary:hover:not(:disabled) {
            background: #2563eb;
        }
        
        .btn-secondary {
            background: #e5e7eb;
            color: #374151;
        }
        
        .btn-secondary:hover:not(:disabled) {
            background: #d1d5db;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        
        .error {
            background: #fee;
            color: #c00;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #666;
        }
        
        .empty-state h2 {
            color: #333;
            margin-bottom: 10px;
        }
        
        .activity-log {
            margin-top: 30px;
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .activity-log h2 {
            font-size: 18px;
            margin-bottom: 15px;
            color: #333;
        }
        
        .log-entries {
            max-height: 300px;
            overflow-y: auto;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
            font-size: 13px;
            background: #f9fafb;
            border-radius: 4px;
            padding: 10px;
        }
        
        .log-entry {
            padding: 4px 0;
            border-bottom: 1px solid #e5e7eb;
            display: flex;
            gap: 10px;
        }
        
        .log-entry:last-child {
            border-bottom: none;
        }
        
        .log-time {
            color: #6b7280;
            min-width: 80px;
        }
        
        .log-type {
            font-weight: 600;
            min-width: 120px;
        }
        
        .log-type.variant-created { color: #10b981; }
        .log-type.variant-removed { color: #ef4444; }
        .log-type.variant-updated { color: #3b82f6; }
        .log-type.preview-starting { color: #f59e0b; }
        .log-type.preview-ready { color: #10b981; }
        .log-type.preview-failed { color: #ef4444; }
        .log-type.preview-stopped { color: #6b7280; }
        
        .log-message {
            flex: 1;
            color: #374151;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Parallel UI Review</h1>
        <div id="content">
            <div class="loading">Loading variants...</div>
        </div>
        
        <div class="activity-log">
            <h2>Activity Log</h2>
            <div class="log-entries" id="log-entries">
                <div class="log-entry">
                    <span class="log-time">--:--:--</span>
                    <span class="log-type">Waiting</span>
                    <span class="log-message">Waiting for events...</span>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let variants = [];
        let eventSource = null;
        let eventLog = [];
        const MAX_LOG_ENTRIES = 50;
        
        async function loadVariants() {
            try {
                const response = await fetch('/api/variants');
                if (!response.ok) throw new Error('Failed to load variants');
                
                variants = await response.json();
                renderVariants();
            } catch (error) {
                document.getElementById('content').innerHTML = 
                    '<div class="error">Error loading variants: ' + error.message + '</div>';
            }
        }
        
        function addLogEntry(event) {
            const time = new Date().toLocaleTimeString('en-US', { hour12: false });
            let message = '';
            const eventType = event.type.replace(':', '-');
            
            switch(event.type) {
                case 'variant:created':
                    message = \`Created variant \${event.data.variant.id} - \${event.data.variant.description || 'No description'}\`;
                    break;
                case 'variant:removed':
                    message = \`Removed variant \${event.data.variantId}\`;
                    break;
                case 'variant:updated':
                    message = \`Updated variant \${event.data.variant.id} - status: \${event.data.variant.status}\`;
                    break;
                case 'preview:starting':
                    message = \`Starting preview for variant \${event.data.variantId}\`;
                    break;
                case 'preview:ready':
                    message = \`Preview ready for variant \${event.data.variantId} at port \${event.data.port}\`;
                    break;
                case 'preview:failed':
                    message = \`Preview failed for variant \${event.data.variantId}: \${event.data.error}\`;
                    break;
                case 'preview:stopped':
                    message = \`Preview stopped for variant \${event.data.variantId}\`;
                    break;
                case 'connected':
                    message = 'Connected to event stream';
                    break;
                default:
                    message = JSON.stringify(event.data);
            }
            
            eventLog.unshift({ time, type: event.type, message });
            if (eventLog.length > MAX_LOG_ENTRIES) {
                eventLog = eventLog.slice(0, MAX_LOG_ENTRIES);
            }
            
            renderLog();
        }
        
        function renderLog() {
            const logContainer = document.getElementById('log-entries');
            if (!logContainer) return;
            
            if (eventLog.length === 0) {
                logContainer.innerHTML = \`
                    <div class="log-entry">
                        <span class="log-time">--:--:--</span>
                        <span class="log-type">Waiting</span>
                        <span class="log-message">Waiting for events...</span>
                    </div>
                \`;
                return;
            }
            
            const html = eventLog.map(entry => \`
                <div class="log-entry">
                    <span class="log-time">\${entry.time}</span>
                    <span class="log-type \${entry.type.replace(':', '-')}">\${entry.type.replace(':', ' ')}</span>
                    <span class="log-message">\${entry.message}</span>
                </div>
            \`).join('');
            
            logContainer.innerHTML = html;
        }
        
        function connectSSE() {
            eventSource = new EventSource('/api/events');
            
            eventSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('SSE Event:', data);
                
                addLogEntry(data);
                
                if (data.type === 'connected') {
                    console.log('SSE Connected');
                    return;
                }
                
                loadVariants();
            };
            
            eventSource.onerror = (error) => {
                console.error('SSE Error:', error);
                if (eventSource.readyState === EventSource.CLOSED) {
                    addLogEntry({ type: 'disconnected', data: { message: 'Connection lost, reconnecting...' } });
                    setTimeout(connectSSE, 5000);
                }
            };
        }
        
        function renderVariants() {
            const content = document.getElementById('content');
            
            if (variants.length === 0) {
                content.innerHTML = \`
                    <div class="empty-state">
                        <h2>No variants yet</h2>
                        <p>Create variants using the MCP client to see them here.</p>
                    </div>
                \`;
                return;
            }
            
            const html = \`
                <div class="variant-grid">
                    \${variants.map(v => renderVariantCard(v)).join('')}
                </div>
            \`;
            
            content.innerHTML = html;
        }
        
        function renderVariantCard(variant) {
            const isRunning = variant.status === 'running';
            const statusClass = variant.status || 'stopped';
            
            return \`
                <div class="variant-card \${statusClass}">
                    <div class="variant-header">
                        <div class="variant-id">Variant \${variant.id}</div>
                        <div class="variant-status \${statusClass}">
                            <span class="status-dot"></span>
                            \${variant.status || 'stopped'}
                        </div>
                    </div>
                    
                    <div class="variant-info">
                        \${variant.description ? \`
                            <div class="info-row">
                                <span class="info-label">Description:</span>
                                <span class="info-value">\${variant.description}</span>
                            </div>
                        \` : ''}
                        
                        <div class="info-row">
                            <span class="info-label">Branch:</span>
                            <span class="info-value">\${variant.branch}</span>
                        </div>
                        
                        \${variant.port ? \`
                            <div class="info-row">
                                <span class="info-label">Port:</span>
                                <span class="info-value">\${variant.port}</span>
                            </div>
                        \` : ''}
                    </div>
                    
                    <div class="variant-actions">
                        \${isRunning && variant.url ? \`
                            <button class="btn-primary" onclick="window.open('\${variant.url}', '_blank')">
                                Open in New Tab
                            </button>
                        \` : ''}
                        
                        <button class="btn-secondary" onclick="copyPath('\${variant.path}')">
                            Copy Path
                        </button>
                    </div>
                </div>
            \`;
        }
        
        function copyPath(path) {
            navigator.clipboard.writeText(path).then(() => {
                console.log('Path copied to clipboard');
            });
        }
        
        loadVariants();
        connectSSE();
    </script>
</body>
</html>`;
  }
}
