$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
  throw "Flutter SDK not found. Install Flutter and make sure 'flutter' is in PATH."
}

flutter create --platforms=android,ios .
flutter pub get
flutter analyze
