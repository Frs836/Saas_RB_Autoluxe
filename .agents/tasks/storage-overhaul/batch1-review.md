# Inspection photos moved from Supabase Storage to Cloudinary

This batch replaces the Supabase Storage upload path for order inspection photos with a client-side Cloudinary unsigned upload. A new helper, `lib/cloudinary-upload.ts`, POSTs the captured WebP blob to Cloudinary's `image/upload` endpoint using only the public env vars (cloud name + unsigned upload preset) and returns `{ secureUrl, publicId }`. `components/orders/order-detail-view.tsx` now sends that secure URL as `p_photo_path` to `add_order_inspection` and drops the `supabase.storage.from("inspection-photos").remove([path])` rollback that previously ran when the RPC failed. Legacy relative-path photos still render through `photoUrl()`, which now passes absolute `https` URLs straight through while continuing to prefix relative paths with the Supabase public base.

Watch for: the `public_id` Cloudinary returns is thrown away because the generated `add_order_inspection` Args type has no `p_public_id` parameter, so `order_inspections.public_id` stays null for every new row; removing the rollback means a photo that uploads to Cloudinary but is then rejected by the RPC becomes an unreclaimable orphan; the raw Cloudinary error body is surfaced to the technician on upload failure.

**Verdict**: APPROVED

## High-level view

The Cloudinary helper is a thin browser-only wrapper over the unsigned upload endpoint — it reads two `NEXT_PUBLIC_` vars, builds a `FormData` with `file`, `upload_preset`, and a fixed `inspection-photos` folder, and validates that the response carries both `secure_url` and `public_id`. No API key or secret is present in the client.

The view's submit flow changes only where the bytes land and what string gets persisted: the blob uploads to Cloudinary, the returned secure URL goes to the same `add_order_inspection` RPC as `p_photo_path`, and auth plus the phase/notes/permission rules remain enforced server-side through that unchanged RPC. RBAC gating (`canUpload`, `canManageTeam`), the `supabase.auth.getUser()` session check, and the MediaPipe-driven attendance helpers imported from `@/lib/attendance` are untouched.

The one place the design leaves a gap is `public_id`: the helper returns it, the table has a nullable `public_id` column intended for it, but the RPC has no parameter to receive it, so it is discarded. That is exactly the contingency the task anticipated ("if there is no `p_public_id`, just send `p_photo_path`"), so the code is correct against the task — but it leaves Cloudinary asset management without a stored handle until a DB/RPC change adds the parameter.

<details>
<summary>Issues (3)</summary>

1. **public_id discarded** — `uploadImageToCloudinary` returns `publicId` but `submitInspection` only destructures `secureUrl`, because `add_order_inspection`'s generated Args type (`p_notes`, `p_order_id`, `p_phase`, `p_photo_path`) has no `p_public_id`. `order_inspections.public_id` will therefore be null for all new Cloudinary photos. To populate it, extend the `add_order_inspection` RPC signature to accept `p_public_id` (a DB change, out of scope for this client-side batch) and then pass it through here.
2. **Orphaned Cloudinary asset on RPC failure** — the previous code removed the just-uploaded Supabase object when `add_order_inspection` rejected the row; that rollback is gone (as the task requested, since unsigned uploads cannot be deleted from the browser). A photo that reaches Cloudinary but fails the RPC now stays in Cloudinary with no DB row and no client-side way to remove it. Consider a server-side sweeper using `CLOUDINARY_API_KEY`/`SECRET` to reap uploaded-but-unreferenced assets, consistent with the cleanup strategy already described in `system_architecture_rb_autoluxe.md`.
3. **Raw Cloudinary error shown to technician** — on a non-2xx response the helper appends `await res.text()` (Cloudinary's JSON error body) to the thrown message, which surfaces as the user-facing `error` string. A technician sees raw API JSON instead of a friendly reason. Map the common Cloudinary error codes (preset misconfigured, cloud name wrong, quota exceeded) to Indonesian messages, or log the raw body and show a generic failure.

</details>

<details>
<summary>Details</summary>

### Cloudinary unsigned upload helper

The helper POSTs to `https://api.cloudinary.com/v1_1/${cloudName}/image/upload` and requires both `secure_url` and `public_id` in the response, so a partial response fails loudly rather than returning a URL with no public id.

The folder is hardcoded to `inspection-photos`, matching the task spec verbatim. `backendspec.md` instead describes a folder of `rb_autoluxe/inspections` and a preset named `rb_autoluxe_preset`; that doc appears to be the planned end state rather than the current contract, so the implementation correctly follows the task, but reconciling the spec with the code (or the preset/folder actually configured in the Cloudinary dashboard) is worth a follow-up so the two do not drift further apart.

### Submission flow and the removed rollback

The Supabase client and `auth.getUser()` session check are unchanged; only the storage write is gone. The `order.trackingToken` dependency was dropped from the `useCallback` deps because it was only used to build the old Supabase path and no longer participates in the upload.

The trade-off the task asked for has a concrete consequence: when `uploadImageToCloudinary` succeeds and the RPC then fails, the photo is now permanent in Cloudinary with no row referencing it. Unsigned Cloudinary uploads cannot be destroyed from the browser (deletion needs the signed API), so there is no client-side recovery. This is an accepted limitation of the chosen architecture, not a coding defect — but it means the cleanup burden moves server-side. The existing `delete_order_inspection` RPC only deletes the DB row (it never removed the Supabase object either, so photo deletion already orphaned storage assets in the base), so nothing in this diff makes deletion worse; the new exposure is specifically the RPC-failure path.

### public_id: fetched, returned, then dropped

The helper's return type is `{ secureUrl, publicId }`, but the call site destructures only `secureUrl`. That is the correct behavior against the task's conditional ("if the RPC supports `p_public_id`, send it; otherwise just send `p_photo_path`"), because the generated `add_order_inspection` Args in `database.types.ts` contains no `p_public_id`. The consequence is that `order_inspections.public_id` — which the task context explicitly calls out as "untuk Cloudinary public_id" — will be null for every photo written through this path. The secure URL still encodes the public id in its path, so a future server-side deletion job could recover it by parsing the URL, but the dedicated column's purpose goes unfulfilled until the RPC is extended. Extending the RPC is a backend change outside this batch.

### Error feedback to the technician

On a non-OK response the helper reads the body as text and concatenates it into the thrown error, which `submitInspection` forwards to `setError`. For a technician on a flaky field connection this means a Cloudinary failure surfaces as raw JSON (often a `{"error":{"message":...}}` blob) rather than a readable cause. A thin mapping of the handful of Cloudinary failure modes to Indonesian would make the failure legible. There is also no fetch timeout or retry, so a stalled request leaves `busy` true until the browser gives up; given these uploads happen from mobile devices over cell data, a timeout with a "coba lagi" path would be more robust, though the same fetch-without-timeout pattern predates this change.

</details>

<details>
<summary>File map</summary>

- `lib/cloudinary-upload.ts` (new) — client-side helper that uploads a blob to Cloudinary via an unsigned preset and returns `{ secureUrl, publicId }`.
- `components/orders/order-detail-view.tsx` — inspection submit now uploads to Cloudinary and stores the secure URL as `p_photo_path`; Supabase storage rollback removed; `trackingToken` dropped from deps.

Full diff: `git diff 7d00b73bf19e87cd363068852a5299f7bacfc7f3...HEAD`

</details>
