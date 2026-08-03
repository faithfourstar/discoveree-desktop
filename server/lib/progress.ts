import { EventEmitter } from 'events';

export interface ProgressEvent {
  taskId: string;
  step: string;
  message: string;
  progress?: number;
  status: 'running' | 'completed' | 'error';
  timestamp: string;
}

class ProgressEventEmitter extends EventEmitter {
  private activeListeners: Map<string, Set<(event: ProgressEvent) => void>> = new Map();

  emit(taskId: string, step: string, message: string, progress?: number): boolean {
    const event: ProgressEvent = {
      taskId,
      step,
      message,
      progress,
      status: 'running',
      timestamp: new Date().toISOString()
    };
    console.log(`[Progress] ${taskId}: ${step} - ${message}`);
    return super.emit(taskId, event);
  }

  subscribe(taskId: string, callback: (event: ProgressEvent) => void): () => void {
    if (!this.activeListeners.has(taskId)) {
      this.activeListeners.set(taskId, new Set());
    }
    this.activeListeners.get(taskId)!.add(callback);
    this.on(taskId, callback);

    return () => {
      this.off(taskId, callback);
      const listeners = this.activeListeners.get(taskId);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.activeListeners.delete(taskId);
        }
      }
    };
  }

  complete(taskId: string, completionMessage?: string): void {
    const event: ProgressEvent = {
      taskId,
      step: 'complete',
      message: completionMessage || 'Task completed',
      progress: 100,
      status: 'completed',
      timestamp: new Date().toISOString()
    };
    super.emit(taskId, event);
    this.activeListeners.delete(taskId);
    this.removeAllListeners(taskId);
  }

  error(taskId: string, errorMessage: string): void {
    const event: ProgressEvent = {
      taskId,
      step: 'error',
      message: errorMessage,
      status: 'error',
      timestamp: new Date().toISOString()
    };
    super.emit(taskId, event);
    this.activeListeners.delete(taskId);
    this.removeAllListeners(taskId);
  }
}

export const progressEmitter = new ProgressEventEmitter();
