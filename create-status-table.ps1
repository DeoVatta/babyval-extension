$body = @"
{"query":"CREATE TABLE IF NOT EXISTS public.tevi_cs_status (id SERIAL PRIMARY KEY, bot_id TEXT NOT NULL UNIQUE, last_scan_at TIMESTAMPTZ, success_count INT DEFAULT 0, fail_count INT DEFAULT 0, consecutive_fails INT DEFAULT 0, bot_state TEXT DEFAULT 'healthy', version TEXT, updated_at TIMESTAMPTZ DEFAULT NOW());"}
"@
try {
    $resp = Invoke-WebRequest -Uri "https://api.supabase.com/v1/projects/qjemyvydivekolywleji/database/query" `
        -Method POST `
        -Headers @{"Authorization"="Bearer sbp_d5338e4ce114b64b6d123be6fc55cafad358136d"; "Content-Type"="application/json"} `
        -Body $body `
        -TimeoutSec 15
    Write-Host "Status: $($resp.StatusCode)"
    Write-Host "Content: $($resp.Content)"
} catch {
    $err = $_.Exception.Response
    if ($err) {
        Write-Host "HTTP Error: $($err.StatusCode.value__)"
        $reader = [System.IO.StreamReader]::new($err.GetResponseStream())
        $errBody = $reader.ReadToEnd()
        $reader.Close()
        Write-Host "Body: $errBody"
    } else {
        Write-Host "Error: $($_.Exception.Message)"
    }
}
