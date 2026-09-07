#!/usr/bin/env python3
"""
Enforces the biz2code benchmark honesty contract.
Run in CI. Exit code 1 = a rule was broken.

Rules
  1. Every metric has value, unit, confidence, source.
  2. confidence is one of primary | secondary | tertiary | placeholder.
  3. confidence == "placeholder"  =>  value MUST be null.   (no invented numbers)
  4. confidence != "placeholder"  =>  value MUST NOT be null,
                                      AND source.publisher MUST be set.
  5. Percent metrics fall within 0..100.
  6. Every vertical named in taxonomy.json has a matching file.
"""
import json, pathlib, sys

HERE = pathlib.Path(__file__).parent
errors, warnings = [], []


def load(p):
    return json.loads((HERE / p).read_text())


taxonomy = load("taxonomy.json")

for vid, meta in taxonomy["verticals"].items():
    path = HERE / meta["file"]
    if not path.exists():
        errors.append(f"{vid}: missing file {meta['file']}")
        continue

    doc = json.loads(path.read_text())
    for key, mt in doc.get("metrics", {}).items():
        where = f"{meta['file']}::{key}"

        for field in ("value", "unit", "confidence", "source"):
            if field not in mt:
                errors.append(f"{where}: missing '{field}'")
        if errors and where in errors[-1]:
            continue

        conf = mt.get("confidence")
        if conf not in ("primary", "secondary", "tertiary", "placeholder"):
            errors.append(f"{where}: bad confidence '{conf}'")
            continue

        if conf == "placeholder":
            if mt.get("value") is not None:
                errors.append(
                    f"{where}: RULE 3 VIOLATION - placeholder carries a value "
                    f"({mt['value']}). A placeholder must never invent a number.")
        else:
            if mt.get("value") is None:
                errors.append(f"{where}: confidence '{conf}' but value is null")
            if not (mt.get("source") or {}).get("publisher"):
                errors.append(f"{where}: confidence '{conf}' but no source.publisher")

        v = mt.get("value")
        if v is not None and mt.get("unit") == "percent" and not (0 <= v <= 100):
            errors.append(f"{where}: percent out of range ({v})")

    cov = doc.get("coverage", {})
    if cov.get("metricsSourced") == 0:
        warnings.append(
            f"{vid}: zero sourced metrics - every figure will render as 'unvalidated'")
    if cov.get("metricsProxy"):
        warnings.append(
            f"{vid}: {cov['metricsProxy']} PROXY metric(s) borrowed from an adjacent "
            f"vertical - must be labelled as a proxy in output")
    if cov.get("metricsWithConflicts"):
        warnings.append(
            f"{vid}: {cov['metricsWithConflicts']} metric(s) have CONFLICTING published "
            f"sources - output must surface the disagreement, not just the chosen value")

print(f"checked {len(taxonomy['verticals'])} verticals")
for w in warnings:
    print(f"  WARN  {w}")
for e in errors:
    print(f"  ERROR {e}")
print(f"\n{len(errors)} errors, {len(warnings)} warnings")
sys.exit(1 if errors else 0)
