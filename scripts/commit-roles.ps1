Set-Location "C:\Users\User\Desktop\Saas_RB_Autoluxe"
git add supabase/migrations/0103_add_new_roles.sql
git add supabase/migrations/0104_add_role_enum_values.sql
git add lib/rbac.ts
git add lib/supabase/database.types.ts
git add app/actions/staff.ts
git add components/branch/staff-management.tsx
git add components/branch/staff-management-page.tsx
git add components/branch/staff-create-form.tsx
git status
$msg = "feat: add roles manager/finance/kepala_karyawan + hapus staf (sprint 4)"
git commit -m $msg
Write-Output "Committed: $LASTEXITCODE"
git log --oneline -4
