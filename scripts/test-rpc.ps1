$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpZHRmc3NsZGlkenZlaHNzZXZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExODI1ODAsImV4cCI6MjEwNjc1ODU4MH0.FTsN8AI2vp4lWdB9TnV87Wf6h8sFmlcLq5vyHulbfFM"
$url = "https://qidtfssldidzvehssevk.supabase.co/rest/v1/rpc/get_order_queue_with_team"
$body = [System.Text.Encoding]::UTF8.GetBytes('{"p_limit":10,"p_status_filter":"all"}')
$req = [System.Net.WebRequest]::Create($url)
$req.Method = "POST"; $req.ContentType = "application/json"; $req.ContentLength = $body.Length
$req.Headers["apikey"] = $key; $req.Headers["Authorization"] = "Bearer $key"
$s = $req.GetRequestStream(); $s.Write($body, 0, $body.Length); $s.Close()
try {
    $resp = $req.GetResponse()
    $content = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
    $rows = $content | ConvertFrom-Json
    Write-Host "SUCCESS - ROWS: $($rows.Count)"
    if ($rows.Count -gt 0) { Write-Host "First row status: $($rows[0].status), payment_state: $($rows[0].payment_state)" }
} catch [System.Net.WebException] {
    $err = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
    Write-Host "ERROR: $err"
}
