
import React, { useState, useRef, useCallback } from 'react';
import {
  Download,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Video,
  Trash2,
  Play,
  Square,
  RefreshCw,
  Copy,
  ExternalLink,
  Zap,
  Terminal,
  Settings2
} from 'lucide-react';
import { QueueItem, DownloadStatus } from './types';

const DYYSY_CDN_BASE = "https://oscdn2.dyysy.com/MP4";

const App: React.FC = () => {
  const [rawInput, setRawInput] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<{ msg: string, time: string }[]>([]);
  const [concurrentLimit, setConcurrentLimit] = useState(3);

  const processingRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [{ msg, time }, ...prev].slice(0, 100));
  }, []);

  const extractId = (url: string) => {
    // Try matching standard share URL format: .../p/ID
    const matchP = url.match(/\/p\/([a-zA-Z0-9_\-]+)/);
    if (matchP) return matchP[1];

    // Try matching direct CDN URL format: .../MP4/ID.mp4
    const matchCDN = url.match(/\/MP4\/([a-zA-Z0-9_\-]+)\.mp4/);
    if (matchCDN) return matchCDN[1];

    return null;
  };

  const handleAddLinks = () => {
    const lines = rawInput.split(/[\n, ]+/).map(l => l.trim()).filter(l => l);
    const newItems: QueueItem[] = [];

    lines.forEach(line => {
      if (queue.some(item => item.originalUrl === line)) return;

      const id = extractId(line);
      if (id) {
        newItems.push({
          id,
          originalUrl: line,
          cdnUrl: `${DYYSY_CDN_BASE}/${id}.mp4`,
          status: 'pending',
          timestamp: Date.now()
        });
      }
    });

    if (newItems.length > 0) {
      setQueue(prev => [...prev, ...newItems]);
      setRawInput("");
      addLog(`Added ${newItems.length} video URLs to queue.`);
    } else {
      addLog("No valid Sora URLs detected in the input.");
    }
  };

  const downloadFile = async (item: QueueItem) => {
    const updateStatus = (status: DownloadStatus, error?: string) => {
      setQueue(prev => {
        const next = [...prev];
        const actualIndex = next.findIndex(i => i.id === item.id);
        if (actualIndex !== -1) {
          next[actualIndex] = { ...next[actualIndex], status, errorMessage: error };
        }
        return next;
      });
    };

    updateStatus('processing');
    try {
      const response = await fetch(item.cdnUrl);
      if (response.status === 404) throw new Error("File not found on CDN (404)");
      if (!response.ok) throw new Error(`Network error (${response.status})`);

      const blob = await response.blob();
      if (blob.size === 0) throw new Error("Downloaded file is empty (0 bytes)");

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `Sora_${item.id}.mp4`;
      document.body.appendChild(a);
      a.click();

      // extensive delay to ensure browser captures filename
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);

      updateStatus('success');
      addLog(`Downloaded: ${item.id} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (err: any) {
      updateStatus('error', err.message);
      addLog(`Error [${item.id}]: ${err.message}`);
    }
  };

  const processQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);
    addLog("Batch download sequence initiated.");

    while (processingRef.current) {
      let activeTasks = 0;
      let pendingIndex = -1;

      setQueue(q => {
        activeTasks = q.filter(i => i.status === 'processing').length;
        pendingIndex = q.findIndex(i => i.status === 'pending');
        return q;
      });

      const hasWork = await new Promise<boolean>(resolve => {
        setQueue(q => {
          const stillWorking = q.some(i => i.status === 'pending' || i.status === 'processing');
          resolve(stillWorking);
          return q;
        });
      });

      if (!hasWork) break;

      if (activeTasks < concurrentLimit && pendingIndex !== -1) {
        const target = await new Promise<QueueItem | undefined>(resolve => {
          setQueue(q => {
            const item = q.find(i => i.status === 'pending');
            resolve(item);
            return q;
          });
        });

        if (target) {
          downloadFile(target);
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }

    setIsProcessing(false);
    processingRef.current = false;
    addLog("Batch sequence completed.");
  };

  const stopProcessing = () => {
    processingRef.current = false;
    setIsProcessing(false);
    addLog("Sequence termination requested.");
  };

  const clearQueue = () => {
    setQueue([]);
    addLog("Queue purged.");
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-xl shadow-blue-900/40 ring-1 ring-blue-400/50">
            <Download className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
              SoraBatch <span className="text-blue-500 font-light italic">Pro</span>
            </h1>
            <p className="text-slate-400 text-sm font-medium">Professional bulk video acquisition tool</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-2 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Threads:</span>
            <select
              value={concurrentLimit}
              onChange={(e) => setConcurrentLimit(Number(e.target.value))}
              className="bg-transparent text-blue-400 font-bold focus:outline-none cursor-pointer"
            >
              {[1, 2, 3, 4, 5, 8, 16].map(n => <option key={n} value={n} className="bg-slate-900">{n}</option>)}
            </select>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full items-start">
        {/* Left Column: Input & Controls */}
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
              onChange={(e) => setRawInput(e.target.value)}
              placeholder="Paste Sora URLs here (one per line or comma-separated)..."
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
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Batch Actions</h3>
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
                onClick={processQueue}
                disabled={queue.length === 0 || !queue.some(i => i.status === 'pending' || i.status === 'error')}
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
                  const failed = queue.filter(i => i.status === 'error').map(i => i.originalUrl).join('\n');
                  if (failed) navigator.clipboard.writeText(failed);
                  addLog(failed ? "Failed URLs copied." : "No failed URLs found.");
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
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">System Console</span>
            </div>
            <div className="p-4 h-40 overflow-y-auto font-mono text-[11px] space-y-1.5 scroll-smooth">
              {logs.length === 0 && <p className="text-slate-700 italic">No activity logs...</p>}
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3 text-slate-400 group">
                  <span className="text-slate-600 shrink-0">[{log.time}]</span>
                  <span className="group-hover:text-slate-200 truncate">{log.msg}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Queue View */}
        <div className="lg:col-span-8 h-full">
          <div className="bg-slate-900/20 border border-slate-800 rounded-3xl h-[calc(100vh-14rem)] min-h-[500px] flex flex-col overflow-hidden shadow-2xl backdrop-blur-sm">

            {/* List Top Bar */}
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold text-white">Download Queue</h2>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active</span>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">Success</p>
                  <p className="text-lg font-mono font-bold text-green-400">{queue.filter(i => i.status === 'success').length}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">Errors</p>
                  <p className="text-lg font-mono font-bold text-red-400">{queue.filter(i => i.status === 'error').length}</p>
                </div>
              </div>
            </div>

            {/* Queue List */}
            <div className="flex-grow overflow-y-auto p-6 space-y-4">
              {queue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 space-y-4">
                  <div className="bg-slate-800/20 p-8 rounded-full">
                    <Zap className="w-16 h-16 opacity-20" />
                  </div>
                  <p className="text-lg font-medium opacity-50">Operational queue is currently empty.</p>
                </div>
              ) : (
                queue.map((item, idx) => (
                  <div
                    key={`${item.id}-${idx}`}
                    className={`
                        group relative flex items-center justify-between p-4 rounded-2xl border transition-all duration-300
                        ${item.status === 'pending' ? 'bg-slate-900/40 border-slate-800' : ''}
                        ${item.status === 'processing' ? 'bg-blue-600/5 border-blue-500/40 ring-1 ring-blue-500/20 translate-x-1' : ''}
                        ${item.status === 'success' ? 'bg-green-600/5 border-green-500/40 opacity-80' : ''}
                        ${item.status === 'error' ? 'bg-red-600/5 border-red-500/40 shadow-lg shadow-red-950/20' : ''}
                      `}
                  >
                    <div className="flex items-center gap-5 overflow-hidden">
                      {/* Status Icon */}
                      <div className={`
                          w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border shadow-inner transition-colors
                          ${item.status === 'pending' ? 'bg-slate-800 border-slate-700 text-slate-500' : ''}
                          ${item.status === 'processing' ? 'bg-blue-600 border-blue-400 text-white animate-pulse' : ''}
                          ${item.status === 'success' ? 'bg-green-600 border-green-400 text-white' : ''}
                          ${item.status === 'error' ? 'bg-red-600 border-red-400 text-white' : ''}
                        `}>
                        {item.status === 'pending' && <span className="font-mono text-sm font-bold">{idx + 1}</span>}
                        {item.status === 'processing' && <Loader2 className="w-6 h-6 animate-spin" />}
                        {item.status === 'success' && <CheckCircle2 className="w-6 h-6" />}
                        {item.status === 'error' && <AlertCircle className="w-6 h-6" />}
                      </div>

                      {/* Text Info */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <h4 className="font-mono font-bold text-sm text-slate-100 truncate flex items-center gap-2">
                            {item.id}
                          </h4>
                          <a href={item.originalUrl} target="_blank" rel="noreferrer" className="text-slate-600 hover:text-blue-400 transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[11px] font-bold uppercase tracking-tight">
                            {item.status === 'pending' && <span className="text-slate-500">Awaiting Batch Signal</span>}
                            {item.status === 'processing' && <span className="text-blue-400">Acquiring Stream Data...</span>}
                            {item.status === 'success' && <span className="text-green-500">Verification Success • Local Saved</span>}
                            {item.status === 'error' && <span className="text-red-500">{item.errorMessage || 'Unknown Link Error'}</span>}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2">
                      {item.status === 'error' && (
                        <button
                          onClick={() => {
                            setQueue(prev => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], status: 'pending', errorMessage: undefined };
                              return next;
                            });
                          }}
                          className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-blue-400 transition-all border border-transparent hover:border-slate-700"
                          title="Retry"
                        >
                          <RefreshCw className="w-5 h-5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setQueue(prev => prev.filter((_, i) => i !== idx));
                          addLog(`Removed ${item.id} from queue.`);
                        }}
                        className="p-2 hover:bg-red-500/10 rounded-lg text-slate-600 hover:text-red-500 transition-all border border-transparent hover:border-red-500/20"
                        title="Remove"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer Alert */}
            <div className="p-4 bg-yellow-500/5 border-t border-yellow-500/10">
              <div className="flex items-center gap-3 text-yellow-500/60">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  Note: Browser-based downloads are subject to CORS policies. If a node fails, verify CDN availability.
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
