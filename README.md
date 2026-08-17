# 航迹 Cargo Watch

一个面向外贸订单的海运跟踪看板，支持手工录入、Excel/CSV 批量导入、云端同步、状态筛选和船期详情。

当前版本专注于订单集中管理；船公司官网的自动查询接口按承运人逐步接入。

## 在另一台电脑上使用

1. 安装 Node.js 22 和 Git。
2. 克隆这个私有仓库并运行 `npm install`。
3. 本地开发运行 `npm run dev`。
4. 修改完成后提交并推送到 `main`；GitHub Actions 会自动更新 Cloudflare Worker。

订单和查询记录保存在 Cloudflare D1，不保存在某一台电脑上。密码等私密配置不会上传到 GitHub。
