# 多应用构建平台

2026-11-03。Builder 长期定位为共用构建平台，ReplyBot 是首个应用。现有 Apple 证书与 API Key 已在 `macos-release` Environment，不能误判为仅存在仓库级 Secrets，也不迁移或重置这些凭据。

## 执行位置修正（以本节为准）

Hub 的 `hub-desktop.yml` 直接在 **sengmitnick/sengclaw-builder** 手动执行，运行记录、runner、日志和可选安装包均归 Builder。私有 Hub 只提供源码和应用特定打包脚本。先前“私有 Hub 调用 reusable workflow”方案已撤回：计费仍属于私有调用方，没有解决额度问题。[GitHub runner 及计费上下文说明](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#how-reusable-workflows-use-runners)。公开仓库标准 GitHub-hosted runner 不消耗私有仓库包含的计算额度，但不表示存储和所有规格均免费，见 [计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

- `HUB_DEPLOY_KEY` 仅供读取 Hub，公钥为 Hub 只读 Deploy Key，私钥只存 Builder Secret。绝不复用 ReplyBot Key。
- 输入为完整 40 位 SHA，并校验属于 Hub main 历史；checkout 不持久化凭据。
- Mac job 使用 Builder `macos-release` 已有 P12/P8，映射到产品脚本 `HUB_*` 参数，固定 Team `87WNRG9285`，证书不匹配则停止。
- Windows 不挂 Apple Environment，不接收签名 Secrets，产物标记未签名预览。
- 工作流只接受 main 手动运行，没有 PR/push 签名入口。新任务不取消正在公证的任务。
- Hub 原私有仓库中已配置的签名 Secrets 不再被新入口使用，本次不重置或导出。

公开 Builder 的日志和 Artifact 不能当私有存储。只拉源码到临时 runner，不提交源码、不保存源码缓存、不上传整个工作区或 `.runtime`。安装包下载默认关闭；本次用户已明确同意上传安装包，触发时显式开启。

Mac 只有测试、签名、公证 Accepted、staple/Gatekeeper 全部成功后才上传 ZIP 和 `release.json`，不公开失败候选包或原始公证日志。不创建 Release。Windows 只上传 NSIS EXE，保留 7 天。安装包本身包含程序运行代码，与公开源码仓库是不同披露范围。

Python 使用 setup-python `3.12` 引导，再由 uv 准备项目锁定的 `3.12.14`，避免 setup-python 缺少特定 macOS arm64 小版本导致失败。

## 兼容与验证

ReplyBot 工作流和凭据不变。Hub 移除私有库 Mac/Windows 工作流。用户进一步明确：**桌面在公开 Builder，服务器继续在私有 Hub**；不再计划迁移 ACR，也不要求向 Builder 配置 ACR 凭据。私有镜像工作流保持显式手动入口、关闭 push 自动发布，不混用 ReplyBot 发布凭据。测试检查手动入口、源码范围、凭据映射、Artifact 白名单。实际 Builder run、Mac 安装与 Windows 实机验收分别留证，静态检查不算发布成功。

参考：[GitHub 可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。
