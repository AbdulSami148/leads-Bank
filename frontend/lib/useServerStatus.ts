/** React hook that subscribes to server-reachability state. */

import { useEffect, useState } from "react";
import { serverStatus, type ServerStatus } from "./serverStatus";

export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>(serverStatus.get());

  useEffect(() => {
    const unsubscribe = serverStatus.subscribe(setStatus);
    return unsubscribe;
  }, []);

  return status;
}
