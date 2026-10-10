# Recreates the engine test fixtures: 2-second 1 kHz test tones at -6 dBFS, stereo.
# Made by us, so there are no copyright issues. Needs ffmpeg (not shipped with BongPlayer);
# a portable copy can live in the git-ignored tools/ folder.
#
#   .\make_fixtures.ps1 -Ffmpeg ..\..\..\..\tools\ffmpeg\<build>\bin\ffmpeg.exe
param([Parameter(Mandatory = $true)][string]$Ffmpeg)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Tone([int]$Rate, [string]$Out, [string[]]$Codec) {
    # Exact amplitude 0.5 on both channels (ffmpeg's "sine" source is fixed at 1/8 and its
    # mono-to-stereo upmix lowers it further).
    $tone = "0.5*sin(2*PI*1000*t)"
    $src = "aevalsrc=${tone}|${tone}:s=${Rate}:d=2:c=stereo"
    $args = @("-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", $src,
        "-map_metadata", "-1") + $Codec + @($Out)
    & $Ffmpeg @args
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $Out" }
}

Tone 44100 "tone_44100.wav"  @("-c:a", "pcm_s16le")
Tone 48000 "tone_48000.wav"  @("-c:a", "pcm_s16le")
Tone 44100 "tone_44100.flac" @("-c:a", "flac")
Tone 48000 "tone_48000.flac" @("-c:a", "flac")
Tone 44100 "tone_44100.mp3"  @("-c:a", "libmp3lame", "-b:a", "128k")
Tone 44100 "tone_44100.m4a"  @("-c:a", "aac", "-b:a", "128k")
Tone 44100 "tone_44100.ogg"  @("-c:a", "libvorbis", "-q:a", "4")

# Not a real audio file: random bytes with an .mp3 name, for the "corrupt file" test.
[IO.File]::WriteAllBytes("$PSScriptRoot\corrupt.mp3", [byte[]](1..4096 | ForEach-Object { ($_ * 37 + 11) % 256 }))
