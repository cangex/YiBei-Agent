# 服务器维护

## 本机 macOS

本机入口为 `http://localhost:3000/`，使用用户级 `launchd` 服务 `com.yibei.medical`，仅监听 `127.0.0.1`。

```bash
launchctl print gui/$(id -u)/com.yibei.medical
launchctl kickstart -k gui/$(id -u)/com.yibei.medical
```

本机服务日志位于 `~/Library/Logs/YibeMedical.out.log` 和 `~/Library/Logs/YibeMedical.err.log`。

## 公网服务器

生产目录为 `/opt/yibei-medical-site`，当前版本通过 `current` 软链接切换。
公网入口为 `http://36.212.4.103:3000/`；Nginx 同时监听 80 与 3000，应用进程监听 3100。云侧当前只放通了 3000。

常用命令：

```bash
systemctl status yibei-medical
systemctl restart yibei-medical
journalctl -u yibei-medical -n 100 --no-pager
nginx -t
systemctl reload nginx
```

更新时将新版本解压到 `releases/<时间戳>`，安装依赖并完成构建后，再更新 `current` 与 `shared/bin/vinext-cli.js` 两个软链接，最后重启服务。Nginx 已配置路由回退代理与静态资源缓存。
