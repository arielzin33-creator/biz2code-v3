/* Project list plus the New Project button. */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useCreateProject, useCreateSeedProject, useProjects } from '../hooks/useProject';
import { ApiError } from '../lib/api';
import type { Project } from '../lib/types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

const STATUS_TONE: Record<Project['status'], 'info' | 'success' | 'neutral'> = {
  in_progress: 'info',
  complete: 'success',
  archived: 'neutral',
};

const STATUS_LABEL: Record<Project['status'], string> = {
  in_progress: 'In progress',
  complete: 'Complete',
  archived: 'Archived',
};

export function ProjectsPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const createSeed = useCreateSeedProject();

  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      const { project } = await createProject.mutateAsync({ name });
      navigate(`/projects/${project.id}/phase/1`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not create the project.');
    }
  }

  async function startFromSeed() {
    setFormError(null);
    try {
      const { project } = await createSeed.mutateAsync();
      navigate(`/projects/${project.id}/phase/1`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not load the example project.');
    }
  }

  const busy = createProject.isPending || createSeed.isPending;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 28 }}>
      <div style={{ maxWidth: 'var(--container-max)', margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <h1
            style={{
              margin: '0 0 4px',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 'var(--text-h1-size)',
              letterSpacing: 'var(--text-h1-ls)',
              color: 'var(--text-primary)',
            }}
          >
            Your projects
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
            Pick a project to continue, or start something new.
          </p>
        </header>

        <Card title="Start something new" style={{ marginBottom: 28 }}>
          <form onSubmit={create} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <input
              aria-label="Project name"
              placeholder="What are you building?"
              value={name}
              required
              onChange={(e) => setName(e.target.value)}
              style={{
                flex: '1 1 260px',
                padding: '13px 14px',
                borderRadius: 'var(--radius-control)',
                border: '1.5px solid var(--control-border)',
                background: 'var(--control-bg)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
              }}
            />
            <Button type="submit" disabled={busy} loading={createProject.isPending}>
              New project
            </Button>
          </form>

          {}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              iconLeft={<Sparkles size={14} />}
              onClick={startFromSeed}
              disabled={busy}
              loading={createSeed.isPending}
            >
              Start from the example project
            </Button>
            <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              An indoor-navigation app with 16 of its 21 answers already filled in — the
              remaining five are the ones worth typing yourself.
            </p>
          </div>

          {formError && (
            <p role="alert" style={{ marginTop: 14, marginBottom: 0, color: 'var(--danger-text)', fontSize: 13.5 }}>
              {formError}
            </p>
          )}
        </Card>

        {isLoading && <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading your projects…</p>}
        {error && <p style={{ color: 'var(--danger-text)', fontSize: 14 }}>Could not load your projects.</p>}

        {projects && projects.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No projects yet. Create one above to begin.</p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {projects?.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}/phase/${project.current_phase}`} style={{ textDecoration: 'none', display: 'block' }}>
                <Card interactive style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                    <span style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          display: 'block',
                          fontFamily: 'var(--font-ui)',
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {project.name}
                      </strong>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {project.vertical_id ?? 'no category'} · phase {project.current_phase} of 4
                        {project.is_seed && ' · example'}
                      </span>
                    </span>
                    <Badge tone={STATUS_TONE[project.status]} dot>
                      {STATUS_LABEL[project.status]}
                    </Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
