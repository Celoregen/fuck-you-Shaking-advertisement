# fuck-you-Shaking-advertisement

## 项目概述

本项目记录并实现一种基于**设备运动权限门控与运动手势识别**的移动网页广告交互方案。

项目的直接应用场景是“摇一摇跳过广告”，但技术范围不限于广告本身。其核心在于，将以下几个环节组合为一个连续的前端状态机：

```text
设备能力检测
    ↓
权限状态判断
    ↓
用户手势触发权限申请
    ↓
实际传感器能力验证
    ↓
交互能力启用
    ↓
运动手势识别
    ↓
业务动作触发
```

当前 Demo 不接入广告平台，仅使用占位文本表示广告内容。实现重点放在设备运动权限处理、状态转换、传感器验证和摇动识别。

项目采用 AGPL-3.0 发布，目的是保持该实现及其衍生版本的公开可研究性，并使网络服务场景下的修改和再分发受到相应的许可证条款约束。

---

# 一、基本交互模型

项目定义两个主要广告状态。

## 1. 未确认设备运动权限

页面继续展示广告，同时进入权限门控状态：

```text
┌──────────────────────────────┐
│                              │
│          占位广告             │
│                              │
│             ●                │
│          权限入口             │
│                              │
│        摇一摇跳过广告          │
│      点击中间按钮申请权限       │
│                              │
└──────────────────────────────┘
```

该状态具有以下约束：

- 不显示倒计时；
- 不显示关闭按钮；
- 不显示普通“跳过”按钮；
- 不提供点击广告外区域退出；
- 中央按钮仅用于发起设备运动相关权限申请；
- 广告的实际结束条件仍然是后续的摇动识别。

因此，中央按钮属于 **Permission Gate**，而不是 **Skip Button**。

## 2. 已确认设备运动能力

当设备运动能力已经确认可用后，页面进入正常广告状态：

```text
正常广告

摇一摇跳过广告
```

正常广告阶段仍不提供倒计时和其他备用跳过方式。广告结束由运动传感器产生的有效摇动事件触发。

---

# 二、核心技术链路

完整流程如下：

```text
广告初始化
    ↓
检查浏览器 Motion API
    ↓
检查安全上下文
    ↓
尝试查询可用的传感器权限状态
    ↓
静默监听 devicemotion
    ↓
    ├── 已获得有效 Motion 数据
    │        ↓
    │    进入正常广告
    │        ↓
    │    启用摇一摇检测
    │
    └── 未获得有效 Motion 数据
             ↓
         保持权限门控状态
             ↓
         等待用户点击中央按钮
             ↓
         requestPermission()
             ↓
         权限结果
             ↓
        再次验证 devicemotion
             ↓
      ┌──────┴──────┐
      │             │
     失败          成功
      │             │
      ↓             ↓
  保持门控状态    正常广告
                      ↓
                  摇一摇
                      ↓
                  广告结束
```

这里存在两个明确的验证阶段：

```text
初始化阶段：
判断当前是否已经能够使用 Motion

授权阶段：
判断授权结束后是否真的能够产生 Motion 数据
```

这样可以避免只根据某一个权限 API 的返回值决定广告状态。

---

# 三、权限检测

## 3.1 API 能力检查

首先判断：

```js
typeof DeviceMotionEvent !== "undefined"
```

以及：

```js
typeof DeviceMotionEvent.requestPermission === "function"
```

必要时同时检查：

```js
typeof DeviceOrientationEvent !== "undefined"
```

和：

```js
typeof DeviceOrientationEvent.requestPermission === "function"
```

这一步只用于判断浏览器提供了什么接口，不将其直接等价为“权限已经授予”。

---

## 3.2 Permissions API

在浏览器允许查询相关权限时，可以尝试检查：

```text
accelerometer
gyroscope
magnetometer
```

返回状态可表达为：

```text
granted
denied
prompt
unknown
```

其中 `unknown` 是必要状态，用于表示：

- 浏览器不支持对应权限查询；
- 权限名称不受支持；
- API 调用失败；
- 无法从 Permissions API 得出明确结论。

因此：

```text
unknown ≠ denied
```

不能仅凭查询异常将设备判定为拒绝。

---

## 3.3 `devicemotion` 实际事件探测

静默检测阶段不主动调用权限申请接口，而是短时间监听：

```js
window.addEventListener(
    "devicemotion",
    handler,
    { passive: true }
);
```

检测：

```js
event.accelerationIncludingGravity
```

是否存在有效的：

```text
x
y
z
```

数据。

如果已经收到有效 Motion 数据，则认为当前页面具备摇一摇所需的基础运动数据能力。

---

# 四、为什么需要“权限结果 + 实际 Motion”两层确认

下面两种状态在逻辑上并不完全等价：

```text
Permission API 返回 granted
```

与：

```text
页面能够持续收到 devicemotion
```

尤其在下列环境中，两者可能受到不同机制影响：

- iframe；
- Permissions Policy；
- WebView；
- 浏览器实现差异；
- 系统权限变化；
- 页面生命周期变化；
- 传感器暂时不可用。

因此，项目采用：

```text
权限结果
    +
实际 Motion 数据
    ↓
最终能力确认
```

只有第二阶段验证成功，才进入正常广告状态。

---

# 五、用户手势与权限申请

对于支持显式权限申请的浏览器，权限请求通过中央按钮的用户点击触发。

逻辑关系为：

```text
用户点击中央按钮
        ↓
进入权限申请代码
        ↓
requestPermission()
        ↓
等待权限结果
        ↓
验证实际 Motion
        ↓
切换广告状态
```

权限申请不会在以下流程中主动触发：

```text
DOMContentLoaded
setTimeout
自动初始化
visibilitychange
后台恢复
```

因此系统启动阶段不会因为广告加载本身直接弹出传感器权限申请。

---

# 六、广告状态机

推荐将实现抽象为以下状态：

```text
INITIALIZING
      ↓
UNKNOWN
      │
      ├──────────────→ REQUESTING
      │                      │
      │              ┌───────┴────────┐
      │              │                │
      │            DENIED           GRANTED
      │              │                │
      │              │                ↓
      │              │         VERIFY MOTION
      │              │                │
      │              │        ┌───────┴───────┐
      │              │        │               │
      │              │      FAIL            SUCCESS
      │              │        │               │
      │              └────────┘               ↓
      │                                 NORMAL_AD
      │                                      │
      │                                   摇动识别
      │                                      │
      └──────────────────────────────────────┴→ SKIPPED
```

在实现层面，也可以进一步拆成：

```text
PERMISSION_UNKNOWN
PERMISSION_DENIED
PERMISSION_REQUESTING
PERMISSION_GRANTED

AD_GUIDE
AD_NORMAL
AD_SKIPPED
```

这样可以使权限与广告状态分别维护，再由组合状态决定 UI 和监听器行为。

---

# 七、摇一摇识别

## 7.1 三轴运动数据

主要使用：

```js
event.accelerationIncludingGravity
```

获得：

```text
x
y
z
```

三个方向的加速度。

使用三轴合成量：

\[
M = \sqrt{x^2 + y^2 + z^2}
\]

作为设备当前运动强度的基础指标。

---

## 7.2 相邻采样变化

仅依赖：

```text
M > threshold
```

容易把某些持续的姿态变化误认为摇动。

因此同时计算：

\[
\Delta M = |M_t - M_{t-1}|
\]

仅当同时满足：

```text
M >= PeakThreshold
```

和：

```text
ΔM >= DeltaThreshold
```

时，才记录潜在运动峰值。

---

## 7.3 时间窗口

检测不会在第一个峰值出现时立即结束广告。

在短时间窗口内收集多个峰值：

```text
Peak 1
   │
   ├── 短时间窗口
   │
Peak 2
```

达到确认条件后才认为完成了一次有效摇动。

这样可以降低：

- 单次冲击；
- 手机轻微移动；
- 缓慢倾斜；
- 传感器噪声；

带来的误触发。

---

## 7.4 冷却时间

一次有效摇动触发广告结束后，检测器进入短暂冷却状态。

作用：

```text
一次物理动作
    ↓
避免多个连续事件
    ↓
只产生一个 skip 回调
```

---

# 八、为什么阈值不是固定技术边界

Demo 中的阈值，例如：

```text
PeakThreshold
DeltaThreshold
ShakeWindow
Cooldown
```

只是当前参考参数。

在不同设备和浏览器环境中，需要根据：

- 传感器采样频率；
- 设备型号；
- 手机重量；
- 系统实现；
- WebView；
- 浏览器版本；
- 用户持握方式；

进行调整。

因此项目将算法定义为：

```text
采样
+
变化检测
+
时间窗口
+
多峰确认
+
去抖
```

而不是限定为某一组数字。

---

# 九、页面生命周期

传感器事件监听不应永久运行。

## 页面隐藏

当：

```js
document.hidden === true
```

时移除：

```js
devicemotion
```

监听。

## 页面恢复

当页面重新进入前台，并且：

```text
permission === granted
AND
ad !== skipped
```

重新挂载运动监听。

这样能够避免：

- 后台持续传感器处理；
- listener 重复挂载；
- 广告结束后仍然继续采集；
- 生命周期切换引起的状态异常。

---

# 十、HTTPS 与浏览器安全上下文

设备运动能力应在安全上下文中运行。

生产环境原则上使用：

```text
https://
```

本地开发可以使用浏览器认可的：

```text
localhost
127.0.0.1
```

如果运行环境不是安全上下文，应直接进入能力不足状态，而不是继续反复申请权限。

---

# 十一、iframe 场景

如果广告作为 iframe 嵌入宿主页面，还需要考虑：

```text
iframe
+
Permissions Policy
+
allow 属性
+
父页面策略
+
子页面 API
```

示例：

```html
<iframe
    src="https://example.com/shake-ad/index.html"
    allow="accelerometer; gyroscope">
</iframe>
```

因此“页面代码本身支持 Motion”并不能保证 iframe 最终一定能够使用 Motion。

项目将 iframe 场景作为独立实施环境记录。

---

# 十二、WebView / Native Bridge

相同的逻辑还可以从纯 Web 扩展到 Hybrid App：

```text
H5
 ↓
JS Bridge
 ↓
Native Permission
 ↓
Native Motion Sensor
 ↓
Callback
 ↓
H5 状态机
 ↓
Gesture Detection
 ↓
Ad Skip
```

此时变化的是传感器来源和权限提供者，核心状态仍然可以保持：

```text
Permission Gate
        ↓
Capability Verification
        ↓
Interaction Recognition
        ↓
Business Action
```

因此同一项目可以继续维护：

```text
Web
WebView
iOS Bridge
Android Bridge
Hybrid
```

等实现。

---

# 十三、多传感器扩展

摇一摇只是其中一种输入方式。

相同架构可以扩展到：

## 13.1 Gyroscope

```text
陀螺仪
   ↓
旋转识别
   ↓
业务动作
```

## 13.2 Orientation

```text
设备方向
   ↓
角度变化
   ↓
手势
```

## 13.3 Accelerometer

```text
加速度
   ↓
敲击 / 摇动 / 震动
   ↓
业务动作
```

## 13.4 Multi-Sensor Fusion

可以同时使用：

```text
Accelerometer
+
Gyroscope
+
Orientation
```

形成一个能力矩阵：

```text
┌──────────────────────┐
│ Sensor Capability    │
├──────────────────────┤
│ Motion       GRANTED │
│ Gyroscope    GRANTED │
│ Orientation  GRANTED │
│ Magnetometer UNKNOWN │
└──────────────────────┘
```

然后根据当前设备实际可用的能力选择交互方案。

---

# 十四、自适应摇动识别

固定阈值可以进一步扩展为自适应算法：

```text
初始化
   ↓
采样设备基础噪声
   ↓
建立 Motion Baseline
   ↓
估计动态阈值
   ↓
正式识别
```

例如：

```text
低噪声设备 → 较低阈值
高噪声设备 → 较高阈值
```

进一步还可以考虑：

```text
设备型号
+
采样频率
+
历史运动数据
+
当前姿态
```

共同决定算法参数。

---

# 十五、连续运动序列识别

当前 Demo 使用：

```text
多个运动峰值
+
短时间窗口
```

来确认一次摇动。

更进一步，可以建立完整的运动序列：

```text
Neutral
   ↓
Move A
   ↓
Move B
   ↓
Move A
   ↓
Complete
```

例如：

```text
左 → 右 → 左 → 右
```

或：

```text
加速 → 反向 → 加速 → 稳定
```

此时算法从简单的阈值判断扩展为：

> **基于时间序列的设备运动手势识别。**

---

# 十六、通用 Permission Gate 模型

从更抽象的层面，该项目并不局限于广告。

通用模式可以表达为：

```text
Permission Gate
      ↓
Capability Verification
      ↓
Interaction Recognition
      ↓
Business Action
```

例如：

```text
Camera
    ↓
Camera Permission
    ↓
Camera Capability
    ↓
视觉手势
    ↓
业务动作
```

或：

```text
Microphone
    ↓
Microphone Permission
    ↓
Audio Capability
    ↓
声音事件
    ↓
业务动作
```

或：

```text
Motion
    ↓
Motion Permission
    ↓
Motion Capability
    ↓
Shake / Tilt / Rotate
    ↓
业务动作
```

“摇一摇广告”只是这一模型中的一个具体实例。

---

# 十七、与广告系统的解耦

项目 Demo 不直接依赖任何广告服务商。

广告素材层：

```text
占位广告
正常广告
```

仅用于表示界面状态。

交互层：

```text
Permission Gate
Motion Listener
Shake Detector
Ad State Machine
```

则保持独立。

真正商业化时，可以替换：

```text
占位广告
```

为：

- HTML5 Creative；
- 图片；
- 视频；
- 自有广告；
- 第三方广告 SDK。

而无需改变核心 Motion Permission Gate。

---

# 十八、广告结束回调

Demo 中可以简单使用：

```js
adContainer.style.display = "none";
```

生产环境建议将其抽象为：

```js
skipAd(reason);
```

例如：

```js
function skipAd(reason) {

    state.adSkipped = true;

    detachMotionListener();

    onAdSkipped({
        reason: reason
    });
}
```

之后可以由宿主应用处理：

```text
关闭广告
+
结束播放
+
页面跳转
+
SDK callback
+
Native callback
```

---

# 十九、可扩展的项目结构

当前实现保持最小结构：

```text
shake-ad/
│
├── index.html
├── style.css
├── shake-ad.js
└── README.md
```

进一步可以组织为：

```text
shake-ad/
│
├── README.md
├── LICENSE
├── CHANGELOG.md
│
├── demo/
│   ├── index.html
│   ├── style.css
│   └── shake-ad.js
│
├── src/
│   ├── permission-gate.js
│   ├── motion-detector.js
│   ├── ad-state-machine.js
│   └── lifecycle.js
│
├── adapters/
│   ├── web-motion.js
│   ├── webview-bridge.js
│   ├── ios-bridge.js
│   └── android-bridge.js
│
├── examples/
│   ├── iframe.html
│   └── host-page.html
│
└── docs/
    ├── architecture.md
    ├── permission-model.md
    ├── motion-detection.md
    └── derived-directions.md
```

---

# 二十、项目公开和许可策略

项目采用：

```text
AGPL-3.0
```

发布。

选择该许可证主要考虑两个方面：

1. 保持项目源代码的公开性；
2. 对修改版本，尤其是网络服务场景中的修改，适用 AGPL 相应的源码提供与再发布要求。

这里需要区分两个不同问题：

```text
软件许可证
```

解决的是：

```text
代码如何使用、修改、再发布
```

而：

```text
专利权
```

解决的是：

```text
某项技术方案是否受到专利权保护，以及相关权利人在特定法域中具有什么权利
```

因此，AGPL-3.0 的目的主要是控制该软件代码的版权许可方式，并保持实现的开放性，而不是单独作为防止第三方申请专利的法律工具。

本项目同时通过公开源码、技术说明、完整 Demo、版本记录和发布包，形成连续的技术公开记录。

---

# 二十一、为什么项目需要公开完整实现

仅有一句：

```text
Shake to skip ad
```

无法充分表达整个实现过程。

完整公开至少需要包括：

```text
权限检测
+
权限申请
+
实际能力验证
+
广告状态机
+
传感器监听
+
运动数据处理
+
手势判定
+
广告结束
```

还应记录不同实施环境：

```text
Top-level Web
iframe
WebView
Native Bridge
Multi-Sensor
```

以及替代算法：

```text
Threshold
Peak Detection
Sliding Window
Sequence Recognition
Sensor Fusion
Adaptive Threshold
```

这样技术内容才具备较完整的工程可理解性和可复现性。

---

# 二十二、项目希望形成的技术记录

项目持续公开的重点并不是一个单独的 UI 设计，而是一套完整技术链：

```text
广告展示
    ↓
Motion Capability Check
    ↓
Permission Gate
    ↓
User Activation
    ↓
Permission Request
    ↓
Capability Verification
    ↓
Ad State Transition
    ↓
Motion Listener
    ↓
Gesture Recognition
    ↓
Ad Dismissal
```

在此基础上，继续记录：

```text
Web
iframe
WebView
Native
Multi-Sensor
Adaptive Detection
Sequence Recognition
```

等衍生实现。

最终形成的是一个围绕**传感器权限门控和设备运动交互**的持续公开技术项目，而不仅是一份“摇一摇广告”示例。

---

# 二十三、仓库建议保留的历史记录

建议仓库同时保留：

```text
Git commit history
Release tags
Release archives
CHANGELOG
Demo source
Architecture documents
测试记录
```

每个重大技术变化建立独立版本，例如：

```text
v0.1
基础摇一摇广告 Demo

v0.2
权限门控

v0.3
实际 Motion 二次验证

v0.4
iframe / Permissions Policy

v0.5
WebView Bridge

v0.6
Multi-Sensor

v0.7
Adaptive Shake Detection
```

这样可以更清楚地记录技术方案随时间的演进。

---

# 二十四、项目的核心技术定义

可以将本项目概括为：

> 一种基于设备运动权限状态控制移动网页交互能力的前端框架。该框架在页面初始化阶段对设备运动能力进行非交互式检测；当运动能力未被确认时，将页面维持在权限门控状态，并提供用户主动触发的权限申请入口；权限申请完成后再次验证实际运动数据是否可用；验证成功后启用基于设备运动参数的交互识别，并在识别到预定运动手势后执行预先定义的业务动作。

“摇一摇跳过广告”是该框架的直接 Demo：

```text
Motion Permission
        ↓
Capability Verification
        ↓
Shake Recognition
        ↓
Ad Skip
```

而框架本身可以扩展到其他：

```text
Sensor
+
Permission
+
Gesture
+
Business Action
```

组合。

---

# 二十五、当前 Demo

当前 Demo 使用三个基础文件：

```text
index.html
style.css
shake-ad.js
```

其中：

```text
index.html
```

负责两个广告状态以及中央权限入口。

```text
style.css
```

负责状态视觉表现。

```text
shake-ad.js
```

负责：

```text
静默 Motion 检测
        ↓
权限申请
        ↓
Motion 二次验证
        ↓
正常广告
        ↓
摇一摇识别
        ↓
广告结束
```

Demo 本身不包含广告服务商、广告请求、第三方 SDK 或外部资源依赖。

---

# 二十六、总结

本项目记录的不是一个单一的“摇一摇”动作，而是一套完整的移动网页权限与交互流程：

```text
                    ┌───────────────┐
                    │   广告加载     │
                    └───────┬───────┘
                            ↓
                 ┌────────────────────┐
                 │ 静默检测 Motion 能力 │
                 └─────────┬──────────┘
                           │
              ┌────────────┴────────────┐
              ↓                         ↓
         已经可用                   尚未确认
              ↓                         ↓
         正常广告                  权限门控广告
              │                         │
              │                     用户点击
              │                         ↓
              │                    请求权限
              │                         ↓
              │                    二次验证
              │                         ↓
              └────────────┬────────────┘
                           ↓
                    Motion 可用
                           ↓
                    摇一摇识别
                           ↓
                      广告结束
```

项目的核心抽象是：

```text
Permission Gate
      ↓
Capability Verification
      ↓
Interaction Recognition
      ↓
Business Action
```

“摇一摇跳过广告”是当前实现；Motion、Orientation、Gyroscope、Accelerometer、多传感器融合、WebView、iframe、Native Bridge、动态阈值以及连续运动序列识别，则属于可以继续演进的技术方向。

项目采用 AGPL-3.0 公开代码，并持续保留源码、版本和发布记录，以保持该技术实现的公开可研究状态。
