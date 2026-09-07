/* Orchestrates MRD -> PRD -> Business Plan, then renders DOCX. */

import { query, queryOne, transaction } from '../db/query';
import { AppError } from '../middleware/error';
import { getAnswers, type AnswerRow } from './answer.service';
import { calculate, inputsFromAnswers } from './calculation.service';
import { derive } from './derivation.service';
import { buildDerivationInputs } from './derivationInputs.service';

const COUNTRY_QUESTION = 'p2q2';      
const COMPETITOR_QUESTION = 'p2q4';   
import { generateJson, MODELS, type Attempt, type LlmResult } from './llm.service';
import { renderDocument, type RenderedSection, type SectionBlock } from './docx.service';
import { worldBankIndicator, itunesSearch, resolveCountry } from './external.service';
import { competitorSearchTerms } from './competitorTerms';
import type { WorldBankResult, ItunesApp } from './external.service';
import { getPhases } from './questionBank.service';
import { TEMPLATES, GENERATION_ORDER, type DocType, type DocTemplate } from '../prompts/documents';
import type { GenerationContext } from '../prompts/context';
import { keyFigureBlocks } from '../prompts/figures';

export { GENERATION_ORDER };
export type { DocType };

/* ------------------------------------------------------- provenance ledger --- */

export interface FieldProvenance {
  field: string;              
  generatedBy: string;        
  usedFallback: boolean;
  unvalidated: boolean;
  unvalidatedReason: string | null;
}

export interface Provenance {
  generatedAt: string;
  answersUsed: string[];
  benchmarksUsed: Array<{
    key: string; verticalId: string; value: number | null;
    confidence: string; publisher: string | null; url: string | null;
    isProxy: boolean; usedFallback: boolean; hasConflicts: boolean;
  }>;
  externalCalls: Array<{ source: string; detail: string; ok: boolean }>;
  computed: Array<{ figure: string; value: number | null; unit: string; confidence: string; inputs: string[] }>;
  fields: FieldProvenance[];
  llmAttempts: Array<{ docType: DocType; attempts: Attempt[] }>;
  model: string;
  usedFallback: boolean;
  escalations: Array<{ model: string; failed: DocType[] }>;
}

export interface UnvalidatedEntry { field: string; reason: string }

export interface GenerationOutcome {
  version: number;
  documents: Array<{
    docType: DocType;
    filePath: string;
    sectionsGenerated: number;
    sectionsFailed: number;
    model: string;
    usedFallback: boolean;
  }>;
  unvalidated: UnvalidatedEntry[];
  provenance: Provenance;
}

/* ------------------------------------------------------------ preparation --- */

interface ProjectRow {
  id: number; name: string; vertical_id: string | null;
  business_model: string | null; current_phase: number; status: string;
}

async function assertAllPhasesApproved(projectId: number) {
  const phaseCount = getPhases().length;
  const approved = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM phases WHERE project_id = $1 AND status = 'approved'`,
    [projectId],
  );
  if (Number(approved?.n ?? 0) !== phaseCount)
    throw new AppError(
      `All ${phaseCount} phases must be approved before documents can be generated`, 409);
}

async function gatherExternal(answers: AnswerRow[], fallbackTerm: string) {
  const calls: Provenance['externalCalls'] = [];

  const statedCountry = answers.find((a) => a.question_id === COUNTRY_QUESTION)?.value_text ?? null;
  const resolved = await resolveCountry(statedCountry);
  calls.push({
    source: 'worldbank',
    detail: resolved
      ? `resolved "${statedCountry}" to ${resolved.iso3}`
      : `could not resolve "${statedCountry ?? '(unanswered)'}" — using the world aggregate`,
    ok: resolved !== null,
  });

  const wbCountry = resolved?.iso3 ?? 'WLD';
  const storefront = resolved?.iso2 ?? 'US';

  const worldBank: WorldBankResult[] = [];
  for (const indicator of ['SP.POP.TOTL', 'IT.NET.USER.ZS']) {
    const result = await worldBankIndicator(wbCountry, indicator);
    calls.push({ source: 'worldbank', detail: `${wbCountry}/${indicator}`, ok: result !== null });
    if (result) worldBank.push(result);
  }

  const terms = competitorSearchTerms(
    answers.find((a) => a.question_id === COMPETITOR_QUESTION)?.value_text,
  );
  const searchTerms = terms.length ? terms : [fallbackTerm];

  const itunes: ItunesApp[] = [];
  const seenApps = new Set<string>();
  for (const term of searchTerms) {
    const found = await itunesSearch(term, storefront, 5);
    calls.push({ source: 'itunes', detail: `${term}/${storefront}`, ok: found.length > 0 });
    for (const app of found) {
      if (seenApps.has(app.trackName)) continue;
      seenApps.add(app.trackName);
      itunes.push(app);
    }
  }

  return {
    external: { worldBank, itunes, country: resolved, statedCountry },
    calls,
  };
}

async function nextVersion(projectId: number): Promise<number> {
  const row = await queryOne<{ max: number | null }>(
    'SELECT MAX(version) AS max FROM deliverables WHERE project_id = $1', [projectId],
  );
  return (row?.max ?? 0) + 1;
}

/* ------------------------------------------------------ one document, once --- */

interface DocumentResult {
  docType: DocType;
  filePath: string;
  content: Record<string, unknown>;
  sections: RenderedSection[];
  fields: FieldProvenance[];
  unvalidated: UnvalidatedEntry[];
  attempts: Attempt[];
  model: string;
  usedFallback: boolean;
  generated: number;
  failed: number;
}

interface DraftedDocument {
  template: DocTemplate;
  result: LlmResult<Record<string, unknown>>;
  keyFigures: SectionBlock[];
}

async function draftDocument(
  template: DocTemplate, ctx: GenerationContext, pinnedModel: string,
): Promise<DraftedDocument> {
  const { systemPrompt, userPrompt, requiredKeys } = template.build(ctx);
  const result = await generateJson<Record<string, unknown>>({
    systemPrompt, userPrompt, requiredKeys,
    label: template.docType,
    maxTokens: template.maxTokens,
    pinnedModel,
  });
  return { template, result, keyFigures: keyFigureBlocks(ctx.calculations, ctx.derivation) };
}

async function renderDraft(
  draft: DraftedDocument, projectName: string,
  projectId: number, version: number, setModel: string, setUsedFallback: boolean,
): Promise<DocumentResult> {
  const { template, result, keyFigures } = draft;
  const model = result.ok ? setModel : 'not generated';
  const usedFallback = setUsedFallback;
  const content = result.ok && result.data ? result.data : {};

  const modelFlagged = new Set(
    Array.isArray(content.unvalidated_fields)
      ? (content.unvalidated_fields as unknown[]).map(String)
      : [],
  );

  const sections: RenderedSection[] = [{
    heading: 'Key Figures',
    body: null,
    blocks: keyFigures,
  }];
  const fields: FieldProvenance[] = [];
  const unvalidated: UnvalidatedEntry[] = [];
  let generated = 0;
  let failed = 0;

  for (const field of template.fields) {
    const raw = content[field.key];
    const body = typeof raw === 'string' && raw.trim() ? raw.trim() : null;

    let reason: string | null = null;
    if (!result.ok) {
      reason = `Generation failed for this document. ${result.failureReason ?? ''}`.trim();
    } else if (!body) {
      reason = 'The model returned no content for this field.';
    } else if (modelFlagged.has(field.key)) {
      reason = 'The model reported that it could not fully source this field from the approved data.';
    }

    if (body) generated += 1; else failed += 1;
    if (reason) unvalidated.push({ field: field.path, reason });

    sections.push({
      heading: field.heading,
      body,
      ...(reason ? { unvalidatedReason: reason } : {}),
    });
    fields.push({
      field: field.path,
      generatedBy: body ? model : 'not generated',
      usedFallback,
      unvalidated: reason !== null,
      unvalidatedReason: reason,
    });
  }

  const filePath = await renderDocument({
    template, sections, projectId,
    meta: {
      projectName,
      version,
      generatedAt: new Date(),
      model,
      usedFallback,
    },
  });

  return {
    docType: template.docType, filePath, content, sections, fields, unvalidated,
    attempts: result.attempts ?? [], model, usedFallback, generated, failed,
  };
}

/* ------------------------------------------------------------ the pipeline --- */

export async function generateAll(projectId: number): Promise<GenerationOutcome> {
  const project = await queryOne<ProjectRow>('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (!project) throw new AppError('Project not found', 404);
  await assertAllPhasesApproved(projectId);

  const answers = await getAnswers(projectId);

  const fallbackTerm = project.name.slice(0, 40);
  const { external, calls } = await gatherExternal(answers, fallbackTerm);

  const derivation = derive(
    await buildDerivationInputs(project.vertical_id ?? '', answers, external));
  const calculations = calculate({
    ...inputsFromAnswers(project.vertical_id ?? '', answers),
    derivedPayers: derivation.somPayers,
    derivedLifetimeMonths: derivation.impliedLifetimeMonths,
    derivedCac: derivation.costPerPayingCustomer,
  });

  const version = await nextVersion(projectId);
  const baseContext: GenerationContext = {
    project: {
      name: project.name,
      verticalId: project.vertical_id,
      businessModel: project.business_model,
    },
    answers, calculations, derivation, external,
  };

  const MODEL_LADDER = [MODELS.GROQ_MODEL, MODELS.GROQ_FALLBACK_MODEL, MODELS.GEMINI_MODEL];

  const draftSet = async (model: string): Promise<DraftedDocument[]> => {
    const drafts: DraftedDocument[] = [];
    for (const docType of GENERATION_ORDER) {
      const priorContent = (t: DocType) => {
        const d = drafts.find((x) => x.template.docType === t);
        return d?.result.ok && d.result.data ? d.result.data : {};
      };
      const ctx: GenerationContext =
        docType === 'business_plan'
          ? { ...baseContext, priorDocuments: { mrd: priorContent('mrd'), prd: priorContent('prd') } }
          : baseContext;
      drafts.push(await draftDocument(TEMPLATES[docType], ctx, model));
    }
    return drafts;
  };

  let drafts: DraftedDocument[] = [];
  let setModel = MODEL_LADDER[0] as string;
  const escalations: Array<{ model: string; failed: DocType[] }> = [];

  for (const model of MODEL_LADDER) {
    setModel = model;
    drafts = await draftSet(model);
    const failed = drafts.filter((d) => !d.result.ok).map((d) => d.template.docType);
    if (failed.length === 0) break;
    escalations.push({ model, failed });
  }

  const setUsedFallback = setModel !== MODEL_LADDER[0];

  const results: DocumentResult[] = [];
  for (const draft of drafts) {
    results.push(await renderDraft(
      draft, project.name, projectId, version, setModel, setUsedFallback));
  }

  const provenance: Provenance = {
    generatedAt: new Date().toISOString(),
    answersUsed: answers.map((a) => a.question_id),
    benchmarksUsed: Object.entries(calculations.benchmarksUsed).map(([key, m]) => ({
      key,
      verticalId: m.verticalId,
      value: m.value,
      confidence: m.confidence,
      publisher: m.source.publisher,
      url: m.source.url,
      isProxy: m.isProxy,
      usedFallback: m.usedFallback,
      hasConflicts: Boolean(m.conflicts?.length),
    })),
    externalCalls: calls,
    computed: Object.entries(calculations)
      .filter(([k]) => k !== 'comparisons' && k !== 'benchmarksUsed')
      .map(([figure, c]) => {
        const v = c as { value: number | null; unit: string; confidence: string; inputs: string[] };
        return { figure, value: v.value, unit: v.unit, confidence: v.confidence, inputs: v.inputs };
      }),
    fields: results.flatMap((r) => r.fields),
    llmAttempts: results.map((r) => ({ docType: r.docType, attempts: r.attempts })),
    model: setModel,
    usedFallback: setUsedFallback,
    escalations,
  };

  const unvalidated = results.flatMap((r) => r.unvalidated);

  await transaction(async (q) => {
    for (const r of results) {
      await q(
        `INSERT INTO deliverables (project_id, doc_type, version, content_json, file_path, provenance, unvalidated)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [projectId, r.docType, version, JSON.stringify(r.content), r.filePath,
         JSON.stringify(provenance), JSON.stringify(r.unvalidated)],
      );
    }
  });

  return {
    version,
    documents: results.map((r) => ({
      docType: r.docType,
      filePath: r.filePath,
      sectionsGenerated: r.generated,
      sectionsFailed: r.failed,
      model: r.model,
      usedFallback: r.usedFallback,
    })),
    unvalidated,
    provenance,
  };
}

/* ------------------------------------------------------------------ reads --- */

export interface DeliverableRow {
  id: number; doc_type: DocType; version: number;
  file_path: string | null; generated_at: string;
  unvalidated: UnvalidatedEntry[] | null;
}

export async function listDeliverables(projectId: number): Promise<DeliverableRow[]> {
  return query<DeliverableRow>(
    `SELECT id, doc_type, version, file_path, generated_at, unvalidated
     FROM deliverables WHERE project_id = $1
     ORDER BY version DESC, doc_type`, [projectId],
  );
}

export async function getDeliverable(projectId: number, id: number): Promise<DeliverableRow> {
  const row = await queryOne<DeliverableRow>(
    `SELECT id, doc_type, version, file_path, generated_at, unvalidated
     FROM deliverables WHERE project_id = $1 AND id = $2`, [projectId, id],
  );
  if (!row) throw new AppError('Document not found', 404);
  return row;
}
