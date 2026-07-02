# QCC流程破题诊断器

制造/供应链QCC圈长使用的轻量诊断MVP：从问题定义和流程断点出发，生成待验证原因；只有用户录入证据并标记“证据支持”后，系统才会生成改善方案。

## 本地运行

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。首次启动会自动写入质量、交付、库存、效率和协同五类示例课题。

## AI配置

不配置模型时，应用使用内置QCC规则引擎，所有功能均可演示。需要连接兼容模型时：

```bash
cp .env.example .env.local
```

填写：

- `AI_BASE_URL`：兼容 `/chat/completions` 的接口根地址；
- `AI_API_KEY`：接口密钥；
- `AI_MODEL`：模型名称。

模型必须返回JSON。模型超时、格式不合规或调用失败时，系统自动回退到规则引擎，并记录实际使用的诊断引擎。

## 数据与部署

- 默认SQLite文件：`data/qcc.db`；
- 可通过 `DATABASE_PATH` 修改位置；
- `Dockerfile` 使用Next.js standalone输出，可挂载 `/app/data` 持久化；
- MVP不提供文件上传、企业系统集成和复杂权限。

## Docker服务器部署

生产部署使用 `compose.yaml` 启动应用和Caddy。Caddy负责HTTPS、HTTP自动跳转和统一账号密码验证，应用的3000端口不会直接暴露到公网。

1. 准备部署配置：

```bash
cp .env.deploy.example .env.deploy
chmod 600 .env.deploy
```

2. 在服务器终端生成访问密码哈希。命令会安全提示输入密码，不要把明文密码写入配置：

```bash
docker run --rm -it caddy:2-alpine caddy hash-password | sed 's/\$/$$/g'
```

这里将哈希中的 `$` 转换为Docker Compose要求的 `$$`；保存进容器后仍会恢复为正确的单个 `$`。

3. 编辑 `.env.deploy`：

- `QCC_HOST`：临时地址可使用 `qcc.<公网IP横线格式>.sslip.io`，例如 `qcc.203-0-113-10.sslip.io`；
- `QCC_TLS_MODE`：正常域名留空以自动申请公开证书；大陆云服务器的未备案域名被拦截时，填写 `internal` 并将 `QCC_HOST` 改为服务器IP；
- `QCC_AUTH_USER`：访问用户名；
- `QCC_AUTH_PASSWORD_HASH`：上一步生成的哈希；
- `AI_API_KEY`：在服务器上录入DeepSeek密钥，不要通过聊天或代码仓库传递。

4. 启动并检查：

```bash
mkdir -p runtime/data
docker compose up -d --build
docker compose ps
docker compose logs --tail=100
```

SQLite数据保存在 `runtime/data`。首次访问课题列表时，如果数据库为空，系统会自动生成5个示例课题。升级前应备份该目录。

服务器安全组只需开放80和443；3000端口不要开放。SSH端口建议只允许管理人员使用的来源地址。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

核心测试覆盖：输入完整性、断点可追溯、原因不得自动验证、未验证原因不得生成方案、人工修改不得被补充生成覆盖。
