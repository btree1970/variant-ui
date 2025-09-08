export type VariantStatus = 'created' | 'running' | 'stopped' | 'failed';

export interface Variant {
  id: string;                 // "001"
  branch: string;              // "ui-var/001-compact-header"
  port?: number;               // dev server port if running
  pid?: number;                // child process pid
  createdAt: string;
  lastUpdatedAt?: string;
  status?: VariantStatus;
  description?: string;        // optional description of the variant
}

export interface ProjectMetadata {
  schemaVersion: 1;
  projectPath: string;         // canonical git root realpath
  projectName: string;         // basename(projectPath)
  originUrl?: string;          // git remote, if available
  createdAt: string;
  lastAccessedAt: string;
  variants: Variant[];
}

export interface Config {
  maxVariants?: number;
  defaultPort?: number;
  cleanupDays?: number;
}