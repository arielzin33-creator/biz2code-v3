

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { keys } from './useProject';
import type { DocumentListResponse, GenerationOutcome } from '../lib/types';

export function useDocuments(projectId: number) {
  return useQuery({
    queryKey: keys.documents(projectId),
    queryFn: () => get<DocumentListResponse>(`/projects/${projectId}/documents`),
    select: (r) => r.documents,
    enabled: projectId > 0,
  });
}


/*
  Measured end to end in the browser at 126-192s across runs, three documents
  written one after another. It read 70s, and the surrounding copy asks the
  user to leave the page open — an estimate less than half the real wait
  invites them to give up on a run that is working.
 */
export const GENERATION_SECONDS = 180;

export function useGenerateDocuments(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<GenerationOutcome>(`/projects/${projectId}/documents/generate`),
    retry: false,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.documents(projectId) });
      qc.invalidateQueries({ queryKey: keys.project(projectId) });
    },
  });
}
