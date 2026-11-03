# 多应用构建平台

2026-11-03。Builder 长期定位为共用构建平台，ReplyBot 是首个应用。现有 Apple 证书与 API Key 已在 `macos-release` Environment，不能误判为仅存在仓库级 Secrets，也不迁移或重置这些凭据。

## 本次接入

新增 `macos-tauri-python.yml` 可复用构建 profile，由私有 Hub 手动调用完整 commit SHA。这是首个 Tauri/Python profile，约定应用提供 `desktop/`、Python `workflow/tests/scripts`、锁文件及正式发布入口；不是任意语言、任意目录可直接使用的通用执行器。将来其他技术栈新增 profile，避免把 ReplyBot 的 License/数据库逻辑强塞给所有应用。

- Builder 维护 runner、依赖准备、测试门禁、签名步骤和候选 Artifact 白名单。
- 应用保留产品特定打包/签名脚本。当前入口接受历史 `HUB_*` 环境变量，这是 v1 调用契约，不是另一个应用的权限。
- 私有调用方提供六个必填 signing secrets，手动 main 运行，contents 只读、不取消活跃签名；未授权公开 PR 不进入签名任务。
- `checkout`、日志、Artifact 和 Secrets 的上下文均为调用方。调用方若为私有仓库，其产物不会因此公开到 Builder。现有 Builder Environment Secrets 不会自动跨仓库继承；不通过打印、导出或公开 Artifact 转移密钥。
- 不新增跨仓库 Deploy Key、不修改 ReplyBot。Hub 已另获用户允许将其本地签名凭据存入私有应用仓库。
- 候选 ZIP 可能尚未公证，安装前必须核对 Accepted、公证日志、staple/Gatekeeper、源码 SHA 和最终文件哈希。只保存明确产物文件，不上传整个运行目录。

## 兼容与验证

现有 ReplyBot macOS/Web 工作流原样保留，继续复用 Builder 既有 Environment。新 profile 为增量接入，应用固定 SHA；更新 Builder 不自动改变已固定的应用流水线。测试检查手动入口边界、Secret 必填、只读 checkout、非取消签名、Artifact 范围及无公开 Release；真正签名/安装结果由具体应用留证，静态检查不算发布成功。

参考：[GitHub 可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。
