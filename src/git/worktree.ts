import { simpleGit, type SimpleGit } from 'simple-git';
import { DirectoryManager } from './directory.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  variantId?: string;
}

export interface CreateWorktreeResult {
  variantId: string;
  path: string;
  branch: string;
  baseCommit: string;
}

export type MergeStrategy = 'merge' | 'squash' | 'ff';

export class WorktreeManager {
  private git: SimpleGit;
  private directoryManager: DirectoryManager;
  private projectPath: string;

  constructor(projectPath: string, directoryManager?: DirectoryManager) {
    this.projectPath = projectPath;
    this.git = simpleGit(projectPath);
    this.directoryManager = directoryManager || new DirectoryManager();
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  async getOriginUrl(): Promise<{ fetch?: string; push?: string } | undefined> {
    try {
      const remotes = await this.git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin');
      if (!origin) return undefined;

      return {
        fetch: origin.refs.fetch,
        push: origin.refs.push || origin.refs.fetch,
      };
    } catch {
      return undefined;
    }
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'main';
  }

  async checkWorkingDirectory(): Promise<{ isClean: boolean; message?: string }> {
    const status = await this.git.status();
    if (status.isClean()) {
      return { isClean: true };
    }

    const changes = [
      status.modified.length && `${status.modified.length} modified`,
      status.not_added.length && `${status.not_added.length} untracked`,
      status.deleted.length && `${status.deleted.length} deleted`,
      status.created.length && `${status.created.length} new`,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      isClean: false,
      message: `Working directory has changes: ${changes}. Consider committing or stashing.`,
    };
  }

  private sanitizeSlug(description?: string): string {
    if (!description) return '';

    return description
      .toLowerCase()
      .replace(/[^a-z0-9\-_\s]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50); // Limit length
  }

  async createWorktree(baseRef: string, description?: string): Promise<CreateWorktreeResult> {
    // Verify baseRef exists
    try {
      await this.git.raw(['rev-parse', '--verify', baseRef]);
    } catch {
      // Try fetching if it might be a remote ref
      await this.git.fetch();
      try {
        await this.git.raw(['rev-parse', '--verify', baseRef]);
      } catch {
        throw new Error(`Base reference '${baseRef}' not found`);
      }
    }

    // Allocate variant ID atomically
    const variantId = await this.directoryManager.allocateVariantId(this.projectPath);

    const slug = this.sanitizeSlug(description);
    const branchName = `ui-var/${variantId}${slug ? `-${slug}` : ''}`;
    const worktreePath = this.directoryManager.getVariantDir(this.projectPath, variantId);

    try {
      // Check if branch already exists
      const branches = await this.git.branchLocal();
      const branchExists = branches.all.includes(branchName);

      if (branchExists) {
        await this.git.raw(['worktree', 'add', worktreePath, branchName]);
      } else {
        await this.git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseRef]);
      }

      // Get the commit hash
      const worktreeGit = simpleGit(worktreePath);
      const log = await worktreeGit.log({ maxCount: 1 });
      const baseCommit = log.latest?.hash || '';

      // Copy root-level env files: .env and .env.*
      try {
        const fs = await import('fs');
        const fsp = await import('fs/promises');
        const path = await import('path');

        const entries = await fsp.readdir(this.projectPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const name = entry.name;
          if (!(name === '.env' || name.startsWith('.env.'))) continue;
          const srcFile = path.join(this.projectPath, name);
          const dstFile = path.join(worktreePath, name);
          if (fs.existsSync(srcFile) && !fs.existsSync(dstFile)) {
            await fsp.copyFile(srcFile, dstFile);
          }
        }
      } catch (e) {
        // Non-fatal if copying env files fails
        console.error('Warning: failed to copy root .env files to worktree:', (e as Error).message);
      }

      // Install dependencies in the background for the variant
      // This runs npm install without blocking variant creation
      const { spawn } = await import('child_process');
      const { existsSync } = await import('fs');
      const { join } = await import('path');

      const variantNodeModules = join(worktreePath, 'node_modules');
      const variantPackageJson = join(worktreePath, 'package.json');

      // Only install if package.json exists and node_modules doesn't
      if (existsSync(variantPackageJson) && !existsSync(variantNodeModules)) {
        console.error(`Installing dependencies in background for variant ${variantId}...`);

        // Run npm install in the background
        const installProcess = spawn('npm', ['install'], {
          cwd: worktreePath,
          detached: true,
          stdio: 'ignore',
          env: process.env,
        });

        // Unreference the process so it can continue after parent exits
        installProcess.unref();

        console.error(`Background npm install started (PID: ${installProcess.pid})`);
      }

      // Update the placeholder variant with full details
      const originUrl = await this.getOriginUrl();
      await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
        ...v,
        branch: branchName,
        ...(description && { description }),
        status: 'created',
        lastUpdatedAt: new Date().toISOString(),
        ...(originUrl?.fetch && !v.originUrl && { originUrl: originUrl.fetch }),
      }));

      return {
        variantId,
        path: worktreePath,
        branch: branchName,
        baseCommit,
      };
    } catch (error) {
      // Clean up on failure
      await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
        ...v,
        status: 'failed',
        error: (error as Error).message,
        lastUpdatedAt: new Date().toISOString(),
      }));

      // Try to clean up worktree if it was partially created
      try {
        await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
      } catch {
        // Ignore cleanup errors
      }

      throw error;
    }
  }

  async removeWorktree(variantId: string): Promise<void> {
    const worktreePath = this.directoryManager.getVariantDir(this.projectPath, variantId);
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    const variant = metadata?.variants.find((v) => v.id === variantId);

    // Remove worktree (always attempt removal, git handles non-existent paths gracefully)
    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch (error) {
      // Only log if it's a real error, not just "not a working tree"
      if (!(error as Error).message.includes('not a working tree')) {
        console.error(`Failed to remove worktree: ${(error as Error).message}`);
      }
    }

    // Delete branch if it exists
    if (variant?.branch) {
      try {
        const branches = await this.git.branchLocal();
        if (branches.all.includes(variant.branch)) {
          await this.git.branch(['-D', variant.branch]);
        }
      } catch (error) {
        console.error(`Failed to delete branch ${variant.branch}: ${(error as Error).message}`);
      }
    }

    // Prune worktree references
    await this.git.raw(['worktree', 'prune', '--verbose']);

    // Remove from metadata
    await this.directoryManager.removeVariant(this.projectPath, variantId);
  }

  async listAllWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const output = await this.git.raw(['worktree', 'list', '--porcelain']);
      const worktrees: WorktreeInfo[] = [];
      const lines = output.split('\n');

      let currentWorktree: Partial<WorktreeInfo> = {};

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          if (currentWorktree.path) {
            worktrees.push(currentWorktree as WorktreeInfo);
          }
          currentWorktree = { path: line.substring(9) };
        } else if (line.startsWith('branch ')) {
          // Strip refs/heads/ prefix if present
          const branch = line.substring(7);
          currentWorktree.branch = branch.replace(/^refs\/heads\//, '');
        } else if (line.startsWith('HEAD ')) {
          currentWorktree.commit = line.substring(5);
        }
      }

      if (currentWorktree.path && currentWorktree.branch && currentWorktree.commit) {
        worktrees.push(currentWorktree as WorktreeInfo);
      }

      return worktrees;
    } catch {
      return [];
    }
  }

  async listManagedWorktrees(): Promise<WorktreeInfo[]> {
    const allWorktrees = await this.listAllWorktrees();
    const managedRoot = this.directoryManager.getProjectDir(this.projectPath);

    // Filter to only worktrees we manage and exclude the main worktree
    const managed = allWorktrees.filter(
      (w) => w.path.startsWith(managedRoot) && w.path !== this.projectPath
    );

    // Try to match with variant IDs
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    if (metadata) {
      for (const worktree of managed) {
        const variant = metadata.variants.find((v) => v.branch === worktree.branch);
        if (variant) {
          worktree.variantId = variant.id;
        }
      }
    }

    return managed;
  }

  async mergeVariant(
    variantId: string,
    targetBranch: string = 'main',
    strategy: MergeStrategy = 'merge'
  ): Promise<void> {
    const metadata = await this.directoryManager.readMetadata(this.projectPath);
    const variant = metadata?.variants.find((v) => v.id === variantId);

    if (!variant) {
      throw new Error(`Variant ${variantId} not found`);
    }

    // Fetch latest changes
    await this.git.fetch();

    // Check out target branch
    await this.git.checkout(targetBranch);

    try {
      // Perform merge based on strategy
      if (strategy === 'squash') {
        await this.git.merge(['--squash', variant.branch]);
        await this.git.commit(
          `Squash merge variant ${variantId}: ${variant.description || variant.branch}`
        );
      } else if (strategy === 'ff') {
        await this.git.merge(['--ff-only', variant.branch]);
      } else {
        await this.git.merge([
          variant.branch,
          '-m',
          `Merge variant ${variantId}: ${variant.description || variant.branch}`,
        ]);
      }

      // Only remove worktree after successful merge
      await this.removeWorktree(variantId);
    } catch (error) {
      // Don't remove worktree on merge failure
      throw new Error(
        `Merge failed - resolve conflicts manually. Variant ${variantId} preserved.\n${(error as Error).message}`
      );
    }
  }

  async pruneWorktrees(): Promise<void> {
    await this.git.raw(['worktree', 'prune', '--verbose']);
  }
}
