# AI Eat Server

AI Eat 的网页后端。旧版高德即时推荐接口已经停用；新版使用 PostgreSQL 保存经过审核且确认营业的商家、分店、菜品和真实评论。

## 当前原则

- 西南大学北碚校区及周边优先。
- 所有外部数据先进入候选区；只有“审核通过 + 确认营业 + 学生适用”才能由公开 API 返回。
- 美食街、食堂等父级场所与具体档口分开保存，页面显示“所属场所 · 具体店名”。
- 高德负责 POI 骨架；学校官网和政府许可负责核验；QQ 只导入本地已审核的匿名化评论。
- 大众点评、抖音、小红书和 B 站只保存候选名称、菜品名及证据链接，不复制评论、视频或图片。
- 邮箱注册、登录、令牌刷新、退出和密码找回使用 Supabase Auth；偏好、收藏、消费记录、推荐反馈和文字评价投稿按真实用户隔离。

## 本地配置

复制 `.env.example` 为 `.env`，至少配置：

```dotenv
DATABASE_URL=postgresql://user:password@host:5432/ai_eat
DATABASE_SSL=false
AMAP_KEY=your_amap_web_service_key
ALLOWED_ORIGINS=http://localhost:5173
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
AUTH_EMAIL_REDIRECT_URL=http://localhost:5173/auth/callback
AUTH_PASSWORD_RESET_REDIRECT_URL=http://localhost:5173/auth/reset-password
```

`DATABASE_URL` 是标准 PostgreSQL 连接串，可以来自 Supabase、Neon 或其他兼容服务。
Auth 只使用 Supabase 的 Publishable/anon key，不要配置能绕过 RLS 的 `service_role` 或 secret key。

## 初始化

```bash
npm install
npm run db:configure-local
npm run db:migrate
npm test
```

`db:configure-local` 会隐蔽读取 Supabase Session pooler URI，并写入已被 Git 忽略的 `.env.database.local`；连接串不会打印到终端。也可以手动编辑该文件。

Vercel Secret 无法导出时，可把现有高德 Web 服务 Key 写入同样被忽略的 `.env.amap.local`，供本地批量同步使用。

## 数据同步与审核

```bash
# 高德网格化、分类和分页同步；全部保存为 candidate
npm run sync:amap -- --config config/amap-swu.example.json

# 按距离、价格、类型、评分和完整度生成学生友好审核顺序
npm run screen:candidates -- --config config/student-screening.json --out candidate-screening.json

# 手动执行一次半月评分结算；生产环境由 Vercel Cron 在每月 1 日和 16 日触发
npm run ratings:aggregate

# 导入学校官网或人工整理的商家候选（内置西大食堂种子仍需审核）
npm run import:branches -- --file config/swu-canteens.seed.json

# 导入价格、口味等菜品候选；引用的分店必须已经存在
npm run import:dishes -- --file dishes.json

# 导入已规范化的北碚食品经营许可 JSON
npm run import:licenses -- --file licenses.json

# 导入大众点评、抖音等人工发现线索；只保存名称、菜品名和证据 URL
npm run import:leads -- --file discovery-leads.json

# 审核商家分店或菜品
npm run review:entity -- --type branch --id B001XXXX --decision approved --reason 已核对地址和分店

# 先预检集中审核包；确认 matched 与 total 一致后才增加 --apply
npm run audit:import -- --file approved-branches.json
npm run audit:import -- --file approved-branches.json --apply

# 整批恢复审核前的商家名称和状态
npm run audit:rollback -- --batch branch-audit-xxxxxxxxxxxxxxxxxxxxxxxx

# 查看候选、审核、评论、图片和最近导入批次的汇总
npm run data:status

# 导入本地审核台导出的 approved-only QQ 评论包
npm run reviews:import -- --file published_reviews.jsonl

# 整批下架指定导入批次
npm run reviews:rollback -- --batch qq-xxxxxxxxxxxxxxxxxxxxxxxx
```

批准记录还必须填写 `entityKind`、`existenceStatus=confirmed`、`verificationMethod`、
`verificationConfidence>=60`、`verifiedAt` 和核实证据。档口或食堂窗口必须填写已经存在的
`venueId`。存疑商家继续保持候选状态，不能用“审核通过”代替真实存在核验。

政府许可导入器只接受允许字段，不保存经营者姓名等与产品无关的个人信息。社交平台线索导入器不接受复制的评论或媒体内容。

## 新版公开 API

- `GET /api/v1/restaurants`
- `GET /api/v1/restaurants/:id`
- `GET /api/v1/restaurants/:id/reviews`
- `GET /api/v1/restaurants/:id/dishes`
- `GET /api/v1/dishes`
- `GET /api/v1/dishes/:id`
- `POST /api/v1/discover`

`POST /api/v1/discover` 支持：

```json
{
  "mode": "gallery",
  "lat": 29.8169,
  "lng": 106.424,
  "radius": 2000,
  "budget": 30,
  "tastes": ["面食", "川菜"],
  "spiceLevels": [1, 2, 3],
  "fulfillment": "delivery",
  "excludeDishIds": [],
  "excludeBranchIds": [],
  "sessionId": "anonymous-local-session",
  "limit": 20
}
```

`mode=surprise` 只返回一道；`mode=gallery` 返回多样化卡片。有已审核菜品时优先推荐具体菜品；菜单不足时返回“食物类型 + 商家”，并明确 `menuVerified=false`，不虚构菜名。

图片完全不参与推荐分。存在权利和审核均通过的真实菜品图时返回 `real_image`；否则返回标注为“分类示意图”的 `category_illustration`。

## 邮箱登录 API

- `POST /api/v1/auth/signup`：邮箱和密码注册；密码要求 8～72 个字符。
- `POST /api/v1/auth/confirm-email`：提交邮箱与邮件中的 6 位验证码完成确认，成功后返回登录会话。
- `POST /api/v1/auth/resend-confirmation`：请求重新发送确认验证码；响应不会透露邮箱是否存在或是否已确认。
- `POST /api/v1/auth/login`：邮箱密码登录，返回 access token 与 refresh token。
- `POST /api/v1/auth/refresh`：使用 refresh token 换取新会话。
- `GET /api/v1/auth/me`：使用 `Authorization: Bearer <accessToken>` 获取当前用户。
- `POST /api/v1/auth/logout`：撤销当前会话。
- `POST /api/v1/auth/password-reset`：发送找回密码邮件，响应不会透露邮箱是否存在。
- `POST /api/v1/auth/password`：用户通过恢复链接取得会话后更新密码。

服务端不会自行相信 JWT 内容；带 Token 的请求会调用 Supabase `getUser` 验证后再设置用户身份。
所有认证响应均使用 `Cache-Control: no-store`。登录接口有独立限流，Supabase 项目自身的认证限流继续作为外层保护。
确认注册邮件模板必须使用 Supabase 的 `{{ .Token }}`，而不是 `{{ .ConfirmationURL }}`；这样 QQ、163 等邮箱用户可在 AI Eat 页面输入验证码，无需访问 Supabase 域名。密码重置仍需要在 Supabase Authentication 的 URL Configuration 中登记网页回调地址。

## 半月用户评分

- 每月 1 日和 16 日结算刚结束的半月。
- 同一用户对同一分店的 30 天时间段只取最后一次评分。
- 评分按 180 天时间衰减，并用 20 条平台均值作贝叶斯先验。
- 用户评分有效量达到 30 时，用户分与外部评分权重约各半。
- 每期写入独立快照；分店同时保存外部评分、本站评分、有效样本量和当前综合评分。
- Vercel 定时入口为 `GET /api/internal/ratings/aggregate`，必须通过 `CRON_SECRET` Bearer 鉴权。
- 用户登录完成前，评分写接口仍不开启。
- 半月结算只采用已批准且风控分低于 30 的评分，并再次排除已认证商家对自家门店的评分。

## 用户评价候选区

- 数据库已预留文字、Emoji、1～5 星和最多 9 张图片/表情包的候选结构。
- 图片只接受对象存储返回的 `storageKey`，不接受外部 URL、data URL 或本机路径。
- 单张图片最多 10MB，仅允许 JPEG、PNG、WebP、GIF；权利确认和内容审核分别记录。
- `POST /api/v1/user/reviews` 提交文字、Emoji、评分和已取得安全 storageKey 的媒体元数据。
- `GET /api/v1/user/reviews` 只返回当前用户自己的投稿状态。
- 投稿默认 `pending`，只有风控和人工审核都通过后，才会转成公开评论及半月评分输入。
- 图片签名上传尚未开放，因此当前网页应只提交文字、Emoji 和评分。
- 本地审核命令：`npm run reviews:moderate -- --id <投稿ID> --decision approved|rejected --reason <原因>`。

## 登录后的用户数据 API

- `GET/PUT /api/v1/user/preferences`：口味、辣度、预算、距离和堂食/外卖偏好。
- `GET/POST/DELETE /api/v1/favorites`：只管理当前用户的收藏。
- `GET/POST /api/v1/records`：记录当前用户实际选择的商家、菜品和消费金额。
- `POST /api/v1/recommendation-events`：记录展示、打开、接受和跳过，为个性化推荐提供依据。

以上接口均要求真实 Supabase access token。未确认营业的商家不能被收藏、记录、评价或写入推荐事件。

## 评论防刷护栏

- 商家、管理员工和代运营与门店建立可审计的绑定关系；数据库触发器禁止这些账号批准自家评论或评分。
- 评论只保存加盐后的用户、设备和网络主体标识，不保存风控用途之外的原始设备标识。
- 同店三十天重复评价、重复文案、同设备集中评价、同网络集中评价、短时五星爆发和账号高频提交都会累计风险分。
- 风险分达到 30 进入人工复核，达到 80 或确认是商家自评则拦截；风控通过也仍需常规内容审核。
- 评分汇总层再次过滤高风险记录和商家自评，避免单个接口或人工误操作绕过第一层保护。

## 数据安全

- 公开查询只读取 `approved + confirmed + student_suitable` 商家、已批准菜品和 `published` 评论。
- 第一版 QQ 导入包禁止携带图片。
- 相同审核包通过 SHA-256 防止重复导入。
- 导入批次可整批下架，审核动作保留日志。
- API 密钥、数据库连接和未来对象存储凭证只能放在环境变量中。
