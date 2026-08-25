/// <reference types="vite/client" />

interface MonacoEnvironment {
  getWorker(workerId: string, label: string): Worker;
}

interface Window {
  MonacoEnvironment?: MonacoEnvironment;
  __LIVECLIP_TEXT?: () => string;
  __LIVECLIP_INSERT?: (index: number, value: string) => void;
}

declare const self: Window & { MonacoEnvironment?: MonacoEnvironment };
