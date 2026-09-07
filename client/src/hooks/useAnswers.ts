

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { post } from '../lib/api';
import { keys } from './useProject';
import type { AnswerValue, AnswersResponse } from '../lib/types';


export function useSaveAnswer(projectId: number, phaseNo: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { questionId: string; value: AnswerValue }) =>
      post<AnswersResponse>(`/projects/${projectId}/answers`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.phase(projectId, phaseNo) });
      qc.invalidateQueries({ queryKey: keys.project(projectId) });
    },
  });
}
