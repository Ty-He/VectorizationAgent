// vdotr -- 来源: TSVC (ControlLoops)
//
// 向量化障碍: 浮点归约 dot += a[i]*b[i]。默认浮点语义禁止重结合,
//             编译器不会自动向量化 FP 归约 (除非 -ffast-math 或手动变换)。
// 优化方向:   手动 SIMD (AVX2 FMA): 4 路 double / 8 路 float 向量累加 +
//             水平归约。归约顺序改变 -> 结果为容差内一致 (重结合)。
//
// TODO: 在本文件中添加 vdotr_opt() —— 人工变换后的可向量化版本。
#include "common.h"

int vdotr_orig(void)
{
  for (int nl = 0; nl < 10 * NTIMES; nl++) {
    TYPE dot = 0.;
    for (int i = 0; i < LEN; i++) {
      dot += a[i] * b[i];
    }
    lab_result = dot;
    dummy(a, b, c, d, e, aa, bb, cc, 0.);
  }
  return 0;
}
