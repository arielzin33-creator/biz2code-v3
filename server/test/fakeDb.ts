

export interface FakeProject {
  id: number;
  current_phase: number;
  status: 'in_progress' | 'complete' | 'archived';
}

export interface FakePhase {
  phase_no: number;
  status: 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'revising';
  approved_at: string | null;
}

export interface FakeAnswer { question_id: string; phase_no: number }


export const db = {
  project: null as FakeProject | null,
  phases: [] as FakePhase[],
  answers: [] as FakeAnswer[],
};

const APPROVED_AT = '2026-08-22T00:00:00.000Z';   

interface SetupOptions {
  currentPhase?: number;
  status?: FakeProject['status'];
  phases?: Partial<Record<number, FakePhase['status']>>;
  answers?: FakeAnswer[];
}


export function reset(opts: SetupOptions = {}) {
  const currentPhase = opts.currentPhase ?? 1;
  db.project = { id: 1, current_phase: currentPhase, status: opts.status ?? 'in_progress' };
  db.phases = [1, 2, 3, 4].map((n) => {
    const status = opts.phases?.[n]
      ?? (n < currentPhase ? 'approved' : n === currentPhase ? 'in_progress' : 'pending');
    return { phase_no: n, status, approved_at: status === 'approved' ? APPROVED_AT : null };
  });
  db.answers = opts.answers ?? [];
}

export const phase = (n: number): FakePhase => {
  const p = db.phases.find((x) => x.phase_no === n);
  if (!p) throw new Error(`no phase ${n} in the fake db`);
  return p;
};

export const project = (): FakeProject => {
  if (!db.project) throw new Error('fake db not reset()');
  return db.project;
};

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();


export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const s = norm(sql);
  const p = project();
  const n = (i: number) => Number(params[i]);

  // ---------------------------------------------------------------- reads ---
  if (s.startsWith('SELECT question_id FROM answers'))
    return db.answers.filter((a) => a.phase_no === n(1)).map((a) => ({ question_id: a.question_id })) as T[];

  if (s.startsWith('SELECT status FROM phases'))
    return [{ status: phase(n(1)).status }] as T[];

  if (s.startsWith('SELECT phase_no FROM phases'))
    return db.phases
      .filter((x) => x.phase_no < n(1) && x.status !== 'approved')
      .sort((a, b) => a.phase_no - b.phase_no)
      .slice(0, 1)
      .map((x) => ({ phase_no: x.phase_no })) as T[];

  if (s.startsWith('SELECT current_phase FROM projects')) return [{ current_phase: p.current_phase }] as T[];
  if (s.startsWith('SELECT * FROM projects')) return [{ ...p }] as T[];

  // -------------------------------------------------------------- phases ---
  if (s.startsWith("UPDATE phases SET status = $3")) {
    phase(n(1)).status = String(params[2]) as FakePhase['status'];
    return [] as T[];
  }
  if (s.startsWith("UPDATE phases SET status = 'approved'")) {
    const target = phase(n(1));
    target.status = 'approved';
    target.approved_at = APPROVED_AT;
    return [] as T[];
  }
  if (s.startsWith("UPDATE phases SET status = 'in_progress'")) {
    const target = phase(n(1));
    if (!s.includes("status = 'pending'") || target.status === 'pending') target.status = 'in_progress';
    return [] as T[];
  }
  if (s.startsWith("UPDATE phases SET status = 'revising'")) {
    const target = db.phases.find((x) => x.phase_no === n(1));
    if (!target) return [] as T[];
    target.status = 'revising';
    target.approved_at = null;
    return [{ phase_no: target.phase_no }] as T[];
  }

  // ------------------------------------------------------------ projects ---
  if (s.startsWith('UPDATE projects SET current_phase = GREATEST')) {
    p.current_phase = Math.max(p.current_phase, n(1));
    return [] as T[];
  }
  if (s.startsWith('UPDATE projects SET status = CASE WHEN')) {
    if (p.status !== 'archived') {
      const approved = db.phases.filter((x) => x.status === 'approved').length;
      p.status = approved === n(1) ? 'complete' : 'in_progress';
    }
    return [] as T[];
  }
  if (s.startsWith("UPDATE projects SET status = 'in_progress'")) {
    if (p.status === 'complete') p.status = 'in_progress';
    return [] as T[];
  }

  throw new Error(`fakeDb has no rule for: ${s}`);
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(sql, params))[0] ?? null;
}


export async function transaction<T>(fn: (q: typeof query) => Promise<T>): Promise<T> {
  return fn(query);
}
