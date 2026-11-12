# Duplicate-face guard in set_face_descriptor

This migration replaces `public.set_face_descriptor` with a version that, before storing a descriptor, loops over every other profile that already holds a valid-length face descriptor and calls `face_similarity`; if any comparison reaches 0.75 it raises SQLSTATE 23505 with an Indonesian message that names the existing account holder. The function signature `(p_descriptor double precision[], p_photo_url text DEFAULT NULL)`, the UPDATE clause, SECURITY DEFINER ownership, the GRANT, the COMMENT, and the `activity_logs` insert are all carried over from the 0028 version, so the TypeScript caller `handleRegisterFace` — which invokes `supabase.rpc("set_face_descriptor", { p_descriptor, p_photo_url })` by name — needs no change and the RBAC/auth/MediaPipe layer is untouched (this commit moved exactly one file, the migration). The duplicate threshold is fixed at 0.75 per the task, and the comparison length is taken from `face_descriptor_length()` rather than hardcoded — the right call, since that function currently returns 1434 (the step's "478" reference does not match the live schema).

**Watch for:** the duplicate check is a SELECT-then-UPDATE with no row lock, advisory lock, or elevated isolation, so two simultaneous registrations of the same face can both read "no duplicate" and both commit. For a manual, camera-driven flow that window is narrow, but it is the one residual path that lets a duplicate through. Secondarily, `search_path` moved from the hardened `''` (used by the prior version and by sibling attendance functions) to `public`, and the scan is linear over all registered faces.

**Verdict**: APPROVED

## High-level view

The guard closes the primary attack the batch targets: once account A's descriptor is committed, any later registration of the same face under account B is rejected with 23505 before the UPDATE runs. The sequential "register my face under a second account" hole — which is the realistic exploit for this product — is fully blocked.

Concurrency is the one gap the design does not close. There is no lock and no isolation bump, so the check-then-write is not atomic across transactions. Exploitation needs two registrations of the same face to overlap in time, which is unlikely for a deliberate camera-based signup, but it is the one way a duplicate still lands.

The API surface is unchanged by construction: the function keeps the exact parameter names and types the client already passes, the commit touched no Next.js file, and the SECURITY DEFINER + `current_profile_id()` RBAC pattern is preserved. No caller contract moved.

The error surfaces another user's `full_name` to the person attempting registration. This is per the task spec (name the duplicate account) and is acceptable in a single-org workshop tool, where it helps a maintainer resolve a dispute rather than leaking across tenants. It is a deliberate trade-off, not an oversight.

<details>
<summary>Issues (3)</summary>

1. **Concurrent-registration race (TOCTOU)** — the duplicate check is a SELECT loop followed by an UPDATE with no lock and no elevated isolation (default READ COMMITTED), so two same-face registrations that overlap in time can both pass and both commit. If the "one face, one account" guarantee must hold under concurrency, take a `LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE` (or a transaction-scoped advisory lock, or SERIALIZABLE isolation) inside the function.
2. **search_path weakened to `public`** — the prior 0028 version and the sibling `attendance_check_in` use `SET search_path = ''`; this function uses `SET search_path = public`. All internal calls are already schema-qualified so the practical risk is low, but it is a regression from the hardened posture the rest of the face code holds. Restore `''` for consistency.
3. **Linear scan per registration** — every registration scans all profiles holding a valid-length descriptor and runs `face_similarity` (1434-dim) for each, so cost is O(n) per signup. Fine at current staff counts; add a partial index or cap the candidate set once the account base grows.

</details>

<details>
<summary>Details</summary>

### Guard design and the primary attack it closes

The loop selects every profile whose `id <> v_profile`, whose `face_descriptor` is not null, and whose stored length equals `face_descriptor_length()` (returning 1434 today, not 478 — the step's "478-length" reference does not match the live schema, and using the function rather than a literal is the correct choice since the dimension has already changed once, 256 → 1434). The length filter is load-bearing: it skips stale 256-dim samples that predate the 0028 format change, which could not be meaningfully compared to a 1434-dim vector anyway. For each candidate it calls `public.face_similarity(p_descriptor, v_other.face_descriptor)` and, on `>= 0.75`, raises `23505` with `Wajah ini sudah terdaftar di akun "<full_name>"...`. The own-profile exclusion means re-registering your own face never trips your own stored descriptor. This closes the sequential attack the batch is about: account A registers, commits; account B later registers the same face, the SELECT sees A's committed row, B is rejected before any write.

### Concurrency gap in the check-then-write

The duplicate check and the UPDATE run in one function, hence one transaction, but the function sets no isolation level and takes no lock. Postgres defaults to READ COMMITTED, where each statement sees rows committed before that statement began. Two registrations of the same face that overlap in time each run their SELECT before the other's UPDATE has committed; neither sees the other's new descriptor, both pass the loop, both UPDATE, and both commit. The result is two profiles holding near-identical descriptors — exactly the state the guard is meant to prevent.

```
T1: SELECT (no dup yet) ─────────── UPDATE face_descriptor ─── COMMIT
T2:        SELECT (no dup; T1 uncommitted) ─── UPDATE ─── COMMIT
```

Because face registration is a slow, deliberate, camera-driven act a user performs once, the realistic likelihood of two signups colliding is low, which is why this is non-blocking. But it is a real gap, and it is the only path the guard leaves open. Closing it cleanly is cheap: a transaction-scopic advisory lock keyed on a constant (e.g. `pg_advisory_xact_lock(<hash>)`) serializes all face registrations against each other, which is fine because registration is rare. `LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE` would also work but is heavier than needed. SERIALIZABLE isolation would work but risks serialization failures that the client does not currently retry.

### search_path change from `''` to `public`

The 0028 version declared `SET search_path = ''`, the pattern Supabase recommends for SECURITY DEFINER functions to deny search-path hijacking. This migration declares `SET search_path = public`. Every call inside the body is schema-qualified with `public.` (`current_profile_id`, `face_descriptor_length`, `face_similarity`, the `profiles` / `activity_logs` table references), and the unqualified built-ins (`array_length`, `btrim`, `now`, `COALESCE`) resolve to `pg_catalog` first regardless, so the practical exposure is small — an attacker would need to create a shadowing object in `public`, which authenticated roles cannot do. The reason to flag it is consistency: the rest of the face subsystem holds the `''` line, and a security-themed batch should not quietly relax it. Restoring `SET search_path = ''` is a one-line, zero-risk change.

### Linear scan cost

The candidate query has no index to lean on: it filters on `face_descriptor IS NOT NULL` and `array_length(face_descriptor, 1) = face_descriptor_length()`, then runs `face_similarity` per row. Cost per registration is therefore linear in the number of registered faces, and `face_similarity` is a 1434-dimensional dot/cosine over a `double precision[]`. At this product's scale — a single workshop with a handful of staff — this is invisible. The shape only starts to matter if the account base grows into the hundreds, at which point a partial index on `profiles (id) WHERE face_descriptor IS NOT NULL` would at least trim the scan, and a precomputed similarity index would change the game entirely. Not actionable now; worth knowing the guard does not scale for free.


</details>

<details>
<summary>File map</summary>

- `supabase/migrations/0114_prevent_duplicate_face.sql` (new, 95 lines) — `CREATE OR REPLACE FUNCTION public.set_face_descriptor(double precision[], text)` adding a cross-account duplicate-check loop (threshold 0.75, `face_similarity`, `23505` on match) before the existing UPDATE; reuses `face_descriptor_length()` for the 1434-dim comparison; keeps SECURITY DEFINER, GRANT, COMMENT, and the activity-log insert from the prior version.

Full diff: `git show a74707582e904430b02a4d86f20fd3a53230f89a`

</details>
