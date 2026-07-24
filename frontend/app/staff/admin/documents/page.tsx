"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/AsyncState";
import { RoleGuard } from "@/components/RoleGuard";
import { StaffNav } from "@/components/StaffNav";
import { DocumentStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import {
  apiFetch,
  ApiError,
  downloadFile,
  patchJson,
  postForm,
} from "@/lib/api";

interface CompanyDocument {
  id: string;
  name: string;
  originalFileName: string;
  version: number;
  status: "PROCESSING" | "ACTIVE" | "INACTIVE" | "FAILED";
  processingError: string | null;
  uploadedAt: string;
  updatedAt: string;
}

function UploadDocumentForm({ onUploaded }: { onUploaded: () => void }) {
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF file to upload.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("file", file);
      await postForm("/admin/documents", form);
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="mt-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-name">Document name</Label>
          <Input
            id="doc-name"
            required
            placeholder="Company Handbook"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-file">PDF file</Label>
          <input
            id="doc-file"
            ref={fileRef}
            type="file"
            accept="application/pdf"
            required
            className="text-sm text-text-secondary"
          />
        </div>
        <p className="text-xs text-text-muted">
          Processed and embedded in the background — status starts as
          Processing and becomes Active once ready.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" disabled={uploading} className="self-start">
          {uploading ? "Uploading…" : "Upload Document"}
        </Button>
      </form>
    </Card>
  );
}

function UploadVersionButton({
  documentId,
  onUploaded,
}: {
  documentId: string;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await postForm(`/admin/documents/${documentId}/versions`, form);
      onUploaded();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to upload new version.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-brand-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
        {uploading ? "Uploading…" : "Upload New Version"}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={() => void handleChange()}
          className="hidden"
        />
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function DocumentsAdmin() {
  const [documents, setDocuments] = useState<CompanyDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function loadDocuments() {
    apiFetch<CompanyDocument[]>("/admin/documents")
      .then(setDocuments)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load documents."),
      );
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function toggleStatus(doc: CompanyDocument) {
    setBusyId(doc.id);
    setError(null);
    try {
      await patchJson(`/admin/documents/${doc.id}/status`, {
        status: doc.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      loadDocuments();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <StaffNav />
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Company Documents
          </h1>
          <Button onClick={() => setShowUpload((v) => !v)}>
            {showUpload ? "Cancel" : "Upload Document"}
          </Button>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          HR policy and tech-stack documents the recruitment assistant grounds
          its answers and job drafts in.
        </p>

        {error && (
          <div className="mt-4">
            <ErrorState message={error} />
          </div>
        )}

        {showUpload && (
          <UploadDocumentForm
            onUploaded={() => {
              setShowUpload(false);
              loadDocuments();
            }}
          />
        )}

        {documents === null && !error && (
          <div className="mt-6">
            <LoadingState />
          </div>
        )}
        {documents?.length === 0 && (
          <div className="mt-6">
            <EmptyState label="No documents uploaded yet." />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3">
          {documents?.map((doc) => (
            <Card key={doc.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-text-primary">
                    {doc.name}{" "}
                    <span className="text-sm font-normal text-text-muted">
                      v{doc.version}
                    </span>
                  </p>
                  <p className="text-sm text-text-muted">
                    {doc.originalFileName}
                  </p>
                </div>
                <DocumentStatusBadge status={doc.status} />
              </div>
              {doc.status === "FAILED" && doc.processingError && (
                <p className="mt-2 text-sm text-danger">
                  {doc.processingError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  className="px-2.5 py-1 text-xs"
                  onClick={() =>
                    void downloadFile(
                      `/admin/documents/${doc.id}/file`,
                      doc.originalFileName,
                    )
                  }
                >
                  Download
                </Button>
                {(doc.status === "ACTIVE" || doc.status === "INACTIVE") && (
                  <Button
                    variant="secondary"
                    className="px-2.5 py-1 text-xs"
                    disabled={busyId === doc.id}
                    onClick={() => void toggleStatus(doc)}
                  >
                    {doc.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </Button>
                )}
                <UploadVersionButton
                  documentId={doc.id}
                  onUploaded={loadDocuments}
                />
              </div>
            </Card>
          ))}
        </div>
      </main>
    </>
  );
}

export default function DocumentsAdminPage() {
  return (
    <RoleGuard roles={["SUPER_ADMIN"]}>
      <DocumentsAdmin />
    </RoleGuard>
  );
}
