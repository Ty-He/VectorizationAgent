// s1161_opt.c -- s1161 优化版(opt)单函数测试入口, 面向 node 程序。
//
// 编译 (仅编译该内核, 在 vec-lab 目录下执行):
//   clang -O3 -march=native -DTYPE=double -I. entry/s1161_opt.c common.c kernels/s1161.c -o s1161_opt.exe
//   kernels/s1161.c 实现 s1161_opt() 后追加 -DHAVE_S1161_OPT 启用真实优化版;
//   未定义该宏时链接本文件的占位, 输出 status=not_implemented。
// 运行输出 (单行 JSON):
//   {"kernel","mode":"opt","status","checksum","time",
//    "checksum_orig","time_orig","speedup","mismatches"}
//   status: ok | not_implemented | error
// 退出码: 0=ok且checksum一致, 1=不一致或error, 2=not_implemented
//
// 流程: 跑 orig 作参考 -> 快照 -> 相同输入重跑 opt -> 容差比对。
// 容差: 0 (位精确)。
#include "../common.h"

int s1161_orig(void);
int s1161_opt(void);                 /* 实现于 kernels/s1161.c */

#ifndef HAVE_S1161_OPT
/* 占位实现: 优化函数尚未提供时保证可链接 (约定返回 1 = 未实现) */
int s1161_opt(void) { return 1; }
#endif

int main(void)
{
  /* 1) orig 基线作参考 */
  lab_init_data(42u);
  lab_prepare("s1161");
  double t0 = lab_now();
  int rc_orig = s1161_orig();
  double t_orig = lab_now() - t0;
  TYPE cs_orig = lab_checksum();
  lab_snapshot();                    /* 保存 orig 结果供比对 */

  /* 2) 相同输入下运行 opt */
  lab_init_data(42u);
  lab_prepare("s1161");
  double t1 = lab_now();
  int rc_opt = s1161_opt();
  double t_opt = lab_now() - t1;

  /* 3) 容差比对 + JSON 报告 */
  return lab_report_opt("s1161", rc_orig, rc_opt, t_opt, cs_orig, t_orig, (TYPE)0.0);
}
