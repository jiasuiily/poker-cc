# 部署手册（Ubuntu 22.04 / 24.04，香港或海外服务器）

架构：一台服务器上用 Docker Compose 跑三个容器：

- **caddy**：对外开放 80 / 443 端口，自动申请和续期 HTTPS 证书，把请求（包括 WebSocket）转给 app。
- **app**：游戏服务端，同时提供网页、接口和 WebSocket。
- **db**：PostgreSQL 16，数据存在 Docker 卷里，不对外开放。

下面的命令都在**服务器上**执行。`poker.example.com` 换成你自己的域名。

---

## 1. 域名解析（在域名服务商后台操作）

添加一条 **A 记录**：主机记录 `poker`（或 `@`），记录值填服务器的公网 IP。

在自己电脑上确认已经生效，返回的应该是服务器 IP：

```bash
ping poker.example.com
```

> 解析生效之前不要启动 caddy，否则证书申请会失败；多次失败后要等一段时间才能重试。

## 2. 服务器基础设置

用 SSH 登录服务器（推荐用密钥登录，不用密码）：

```bash
ssh admin@服务器IP
```

> 下面按普通用户（如阿里云轻量服务器的 `admin`）加 `sudo` 写；用 root 登录时去掉 `sudo` 即可。

更新系统，打开防火墙，只放行 SSH、HTTP、HTTPS（升级后若提示 `System restart required`，执行 `sudo reboot`）：

```bash
sudo apt update && sudo apt upgrade -y
```

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw --force enable
```

> 云厂商控制台里通常还有一层「安全组 / 防火墙」，那里也要放行 80 和 443（以及 UDP 443）。

内存 2GB 以下时加 2GB 交换空间，避免构建镜像时内存不足：

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
```

## 3. 安装 Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
```

让当前用户不用 `sudo` 也能运行 docker（执行后退出 SSH 重新登录才生效）：

```bash
sudo usermod -aG docker $USER
```

```bash
docker --version && docker compose version
```

## 4. 拉取代码

```bash
sudo mkdir -p /opt/poker-cc && sudo chown $USER:$USER /opt/poker-cc
```

```bash
git clone https://github.com/jiasuiily/poker-cc.git /opt/poker-cc
```

```bash
cd /opt/poker-cc/deploy
```

## 5. 填写配置

```bash
cp .env.example .env
```

生成两个随机密钥，填进 `.env`：

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"; echo "JWT_SECRET=$(openssl rand -hex 32)"
```

```bash
nano .env
```

需要改的项：

- `DOMAIN`：你的域名；
- `POSTGRES_PASSWORD`、`JWT_SECRET`：粘贴上面生成的值；
- 大模型解说（可选）：`LLM_API_KEY`，用通义 / 智谱时再改 `LLM_BASE_URL`、`LLM_MODEL`。

改完把权限收紧：

```bash
chmod 600 .env
```

> `.env` 里是密钥，不要提交到 git，也不要发给别人。改 `JWT_SECRET` 会让所有人退出登录。

## 6. 构建并启动

第一次构建大约需要 3–5 分钟：

```bash
docker compose up -d --build
```

查看状态，app 和 db 应该显示 `healthy`：

```bash
docker compose ps
```

查看日志，出现 `poker server listening on :2567` 就是启动好了；按 Ctrl+C 退出日志查看：

```bash
docker compose logs -f app
```

浏览器打开 `https://poker.example.com`，应该能看到登录页，地址栏显示小锁。

## 7. 创建管理员和邀请码

创建管理员，会提示输入两次密码，输入时不显示：

```bash
docker compose exec app node dist/cli.js create-admin 你的用户名 你的显示名
```

生成邀请码，例如 5 个、7 天有效：

```bash
docker compose exec app node dist/cli.js invite 5 7
```

之后也可以用管理员账号登录网页，在「管理」页里生成邀请码、重置密码。

## 8. 每日备份

备份脚本把数据库导出到 `deploy/backups/`，保留 14 天。

```bash
chmod +x /opt/poker-cc/deploy/backup.sh && /opt/poker-cc/deploy/backup.sh
```

加入定时任务，每天 03:30 执行：

```bash
(crontab -l 2>/dev/null; echo "30 3 * * * /opt/poker-cc/deploy/backup.sh >> /opt/poker-cc/deploy/backups/backup.log 2>&1") | crontab -
```

> 备份只存在服务器上的话，服务器出事就一起没了。建议定期把 `backups/` 下载到自己电脑，或者同步到对象存储。

**从备份恢复**（会覆盖当前数据，先确认文件名）：

```bash
docker compose stop app
```

```bash
docker compose exec -T db psql -U poker -d postgres -c "DROP DATABASE poker WITH (FORCE);" -c "CREATE DATABASE poker OWNER poker;"
```

```bash
gunzip -c backups/poker-20261107-033000.sql.gz | docker compose exec -T db psql -U poker -d poker
```

```bash
docker compose start app
```

## 9. 更新到新版本

```bash
cd /opt/poker-cc && git pull && cd deploy && docker compose up -d --build
```

数据库结构的升级会在 app 启动时自动执行。更新前建议先手动备份一次（`./backup.sh`）。

升级到「一键分析 / 整体分析 / 管理员玩家统计」这一版之前，必须先执行 `deploy/backup.sh`：迁移 0003 修改了 `llm_usage` 的主键，若之后只回滚镜像而不恢复备份，单手解说会出错。

`docker compose stop` 或更新时，服务端会先等正在保存的牌谱写完再退出，最多等 30 秒。正在打的那一手不会保存。

## 10. 常见问题

| 现象 | 排查 |
|---|---|
| 打不开网页 / 证书错误 | `docker compose logs caddy`；确认域名已解析到本机 IP，云安全组和 ufw 都放行了 80/443 |
| 能打开但登录失败 / 提示服务器出错 | `docker compose logs app`；确认 `.env` 填好、`docker compose ps` 里 db 是 healthy |
| 牌桌一直「连接中」 | 一般是 WebSocket 被拦截。走 Caddy 就不会有这个问题；如果前面还套了 CDN，要开启 WebSocket 支持 |
| 忘记管理员密码 | `docker compose exec app node dist/cli.js reset-password 用户名`，会打印临时密码 |
| 磁盘满了 | `docker system prune -f` 清理旧镜像；检查 `backups/` 的大小 |
| 想看数据库 | `docker compose exec db psql -U poker -d poker` |

## 11. 安全提醒

- SSH 用密钥登录，然后在 `/etc/ssh/sshd_config` 里设置 `PasswordAuthentication no`。
- 只开放 22、80、443 三个端口；数据库端口不要对外开放（Compose 默认就不开）。
- 定期执行 `apt upgrade` 和本手册第 9 步的更新。
