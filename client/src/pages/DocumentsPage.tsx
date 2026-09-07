/* Generated documents: list, versions, download. */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useProject } from '../hooks/useProject';
import { GENERATION_SECONDS, useDocuments, useGenerateDocuments } from '../hooks/useDocuments';
import { UnvalidatedBadge, kindFromReason } from '../components/UnvalidatedBadge';
import { ApiError, downloadUrl } from '../lib/api';
import { DOC_TITLES, type Deliverable } from '../lib/types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

export function DocumentsPage() {
  const projectId = Number(useParams().projectId);
  const project = useProject(projectId);
  const documents = useDocuments(projectId);
  const generate = useGenerateDocuments(projectId);
  const [error, setError] = useState<string | null>(null);

  const allApproved = project.data?.phases.every((p) => p.status === 'approved') ?? false;

  async function run() {
    setError(null);
    try { await generate.mutateAsync(); }
    catch (err) {
      setError(err instanceof ApiError ? err.message : 'Generation failed.');
    }
  }

  const byVersion = new Map<number, Deliverable[]>();
  for (const doc of documents.data ?? []) {
    byVersion.set(doc.version, [...(byVersion.get(doc.version) ?? []), doc]);
  }
  const versions = [...byVersion.keys()].sort((a, b) => b - a);

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '28px 20px 72px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <Link to={`/projects/${projectId}/phase/1`} style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to the phases
        </Link>
        <h1
          style={{
            margin: '8px 0 6px',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'var(--text-h2-size)',
            letterSpacing: 'var(--text-h2-ls)',
            color: 'var(--text-primary)',
          }}
        >
          Documents
        </h1>
        <p style={{ margin: '0 0 24px', color: 'var(--text-secondary)', fontSize: 14 }}>
          {project.data?.project.name}
        </p>

        <Card style={{ marginBottom: 28 }}>
          {!allApproved ? (
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
              All four phases must be approved before documents can be generated.{' '}
              <Link
                to={`/projects/${projectId}/phase/${project.data?.project.current_phase ?? 1}`}
                style={{ color: 'var(--text-link)', fontWeight: 600 }}
              >
                Continue where you left off →
              </Link>
            </p>
          ) : (
            <>
              <Button type="button" onClick={run} disabled={generate.isPending} loading={generate.isPending}>
                {generate.isPending
                  ? 'Writing your documents…'
                  : versions.length ? 'Generate a new version' : 'Generate the documents'}
              </Button>

              {}
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {generate.isPending
                  ? `This takes about ${GENERATION_SECONDS} seconds. The three documents are written by one model, one after another, so they read in a single voice — please leave this page open.`
                  : `Takes about ${GENERATION_SECONDS} seconds. Your previous versions are kept.`}
              </p>

              {generate.isPending && (
                <div aria-hidden style={{
                  marginTop: 14, height: 3, borderRadius: 2, overflow: 'hidden',
                  background: 'var(--n-100)',
                }}>
                  <div style={{
                    height: '100%', width: '35%', background: 'var(--cyan-500)',
                    animation: 'b2c-slide 1.4s ease-in-out infinite',
                  }} />
                </div>
              )}

              {error && (
                <p role="alert" style={{ margin: '14px 0 0', color: 'var(--danger-text)', fontSize: 13.5 }}>{error}</p>
              )}

              {generate.data && (
                <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Version {generate.data.version} written by{' '}
                  <code style={{ color: 'var(--text-primary)' }}>{generate.data.provenance.model}</code>
                  {generate.data.provenance.usedFallback && ' (fallback model)'} ·{' '}
                  {generate.data.unvalidated.length} field
                  {generate.data.unvalidated.length === 1 ? '' : 's'} could not be fully sourced.
                </p>
              )}
            </>
          )}
        </Card>

        {documents.isLoading && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading documents…</p>}
        {allApproved && versions.length === 0 && !documents.isLoading && !generate.isPending && (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Nothing generated yet.</p>
        )}

        {versions.map((version, index) => (
          <section key={version} style={{ marginBottom: 30 }}>
            <h2
              style={{
                margin: '0 0 12px',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 17,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              Version {version}
              {index === 0 && versions.length > 1 && <Badge tone="success">Latest</Badge>}
            </h2>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {byVersion.get(version)?.map((doc) => (
                <li key={doc.id}>
                  <Card style={{ padding: 18 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {DOC_TITLES[doc.doc_type]}
                        </strong>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                          {new Date(doc.generated_at).toLocaleString()}
                        </div>
                      </div>
                      {doc.file_path && (
                        <a
                          href={downloadUrl(projectId, doc.id)}
                          download
                          style={{
                            alignSelf: 'center',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-pill)',
                            border: '1.5px solid var(--border-subtle)',
                            color: 'var(--navy-700)',
                            fontFamily: 'var(--font-ui)',
                            fontSize: 13.5,
                            fontWeight: 600,
                            textDecoration: 'none',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Download size={14} /> Download .docx
                        </a>
                      )}
                    </div>

                    {}
                    {doc.unvalidated && doc.unvalidated.length > 0 && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                          {doc.unvalidated.length} field{doc.unvalidated.length === 1 ? '' : 's'} could not be
                          fully sourced. They appear in the document with this marker, not omitted.
                        </p>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                          {doc.unvalidated.map((entry) => (
                            <li key={entry.field}>
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
                                {entry.field}
                              </div>
                              <UnvalidatedBadge kind={kindFromReason(entry.reason)} reason={entry.reason} expanded />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
