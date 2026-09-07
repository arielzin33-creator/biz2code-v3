# ADR-005: JWT in an httpOnly cookie, single-user, no roles


## Context

biz2code runs locally for one user. Multi-tenancy would add a day of work and a whole class of
isolation bugs for no MVP benefit.

## Decision

One `users` table. Email + password (bcrypt). JWT issued in an httpOnly, SameSite cookie. No
roles, no tenant scoping. Every project belongs to a `user_id`.

## Alternative

An Authorization header plus localStorage is the common tutorial pattern, but the token is
script-readable. The cookie is the safer default and costs nothing extra. Single-user is a scope
decision, not a security position — the schema already carries `user_id`, so multi-user is
additive later.

## Consequences

- No RBAC, no tenant-isolation test surface.
- CSRF must be considered because cookies are sent automatically. `SameSite=Lax` covers the MVP.
- Revisit before any deployment that is not localhost.

