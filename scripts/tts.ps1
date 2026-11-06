# Speaks each phrase in a JSON list to a WAV file with a Windows voice (free, offline).
# Called by make-voice.mjs. Input: [{ "text": "...", "file": "name.wav" }, ...]
param(
  [Parameter(Mandatory)] [string]$List,
  [Parameter(Mandatory)] [string]$OutDir,
  [string]$Voice = 'Mark',
  [double]$Rate = 1.05
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$match = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*$Voice*" } | Select-Object -First 1
if (-not $match) { throw "Voice '$Voice' is not installed." }
$synth.Voice = $match
$synth.Options.SpeakingRate = $Rate

$items = Get-Content -Raw -Encoding UTF8 $List | ConvertFrom-Json
foreach ($it in $items) {
  $stream = Await ($synth.SynthesizeTextToStreamAsync($it.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $size = [uint32]$stream.Size
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $null = Await ($reader.LoadAsync($size)) ([uint32])
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  [System.IO.File]::WriteAllBytes((Join-Path $OutDir $it.file), $bytes)
  $reader.Dispose()
  $stream.Dispose()
}
Write-Output "Spoke $($items.Count) clips with $($match.DisplayName)."
