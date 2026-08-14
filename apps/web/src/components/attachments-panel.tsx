// Author: Brijesh Dave <https://github.com/brijeshdave>
// Files on a report or a task — the photo of the seized belt, the vendor's PDF.
// Shared rather than living beside either feature, since both own files the same way.
//
// The limits shown here are read from the same setting the server enforces, so the
// hint on screen cannot promise something the API will refuse. The client-side size
// check is a courtesy that saves someone uploading 40 MB before being told no; it is
// never the limit.
//
// **On previewing.** Images get a thumbnail and open full-size in a dialog;
// everything else gets an icon and downloads. That asymmetry is a security
// decision rather than an unfinished feature — see `canPreview`.
import { type Attachment, type AttachmentOwnerType } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileArchive,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import {
  attachmentUrl,
  deleteAttachment,
  downloadAttachment,
  fetchAttachments,
  fetchUploadLimits,
  uploadAttachment,
} from "@/services/attachments.js";

/** "2.4 MB" — bytes stop meaning anything to a person above a few thousand. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Whether this file can be shown rather than only downloaded.
 *
 * **Images only, and deliberately so.** The API sends every file with
 * `Content-Disposition: attachment` because an HTML or SVG file served inline from
 * our own origin would run its scripts with the session cookie right there. A
 * thumbnail does not weaken that: an `<img>` renders SVG in a static mode where
 * scripts and external references are inert, so pointing one at an uploaded file is
 * safe in a way that *navigating* to it is not.
 *
 * PDFs are excluded on purpose. Previewing one means an iframe or a blob URL, both
 * of which run in our own origin, and PDF is a scripting format. If PDF preview is
 * wanted it deserves a considered change — a sandboxed frame, or a viewer that
 * renders to canvas — not a quiet widening of this list.
 */
const canPreview = (contentType: string): boolean => contentType.startsWith("image/");

/** A recognisable icon per family, so a list of files is scannable at a glance. */
function iconFor(contentType: string, filename: string) {
  if (contentType.startsWith("image/")) return ImageIcon;
  if (contentType.startsWith("video/")) return FileVideo;
  if (contentType.startsWith("audio/")) return FileAudio;
  if (contentType === "application/pdf") return FileText;
  if (/spreadsheet|excel|csv/i.test(contentType)) return FileSpreadsheet;
  if (/zip|compressed|tar|rar|7z/i.test(contentType)) return FileArchive;
  // Content types are wrong often enough that the extension is worth a second look.
  if (/\.(zip|tar|gz|rar|7z)$/i.test(filename)) return FileArchive;
  if (/\.(csv|xlsx?|ods)$/i.test(filename)) return FileSpreadsheet;
  return FileText;
}

export function AttachmentsPanel({
  ownerType,
  ownerId,
  canWrite,
  locked,
}: {
  /** Reports and tasks both carry files; the panel is the same for both. */
  ownerType: AttachmentOwnerType;
  ownerId: string;
  canWrite: boolean;
  /** A locked report refuses file changes. A task never locks. */
  locked: boolean;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState<string | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const files = useQuery({
    queryKey: ["attachments", ownerType, ownerId],
    queryFn: () => fetchAttachments(ownerType, ownerId),
  });

  // The server's own limits, so the hint and the enforcement cannot disagree.
  const limits = useQuery({ queryKey: ["upload-limits"], queryFn: fetchUploadLimits });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["attachments", ownerType, ownerId] });

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(ownerType, ownerId, file),
    onSuccess: async () => {
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    },
  });

  const remove = useMutation({ mutationFn: deleteAttachment, onSuccess: refresh });

  const onPick = (file: File | undefined) => {
    setTooBig(null);
    if (!file) return;
    const maxMb = limits.data?.maxFileSizeMb;
    if (maxMb && file.size > maxMb * 1024 * 1024) {
      // Say it here rather than spend their upload to be told the same thing.
      setTooBig(`${file.name} is ${formatBytes(file.size)} — the limit is ${maxMb} MB.`);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    upload.mutate(file);
  };

  if (files.isLoading) return <Spinner />;

  const list = files.data ?? [];
  const full = Boolean(limits.data && list.length >= limits.data.maxFilesPerOwner);

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Files</h2>
        {list.length > 0 ? <Badge tone="neutral">{list.length}</Badge> : null}
      </div>

      {files.error ? <ErrorAlert error={files.error} /> : null}
      {upload.error ? <ErrorAlert error={upload.error} /> : null}
      {remove.error ? <ErrorAlert error={remove.error} /> : null}
      {tooBig ? <ErrorAlert error={new Error(tooBig)} /> : null}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing attached.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              canWrite={canWrite && !locked}
              onDelete={() => remove.mutate(file.id)}
              deleting={remove.isPending}
              onPreview={() => setPreview(file)}
            />
          ))}
        </ul>
      )}

      {canWrite ? (
        locked ? (
          <p className="text-xs text-muted-foreground">
            This report has been scored and is locked. Re-open it to add or remove files.
          </p>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              // The allowlist doubles as the picker's filter, so the file chooser
              // greys out what the server would reject anyway.
              accept={limits.data?.allowedTypes.join(",") || undefined}
              onChange={(event) => onPick(event.target.files?.[0])}
            />
            <div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
                disabled={upload.isPending || full}
              >
                {upload.isPending ? <Spinner /> : <Upload className="h-4 w-4" />}
                {upload.isPending ? "Uploading…" : "Attach a file"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {full
                ? `This ${ownerType} has the maximum of ${limits.data?.maxFilesPerOwner} files.`
                : limits.data
                  ? `Up to ${limits.data.maxFileSizeMb} MB each. Photos, PDFs and documents.`
                  : null}
            </p>
          </>
        )
      ) : null}

      {preview ? <PreviewDialog file={preview} onClose={() => setPreview(null)} /> : null}
    </Card>
  );
}

function FileRow({
  file,
  canWrite,
  onDelete,
  deleting,
  onPreview,
}: {
  file: Attachment;
  canWrite: boolean;
  onDelete: () => void;
  deleting: boolean;
  onPreview: () => void;
}) {
  const save = useMutation({
    mutationFn: () => downloadAttachment(file.id, file.filename),
  });

  const Icon = iconFor(file.contentType, file.filename);

  return (
    <li className="flex items-center gap-3 rounded-xl border border-border p-2 text-sm">
      {canPreview(file.contentType) ? (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${file.filename}`}
          className="shrink-0 overflow-hidden rounded-lg border border-border transition hover:opacity-80"
        >
          {/* The same authenticated URL the download uses — same-origin through the
              dev proxy, so the session cookie rides along and no token is minted. */}
          <img
            src={attachmentUrl(file.id)}
            alt=""
            loading="lazy"
            className="h-11 w-11 object-cover"
          />
        </button>
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* break-words, not truncate: a filename is how somebody recognises their
            own upload, and half of it is often not enough. */}
        <p className="break-words font-medium leading-tight">{file.filename}</p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(file.size)} · {file.uploadedByName}
          {/* Where the bytes are. Only worth saying when they are not where new
              uploads go — an operator mid-migration wants to see exactly this. */}
          {file.backend === "s3" ? " · S3" : ""}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Download ${file.filename}`}
        onClick={() => save.mutate()}
        disabled={save.isPending}
      >
        {save.isPending ? <Spinner /> : <Download className="h-4 w-4" />}
      </Button>
      {canWrite ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Delete ${file.filename}`}
          onClick={onDelete}
          disabled={deleting}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}
    </li>
  );
}

/** Full-size image over the page. Escape and the backdrop both close it. */
function PreviewDialog({ file, onClose }: { file: Attachment; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-screen overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.filename}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div
        // Clicks inside must not close it, or dragging to select would dismiss it.
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-card"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <p className="min-w-0 break-words text-sm font-medium">{file.filename}</p>
          <Button size="icon" variant="ghost" aria-label="Close preview" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-auto p-2">
          <img
            src={attachmentUrl(file.id)}
            alt={file.filename}
            className="mx-auto max-h-[75vh] w-auto object-contain"
          />
        </div>
      </div>
    </div>
  );
}
