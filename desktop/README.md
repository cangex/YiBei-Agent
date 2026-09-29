# 益贝医疗智能体桌面版

本次只增加离线桌面运行与项目能力，复用当前单颗磨牙首页、重建与双微组件。不包含真实 AI 推理、修复后 STL 输出或临床仿真服务。网页 vinext / Cloudflare 构建保持独立。

## 架构

| 层 | 实现 |
| --- | --- |
| 窗口 | Electron 44.3.0，单实例、中文菜单、原生窗口控制 |
| 页面 | 独立 Vite SPA 入口，直接复用 React / Three.js 产品组件 |
| 本地资源 | Electron 主进程中的 Node HTTP 服务，127.0.0.1、随机端口、进程退出即释放，无服务子进程 |
| 安全 | sandbox + contextIsolation，关闭 Node 集成，有限 preload API，IPC 发起方校验；本地 HTTP 校验随机会话头、Host、Origin；拒绝运行时外网请求 |
| STL | 格式和体积校验，独立 Worker 解析，组件卸载时取消请求和终止解析线程 |
| 项目 | 原始 STL 内容哈希命名，原子替换 JSON 清单，串行保存队列；1 秒自动保存、显式保存和关闭握手 |
| 性能 | 保留全部业务特效；三档像素比与帧率策略、窗口不可见时暂停循环，卸载时释放 WebGL 上下文 |
| 网页模型交接 | 浏览器 IndexedDB 保存原始 File 与状态，页面恢复时生成本次会话的 Blob URL，用完释放；URL 本身不是模型存档 |

没有启动 Cloudflare Worker、vinext 开发服务器、远程网页或固定 localhost:3000。无需在客户电脑安装运行时或开发环境。

## 开发与构建

维护电脑需 Node.js 22.13+（建议当前 22 LTS 补丁版）和 pnpm。客户电脑不需要。

```sh
pnpm install
pnpm typecheck
pnpm desktop:test
pnpm desktop:build
pnpm desktop:start

# 原网页构建及已有检查
pnpm test

# Windows x64 安装包；不上传、不创建 GitHub Release
pnpm desktop:pack:win
pnpm desktop:verify-package

# 当前宿主上的真实 Electron UI 自动化与截图
pnpm desktop:qa

# 可选 macOS 本地已打包资源检查
pnpm desktop:pack:mac
```

网页命令 `dev/build/start` 保持原样，包括原有 Unix 环境变量语法；Windows 桌面构建命令没有此依赖。`desktop:build` 不读取 .openai 云端绑定或运行时凭据。

维护目录：

- `desktop/main.mjs` / `preload.cjs`：主进程、窗口与有限 IPC。
- `desktop/lib/`：纯 Node 项目存储、安全静态服务及 STL 校验。
- `desktop/renderer.tsx`：桌面导航、轻量项目操作栏、保存/恢复。
- `desktop/build.mjs`：生成生产 SPA、打包资源与多尺寸 ICO。
- `desktop/electron-builder.yml`：Windows NSIS 安装器，用户级安装，可选路径，桌面和开始菜单快捷方式，卸载保留数据。
- `desktop/tests/`：真实读写、坏文件、路径和服务行为测试。
- `desktop/qa.mjs`：窗口、文件导入、完整流程、重启、缩放与截图自动化。
- `dist-desktop/app/`：只含客户运行所需的生产文件。
- `release/`：Windows 安装包、未打包 Windows 程序、校验文件。

所有构建输出及测试用户数据都不提交 Git。不会把服务端密码、GitHub 令牌或证书放入安装包。安装包的应用 archive 不含 node_modules、废弃牙弓、旧主页实验组件、源码映射或开发缓存。

## 离线与项目格式

首次打开自动创建默认项目。原始 STL 写入新的哈希文件，不覆盖外部输入。每个 `project.yibei` 包含格式版本、UUID、名称、时间、输入文件元数据及 SHA-256、重建步骤和进度、双微候选方案及各区域配置、当前选中方案和区域。

`algorithm` 明确为 `frontend-deterministic-demo-v1`，`generatedData` 为 `[]`。实际保存的是原始几何与演示参数，不能把它当成真实计算后的网格结果。未来接入真实算法时需增加独立生成数据条目和显式格式迁移。

模型校验失败、损坏项目、不支持版本或无写权限时给出错误，不静默覆盖。原子 JSON 文件使用同目录临时文件、flush 后 rename；文件系统/磁盘故障仍需备份。最多可能丢失最后一次自动保存后的进度。

默认数据目录：Windows `%APPDATA%\YiBeiMedical`；macOS `~/Library/Application Support/YiBeiMedical`。日志位于其 `logs/desktop.log`。用户选择的完整项目目录也可直接打开，更新与卸载不改写这些目录。

## 安装与升级

当前版本：1.1.0。Windows 产物：`release/Yibei-Medical-1.1.0-x64-Setup.exe`。NSIS 启动器自身为 32 位属于正常情况；其中的应用主体为 Windows x64，验证脚本检查 PE 机器类型。

当前是**未签名测试安装包**。构建器可能打印 “signing with signtool.exe”，不表示已经签名；以 PE 签名目录及 Windows 的 `Get-AuthenticodeSignature` 结果为准。未配置签名证书，不应伪造可信发布者，也不建议让客户关闭安全防护。

手动升级时先保存、关闭软件，再安装新版本。保持 `appId` 与 `YiBeiMedical` 用户目录不变。更新版本号应同时修改 `desktop/build.mjs` 的桌面包版本、用户指南与验证报告，重新生成安装包和校验值。自动更新尚未启用，未来可在主进程内接入经过签名与校验的更新模块；当前不会联网检查更新。

详细客户操作见 `USER_GUIDE.md`；Windows 实机核对表见 `WINDOWS_VALIDATION.md`。1.1.0 执行记录见 `VALIDATION-1.1.0.md`，`VALIDATION.md` 保留 1.0.0 历史记录；不能以 macOS 自动化通过代替 Windows 实机验收。

## 参考规范

- Electron 进程隔离与 IPC 安全依据：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)。
- Windows 安装器配置依据：[electron-builder NSIS](https://www.electron.build/nsis/)。
