You are an expert C programmer specializing in hand-written SIMD (AVX2 intrinsics), working on the
INTRINSIC route. Write ONE new function `{{kernel}}_opt(void)` that implements the hot loop with
explicit `<immintrin.h>` intrinsics. This route is used only when plain-C rewrites and pragmas have
failed (e.g. reductions clang will never auto-vectorize, or a cost-model-rejected loop). The
function will be spliced into `kernels/{{kernel}}.c` and compiled by clang with
`-O3 -march=native -DTYPE=double`. Correctness is checked against `{{kernel}}_orig()` element-wise
(with reassociation tolerance allowed ONLY for reduction kernels like vdotr).

## Kernel source file (current content)
{{source}}

`{{kernel}}_orig()` is the correct reference you must reproduce numerically.
IMPORTANT ground truth: base your work only on the source above; never reconstruct this kernel
from memory of TSVC.

## Compiler remarks on the ORIG loop (baseline, from clang)
{{remarks}}

## Previous attempts & feedback (empty on first try)
{{feedback}}

## Your last attempt code (revise this if provided, otherwise start fresh)
{{last_attempt}}

## Analysis produced earlier
{{analysis}}

## Proven experience from other kernels (optional hints)
{{experience}}

## Type / ABI facts (hard, do not deviate)
- `TYPE` is `double`. Arrays `a..e, xx_buf` are `TYPE` (double) globals of length `LEN` (=32000).
  Use `__m256d` (4 doubles) intrinsics: `_mm256_loadu_pd/_mm256_storeu_pd`, `_mm256_set1_pd`,
  `_mm256_add/sub/mul_pd`, `_mm256_fmadd_pd`/`_mm256_fmsub_pd` (FMA allowed ONLY if the kernel is
  a reduction where small numeric difference is acceptable; otherwise use SEPARATE mul+add/sub to
  keep each element bit-identical to the scalar original).
- Use **unaligned** loads/stores (`loadu/storeu`); do not assume 32-byte alignment.
- Keep the EXACT outer repetition structure of orig (`for (int nl=...; nl++)` and its `dummy(...)`
  call, in the same place). Hand-vectorize only the inner loop.
- Do not change trip counts / NTIMES / LEN. Deterministic. No rand/time/concurrency.
- Any large auxiliary buffer must be `static`; small local scalars/`__m256d` are fine on the stack.
- Guard the SIMD region so it never reads/writes out of bounds: process a whole number of 4-element
  chunks, then finish the remainder with the scalar (original) loop or a scalar tail.
- Each chunk must produce results identical to orig per element for non-reduction kernels: mirror
  the scalar statement order/operators (no FMA contraction unless the kernel is a reduction).

## Reference pattern (reduction kernel, e.g. vdotr dot product)
```c
#include <immintrin.h>
int {{kernel}}_opt(void) {
  for (int nl = 0; nl < K; nl++) {
    __m256d acc = _mm256_setzero_pd();
    int i = 0;
    for (; i + 4 <= LEN; i += 4) {
      __m256d av = _mm256_loadu_pd(&a[i]);
      __m256d bv = _mm256_loadu_pd(&b[i]);
      acc = _mm256_fmadd_pd(av, bv, acc);   // allowed for reductions
    }
    double s = _mm256_reduce_add_pd(acc);    // or manual hadd
    for (; i < LEN; i++) s += a[i] * b[i];
    lab_result = s;
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
```
(If your clang version has no `_mm256_reduce_add_pd`, do the horizontal sum manually with
`_mm256_permute2f128_pd` + adds. For non-reduction kernels use the per-element pattern instead.)

## Hard rules
1. Do NOT modify or delete `{{kernel}}_orig()`. Only ADD `int {{kernel}}_opt(void)`.
2. Put `#include <immintrin.h>` (and nothing else) at the very top of your code block.
3. Must compile cleanly under `clang -O3 -march=native -DTYPE=double -DHAVE_{{kernel_upper}}_OPT`
   on Windows (AVX2 guaranteed by `-march=native`). Do not use AVX-512.
4. Do NOT output explanations, markdown, or multiple code blocks.

## Output format
Return exactly ONE fenced C code block; first line is `int {{kernel}}_opt(void)` (after any
`#include`). Contained code = everything to add. Nothing else.
