import { readFile } from 'fs/promises';
import { join } from 'path';
import type { FrameworkAdapter } from './base.js';

export class NextJsAdapter implements FrameworkAdapter {
  readonly name = 'next';

  async detect(projectPath: string): Promise<boolean> {
    try {
      const packageJsonPath = join(projectPath, 'package.json');
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      if (deps.next) return true;

      const scripts = pkg.scripts || {};
      if (scripts.dev?.includes('next')) return true;

      return false;
    } catch {
      return false;
    }
  }

  getPortArgs(port: number): string[] {
    // Include -H to force IPv4 binding
    return ['run', 'dev', '--', '-p', String(port), '-H', '127.0.0.1'];
  }

  getEnvVars(port: number): Record<string, string> {
    return {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1', // Force IPv4
      NODE_ENV: 'development',
    };
  }

  getStartCommand(): string {
    return 'npm';
  }

  getReadyPattern(): RegExp | null {
    return /ready on|started server on|ready -|✓ Ready in/i;
  }

  getHealthCheckUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  validateHealth(_response: unknown): boolean {
    // For Next.js, any response (including 404) means the server is up
    return true;
  }
}
