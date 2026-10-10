import { Suspense, use, useState } from "react";
import type { AppInfo, IpcResult } from "./ipc";
import { Titlebar } from "./Titlebar";

interface AppProps {
  appInfo: Promise<IpcResult<AppInfo>>;
}

function StartupError({ appInfo }: AppProps) {
  const info = use(appInfo);
  if (info.ok) return null;
  return <ErrorBanner message={`Could not read app info from Rust: ${info.error}`} />;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="bg-danger px-3 py-1.5 text-[12px] text-danger-text">
      {message}
    </div>
  );
}

export function App({ appInfo }: AppProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full flex-col">
      <Suspense fallback={<div className="h-9 shrink-0 border-b border-border bg-surface" />}>
        <Titlebar appInfo={appInfo} onError={setError} />
        <StartupError appInfo={appInfo} />
      </Suspense>
      {error !== null && <ErrorBanner message={error} />}
      <main className="min-h-0 w-full flex-1" />
    </div>
  );
}
