# ADR-002: Local-only deployment

## Context

The bootcamp's general instructions require a live deployment. The project owner has scoped
biz2code to run locally, and the deliverables are DOCX files downloaded to disk.

## Decision

The application runs on localhost via `npm run dev`. No container, no cloud target, no CI/CD.

## Alternative

A Render or Vercel deploy on a free tier gives a public URL, but costs a day of env-var and
DB-hosting work. Recorded here so the trade-off against a documented course requirement is
visible rather than accidental.

## Consequences

- No infra work, no secrets management, no cold starts.
- The demo depends on the presenter's laptop. Rehearse on the actual machine.
- Risk: if a live URL is graded, this decision costs marks. Confirm before Demo Day.
