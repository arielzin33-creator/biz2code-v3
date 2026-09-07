# ADR-001: Monolithic Node/Express backend over a split service topology

## Context

biz2code must ship in one week, built by a single developer using React and TypeScript at the
same time.

## Decision

A single Node.js + Express + TypeScript process serves the API, calls the LLM, runs the
calculation layer and renders DOCX files.

## Alternative

Node API + Python LLM service. Better long-term separation, but two runtimes, two dependency
sets and an inter-service contract to maintain. A one-week, single-user, local-only build cannot
spend that; every integration surface removed is a day not lost to debugging.

## Consequences

- One process, one language, one command to run.
- If LLM work later needs Python-only libraries, extraction is required.
- Revisit if the project continues past the capstone.
