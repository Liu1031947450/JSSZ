# 简时手作

个人手工作品公告墙。React + TypeScript + Vite，使用 Animal Island UI Tailwind；没有自建服务器，也没有订单或支付功能。

首次打开及每次刷新网页（包括工作台入口）都会显示「重要声明」，说明网站仅为作品款式展示电子画册，所有咨询、沟通和交易均需在对应平台完成。仅点击「我同意」后恢复浏览，遮罩和 Esc 不会关闭声明；同意状态仅保留在当前页面，站内切换不重复弹出，刷新或重新打开后再次显示。

首页介绍下方、作品墙上方常驻显示同一声明，关闭弹窗后仍保留；提示随页面正常滚动，不遮挡作品。

首页作品清单或照片加载失败时保留「重新加载」，并提供「前往备用站」：`liu1031947450.github.io` 与 `jssz.pages.dev` 互相跳转，需用户主动点击，不自动跳转。照片重试保留当前筛选和排序；本地及其他域名不显示备用站入口。

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

工作台的「我的作品」占满内容区，以封面卡片网格排列：大于 1000px 为四列，801～1000px 为三列，361～800px 为两列，360px 及以下为单列。卡片提供编辑、预览、删除和置顶入口，不再常驻右侧编辑区。

删除右侧的 **置顶** 支持多件作品：置顶作品始终排在首页前面，后续置顶加入置顶队尾。电脑端可拖动封面手柄调整顺序，置顶与普通作品各自在组内排序，不能跨组拖动；也可聚焦手柄后按空格抓取、方向键移动、回车确认、Esc 取消。手机端不提供拖动手柄，不支持拖动排序，浏览和页面滚动不受影响。工作台与首页默认顺序一致；普通作品使用清单数组顺序，取消置顶回到原普通位置，新作品放普通列表最前，重新置顶进入队尾。拖动、置顶和取消置顶先保存在本机，需点击 **发布到作品墙** 才会更新首页；编辑、刷新及备份导入导出均保留顺序。首页仍显示暖金色置顶徽标。

1. 点击 **添加新作品**，或卡片上的 **编辑**，打开居中编辑弹窗。填写名称；简介、分类、材质和价格可选。价格单位为人民币（元），支持 0 和最多两位小数，不接受负数或非数字；留空表示暂未标价。旧尺寸数据保留用于兼容，不再作为表单或详情字段显示，也不会被转换成价格。
2. 点击整个上传区域（含空白、图标和文字）选择照片，或直接拖入照片；键盘聚焦后可按 Enter／空格选择。每次添加一张 JPEG、PNG 或 WebP，每件 1～5 张。超过 2400 万像素会在本机自动等比例缩小至限制以内，不再因像素超限拒绝打开；大小和像素均未超限的图片直接打开。需要处理时从最高编码质量逐步调整，确保不超过 10MB，仍超限才进一步缩小尺寸，尽量保留清晰度。裁剪窗口显示压缩前后大小，失败时可取消并重新选图；不会上传原图。
3. 在预览中拖动或触控调整裁剪位置；可向左或向右旋转 90°，原比例随方向切换，旋转后重新居中。选择原比例、1:1、3:4 或 4:3，使用滑块、双指或键盘缩放／微调；详情图和缩略图都保留旋转后的方向。
4. 图片重新编码为 WebP，生成最长边 1600px 的详情图和 480px 的缩略图，上限分别为 600KB / 100KB。不上传原文件和原始 EXIF 定位信息。
5. 可填写照片说明、设封面、前移、更换和移除照片。点击 **存入待发布清单** 完成本件编辑，关闭弹窗并更新网格，不会自动发布。
6. 点击 **发布到作品墙**。图片和清单经一次 Git 提交一起更新，随后由 Actions 重新部署。

新增和编辑共用自适应屏幕高度的弹窗，标题和底部操作栏固定，只有中间表单滚动；手机键盘弹出时按可见区域调整。关闭按钮、遮罩、Esc 和 **取消编辑** 均先确认放弃；选择 **再想想** 保留输入，确认后只清除本次编辑及不再引用的临时图片。裁剪、预览和确认窗口不重置底层输入。弹窗内保留草稿状态、错误和重试，但不显示备份功能；下载和导入备份统一在工作台。保存失败时可点 **保留输入并返回工作台**，再重试保存、下载备份或 **继续编辑**；未完成编辑期间不能新建、改动其他作品或发布。无效价格必须修正后才能导出备份，不会静默使用旧价格。未保存前不要刷新或关闭页面；重新登录恢复已落盘草稿，导入含未完成编辑的备份时会自动打开弹窗。

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
- 核对远端不覆盖本地草稿。发生冲突时先下载草稿备份；可明确选择 **舍弃本地更改** 使用远端内容，或 **导入备份** 将备份整体恢复为本机待发布清单，再手动发布。
- 每次点击 **添加新作品** 会先自动核对远端，成功后打开编辑弹窗并在弹窗内容顶部提示「已自动核对远程」，不遮挡关闭按钮。核对期间禁止重复操作；请求失败、草稿保存失败或远端冲突时停止新建并提示原因，不覆盖本地草稿。
- **下载草稿备份** 导出作品清单、未完成编辑和全部所需图片的 Base64，不包含令牌或待发布状态。尚未缓存在本机的图片按草稿基准提交从 GitHub 补齐；缺失或损坏时停止导出，避免产生无法完整恢复的文件。
- **导入备份** 接受本站 `jianshi-draft-backup-v1` JSON（非空且 ≤300MB），校验清单、价格、图片路径、编码、实际图片大小和尺寸。旧版备份仅含本机图片时，会尝试从备份基准提交补齐其余图片；该仓库版本不可读取时停止导入，不用最新图片替代。
- 导入前显示作品数量和覆盖确认，包含空作品集的清空提醒；确认后重新核对远端，用备份整体替换本机作品集及编辑器，不合并。只有本机存储事务成功后才替换界面；取消、校验失败、网络失败或存储失败均保留当前作品集。导入不修改线上内容，点击 **发布到作品墙** 后才会更新网站，仍保留发布时的远端冲突保护。
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
- `src/backup.ts`：备份格式校验、图片补齐、完整备份导出。
- `src/ImageEditor.tsx`、`src/images.ts`：文件预览、裁剪、压缩和格式校验。
- `src/catalog.ts`、`src/storage.ts`、`src/github.ts`：数据边界、IndexedDB、GitHub 原子提交。
- `public/catalog.json`：版本化公开清单；`public/images/` 由发布流程写入。

## 验证

`npm test` 使用 Node 内置测试运行器，无额外测试框架；覆盖清单、路径、文件头、备份往返及旧版图片补齐、权限错误、原子提交、冲突和网络不确定结果。`npm run build` 包含严格 TypeScript 检查。

可启动隔离的浏览器验收服务，使用生产构建但模拟 GitHub 和线上部署，**不会请求或写入真实 GitHub**：

```sh
npm run build
node tests/browser-server.mjs
```

打开 `http://127.0.0.1:4174`，管理页仅使用假令牌 `github_pat_test_only_not_a_real_token`。可测试上传、裁剪、多图详情、刷新后重连恢复草稿、发布和删除；测试数据只存于该测试服务器内存和专用本地站点的浏览器存储，正式 `public/catalog.json` 始终不受影响。不要在此服务输入真实令牌，不要将验收服务部署到公网。

`tests/disclaimer.browser.mjs` 的 `checkDisclaimer(page, origin)` 验证声明文案、首次打开、刷新与重新打开、仅同意按钮关闭、键盘焦点、背景锁定、站内切换及手机和横屏布局；默认地址为本地开发服务 `http://127.0.0.1:5173`，不登录或发布作品。其他浏览器验收通过 `acceptDisclaimer(page)` 完成进入页面时的同意步骤。

`tests/site-fallback.browser.mjs` 的 `checkSiteFallback(page)` 在本地开发服务模拟清单和图片加载失败，验证双向备用地址、原站重试、筛选保留及手机布局；不修改真实作品数据。

`tests/catalog-editor.browser.mjs` 的 `checkNewWorkSync(page)` 可独立验收新增前自动核对，包括每次仅核对一次、成功消息、重复点击拦截、草稿保留，以及请求失败、存储失败和远端冲突时停止新建。

`tests/workspace-interactions.browser.mjs` 的 `checkWorkspaceInteractions(page, visitor)` 在上述四件隔离作品上验收电脑鼠标／键盘排序、跨组保护、取消和边缘自动滚动、手机无拖动入口、排序保存／备份／发布、无效价格备份拦截、保存失败收起恢复，以及短屏和五张照片长表单的固定底栏。仅使用隔离服务和假令牌，不对真实作品发布。

工作台的分类和材质使用可输入的原生候选下拉框，可选择已有值，也可直接输入新值。候选项从当前待发布作品清单提取、去空白并去重，按清单引用缓存；新值存入待发布清单后自动加入候选项，空清单仍允许手动填写，原有长度限制不变。

浏览器验收需覆盖 320、390、768、1024、1440px，无横向溢出；覆盖键盘焦点、Esc、移动端裁剪、图片失败、配额错误、未授权写入和减少动画。模拟流程通过不等于真实 GitHub 权限、Pages 工作流或跨设备线上发布已验证；正式验收仍需一次真实管理员发布和另一设备读取。

作品详情支持浏览器返回：全屏照片 → 作品详情 → 作品墙；点击关闭或按 Esc 同步回退详情历史，关闭后仍可正常返回上一页。`tests/photo-wall.browser.mjs` 的 `checkDetailHistory(page)` 验收这些路径及重复打开关闭，不涉及 GitHub 写入。

首页 hero 压缩上下留白，使用自适应字号和约 176～220px 的最小高度；内容增多时仍可自然撑高，不裁剪文案。两侧装饰垂直居中，600px 及以下隐藏，给窄屏保留文字空间。

公告墙在大于 800px 时每行四件作品，800px 及以下保持每行两件；480px 及以下缩小公告板留白、卡片间距和装饰，并调整字号以适配窄屏。作品详情在大于 800px 时图片居左、资料居右，800px 及以下保持图片在上、资料在下的居中布局；标题、图片说明和底部按钮始终居中。详情照片可点击或按 Enter 打开全屏遮罩，按原比例完整展示；关闭按钮、遮罩空白处或 Esc 返回详情，不退出作品详情。

作品卡片的照片下方依次展示作品名称、分类与材质标签、人民币价格；未填写的分类或材质不显示空标签，价格留空时显示「暂未标价」。标签可自动换行，过长标签最多展示两行，完整内容可在作品详情中查看；作品简介只保留在详情页。

公告墙的「分类」「材质」「排序」标签固定在各自下拉框左侧，窄屏三项分行排列，保持下拉框可用宽度。

公告墙顶部可选择「全部」，或通过「分类」和「材质」组合筛选作品。候选项来自当前全部作品，去除首尾空白、空值并去重；每个完整字段作为一个选项，筛选摘要显示条件和数量，无匹配时可一键查看全部。材质后提供「排序」，包含「默认排序」「价格从低到高」「价格从高到低」。默认排序按工作台调整后的顺序展示，置顶始终在前；价格排序只作用于普通作品，0 元正常参与，未标价排在普通作品末尾，同价和未标价之间保持手动顺序。选择「默认排序」保留分类和材质，点击「全部」同时清除筛选与排序；打开详情不重置排序，刷新恢复默认状态。筛选候选和排序使用 `useMemo` 缓存，线上清单更新后同步更新，失效筛选值回到全部。异常数据仍由清单校验拦截，保留已加载内容并提供重试。

顶部原「日子慢慢，心意满满」的位置与页脚均提供「联系我」入口，包含抖音、小红书、快手和微信图标；抖音、小红书、快手在新标签页打开个人主页，链接维护在 `src/Contact.tsx`。两处微信图标与详情底部的「跳转微信咨询」共用复制逻辑，在电脑和手机端均复制微信号 `JS-200sz`，不会自动跳转微信。

微信复制期间保留图标、边框和按钮尺寸，使用忙碌状态与点击保护避免重复复制，不再因加载态改变宽度而带动相邻按钮抖动。

顶部联系入口完全滚出屏幕后，右侧显示快捷联系和返回顶部；回到顶部自动隐藏。800px 及以下默认仅显示两个 44px 按钮，点击「联系」展开 2×2 联系图标，收起或焦点离开后恢复紧凑状态，不挤压作品双列。使用原有主页链接和微信复制提示，适配屏幕安全区域；详情与裁剪弹窗打开时隐藏浮动按钮。

复制成功后，页面顶部浮动提示「微信号复制成功！打开微信搜索添加」，4 秒后自动消失，也可手动关闭；详情底部不再显示提示文字。若浏览器禁止复制，顶部显示可选中的微信号供手动复制，消息保留至关闭，不误报成功。

安装了 Ego Browser 时，可在重新启动上述隔离服务后运行以下回归检查。它只在本地测试服务生成作品和测试图，不访问真实 GitHub；编辑器验收会舍弃该隔离站点的旧测试草稿，再验证价格保存、创建发布和分类更新：

```sh
ego-browser nodejs <<JS
const task = await taskSpace('公告墙与全屏图片验收');
console.log({ taskSpaceId: task.spaceId });
const { pathToFileURL } = await import('node:url');
const { checkPhotoWall, checkHeroLayout, checkFloatingContacts, checkDetailHistory } = await import(pathToFileURL('$PWD/tests/photo-wall.browser.mjs').href);
await checkPhotoWall(task.page('p1'));
await checkDetailHistory(task.page('p1'));
await checkHeroLayout(task.page('p1'));
await checkFloatingContacts(task.page('p1'));
const { checkCatalogEditor, checkProductPins, checkWorkspaceModal, checkBackupImport, checkNewWorkSync, checkUploadZone } = await import(pathToFileURL('$PWD/tests/catalog-editor.browser.mjs').href);
const visitor = await task.newPage();
await checkCatalogEditor(task.page('p1'), visitor);
await checkProductPins(task.page('p1'), visitor);
await checkWorkspaceModal(task.page('p1'));
await checkBackupImport(task.page('p1'));
await checkNewWorkSync(task.page('p1'));
const { checkWorkspaceInteractions } = await import(pathToFileURL('$PWD/tests/workspace-interactions.browser.mjs').href);
await checkWorkspaceInteractions(task.page('p1'), visitor);
await checkUploadZone(task.page('p1'));
await task.finish({ keep: [] });
JS
```

## 设计来源与许可

Animal Island UI Tailwind（`animal-island-ui-tailwind`）**1.10.0**，作者 **lifeodyssey**。项目来源：<https://github.com/lifeodyssey/animal-island-ui-tailwind>。组件库发布包声明采用 **MIT License**，允许免费使用、修改及商用，分发时须保留版权和许可声明；原始许可证完整保存在 `public/animal-island-ui-tailwind-LICENSE.txt`，页脚提供可访问入口。

已移除旧的 `animal-island-ui` 依赖及其 CC BY-NC 4.0 许可文件。新库通过预编译样式入口 `animal-island-ui-tailwind/style` 接入，无需在应用额外安装或配置 Tailwind；通用图标按新库接口使用 `lucide-react`。此处的 MIT 许可说明仅针对组件库，不替代照片、Logo 等素材的授权，也不代表任天堂官方授权或关联。

组件库统一入口引用的 Radix peer 依赖已在 `package.json` 和锁文件中显式安装，避免开发启动或构建出现缺失导出。`src/Modal.tsx` 统一保留关闭弹窗后返回触发控件的键盘焦点行为。

该版本的组件库在 Notification 模块内嵌了 ReactDOM 19.2.6，开发模式加载统一入口时会校验 React 版本，因此本项目将 `react` / `react-dom` 对齐并固定为 **19.2.6**。待组件库修复内嵌运行时后再一起升级；`npm test` 包含该版本约束检查，避免只验证生产构建而遗漏开发白屏。

照片墙排列参考用户提供的 `marry_me/src/PhotoWall.tsx` 及相关样式，只借鉴胶带、纸框和错位布局；没有复制其中的私人照片或故事。

品牌 Logo 使用用户提供的 `public/723f445fcaa1fd6b873042c974bb8afa.jpg`。原图及 `public/logo.png` 已无损移除 EXIF/XMP 等非必要元数据，解码后的像素内容保持不变。`public/logo.png` 是保留原比例的 256px 显示版本，用于前后台共用页头、浏览器图标和移动端收藏图标；装饰叶子及管理入口不是品牌 Logo，因此仍保留。
