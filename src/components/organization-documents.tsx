"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

 type PrivateDocument = {
  id: string;
  name: string;
  documentType: string;
  contentType: string;
  byteSize: number;
  scanStatus: string;
  createdAt: string;
  expiresAt: string | null;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrganizationDocuments({ organizationId, readOnly = false }: { organizationId: string; readOnly?: boolean }) {
  const [documents, setDocuments] = useState<PrivateDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const reload = useCallback(async () => {
    const response = await fetch(`/api/organizations/${organizationId}/documents`, { cache: "no-store" });
    const result = await response.json() as PrivateDocument[] | { error?: { message?: string } };
    if (!response.ok || !Array.isArray(result)) throw new Error((result as { error?: { message?: string } }).error?.message ?? "Evidence could not be loaded.");
    setDocuments(result);
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(reload)
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Evidence could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, refreshKey]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage(""); setUploading(true);
    const formElement = event.currentTarget;
    try {
      const form = new FormData(formElement);
      const response = await fetch(`/api/organizations/${organizationId}/documents`, { method: "POST", body: form, cache: "no-store" });
      const result = await response.json() as { error?: { message?: string }; scanStatus?: string };
      if (!response.ok) throw new Error(result.error?.message ?? "The evidence could not be uploaded.");
      setMessage(result.scanStatus === "clean" ? "Evidence uploaded and malware scan passed. A reviewer can now inspect it." : "Evidence is stored privately but has not been malware-scanned. It cannot be downloaded until the configured scanner clears it.");
      formElement.reset();
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The evidence could not be uploaded. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return <details className="document-details">
    <summary>Private review evidence</summary>
    <div className="document-panel">
      <p className="form-hint">Files are private to authorised organisation reviewers and staff. PDF, PNG or JPEG only; maximum 8 MB. Do not upload unnecessary identity or sensitive personal information.</p>
      {!readOnly && <form className="form-stack" onSubmit={upload}>
        <div className="form-field"><label htmlFor={`document-type-${organizationId}`}>Document category</label><select className="form-control" id={`document-type-${organizationId}`} name="documentType" required defaultValue="verification_record"><option value="verification_record">Registration or verification record</option><option value="authorisation_letter">Authorisation letter</option><option value="operating_address">Operating address evidence</option><option value="capacity_evidence">Capacity evidence</option><option value="other">Other relevant evidence</option></select></div>
        <div className="form-field"><label htmlFor={`document-file-${organizationId}`}>Choose a file</label><input className="form-control file-control" id={`document-file-${organizationId}`} name="file" type="file" accept="application/pdf,image/png,image/jpeg" required /></div>
        <button className="button button--secondary button--small" type="submit" disabled={uploading}>{uploading ? "Scanning and uploading…" : "Upload privately"}</button>
      </form>}
      {readOnly && <p className="form-hint">Reviewer view: evidence is read-only. A completed malware scan is required before download.</p>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      {message && <div className="auth-status" role="status">{message}</div>}
      {loading ? <div className="skeleton" style={{ height: 50, marginTop: 12 }} aria-busy="true" /> : documents.length ? <div className="document-list">{documents.map((document) => <div className="document-item" key={document.id}><div><strong>{document.name}</strong><small>{document.documentType.replaceAll("_", " ")} · {formatSize(document.byteSize)} · {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(document.createdAt))}</small></div><span className={`status-pill status-pill--${document.scanStatus}`}>{document.scanStatus === "clean" ? "scan passed" : document.scanStatus}</span>{document.scanStatus === "clean" && <a className="app-card-link" href={`/api/documents/${document.id}`}>Download</a>}</div>)}</div> : <div className="empty-state"><div><strong>No evidence uploaded</strong><p>Uploads remain private and are attached to this organisation review.</p></div></div>}
    </div>
  </details>;
}
