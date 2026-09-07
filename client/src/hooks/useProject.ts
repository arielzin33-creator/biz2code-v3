

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import type { Project, ProjectListResponse, ProjectResponse } from '../lib/types';


export const keys = {
  projects: ['projects'] as const,
  project: (id: number) => ['project', id] as const,
  phase: (id: number, n: number) => ['phase', id, n] as const,
  answers: (id: number) => ['answers', id] as const,
  documents: (id: number) => ['documents', id] as const,
};


export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: () => get<ProjectListResponse>('/projects'),
    select: (r) => r.projects,
  });
}


export function useProject(projectId: number) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => get<ProjectResponse>(`/projects/${projectId}`),
    enabled: Number.isFinite(projectId) && projectId > 0,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; verticalId?: string | null }) =>
      post<{ project: Project }>('/projects', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}


export function useCreateSeedProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ project: Project }>('/projects/seed'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.projects }),
  });
}
