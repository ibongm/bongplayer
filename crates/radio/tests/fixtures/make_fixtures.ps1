# Recreates the radio test fixtures: 2-second 1 kHz tones as a raw ADTS AAC stream and as a
# bare MP3 stream (no ID3 tag, no Xing header — what a radio server sends).
# Needs ffmpeg (not shipped with BongPlayer); a portable copy can live in the git-ignored tools/.
param([Parameter(Mandatory = $true)][string]$Ffmpeg)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$tone = "0.5*sin(2*PI*1000*t)"
$src = "aevalsrc=${tone}|${tone}:s=44100:d=2:c=stereo"
& $Ffmpeg -hide_banner -loglevel error -y -f lavfi -i $src -map_metadata -1 -c:a aac -b:a 96k -f adts tone_44100.aac
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed (aac)" }
& $Ffmpeg -hide_banner -loglevel error -y -f lavfi -i $src -map_metadata -1 -id3v2_version 0 -write_xing 0 -c:a libmp3lame -b:a 128k tone_44100.mp3
if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed (mp3)" }
