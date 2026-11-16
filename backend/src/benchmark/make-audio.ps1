<#
============================================================================
FILE: make-audio.ps1
LOCATION: backend/src/benchmark/make-audio.ps1
PURPOSE: Generate an offline synthetic voice baseline using Windows speech.
ROLE IN PROJECT: No microphone recording, cloud service, credential or paid call.
KEY COMPONENTS: PCM16 mono 16 kHz output and a waveform-end timing manifest.
============================================================================
#>
param([string]$OutputDirectory = 'benchmark-results/audio')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$directory = [System.IO.Path]::GetFullPath($OutputDirectory)
$audioPath = Join-Path $directory 'baseline.pcm'
$manifestPath = Join-Path $directory 'baseline.json'
if ((Test-Path -LiteralPath $audioPath) -or (Test-Path -LiteralPath $manifestPath)) {
    throw 'Audio output already exists. Choose a new output directory; existing files are never replaced.'
}
$prompt = 'In two short sentences, explain why the sky looks blue.'
$stream = [System.IO.MemoryStream]::new()
$speech = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
        16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono)
    $speech.SetOutputToAudioStream($stream, $format)
    $speech.Speak($prompt)
    $bytes = $stream.ToArray()
    if ($bytes.Length -lt 320 -or $bytes.Length % 2 -ne 0) { throw 'Invalid synthesized PCM.' }
    $length = $bytes.Length
    while ($length -gt 2 -and $bytes[$length - 1] -eq 0 -and $bytes[$length - 2] -eq 0) { $length -= 2 }
    $pcm = [byte[]]::new($length + 64000)
    [Array]::Copy($bytes, $pcm, $length)
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    [System.IO.File]::WriteAllBytes($audioPath, $pcm)
    $manifest = [ordered]@{
        provenance = 'offline-windows-synthetic-speech'
        prompt = $prompt
        sampleRate = 16000
        channels = 1
        encoding = 'pcm16-little-endian'
        speechEndMs = $length / 32.0
        trailingSilenceMs = 2000
        markerDefinition = 'End of synthesized waveform after trimming exactly-zero trailing samples; not human-perceived phonetic end.'
    }
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    Write-Output "Synthetic PCM: $audioPath"
    Write-Output "Timing manifest: $manifestPath"
    Write-Output "speechEndMs: $($manifest.speechEndMs)"
}
finally {
    $speech.Dispose()
    $stream.Dispose()
}
