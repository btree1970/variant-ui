import { createHash } from 'crypto';
import { createServer, type Server, type Socket } from 'net';

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

export interface PortReservation {
  port: number;
  release: () => Promise<void>;
}

export async function allocatePortWithReservation(
  projectKey: string,
  variantId: string
): Promise<PortReservation> {
  const preferred = portForVariant(projectKey, variantId);

  // Try to reserve the preferred port
  const server = await tryReservePort(preferred);
  if (server) {
    return {
      port: preferred,
      release: async () => {
        await closeServer(server);
      },
    };
  }

  // Scan for available port in range
  const base = projectBasePort(projectKey);
  const maxPort = base + RANGE_SIZE;

  for (let port = base + 1; port < maxPort; port++) {
    const portServer = await tryReservePort(port);
    if (portServer) {
      return {
        port,
        release: async () => {
          await closeServer(portServer);
        },
      };
    }
  }

  throw new Error(`No available ports in range ${base}-${maxPort} for project ${projectKey}`);
}

// Track connections for each server
const serverConnections = new WeakMap<Server, Set<Socket>>();

async function tryReservePort(port: number): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer();
    const connections = new Set<Socket>();

    // Store connections for this server
    serverConnections.set(server, connections);

    // Track all connections
    server.on('connection', (socket) => {
      connections.add(socket);
      socket.once('close', () => {
        connections.delete(socket);
      });
    });

    server.once('error', () => {
      resolve(null);
    });

    server.once('listening', () => {
      resolve(server);
    });

    server.listen(port, '127.0.0.1');
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    // Destroy all active connections first
    const connections = serverConnections.get(server);
    if (connections) {
      for (const socket of connections) {
        socket.destroy();
      }
      connections.clear();
    }

    // Now close the server
    server.close(() => {
      serverConnections.delete(server);
      resolve();
    });
  });
}
