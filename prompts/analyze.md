You are an expert in compiler auto-vectorization (LLVM/clang). Your job is to analyze one C
kernel taken from the TSVC benchmark and decide how to make its hot loop auto-vectorizable by
clang at `-O3 -march=native`, WITHOUT changing the numerical result.

IMPORTANT ground truth: the kernel source and the compiler remarks below are the ONLY source of
truth. Do NOT guess or reconstruct this function from memory of TSVC — base every claim strictly
on the code and remarks given here.

## Input

### Kernel source file
{{source}}

This is `kernels/{{kernel}}.c`. It contains `{{kernel}}_orig()` (the faithful original that clang
CANNOT vectorize) and its leading comment records the suspected obstacle and direction (a human
hint, verify it yourself against the code).

### Compiler remarks (clang loop-vectorize) on the ORIG function
{{remarks}}

These are structured clang `-Rpass` records for `{{kernel}}_orig`. A `!Missed`/`!Analysis`
record of Pass `loop-vectorize` means the loop was rejected; its text explains why.

## Task
Read the actual loop body in the source (do not trust only the header comment). Identify exactly
why the inner loop is rejected by the vectorizer (dependency type, induction var, control flow,
reduction order, aliasing, etc.). Then choose ONE concrete, minimal transformation strategy that
would let a later code-generation step produce a vectorizable `{{kernel}}_opt()`.

## Rules the strategy MUST obey
- The opt loop must have the SAME trip counts and SAME number of NTIMES repetitions as orig
  (only the inner-loop body / local data layout may change). No algorithmic trip-count reduction.
- Numerical result must stay identical (double, bit-exact unless the kernel is a reduction) for
  the same deterministic input. Do NOT suggest `-ffast-math`, changing types, or loosening semantics.
- Prefer transformations the model can reliably express in plain C that clang then vectorizes:
  loop splitting/fission, peeling, if-conversion to structured code, scalar->array expansion with a
  `static` buffer, induction-variable removal, translation to an equivalent vectorizable form.
  Hand-written intrinsics (immintrin) only when plain-C rewrites cannot work (e.g. reductions).

## Output (JSON only, no prose)
{
  "kernel": "{{kernel}}",
  "orig_function": "{{kernel}}_orig",
  "opt_function": "{{kernel}}_opt",
  "vectorizable": true,
  "category": "one of ControlFlow|StatementReordering|NodeSplitting|LoopRestructuring|Packing|Equivalencing|InductionVariable|Reduction|Aliasing|Other",
  "obstacle": "<precise statement of what blocks vectorization, citing the exact statements/indices>",
  "obstacle_kind": "true-dep|anti-dep|control-flow|induction|reduction|aliasing|other",
  "strategy": "<one-sentence name of the chosen transform>",
  "transform_plan": ["<step 1>", "<step 2>", "... several concrete steps the code generator must follow>"],
  "risk_notes": "<edge cases: boundaries, buffers, exactness, remainder handling>",
  "performance_notes": "<memory-traffic estimate: will the plan add whole-array passes? If the loop is memory-bound, the transform MUST avoid multi-pass rewrites and instead remove the dependence by substitution so all reads are old values in a single loop>"
}
