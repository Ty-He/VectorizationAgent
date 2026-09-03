# 智能体驱动的自动向量化优化系统

设计并实现一个面向自动向量化优化的智能体系统。智能体自动完成向量化机会识别、向量化代码生成、
正确性验证与性能对比等任务。以 TSVC 基准集为对象，选取 10 个无法被编译器自动向量化的函数
（见 [vec-lab](vec-lab/README.md)）进行自动优化探索，校验正确性并对比性能，沉淀可复用经验。

> 当前结果：7/10 内核在无人值守跑中达到 ≥1.15x（最高 vdotr 7.38x、s453 5.47x）；
> s1161/s341 可向量化但性能无收益（no-gain 留存）；s421 确有收益（~1.45x 已有实现）
> 但自动化复现不稳定。方法学与逐内核说明见 [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md)。

## 文档导航

| 文档 | 内容 |
|------|------|
| [docs/AGENT_SYSTEM.md](docs/AGENT_SYSTEM.md) | 模块功能、单次任务的执行流程、命令速查 |
| [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) | 10 内核实验结果汇总、方法学、no-gain 专项说明 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 项目现状总结与"候选多样性"开发规划 |
| [vec-lab/](vec-lab/README.md) | C 实验场说明 |

## 组织

```
vectorizer_agent/
├── vec-lab/          C 实验场: 10 个内核 (orig 基线 + opt 待实现), 单行 JSON 报告
├── TSVC/             TSVC 基准集原版 (参考, 运行时不需要)
├── test/             个人命令测试片段
├── src/              agent 实现 (node)
│   ├── cli.js          入口: `node src/cli.js <kernel|all>`
│   ├── agent/          driver 固定阶段编排 + 运行状态
│   ├── llm/            DeepSeek (OpenAI 兼容) client + prompt 模板 + 输出 schema
│   ├── tools/          确定性工具: 编译 / remark 解析 / 基准 / 源码改写 / 验证
│   ├── memory/         向量化经验沉淀与检索
│   ├── experiment/     每内核运行记录与结果
│   └── utils/
├── prompts/          analyze / generate / reflect 模板
├── experiments/      运行产物 (state.jsonl, result.json 等, git 忽略)
├── memory/           经验存储 (git 忽略)
├── scripts/          工具脚本 (smoke.js 等)
└── package.json
```

## 系统流程

driver 对单个内核按固定阶段编排（详见 [src/agent/driver.js](src/agent/driver.js)）：

```
baseline(orig 编译运行+remark)
   → analyze(LLM: 障碍/策略/理由)
   → generate(LLM: 生成 <kernel>_opt())
   → compile & correctness(opt 入口, 容差比对 mismatches==0)
   → vectorization confirm(remark Passed, VF>=2)
   → benchmark(best-of-N 分进程计时, speedup)
   → accept(正确+向量化+speedup>=阈值) 或 reflect(LLM) 重试(预算内)
   → 沉淀经验, 输出 result.json
```

目标：`node src/cli.js s211` 即可无人值守自动完成单个内核的向量化优化，无需对话引导。

## 快速开始

```powershell
npm install
node src/cli.js s211        # 优化单个内核
node src/cli.js all         # 依次优化全部内核
```

实验场编译/运行/诊断约定见 [vec-lab/docs/USAGE.md](vec-lab/docs/USAGE.md)。

## 提交物

- [x] 完整源代码
- [x] 10 个函数的向量化前后性能对比数据（`experiments/results.csv`，方法学见 docs/EXPERIMENTS.md）
- [ ] 项目展示 PPT
- [ ] 设计报告（含系统架构、实验分析）
