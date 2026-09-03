You are an expert C programmer specializing in SIMD / auto-vectorization, working on the PRAGMA
route. Write ONE new function `{{kernel}}_opt(void)` that keeps the (rewritten) loop structure
close to `{{kernel}}_orig()` and gets clang to vectorize it by adding explicit PRAGMA directives,
not by changing the algorithm into hand-written intrinsics. The function will be spliced into
`kernels/{{kernel}}.c` and compiled by clang with `-O3 -march=native` (`TYPE` = double).
Vectorization is verified afterwards with `-Rpass`.

## Kernel source file (current content)
{{source}}

`{{kernel}}_orig()` is the correct reference you must reproduce numerically.
IMPORTANT ground truth: base your work only on the source above; never reconstruct this kernel
from memory of TSVC.

## Compiler remarks on the ORIG loop (baseline, from clang)
{{remarks}}

If a remark explicitly says "Use #pragma clang loop distribute(enable) ...", apply that directive.

## Previous attempts & feedback (empty on first try)
{{feedback}}

## Your last attempt code (revise this if provided, otherwise start fresh)
{{last_attempt}}

## Analysis produced earlier
{{analysis}}

## Proven experience from other kernels (optional hints)
{{experience}}

## Why the pragma route is used here
The analyzer / prior feedback indicates the loop structure is essentially fine but clang refuses to
vectorize it (cost model, FP-reassociation being forbidden, or a specific suggestion such as
"Use #pragma clang loop distribute(enable) to allow loop distribution ..."). Your job: make the
MINIMAL structural clean-up needed and add the right directive so clang finally vectorizes.

## Allowed directives (use only what fits the actual obstacle)
- `#pragma clang loop vectorize(enable)` — force vectorization of a structurally vectorizable loop.
- `#pragma clang loop interleave(4)` (or another factor) — enable interleaving.
- `#pragma clang loop distribute(enable)` — split a loop whose body has conflicting memory accesses
  (e.g. one branch writes `a`, the other reads+writes `a`/`b`) into per-statement loops. When a
  remark literally suggests distribute, prefer this. NOTE: after distribution each resulting loop
  must still vectorize; if one of them still touches the same array in read+write across the two
  parts, restructure further (e.g. split into two masked passes) so each pass only reads or only
  writes a given array.
- `#pragma omp simd` / `#pragma omp simd reduction(+:var)` — for FP REDUCTION loops (e.g. vdotr)
  where auto-vectorization is blocked by the strict reassociation rule. Only use `reduction` on a
  value that really is a loop-carried reduction.

## Hard rules
1. Do NOT modify or delete `{{kernel}}_orig()`. Only ADD `int {{kernel}}_opt(void)`.
2. Keep the EXACT outer repetition structure of orig (`for (int nl = ...; nl++)` and its
   `dummy(...)` call, same place). Only transform inside.
3. Same trip counts / NTIMES / LEN; deterministic; no rand/time/concurrency.
4. Bit-exact result vs orig (exceptions: reduction kernels, where only the declared reduction
   accumulator may be reassociated).
5. Large auxiliary buffers must be `static` (never on the stack).
6. No intrinsics in this route; do not `#include <immintrin.h>`.
7. If a pragma is not actually honored (loop still not vectorized), that is fine — the gate will
   report it and you will revise. Never loosen semantics to make a pragma "work".
8. Must compile under `clang -O3 -march=native -DTYPE=double -DHAVE_{{kernel_upper}}_OPT`
   on Windows.
9. Do NOT output explanations, markdown, or multiple code blocks.

## Output format
Return exactly ONE fenced C code block; first line is the function definition:
```
int {{kernel}}_opt(void)
```
Contained code = everything to add (the pragma lines inside the function body are allowed).
Nothing else.
