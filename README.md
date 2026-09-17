# 简时手作

个人非商业手工作品公告墙。React + TypeScript + Vite，使用 Animal-Island-UI；没有自建服务器，也没有订单或支付功能。

## 本地运行

需要 Node.js 22.12+。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

打开终端输出的本地地址。默认清单为空，不包含虚构商品，也不包含参考项目的私人照片。

```sh
npm test
npm run build
npm run preview
```

## 第一次部署到 GitHub Pages

1. 将整个项目推送到自己的 GitHub 仓库 `main` 分支，包括 `package-lock.json` 和 `.github/workflows/pages.yml`。不要推送 `.env.local` 或任何令牌。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Publish handmade wall** 手动运行一次，或向 `main` 推送提交。
4. 等待构建、部署成功，打开 Pages 提供的站点地址。项目仓库子路径和自定义域名基路径由工作流自动读取。
5. 点击页脚右侧低调的叶子图标，或在站点地址后追加 `#/admin` 进入管理。

此项目的 GitHub 仓库为 `Liu1031947450/JSSZ`；示例配置与它一致。部署进度以仓库 Actions 的实际结果为准。

如果使用其他分支，同时调整工作流触发分支、部署来源和下表中的分支配置。受保护分支若禁止直接写入，本工具会拒绝发布，不会绕过保护；请为个人站点选择允许管理员直接提交内容的分支。

### 公开配置

| 变量 | 用途 |
| --- | --- |
| `VITE_GITHUB_OWNER` | GitHub 仓库所属账号或组织 |
| `VITE_GITHUB_REPO` | 仓库名，不含地址或 `.git` |
| `VITE_GITHUB_BRANCH` | 内容发布分支，默认 `main` |
| `VITE_BASE_PATH` | 本地为 `/`，项目 Pages 通常为 `/JSSZ/`，必须以 `/` 开头和结尾 |
| `VITE_PUBLIC_SITE_URL` | 最终公开站点完整基地址，用于核对是否上线；本地编辑时也应指向真实线上地址 |

工作流会根据仓库信息和 Pages 配置自动注入这些值。本地 `.env.local` 中只有公开配置。没有任何 `VITE_*` 变量可用于保存秘密，因为它们都会进入浏览器代码。

其他静态托管平台使用构建命令 `npm run build`、产物目录 `dist` 即可。若改用 Vercel，建议安装 `npm i -g vercel`，方便使用 `vercel env pull`、`vercel deploy` 和 `vercel logs`；当前 GitHub Pages 方案不需要 Vercel CLI。

## 管理员授权

在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 创建令牌：

- Resource owner 选择目标仓库所属账号。
- Repository access 选择 **Only select repositories**，只勾选此站点仓库。
- Repository permissions 仅授予 **Contents: Read and write**；Metadata 使用默认读取权限。
- 设置尽可能短的有效期；不授予 Workflows、组织管理或其他仓库权限。

进入管理时验证 GitHub 身份及账号对仓库的写权限。GitHub 的读取接口不能完整证明令牌拥有所有写入范围，因此实际令牌权限与分支策略最终以发布 API 的授权结果为准。

令牌仅存在于当前页面的 React 内存和发往 `api.github.com` 的 HTTPS Authorization 请求头中，不存入 IndexedDB、localStorage、sessionStorage、URL、日志或构建配置。刷新、离开管理页、退出后需要重新输入。请只在自己的可信设备、HTTPS 站点或本机 localhost 中使用；任何前端令牌方案都无法防御已被攻陷的浏览器、扩展或站点代码。

fine-grained PAT 的 Contents 权限限制到仓库，而非目录；有此令牌的人可能修改整个仓库。应用只构造 `public/catalog.json` 和受校验的 `public/images/` 路径，但这不是 GitHub 级别的目录权限。不要共享令牌。隐藏入口不承担权限保护。

## 编辑与发布

1. 新增作品，填写名称；简介、分类、材质和尺寸可选。
2. 每次添加一张 JPEG、PNG 或 WebP，每件 1～5 张。原图最大 10MB、2400 万像素。
3. 在预览中拖动或触控调整裁剪位置；选择原比例、1:1、3:4 或 4:3，使用滑块、双指或键盘缩放／微调。
4. 图片重新编码为 WebP，生成最长边 1600px 的详情图和 480px 的缩略图，上限分别为 600KB / 100KB。不上传原文件和原始 EXIF 定位信息。
5. 可填写照片说明、设封面、前移、更换和移除照片。点击 **存入待发布清单** 完成本件编辑。
6. 点击 **发布到作品墙**。图片和清单经一次 Git 提交一起更新，随后由 Actions 重新部署。

状态含义：

- **草稿已保存在本机**：仅此浏览器保存，其他设备看不到；不代表已提交。
- **已提交仓库／网站更新中**：GitHub 已接受内容，访客可能仍看到上一版。
- **网站已更新**：从配置的公开地址读到了本次发布批次。
- **尚未确认网站更新**：三分钟内未读到对应批次，检查 Actions、站点地址、网络，再点重新检查上线；不要因此重复发布。

访客首次打开、刷新或重新回到页面时读取最新线上清单。保持在同一页面且不切换回来时不轮询。没有 Service Worker，也不会把管理员草稿展示给访客。

## 故障、并发与数据安全

- IndexedDB 保存本机编辑器、待发布清单和处理后的图片。只有写入事务成功才显示“已保存”；容量不足或隐私模式限制会显示错误并阻止发布。
- 草稿不是永久备份：清理浏览器数据、换浏览器、换设备或系统回收本机存储都可能使草稿丢失。
- 发布前检查基准提交；更新引用时禁止 `force`。远端发生变化时停止，不自动合并或覆盖内容。
- 网络中断导致提交结果不明时，先点 **核对远端**。程序根据发布批次识别已完成的提交，不自动重试写入。
- 核对远端不覆盖本地草稿。发生冲突时先下载草稿备份，再明确选择 **舍弃本地更改**，按需重新应用修改。
- 下载的草稿 JSON 包含作品文字及本机图片的 Base64，供离线留档和人工恢复；不包含令牌，不提供自动导入并覆盖远端的功能。
- 删除作品、更换图片会从最新清单和文件树移除旧图片，但 Git 历史、其他人的克隆、缓存或已下载副本仍可能保留旧内容。不要上传隐私图片、身份资料或其他秘密。
- 素材当前占用超过 200MB 会警告；这不是平台配额。Git 历史的实际大小需另外检查，平台限制、计费或可用性也不受本应用保证。清单超过 1MB 时停止管理读取并提示整理。

### 独立备份

在站点首次上线和重要更新后，另行备份仓库，不要把单一浏览器或单一托管平台当作永久保存保证：

```sh
git clone --mirror https://github.com/Liu1031947450/JSSZ.git JSSZ-backup.git
git -C JSSZ-backup.git remote update
```

将镜像备份复制到独立磁盘；本机尚未发布的草稿需另外下载备份。恢复旧版时优先通过 Git 创建回退提交，不强推历史。清理大文件历史会影响其他克隆，应先完整备份再由熟悉 Git 的人员操作。

## 代码地图

- `src/PhotoWall.tsx`、`src/styles.css`：公告墙、照片详情、响应式及减少动画。
- `src/Admin.tsx`：管理授权、作品编辑、草稿与发布状态。
- `src/ImageEditor.tsx`、`src/images.ts`：文件预览、裁剪、压缩和格式校验。
- `src/catalog.ts`、`src/storage.ts`、`src/github.ts`：数据边界、IndexedDB、GitHub 原子提交。
- `public/catalog.json`：版本化公开清单；`public/images/` 由发布流程写入。

## 验证

`npm test` 使用 Node 内置测试运行器，无额外测试框架；覆盖清单、路径、文件头、权限错误、原子提交、冲突和网络不确定结果。`npm run build` 包含严格 TypeScript 检查。

可启动隔离的浏览器验收服务，使用生产构建但模拟 GitHub 和线上部署，**不会请求或写入真实 GitHub**：

```sh
npm run build
node tests/browser-server.mjs
```

打开 `http://127.0.0.1:4174`，管理页仅使用假令牌 `github_pat_test_only_not_a_real_token`。可测试上传、裁剪、多图详情、刷新后重连恢复草稿、发布和删除；测试数据只存于该测试服务器内存和专用本地站点的浏览器存储，正式 `public/catalog.json` 始终不受影响。不要在此服务输入真实令牌，不要将验收服务部署到公网。

浏览器验收需覆盖 320、390、768、1024、1440px，无横向溢出；覆盖键盘焦点、Esc、移动端裁剪、图片失败、配额错误、未授权写入和减少动画。模拟流程通过不等于真实 GitHub 权限、Pages 工作流或跨设备线上发布已验证；正式验收仍需一次真实管理员发布和另一设备读取。

## 设计来源与许可

Animal-Island-UI **1.12.0**，作者 **guokaigdg**，用于本项目的个人非商业展示。项目来源：<https://github.com/guokaigdg/animal-island-ui>。组件库原始许可证完整保存在 `public/animal-island-ui-LICENSE.txt`，页脚提供可访问入口。

组件库采用 **CC BY-NC 4.0**，本项目不改变其许可证。不得将此实现直接用于未经授权的商业推广或销售。若未来改变用途，先处理组件库授权及托管平台适用条款。

照片墙排列参考用户提供的 `marry_me/src/PhotoWall.tsx` 及相关样式，只借鉴胶带、纸框和错位布局；没有复制其中的私人照片或故事。

品牌 Logo 使用用户提供的 `public/723f445fcaa1fd6b873042c974bb8afa.jpg`。原图及 `public/logo.png` 已无损移除 EXIF/XMP 等非必要元数据，解码后的像素内容保持不变。`public/logo.png` 是保留原比例的 256px 显示版本，用于前后台共用页头、浏览器图标和移动端收藏图标；装饰叶子及管理入口不是品牌 Logo，因此仍保留。
