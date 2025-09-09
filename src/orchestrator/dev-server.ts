import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { FrameworkRegistry } from './adapters/index.js';
import { allocatePort } from './ports.js';
import type { FrameworkAdapter } from './adapters/base.js';
import { existsSync } from 'fs';
import { join } from 'path';

export interface DevServerInfo {
  variantId: string;
  projectPath: string;
  port: number;
  framework: string;
  status: 'starting' | 'ready' | 'failed' | 'stopped';
  startedAt: Date;
  url?: string;
  error?: string;
}

export interface DevServerOptions {
  projectPath: string; // Path to the worktree directory
  variantId: string;
  projectKey: string; // Hash of the canonical git root for port allocation
  onReady?: (info: DevServerInfo) => void;
  onError?: (error: Error) => void;
  onStop?: () => void;
}

const START_TIMEOUT_MS = 60000;

class DevServer extends EventEmitter {
  private process?: ChildProcess;
  private port: number = 0;
  private adapter?: FrameworkAdapter;
  private status: DevServerInfo['status'] = 'starting';
  private startedAt: Date;
  private healthCheckInterval?: NodeJS.Timeout;
  private readyTimeout?: NodeJS.Timeout;

  constructor(private options: DevServerOptions) {
    super();
    this.startedAt = new Date();
  }

  async start(): Promise<DevServerInfo> {
    try {
      // Wait for npm install to complete if it's still running
      await this.waitForDependencies();

      const registry = new FrameworkRegistry();
      const adapter = await registry.detectFramework(this.options.projectPath);

      if (!adapter) {
        throw new Error(`No supported framework detected at ${this.options.projectPath}`);
      }

      this.adapter = adapter;

      // Simply allocate an available port
      this.port = await allocatePort(this.options.projectKey, this.options.variantId);

      const startCommand = adapter.getStartCommand();
      const portArgs = adapter.getPortArgs(this.port);
      const envVars = adapter.getEnvVars(this.port);

      this.process = spawn(startCommand, portArgs, {
        cwd: this.options.projectPath,
        env: {
          ...process.env,
          ...envVars,
          HOSTNAME: '127.0.0.1', // Force IPv4
          PORT: String(this.port),
          BROWSER: 'none',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      // End stdin to prevent blocking on interactive prompts
      if (this.process.stdin) {
        this.process.stdin.end();
      }

      this.setupProcessHandlers();
      this.startHealthCheck();

      return new Promise((resolve, reject) => {
        this.readyTimeout = setTimeout(() => {
          this.status = 'failed';
          this.cleanup();
          reject(new Error(`Server failed to start within ${START_TIMEOUT_MS}ms`));
        }, START_TIMEOUT_MS);

        this.once('ready', () => {
          clearTimeout(this.readyTimeout);
          resolve(this.getInfo());
        });

        this.once('error', (error) => {
          clearTimeout(this.readyTimeout);
          this.status = 'failed';
          reject(error);
        });
      });
    } catch (error) {
      this.status = 'failed';
      await this.cleanup();
      throw error;
    }
  }

  private setupProcessHandlers(): void {
    if (!this.process) return;

    const readyPattern = this.adapter?.getReadyPattern();

    this.process.stdout?.on('data', (data) => {
      const output = data.toString();

      if (readyPattern && readyPattern.test(output) && this.status === 'starting') {
        this.handleReady();
      }
    });

    this.process.on('error', (error) => {
      clearTimeout(this.readyTimeout);
      clearInterval(this.healthCheckInterval);
      this.emit('error', error);
      this.options.onError?.(error);
    });

    this.process.on('exit', (code, signal) => {
      clearTimeout(this.readyTimeout);
      clearInterval(this.healthCheckInterval);

      // Clean up all listeners and streams
      this.process?.stdout?.removeAllListeners('data');
      this.process?.stderr?.removeAllListeners('data');
      this.process?.stdout?.destroy();
      this.process?.stderr?.destroy();

      if (this.status !== 'stopped') {
        this.status = 'failed';
        this.emit('error', new Error(`Process exited unexpectedly: ${code || signal}`));
        // Only call cleanup if we're not already stopped (to avoid double cleanup)
        this.cleanup();
      }
    });
  }

  private async waitForDependencies(maxWaitSeconds: number = 60): Promise<void> {
    // Check if npm install is complete by looking for the lock marker
    const lockMarker = join(this.options.projectPath, 'node_modules', '.package-lock.json');

    // If node_modules already exists with the lock marker, dependencies are ready
    if (existsSync(lockMarker)) {
      return;
    }

    console.log(`Waiting for npm install to complete in ${this.options.projectPath}...`);

    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitSeconds * 1000) {
      if (existsSync(lockMarker)) {
        console.log(`Dependencies ready for variant ${this.options.variantId}`);
        return;
      }

      // Wait 500ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Dependencies not ready after ${maxWaitSeconds} seconds. npm install may have failed.`
    );
  }

  private startHealthCheck(): void {
    if (!this.adapter || !this.port) return;

    const checkHealth = async () => {
      try {
        const url = this.adapter!.getHealthCheckUrl(this.port);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for first compile

        try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);

          const isHealthy = this.adapter!.validateHealth(response);
          // Clean up response body to prevent leaks
          await response.body?.cancel().catch(() => {});

          if (isHealthy && this.status === 'starting') {
            this.handleReady();
          }
        } catch {
          clearTimeout(timeoutId);
          // Server not ready yet
        }
      } catch {
        // Health check failed
      }
    };

    this.healthCheckInterval = setInterval(checkHealth, 1000);
  }

  private handleReady(): void {
    if (this.status !== 'starting') return;

    this.status = 'ready';
    clearInterval(this.healthCheckInterval);

    this.process?.stdout?.removeAllListeners('data');
    this.process?.stderr?.removeAllListeners('data');

    const info = this.getInfo();
    this.emit('ready', info);
    this.options.onReady?.(info);
  }

  async stop(): Promise<void> {
    this.status = 'stopped';
    clearTimeout(this.readyTimeout);
    clearInterval(this.healthCheckInterval);

    // Clean up stdio streams immediately to prevent hanging
    this.process?.stdout?.destroy();
    this.process?.stderr?.destroy();

    if (this.process?.pid) {
      // Check if process already exited
      if (this.process.exitCode !== null) {
        // Process already exited, nothing to do
      } else {
        const pid = this.process.pid;
        const { default: kill } = await import('tree-kill');

        await new Promise<void>((resolve) => {
          let resolved = false;

          // Set up exit listener first
          const exitListener = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve();
            }
          };

          this.process?.once('exit', exitListener);

          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              this.process?.removeListener('exit', exitListener);
              kill(pid, 'SIGKILL', () => resolve());
            }
          }, 5000);

          kill(pid, 'SIGTERM', (err?: Error) => {
            if (err && !resolved) {
              resolved = true;
              clearTimeout(timeout);
              this.process?.removeListener('exit', exitListener);
              resolve();
            }
            // Don't resolve here - wait for exit event
          });
        });
      }
    }

    await this.cleanup();
    this.options.onStop?.();
  }

  private async cleanup(): Promise<void> {
    // Clear all timers (belt and suspenders)
    clearTimeout(this.readyTimeout);
    clearInterval(this.healthCheckInterval);
  }

  getInfo(): DevServerInfo {
    const info: DevServerInfo = {
      variantId: this.options.variantId,
      projectPath: this.options.projectPath,
      port: this.port,
      framework: this.adapter?.name || 'unknown',
      status: this.status,
      startedAt: this.startedAt,
    };

    if (this.port > 0) {
      info.url = `http://127.0.0.1:${this.port}`;
    }

    if (this.status === 'failed') {
      info.error = 'Server failed to start';
    }

    return info;
  }
}

export class DevServerManager {
  private servers = new Map<string, DevServer>();

  private getKey(projectKey: string, variantId: string): string {
    return `${projectKey}:${variantId}`;
  }

  async startServer(options: DevServerOptions): Promise<DevServerInfo> {
    const key = this.getKey(options.projectKey, options.variantId);
    const existing = this.servers.get(key);
    if (existing) {
      return existing.getInfo();
    }

    const server = new DevServer(options);
    this.servers.set(key, server);

    try {
      return await server.start();
    } catch (error) {
      this.servers.delete(key);
      throw error;
    }
  }

  async stopServer(projectKey: string, variantId: string): Promise<void> {
    const key = this.getKey(projectKey, variantId);
    const server = this.servers.get(key);
    if (!server) return;

    await server.stop();
    this.servers.delete(key);
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.servers.values()).map((server) => server.stop());
    await Promise.all(stopPromises);
    this.servers.clear();
  }

  getServer(projectKey: string, variantId: string): DevServerInfo | null {
    const key = this.getKey(projectKey, variantId);
    const server = this.servers.get(key);
    return server ? server.getInfo() : null;
  }

  listServers(): DevServerInfo[] {
    return Array.from(this.servers.values()).map((server) => server.getInfo());
  }
}
