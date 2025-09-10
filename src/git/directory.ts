import { tmpdir } from 'os';
import { join, basename } from 'path';
import { createHash, randomBytes } from 'crypto';
import { mkdir, readFile, writeFile, access, readdir, rm, rename } from 'fs/promises';
import { constants } from 'fs';
import type { ProjectMetadata, Variant } from '../types.js';

const BASE_DIR_NAME = 'variant-ui';
const VARIANTS_SUBDIR = 'variants';

export class DirectoryManager {
  private baseDir: string;
  private lockTimeoutMs = 5000;
  private lockRetryMs = 50;
  private activeLocks = new Map<string, Promise<void>>();

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir || join(tmpdir(), BASE_DIR_NAME);
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private hashPath(projectPath: string): string {
    return createHash('sha256').update(projectPath).digest('hex').slice(0, 12);
  }

  getProjectDirName(projectPath: string): string {
    const projectName = basename(projectPath);
    const hash = this.hashPath(projectPath);
    return `${projectName}-${hash}`;
  }

  getProjectDir(projectPath: string): string {
    const dirName = this.getProjectDirName(projectPath);
    return join(this.baseDir, VARIANTS_SUBDIR, dirName);
  }

  getVariantDir(projectPath: string, variantId: string): string {
    return join(this.getProjectDir(projectPath), variantId);
  }

  async ensureDirectories(projectPath: string): Promise<void> {
    const projectDir = this.getProjectDir(projectPath);
    await mkdir(projectDir, { recursive: true });
  }

  private getMetadataPath(projectPath: string): string {
    return join(this.getProjectDir(projectPath), 'metadata.json');
  }

  async readMetadata(projectPath: string): Promise<ProjectMetadata | null> {
    try {
      const metadataPath = this.getMetadataPath(projectPath);
      const data = await readFile(metadataPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp.${randomBytes(8).toString('hex')}`;
    try {
      await writeFile(tempPath, content, 'utf-8');
      await rename(tempPath, filePath);
    } catch (error) {
      try {
        await rm(tempPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  private async withLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = this.getProjectDir(projectPath);

    const existingLock = this.activeLocks.get(lockKey);
    if (existingLock) {
      await existingLock;
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.activeLocks.set(lockKey, lockPromise);

    try {
      return await fn();
    } finally {
      this.activeLocks.delete(lockKey);
      releaseLock!();
    }
  }

  async writeMetadata(projectPath: string, metadata: ProjectMetadata): Promise<void> {
    await this.ensureDirectories(projectPath);
    const metadataPath = this.getMetadataPath(projectPath);
    await this.atomicWrite(metadataPath, JSON.stringify(metadata, null, 2));
  }

  async initializeMetadata(projectPath: string, originUrl?: string): Promise<ProjectMetadata> {
    const existing = await this.readMetadata(projectPath);
    if (existing) {
      return existing;
    }

    const metadata: ProjectMetadata = {
      schemaVersion: 1,
      projectPath,
      projectName: basename(projectPath),
      ...(originUrl && { originUrl }),
      variants: [],
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    };

    await this.writeMetadata(projectPath, metadata);
    return metadata;
  }

  async addVariant(projectPath: string, variant: Variant, originUrl?: string): Promise<void> {
    await this.withLock(projectPath, async () => {
      let metadata = await this.readMetadata(projectPath);
      if (!metadata) {
        metadata = await this.initializeMetadata(projectPath, originUrl);
      }

      metadata.variants.push(variant);
      metadata.lastAccessedAt = new Date().toISOString();
      await this.writeMetadata(projectPath, metadata);
    });
  }

  async updateVariant(
    projectPath: string,
    variantId: string,
    updater: (variant: Variant) => Variant
  ): Promise<void> {
    await this.withLock(projectPath, async () => {
      const metadata = await this.readMetadata(projectPath);
      if (!metadata) {
        throw new Error('Project metadata not found');
      }

      const variantIndex = metadata.variants.findIndex((v) => v.id === variantId);
      if (variantIndex === -1) {
        throw new Error(`Variant ${variantId} not found`);
      }

      const variant = metadata.variants[variantIndex];
      if (!variant) {
        throw new Error(`Variant ${variantId} not found`);
      }

      metadata.variants[variantIndex] = updater(variant);
      metadata.lastAccessedAt = new Date().toISOString();
      await this.writeMetadata(projectPath, metadata);
    });
  }

  async removeVariant(projectPath: string, variantId: string): Promise<void> {
    await this.withLock(projectPath, async () => {
      const metadata = await this.readMetadata(projectPath);
      if (!metadata) {
        return;
      }

      metadata.variants = metadata.variants.filter((v) => v.id !== variantId);
      metadata.lastAccessedAt = new Date().toISOString();
      await this.writeMetadata(projectPath, metadata);

      const variantDir = this.getVariantDir(projectPath, variantId);
      try {
        await rm(variantDir, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to remove variant directory: ${variantDir}`, error);
      }
    });
  }

  async allocateVariantId(projectPath: string): Promise<string> {
    return this.withLock(projectPath, async () => {
      let metadata = await this.readMetadata(projectPath);
      if (!metadata) {
        metadata = await this.initializeMetadata(projectPath);
      }

      const existingIds = metadata.variants
        .map((v) => v.id)
        .filter((id) => /^\d{3}$/.test(id))
        .map((id) => parseInt(id, 10));

      const maxId = Math.max(0, ...existingIds);
      const newId = String(maxId + 1).padStart(3, '0');

      // Reserve the ID by adding a placeholder variant
      const placeholder: Variant = {
        id: newId,
        branch: '',
        createdAt: new Date().toISOString(),
        status: 'allocating',
      };

      metadata.variants.push(placeholder);
      metadata.lastAccessedAt = new Date().toISOString();
      await this.writeMetadata(projectPath, metadata);

      return newId;
    });
  }

  async getNextVariantId(projectPath: string): Promise<string> {
    const metadata = await this.readMetadata(projectPath);
    if (!metadata || metadata.variants.length === 0) {
      return '001';
    }

    const existingIds = metadata.variants
      .map((v) => v.id)
      .filter((id) => /^\d{3}$/.test(id))
      .map((id) => parseInt(id, 10));

    const maxId = Math.max(0, ...existingIds);
    return String(maxId + 1).padStart(3, '0');
  }

  async listProjects(): Promise<string[]> {
    const variantsDir = join(this.baseDir, VARIANTS_SUBDIR);
    try {
      const dirs = await readdir(variantsDir);
      return dirs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
