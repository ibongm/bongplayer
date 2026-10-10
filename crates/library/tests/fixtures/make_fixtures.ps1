# Recreates the library test fixtures: synthetic 70-second songs (see tests/common/synth.rs)
# with known BPM and key, encoded as 160 kbps MP3 (typical bar music files; 70 s keeps the repository small).
# Needs ffmpeg (not shipped with BongPlayer); a portable copy can live in the git-ignored tools/.
#
#   .\make_fixtures.ps1 -Ffmpeg ..\..\..\..\tools\ffmpeg\<build>\bin\ffmpeg.exe
param([Parameter(Mandatory = $true)][string]$Ffmpeg)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$repo = Resolve-Path "..\..\..\.."

$songs = @(
    @{ Name = "song_128bpm_Am"; Bpm = 128; Tonic = 9; Mode = "minor" },
    @{ Name = "song_82bpm_G"; Bpm = 82; Tonic = 7; Mode = "major" },
    @{ Name = "song_168bpm_E"; Bpm = 168; Tonic = 4; Mode = "major" }
)
foreach ($s in $songs) {
    $wav = Join-Path $env:TEMP "$($s.Name).wav"
    cargo run -q --release --manifest-path "$repo\Cargo.toml" -p library --example make_song -- $wav $s.Bpm $s.Tonic $s.Mode 70
    if ($LASTEXITCODE -ne 0) { throw "make_song failed" }
    & $Ffmpeg -hide_banner -loglevel error -y -i $wav -c:a libmp3lame -b:a 160k -map_metadata -1 "$($s.Name).mp3"
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $($s.Name)" }
    Remove-Item $wav
}
