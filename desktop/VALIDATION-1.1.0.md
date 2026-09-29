# 桌面版 1.1.0 验证记录

日期：2026-09-29。目标为 Windows x64；构建主机为 macOS arm64。本文件随本轮打包更新，不能作为 Windows 实机认证。

## 本轮内容

- 纳入最新五阶段重建、降噪、四个联动观察屏、修补量视图及项目恢复。
- 保留首页单颗磨牙、四个产品入口及双微流程。
- STL Worker 使用生产打包的同源资源，不使用 file:// URL。
- 桌面版本升至 1.1.0；appId、用户目录及项目格式版本保持不变。旧 1.0.0 安装包保留。

## 已执行

- TypeScript 检查、网页生产构建、桌面生产资源构建通过。
- 桌面行为测试 8/8、重建几何与状态测试 4/4、网页渲染测试 7/7 通过。
- 浏览器模型加载测试 3/3 通过：默认模型、上传/刷新/跨页和 Worker 失败重试。
- macOS 15.3.1 arm64、Electron 44.3.0 的完整桌面自动化通过（`dist-desktop/qa/report.json`）：独立启动及进程隔离、非法/超大 STL 提示、自定义 STL 原字节保存、完整重建和双微流程、最小化暂停、关闭后端口释放、项目重启恢复、中文/空格路径打开、125% 缩放、画质切换和三轮跨页检查。未观察到外网资源请求或渲染器错误。
- 已检查本次桌面截图。性能仅为运行时采样，不能将截图期间的帧率作为稳定基准，也不据此宣称 Windows 性能通过。

## 打包与运行验证

- Windows x64 NSIS 安装包已交叉构建：`release/Yibei-Medical-1.1.0-x64-Setup.exe`，100,995,482 字节（约 96.3 MiB）。没有公开发布安装包。
- SHA-256：`dec4579173fe5040ce655794336283ce10585d4632a930424fdafcdd16e2f940`。
- Electron 44.3.0 Windows 运行时从 npmmirror 镜像下载，使用已安装 Electron 官方 npm 包中的 checksums.json 核验，SHA-256 为 `26bf9a617d58d81772b3d68305d59ee48272969c15083c06db634a77358a8d9d`。
- `pnpm desktop:verify-package` 通过：应用 PE 架构为 x64；应用及安装器的签名目录为空（未签名）；包内默认模型、Logo 与源资源字节一致，所有渲染资源/主进程/本地服务与本轮生产输出字节一致，无旧构建混入。ASAR 条目共 27 项，不含开发依赖及废弃模型。
- 直接解开 NSIS 的 app-64.7z，提取其中 app.asar，与待打包归档逐字节比较相同。
- 使用 macOS Electron 加载本轮 Windows 打包的 app.asar：重建步骤保存/重启恢复、中文和空格路径、125% 缩放检查通过，无外网请求和渲染器错误。这是跨平台应用资源验证，不是 Windows 原生执行。

机器可读结果在 `release/package-verification-1.1.0.json`、`dist-desktop/qa/report.json` 和 `test-results/reconstruction-desktop/report.json`。校验文件在 `release/SHA256SUMS-1.1.0.txt`。用户指南副本及本报告与安装包同目录交付。

## 验证边界

尚无 Windows 10/11 实机环境，安装、卸载、覆盖升级及 Windows 显卡性能仍需按 `WINDOWS_VALIDATION.md` 验收。macOS Electron 运行测试不等同于 Windows EXE 运行测试。未配置代码签名证书；不公开上传安装包，不创建公开 Release。
