import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join, basename, dirname } from 'path';
import { createHash, randomBytes } from 'crypto';
import lockfile from 'proper-lockfile';

export interface ServerInfo {
  variantId: string;
  port: number;
  pid: number;
  framework: string;
  startedAt: string;
  healthy: boolean;
  worktreePath: string;
}

export interface Registry {
  servers: Record<string, ServerInfo>;
  lastUpdated: string;
}

export class ServerRegistry {
  private locks = new Map<string, Promise<void>>();

  constructor(private baseDir: string) {}

  private hashPath(projectPath: string): string {
    return createHash('sha256').update(projectPath).digest('hex').slice(0, 12);
  }

  private getProjectDir(projectPath: string): string {
    const projectName = basename(projectPath);
    const hash = this.hashPath(projectPath);
    return join(this.baseDir, 'variants', `${projectName}-${hash}`);
  }

  private registryPath(projectPath: string): string {
    return join(this.getProjectDir(projectPath), 'registry.json');
  }

  private async withLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    const regPath = this.registryPath(projectPath);
    const dir = dirname(regPath);

    // Wait for any existing in-process lock
    const existingLock = this.locks.get(dir);
    if (existingLock) {
      await existingLock;
    }

    // Create new in-process lock
    let releaseInProc: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseInProc = resolve;
    });
    this.locks.set(dir, lockPromise);

    // Ensure directory exists for lockfile
    await mkdir(dir, { recursive: true });

    // Acquire cross-process lock
    const releaseFs = await lockfile.lock(dir, {
      lockfilePath: join(dir, 'registry.lock'),
      stale: 30000,
      retries: {
        retries: 12,
        factor: 1.2,
        minTimeout: 40,
        maxTimeout: 400,
      },
    });

    try {
      return await fn();
    } finally {
      await releaseFs();
      this.locks.delete(dir);
      releaseInProc!();
    }
  }

  async read(projectPath: string): Promise<Registry> {
    try {
      const path = this.registryPath(projectPath);
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {
        servers: {},
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  private async write(projectPath: string, registry: Registry): Promise<void> {
    const path = this.registryPath(projectPath);
    const dir = dirname(path);

    await mkdir(dir, { recursive: true });

    registry.lastUpdated = new Date().toISOString();

    const tempPath = `${path}.tmp.${randomBytes(8).toString('hex')}`;

    try {
      await writeFile(tempPath, JSON.stringify(registry, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      await rename(tempPath, path);
    } catch (error) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore
      }
      throw error;
    }
  }

  async addServer(projectPath: string, info: ServerInfo): Promise<void> {
    await this.withLock(projectPath, async () => {
      const registry = await this.read(projectPath);
      registry.servers[info.variantId] = info;
      await this.write(projectPath, registry);
    });
  }

  async removeServer(projectPath: string, variantId: string): Promise<void> {
    await this.withLock(projectPath, async () => {
      const registry = await this.read(projectPath);
      delete registry.servers[variantId];
      await this.write(projectPath, registry);
    });
  }

  async getRunningServers(projectPath: string): Promise<ServerInfo[]> {
    const registry = await this.read(projectPath);
    return Object.values(registry.servers);
  }
}
