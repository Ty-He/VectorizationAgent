You are an expert C programmer specializing in SIMD / auto-vectorization. Write ONE new function
`{{kernel}}_opt(void)` for the kernel below, following the analysis and hard rules. The function
will be spliced into `kernels/{{kernel}}.c` and compiled by clang with `-O3 -march=native`
(`TYPE` = double unless noted). Clang must ACTUALLY vectorize the hot loop (verified afterwards by
`-Rpass`), and the result must be identical to `{{kernel}}_orig()`.

## Kernel source file (current content)
{{source}}

The leading comment explains the obstacle and intended direction. `{{kernel}}_orig()` is the
correct reference you must reproduce numerically.

IMPORTANT ground truth: everything you need is in the source shown above. Do NOT guess or
reconstruct this kernel from memory of TSVC. Base your rewrite only on the given code.

## Previous attempts & feedback (empty on first try)
{{feedback}}

## Your last attempt code (revise this if provided, otherwise start fresh)
{{last_attempt}}

## Analysis produced earlier
{{analysis}}

## Proven experience from other kernels (optional hints)
{{experience}}

## Hard rules
1. Do NOT modify or delete `{{kernel}}_orig()`. Only ADD the new function `{{kernel}}_opt(void)`
   (same signature as orig: `int {{kernel}}_opt(void)`).
2. Keep the EXACT same outer repetition structure as orig (the `for (int nl = 0; nl < ...; nl++)`
   loop and its `dummy(...)` call, in the same place). Only transform what is INSIDE.
3. Do not change trip counts, NTIMES, LEN, or input/output semantics. Deterministic: no rand, no
   time, no concurrency.
4. Bit-exact result vs orig on the same input (except reductions where reassociation tolerance is
   allowed — only for reduction kernels like vdotr; keep the accumulation pattern exact otherwise).
5. Auxiliary buffers of size LEN/LEN2 must be declared `static` (do NOT put large arrays on the
   stack). Reusing a static buffer across calls is fine (called once).
6. If you add `#include <immintrin.h>` or similar, put those `#include` lines at the very top of
   your code block. Otherwise include nothing.
7. You MAY use `#pragma clang loop vectorize(enable)` on the hot loop if the loop is genuinely
   vectorizable after your rewrite, but the rewrite itself must remove the obstacle; do not rely on
   the pragma to fix an inherently serial loop.
8. The code must compile cleanly under `clang -O3 -march=native -DTYPE=double -DHAVE_{{kernel_upper}}_OPT`
   on Windows (no POSIX-only calls, no GNU extensions beyond what clang accepts; `__attribute__((always_inline))`
   is allowed if needed).
9. Do NOT output explanations, markdown, or multiple code blocks.
10. PERFORMANCE: these kernels are often memory-bandwidth limited. A rewrite that vectorizes by
    ADDING extra whole-array passes (e.g. copy b to a temp buffer, then a separate b-update loop,
    then a separate a loop) usually LOSES to the scalar baseline because it doubles memory traffic.
    Whenever possible, ELIMINATE the loop-carried dependence by algebraic substitution so that the
    new body reads ONLY old values and keep BOTH output statements in ONE vectorizable loop with no
    extra passes. Prefer single-pass rewrites.
11. READ/WRITE SAME ARRAY: if after substitution a body reads `arr[i]`/`arr[i+1]` and also writes
    `arr[i]`, clang WILL REJECT the loop unless you first copy the needed OLD elements into plain
    local variables BEFORE the writes, e.g.
        double bi = arr[i], bn = arr[i+1];
        out[i] = bi ...; arr[i] = bn ...;
    Always load old values into locals first; never leave the old-value read inline in the same
    expression as the store. Keep per-element arithmetic ops and their order identical to orig so
    results stay bit-exact.

## Output format
Return exactly ONE fenced C code block. The first line of the block is the function definition:
```
int {{kernel}}_opt(void)
```
Contained code = everything to add (includes first if any, then the function). Nothing else.
