# ============================================================================
# FILE: local-guard.ps1
# LOCATION: backend/src/operations/local-guard.ps1
# PURPOSE: Hold a Windows kernel mutex for an exact parent process lifetime.
# ROLE IN PROJECT: Local exclusion only; never claims database write settlement.
# KEY COMPONENTS: Named mutex, opened process handle, explicit shutdown pipe.
# ============================================================================
param([int]$ParentPid, [string]$GuardHash, [string]$ExpectedCreation)
$ErrorActionPreference = 'Stop'
if ($ExpectedCreation) {
    try { $observed = [System.Diagnostics.Process]::GetProcessById($ParentPid) }
    catch [System.ArgumentException] { [Console]::WriteLine('dead'); exit 0 }
    catch { exit 2 }
    try {
        $handle = $observed.Handle
        if ($observed.StartTime.ToUniversalTime().Ticks.ToString() -ne $ExpectedCreation) {
            [Console]::WriteLine('reused')
        } elseif ($observed.HasExited) { [Console]::WriteLine('dead') }
        else { [Console]::WriteLine('live') }
    } catch { exit 2 }
    finally { $observed.Dispose() }
    exit 0
}
$mutex = $null
$owned = $false
try {
    if ($GuardHash -notmatch '^[a-zA-Z0-9-]{1,64}$') { exit 2 }
    $parent = [System.Diagnostics.Process]::GetProcessById($ParentPid)
    # Opening Handle before READY pins the exact process object, not just its PID.
    $handle = $parent.Handle
    $creation = $parent.StartTime.ToUniversalTime().Ticks.ToString()
    $machine = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Cryptography').MachineGuid
    if (-not $machine) { exit 2 }
    $mutex = [System.Threading.Mutex]::new($false, "Global\AurvinLocal-$GuardHash")
    try { $owned = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { exit 3 }
    [Console]::WriteLine('READY ' + (@{ machine=$machine; pid=$ParentPid; creation=$creation } | ConvertTo-Json -Compress))
    $inputStream = [Console]::OpenStandardInput()
    $buffer = New-Object byte[] 1
    $read = $inputStream.BeginRead($buffer, 0, 1, $null, $null)
    while (-not $parent.WaitForExit(100)) {
        if ($read.IsCompleted) { break }
    }
    # Kernel process-handle signalling releases exclusion only, not DB authorization.
} catch { exit 2 }
finally {
    if ($owned -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
    if ($parent) { $parent.Dispose() }
}
