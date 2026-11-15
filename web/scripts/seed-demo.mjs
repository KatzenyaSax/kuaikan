// 示例数据：5 个用户、5 个社群、若干帖子/评论/点赞/收藏。
//
//   node web/scripts/seed-demo.mjs
//
// 由 deploy/bin/seed-demo.sh 调用（它负责建账号与回填时间戳）。
//
// 为什么要有这批数据：产品冷启动时只有 1 个社群 2 篇帖子，界面看起来"空得没做完"，
// 无法判断排版密度、列表节奏、评论区层级是否成立。这批数据是为了**让界面可被评估**，
// 不是测试夹具（e2e 夹具是 e2e 脚本自己建的、跑完即删）。
//
// 所有账号的邮箱都是 demo+<key>@kuaikan.test，清理时一条 LIKE 'demo+%' 即可。
const SITE = process.env.SITE ?? 'https://www.katzenyasax.top'
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPassw0rd!'

const USERS = {
  linjian: { nickname: '林间', avatar: null },
  xiaoman: { nickname: '小满', avatar: null },
  kevin: { nickname: 'kevin', avatar: null },
  acha: { nickname: '阿茶', avatar: null },
  laobai: { nickname: '老白', avatar: null },
}

const COMMUNITIES = [
  {
    name: '前端周刊',
    owner: 'linjian',
    desc: '每周挑几篇值得读的前端长文，也聊工程实践与踩过的坑。\n不追热点，只留能复用的经验。',
    members: ['linjian', 'xiaoman', 'kevin', 'acha', 'laobai'],
  },
  {
    name: 'Rust 中文',
    owner: 'laobai',
    desc: 'Rust 语言、生态与工程化。欢迎把编译器的报错贴上来一起读——\n它骂人很有耐心。',
    members: ['laobai', 'kevin', 'linjian', 'acha'],
  },
  {
    name: '摄影与器材',
    owner: 'acha',
    desc: '器材只是工具，照片才是目的。这里聊镜头选择、后期流程、以及\n“为什么我又买了一支 35mm”。',
    members: ['acha', 'xiaoman', 'laobai', 'linjian'],
  },
  {
    name: '厨房实验',
    owner: 'xiaoman',
    desc: '在家做饭的失败与成功。配方会写清克数，翻车也会写清原因。',
    members: ['xiaoman', 'acha', 'linjian'],
  },
  {
    name: 'TypeScript 中文',
    owner: 'kevin',
    desc: '类型系统、编译器行为、以及“这段代码为什么过不了 typecheck”。\n贴报错请带版本号。',
    members: ['kevin', 'linjian', 'laobai', 'xiaoman'],
  },
]

const POSTS = [
  {
    community: '前端周刊',
    author: 'linjian',
    title: 'CSS 的 :has() 到底改变了什么',
    body: `过去十年里，CSS 一直在补「父选择器」这个洞。我们要给「包含图片的卡片」加样式，只能靠 JS 打标记；要判断表单里有没有填错，只能靠脚本监听。:has() 出现之后，这些判断第一次回到了样式表里。

它不是又一个语法糖。它把「选择器只能向下看」这条约束拿掉了——而现在选择器可以向上、向旁边看。

一个选择器能力的边界，往往决定了组件该怎么切分。:has() 把一些本来必须交给 JS 的状态，重新交给了 CSS。

代价是选择器的匹配成本变高了。浏览器要为每个 :has() 维护反向索引，在超大 DOM 上滥用会带来可观的样式重算。实践里的经验是：把它用在组件边界上，而不是用在列表的每一项上。`,
    comments: [
      { author: 'xiaoman', body: '第三段那个例子很到位。我们上周刚好把一模一样的 JS 删掉了，少了 20 行。' },
      {
        author: 'kevin',
        body: '补充一点：:has() 在 Safari 里比 Chrome 早支持两年，但 Chrome 的实现反而更快。选型时别只看兼容表。',
        replies: [
          { author: 'linjian', body: '同意。我们压测下来 Chrome 的样式重算时间大概是 Safari 的六成。' },
        ],
      },
      { author: 'acha', body: '列表页那块有实测数据吗？我们有 800 个节点，一直不太敢上。' },
    ],
    likes: ['xiaoman', 'kevin', 'acha'],
    favorites: ['xiaoman', 'kevin'],
  },
  {
    community: '前端周刊',
    author: 'kevin',
    title: '为什么你的首屏总是慢 300ms',
    body: `大部分「首屏慢」不是网络问题，是**主线程被占住了**。顺序通常是：

    HTML 到了 → 解析 → 发现 CSS → 等 CSS → 解析 CSS → 阻塞渲染

## 三个最常见的原因

1. **CSS 里的 @import**。浏览器要等外层样式表下载完、解析到 @import 那一行，才知道还有第二个文件要下。这一来一回，多 100~300ms 非常正常。
2. **字体没有 preload**。font-display: swap 能让文字先显示，但它会让页面在字体切换时抖一下。真正的问题往往不是字体本身，而是字体文件要等到 CSS 解析完才开始下载。
3. **同步的 localStorage 读写**。它在主线程上跑，某些浏览器里还会触发磁盘 IO。放在首屏渲染路径里的 localStorage.getItem，几百微秒也要算进去。

> 先量再改。大多数「优化」在 Lighthouse 上的收益，都在真实设备上还回去了。`,
    comments: [
      { author: 'linjian', body: 'localStorage 这条我踩过。后来改成内存缓存 + 异步落盘，首屏就好了 40ms。' },
      { author: 'xiaoman', body: '字体那条，你们用 preload 还是 preconnect？' ,
        replies: [
          { author: 'kevin', body: '普通字体用 preload 就够；跨域字体两个都要。' },
        ],
      },
    ],
    likes: ['linjian', 'xiaoman'],
    favorites: ['linjian'],
  },
  {
    community: '前端周刊',
    author: 'acha',
    title: '我们把微前端拆掉了，然后呢',
    body: `三年前我们用微前端把一个后台拆成四个子应用，理由是「团队独立发布」。三年后我们把它拆掉了，理由同样是「独立发布」——只不过这次是反过来。

它不是失败，是完成了使命。那三年里团队从 6 个人长到 30 个人，微前端让四条业务线不必互相等。等到组织稳定下来，四套构建、四份依赖、四个路由表带来的成本，开始大于收益。

拆的过程比搭的过程痛得多。真正麻烦的不是代码，是那些「你以为早就解耦」的地方：共享的登录态、共享的通知中心、共享的主题变量。它们在微前端里靠约定活着，一旦合并就全暴露成真实依赖。

给正在考虑微前端的人一句话：先确认你要解决的是「组织问题」还是「技术问题」。如果是组织问题，它能帮上忙；如果是技术问题，它只会让问题变贵。`,
    comments: [
      { author: 'laobai', body: '「靠约定活着」这个说法太准了。约定是技术债里最难还的一种，因为它不在代码里。' },
      { author: 'linjian', body: '好奇拆完之后的构建时间变化？我们是反过来的，正在考虑拆。' ,
        replies: [
          { author: 'acha', body: '全量构建从 11 分钟到 4 分钟，但首次冷启动反而慢了——依赖图变集中了。' },
          { author: 'linjian', body: '这个数据很有用，谢谢。' },
        ],
      },
    ],
    likes: ['linjian', 'laobai', 'kevin', 'xiaoman'],
    favorites: ['linjian', 'laobai'],
  },
  {
    community: 'Rust 中文',
    author: 'laobai',
    title: '借用检查器其实在帮你做设计',
    body: `刚开始写 Rust 的时候，我把 borrow checker 当成敌人。它不让我把两个可变引用交出去，不让我在遍历时修改集合，不让我随手 clone 掉问题。

写了一年之后才明白：它拦住的每一处，都是我在别的语言里用「之后再改」糊过去的设计缺陷。

比如「遍历时修改集合」，在 Go 里是一个运行时可能 panic 的操作，在 Java 里是 ConcurrentModificationException，在 JS 里是一个静默的跳过。在 Rust 里它编译不过——于是你被迫在写之前就想清楚：这个循环到底在改什么。

Clone 也是一样。Rust 让你 clone 得很难受，不是因为 clone 贵，而是因为 clone 通常是「我没想清楚所有权应该怎么流动」的信号。

我的建议是：第一年不要为了编译通过而到处 clone。让编译器逼你一次，把所有权图想清楚，后面会快很多。`,
    comments: [
      { author: 'kevin', body: '「clone 是没想清楚的信号」这句话我要贴到工位上。' },
      { author: 'linjian', body: '有没有推荐的练手项目？看完书之后不知道该写什么。' ,
        replies: [
          { author: 'laobai', body: '写一个带撤销功能的编辑器。所有权、生命周期、trait object 全都会逼到你。' },
        ],
      },
    ],
    likes: ['kevin', 'linjian', 'acha'],
    favorites: ['kevin'],
  },
  {
    community: 'Rust 中文',
    author: 'kevin',
    title: 'async Rust 的 Pin 到底在解决什么',
    body: `一句话版本：Pin 是为了让「自己指向自己的结构体」在移动之后依然合法。

async fn 会被编译成一个状态机，状态机里可能保存了指向自身字段的引用（比如你 await 时把 &self.field 存进了 future）。如果这个 future 被移动到别的地方，那个引用就悬空了。

Pin<&mut T> 的意思是「我保证在你被 drop 之前，不会再移动你」。注意它保证的是「不再移动」，不是「不可变」——所以 Pin 出来的值仍然可以被修改。

理解了这一点，很多 API 就顺了：
- Box::pin 把值放到堆上，堆地址稳定，所以安全
- Unpin 表示「这个类型随便移动没关系」，所以绝大多数普通类型都是 Unpin
- 手写 Future 时才需要真的关心 Pin，用 async/await 基本碰不到

大多数人被 Pin 卡住，是因为先看了 Pin 的文档再看 async 的实现。反过来会容易得多。`,
    comments: [
      { author: 'laobai', body: '「先看 async 实现再看 Pin」——这个顺序我认同。Pin 是手段，不是目的。' },
      { author: 'acha', body: '所以 Box::pin 其实就是「用一次分配换掉整个问题」？' ,
        replies: [
          { author: 'kevin', body: '对，而且是很划算的交易。除了每帧都分配的场景，基本不用犹豫。' },
        ],
      },
    ],
    likes: ['laobai', 'linjian'],
    favorites: ['laobai'],
  },
  {
    community: '摄影与器材',
    author: 'acha',
    title: '35mm 定焦拍人像，注意这五件事',
    body: `35mm 拍人像会把人拍得「离你很近」，这不是缺点，但它要求你更会处理环境。五个经验：

## 五条

- **别让背景抢戏。** 35mm 的景深浅不了多少，背景的杂乱会完整保留。拍之前先退后两步看整个画面。
- **主体不要放正中间。** 广一点的焦段里，居中构图容易显得呆板。试试放在三分线，让环境说话。
- **注意边缘畸变。** 人脸靠近画面边缘会被拉伸，尤其是额头和鼻子。宁可留白，不要贴边。
- **站低一点。** 稍微蹲下会让人显得更挺拔，也会让背景更干净。
- **先用最大光圈拍一组，再用 f/4 拍一组。** 你会发现自己更喜欢后者——环境人像需要一点环境。

> 35mm 最难的不是对焦，是走位。多走动，别用变焦脚。`,
    comments: [
      { author: 'xiaoman', body: '第五点太真实了。我一开始全开 1.4，后来发现最喜欢的几张都是 f/4。' },
      { author: 'laobai', body: '「用变焦脚」这个我笑了，但确实是这样。' ,
        replies: [
          { author: 'acha', body: '定焦最大的好处就是逼你动。站着不动拍十张，不如走两步拍一张。' },
        ],
      },
    ],
    likes: ['xiaoman', 'laobai', 'linjian'],
    favorites: ['xiaoman'],
  },
  {
    community: '摄影与器材',
    author: 'xiaoman',
    title: '后期到底该做到什么程度',
    body: `我的标准是：**别人看不出你修过，但能看出你认真拍过。**

具体三条：

一、曝光和对比先做对。这两件事决定了照片的「精神」，其余都是修饰。

二、颜色只调整体，不调局部。除非你有明确的表达意图，否则局部调色很快就会变成脏。

三、做减法。每次修完，把所有的滑块往回调 30%，你会发现更好看。过度的锐化和清晰度是最常见的两种。

还有一个我自己的规矩：修完放一天再看。第二天如果觉得「好像修多了」，那就是修多了。`,
    comments: [
      { author: 'acha', body: '「往回调 30%」是个好办法，比什么教程都实用。' },
      { author: 'linjian', body: '手机拍的也算吗？我总觉得手机直出就挺好，修了反而假。' ,
        replies: [
          { author: 'xiaoman', body: '手机直出本身就是厂商修过一遍了。你只需要调曝光和裁切，别的不动。' },
        ],
      },
    ],
    likes: ['acha', 'laobai'],
    favorites: ['acha'],
  },
  {
    community: '厨房实验',
    author: 'xiaoman',
    title: '煎牛排：我失败了十七次之后总结的四条',
    body: `十七次，从「外面焦了里面生」到「全熟得像鞋底」。最后稳定下来的做法只有四条。

## 四条

1. **肉要回温**。从冰箱拿出来放 30~40 分钟，室温。冷肉下锅，外面焦了里面还是凉的。
2. **锅要够热，但要干**。锅烧到冒烟，然后用厨房纸把肉表面的水吸干。有水就只能煮，不能煎。
3. **只翻一次**。每面 90 秒（2cm 厚），然后离火静置 5 分钟。
4. **盐要早，胡椒要晚**。盐提前 40 分钟撒（或者下锅前立刻撒），胡椒必须出锅后撒，否则会焦苦。

> 静置不是可选项，是必需项——它让肉汁重新分布。切早了就是一整盘血水。

## 厚度对应

| 厚度 | 做法 | 时间 |
| --- | --- | --- |
| 1.5cm | 纯煎 | 每面 60 秒 |
| 2cm | 纯煎 | 每面 90 秒 |
| 3cm 以上 | 先煎后烤 | 煎 60 秒 + 200℃ 烤 6~8 分钟 |`,
    comments: [
      { author: 'acha', body: '「静置不是可选项」——我第一次做牛排就是切早了，一整盘血水。' },
      { author: 'linjian', body: '盐提前 40 分钟不会出水吗？' ,
        replies: [
          { author: 'xiaoman', body: '会出水，但那是好事：表面先出水再回吸，最后煎的时候更干。' },
          { author: 'linjian', body: '原来如此，我一直以为要下锅前才撒。' },
        ],
      },
    ],
    likes: ['acha', 'linjian', 'laobai'],
    favorites: ['acha', 'linjian'],
  },
  {
    community: '厨房实验',
    author: 'acha',
    title: '一个人的晚饭，怎么不将就',
    body: `一个人做饭最大的敌人不是麻烦，是「凑合一下也行」的心态。

我的办法是准备三样「半小时内能成菜」的东西：
- 一份提前腌好的肉（周日晚切好分装冷冻）
- 一样能久放的蔬菜（圆白菜、胡萝卜、洋葱）
- 一罐高汤或者一包味噌

有这三样，回家 20 分钟就能出一菜一汤。关键在于**不用思考**——决策成本比动手成本高得多。

另一个习惯：碗碟只用一套。吃完马上洗。一旦允许自己「明天再洗」，第二天的你就会点外卖。`,
    comments: [
      { author: 'xiaoman', body: '「决策成本比动手成本高」这句话我要记住。我经常站在冰箱前十分钟然后点外卖。' },
    ],
    likes: ['xiaoman', 'linjian'],
    favorites: [],
  },
  {
    community: 'TypeScript 中文',
    author: 'kevin',
    title: 'TypeScript 6 的两个破坏性变更',
    body: `升级前先看这两条，我踩过一个。

一、**baseUrl 被弃用**。以前可以用 baseUrl + 相对路径做别名，现在要用 paths 显式写全。如果你有几十个文件用了旧写法，codemod 能省一半时间。

二、**枚举的常量折叠更严格**。以前某些跨文件的环境枚举会被当成字面量，现在不会了。表现是「某个 switch 突然报不是 exhaustive」。

升级路径建议：先把 tsconfig 里的 baseUrl 拿掉、paths 改成显式，跑一遍 typecheck；再升级版本。两步分开做，出问题时你知道是哪一步。

最后一句：不要在生产分支上直接升大版本。开个分支，把 typecheck 跑绿，再合并。`,
    comments: [
      { author: 'linjian', body: 'baseUrl 那条我们也遇到了。codemod 大概能处理 80%，剩下 20% 得手动。' },
      { author: 'laobai', body: '枚举那条能不能给个具体例子？' ,
        replies: [
          { author: 'kevin', body: '跨文件的 const enum，以前会被内联成字面量，现在保留类型。差别在 switch 的穷尽检查上。' },
        ],
      },
    ],
    likes: ['linjian', 'laobai', 'xiaoman'],
    favorites: ['linjian', 'laobai'],
  },
  {
    community: 'TypeScript 中文',
    author: 'linjian',
    title: '类型体操该做到什么程度',
    body: `我的判断标准：**看这个类型是为了约束调用方，还是为了炫技。**

为约束调用方的类型，值得写复杂。比如一个泛型函数要求「传入的 key 必须在对象里」，这能让错误在编译期暴露，收益明确。

为炫技的类型，通常有这些特征：只能在一个地方用、需要注释解释、改一个字段要改三层推导。这种类型的维护成本会被后来的人十倍偿还。

一个实用的建议：如果一个类型超过 15 行，先问自己「用重载能不能解决」。重载啰嗦，但任何人都能看懂。

还有一件事很多人忽略：**报错信息也是 API**。如果你的类型体操让报错变成「Type 'X' is not assignable to type 'Y'」加 40 行推导，那它对使用者是负收益。`,
    comments: [
      { author: 'kevin', body: '「报错信息也是 API」——这句应该写进每个库的贡献指南。' },
      { author: 'laobai', body: 'Rust 那边也是同样的问题。trait 的报错能写成一本书。' },
      { author: 'xiaoman', body: '15 行这个数字是怎么定的？' ,
        replies: [
          { author: 'linjian', body: '没什么依据，就是经验值——超过一屏就没人愿意读了。' },
        ],
      },
    ],
    likes: ['kevin', 'laobai', 'xiaoman', 'acha'],
    favorites: ['kevin', 'xiaoman'],
  },
  {
    community: '前端周刊',
    author: 'xiaoman',
    title: '表单校验放前端还是后端',
    body: `两边都要，但目的不同。

**前端校验是为了体验**：立刻告诉用户哪里错了，不要让他提交后等一个往返。它防不了任何人，因为请求可以绕过页面直接发。

**后端校验是为了正确性**：它是唯一可信的那一层。所有业务规则（这个邮箱是否已注册、这个昵称是否重复）都必须在这里。

最常见的错误是把业务规则写在前端：比如「邮箱不能重复」。前端根本不知道自己是不是重复的那个，只能靠后端说。

正确的分工是：前端做**格式与必填**，后端做**格式、必填、以及所有业务规则**。重复实现一遍格式校验不是浪费，它是两层不同的防线。

还有一个细节：后端的错误信息要能定位到字段。如果只返回「参数错误」，前端只能把提示挂在表单顶部，体验很差。`,
    comments: [
      { author: 'kevin', body: '最后一句很重要。我们的约定是错误码里带 field，前端按 field 挂提示。' },
      { author: 'linjian', body: '所以「两边都校验」不是重复劳动，是两层防线。这个说法我认同。' },
    ],
    likes: ['kevin', 'linjian'],
    favorites: ['kevin'],
  },
  {
    community: 'Rust 中文',
    author: 'acha',
    title: '为什么我最终没有用 Rust 写业务后端',
    body: `先说结论：不是因为难，是因为**招人**和**迭代速度**。

技术上的理由都很充分：内存安全、性能、错误处理。我做过一个内部服务，编译产物 8MB，内存占用是 Node 版的四分之一。

但真实成本在别处：

一、新人上手。一个熟悉 TypeScript 的后端，第一周能提交可上线的代码；Rust 大概要一个月，而且前两周基本在跟编译器吵架。

二、迭代速度。业务需求天天变，Rust 的类型系统让「改一处」变成「改五处」。这在库开发里是优点，在需求不稳定时是税。

三、招聘。这不是 Rust 的问题，是市场的问题。

我现在把 Rust 用在三个地方：CLI 工具、需要长期跑的守护进程、以及性能瓶颈的局部替换。业务主体还是 TypeScript。

选语言不是选最好的，是选「这个阶段最合适的」。`,
    comments: [
      { author: 'laobai', body: '这个结论我尊重。很多人把「我喜欢」当成「应该用」。' },
      { author: 'kevin', body: '第二条深有同感。类型严格度和需求稳定性是反比关系。' ,
        replies: [
          { author: 'acha', body: '对，所以我现在会用类型守住核心边界，内部实现故意松一点。' },
        ],
      },
    ],
    likes: ['laobai', 'kevin', 'linjian'],
    favorites: ['laobai'],
  },
  {
    community: '摄影与器材',
    author: 'laobai',
    title: '为什么我卖掉了所有变焦镜头',
    body: `不是变焦不好，是我用变焦的时候不做选择。

拿着一支 24-70，我会站在原地把焦段拧来拧去，拍十张「差不多」的照片。换成 35mm 之后，我必须走动、必须取舍，拍三张但三张都不一样。

卖掉之后的一年，我出片的数量少了，但满意的比例高了很多。

当然这不是普适建议。拍活动、拍婚礼、拍运动，变焦是必需品——那些场景没有时间让你走动。我的场景是扫街和旅行，定焦才成立。

给想试的人一个低成本方案：不要卖，先把你最常用的变焦用胶带固定在一个焦段，用一个月的定焦视角。一个月后你会知道自己要不要换。`,
    comments: [
      { author: 'acha', body: '胶带这招我第一次听说，但很有说服力。' },
      { author: 'xiaoman', body: '「用变焦的时候不做选择」——我拍风景也是这样，最后全是中庸的构图。' },
    ],
    likes: ['acha', 'xiaoman'],
    favorites: ['acha'],
  },
  {
    community: '厨房实验',
    author: 'linjian',
    title: '厨房里最值得花钱的三样东西',
    body: `按性价比排序，不是按价格。

一、**一把好刀**。它决定了你切菜的速度和心情，而且十年不用换。预算放在这里最值。

二、**一块厚底锅**。厚底意味着热量均匀，意味着你能煎出褐色的表面而不是灰色的。不需要名牌，需要厚度。

三、**一台准的秤**。烘焙不说了，做菜也一样——「少许」和「适量」是给有经验的人用的词。0.1g 精度的秤不到一百块。

最不值得花钱的：各种小家电。空气炸锅、破壁机、多功能料理锅，我买过的最后都在柜子里。它们在买的那一刻提供情绪价值，之后提供收纳负担。`,
    comments: [
      { author: 'xiaoman', body: '「在买的那一刻提供情绪价值」这句太狠了，但完全正确。' },
      { author: 'acha', body: '秤这条我补充：买能去皮、能切换单位的，不然你会烦。' ,
        replies: [
          { author: 'linjian', body: '对，去皮键是刚需。' },
        ],
      },
    ],
    likes: ['xiaoman', 'acha'],
    favorites: ['xiaoman'],
  },
  {
    community: 'TypeScript 中文',
    author: 'xiaoman',
    title: 'zod 之后再也没手写过校验',
    body: `我们之前的做法是：接口类型用 TypeScript 定义，运行时校验另写一遍。两边不同步的时候，bug 就出现了——而且通常是线上才出现。

改用 zod 之后，类型和校验变成同一份声明：

    const user = z.object({ email: z.string().email(), age: z.number().int().min(0) })
    type User = z.infer<typeof user>

好处不只是少写代码，而是**「类型」和「校验」不可能再分叉**。这是结构性的修复，不是风格问题。

代价有两个：一是包体积（约 12KB gzip），二是复杂 schema 的推导会让 tsc 变慢。前者在服务端无所谓，后者在超大项目里要留意。

如果不想引入依赖，也可以自己写一个轻量的 validator + inference，思路是一样的：**让类型从校验规则里推导出来，而不是反过来。**`,
    comments: [
      { author: 'kevin', body: '「让类型从校验规则推导」这个方向是对的。反过来就是永远对不齐。' },
      { author: 'linjian', body: 'tsc 变慢大概多少？我们项目已经很大了。' ,
        replies: [
          { author: 'xiaoman', body: '我们用了几百个 schema，冷启动 tsc 多了大概 15%。可以接受，但不是免费的。' },
          { author: 'linjian', body: '15% 还行，我去试试。' },
        ],
      },
    ],
    likes: ['kevin', 'linjian', 'laobai'],
    favorites: ['kevin'],
  },
]

// ---------------------------------------------------------------- 执行

let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const ng = (m, d) => {
  failures += 1
  console.log(`  ✗ ${m}${d ? ` — ${d}` : ''}`)
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${SITE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

const tokens = {}
const userIds = {}

async function loginAll() {
  for (const key of Object.keys(USERS)) {
    const { json } = await call('/api/user/auth/login', {
      method: 'POST',
      body: { email: `demo+${key}@kuaikan.test`, password: PASSWORD },
    })
    const data = json?.data
    if (!data?.accessToken) {
      ng(`登录失败 ${key}`, JSON.stringify(json).slice(0, 120))
      continue
    }
    tokens[key] = data.accessToken
    userIds[key] = data.user.userId
  }
  if (Object.keys(tokens).length !== Object.keys(USERS).length) return false
  ok(`5 个账号已登录`)
  return true
}

async function createCommunities() {
  const ids = {}
  for (const c of COMMUNITIES) {
    const { json } = await call('/api/community/communities', {
      method: 'POST',
      token: tokens[c.owner],
      body: { name: c.name, description: c.desc },
    })
    if (json?.code === 0) {
      ids[c.name] = json.data.id
    } else if (String(json?.message ?? '').includes('已被使用')) {
      // 幂等：已经建过，取回 id
      const enc = encodeURIComponent(c.name)
      const got = await call(`/api/community/communities/${enc}`)
      ids[c.name] = got.json?.data?.id
    } else {
      ng(`建社群失败 ${c.name}`, JSON.stringify(json).slice(0, 120))
    }
  }
  if (Object.keys(ids).length !== COMMUNITIES.length) return null
  ok(`${COMMUNITIES.length} 个社群就绪`)

  // 成员：owner 已在，其余逐个加入（加入是幂等的，重复调用无副作用）
  for (const c of COMMUNITIES) {
    for (const key of c.members) {
      await call(`/api/community/communities/${encodeURIComponent(c.name)}/membership`, {
        method: 'POST',
        token: tokens[key],
      })
    }
  }
  ok('成员关系已建立')
  return ids
}

async function createPosts(communityIds) {
  let posts = 0
  let comments = 0
  let interactions = 0

  for (const p of POSTS) {
    const cid = communityIds[p.community]
    if (!cid) continue
    const { json } = await call('/api/content/posts', {
      method: 'POST',
      token: tokens[p.author],
      body: { communityId: cid, title: p.title, body: p.body },
    })
    if (json?.code !== 0) {
      ng(`发帖失败 ${p.title}`, JSON.stringify(json).slice(0, 120))
      continue
    }
    const postId = json.data.id
    posts += 1

    for (const c of p.comments ?? []) {
      const res = await call(`/api/content/posts/${postId}/comments`, {
        method: 'POST',
        token: tokens[c.author],
        body: { body: c.body },
      })
      if (res.json?.code !== 0) {
        ng(`评论失败 ${c.body.slice(0, 12)}`, JSON.stringify(res.json).slice(0, 100))
        continue
      }
      const rootId = res.json.data.id
      comments += 1
      for (const r of c.replies ?? []) {
        const rr = await call(`/api/content/posts/${postId}/comments`, {
          method: 'POST',
          token: tokens[r.author],
          body: { replyToCommentId: rootId, body: r.body },
        })
        if (rr.json?.code === 0) comments += 1
        else ng(`回复失败 ${r.body.slice(0, 12)}`, JSON.stringify(rr.json).slice(0, 100))
      }
    }

    for (const key of p.likes ?? []) {
      await call('/api/interaction/likes', {
        method: 'POST',
        token: tokens[key],
        body: { targetType: 'post', targetId: postId },
      })
      interactions += 1
    }
    for (const key of p.favorites ?? []) {
      await call('/api/interaction/favorites', {
        method: 'POST',
        token: tokens[key],
        body: { targetType: 'post', targetId: postId },
      })
      interactions += 1
    }
  }

  ok(`${posts} 篇帖子、${comments} 条评论、${interactions} 次互动`)
  return posts
}

console.log(`示例数据 → ${SITE}`)
console.log()
if (!(await loginAll())) process.exit(1)
const communityIds = await createCommunities()
if (!communityIds) process.exit(1)
const posts = await createPosts(communityIds)
console.log()
if (failures > 0) {
  console.error(`  ${failures} 项失败`)
  process.exit(1)
}
console.log(`  完成：${posts} 篇帖子`)
