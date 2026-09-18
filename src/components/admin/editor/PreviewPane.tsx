"use client";

import { forwardRef, useState } from "react";

// The right-hand pane of the editor: the live page in an iframe, at a chosen
// device width. The parent owns the iframe ref so it can postMessage edits.

const DEVICES = [
  { id: "desktop", label: "Desktop", width: null },
  { id: "tablet", label: "Tablet", width: 834 },
  { id: "mobile", label: "Mobile", width: 390 },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

export const PreviewPane = forwardRef<
  HTMLIFrameElement,
  { route: string; onReload: () => void; onLoad: () => void; ready: boolean }
>(function PreviewPane({ route, onReload, onLoad, ready }, ref) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const width = DEVICES.find((d) => d.id === device)?.width ?? null;
  const src = `${route}${route.includes("?") ? "&" : "?"}preview=1`;

  return (
    <div className="flex h-full min-w-0 flex-col bg-neutral-200/70">
      <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2 text-xs">
        <span className="whitespace-nowrap font-semibold text-neutral-700">Live preview</span>
        <span
          className={`h-2 w-2 rounded-full ${ready ? "bg-leaf" : "bg-neutral-300"}`}
          title={ready ? "Connected — edits show instantly" : "Loading page..."}
        />
        <div className="ml-3 flex overflow-hidden rounded-lg border border-neutral-300">
          {DEVICES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDevice(d.id)}
              className={`whitespace-nowrap px-3 py-1 font-medium ${device === d.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="hidden min-w-0 truncate text-neutral-400 2xl:inline">Click anything on the page to jump to its field.</span>
        <button
          type="button"
          onClick={onReload}
          className="ml-auto whitespace-nowrap rounded-full border border-neutral-300 px-3 py-1 font-medium text-neutral-600 hover:bg-neutral-50"
        >
          Reload
        </button>
        <a
          href={`${route}${route.includes("?") ? "&" : "?"}edit=1`}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap rounded-full border border-neutral-300 px-3 py-1 font-medium text-neutral-600 hover:bg-neutral-50"
        >
          Edit on page ↗
        </a>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div
          className="mx-auto h-full overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-neutral-300 transition-[width] duration-200"
          style={{ width: width ? `${width}px` : "100%", maxWidth: "100%" }}
        >
          <iframe
            ref={ref}
            src={src}
            title="Live preview"
            onLoad={onLoad}
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
});
