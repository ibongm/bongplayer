# Vendored: Signalsmith Stretch

Header-only C++ time-stretch / pitch-shift library, MIT licence (see each folder's `LICENSE.txt`).

- `signalsmith-stretch/` — https://github.com/Signalsmith-Audio/signalsmith-stretch
- `signalsmith-linear/` — https://github.com/Signalsmith-Audio/linear

Copied unchanged from the `signalsmith-stretch` 0.1.3 crate (git c4d0cbd), which pins both
repositories. Vendored instead of using that crate because its build needs LLVM/libclang
(bindgen), which is not available on the build machines. Only the headers and licences are
kept; demos, tests, web builds and the optional Apple Accelerate / Intel IPP backends (only
used when `SIGNALSMITH_USE_ACCELERATE` / `SIGNALSMITH_USE_IPP` are defined) are left out.
