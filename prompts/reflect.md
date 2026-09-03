You are an expert in compiler auto-vectorization debugging. Your previous generated
`{{kernel}}_opt()` failed one of the acceptance gates. Diagnose WHY and decide the next move.

IMPORTANT: analyze the actual source shown below, never reconstruct the kernel from memory of
TSVC. Keep reasoning short and answer promptly.

TERSENESS: your entire reply must be SHORT (roughly under 500 words / 700 tokens). Do not restate
code; write `concrete_fixes` as a few imperative bullet phrases. If you cannot finish, still output
the single JSON object now.

## Current kernel source (with the failed opt attempt spliced in)
{{source}}

## Original analysis
{{analysis}}

## What failed (gate results for this attempt)
{{feedback}}

Possible gates and typical causes:
- COMPILE ERROR: syntax/type/missing decl/duplicate symbol/static-buffer misuse.
- WRONG RESULT (mismatches>0): off-by-one boundary, stale static buffer, wrong old/new value used,
  remainder mishandled, alias not actually removed, or the transform changed semantics.
- NOT VECTORIZED: clang remark for `{{kernel}}_opt` shows no `!Passed loop-vectorize`; the rewrite
  kept a serial dependency, or the loop is memory/cost-model rejected, or code is too complex.
- TOO SLOW (speedup < {{threshold}}): vectorized but no gain (overhead/registers/memory-bound), or
  the measured kernel is not the one you intended to speed up.

## Output (JSON only, no prose)
{
  "root_cause": "<single most likely reason, citing code lines from the attempt>",
  "evidence": ["<bullet(s) linking the failure message to the cause>"],
  "next_action": "revise-code|switch-strategy|give-up",
  "concrete_fixes": ["<specific edits to apply: replace line X by ..., rewrite the buffer scheme ..., peel iteration 0 ..., split loop into ...>"],
  "new_strategy_if_any": "<if switching strategy: name it>",
  "notes": "<anything the code generator must be careful about this round>"
}
Be concrete and surgical. Prefer small edits to a mostly-correct attempt over a full rewrite,
unless the whole approach is wrong.
