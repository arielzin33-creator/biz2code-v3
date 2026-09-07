

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { keys } from './useProject';
import type { GateResponse, PhaseDetailResponse } from '../lib/types';

export function usePhase(projectId: number, phaseNo: number) {
  return useQuery({
    queryKey: keys.phase(projectId, phaseNo),
    queryFn: () => get<PhaseDetailResponse>(`/projects/${projectId}/phases/${phaseNo}`),
    enabled: projectId > 0 && phaseNo > 0,
  });
}


export function useApprovePhase(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phaseNo: number) =>
      post<GateResponse>(`/projects/${projectId}/phases/${phaseNo}/approve`),
    onSuccess: (_data, phaseNo) => {
      qc.invalidateQueries({ queryKey: keys.project(projectId) });
      qc.invalidateQueries({ queryKey: keys.phase(projectId, phaseNo) });
      qc.invalidateQueries({ queryKey: keys.phase(projectId, phaseNo + 1) });
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useRevisePhase(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phaseNo: number) =>
      post<GateResponse>(`/projects/${projectId}/phases/${phaseNo}/revise`),
    onSuccess: (_data, phaseNo) => {
      qc.invalidateQueries({ queryKey: keys.project(projectId) });
      qc.invalidateQueries({ queryKey: keys.phase(projectId, phaseNo) });
      qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}
