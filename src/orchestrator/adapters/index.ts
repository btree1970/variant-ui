import type { FrameworkAdapter } from './base.js';
import { NextJsAdapter } from './nextjs.js';

export class FrameworkRegistry {
  private adapters: FrameworkAdapter[] = [new NextJsAdapter()];

  async detectFramework(projectPath: string): Promise<FrameworkAdapter | null> {
    for (const adapter of this.adapters) {
      if (await adapter.detect(projectPath)) {
        return adapter;
      }
    }
    return null;
  }
}

export type { FrameworkAdapter } from './base.js';
export { NextJsAdapter } from './nextjs.js';
