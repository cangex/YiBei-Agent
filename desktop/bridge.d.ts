import type { Project, Workflow } from '../app/components/ProjectSession';
export {};
declare global {
  interface Window {
    yibeiDesktop: {
      read(): Promise<Project>;
      create(name: string): Promise<Project>;
      open(): Promise<Project | null>;
      save(id: string, state: Record<string, Workflow>): Promise<Project>;
      importSTL(id: string, bytes: Uint8Array, name: string): Promise<Project>;
      quality(value: string): Promise<string>;
      reveal(): Promise<boolean>;
      closeReady(): Promise<void>;
      onAction(callback: (action: string) => void): () => void;
    };
  }
}
