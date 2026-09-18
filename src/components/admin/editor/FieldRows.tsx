"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FieldData } from "@/lib/editor-types";
import { isBlockedUrl } from "@/lib/safe-url";
import { ACCEPT_IMAGE, ACCEPT_VIDEO, useUpload } from "./MediaPicker";

// One row per editable field. Rows are measured by the virtualizer, so each
// keeps a stable outer element and avoids layout that jumps after mount.

export type RowProps = {
  field: FieldData;
  value: string;
  edited: boolean;
  dirty: boolean;
  focused: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onPick: () => void;
};

const TYPE_LABEL: Record<FieldData["type"], string> = {
  TEXT: "Text",
  IMAGE: "Image",
  LINK: "Link",
  VIDEO: "Video",
};

function Header({ field, edited, dirty, onReset }: Pick<RowProps, "field" | "edited" | "dirty" | "onReset">) {
  return (
    <div className="mb-1.5 flex items-center gap-2 text-xs">
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-neutral-500">
        {TYPE_LABEL[field.type]}
      </span>
      <code className="truncate text-[11px] text-neutral-400" title={field.key}>{field.key}</code>
      {dirty ? (
        <span className="rounded-full bg-ember/15 px-2 py-0.5 text-[10px] font-semibold text-ember-ink">unsaved</span>
      ) : edited ? (
        <span className="rounded-full bg-sun/15 px-2 py-0.5 text-[10px] font-semibold text-leaf">edited</span>
      ) : null}
      {edited || dirty ? (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto text-[11px] text-neutral-400 hover:text-neutral-700 hover:underline"
          title={`Imported value: ${field.defaultValue.slice(0, 200)}`}
        >
          Reset to imported
        </button>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-ink focus:ring-2 focus:ring-sun/60";

function AutoTextarea({
  value,
  onChange,
  inputRef,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  // Grow with the content so long paragraphs are editable without a scrollbar.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(480, Math.max(38, el.scrollHeight + 2))}px`;
  }, [value, inputRef]);
  return (
    <textarea
      ref={inputRef}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} resize-none leading-relaxed`}
      {...rest}
    />
  );
}

export function TextRow(props: RowProps) {
  const { field, value, onChange, onFocus, onBlur } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const long = field.defaultValue.length > 70 || field.defaultValue.includes("\n") || value.length > 70;
  return (
    <div>
      <Header {...props} />
      {long ? (
        <AutoTextarea value={value} onChange={onChange} inputRef={ref} onFocus={onFocus} onBlur={onBlur} data-field-input />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          className={inputClass}
          data-field-input
        />
      )}
    </div>
  );
}

export function LinkRow(props: RowProps) {
  const { value, onChange, onFocus, onBlur } = props;
  const blocked = isBlockedUrl(value, "href");
  return (
    <div>
      <Header {...props} />
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="https://example.com/page, /route or #section"
          className={`${inputClass} font-mono text-xs ${blocked ? "border-alert/40" : ""}`}
          data-field-input
          spellCheck={false}
        />
        {value && !blocked ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-full border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
          >
            Open
          </a>
        ) : null}
      </div>
      {blocked ? (
        <p className="mt-1 text-xs text-alert">Only http(s), mailto:, tel:, relative paths and #anchors are allowed.</p>
      ) : null}
    </div>
  );
}

function MediaActions({
  accept,
  onUpload,
  uploading,
  onPick,
  onUrl,
  urlOpen,
  children,
}: {
  accept: string;
  onUpload: (file: File) => void;
  uploading: boolean;
  onPick: () => void;
  onUrl: () => void;
  urlOpen: boolean;
  children?: ReactNode;
}) {
  const btn = "rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className={`cursor-pointer ${btn}`}>
        {uploading ? "Uploading..." : "Upload"}
        <input
          type="file"
          className="hidden"
          accept={accept}
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </label>
      <button type="button" onClick={onPick} className={btn}>Library</button>
      <button type="button" onClick={onUrl} className={`${btn} ${urlOpen ? "bg-neutral-100" : ""}`}>URL</button>
      {children}
    </div>
  );
}

export function ImageRow(props: RowProps) {
  const { field, value, onChange, onPick, onFocus, onBlur } = props;
  const [urlOpen, setUrlOpen] = useState(false);
  const upload = useUpload(onChange);
  const placeholder = value.startsWith("data:image/svg+xml");
  return (
    <div>
      <Header {...props} />
      <div className="flex items-start gap-4">
        <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-[linear-gradient(45deg,#f5f5f5_25%,transparent_25%,transparent_75%,#f5f5f5_75%),linear-gradient(45deg,#f5f5f5_25%,#fff_25%,#fff_75%,#f5f5f5_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={field.label} className="h-full w-full object-contain" />
          ) : (
            <span className="flex h-full items-center justify-center text-[11px] text-neutral-400">No image</span>
          )}
          {placeholder ? (
            <span className="absolute inset-x-0 bottom-0 bg-sun/95 px-1 text-center text-[10px] font-semibold text-ink">
              placeholder
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-xs text-neutral-500" title={value}>
            {placeholder ? "Placeholder — upload the real image" : value.split("/").pop()?.split("?")[0] || "—"}
          </p>
          <MediaActions
            accept={ACCEPT_IMAGE}
            onUpload={(f) => upload.mutate(f)}
            uploading={upload.isPending}
            onPick={onPick}
            onUrl={() => setUrlOpen((v) => !v)}
            urlOpen={urlOpen}
          />
          {urlOpen ? (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder="https://... or /uploads/..."
              className={`${inputClass} font-mono text-xs`}
              data-field-input
              spellCheck={false}
            />
          ) : null}
          {upload.error ? <p className="text-xs text-alert">{upload.error.message}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function VideoRow(props: RowProps) {
  const { value, onChange, onPick, onFocus, onBlur } = props;
  const [urlOpen, setUrlOpen] = useState(!value);
  const upload = useUpload(onChange);
  const blocked = isBlockedUrl(value, "src");
  return (
    <div>
      <Header {...props} />
      <div className="flex items-start gap-4">
        <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-black">
          {value && !blocked ? (
            <video key={value} src={value} muted preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-[11px] text-neutral-400">No video</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-xs text-neutral-500" title={value}>
            {value ? value.split("/").pop()?.split("?")[0] : "No source set"}
          </p>
          <MediaActions
            accept={ACCEPT_VIDEO}
            onUpload={(f) => upload.mutate(f)}
            uploading={upload.isPending}
            onPick={onPick}
            onUrl={() => setUrlOpen((v) => !v)}
            urlOpen={urlOpen}
          />
          {urlOpen ? (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder="https://... .mp4 or /uploads/... (files up to 10MB can be uploaded)"
              className={`${inputClass} font-mono text-xs ${blocked ? "border-alert/40" : ""}`}
              data-field-input
              spellCheck={false}
            />
          ) : null}
          {upload.error ? <p className="text-xs text-alert">{upload.error.message}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function FieldRow(props: RowProps) {
  switch (props.field.type) {
    case "IMAGE": return <ImageRow {...props} />;
    case "LINK": return <LinkRow {...props} />;
    case "VIDEO": return <VideoRow {...props} />;
    default: return <TextRow {...props} />;
  }
}
