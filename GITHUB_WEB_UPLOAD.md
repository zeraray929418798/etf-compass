# 只用 GitHub 网页版：发布七 ETF 估值网站

不需要安装 Git。全程在浏览器完成，约 10 分钟。

> 这是一个**新网站**，请新建仓库 `etf-compass`，不要上传到已有的 `vflo-dashboard` 仓库。
>
> 完成后网址：`https://zeraray929418798.github.io/etf-compass/`

## 1. 下载并解压

下载 `etf-compass-upload.zip`，右键 → **全部解压缩**，打开解压后的文件夹。

里面应该有：

```text
.github
data
scripts
site
templates
README.md
requirements.txt
serve.py
```

## 2. 新建仓库

打开 [github.com/new](https://github.com/new)：

- Repository name：`etf-compass`
- 选 **Public**
- **不要勾选** Add a README file
- **不要选** .gitignore / license
- 点 **Create repository**

## 3. 上传内容

1. 进入新仓库，点 **uploading an existing file**。
2. 打开解压后的文件夹，按 **Ctrl + A** 全选里面的内容。
3. 直接拖进浏览器上传框。
4. Commit message 填 `initial upload`。
5. 点绿色 **Commit changes**。

上传成功后，仓库首页应直接看到 `.github`、`data`、`scripts`、`site`、`templates` 等文件夹。

> 不要上传外面的 `etf-compass` 文件夹本身，否则会多套一层，Actions 找不到工作流。

如果看不到 `.github` 文件夹，在文件资源管理器打开 **查看 → 显示 → 隐藏的项目**；仍然没有的话，按 README 里的工作流内容手动新建 `.github/workflows/update-and-deploy.yml`。

## 4. 开启 Pages

仓库 **Settings → Pages**：

- **Build and deployment → Source** 选择 **GitHub Actions**

## 5. 运行一次

仓库顶部 **Actions** → 左侧 **Update ETF data and deploy** → **Run workflow** → 分支 `main` → 绿色 **Run workflow**。

等 1–3 分钟，出现绿色对勾即成功。

## 6. 打开网站

**Settings → Pages** 顶部会出现 **Visit site**，或直接打开：

```text
https://zeraray929418798.github.io/etf-compass/
```

首页是七个 ETF 的总览，点卡片进入 VFLO、IFLO、COWZ、SCHD、QQQ、SOXX、XLP 各自页面；下方还有 XLK/XLP 比值同比与周线 MACD 图，可用滚轮缩放。

## 以后

- 每周二至周六早上 **7:30 左右（北京时间）** 自动更新。
- 想立刻更新：**Actions → Update ETF data and deploy → Run workflow**。
- 修改页面代码后，手动 Run 一次即可重新部署。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Pages 404 | 确认 Pages Source = GitHub Actions，等首次部署完成 |
| Actions 没有工作流 | 检查 `.github/workflows/update-and-deploy.yml` 是否上传成功 |
| 运行失败 403 | Settings → Actions → General → Workflow permissions → Read and write |
| 页面数据为空 | 检查 `site/data/*.js` 是否上传；打开页面控制台看 404 |
| PE 没有变化 | 数据源被风控，脚本保留旧锚点；价格/股息仍会更新 |

## 提醒

- 不要把 GitHub 密码、验证码发给任何人。
- 不需要 API key，不需要付费。
- 这是研究工具，不构成投资建议。
