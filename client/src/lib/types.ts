/* Shared response types mirroring the API. */

export interface User {
  id: number;
  email: string;
  created_at: string;
}

export interface Project {
  id: number;
  user_id: number;
  name: string;
  vertical_id: string | null;
  business_model: string | null;
  current_phase: number;
  status: 'in_progress' | 'complete' | 'archived';
  is_seed: boolean;
  created_at: string;
  updated_at: string;
}

export type PhaseStatus =
  | 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'revising';

export interface Phase {
  phase_no: number;
  status: PhaseStatus;
  approved_at: string | null;
}

export interface PhaseMeta {
  phaseId: string;
  order: number;
  name: string;
  description: string;
  primaryDocument: string;
}

export interface Question {
  questionId: string;
  phaseId: string;
  order: number;
  text: string;
  type: 'text' | 'select' | 'multiselect' | 'number' | 'range';
  required: boolean;
  inDemoSet: boolean;
  helpText: string | null;
  feeds: string[];
  options?: string[];
  placeholder?: string;
  numeric?: { unit: string; min: number; max: number };
}

export interface Answer {
  question_id: string;
  phase_no: number;
  value_text: string | null;
  value_number: string | null;
  value_json: string[] | RangeValue | null;
  answered_at: string;
}

export interface RangeValue { min: number; max: number }
export type AnswerValue = string | number | string[] | RangeValue;

export interface UnvalidatedEntry {
  field: string;
  reason: string;
}

export interface Deliverable {
  id: number;
  doc_type: 'mrd' | 'prd' | 'business_plan';
  version: number;
  file_path: string | null;
  generated_at: string;
  unvalidated: UnvalidatedEntry[] | null;
}

export interface GenerationOutcome {
  version: number;
  documents: Array<{
    docType: Deliverable['doc_type'];
    filePath: string;
    sectionsGenerated: number;
    sectionsFailed: number;
    model: string;
    usedFallback: boolean;
  }>;
  unvalidated: UnvalidatedEntry[];
  provenance: {
    model: string;
    usedFallback: boolean;
    generatedAt: string;
    answersUsed: string[];
    benchmarksUsed: Array<{
      key: string; verticalId: string; value: number | null;
      confidence: string; publisher: string | null; url: string | null;
      isProxy: boolean; usedFallback: boolean; hasConflicts: boolean;
    }>;
    externalCalls: Array<{ source: string; detail: string; ok: boolean }>;
  };
}

/* ------------------------------------------------------------- envelopes --- */

export interface AuthResponse { user: User }
export interface ProjectListResponse { projects: Project[] }
export interface ProjectResponse { project: Project; phases: Phase[]; phaseMeta: PhaseMeta[] }

export interface PhaseDetailResponse {
  phase: Phase;
  meta: PhaseMeta | null;
  questions: Question[];
  answers: Answer[];
  canApprove: boolean;
}

export interface GateResponse {
  phases: Phase[];
  project: Project;
  approved?: number;
  nextPhase?: number | null;
  revising?: number;
}

export interface AnswersResponse { answers: Answer[]; phases?: Phase[] }
export interface DocumentListResponse { documents: Deliverable[] }

/* ---------------------------------------------------------------- labels --- */

export const DOC_TITLES: Record<Deliverable['doc_type'], string> = {
  mrd: 'Market Requirements Document',
  prd: 'Product Requirements Document',
  business_plan: 'Business Plan',
};

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  pending: 'Locked',
  in_progress: 'In progress',
  awaiting_approval: 'Ready to approve',
  approved: 'Approved',
  revising: 'Revising',
};
