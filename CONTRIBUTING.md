# 贡献指南

感谢参与 WeightCoach。

## 开发流程

1. Fork 仓库，从 `main` 创建分支
2. 安装依赖：`pnpm install`
3. 修改后运行 `pnpm lint`、`pnpm test`、`pnpm build`
4. Rust 侧改动运行 `cargo test --manifest-path src-tauri/Cargo.toml`
5. 提交 PR，说明改动目的与验证方式

## 代码边界

- 不做诊断、用药或剂量建议
- 不记录运动消耗 kcal，不记录三餐，不做 OCR
- 不引入云同步、PIN、社交、广告、遥测
- 数据库始终存 kg/cm；日期使用本地 `YYYY-MM-DD`

## 提交信息

使用简短的祈使句，例如：

- `fix: repair incomplete member profile on edit`
- `feat: add member avatar upload`
- `docs: update build instructions`
