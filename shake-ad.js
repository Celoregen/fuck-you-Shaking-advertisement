(function () {
  'use strict';

  // ==================== 配置 ====================

  var CONFIG = {
    // 摇一摇触发参数
    SHAKE_THRESHOLD: 18,
    DELTA_THRESHOLD: 8,
    SHAKE_WINDOW: 900,
    SHAKE_COOLDOWN: 1200,

    // 初始化静默检测时的等待时间
    PERMISSION_PROBE_TIMEOUT: 1000
  };

  // ==================== DOM ====================

  var adContainer = document.getElementById('adContainer');
  var shakeAd = document.getElementById('shakeAd');
  var normalAd = document.getElementById('normalAd');
  var permissionButton = document.getElementById('permissionButton');
  var permissionHint = document.getElementById('permissionHint');

  // ==================== 状态 ====================

  var state = {
    // unknown / granted / denied
    permission: 'unknown',

    // 是否正在接收 devicemotion
    motionListenerAttached: false,

    // 权限申请过程中防止重复点击
    requestInProgress: false,

    // 广告是否已经被摇一摇跳过
    adSkipped: false,

    // 摇一摇算法状态
    lastMagnitude: null,
    shakePeaks: [],
    lastShakeTime: 0
  };

  // ==================== 页面状态 ====================

  function showShakeAd() {
    shakeAd.style.display = 'flex';
    normalAd.classList.remove('active');
  }

  function showNormalAd() {
    shakeAd.style.display = 'none';
    normalAd.classList.add('active');
  }

  function setHint(text, isError) {
    permissionHint.textContent = text;
    permissionHint.classList.toggle('error', Boolean(isError));
  }

  // ==================== 基础检测 ====================

  function isSecureEnvironment() {
    return (
      window.isSecureContext === true ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    );
  }

  function supportsMotion() {
    return typeof window.DeviceMotionEvent !== 'undefined';
  }

  function supportsOrientationPermission() {
    return (
      typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function'
    );
  }

  function supportsMotionPermission() {
    return (
      typeof window.DeviceMotionEvent !== 'undefined' &&
      typeof window.DeviceMotionEvent.requestPermission === 'function'
    );
  }

  // ==================== 静默检测 ====================
  //
  // 这里绝不调用 requestPermission()。
  // 目标只是判断 devicemotion 当前是否已经能够提供数据。
  //
  // 这点很重要：
  // 如果没有授权，页面就继续停留在“摇一摇跳过广告”的状态，
  // 用户必须点击中间按钮进入权限申请流程。
  // ====================

  function probeMotionSilently() {
    return new Promise(function (resolve) {
      if (!supportsMotion()) {
        resolve(false);
        return;
      }

      var detected = false;
      var timeoutId = null;

      function cleanup() {
        window.removeEventListener('devicemotion', onMotion);
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }

      function onMotion(event) {
        var acc = event && event.accelerationIncludingGravity;

        if (
          acc &&
          isFiniteNumber(acc.x) &&
          isFiniteNumber(acc.y) &&
          isFiniteNumber(acc.z)
        ) {
          detected = true;
          cleanup();
          resolve(true);
        }
      }

      window.addEventListener('devicemotion', onMotion, { passive: true });

      timeoutId = setTimeout(function () {
        cleanup();
        resolve(detected);
      }, CONFIG.PERMISSION_PROBE_TIMEOUT);
    });
  }

  // ==================== 权限 API 辅助 ====================

  function queryPermission(name) {
    if (
      !navigator.permissions ||
      typeof navigator.permissions.query !== 'function'
    ) {
      return Promise.resolve('unknown');
    }

    return navigator.permissions
      .query({ name: name })
      .then(function (result) {
        return result && result.state ? result.state : 'unknown';
      })
      .catch(function () {
        // 浏览器不支持 sensor permission 查询时属于正常兼容情况
        return 'unknown';
      });
  }

  function detectExplicitDenial() {
    return Promise.all([
      queryPermission('accelerometer'),
      queryPermission('gyroscope')
    ]).then(function (states) {
      return states[0] === 'denied' || states[1] === 'denied';
    });
  }

  // ==================== 权限申请 ====================
  //
  // 这里只会从“用户点击中间按钮”的事件链进入。
  // 不在页面加载、定时器、visibilitychange 等场景主动申请。
  // ====================

  function requestPermissions() {
    if (state.requestInProgress || state.adSkipped) {
      return Promise.resolve(false);
    }

    if (!isSecureEnvironment()) {
      setHint('当前页面不是 HTTPS，无法稳定使用摇一摇功能', true);
      return Promise.resolve(false);
    }

    if (!supportsMotion()) {
      setHint('当前浏览器不支持设备运动，无法使用摇一摇', true);
      return Promise.resolve(false);
    }

    state.requestInProgress = true;
    setHint('正在申请设备运动权限…', false);

    var motionRequest = null;
    var orientationRequest = null;

    // 在用户手势触发的调用链中启动 requestPermission。
    if (supportsMotionPermission()) {
      motionRequest = window.DeviceMotionEvent.requestPermission()
        .then(function (result) {
          return result === 'granted';
        })
        .catch(function (error) {
          console.warn('[摇一摇] DeviceMotionEvent 权限申请失败', error);
          return false;
        });
    } else {
      motionRequest = Promise.resolve(true);
    }

    if (supportsOrientationPermission()) {
      orientationRequest = window.DeviceOrientationEvent.requestPermission()
        .then(function (result) {
          return result === 'granted';
        })
        .catch(function (error) {
          console.warn('[摇一摇] DeviceOrientationEvent 权限申请失败', error);
          return false;
        });
    } else {
      orientationRequest = Promise.resolve(true);
    }

    return Promise.all([motionRequest, orientationRequest])
      .then(function (results) {
        var motionGranted = results[0];
        var orientationGranted = results[1];

        /*
         * 摇一摇真正依赖的是 devicemotion。
         * 如果浏览器提供 orientation 权限，也一起申请；
         * 但最终必须再次确认 motion 实际有数据。
         */
        if (!motionGranted || !orientationGranted) {
          state.permission = 'denied';
          setHint(
            '设备运动权限未开启，请允许权限后重新点击中间按钮',
            true
          );
          return false;
        }

        return probeMotionSilently().then(function (available) {
          if (!available) {
            state.permission = 'unknown';
            setHint(
              '权限已处理，但当前没有获取到设备运动数据，请检查系统设置后重试',
              true
            );
            return false;
          }

          state.permission = 'granted';
          return true;
        });
      })
      .catch(function (error) {
        console.warn('[摇一摇] 权限流程异常', error);
        state.permission = 'unknown';
        setHint('权限申请失败，请检查浏览器设置后重试', true);
        return false;
      })
      .finally(function () {
        state.requestInProgress = false;
      });
  }

  // ==================== 摇一摇算法 ====================

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function resetShakeDetector() {
    state.lastMagnitude = null;
    state.shakePeaks = [];
    state.lastShakeTime = 0;
  }

  function handleDeviceMotion(event) {
    if (
      state.adSkipped ||
      state.permission !== 'granted'
    ) {
      return;
    }

    var acc = event && event.accelerationIncludingGravity;

    if (
      !acc ||
      !isFiniteNumber(acc.x) ||
      !isFiniteNumber(acc.y) ||
      !isFiniteNumber(acc.z)
    ) {
      return;
    }

    /*
     * 使用合加速度模长，避免只检测 x/y/z 某一轴造成方向依赖。
     */
    var magnitude = Math.sqrt(
      acc.x * acc.x +
      acc.y * acc.y +
      acc.z * acc.z
    );

    var now = performance.now();

    if (state.lastMagnitude === null) {
      state.lastMagnitude = magnitude;
      return;
    }

    var delta = Math.abs(magnitude - state.lastMagnitude);
    state.lastMagnitude = magnitude;

    // 已经触发过摇一摇后的短冷却时间，避免一次动作连续触发。
    if (now - state.lastShakeTime < CONFIG.SHAKE_COOLDOWN) {
      return;
    }

    /*
     * 不是单点阈值判断，而是：
     * 1. 当前合加速度足够大
     * 2. 与上一采样变化足够明显
     * 3. 短时间窗口内至少出现两次有效峰值
     */
    if (
      magnitude >= CONFIG.SHAKE_THRESHOLD &&
      delta >= CONFIG.DELTA_THRESHOLD
    ) {
      state.shakePeaks.push({
        time: now,
        magnitude: magnitude
      });

      state.shakePeaks = state.shakePeaks.filter(function (item) {
        return now - item.time <= CONFIG.SHAKE_WINDOW;
      });

      if (state.shakePeaks.length >= 2) {
        state.lastShakeTime = now;
        state.shakePeaks = [];

        skipAd('shake');
        return;
      }
    }

    // 回落到较低加速度时清空旧峰值。
    if (magnitude < CONFIG.SHAKE_THRESHOLD * 0.65) {
      state.shakePeaks = [];
    }
  }

  function attachShakeListener() {
    if (
      state.motionListenerAttached ||
      state.adSkipped
    ) {
      return;
    }

    window.addEventListener(
      'devicemotion',
      handleDeviceMotion,
      { passive: true }
    );

    state.motionListenerAttached = true;
    resetShakeDetector();

    console.log('[摇一摇] devicemotion 监听已启用');
  }

  function detachShakeListener() {
    if (!state.motionListenerAttached) {
      return;
    }

    window.removeEventListener(
      'devicemotion',
      handleDeviceMotion
    );

    state.motionListenerAttached = false;
    resetShakeDetector();
  }

  // ==================== 跳过广告 ====================

  function skipAd(reason) {
    if (state.adSkipped) {
      return;
    }

    state.adSkipped = true;
    detachShakeListener();

    console.log('[摇一摇] 广告已跳过，触发原因：', reason);

    /*
     * Demo：
     * 当前直接隐藏广告容器。
     *
     * 实际生产项目在这里接入：
     * - 关闭广告
     * - 执行广告 SDK callback
     * - 跳转落地页/业务页面
     * - 通知宿主 App
     */
    adContainer.style.display = 'none';
  }

  // ==================== 初始化 ====================

  function init() {
    showShakeAd();

    // 安全上下文检查
    if (!isSecureEnvironment()) {
      setHint('需要通过 HTTPS 访问才能使用设备运动功能', true);
      return;
    }

    // 浏览器不支持 DeviceMotionEvent
    if (!supportsMotion()) {
      setHint('当前浏览器不支持设备运动，无法使用摇一摇', true);
      return;
    }

    /*
     * 静默检查：
     * - 不调用 requestPermission()
     * - 只等待是否已经存在可用的 devicemotion 数据
     */
    Promise.all([
      detectExplicitDenial(),
      probeMotionSilently()
    ]).then(function (results) {
      var explicitlyDenied = results[0];
      var motionAvailable = results[1];

      if (explicitlyDenied) {
        state.permission = 'denied';
        showShakeAd();
        setHint(
          '设备运动权限未开启，点击中间按钮申请权限',
          true
        );
        return;
      }

      if (motionAvailable) {
        /*
         * 已经能正常收到 devicemotion：
         * 直接认为摇一摇能力可用，进入正常广告。
         */
        state.permission = 'granted';
        showNormalAd();
        attachShakeListener();

        console.log('[摇一摇] 已检测到可用设备运动权限');
        return;
      }

      /*
       * 没有收到运动数据：
       * 不主动申请权限，也不提供其他跳过方式。
       * 停留在“摇一摇跳过广告”的授权入口。
       */
      state.permission = 'unknown';
      showShakeAd();
      setHint('点击中间按钮申请设备运动权限', false);
    });
  }

  // ==================== 中间按钮 → 申请权限 ====================

  permissionButton.addEventListener('click', function () {
    if (
      state.requestInProgress ||
      state.adSkipped ||
      state.permission === 'granted'
    ) {
      return;
    }

    requestPermissions().then(function (granted) {
      if (!granted) {
        showShakeAd();
        return;
      }

      showNormalAd();
      attachShakeListener();

      setHint('权限已开启');
    });
  });

  // ==================== 页面生命周期 ====================

  document.addEventListener('visibilitychange', function () {
    if (state.adSkipped) {
      return;
    }

    if (document.hidden) {
      detachShakeListener();
      return;
    }

    if (state.permission === 'granted') {
      attachShakeListener();
    }
  });

  window.addEventListener('pagehide', function () {
    detachShakeListener();
  });

  // ==================== 启动 ====================

  init();

  // 暴露最小业务接口，方便宿主页面接入。
  window.ShakeAd = {
    skip: function () {
      skipAd('api');
    },

    destroy: function () {
      detachShakeListener();
      state.adSkipped = true;
    }
  };
})();
