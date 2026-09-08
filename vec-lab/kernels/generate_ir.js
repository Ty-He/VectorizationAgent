// generate_ir.js
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * 批量将目录下 *.c 编译生成 .ll (LLVM IR)
 * @param {string} srcDir        c源码目录
 * @param {string} outDir        ll输出目录
 * @param {string[]} includeDirs 头文件 -I 路径列表
 */
async function batchGenerateLL(srcDir, outDir, includeDirs) {
    // 确保输出目录存在
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    // 读取源目录全部文件
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    const cFiles = entries
        .filter(e => e.isFile() && path.extname(e.name).toLowerCase() === '.c')
        .map(e => e.name);

    console.log(`找到 ${cFiles.length} 个 .c 文件\n`);

    for (const filename of cFiles) {
        const cFullPath = path.join(srcDir, filename);
        const llFileName = path.basename(filename, '.c') + '.ll';
        const llFullPath = path.join(outDir, llFileName);

        // 组装 clang 参数
        const args = [
            '-O0',
            '-march=native',
            '-S',
            '-emit-llvm',
            '-DTYPE=double',
            ...includeDirs.map(p => `-I${p}`),
            cFullPath,
            '-o',
            llFullPath
        ];

        console.log(`[处理] ${filename}`);
        console.log(`clang ${args.join(' ')}`);

        const exitCode = await new Promise((resolve) => {
            const proc = spawn('clang', args);
            let stderrBuf = '';
            proc.stderr.on('data', (buf) => {
                stderrBuf += buf.toString();
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    console.error(`❌ ${filename} 编译失败:\n${stderrBuf}\n`);
                } else {
                    console.log(`✅ 输出: ${llFileName}\n`);
                }
                resolve(code);
            });
        });
    }
    console.log('全部任务完成');
}

// ========== 配置区，请修改这里 ==========
(async function main() {
    const SRC_DIR = '.';        // c源文件目录
    const OUT_LL_DIR = './out_ir';       // 输出ll目录
    const INCLUDE_PATHS = [
        '..'                       // common.h 所在头文件路径，可以多个
    ];

    await batchGenerateLL(SRC_DIR, OUT_LL_DIR, INCLUDE_PATHS);
})();
