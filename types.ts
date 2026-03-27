
export type DownloadStatus = 'pending' | 'processing' | 'success' | 'error' | 'analyzing';

export interface QueueItem {
  queueId: string;
  id: string;
  originalUrl: string;
  normalizedInput: string;
  status: DownloadStatus;
  errorMessage?: string;
  title?: string;
  timestamp: number;
}

export interface AppState {
  queue: QueueItem[];
  isProcessing: boolean;
  logs: string[];
  concurrentLimit: number;
}
