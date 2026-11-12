# Remove daily check-in photo upload, keep face-reference photo only

Daily photo storage at check-in has been removed. Previously, every check-in uploaded a `.webp` blob to the `attendance-photos` Supabase bucket and passed the resulting path to the `attendance_check_in` RPC. Now check-in transmits only the face descriptor vector, GPS coordinates, and liveness trace — the proof chain relies entirely on server-side vector comparison and coordinate logging. The `uploadPhoto` helper is kept intact because face reference registration (`handleRegisterFace`) still uploads a one-time photo to the same bucket when an employee enrolls their Face ID.

**Watch for:** `capturedBlob` is still captured in `handleCapture` and stored in state, now consumed only by `handleRegisterFace` — `handleSubmit` ignores it, so the blob sits in memory for the rest of the check-in screen's lifetime (minor footprint, not blocking). The `similarity` dep remains in `handleSubmit`'s `useCallback` array though the value is unused inside the body; this is pre-existing in the base branch and out of scope. The RPC is safe without `p_photo_url`: the column is `TEXT DEFAULT NULL` and the Supabase client omits absent keys via the existing `params as any` cast.

**Verdict**: APPROVED

---

## High-level view

The cut is surgical: the `uploadPhoto(capturedBlob)` call and the `p_photo_url: photoPath` argument are removed from `handleSubmit`, along with `capturedBlob` and `uploadPhoto` from that callback's dependency array. `uploadPhoto` and its call site in `handleRegisterFace` are untouched — face reference registration still stores the one-time photo.

`CheckInParams` loses `p_photo_url?: string`; it was already optional, so this only narrows the allowed surface. The RPC defaults the column to `NULL` when the key is absent, so no migration is needed.

Liveness, face descriptor comparison, GPS, late-reason gating, auto-capture, and auto-submit are all untouched.

---

<details>
<summary>Issues (2)</summary>

1. **`capturedBlob` retained in memory after check-in** — `handleSubmit` no longer consumes the blob, so it persists in React state until the screen unmounts. Add `setCapturedBlob(null)` after a successful submit to reclaim it. Not blocking.
2. **Dead `similarity` dep in `handleSubmit` dep array** — `similarity` is listed in `useCallback`'s dep array but not read inside the callback. Pre-existing; remove it in a cleanup pass to avoid spurious re-memoisation.

</details>

<details>
<summary>Details</summary>

### `capturedBlob` still allocated after check-in

`handleCapture` stores the blob in React state; `handleSubmit` no longer touches it after this change, so the allocation persists for the screen's lifetime. A `setCapturedBlob(null)` after a successful submit would reclaim it. On lower-end Android devices with 2–3 GB RAM this is worth noting. Not blocking.

### Dead `similarity` dep in `handleSubmit`

`similarity` appears in `handleSubmit`'s `useCallback` dep array but is not read inside the callback body — confirmed by reading the current file. This is pre-existing from the base branch; this batch correctly dropped `capturedBlob` and `uploadPhoto` but left `similarity` in place. It won't cause a correctness bug (the dep only over-memoises the callback), but it's a stale entry.

### RPC call without `p_photo_url`

The `attendance_check_in` procedure has `p_photo_url TEXT DEFAULT NULL`. The `params as any` cast (pre-existing) causes the Supabase client to serialise only the keys present on the object; with `p_photo_url` absent, the DB applies the default. All other optional params (`p_accuracy_meters`, `p_late_reason`) follow the same pattern in the same call.

</details>

---

<details>
<summary>Files changed</summary>

- `components/attendance/attendance-console.tsx` — removed `uploadPhoto(capturedBlob)` call and `p_photo_url` argument from `handleSubmit`; removed `capturedBlob` and `uploadPhoto` from that callback's dep array
- `app/actions/attendance.ts` — removed `p_photo_url?: string` from `CheckInParams` type

[Full diff: `git show 8fc6e3c`]

</details>
