# run.ps1 -- Build & run a TSVC category on Windows with clang.
#
# Usage:
#   .\run.ps1                       # list available categories
#   .\run.ps1 ControlFlow-dbl       # build + run + compare to reference output
#   .\run.ps1 Reductions-flt
#   .\run.ps1 ControlFlow-dbl -CFlags "-O3 -mavx2"
#   .\run.ps1 ControlFlow-dbl -Ntimes 100 -Digits 6
#   .\run.ps1 ControlFlow-dbl -NoRun        # only compile
#   .\run.ps1 ControlFlow-dbl -NoRun -Diag lv.txt `
#        -CFlags "-O3 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize"
#        # captures clang vectorizer remarks (stderr) into lv.txt and prints
#        # a per-function list of kernel loops that are NOT auto-vectorized
#   .\run.ps1 ControlFlow-dbl -Tolerance 1e-9
#
# Notes:
#   - Auto-generates sys\*.h stubs and compat.h/compat.c to work around the
#     absence of <sys/param.h>, <sys/times.h> and posix_memalign on the
#     MSVC-targeted clang for Windows.
#   - ntimes/digits are parsed from the category's CMakeLists.txt
#     (RUN_OPTIONS), defaulting to 2325 14.
#   - If you use a MinGW-target clang, posix_memalign is already provided:
#     add  -CFlags "-DTSVC_HAS_POSIX_MEMALIGN"  to skip the shim.

param(
  [Parameter(Position=0)][string]$Category = "",
  [string]$CFlags    = "",
  [string]$Diag      = "",
  [int]   $Ntimes     = 0,
  [int]   $Digits     = 0,
  [double]$Tolerance  = 0.0,
  [switch]$NoRun,
  [switch]$NoCompare
)

$ErrorActionPreference = "Stop"
$here  = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$build = Join-Path $here "build"

# ---------- generate Windows portability stubs ----------
function New-Stubs {
  param([string]$Root)
  $sysDir = Join-Path $Root "sys"
  New-Item -ItemType Directory -Force -Path $sysDir | Out-Null
  $items = @{
    "param.h" = "/* TSVC stub: BSD symbols unused */`r`n#pragma once`r`n"
    "times.h" = "/* TSVC stub: struct tms / times() unused */`r`n#pragma once`r`n"
    "types.h" = "/* TSVC stub: POSIX types unused */`r`n#pragma once`r`n"
  }
  foreach ($k in $items.Keys) {
    $p = Join-Path $sysDir $k
    if (-not (Test-Path $p)) { Set-Content -Path $p -Value $items[$k] -Encoding ascii }
  }

  $ch = Join-Path $Root "compat.h"
  if (-not (Test-Path $ch)) {
    Set-Content -Path $ch -Encoding ascii -Value @'
/* TSVC Windows portability shim */
#ifdef _WIN32
#ifndef TSVC_HAS_POSIX_MEMALIGN
#include <stddef.h>
int posix_memalign(void **memptr, size_t alignment, size_t size);
#endif
#endif
'@
  }

  $cc = Join-Path $Root "compat.c"
  if (-not (Test-Path $cc)) {
    Set-Content -Path $cc -Encoding ascii -Value @'
/* TSVC Windows portability shim */
#ifdef _WIN32
#ifndef TSVC_HAS_POSIX_MEMALIGN
#include <malloc.h>
#include <errno.h>
int posix_memalign(void **memptr, size_t alignment, size_t size) {
    void *p = _aligned_malloc(size, alignment);
    if (!p) return ENOMEM;
    *memptr = p;
    return 0;
}
#endif
#endif
'@
  }
}

# ---------- normalize one line (for comparison) ----------
function Norm([string]$s) {
  return ($s.ToLowerInvariant().TrimEnd() -replace '\s+', ' ')
}

# ---------- line match with numeric tolerance ----------
function LinesMatch([string]$r, [string]$g, [double]$tol) {
  if ($r -eq $g) { return $true }
  $rt = $r -split ' '; $gt = $g -split ' '
  if ($rt.Count -ne $gt.Count) { return $false }
  for ($k = 0; $k -lt $rt.Count; $k++) {
    $rn = 0.0; $gn = 0.0
    if ([double]::TryParse($rt[$k], [ref]$rn) -and [double]::TryParse($gt[$k], [ref]$gn)) {
      $denom = [Math]::Max([Math]::Abs($rn), [Math]::Abs($gn)); if ($denom -eq 0) { $denom = 1 }
      if ([Math]::Abs($rn - $gn) / $denom -gt $tol) { return $false }
    } elseif ($rt[$k] -ne $gt[$k]) { return $false }
  }
  return $true
}

# ---------- summarize loop-vectorize remarks captured from stderr ----------
function Show-DiagSummary {
  param([string]$DiagFile, [string]$Root)

  $lines = Get-Content $DiagFile
  $vec  = @{}   # remark line -> "loop vectorized"
  $miss = @{}   # remark line -> reason
  foreach ($ln in $lines) {
    if ($ln -match '^(.+?):(\d+):\d+:\s+remark:\s+(.+?)\s*\[-Rpass(?:-missed)?=loop-vectorize\]\s*$') {
      $loc = [int]$Matches[2]
      $txt = $Matches[3] -replace '\s+', ' '
      if ($txt -match '^(vectorized loop|loop vectorized)') {
        $vec[$loc] = $true
      }
      elseif ($txt -match '^loop not vectorized') {
        if (-not $vec.ContainsKey($loc)) {
          $r = ($txt -replace '^loop not vectorized:\s*', '')
          if ($r -eq '') { $r = '(no reason given)' }
          $miss[$loc] = $r
        }
      }
      elseif ($txt -match 'not beneficial' -and -not $vec.ContainsKey($loc)) {
        if (-not $miss.ContainsKey($loc)) { $miss[$loc] = $txt }
      }
    }
  }

  # scan tsc.inc: function starts + kernel loop headers
  $src = Get-Content (Join-Path $Root "tsc.inc")
  $funcStarts = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $src.Count; $i++) {
    if ($src[$i] -match '^(?:static\s+)?(?:int|void|double|float|TYPE|unsigned|char|long)\s+\**([A-Za-z_]\w*)\s*\(') {
      [void]$funcStarts.Add([pscustomobject]@{ L = $i + 1; N = $Matches[1] })
    }
  }
  # collect kernel loop headers inside test functions (sNNN* / v*)
  # - excludes helper functions (set1d/set2d/init/check, which get inlined everywhere)
  # - excludes the per-loop driver ('for (int nl ...') that never vectorizes due to dummy()
  $kloops = @()
  $fi = 0; $cur = ""
  for ($i = 0; $i -lt $src.Count; $i++) {
    $L = $i + 1
    while ($fi -lt $funcStarts.Count -and $funcStarts[$fi].L -le $L) { $cur = $funcStarts[$fi].N; $fi++ }
    if ($cur -notmatch '^s\d' -and $cur -notmatch '^v[a-z]') { continue }
    if ($src[$i] -notmatch '^\s*(for|while)\s*\(') { continue }
    if ($src[$i] -match 'int\s+nl\b') { continue }
    $kloops += [pscustomobject]@{ Func=$cur; Line=$L }
  }

  # a kernel loop is auto-vectorized iff it got a 'loop vectorized' remark
  $notvec = @($kloops | Where-Object { -not $vec.ContainsKey($_.Line) })
  Write-Host ""
  Write-Host ("[diag]  kernel loops: {0}, auto-vectorized: {1}, NOT vectorized: {2}" -f $kloops.Count, ($kloops.Count - $notvec.Count), $notvec.Count) -ForegroundColor Cyan

  $sum = @()
  $notvec | Group-Object Func | Sort-Object Name | ForEach-Object {
    Write-Host ("  {0}  [{1} loop(s)]" -f $_.Name, $_.Count) -ForegroundColor White
    foreach ($r in $_.Group) {
      $reason = if ($miss.ContainsKey($r.Line)) { $miss[$r.Line] } else { "(no LV remark)" }
      if ($reason.Length -gt 100) { $reason = $reason.Substring(0, 100) + "..." }
      Write-Host ("    tsc.inc:{0}  {1}" -f $r.Line, $reason)
      $sum += ("{0}`ttsc.inc:{1}`t{2}" -f $r.Func, $r.Line, $reason)
    }
  }
  $sumFile = "$DiagFile.summary"
  Set-Content -Path $sumFile -Value $sum
  Write-Host ("[diag]  summary written to {0}" -f $sumFile) -ForegroundColor Cyan
}

# ---------- list mode ----------
if (-not $Category) {
  Write-Host "Available TSVC categories:" -ForegroundColor Cyan
  Get-ChildItem -Path $here -Directory | Where-Object { $_.Name -match '-(dbl|flt)$' } | ForEach-Object {
    Write-Host ("  {0}" -f $_.Name)
  }
  Write-Host ""
  Write-Host "Usage: .\run.ps1 <Category> [-CFlags '...'] [-Ntimes N] [-Digits N]" -ForegroundColor Yellow
  exit 0
}

$catDir = Join-Path $here $Category
if (-not (Test-Path -PathType Container $catDir)) {
  Write-Error "Category dir not found: $Category (in $here)"
}
if (-not (Test-Path (Join-Path $catDir "tsc.c"))) {
  Write-Error "$Category has no tsc.c"
}

# ---------- parse RUN_OPTIONS from the category CMakeLists.txt ----------
$runN = 2325; $runD = 14
$cmakeFile = Join-Path $catDir "CMakeLists.txt"
if (Test-Path $cmakeFile) {
  $m = [regex]::match((Get-Content $cmakeFile -Raw), 'RUN_OPTIONS\s+(\d+)\s+(\d+)')
  if ($m.Success) { $runN = [int]$m.Groups[1].Value; $runD = [int]$m.Groups[2].Value }
}
if ($Ntimes -gt 0) { $runN = $Ntimes }
if ($Digits -gt 0) { $runD = $Digits }

New-Stubs -Root $here
New-Item -ItemType Directory -Force -Path $build | Out-Null

$out   = Join-Path $build "$Category.exe"
$tsc   = Join-Path $catDir "tsc.c"
$dummy = Join-Path $catDir "dummy.c"
$cc    = Join-Path $here "compat.c"
$ch    = Join-Path $here "compat.h"

# ---------- compile ----------
Write-Host "[build] clang $Category" -ForegroundColor Cyan
$clangArgs = @($tsc, $dummy, $cc, "-include", $ch, "-I$here", "-std=c99",
               "-D_CRT_DECLARE_NONSTDC_NAMES=0", "-o", $out)
if ($CFlags)  { $clangArgs += (-split $CFlags) }

if ($Diag) {
  # clang remarks (-Rpass*) go to stderr. Use real process redirection
  # (PowerShell '2>' would mangle native stderr into ErrorRecords).
  #
  # IMPORTANT: at -O3 clang eliminates functions that main() never calls
  # BEFORE the vectorizer runs, and those functions emit no remarks at all.
  # To get diagnostics for EVERY kernel, generate a driver TU whose main()
  # calls all test functions (TESTS = all bits), reusing the category's
  # TYPE/ALIGNMENT settings.
  $diagTsc = Join-Path $build "diag-tsc.c"
  $src = Get-Content $tsc -Raw
  if ($src -notmatch '#define TESTS\s+\w+') { Write-Error "cannot find TESTS define in $tsc" }
  $src = $src -replace '#define TESTS\s+\w+', '#define TESTS 0xFFFFFFFF'
  Set-Content -Path $diagTsc -Value $src -Encoding ascii

  $out = Join-Path $build "$Category-diag.exe"
  $clangArgs = @($diagTsc, $dummy, $cc, "-include", $ch, "-I$here", "-std=c99",
                 "-D_CRT_DECLARE_NONSTDC_NAMES=0", "-o", $out)
  if ($CFlags)  { $clangArgs += (-split $CFlags) }

  $diagAbs = if ([System.IO.Path]::IsPathRooted($Diag)) { $Diag } else { Join-Path (Get-Location).Path $Diag }
  $argStr = ($clangArgs | ForEach-Object { if ($_ -match '\s') { '"{0}"' -f $_ } else { $_ } }) -join ' '
  $p = Start-Process -FilePath "clang" -ArgumentList $argStr -NoNewWindow -Wait -PassThru -RedirectStandardError $diagAbs
  if ($p.ExitCode -ne 0) {
    Get-Content $diagAbs -TotalCount 30 | Write-Host
    Write-Error "compile failed (exit $($p.ExitCode)); full stderr in $diagAbs"
  }
  Write-Host "[ok]    $out" -ForegroundColor Green
  Write-Host ("[diag]  clang stderr -> {0}" -f $diagAbs) -ForegroundColor Cyan
  Show-DiagSummary -DiagFile $diagAbs -Root $here
}
else {
  & clang @clangArgs
  if ($LASTEXITCODE -ne 0) { Write-Error "compile failed (exit $LASTEXITCODE)" }
  Write-Host "[ok]    $out" -ForegroundColor Green
}

if ($NoRun) { exit 0 }

# ---------- run ----------
Write-Host "[run]   $out $runN $runD" -ForegroundColor Cyan
Write-Host ""
$outLines = & $out $runN $runD
$runExit = $LASTEXITCODE
$outLines | Write-Host
if ($runExit -ne 0) { Write-Warning "program exited with code $runExit" }

if ($NoCompare) { exit 0 }

# ---------- compare against reference output ----------
$refFile = Join-Path $catDir "$Category.reference_output"
if (-not (Test-Path $refFile)) {
  Write-Warning "no reference output: $refFile"
  exit 0
}

# 'exit <code>' trailing lines are llvm-test-suite harness metadata, not program output
$ref = Get-Content $refFile | ForEach-Object { Norm $_ } | Where-Object { $_ -notmatch '^exit\s+\d+$' -and $_ -ne '' }
$got = $outLines       | ForEach-Object { Norm $_ } | Where-Object { $_ -notmatch '^exit\s+\d+$' -and $_ -ne '' }

$diffs = 0; $maxLines = [Math]::Max($ref.Count, $got.Count)
for ($i = 0; $i -lt $maxLines; $i++) {
  $r = if ($i -lt $ref.Count) { $ref[$i] } else { "<missing>" }
  $g = if ($i -lt $got.Count) { $got[$i] } else { "<missing>" }
  if (LinesMatch $r $g $Tolerance) { continue }
  $diffs++
  Write-Host ("  L{0}: ref='{1}'" -f ($i+1), $r) -ForegroundColor Red
  Write-Host ("        got='{0}'" -f $g)         -ForegroundColor Yellow
}

Write-Host ""
if ($diffs -eq 0) {
  Write-Host "[PASS] $Category : matches reference ($($ref.Count) lines)" -ForegroundColor Green
} else {
  Write-Host "[FAIL] $Category : $diffs line(s) differ (tolerance $Tolerance)" -ForegroundColor Red
  exit 1
}
