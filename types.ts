
export type DownloadStatus = 'pending' | 'processing' | 'success' | 'error' | 'analyzing';

export interface QueueItem {
  id: string;
  originalUrl: string;
  cdnUrl: string;
  status: DownloadStatus;
  errorMessage?: string;
  aiTag?: string;
  timestamp: number;
}

export interface AppState {
  queue: QueueItem[];
  isProcessing: boolean;
  logs: string[];
  concurrentLimit: number;
}
