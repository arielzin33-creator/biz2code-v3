/* Renders generated sections into MRD_v1.docx / PRD_v1.docx / BusinessPlan_v1.docx. */

import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, ImageRun,
  Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, VerticalAlign, WidthType,
} from 'docx';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocTemplate } from '../prompts/documents';

export const OUTPUT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'outputs',
);

const BRAND = {
  name: 'biz2code',
  tagline: 'A Linear Gatekeeper for business-validated development',
  accent: '154F6B',      
  warning: 'A32D2D',     
  muted: '4E5A5F',       
};

export type SectionBlock =
  | { kind: 'prose'; text: string }
  | {
    kind: 'table';
    title: string;
    explanation: string;
    rows: { label: string; value: string; note: string | null }[];
  }
  | {
    kind: 'image';
    png: Buffer;
    widthPt: number;
    heightPt: number;
    caption: string;
  };

export interface RenderedSection {
  heading: string;
  body: string | null;
  blocks?: SectionBlock[];
  unvalidatedReason?: string;
}

export interface DocumentMeta {
  projectName: string;
  version: number;
  generatedAt: Date;
  model: string;
  usedFallback: boolean;
}

/* ------------------------------------------------------------ components --- */

const text = (value: string, opts: Partial<ConstructorParameters<typeof TextRun>[0]> = {}) =>
  new TextRun({ text: value, font: 'Calibri', ...opts as object });

function coverPage(template: DocTemplate, meta: DocumentMeta): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER,
      children: [text(BRAND.name, { size: 56, bold: true, color: BRAND.accent })] }),
    new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER,
      children: [text(BRAND.tagline, { size: 20, color: BRAND.muted, italics: true })] }),
    new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER,
      children: [text(template.title, { size: 40, bold: true })] }),
    new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
      children: [text(meta.projectName, { size: 28 })] }),
    new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER,
      children: [text(`Version ${meta.version}`, { size: 22, color: BRAND.muted })] }),
    new Paragraph({ alignment: AlignmentType.CENTER,
      children: [text(meta.generatedAt.toISOString().slice(0, 10), { size: 22, color: BRAND.muted })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function unvalidatedBlock(reason: string): Paragraph {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    shading: { type: ShadingType.CLEAR, fill: 'FCEBEB' },   
    border: {
      left: { style: BorderStyle.SINGLE, size: 18, color: BRAND.warning, space: 8 },
    },
    children: [
      text('UNVALIDATED  ', { bold: true, color: BRAND.warning, size: 18 }),
      text(reason, { color: BRAND.warning, size: 18 }),
    ],
  });
}

/* ------------------------------------------------------------- the blocks --- */

const cell = (children: Paragraph[], opts: { width: number; shaded?: boolean }) => new TableCell({
  children,
  width: { size: opts.width, type: WidthType.PERCENTAGE },
  verticalAlign: VerticalAlign.CENTER,
  margins: { top: 60, bottom: 60, left: 110, right: 110 },
  ...(opts.shaded
    ? { shading: { type: ShadingType.CLEAR, fill: 'F1F5F7' } }
    : {}),
});

interface CellTextOpts { bold?: boolean; italics?: boolean; color?: string; size?: number }

const cellText = (s: string, opts: CellTextOpts = {}) =>
  [new Paragraph({ children: [text(s, { size: 19, ...opts })] })];

const HAIRLINE = { style: BorderStyle.SINGLE, size: 2, color: 'D6DEE1' };

function figureTable(block: Extract<SectionBlock, { kind: 'table' }>): (Paragraph | Table)[] {
  const header = new TableRow({
    tableHeader: true,
    children: [
      cell(cellText('Figure', { bold: true, color: BRAND.accent }), { width: 34, shaded: true }),
      cell(cellText('Value', { bold: true, color: BRAND.accent }), { width: 22, shaded: true }),
      cell(cellText('Basis', { bold: true, color: BRAND.accent }), { width: 44, shaded: true }),
    ],
  });

  const rows = block.rows.map((r) => new TableRow({
    children: [
      cell(cellText(r.label), { width: 34 }),
      cell(cellText(r.value, {
        bold: true,
        color: r.value === 'unvalidated' ? BRAND.warning : undefined,
      }), { width: 22 }),
      cell(cellText(r.note ?? '—', { color: BRAND.muted, size: 17 }), { width: 44 }),
    ],
  }));

  return [
    new Paragraph({
      spacing: { before: 240, after: 40 },
      children: [text(block.title, { size: 21, bold: true, color: BRAND.accent })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [text(block.explanation, { size: 18, italics: true, color: BRAND.muted })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: HAIRLINE, bottom: HAIRLINE, left: HAIRLINE, right: HAIRLINE,
        insideHorizontal: HAIRLINE, insideVertical: HAIRLINE,
      },
      rows: [header, ...rows],
    }),
  ];
}

function chartBlock(block: Extract<SectionBlock, { kind: 'image' }>): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 260, after: 80 },
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type: 'png',
        data: block.png,
        transformation: { width: block.widthPt, height: block.heightPt },
      })],
    }),
    new Paragraph({
      spacing: { after: 200 },
      alignment: AlignmentType.CENTER,
      children: [text(block.caption, { size: 17, italics: true, color: BRAND.muted })],
    }),
  ];
}

function sectionParagraphs(section: RenderedSection): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 320, after: 120 },
      children: [text(section.heading, { size: 26, bold: true, color: BRAND.accent })],
    }),
  ];

  if (section.unvalidatedReason) out.push(unvalidatedBlock(section.unvalidatedReason));

  if (section.body) {
    for (const para of section.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
      out.push(new Paragraph({
        spacing: { after: 140, line: 300 },
        children: [text(para, { size: 22 })],
      }));
    }
  } else if (!section.blocks?.length) {
    out.push(new Paragraph({
      spacing: { after: 140 },
      children: [text('No content was generated for this section.', { size: 22, italics: true, color: BRAND.muted })],
    }));
  }

  for (const block of section.blocks ?? []) {
    if (block.kind === 'prose') {
      out.push(new Paragraph({
        spacing: { after: 140, line: 300 },
        children: [text(block.text, { size: 22 })],
      }));
    } else if (block.kind === 'table') {
      out.push(...figureTable(block));
    } else {
      out.push(...chartBlock(block));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ render --- */

export interface RenderRequest {
  template: DocTemplate;
  sections: RenderedSection[];
  meta: DocumentMeta;
  projectId: number;
}

export async function renderDocument(req: RenderRequest): Promise<string> {
  const { template, sections, meta, projectId } = req;

  const footerText =
    `${BRAND.name} · ${template.title} · v${meta.version} · ` +
    `generated ${meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · ` +
    `${meta.model}${meta.usedFallback ? ' (fallback)' : ''}`;

  const doc = new Document({
    creator: BRAND.name,
    title: `${template.title} — ${meta.projectName}`,
    description: `Version ${meta.version}`,
    sections: [{
      properties: {},
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [text(footerText, { size: 16, color: BRAND.muted })],
          })],
        }),
      },
      children: [
        ...coverPage(template, meta),
        ...sections.flatMap(sectionParagraphs),
      ],
    }],
  });

  const dir = join(OUTPUT_ROOT, String(projectId));
  await mkdir(dir, { recursive: true });

  const fileName = `${template.fileStem}_v${meta.version}.docx`;
  await writeFile(join(dir, fileName), await Packer.toBuffer(doc));

  return join('outputs', String(projectId), fileName).replace(/\\/g, '/');
}

export const absolutePathFor = (relative: string): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', relative);
