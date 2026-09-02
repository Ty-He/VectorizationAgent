# vec-lab

从 TSVC benchmark 挑选的 10 个"编译器无法自动向量化"内核的实验场。
每个内核提供 `orig`（基线）与 `opt`（待 agent 实现的向量化版本），以单行 JSON 输出
**正确性（checksum）**与**性能（time）**指标，供 node 优化智能体编译并调用。

环境：`clang` 在 PATH 中（Windows）。`*.exe` 与 `*.opt.yaml` 均为编译产物，可随时删除重建。

## 目录结构

```
vec-lab/
├── common.h / common.c   公共框架: 确定性数据 lab_init_data(42)、快照/比对、计时、JSON 报告
├── kernels/<name>.c      内核: <name>_orig() + TODO(<name>_opt() 由 agent 实现)
├── entry/<name>_test.c   基线入口 (只跑 orig)
├── entry/<name>_opt.c    优化入口 (同进程先跑 orig 作参考, 再跑 opt 并容差比对)
└── docs/                 文档
    ├── USAGE.md          使用说明: 编译命令、JSON 格式、node 交互、向量化诊断
    ├── ENVIRONMENT.md    实验环境: 系统/编译器/TSVC版本 + 10个函数表
    └── ARCHITECTURE.md  架构设计: 分层结构、entry 机制、占位机制、容差约定
```

## 10 个内核

| 内核 | TSVC 类别 | 内核 | TSVC 类别 |
|------|-----------|------|-----------|
| s1161 | ControlFlow | s341 | Packing |
| s211 / s212 | StatementReordering | s421 | Equivalencing |
| s241 | NodeSplitting | s453 | InductionVariable |
| s292 | LoopRestructuring | s482 | ControlFlow |
| — | — | vdotr | ControlLoops |

每个内核的向量化障碍与优化方向详见 [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)。

## 快速开始

```powershell
# 基线入口 (orig 一定存在)
clang -O3 -march=native -DTYPE=double -I. entry/s1161_test.c common.c kernels/s1161.c -o s1161_test.exe
.\s1161_test.exe

# 优化入口 (opt 未实现时为占位, 输出 not_implemented)
clang -O3 -march=native -DTYPE=double -I. entry/s1161_opt.c common.c kernels/s1161.c -o s1161_opt.exe
.\s1161_opt.exe
```

更多用法（含向量化诊断、`-fsave-optimization-record`、node 程序交互）见 [docs/USAGE.md](docs/USAGE.md)。

## 文档导航

| 文档 | 内容 |
|------|------|
| [docs/USAGE.md](docs/USAGE.md) | 编译运行、JSON 格式、node 交互、clang 诊断（`-Rpass*` 与 `-fsave-optimization-record`） |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | 系统信息、编译器版本、TSVC 来源、10 个函数的障碍与优化方向 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层结构、公共框架、entry 机制、占位机制、容差约定 |
