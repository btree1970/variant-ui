import { readFile } from 'fs/promises';
import { join } from 'path';

export type Framework = 'next' | 'unknown';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export async function detectFramework(projectPath: string): Promise<Framework> {
  try {
    const packageJsonPath = join(projectPath, 'package.json');
    const content = await readFile(packageJsonPath, 'utf-8');
    const pkg: PackageJson = JSON.parse(content);

    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (deps.next) return 'next';

    const scripts = pkg.scripts || {};
    if (scripts.dev?.includes('next')) return 'next';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getPortArgs(framework: Framework, port: number): string[] {
  const portStr = String(port);

  switch (framework) {
    case 'next':
      return ['run', 'dev', '--', '-p', portStr];
    default:
      return ['run', 'dev'];
  }
}

export function getDevEnv(framework: Framework, port: number): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'development',
  };

  return env;
}

export function getReadyPattern(framework: Framework): RegExp | null {
  switch (framework) {
    case 'next':
      return /ready on|started server on|ready -/i;
    default:
      return null;
  }
}
