import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WorktreeManager } from '../git/worktree.js';
import { DirectoryManager } from '../git/directory.js';
import { simpleGit } from 'simple-git';
import { realpath } from 'fs/promises';
import {
  CreateVariationSchema,
  ListVariationsSchema,
  RemoveVariationSchema,
  ApplyPatchSchema,
  CheckStatusSchema,
} from './validation.js';

export class MCPServer {
  private server: Server;
  private workingDirectory: string;
  private gitRoot?: string;
  private worktreeManager?: WorktreeManager;
  private directoryManager: DirectoryManager;

  constructor(workingDirectory?: string) {
    this.workingDirectory = workingDirectory || process.cwd();
    this.directoryManager = new DirectoryManager();

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

  private async getWorktreeManager(): Promise<WorktreeManager> {
    if (!this.worktreeManager) {
      const gitRoot = await this.getGitRoot();
      this.worktreeManager = new WorktreeManager(gitRoot, this.directoryManager);
    }
    return this.worktreeManager;
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
            name: 'apply_patch',
            description: 'Apply a git patch to a variation',
            inputSchema: {
              type: 'object',
              properties: {
                variantId: {
                  type: 'string',
                  description: 'ID of the variation to patch',
                },
                patch: {
                  type: 'string',
                  description: 'Git patch content to apply',
                },
              },
              required: ['variantId', 'patch'],
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

          case 'apply_patch':
            return await this.handleApplyPatch(args);

          case 'check_status':
            return await this.handleCheckStatus(args);

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
      const gitRoot = await this.getGitRoot();
      const metadata = await this.directoryManager.readMetadata(gitRoot);

      const resources = [
        {
          uri: 'variant://list',
          name: 'Active Variations',
          description: 'List of all active UI variations',
          mimeType: 'application/json',
        },
      ];

      if (metadata?.variants) {
        for (const variant of metadata.variants) {
          resources.push({
            uri: `variant://${variant.id}`,
            name: `Variation ${variant.id}`,
            description: variant.description || variant.branch,
            mimeType: 'application/json',
          });
        }
      }

      return { resources };
    });

    // Handle resource reading
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'variant://list') {
        const gitRoot = await this.getGitRoot();
        const metadata = await this.directoryManager.readMetadata(gitRoot);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(metadata?.variants || [], null, 2),
            },
          ],
        };
      }

      if (uri.startsWith('variant://')) {
        const variantId = uri.replace('variant://', '');
        const gitRoot = await this.getGitRoot();
        const metadata = await this.directoryManager.readMetadata(gitRoot);
        const variant = metadata?.variants.find((v) => v.id === variantId);

        if (!variant) {
          throw new Error(`Variant ${variantId} not found`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(variant, null, 2),
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

    const wm = await this.getWorktreeManager();

    // Check working directory status
    const status = await wm.checkWorkingDirectory();
    let warningMessage = '';
    if (!status.isClean) {
      warningMessage = `Warning: ${status.message}\n\n`;
    }

    // Create the worktree
    const result = await wm.createWorktree(baseRef, description);

    return {
      content: [
        {
          type: 'text',
          text: `${warningMessage}Created variation ${result.variantId}:
- Branch: ${result.branch}
- Path: ${result.path}
- Base commit: ${result.baseCommit}
- Description: ${description}

You can now apply changes to this variation using the apply_patch tool.`,
        },
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              warning: !status.isClean ? status.message : undefined,
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
    const gitRoot = await this.getGitRoot();
    const metadata = await this.directoryManager.readMetadata(gitRoot);
    const wm = await this.getWorktreeManager();
    const managedWorktrees = await wm.listManagedWorktrees();

    if (!metadata?.variants || metadata.variants.length === 0) {
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

    const variantsWithStatus = metadata.variants.map((variant) => {
      const worktree = managedWorktrees.find((w) => w.variantId === variant.id);
      return {
        ...variant,
        hasWorktree: !!worktree,
        worktreePath: worktree?.path,
      };
    });

    let output = `Active variations (${metadata.variants.length}):\n\n`;

    for (const variant of variantsWithStatus) {
      const status = variant.hasWorktree ? '🟢 Active' : '⚠️  No worktree';

      output += `${variant.id}: ${variant.description || 'No description'}\n`;
      output += `  Status: ${status}\n`;
      output += `  Branch: ${variant.branch}\n`;
      output += `  Created: ${new Date(variant.createdAt).toLocaleString()}\n`;
      if (variant.port) {
        output += `  Dev server port: ${variant.port}\n`;
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
          text: JSON.stringify({ success: true, data: variantsWithStatus }, null, 2),
        },
      ],
    };
  }

  private async handleRemoveVariation(args: unknown) {
    const input = RemoveVariationSchema.parse(args);
    const { variantId } = input;

    const wm = await this.getWorktreeManager();
    await wm.removeWorktree(variantId);

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

  private async handleApplyPatch(args: unknown) {
    const input = ApplyPatchSchema.parse(args);
    const { variantId, patch } = input;

    const wm = await this.getWorktreeManager();
    await wm.applyPatchToWorktree(variantId, patch);

    return {
      content: [
        {
          type: 'text',
          text: `Applied patch to variation ${variantId}`,
        },
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              data: { variantId, patchApplied: true },
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
    const wm = await this.getWorktreeManager();
    const status = await wm.checkWorkingDirectory();
    const branch = await wm.getCurrentBranch();
    const origin = await wm.getOriginUrl();
    const gitRoot = await this.getGitRoot();
    const metadata = await this.directoryManager.readMetadata(gitRoot);

    const statusData = {
      gitRoot,
      currentBranch: branch,
      workingDirectory: {
        isClean: status.isClean,
        ...(status.message && { message: status.message }),
      },
      ...(origin && { origin: origin.fetch }),
      activeVariations: metadata?.variants?.length || 0,
    };

    let output = `Git Repository Status:\n`;
    output += `- Current branch: ${branch}\n`;
    output += `- Working directory: ${status.isClean ? '✅ Clean' : '⚠️  Has changes'}\n`;
    if (!status.isClean && status.message) {
      output += `  ${status.message}\n`;
    }
    if (origin) {
      output += `- Origin: ${origin.fetch}\n`;
    }

    if (metadata?.variants && metadata.variants.length > 0) {
      output += `- Active variations: ${metadata.variants.length}\n`;
    }

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

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Server started on stdio');
    console.error(`Working directory: ${this.workingDirectory}`);
  }
}
