# 减重提醒 · WeightCoach

Windows 桌面端的家庭减重记录工具：体重 / 腰围 / 运动打卡、用药提醒、趋势与周复盘、天气驱动的本周计划、饮食建议，以及可选的 AI 解释。

> 只做记录、提醒与生活方式建议，不做诊断、用药或剂量建议。

![应用图标](src-tauri/icons/icon-source.png)

## 功能

- **家庭多用户**：成员切换、独立档案与目标、头像、归档/删除
- **轻量记录**：体重、腰围、运动「是/否」打卡，不计算运动消耗
- **用药管理**：多时段、三态打卡、依从率
- **趋势与复盘**：体重/腰围/运动/用药六项指标，可追溯到原始记录
- **本周计划**：天气适宜度、7 天室内/户外安排、禁忌过滤、手动替换/锁定
- **饮食建议**：目标能量、宏量分配、疾病相关约束、替换与购物清单
- **可选 AI**：DeepSeek / 豆包 / 千问，Key 存 Windows 凭据管理器，月度预算
- **本地优先**：SQLite 存本机，无云同步、无遥测、无广告

## 技术栈

- Tauri 2 + Rust
- React 18 + TypeScript + Vite 5
- Tailwind CSS 3
- SQLite（`tauri-plugin-sql`）
- Recharts、TanStack Query、Zustand、Zod
- Vitest（114 条单元测试）

## 开发

环境：Windows 10/11 x64、Node.js 20+、pnpm 9+、Rust stable（MSVC）、Visual Studio Build Tools 2022、WebView2 Runtime。

```bash
pnpm install
pnpm tauri dev      # 开发运行
pnpm test           # Vitest
pnpm lint           # ESLint
pnpm build          # tsc + Vite 生产构建
pnpm tauri build    # 生成 Windows NSIS 安装包
```

## 数据与隐私

- 默认数据目录：`%APPDATA%\WeightCoach\`
- 若当前账户不可写，自动回退到 `%LOCALAPPDATA%\WeightCoach` 或程序目录下 `WeightCoachData`
- 数据库：`weightcoach.db`；自动备份保留 7 份
- AI Key 只存 Windows 凭据管理器，仓库、数据库、导出包均不含明文 Key
- 除 AI 与天气请求外不联网；断网时记录、提醒、趋势、周报、饮食可用

## 下载安装

在 [Releases](../../releases/latest) 下载 `减重提醒_0.1.0_x64-setup.exe`。

安装包未做代码签名，Windows SmartScreen 可能提示“未知发布者”，请点“更多信息 → 仍要运行”。

## 目录

```
src/            前端（features / domain / db / lib / components）
src-tauri/      Rust 壳、SQLite 迁移、托盘与定时器
tests/          Vitest 单元测试
scripts/        图标生成等开发脚本
```

## 许可

[MIT](LICENSE)

图标由项目所有者提供并随项目使用；如需替换，请更新 `src-tauri/icons/` 下的 PNG/ICO（窗口、托盘、安装包共用）。
