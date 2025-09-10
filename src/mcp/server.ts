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
    }
    return this.variantManager;
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
  }
}
