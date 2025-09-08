export type VariantStatus = 'allocating' | 'created' | 'running' | 'stopped' | 'failed';

export interface Variant {
  id: string; // "001"
  branch: string; // "ui-var/001-compact-header"
  port?: number; // dev server port if running
  pid?: number; // child process pid
  createdAt: string;
  lastUpdatedAt?: string;
  status?: VariantStatus;
  description?: string; // optional description of the variant
  error?: string; // error message if status is 'failed'
  originUrl?: string; // git remote URL if available
}

export interface ProjectMetadata {
  schemaVersion: 1;
  projectPath: string; // canonical git root realpath
  projectName: string; // basename(projectPath)
  originUrl?: string; // git remote, if available
  createdAt: string;
  lastAccessedAt: string;
  variants: Variant[];
}

export interface Config {
  maxVariants?: number;
  defaultPort?: number;
  cleanupDays?: number;
}
