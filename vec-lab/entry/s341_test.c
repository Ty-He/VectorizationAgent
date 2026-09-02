// s341_test.c -- s341 基线(orig)单函数测试入口, 面向 node 程序。
//
// 编译 (仅编译该内核, 在 vec-lab 目录下执行):
//   clang -O3 -march=native -DTYPE=double -I. entry/s341_test.c common.c kernels/s341.c -o s341_test.exe
//   可追加 clang 选项获取向量化诊断, 如 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize
// 运行输出 (单行 JSON): {"kernel","mode":"orig","status","checksum","time"}
//   status: ok | error
// 退出码: 0=ok, 1=error
#include "../common.h"

int s341_orig(void);

int main(void)
{
  lab_init_data(42u);              /* 确定性输入 */
  lab_prepare("s341");             /* 内核数据特化 (目前仅 s482 有效) */
  double t0 = lab_now();
  int rc = s341_orig();
  double dt = lab_now() - t0;
  return lab_report_orig("s341", rc, dt);
}
