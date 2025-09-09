export interface FrameworkAdapter {
  readonly name: string;

  detect(projectPath: string): Promise<boolean>;

  getPortArgs(port: number): string[];
  getEnvVars(port: number): Record<string, string>;

  getStartCommand(): string;
  getReadyPattern(): RegExp | null;

  getHealthCheckUrl(port: number): string;
  validateHealth(response: unknown): boolean;
}
