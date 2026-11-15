# apply-migrations.ps1
# Apply pending migrations 0107-0120 to Supabase via Management API

$PROJECT_REF = $env:SUPABASE_PROJECT_REF
if (-not $PROJECT_REF) { $PROJECT_REF = "qidtfssldidzvehssevk" }
$ACCESS_TOKEN = $env:SUPABASE_ACCESS_TOKEN
$MIGRATIONS_DIR = "C:\Users\User\Desktop\Saas_RB_Autoluxe\supabase\migrations"
$API_BASE = "https://api.supabase.com/v1"

$headers = @{
    "Authorization" = "Bearer $ACCESS_TOKEN"
    "Content-Type"  = "application/json"
}

# Migrations to apply in order
$migrations = @(
    "0107_precise_service_categories",
    "0108_rpc_get_audit_trail",
    "0109_fix_audit_trail_return_type",
    "0110_sprint7_bulk_cashflow",
    "0111_push_subscriptions",
    "0112_setup_pgcron_attendance",
    "0113_app_settings_cron",
    "0114_prevent_duplicate_face",
    "0115_attendance_anomaly_flag",
    "0116_flexible_team_management",
    "0117_kepala_karyawan_shift_access",
    "0118_fix_wash_no_qc_custom_price",
    "0119_shift_handoffs_read_policy",
    "0120_fix_wash_no_qc_custom_price"
)

$results = @()

foreach ($migration in $migrations) {
    $file = Get-ChildItem "$MIGRATIONS_DIR\${migration}.sql" -ErrorAction SilentlyContinue
    if (-not $file) {
        Write-Host "SKIP: $migration (file not found)" -ForegroundColor Yellow
        continue
    }

    $sql = Get-Content $file.FullName -Raw -Encoding UTF8
    $body = @{
        name    = $migration
        query   = $sql
    } | ConvertTo-Json -Depth 5 -Compress

    Write-Host "Applying: $migration..." -NoNewline

    try {
        $response = Invoke-RestMethod `
            -Uri "$API_BASE/projects/$PROJECT_REF/database/migrations" `
            -Method POST `
            -Headers $headers `
            -Body $body `
            -ErrorAction Stop

        Write-Host " OK" -ForegroundColor Green
        $results += [PSCustomObject]@{ Migration = $migration; Status = "OK"; Error = "" }
    }
    catch {
        $errMsg = $_.Exception.Message
        Write-Host " FAILED: $errMsg" -ForegroundColor Red
        $results += [PSCustomObject]@{ Migration = $migration; Status = "FAILED"; Error = $errMsg }
    }
}

Write-Host ""
Write-Host "=== RESULTS ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$ok = ($results | Where-Object { $_.Status -eq "OK" }).Count
$fail = ($results | Where-Object { $_.Status -eq "FAILED" }).Count
Write-Host "Applied: $ok  Failed: $fail" -ForegroundColor Cyan
