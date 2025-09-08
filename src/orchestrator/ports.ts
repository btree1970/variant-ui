import { createHash } from 'crypto';
import { createServer } from 'net';

const GLOBAL_BASE = 42000;
const RANGE_SIZE = 1000;

export function projectBasePort(projectKey: string): number {
  const hash = createHash('sha256').update(projectKey).digest();
  const hashValue = hash.readUInt32BE(0);
  const maxBase = 65535 - RANGE_SIZE;
  const availableRange = maxBase - GLOBAL_BASE;

  return GLOBAL_BASE + (hashValue % availableRange);
}

export function portForVariant(projectKey: string, variantId: string): number {
  const base = projectBasePort(projectKey);
  const variantNum = parseInt(variantId, 10);

  if (isNaN(variantNum) || variantNum < 1 || variantNum >= RANGE_SIZE) {
    throw new Error(`Invalid variant ID: ${variantId}`);
  }

  return base + variantNum;
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        server.close(() => {
          resolve(true);
        });
      })
      .listen(port, '127.0.0.1');
  });
}

export async function allocatePort(projectKey: string, variantId: string): Promise<number> {
  const preferred = portForVariant(projectKey, variantId);

  if (await isPortAvailable(preferred)) {
    return preferred;
  }

  const base = projectBasePort(projectKey);
  const maxPort = base + RANGE_SIZE;

  for (let port = base + 1; port < maxPort; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available ports in range ${base}-${maxPort} for project ${projectKey}`);
}
