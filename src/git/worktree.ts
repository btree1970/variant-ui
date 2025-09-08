import { simpleGit, type SimpleGit } from 'simple-git';
import { DirectoryManager } from './directory.js';
import { join } from 'path';
import { writeFile, rm } from 'fs/promises';
import { spawn } from 'node:child_process';

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

  async applyPatchToWorktree(variantId: string, patchContent: string): Promise<void> {
    const worktreePath = this.directoryManager.getVariantDir(this.projectPath, variantId);
    const patchPath = join(worktreePath, '.parallel-ui-temp.patch');

    try {
      // Write patch to temp file
      await writeFile(patchPath, patchContent, 'utf8');

      // Try 3-way merge first for better conflict resolution
      let applied = false;
      let applyError = '';

      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('git', ['apply', '--3way', '--whitespace=nowarn', patchPath], {
            cwd: worktreePath,
          });

          let stderr = '';
          proc.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          proc.on('exit', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`3-way merge failed: ${stderr}`));
            }
          });
        });
        applied = true;
      } catch (error) {
        applyError = (error as Error).message;
        // Fall back to regular apply without 3-way
        await new Promise<void>((resolve, reject) => {
          const proc = spawn('git', ['apply', '--whitespace=nowarn', patchPath], {
            cwd: worktreePath,
          });

          let stderr = '';
          proc.stderr.on('data', (data) => {
            stderr += data.toString();
          });

          proc.on('exit', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  `git apply failed (exit ${code}): ${stderr}. 3-way attempt: ${applyError}`
                )
              );
            }
          });
        });
      }

      // Stage and commit changes
      const worktreeGit = simpleGit(worktreePath);
      await worktreeGit.add('.');

      const status = await worktreeGit.status();
      if (!status.isClean()) {
        const commitMessage = applied
          ? `Apply patch to variant ${variantId} (3-way merge)`
          : `Apply patch to variant ${variantId}`;
        await worktreeGit.commit(commitMessage);
      }

      // Update metadata
      await this.directoryManager.updateVariant(this.projectPath, variantId, (v) => ({
        ...v,
        lastUpdatedAt: new Date().toISOString(),
      }));
    } finally {
      // Clean up temp patch file
      await rm(patchPath, { force: true });
    }
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
