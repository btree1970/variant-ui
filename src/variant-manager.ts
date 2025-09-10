import { WorktreeManager, type CreateWorktreeResult } from './git/worktree.js';
import { DirectoryManager } from './git/directory.js';
import { DevServerManager, type DevServerInfo } from './orchestrator/dev-server.js';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import type { Variant } from './types.js';

export interface PreviewInfo {
  variantId: string;
  port: number;
  url: string;
  framework: string;
  status: 'starting' | 'ready' | 'failed' | 'stopped';
}

export interface VariantStatus extends Variant {
  path: string;
  server?: DevServerInfo;
}

export type VariantEvent =
  | { type: 'variant:created'; variant: Variant; path: string }
  | { type: 'variant:removed'; variantId: string }
  | { type: 'variant:updated'; variant: Variant }
  | { type: 'preview:starting'; variantId: string }
  | { type: 'preview:ready'; variantId: string; port: number; url: string }
  | { type: 'preview:failed'; variantId: string; error: string }
  | { type: 'preview:stopped'; variantId: string };

export class VariantManager extends EventEmitter {
  private worktreeManager: WorktreeManager;
  private directoryManager: DirectoryManager;
  private devServerManager: DevServerManager;
  private projectPath: string;
  private projectKey: string;

  constructor(projectPath: string) {
    super();
    this.projectPath = projectPath;
    this.directoryManager = new DirectoryManager();
    this.worktreeManager = new WorktreeManager(projectPath, this.directoryManager);
    this.devServerManager = new DevServerManager();
    this.projectKey = this.hashPath(projectPath);
  }

  private hashPath(path: string): string {
    return createHash('sha256').update(path).digest('hex').slice(0, 12);
  }

  async createVariant(baseRef: string, description?: string): Promise<CreateWorktreeResult> {
    const result = await this.worktreeManager.createWorktree(baseRef, description);

    const variant = await this.getVariantStatus(result.variantId);
    if (variant) {
      this.emit('variant:created', {
        type: 'variant:created',
        variant,
        path: result.path,
      });
    }

    return result;
  }

  async removeVariant(variantId: string): Promise<void> {
    await this.devServerManager.stopServer(this.projectKey, variantId);
    await this.worktreeManager.removeWorktree(variantId);

    this.emit('variant:removed', {
      type: 'variant:removed',
      variantId,
    });
  }

  async startPreview(variantId: string): Promise<PreviewInfo> {
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    const variant = metadata?.variants.find((v) => v.id === variantId);

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    const variantPath = this.directoryManager.getVariantDir(this.projectPath, variantId);

    this.emit('preview:starting', {
      type: 'preview:starting',
      variantId,
    });

    const serverInfo = await this.devServerManager.startServer({
      projectPath: variantPath,
      variantId: variant.id,
      projectKey: this.projectKey,
      onReady: async (info) => {
        await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
          ...v,
          status: 'running',
          port: info.port,
          lastUpdatedAt: new Date().toISOString(),
        }));

        this.emit('preview:ready', {
          type: 'preview:ready',
          variantId,
          port: info.port,
          url: info.url || `http://127.0.0.1:${info.port}`,
        });

        const updated = await this.getVariantStatus(variantId);
        if (updated) {
          this.emit('variant:updated', {
            type: 'variant:updated',
            variant: updated,
          });
        }
      },
      onError: async (error) => {
        await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
          ...v,
          status: 'failed',
          error: error.message,
          lastUpdatedAt: new Date().toISOString(),
        }));

        this.emit('preview:failed', {
          type: 'preview:failed',
          variantId,
          error: error.message,
        });
      },
      onStop: async () => {
        await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
          ...v,
          status: 'stopped',
          lastUpdatedAt: new Date().toISOString(),
        }));

        this.emit('preview:stopped', {
          type: 'preview:stopped',
          variantId,
        });
      },
    });

    return {
      variantId: serverInfo.variantId,
      port: serverInfo.port,
      url: serverInfo.url || `http://127.0.0.1:${serverInfo.port}`,
      framework: serverInfo.framework,
      status: serverInfo.status,
    };
  }

  async stopPreview(variantId: string): Promise<void> {
    await this.devServerManager.stopServer(this.projectKey, variantId);

    await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
      ...v,
      status: 'stopped',
      lastUpdatedAt: new Date().toISOString(),
    }));

    this.emit('preview:stopped', {
      type: 'preview:stopped',
      variantId,
    });
  }

  async getStatus(): Promise<VariantStatus[]> {
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    if (!metadata) return [];

    const servers = this.devServerManager.listServers();

    return metadata.variants.map((variant) => {
      const server = servers.find((s) => s.variantId === variant.id);
      const path = this.directoryManager.getVariantDir(this.projectPath, variant.id);
      return {
        ...variant,
        path,
        ...(server && { server }),
      };
    });
  }

  async getVariantStatus(variantId: string): Promise<VariantStatus | null> {
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    if (!metadata) return null;

    const variant = metadata.variants.find((v) => v.id === variantId);
    if (!variant) return null;

    const server = this.devServerManager.getServer(this.projectKey, variantId);
    const path = this.directoryManager.getVariantDir(this.projectPath, variantId);

    return {
      ...variant,
      path,
      ...(server && { server }),
    };
  }

  async listVariants(): Promise<Variant[]> {
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    return metadata?.variants || [];
  }

  async stopAllServers(): Promise<void> {
    await this.devServerManager.stopAll();

    // Update all variant statuses
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    if (metadata) {
      for (const variant of metadata.variants) {
        if (variant.status === 'running') {
          await this.directoryManager.updateVariant(this.projectPath, variant.id, (v) => ({
            ...v,
            status: 'stopped',
            lastUpdatedAt: new Date().toISOString(),
          }));
        }
      }
    }
  }
}
