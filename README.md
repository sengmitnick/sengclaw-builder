# SengClaw Builder

`sengclaw-builder` 是 ReplyBot 的公开构建控制仓库，参考 [`qinglion/yuejuan-builder`](https://github.com/qinglion/yuejuan-builder) 的职责分离方式，把可审计的 CI、签名、公证和产物校验从私有产品源码中拆出来。

## 仓库边界

- `sengmitnick/replybot`：私有产品源码、Electron Forge 配置、License 官网和 Git LFS 运行资源。
- `sengmitnick/sengclaw-builder`：公开构建脚本和手动 GitHub Actions。
- License Production 私钥：只存在于官网服务的持久化密钥卷，绝不进入两个 Git 仓库、GitHub Secrets 或桌面客户端。

第一版只构建 Apple Silicon macOS DMG。成功产物保存为 GitHub Actions Artifact，不自动创建公开 Release。

## 首次启动顺序

官网首次部署不需要 Production License 密钥：

1. 部署 ReplyBot 官网与 PostgreSQL，挂载持久化 `/data` 卷。
2. 登录线上 `/admin`，初始化 `production` Ed25519 密钥。
3. 立即备份包含私钥的服务端密钥卷。
4. 只把 `production-public.pem` 和后台显示的固定指纹配置到 Builder。
5. 再运行首个正式桌面构建。

已发行客户端依赖这个 Production 信任根。官网迁移或灾备恢复必须恢复原密钥卷，不能重新初始化。

## GitHub Environment

正式任务使用 `macos-release` Environment。公开仓库只允许手动触发工作流，不为公开 Pull Request 提供发行 Secrets。

需要的 Secrets：

| Secret | 用途 |
| --- | --- |
| `REPLYBOT_DEPLOY_KEY` | 只读拉取私有 ReplyBot 源码和 LFS 对象的专用 Deploy Key |
| `DOKPLOY_DEPLOY_WEBHOOK` | ReplyBot Web 镜像发布成功后触发 Dokploy 生产部署的应用 Webhook |
| `BUILD_CERTIFICATE_BASE64` | Developer ID Application P12 |
| `P12_PASSWORD` | P12 导出密码 |
| `KEYCHAIN_PASSWORD` | 临时 CI 钥匙串密码 |
| `APPLE_SIGNING_IDENTITY` | Developer ID Application 匹配串；临时钥匙串只导入一张证书时可用 `Developer ID Application` |
| `APPLE_API_KEY_BASE64` | App Store Connect Team API Key P8 |
| `APPLE_API_KEY_ID` | Team API Key ID |
| `APPLE_API_ISSUER` | App Store Connect Issuer ID |
| `PRODUCTION_LICENSE_PUBLIC_KEY_BASE64` | Production License 公钥 |
| `PRODUCTION_LICENSE_PUBLIC_KEY_SHA256` | 官网显示的 `sha256:<hex>` 指纹 |

Production License 公钥的两个 Secrets 等官网部署并初始化后再配置；其余值可提前准备。

`REPLYBOT_DEPLOY_KEY` 是 Builder 仓库级 Secret，同时供官网镜像和 macOS 构建使用；对应公钥只以只读 Deploy Key 的形式安装在私有 ReplyBot 仓库。

## 官网生产镜像

`ReplyBot Web Image` 手动工作流从私有 ReplyBot 仓库读取指定 ref，完成测试、类型检查和 Web 构建后发布私有 Linux AMD64 镜像：

- `ghcr.io/sengmitnick/replybot-web:production`：Dokploy 使用的滚动生产标签。
- `ghcr.io/sengmitnick/replybot-web:sha-<commit>`：用于审计和回滚的不可变标签。

Dokploy 通过已有 GHCR Registry 拉取镜像。数据库 URL、管理员密码与 License 私钥均为运行时数据，不进入镜像。镜像发布成功后，工作流使用 `DOKPLOY_DEPLOY_WEBHOOK` 触发 Dokploy 部署；未配置该 Secret 时工作流会失败关闭，不会把“只推镜像、未部署”误报为成功。

## 本地校验

本地校验不需要发行凭据：

```bash
node --test tests/*.test.mjs
bash -n scripts/*.sh
```

正式签名与公证只能在配置完整 Secrets 的 Apple Silicon GitHub runner 上运行。

## 手动构建

完成 Secrets 后，在 GitHub Actions 选择 `ReplyBot macOS`，输入私有 ReplyBot 仓库中的分支、Tag 或 commit SHA。也可以使用 CLI：

```bash
gh workflow run replybot-macos.yml \
  --repo sengmitnick/sengclaw-builder \
  -f ref=main
```

工作流会执行源码测试、PostgreSQL 集成测试、arm64 打包、Developer ID 签名、Apple 公证、Gatekeeper/stapler 校验和 SHA-256 生成。DMG 挂载后还会检查 external 运行时依赖、解包后的 arm64 原生模块，并实际启动应用进行 10 秒主进程烟测；出现 `Cannot find module` 或未捕获 JavaScript 异常时构建失败。
