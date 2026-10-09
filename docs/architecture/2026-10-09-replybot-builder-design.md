# SengClaw Builder 与 ReplyBot 发布设计

**日期：** 2026-10-09  
**状态：** 已确认

## 目标

建立公开仓库 `sengmitnick/sengclaw-builder`，集中承担 ReplyBot 的 Apple Silicon macOS 构建、签名、公证、校验和产物保存。ReplyBot 产品仓库保持私有并移除自身 GitHub Actions，使产品源码与发布控制面分离。

## 仓库边界

`sengmitnick/replybot` 是私有产品源码仓库，保存桌面客户端、License 官网、Forge 打包配置和运行依赖。它不运行发布工作流，也不保存 Apple 凭据、License 私钥或 CI 专用访问令牌。

`sengmitnick/sengclaw-builder` 是公开构建仓库，保存可审计的构建脚本、GitHub Actions 和发布说明。仓库公开不代表构建凭据公开；所有敏感值只存在于 `macos-release` GitHub Environment Secrets 中。

## 构建流程

构建由具备仓库写权限的人手动发起，并指定 ReplyBot 的 Git ref。Builder 使用只读、仅限 ReplyBot 仓库的细粒度令牌拉取私有源码和 Git LFS 资源，安装锁定依赖，运行测试与类型检查，然后调用 ReplyBot 自身的 Forge 配置生成 arm64 DMG。

正式构建必须取得 Developer ID Application 证书、App Store Connect Team API Key，以及 Production License 公钥和固定指纹。任一材料缺失、Production 公钥与 development 公钥相同、签名失败、公证失败、Gatekeeper 校验失败或 stapler 校验失败时，构建立即失败，不上传看似正式的产物。

成功后生成 DMG 和 SHA-256，只上传为 GitHub Actions Artifact。第一阶段不自动创建公开 GitHub Release，也不上传第三方对象存储。

## License 密钥启动顺序

License 官网首次部署不依赖 Production 密钥。它先以空的持久化密钥卷启动，管理员登录线上后台后显式初始化 Production Ed25519 密钥。私钥只留在官网持久化卷，立即纳入加密备份；公钥和指纹随后写入 Builder Secrets，之后才能进行首个正式桌面构建。

因此部署顺序是：先部署官网，再初始化 Production 密钥，再配置 Builder，最后发行客户端。官网迁移或灾备恢复必须恢复原密钥卷，不得为已发行客户端重新生成信任根。

## 大文件策略

ReplyBot 中超过 GitHub 普通对象限制的 Chromium 和向量模型使用 Git LFS 管理。Builder 拉取源码时必须启用 LFS，并在构建前验证关键资源存在且校验通过。编译输出、DMG、临时钥匙串、Apple API Key、P12 和暂存的 Production 公钥不进入 Git 历史。

## 安全边界

- Builder 仅接受手动触发，不在公开 Pull Request 上运行带 Secrets 的任务。
- `REPLYBOT_REPO_TOKEN` 仅拥有私有 ReplyBot 仓库的 Contents 只读权限。
- Apple `.p8`、`.p12`、密码和令牌仅在临时 runner 文件或钥匙串中存在。
- Production License 私钥永远不进入 Builder、桌面客户端、GitHub Secrets 或构建产物。
- Production License 公钥虽然不是秘密，仍通过固定指纹防止误配和信任根漂移。

## 失败与恢复

Builder 对输入 ref、架构、凭据、源码测试和最终产物逐层校验。失败时保留 GitHub Actions 日志，但日志不得输出 Secret 内容。临时钥匙串和凭据文件依赖临时 runner 生命周期销毁。

Git LFS、私有仓库访问或 Apple 服务不可用时，工作流明确失败并停止发布。重新运行必须使用同一个源码 ref，避免把重试变成未审计的新版本。

## 验收标准

1. `sengmitnick/sengclaw-builder` 为公开仓库，`sengmitnick/replybot` 为私有仓库。
2. ReplyBot 仓库不包含 GitHub Actions 工作流。
3. Builder 可以针对指定 ReplyBot ref 完成测试、arm64 打包、Developer ID 签名和 Apple 公证。
4. 未配置 Production License 公钥时，官网可以部署，但正式桌面构建失败关闭。
5. 构建产物通过严格代码签名、Gatekeeper、stapler、DMG 完整性和 SHA-256 校验。
6. Git 历史和 Actions 日志不包含 License 私钥、Apple 私钥或访问令牌。
