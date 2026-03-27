import React, { useCallback, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Video,
  Zap,
} from 'lucide-react';
import {
  buildDownloadFilename,
  extractSoraId,
  getDownloadAsset,
  isSupportedSoraInput,
  normalizeSoraInput,
  resolveSoraVideo,
} from './services/dyysyService';
import { DownloadStatus, QueueItem } from './types';

const createQueueId = () => `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const App: React.FC = () => {
  const [rawInput, setRawInput] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{ msg: string; time: string }[]>([]);
  const [concurrentLimit, setConcurrentLimit] = useState(3);

  const processingRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    setLogs((prev) => [{ msg, time }, ...prev].slice(0, 100));
  }, []);

  const setQueueAndSync = useCallback((updater: React.SetStateAction<QueueItem[]>) => {
    setQueue((prev) => {
      const next =
        typeof updater === 'function'
          ? (updater as (current: QueueItem[]) => QueueItem[])(prev)
          : updater;

      queueRef.current = next;
      return next;
    });
  }, []);

  const updateQueueItem = useCallback(
    (queueId: string, updater: (item: QueueItem) => QueueItem) => {
      setQueueAndSync((prev) =>
        prev.map((item) => (item.queueId === queueId ? updater(item) : item)),
      );
    },
    [setQueueAndSync],
  );

  const handleAddLinks = () => {
    const entries = rawInput
      .split(/[\n,\s]+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      addLog('Paste at least one Sora share URL or ID before ingesting.');
      return;
    }

    const existingInputs = new Set(queueRef.current.map((item) => item.normalizedInput));
    const now = Date.now();
    const newItems: QueueItem[] = [];
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

    entries.forEach((entry, index) => {
      const normalizedInput = normalizeSoraInput(entry);

      if (!normalizedInput || !isSupportedSoraInput(normalizedInput)) {
        skippedInvalid += 1;
        return;
      }

      if (existingInputs.has(normalizedInput)) {
        skippedDuplicates += 1;
        return;
      }

      const extractedId = extractSoraId(normalizedInput);

      newItems.push({
        id: extractedId ?? `pending_${index + 1}`,
        normalizedInput,
        originalUrl: entry,
        queueId: createQueueId(),
        status: 'pending',
        timestamp: now + index,
      });

      existingInputs.add(normalizedInput);
    });

    if (newItems.length > 0) {
      setQueueAndSync((prev) => [...prev, ...newItems]);
      setRawInput('');
      addLog(`Added ${newItems.length} item${newItems.length === 1 ? '' : 's'} to queue.`);
    }

    if (skippedDuplicates > 0) {
      addLog(`Skipped ${skippedDuplicates} duplicate item${skippedDuplicates === 1 ? '' : 's'}.`);
    }

    if (skippedInvalid > 0) {
      addLog(`Skipped ${skippedInvalid} unsupported input${skippedInvalid === 1 ? '' : 's'}.`);
    }

    if (newItems.length === 0 && skippedInvalid === 0 && skippedDuplicates === 0) {
      addLog('No valid Sora URLs detected in the input.');
    }
  };

  const downloadFile = useCallback(
    async (item: QueueItem) => {
      const updateStatus = (
        status: DownloadStatus,
        options?: Partial<Pick<QueueItem, 'errorMessage' | 'id' | 'title'>>,
      ) => {
        updateQueueItem(item.queueId, (current) => ({
          ...current,
          ...options,
          errorMessage: options?.errorMessage,
          id: options?.id ?? current.id,
          status,
          title: options?.title ?? current.title,
        }));
      };

      updateStatus('analyzing', { errorMessage: undefined });
      addLog(`Resolving ${item.id} through Dyysy...`);

      try {
        const resolved = await resolveSoraVideo(item.normalizedInput);
        const asset = getDownloadAsset(resolved, 'mp4');
        const resolvedId = resolved.mediaId || item.id;
        const resolvedTitle = resolved.postInfo.title?.trim() || item.title;

        updateStatus('processing', {
          errorMessage: undefined,
          id: resolvedId,
          title: resolvedTitle,
        });

        const response = await fetch(asset.url);
        if (response.status === 404) {
          throw new Error('Resolved media link returned 404.');
        }
        if (!response.ok) {
          throw new Error(`Download request failed (${response.status}).`);
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error('Downloaded file is empty (0 bytes).');
        }

        const downloadUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.style.display = 'none';
        anchor.href = downloadUrl;
        anchor.download = buildDownloadFilename(resolved, 'mp4');
        document.body.appendChild(anchor);
        anchor.click();

        setTimeout(() => {
          window.URL.revokeObjectURL(downloadUrl);
          document.body.removeChild(anchor);
        }, 100);

        updateStatus('success', {
          errorMessage: undefined,
          id: resolvedId,
          title: resolvedTitle,
        });

        addLog(
          `Downloaded ${resolvedId} (${(blob.size / 1024 / 1024).toFixed(2)} MB)${
            resolvedTitle ? ` • ${resolvedTitle}` : ''
          }`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown download error';
        updateStatus('error', { errorMessage: message });
        addLog(`Error [${item.id}]: ${message}`);
      }
    },
    [addLog, updateQueueItem],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;

    const hasFailedItems = queueRef.current.some((item) => item.status === 'error');
    if (hasFailedItems) {
      setQueueAndSync((prev) =>
        prev.map((item) =>
          item.status === 'error'
            ? { ...item, errorMessage: undefined, status: 'pending' }
            : item,
        ),
      );
      addLog('Reset failed items and re-queued them for processing.');
    }

    processingRef.current = true;
    setIsProcessing(true);
    addLog('Batch download sequence initiated.');

    while (processingRef.current) {
      const snapshot = queueRef.current;
      const activeTasks = snapshot.filter(
        (queuedItem) =>
          queuedItem.status === 'analyzing' || queuedItem.status === 'processing',
      ).length;
      const nextPendingItem = snapshot.find((queuedItem) => queuedItem.status === 'pending');
      const hasWork = snapshot.some(
        (queuedItem) =>
          queuedItem.status === 'pending' ||
          queuedItem.status === 'analyzing' ||
          queuedItem.status === 'processing',
      );

      if (!hasWork) break;

      if (nextPendingItem && activeTasks < concurrentLimit) {
        void downloadFile(nextPendingItem);
      }

      await sleep(250);
    }

    processingRef.current = false;
    setIsProcessing(false);
    addLog('Batch sequence completed.');
  }, [addLog, concurrentLimit, downloadFile, setQueueAndSync]);

  const stopProcessing = () => {
    processingRef.current = false;
    setIsProcessing(false);
    addLog('Sequence termination requested. Active downloads will finish their current request.');
  };

  const clearQueue = () => {
    setQueueAndSync([]);
    addLog('Queue purged.');
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-xl shadow-blue-900/40 ring-1 ring-blue-400/50">
            <Download className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
              SoraBatch <span className="text-blue-500 font-light italic">Pro</span>
            </h1>
            <p className="text-slate-400 text-sm font-medium">
              Batch no-watermark downloads powered by Dyysy&apos;s live resolver
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Threads:
            </span>
            <select
              value={concurrentLimit}
              onChange={(event) => setConcurrentLimit(Number(event.target.value))}
              className="bg-transparent text-blue-400 font-bold focus:outline-none cursor-pointer"
            >
              {[1, 2, 3, 4, 5, 8, 16].map((count) => (
                <option key={count} value={count} className="bg-slate-900">
                  {count}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full items-start">
        <div className="lg:col-span-4 space-y-6 flex flex-col">
          <section className="bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-2xl backdrop-blur-md">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-800/20">
              <span className="text-sm font-bold text-slate-300 flex items-center gap-2">
                <Video className="w-4 h-4 text-blue-500" />
                URL INGESTION
              </span>
              <span className="text-[10px] bg-slate-800 text-slate-500 px-2 py-0.5 rounded uppercase font-bold tracking-widest">
                Raw Input
              </span>
            </div>
            <textarea
              value={rawInput}
              onChange={(event) => setRawInput(event.target.value)}
              placeholder="Paste Sora share URLs, IDs, /p/... paths, or dyysy.com/?url=... links..."
              className="w-full h-64 bg-transparent p-4 text-sm font-mono text-slate-300 placeholder-slate-600 focus:outline-none resize-none"
            />
            <div className="p-4 bg-slate-950/50 border-t border-slate-800">
              <button
                onClick={handleAddLinks}
                className="w-full bg-slate-200 hover:bg-white text-slate-950 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                Ingest to Queue
              </button>
            </div>
          </section>

          <section className="bg-slate-900/30 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">
                Batch Actions
              </h3>
              <div className="flex gap-2">
                <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded font-mono">
                  {queue.length} Total
                </span>
              </div>
            </div>

            {isProcessing ? (
              <button
                onClick={stopProcessing}
                className="w-full group relative overflow-hidden bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20 font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3"
              >
                <Square className="w-5 h-5 fill-current" />
                ABORT SEQUENCE
              </button>
            ) : (
              <button
                onClick={() => {
                  void processQueue();
                }}
                disabled={
                  queue.length === 0 ||
                  !queue.some((item) => item.status === 'pending' || item.status === 'error')
                }
                className="w-full group relative overflow-hidden bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-900/40 disabled:opacity-30 disabled:grayscale"
              >
                <Play className="w-5 h-5 fill-current group-hover:scale-110 transition-transform" />
                EXECUTE BATCH
                <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={clearQueue}
                className="flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors py-2 rounded-lg border border-transparent hover:border-slate-800"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear Queue
              </button>
              <button
                onClick={() => {
                  const failed = queue
                    .filter((item) => item.status === 'error')
                    .map((item) => item.originalUrl)
                    .join('\n');

                  if (failed) {
                    void navigator.clipboard.writeText(failed);
                  }

                  addLog(failed ? 'Failed URLs copied.' : 'No failed URLs found.');
                }}
                className="flex items-center justify-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors py-2 rounded-lg border border-transparent hover:border-slate-800"
              >
                <Copy className="w-3.5 h-3.5" />
                Export Failed
              </button>
            </div>
          </section>

          <section className="bg-slate-950 border border-slate-800 rounded-2xl flex-grow overflow-hidden flex flex-col shadow-inner">
            <div className="p-3 border-b border-slate-800 flex items-center gap-2 bg-slate-900/50">
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                System Console
              </span>
            </div>
            <div className="p-4 h-40 overflow-y-auto font-mono text-[11px] space-y-1.5 scroll-smooth">
              {logs.length === 0 && <p className="text-slate-700 italic">No activity logs...</p>}
              {logs.map((log, index) => (
                <div key={`${log.time}-${index}`} className="flex gap-3 text-slate-400 group">
                  <span className="text-slate-600 shrink-0">[{log.time}]</span>
                  <span className="group-hover:text-slate-200 truncate">{log.msg}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:col-span-8 h-full">
          <div className="bg-slate-900/20 border border-slate-800 rounded-3xl h-[calc(100vh-14rem)] min-h-[500px] flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold text-white">Download Queue</h2>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    Active
                  </span>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">
                    Success
                  </p>
                  <p className="text-lg font-mono font-bold text-green-400">
                    {queue.filter((item) => item.status === 'success').length}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">
                    Errors
                  </p>
                  <p className="text-lg font-mono font-bold text-red-400">
                    {queue.filter((item) => item.status === 'error').length}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-grow overflow-y-auto p-6 space-y-4">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 space-y-4">
                  <div className="bg-slate-800/20 p-8 rounded-full">
                    <Zap className="w-16 h-16 opacity-20" />
                  </div>
                  <p className="text-lg font-medium opacity-50">
                    Operational queue is currently empty.
                  </p>
                </div>
              ) : (
                queue.map((item, index) => {
                  const isBusy =
                    item.status === 'analyzing' || item.status === 'processing';
                  const externalHref = item.originalUrl.startsWith('http')
                    ? item.originalUrl
                    : null;

                  return (
                    <div
                      key={item.queueId}
                      className={`
                        group relative flex items-center justify-between p-4 rounded-2xl border transition-all duration-300
                        ${item.status === 'pending' ? 'bg-slate-900/40 border-slate-800' : ''}
                        ${item.status === 'analyzing' ? 'bg-sky-600/5 border-sky-500/40 ring-1 ring-sky-500/20 translate-x-1' : ''}
                        ${item.status === 'processing' ? 'bg-blue-600/5 border-blue-500/40 ring-1 ring-blue-500/20 translate-x-1' : ''}
                        ${item.status === 'success' ? 'bg-green-600/5 border-green-500/40 opacity-80' : ''}
                        ${item.status === 'error' ? 'bg-red-600/5 border-red-500/40 shadow-lg shadow-red-950/20' : ''}
                      `}
                    >
                      <div className="flex items-center gap-5 overflow-hidden">
                        <div
                          className={`
                            w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-inner transition-colors
                            ${item.status === 'pending' ? 'bg-slate-800 border-slate-700 text-slate-500' : ''}
                            ${item.status === 'analyzing' ? 'bg-sky-600 border-sky-400 text-white animate-pulse' : ''}
                            ${item.status === 'processing' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : ''}
                            ${item.status === 'success' ? 'bg-green-600 border-green-400 text-white' : ''}
                            ${item.status === 'error' ? 'bg-red-600 border-red-400 text-white' : ''}
                          `}
                        >
                          {item.status === 'pending' && (
                            <span className="font-mono text-sm font-bold">{index + 1}</span>
                          )}
                          {isBusy && <Loader2 className="w-6 h-6 animate-spin" />}
                          {item.status === 'success' && <CheckCircle2 className="w-6 h-6" />}
                          {item.status === 'error' && <AlertCircle className="w-6 h-6" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <h4 className="font-mono font-bold text-sm text-slate-100 truncate flex items-center gap-2">
                              {item.id}
                            </h4>
                            {externalHref && (
                              <a
                                href={externalHref}
                                target="_blank"
                                rel="noreferrer"
                                className="text-slate-600 hover:text-blue-400 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          {item.title && (
                            <p className="text-[11px] text-slate-500 truncate mt-1">{item.title}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-[11px] font-bold uppercase tracking-tight">
                              {item.status === 'pending' && (
                                <span className="text-slate-500">Awaiting Batch Signal</span>
                              )}
                              {item.status === 'analyzing' && (
                                <span className="text-sky-400">Resolving Live Dyysy Links...</span>
                              )}
                              {item.status === 'processing' && (
                                <span className="text-blue-400">Acquiring Stream Data...</span>
                              )}
                              {item.status === 'success' && (
                                <span className="text-green-500">Verification Success • Local Saved</span>
                              )}
                              {item.status === 'error' && (
                                <span className="text-red-500">
                                  {item.errorMessage || 'Unknown Link Error'}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {item.status === 'error' && (
                          <button
                            onClick={() => {
                              updateQueueItem(item.queueId, (current) => ({
                                ...current,
                                errorMessage: undefined,
                                status: 'pending',
                              }));
                            }}
                            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition-all border border-transparent hover:border-slate-700"
                            title="Retry"
                          >
                            <RefreshCw className="w-5 h-5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setQueueAndSync((prev) =>
                              prev.filter((queuedItem) => queuedItem.queueId !== item.queueId),
                            );
                            addLog(`Removed ${item.id} from queue.`);
                          }}
                          className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-500 transition-all border border-transparent hover:border-red-500/20"
                          title="Remove"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 bg-yellow-500/5 border-t border-yellow-500/10">
              <div className="flex items-center gap-3 text-yellow-500/60">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  Queue items are resolved against Dyysy on demand so stale shares or expired media
                  links surface as resolution errors before download.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
