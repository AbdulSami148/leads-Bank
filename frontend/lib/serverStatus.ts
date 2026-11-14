/**
 * Server-reachability state shared between the API helper and React UI.
 *
 * The API helper flips the status when a request is slow (backend waking up)
 * or unreachable (network error / 502-504 after retry). The banner component
 * subscribes and shows a friendly message instead of a raw error.
 */

export type ServerStatus = "idle" | "starting" | "unreachable";

class ServerStatusStore {
  private status: ServerStatus = "idle";
  private listeners = new Set<(status: ServerStatus) => void>();

  set(status: ServerStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }

  get(): ServerStatus {
    return this.status;
  }

  subscribe(listener: (status: ServerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const serverStatus = new ServerStatusStore();
