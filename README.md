# SengClaw Builder

`sengclaw-builder` 是多应用共用的公开构建平台，ReplyBot 是第一个接入应用。参考 [`qinglion/yuejuan-builder`](https://github.com/qinglion/yuejuan-builder) 的职责分离方式，把可审计的 CI、签名、公证和产物校验从私有产品源码中拆出来。

## 应用与运行方式

| 应用/构建配置 | 运行位置 | 凭据与产物边界 |
| --- | --- | --- |
| ReplyBot macOS / Web | Builder 手动工作流 | 沿用 `macos-release` Environment、ReplyBot 专用 Deploy Key 和既有公开 Release 策略 |
| Hub / Tauri＋Python macOS、Windows | Builder 手动运行 `hub-desktop.yml` | Hub 专用只读 Deploy Key；Mac 复用 `macos-release` 的 Apple 凭据；安装包下载需显式开启，不创建 Release |

Hub 云端服务镜像继续由私有 `sengclaw-hub` 的 `publish-hub.yml` 构建并推送 ACR，不迁移到本仓库。这是用户确认的分工，客户端与服务器无需共用构建位置。

构建实际运行在公开 Builder，私有产品库仅提供源码。不能由私有库调用 reusable workflow 代替迁移，那样仍计入私有调用方额度。每个应用使用独立只读源码凭据，日志是公开的；不上传源码、配置或凭据。Hub 安装包需要手动开启 `upload_installers`，默认关闭，保留 7 天。详细边界见 [多应用构建边界](docs/architecture/2026-11-03-multi-application-builder.md)。下文的 License、数据库和公开 Release 流程仅适用于 ReplyBot。

### Hub 构建

在 Builder 配置仓库级 `HUB_DEPLOY_KEY`，公钥只以只读 Deploy Key 安装在 `sengmitnick/sengclaw-hub`。Apple 凭据复用本仓库既有 `macos-release` Environment，无需再复制到 Hub。手动输入 Hub main 上的完整 40 位 SHA：

```sh
gh workflow run hub-desktop.yml --repo sengmitnick/sengclaw-builder \
  -f source_sha=<Hub完整提交SHA> -f platform=macos -f upload_installers=false
```

`platform` 可选 `macos`、`windows`、`both`。Mac 为 arm64 正式签名公证包；Windows 为 x64 SSL.com Authenticode 签名包。成功构建不等于客户实机交互验收。确认允许公开下载安装包后再将 `upload_installers` 设为 `true`。

Windows 使用独立的 `windows-release` Environment，配置 `ES_USERNAME`、`ES_PASSWORD`、`CREDENTIAL_ID`、`ES_TOTP_SECRET` 四项 Secrets（不是 Variables）。建议限制 main 分支并设置发布审批；不要发送或提交秘密。构建通过固定 SHA 的 SSL.com 官方适配器，在 Tauri 打包过程中签署主程序、sidecar、卸载程序及安装包，并验证有效时间戳。签名错误不会回退到未签名包。公开日志不输出适配器原始命令或结果。

上传前，在 Windows runner 的全新含空格目录执行 NSIS 静默安装，核对安装后的程序/sidecar/卸载程序签名及签名者一致性，运行已安装 sidecar `--help`，生成 `hub-windows-receipt.json`（含 SHA256）。只上传安装包和该回执，保留 7 天，不创建公开 Release。此检查不替代客户电脑的 GUI、权限和登录验收；签名也不保证消除 SmartScreen 提醒或解决所有写入错误。

## 仓库边界

- `sengmitnick/replybot`：私有产品源码、Electron Forge 配置、License 官网和 Git LFS 运行资源。
- `sengmitnick/sengclaw-builder`：公开构建脚本和手动 GitHub Actions。
- License Production 私钥：只存在于官网服务的持久化密钥卷，绝不进入两个 Git 仓库、GitHub Secrets 或桌面客户端。

第一版只构建 Apple Silicon macOS DMG。成功产物既保存为短期 GitHub Actions Artifact，也以固定文件名发布到公开 GitHub Release，供官网稳定下载入口使用。

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

工作流会执行源码测试、PostgreSQL 集成测试、arm64 打包、Developer ID 签名、Apple 公证、Gatekeeper/stapler 校验和 SHA-256 生成。DMG 挂载后还会兼容 pnpm hoisted/isolated 布局检查 external 运行时依赖、使用打包后的 Electron 二进制真实加载四个 external 模块、检查解包后的 arm64 原生模块，并实际启动应用等待 renderer 进程出现；出现悬空链接、`Cannot find module`、未捕获 JavaScript 异常或只有错误弹窗而没有应用窗口时构建失败。`stapler validate` 会对 Apple CloudKit 的瞬时网络失败做有限重试，但重试耗尽后仍会关闭失败。全部验证通过后，工作流按桌面端 `package.json` 版本创建不可覆盖的 `v<version>` Release，并发布固定名 `ReplyBot-macOS-arm64.dmg` 及校验文件；如同版本 Release 已存在，任务会提前失败而不是覆盖历史产物。
