// v46 build marker
// v44 build marker
// v43 build marker
// v41 build marker
// v40 build marker
// v39 build marker
// v38 build marker
// v37 build marker
// v36 build marker
// v35 build marker
// v34 rebuild
// v32 build marker
// v31 build marker\n// v30 build marker
// v29 build marker
// v28 build marker
// v27 build marker
// v26 build marker
// v25b build marker
// v25 build marker
// v24 build marker
// v23 build marker
// v22 build marker
// v21 build marker
// v20 build marker
// v19 build marker
// v17 build marker
// v16 build marker

(() => {
  const SAMPLE_MS = 250;
  const POSITION_SAMPLE_SECONDS = 6;
  const HEADING_SAMPLE_SECONDS = 4;
  const DEFAULT_STEP_METERS = 0.72;
  const STEP_THRESHOLD = 1.15;
  const STEP_DEBOUNCE_MS = 320;
  const STEP_SMOOTHING = 0.22;
  const MIN_GPS_ACCURACY_METERS = 20;
  const QR_TARGET_PREFIX = "INDOOR_ANCHOR:";
  const TRACK_SIZE = 560;
  const CENTER = TRACK_SIZE / 2;
  const DEFAULT_CANVAS_SCALE = 1;
  const DEFAULT_VIEW_SCALE = 1;
  const MIN_VIEW_SCALE = 0.01; // v17 // v16
  const MAX_VIEW_SCALE = 4.8;
  const DEFAULT_WORLD_SCALE = 8;

  const state = {
    permissionState: "idle",
    tracking: false,
    message: "先授權感測器與定位，再開始追蹤。",
    anchor: null,
    geoReading: null,
    orientation: { heading: 0, supported: false },
    motion: { ax: 0, ay: 0, az: 0, supported: false },
    positionSampleMode: false,
    headingSampleMode: false,
    positionSamples: [],
    headingSamples: [],
    trail: [{ x: 0, y: 0, heading: 0, t: Date.now() }],
    currentPose: { x: 0, y: 0, heading: 0 },
    filteredPose: { x: 0, y: 0, heading: 0 },
    poseSmoothingAlpha: 0.22,
    poseSmoothingPreset: "balanced",
    corrections: [],
    stepCount: 0,
    stepLength: DEFAULT_STEP_METERS,
    lastStepAt: 0,
    motionMagnitude: 0,
    smoothedMagnitude: 0,
    exportUrl: "",
    calibratingStepLength: false,
    stepCalStart: 0,
    qrScanMode: false,
    qrStream: null,
    savedAnchors: [],
    navTrackPoints: [],
    selectedNavTrackPointId: "",
    highlightAnchorId: "",
    lastPoseAnchorCreateAt: 0,
    lastNavCanvasDragAt: 0,
    lastNavCanvasTapAt: 0,
    showAnchorOverlay: true,
    navTargetId: "",
    routeMode: "direct",
    waypointIds: [],
    arrivalThreshold: 2.0,
    activeLegIndex: 0,
    arrivedTarget: false,
    lastArrivalNoticeKey: "",
    voiceGuideEnabled: true,
    currentGuidanceText: "尚未開始導航。",
    lastSpokenText: "",
    lastTurnCueKey: "",
    startedRouteDistance: 0,
    averageWalkingSpeed: 1.15,
    navSessionState: "idle",
    navSessionStartedAt: null,
    navSessionPausedAt: null,
    navPauseAccumulatedMs: 0,
    navHistory: [],
    mapElements: [],
    editorMode: "idle",
    editorDraftPoints: [],
    editorMessage: "先選編輯模式，再點擊畫布建立地圖元素。",
    showMapOverlay: true,
    selectedMapElementId: "",
    plannedRoutePoints: [],
    snapEnabled: true,
    autoIntersectEnabled: true,
    snapThreshold: 1.2,
    navViewport: { scale: DEFAULT_VIEW_SCALE, panX: 0, panY: 0, minScale: MIN_VIEW_SCALE, maxScale: MAX_VIEW_SCALE },
    editorViewport: { scale: DEFAULT_VIEW_SCALE, panX: 0, panY: 0, minScale: MIN_VIEW_SCALE, maxScale: MAX_VIEW_SCALE },
    autoStepCalibration: {
      enabled: true,
      windowStart: null,
      lastEstimate: null
    },
    lastGeoCorrectionAt: 0,
    anchorCreationMode: false,
    gpsAnchorSampling: false,
    navAutoFit: true,
    navFollowCurrent: true
  };

  let geoWatchId = null;
  let positionTimer = null;
  let headingTimer = null;
  let smoothedMagnitudeRef = 0;
  let lastStepAtRef = 0;
  let navCanvasGesture = null;
  let editorCanvasGesture = null;


  const $ = (id) => document.getElementById(id);
  const canvas = $("trackCanvas");
  const ctx = canvas.getContext("2d");

  function activeCanvasScale(viewport) {
    return DEFAULT_CANVAS_SCALE * (viewport?.scale || 1);
  }

  function ensureCanvasSize(canvasEl, wrapEl) {
    if (!canvasEl || !wrapEl) return;
    const rect = wrapEl.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width - 20));
    const height = Math.max(420, Math.round(rect.height - 20));
    if (canvasEl.width !== width || canvasEl.height !== height) {
      canvasEl.width = width;
      canvasEl.height = height;
    }
  }

  function applyViewportTransform(canvasEl, viewport, zoomChipId) {
    if (zoomChipId && $(zoomChipId) && viewport) {
      $(zoomChipId).textContent = `${Math.round((viewport.scale || 1) * 100)}%`;
    }
  }

  function clampViewport(viewport) {
    viewport.scale = Math.max(viewport.minScale || MIN_VIEW_SCALE, Math.min(viewport.maxScale || MAX_VIEW_SCALE, viewport.scale || 1));
    viewport.panX = Math.max(-8000, Math.min(8000, viewport.panX || 0));
    viewport.panY = Math.max(-8000, Math.min(8000, viewport.panY || 0));
  }

  function screenPointToCanvasRaw(evt, canvasEl) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
      rect
    };
  }

  function setCompass(needleId, heading) {
    const needle = $(needleId);
    if (!needle) return;
    needle.style.transform = `rotate(${normalizeAngle(heading || 0)}deg)`;
  }

  function refreshViewportUI() {
    applyViewportTransform($("trackCanvas"), state.navViewport, "navZoomChip");
    const navAutoFitBtn = $("btnNavAutoFit");
    if (navAutoFitBtn) navAutoFitBtn.textContent = `回正 ${state.navAutoFit ? "開" : "關"}`;
    const navFollowBtn = $("btnNavFollow");
    if (navFollowBtn) navFollowBtn.textContent = `跟隨 ${state.navFollowCurrent ? "開" : "關"}`;
    applyViewportTransform($("editorCanvas"), state.editorViewport, "editorZoomChip");
    setCompass("navCompassNeedle", state.orientation.heading || latestPose().heading || 0);
    setCompass("editorCompassNeedle", state.orientation.heading || latestPose().heading || 0);
    updateFullscreenButtons();
    drawTrack();
    drawEditorCanvas();
  }

  function markViewportManual(viewport) {
    if (!viewport) return;
    viewport.lastManualAt = Date.now();
  }

  function getWrapRect(wrapEl) {
    const rect = wrapEl?.getBoundingClientRect?.();
    return {
      width: Math.max(320, Math.round((rect?.width || TRACK_SIZE) - 20)),
      height: Math.max(420, Math.round((rect?.height || TRACK_SIZE) - 20))
    };
  }

  function getBasePixelsPerWorld(wrapEl) {
    return {
      x: DEFAULT_WORLD_SCALE,
      y: DEFAULT_WORLD_SCALE
    };
  }

  function viewportWorldToScreen(point, viewport, wrapEl) {
    const rect = getWrapRect(wrapEl);
    const base = getBasePixelsPerWorld(wrapEl);
    return {
      x: rect.width / 2 + (viewport?.panX || 0) + Number(point?.x || 0) * base.x * (viewport?.scale || 1),
      y: rect.height / 2 + (viewport?.panY || 0) + Number(point?.y || 0) * base.y * (viewport?.scale || 1)
    };
  }

  function viewportScreenToWorld(screenPoint, viewport, wrapEl) {
    const rect = getWrapRect(wrapEl);
    const base = getBasePixelsPerWorld(wrapEl);
    return {
      x: (Number(screenPoint?.x || 0) - rect.width / 2 - (viewport?.panX || 0)) / Math.max(base.x * (viewport?.scale || 1), 0.001),
      y: (Number(screenPoint?.y || 0) - rect.height / 2 - (viewport?.panY || 0)) / Math.max(base.y * (viewport?.scale || 1), 0.001)
    };
  }

  function normalizeBounds(bounds) {
    if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
      return { minX: -4, maxX: 4, minY: -4, maxY: 4 };
    }
    if (bounds.minX === bounds.maxX) {
      bounds.minX -= 2;
      bounds.maxX += 2;
    }
    if (bounds.minY === bounds.maxY) {
      bounds.minY -= 2;
      bounds.maxY += 2;
    }
    return bounds;
  }

  function collectNavWorldBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const addPoint = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, Number(x));
      minY = Math.min(minY, Number(y));
      maxX = Math.max(maxX, Number(x));
      maxY = Math.max(maxY, Number(y));
    };

    state.trail.forEach((p) => addPoint(p.x, p.y));
    const pose = latestPose();
    addPoint(pose.x, pose.y);
    state.savedAnchors.forEach((a) => addPoint(a.x, a.y));
    state.navTrackPoints.forEach((p) => addPoint(p.x, p.y));
    state.plannedRoutePoints.forEach((p) => addPoint(p.x, p.y));
    state.mapElements.forEach((el) => {
      if (el.type === "point") {
        addPoint(el.x, el.y);
      } else if (Array.isArray(el.points)) {
        el.points.forEach((p) => addPoint(p.x, p.y));
      }
    });

    return normalizeBounds({ minX, minY, maxX, maxY });
  }

  function fitViewportToBounds(viewport, bounds, wrapEl, padding = 48) {
    if (!viewport || !wrapEl) return;
    const normalized = normalizeBounds({ ...bounds });
    const rect = getWrapRect(wrapEl);
    const base = getBasePixelsPerWorld(wrapEl);
    const worldWidth = Math.max(normalized.maxX - normalized.minX, 8);
    const worldHeight = Math.max(normalized.maxY - normalized.minY, 8);

    const insetLeft = Math.max(22, rect.width * 0.05);
    const insetRight = Math.max(92, rect.width * 0.18);
    const insetTop = Math.max(96, rect.height * 0.14);
    const insetBottom = Math.max(72, rect.height * 0.10);

    const availableWidth = Math.max(rect.width - insetLeft - insetRight, rect.width * 0.28);
    const availableHeight = Math.max(rect.height - insetTop - insetBottom, rect.height * 0.42);

    const scaleX = availableWidth / Math.max(worldWidth * base.x, 1);
    const scaleY = availableHeight / Math.max(worldHeight * base.y, 1);
    viewport.scale = Math.min(
      viewport.maxScale || MAX_VIEW_SCALE,
      Math.max(viewport.minScale || MIN_VIEW_SCALE, Math.min(scaleX, scaleY))
    );

    const centerX = (normalized.minX + normalized.maxX) / 2;
    const centerY = (normalized.minY + normalized.maxY) / 2;

    const safeCenterX = insetLeft + availableWidth / 2;
    const safeCenterY = insetTop + availableHeight / 2;

    viewport.panX = safeCenterX - rect.width / 2 - centerX * base.x * viewport.scale;
    viewport.panY = safeCenterY - rect.height / 2 - centerY * base.y * viewport.scale;
    clampViewport(viewport);
  }

  function ensureNavViewportVisible(forceFit = false) {
    const wrapEl = $("trackCanvasWrap");
    if (!wrapEl) return;
    if (!state.navAutoFit && !forceFit) return;
    const bounds = collectNavWorldBounds();
    const pose = latestPose();
    const rect = getWrapRect(wrapEl);
    const safeMargin = Math.max(40, Math.min(rect.width, rect.height) * 0.12);
    const currentScreen = viewportWorldToScreen(pose, state.navViewport, wrapEl);
    const outsideCurrent = currentScreen.x < safeMargin || currentScreen.x > rect.width - safeMargin || currentScreen.y < safeMargin || currentScreen.y > rect.height - safeMargin;

    const corners = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY }
    ].map((p) => viewportWorldToScreen(p, state.navViewport, wrapEl));
    const minSX = Math.min(...corners.map((p) => p.x));
    const maxSX = Math.max(...corners.map((p) => p.x));
    const minSY = Math.min(...corners.map((p) => p.y));
    const maxSY = Math.max(...corners.map((p) => p.y));
    const boundsOutside = minSX < 12 || maxSX > rect.width - 12 || minSY < 12 || maxSY > rect.height - 12;
    const manualRecently = Date.now() - (state.navViewport.lastManualAt || 0) < 2200;

    if (forceFit || outsideCurrent || (!manualRecently && boundsOutside)) {
      fitViewportToBounds(state.navViewport, bounds, wrapEl, safeMargin);
    }
  }

  function setWrapFullscreenState(wrapEl, active) {
    if (!wrapEl) return;
    wrapEl.classList.toggle("fullscreen-active", Boolean(active));
    document.body.style.overflow = active ? "hidden" : "";
  }

  function isWrapFullscreen(wrapEl) {
    if (!wrapEl) return false;
    return document.fullscreenElement === wrapEl || document.webkitFullscreenElement === wrapEl || wrapEl.classList.contains("fullscreen-active");
  }

  async function toggleWrapFullscreen(wrapId) {
    const wrapEl = $(wrapId);
    if (!wrapEl) return;
    const active = isWrapFullscreen(wrapEl);
    try {
      if (!active) {
        if (wrapEl.requestFullscreen) {
          await wrapEl.requestFullscreen();
        } else if (wrapEl.webkitRequestFullscreen) {
          await wrapEl.webkitRequestFullscreen();
        } else {
          setWrapFullscreenState(wrapEl, true);
        }
      } else if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } else {
        setWrapFullscreenState(wrapEl, false);
      }
    } catch (e) {
      setWrapFullscreenState(wrapEl, !active);
    }
    window.setTimeout(() => {
      ensureCanvasSize($("trackCanvas"), $("trackCanvasWrap"));
      ensureCanvasSize($("editorCanvas"), $("editorCanvasWrap"));
      ensureNavViewportVisible(true);
      refreshViewportUI();
    }, 50);
  }

  function updateFullscreenButtons() {
    [
      { wrapId: "trackCanvasWrap", btnId: "btnTrackFullscreen" },
      { wrapId: "editorCanvasWrap", btnId: "btnEditorFullscreen" }
    ].forEach(({ wrapId, btnId }) => {
      const btn = $(btnId);
      const wrapEl = $(wrapId);
      if (!btn || !wrapEl) return;
      btn.textContent = isWrapFullscreen(wrapEl) ? "結束全螢幕" : "全螢幕";
    });
  }

  function attachViewportHandlers(wrapEl, canvasEl, viewport, type) {
    if (!wrapEl || !canvasEl) return;

    wrapEl.addEventListener("wheel", (evt) => {
      evt.preventDefault();
      const delta = evt.deltaY < 0 ? 1.08 : 0.92;
      viewport.scale *= delta;
      clampViewport(viewport);
      markViewportManual(viewport);
      refreshViewportUI();
    }, { passive: false });

    wrapEl.addEventListener("pointerdown", (evt) => {
      if (type === "editor" && state.editorMode !== "idle") return;
      wrapEl.setPointerCapture?.(evt.pointerId);
      const gesture = {
        pointerId: evt.pointerId,
        startX: evt.clientX,
        startY: evt.clientY,
        startPanX: viewport.panX,
        startPanY: viewport.panY,
        moved: false
      };
      if (type === "nav") navCanvasGesture = gesture;
      else editorCanvasGesture = gesture;
    });

    wrapEl.addEventListener("pointermove", (evt) => {
      const gesture = type === "nav" ? navCanvasGesture : editorCanvasGesture;
      if (!gesture || gesture.pointerId !== evt.pointerId) return;
      const dx = evt.clientX - gesture.startX;
      const dy = evt.clientY - gesture.startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        gesture.moved = true;
        if (type === "nav") state.lastNavCanvasDragAt = Date.now();
      }
      viewport.panX = gesture.startPanX + dx;
      viewport.panY = gesture.startPanY + dy;
      clampViewport(viewport);
      markViewportManual(viewport);
      refreshViewportUI();
    });

    const endGesture = (evt) => {
      const gesture = type === "nav" ? navCanvasGesture : editorCanvasGesture;
      if (!gesture || gesture.pointerId !== evt.pointerId) return;
      if (type === "nav") navCanvasGesture = null;
      else editorCanvasGesture = null;
    };
    wrapEl.addEventListener("pointerup", endGesture);
    wrapEl.addEventListener("pointercancel", endGesture);

    let touchInfo = null;
    wrapEl.addEventListener("touchstart", (evt) => {
      if (evt.touches.length === 2) {
        const [t1, t2] = evt.touches;
        touchInfo = {
          startDistance: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
          startScale: viewport.scale
        };
      }
    }, { passive: true });

    wrapEl.addEventListener("touchmove", (evt) => {
      if (evt.touches.length === 2 && touchInfo) {
        evt.preventDefault();
        const [t1, t2] = evt.touches;
        const distance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        viewport.scale = touchInfo.startScale * (distance / Math.max(touchInfo.startDistance, 1));
        clampViewport(viewport);
        markViewportManual(viewport);
        refreshViewportUI();
      }
    }, { passive: false });

    wrapEl.addEventListener("dblclick", () => {
      viewport.scale = viewport.scale > 1 ? 1 : 1.8;
      if (viewport.scale === 1) {
        viewport.panX = 0;
        viewport.panY = 0;
      }
      clampViewport(viewport);
      markViewportManual(viewport);
      refreshViewportUI();
    });
  }

  function injectEnhancementUI() {
    const navBtnRow = $("btnPosCorrection")?.closest(".big-actions");
    if (navBtnRow && !$("btnGpsAnchorCreate")) {
      const extra = document.createElement("div");
      extra.className = "btns";
      extra.style.marginTop = "10px";
      extra.innerHTML = `
        <button id="btnAnchorCorrection" class="secondary" type="button">以標定點校正目前位置</button>
        <button id="btnGpsFusionCorrection" class="secondary" type="button">以 GPS 柔性校正</button>
      `;
      navBtnRow.parentNode.insertBefore(extra, navBtnRow.nextSibling);
    }

    const navWrap = $("trackCanvasWrap");
    if (navWrap && !$("btnTrackFullscreen")) {
      const action = document.createElement("div");
      action.className = "map-toolbar-row";
      action.innerHTML = `<button id="btnTrackFullscreen" class="map-action-btn" type="button">全螢幕</button><button id="btnNavAutoFit" class="map-action-btn" type="button">回正 開</button><button id="btnNavFollow" class="map-action-btn" type="button">跟隨 開</button><button id="btnNavFitNow" class="map-action-btn" type="button">置中</button>`;
      navWrap.parentNode.insertBefore(action, navWrap.nextSibling);
    }

    const editorWrap = $("editorCanvasWrap");
    if (editorWrap && !$("btnEditorFullscreen")) {
      const action = document.createElement("div");
      action.className = "map-overlay map-action-group";
      action.innerHTML = `<button id="btnEditorFullscreen" class="map-action-btn" type="button">全螢幕</button>`;
      editorWrap.appendChild(action);
    }

    const mapControls = $("btnEditorClear")?.parentElement;
    if (mapControls && !$("btnEditorAnchor")) {
      const btn = document.createElement("button");
      btn.id = "btnEditorAnchor";
      btn.className = "secondary";
      btn.textContent = "新增標定點";
      mapControls.insertBefore(btn, $("btnEditorUndo"));
    }

    const qrForm = $("btnSaveAnchor")?.parentElement;
    if (qrForm && !$("btnUseGpsForDraftAnchor")) {
      const btn = document.createElement("button");
      btn.id = "btnUseGpsForDraftAnchor";
      btn.textContent = "用 GPS 帶入標定點";
      qrForm.insertBefore(btn, $("btnSaveAnchor"));
    }

    const correctionList = $("correctionList");
    if (correctionList && !$("anchorCorrectionSelect")) {
      const box = document.createElement("div");
      box.className = "formbox";
      box.innerHTML = `
        <div class="row">
          <label for="anchorCorrectionSelect">選擇標定點作為目前位置校正</label>
          <select id="anchorCorrectionSelect" style="width:100%; border:1px solid var(--border); border-radius:14px; padding:10px 12px; font-size:15px; background:white;">
            <option value="">請先選擇標定點</option>
          </select>
        </div>
        <div class="subtle" id="autoStepStatus">自動步長估算：尚未取得穩定 GPS 視窗。</div>
      `;
      correctionList.parentNode.insertBefore(box, correctionList);
    }
  }

  function updateAnchorCorrectionSelect() {
    const sel = $("anchorCorrectionSelect");
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = ['<option value="">請先選擇標定點</option>']
      .concat(state.savedAnchors.map(a => `<option value="${a.id}">${a.name} (x:${a.x}, y:${a.y}${a.heading == null ? "" : ", h:" + a.heading})</option>`))
      .join("");
    if (state.savedAnchors.some(a => a.id === current)) sel.value = current;
  }

  function updateAutoStepStatus() {
    const el = $("autoStepStatus");
    if (!el) return;
    const est = state.autoStepCalibration.lastEstimate;
    if (!est) {
      el.textContent = "自動步長估算：尚未取得穩定 GPS 視窗。";
      return;
    }
    el.textContent = `自動步長估算：${fmt(est.stepLength, 2)} m/步，步頻 ${fmt(est.cadence, 2)} 步/秒，來源距離 ${fmt(est.distance, 1)} m。`;
  }

  function sampleCurrentGps(durationMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!state.geoReading) {
        reject(new Error("目前沒有 GPS 讀值"));
        return;
      }
      const startedAt = Date.now();
      const samples = [];
      const timer = setInterval(() => {
        if (state.geoReading) {
          samples.push({ ...state.geoReading });
        }
        if (Date.now() - startedAt >= durationMs) {
          clearInterval(timer);
          const filtered = samples.filter((s) => Number.isFinite(s.accuracy) && s.accuracy <= Math.max(MIN_GPS_ACCURACY_METERS, 25));
          const base = filtered.length >= 3 ? filtered : samples;
          if (!base.length) {
            reject(new Error("沒有收集到 GPS 樣本"));
            return;
          }
          const weights = base.map((s) => 1 / Math.max(s.accuracy || MIN_GPS_ACCURACY_METERS, 1));
          const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
          const avgLat = base.reduce((sum, s, i) => sum + s.lat * weights[i], 0) / weightSum;
          const avgLng = base.reduce((sum, s, i) => sum + s.lng * weights[i], 0) / weightSum;
          const avgAcc = base.reduce((sum, s) => sum + (s.accuracy || 0), 0) / base.length;
          resolve({ lat: avgLat, lng: avgLng, accuracy: avgAcc, sampleCount: base.length });
        }
      }, SAMPLE_MS);
    });
  }

  function ensureGeoAnchorReference() {
    if (!state.anchor && state.geoReading) {
      state.anchor = { lat: state.geoReading.lat, lng: state.geoReading.lng };
    }
  }

  function applyPoseShift(dx, dy) {
    state.trail = state.trail.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
    state.currentPose = { ...state.currentPose, x: state.currentPose.x + dx, y: state.currentPose.y + dy };
  }

  function applyHeadingRotation(delta) {
    state.trail = state.trail.map((p) => {
      const rotated = rotatePoint(p, delta);
      return { ...p, x: rotated.x, y: rotated.y, heading: normalizeAngle((p.heading ?? 0) + delta) };
    });
    const rp = rotatePoint(state.currentPose, delta);
    state.currentPose = { ...state.currentPose, x: rp.x, y: rp.y, heading: normalizeAngle((state.currentPose.heading ?? 0) + delta) };
  }

  function applyAnchorCorrection(anchorId) {
    const anchor = state.savedAnchors.find(a => a.id === anchorId);
    if (!anchor) {
      setMessage("請先選擇有效的標定點。");
      return;
    }
    const before = latestPose();
    applyPoseShift(Number(anchor.x || 0) - before.x, Number(anchor.y || 0) - before.y);
    if (anchor.heading != null && Number.isFinite(Number(anchor.heading))) {
      applyHeadingRotation(angleDelta(Number(anchor.heading), before.heading ?? state.currentPose.heading));
    }
    state.corrections.unshift({
      id: crypto.randomUUID(),
      type: "anchor",
      source: "manual-anchor",
      beforeX: before.x,
      beforeY: before.y,
      afterX: Number(anchor.x || 0),
      afterY: Number(anchor.y || 0),
      afterHeading: anchor.heading,
      ts: Date.now()
    });
    setMessage(`已用標定點 ${anchor.name} 校正目前位置。`);
    updateArrivalProgress();
    render();
  }

  async function createAnchorFromGpsDraft() {
    try {
      state.gpsAnchorSampling = true;
      setMessage("GPS 標定點建立中，請稍微站定 5 秒。");
      const sample = await sampleCurrentGps(5000);
      ensureGeoAnchorReference();
      const meters = latLngToMeters(state.anchor, { lat: sample.lat, lng: sample.lng });
      $("xValue").value = meters.x.toFixed(2);
      $("yValue").value = meters.y.toFixed(2);
      $("headingValueInput").value = Math.round(normalizeAngle(state.orientation.heading || latestPose().heading || 0));
      if (!$("anchorName").value.trim()) {
        $("anchorName").value = `GPS 標定點 ${state.savedAnchors.length + 1}`;
      }
      generateQr();
      setMessage(`已用 GPS 帶入標定點座標，accuracy 約 ${fmt(sample.accuracy, 1)} m。`);
    } catch (e) {
      setMessage("建立 GPS 標定點失敗：" + e.message);
    } finally {
      state.gpsAnchorSampling = false;
      render();
    }
  }

  async function createSavedAnchorFromGps() {
    try {
      state.gpsAnchorSampling = true;
      setMessage("以 GPS 建立標定點中，請稍微站定 5 秒。");
      const sample = await sampleCurrentGps(5000);
      ensureGeoAnchorReference();
      const meters = latLngToMeters(state.anchor, { lat: sample.lat, lng: sample.lng });
      const heading = Math.round(normalizeAngle(state.orientation.heading || latestPose().heading || 0));
      const anchor = {
        id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        name: `GPS 標定點 ${state.savedAnchors.length + 1}`,
        x: Number(meters.x.toFixed(2)),
        y: Number(meters.y.toFixed(2)),
        heading,
        source: "gps-fixed",
        gps: { lat: sample.lat, lng: sample.lng, accuracy: sample.accuracy },
        payload: `INDOOR_ANCHOR:${Number(meters.x.toFixed(2))},${Number(meters.y.toFixed(2))},${heading}`,
        createdAt: new Date().toISOString()
      };
      state.savedAnchors.unshift(anchor);
      persistSavedAnchors();
      setMessage(`已建立 GPS 固定標定點：${anchor.name}。`);
      render();
    } catch (e) {
      setMessage("GPS 標定點建立失敗：" + e.message);
    } finally {
      state.gpsAnchorSampling = false;
      render();
    }
  }

  function applySoftGpsCorrection(sample, source = "gps-soft") {
    if (!sample) return;
    ensureGeoAnchorReference();
    if (!state.anchor) return;
    const measured = latLngToMeters(state.anchor, { lat: sample.lat, lng: sample.lng });
    const before = latestPose();
    const acc = Number(sample.accuracy || MIN_GPS_ACCURACY_METERS);
    const weight = acc <= 6 ? 0.8 : acc <= 10 ? 0.6 : acc <= 15 ? 0.4 : 0.2;
    const dx = (measured.x - before.x) * weight;
    const dy = (measured.y - before.y) * weight;
    applyPoseShift(dx, dy);
    state.lastGeoCorrectionAt = Date.now();
    state.corrections.unshift({
      id: crypto.randomUUID(),
      type: "position",
      source,
      beforeX: before.x,
      beforeY: before.y,
      afterX: before.x + dx,
      afterY: before.y + dy,
      dx, dy,
      accuracy: acc,
      ts: Date.now()
    });
  }

  function updateAutoStepCalibration(sample) {
    if (!sample || !state.autoStepCalibration.enabled) return;
    ensureGeoAnchorReference();
    if (!state.anchor) return;
    const windowState = state.autoStepCalibration;
    const now = Date.now();
    if (!windowState.windowStart) {
      windowState.windowStart = {
        ts: now,
        stepCount: state.stepCount,
        pos: latLngToMeters(state.anchor, { lat: sample.lat, lng: sample.lng }),
        accuracy: sample.accuracy
      };
      return;
    }
    const elapsed = (now - windowState.windowStart.ts) / 1000;
    if (elapsed < 6) return;
    const current = latLngToMeters(state.anchor, { lat: sample.lat, lng: sample.lng });
    const distance = distanceBetween(windowState.windowStart.pos, current);
    const stepsDelta = state.stepCount - windowState.windowStart.stepCount;
    const cadence = stepsDelta / Math.max(elapsed, 0.1);
    const headingDelta = Math.abs(angleDelta(state.orientation.heading || latestPose().heading || 0, latestPose().heading || 0));
    if (distance >= 6 && stepsDelta >= 8 && cadence >= 0.6 && cadence <= 3.2 && Number(sample.accuracy || 999) <= 15 && headingDelta <= 45) {
      const estimated = distance / stepsDelta;
      if (estimated >= 0.35 && estimated <= 1.2) {
        state.stepLength = Number((state.stepLength * 0.8 + estimated * 0.2).toFixed(3));
        state.averageWalkingSpeed = Number((state.averageWalkingSpeed * 0.8 + (distance / elapsed) * 0.2).toFixed(3));
        if ($("stepLength")) $("stepLength").value = String(Math.max(0.4, Math.min(1.0, state.stepLength)));
        windowState.lastEstimate = { stepLength: state.stepLength, cadence, distance, elapsed };
      }
    }
    windowState.windowStart = {
      ts: now,
      stepCount: state.stepCount,
      pos: current,
      accuracy: sample.accuracy
    };
    updateAutoStepStatus();
  }

  function average(nums) {
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }

  function fmtMetersInt(n) {
    const v = Number(n || 0);
    return Number.isFinite(v) ? String(Math.round(v)) : "0";
  }

function fmt(n, d = 2) {
    return Number.isFinite(n) ? n.toFixed(d) : "-";
  }

  function normalizeSavedAnchorRecord(a, idx = 0) {
    const x = Number(a?.x ?? 0);
    const y = Number(a?.y ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const heading = a?.heading == null || a.heading === "" ? null : Number(a.heading);
    const source = a?.source || (a?.gps ? "gps-fixed" : "manual");
    return {
      id: a?.id || ((crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + idx)),
      name: a?.name || `校正點 ${idx + 1}`,
      x,
      y,
      heading: Number.isFinite(heading) ? heading : null,
      source,
      gps: a?.gps ? { lat: Number(a.gps.lat), lng: Number(a.gps.lng), accuracy: Number(a.gps.accuracy) } : null,
      payload: a?.payload || `INDOOR_ANCHOR:${x}${Number.isFinite(y) ? ',' + y : ',0'}${Number.isFinite(heading) ? ',' + heading : ''}`,
      createdAt: a?.createdAt || new Date().toISOString()
    };
  }

  function anchorDisplayColor(anchor) {
    if (!anchor) return '#2563eb';
    if (anchor.source === 'current-pose') return '#d946ef';
    if (anchor.source === 'gps' || anchor.source === 'gps-fixed') return '#2563eb';
    if (anchor.source === 'map-point') return '#0ea5e9';
    return '#2563eb';
  }

  function anchorLabelColor(anchor) {
    if (!anchor) return '#1e3a8a';
    if (anchor.source === 'current-pose') return '#a21caf';
    if (anchor.source === 'map-point') return '#0369a1';
    return '#1e3a8a';
  }

  function normalizeAngle(deg) {
    let a = deg % 360;
    if (a < 0) a += 360;
    return a;
  }

  function angleDelta(target, current) {
    let d = normalizeAngle(target) - normalizeAngle(current);
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  function rotatePoint(point, deg) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos
    };
  }

  function latLngToMeters(anchor, point) {
    if (!anchor || !point) return { x: 0, y: 0 };
    const latScale = 111320;
    const lngScale = 111320 * Math.cos((anchor.lat * Math.PI) / 180);
    return {
      x: (point.lng - anchor.lng) * lngScale,
      y: -(point.lat - anchor.lat) * latScale
    };
  }

  function latestPose() {
    return state.filteredPose || state.trail[state.trail.length - 1] || state.currentPose;
  }

  function rawLatestPose() {
    return state.trail[state.trail.length - 1] || state.currentPose;
  }

  function smoothAngleDeg(prev, next, alpha) {
    const d = angleDelta(next, prev);
    return normalizeAngle(prev + d * alpha);
  }

  function updateFilteredPose() {
    const raw = rawLatestPose();
    if (!raw) return;
    const prev = state.filteredPose || { x: raw.x || 0, y: raw.y || 0, heading: raw.heading || 0 };
    const alpha = Math.max(0.05, Math.min(0.9, Number(state.poseSmoothingAlpha || 0.22)));
    const filtered = {
      x: Number(prev.x || 0) + (Number(raw.x || 0) - Number(prev.x || 0)) * alpha,
      y: Number(prev.y || 0) + (Number(raw.y || 0) - Number(prev.y || 0)) * alpha,
      heading: smoothAngleDeg(Number(prev.heading || 0), Number(raw.heading || 0), alpha),
      t: raw.t || Date.now()
    };
    state.filteredPose = filtered;
    return filtered;
  }

  function setMessage(msg) {
    state.message = msg;
    render();
  }

  function gpsBadgeText() {
    const acc = state.geoReading?.accuracy;
    if (!acc) return "無GPS";
    if (acc <= 10) return "GPS佳";
    if (acc <= 25) return "GPS可用";
    return "GPS偏弱";
  }


  function loadNavTrackPoints() {
    try {
      const raw = localStorage.getItem("indoor_nav_track_points");
      const parsed = raw ? JSON.parse(raw) : [];
      state.navTrackPoints = Array.isArray(parsed) ? parsed.map((p, idx) => normalizeNavTrackPoint(p, idx)).filter(Boolean) : [];
    } catch (e) {
      state.navTrackPoints = [];
    }
  }

  function persistNavTrackPoints() {
    localStorage.setItem("indoor_nav_track_points", JSON.stringify(state.navTrackPoints));
  }

  function normalizeNavTrackPoint(p, idx = 0) {
    const x = Number(p?.x ?? 0);
    const y = Number(p?.y ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      id: p?.id || ((crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + idx)),
      name: p?.name || `軌跡點 ${idx + 1}`,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      createdAt: p?.createdAt || new Date().toISOString()
    };
  }

  function navCanvasWorldFromEvent(evt) {
    const wrap = $("trackCanvasWrap");
    const canvas = $("trackCanvas");
    if (!wrap || !canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const local = {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
    return viewportScreenToWorld(local, state.navViewport, wrap);
  }

  function findNavTrackPointNear(world, toleranceMeters = 1.2) {
    let best = null;
    let bestDist = Infinity;
    state.navTrackPoints.forEach((p) => {
      const d = distanceBetween(world, p);
      if (d <= toleranceMeters && d < bestDist) {
        best = p;
        bestDist = d;
      }
    });
    return best;
  }

  function cumulativeTrailDistances() {
    const out = [0];
    for (let i = 1; i < state.trail.length; i++) {
      out[i] = out[i - 1] + distanceBetween(state.trail[i - 1], state.trail[i]);
    }
    return out;
  }

  function trajectoryDistanceFromStartToPoint(point) {
    if (!point || !state.trail.length) return 0;
    const cum = cumulativeTrailDistances();
    let bestIdx = 0;
    let bestDist = Infinity;
    state.trail.forEach((p, idx) => {
      const d = distanceBetween(point, p);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = idx;
      }
    });
    return cum[bestIdx] || 0;
  }

  function showNavTrackPointInfo(point) {
    if (!point) return;
    const trajDist = trajectoryDistanceFromStartToPoint(point);
    state.selectedNavTrackPointId = point.id;
    setMessage(`軌跡點「${point.name}」：座標 (${fmt(point.x, 2)}, ${fmt(point.y, 2)}) m，距起點軌跡距離 ${fmt(trajDist, 1)} m。起點座標為 (0,0) m。`);
    render();
  }

  function addNavTrackPointAt(world) {
    const defaultName = `軌跡點 ${state.navTrackPoints.length + 1}`;
    const promptValue = window.prompt("請輸入軌跡點名稱", defaultName);
    const name = (promptValue || "").trim();
    if (!name) {
      setMessage("已取消新增軌跡點。");
      return;
    }
    const point = {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      name,
      x: Number(Number(world.x || 0).toFixed(2)),
      y: Number(Number(world.y || 0).toFixed(2)),
      createdAt: new Date().toISOString()
    };
    state.navTrackPoints.unshift(point);
    state.selectedNavTrackPointId = point.id;
    persistNavTrackPoints();
    if (state.navAutoFit) ensureNavViewportVisible(true);
    const trajDist = trajectoryDistanceFromStartToPoint(point);
    setMessage(`已新增軌跡點「${point.name}」：座標 (${fmt(point.x, 2)}, ${fmt(point.y, 2)}) m，距起點軌跡距離 ${fmt(trajDist, 1)} m。`);
    render();
  }

  function handleNavCanvasClick(evt) {
    if (Date.now() - (state.lastNavCanvasDragAt || 0) < 250) return;
    const world = navCanvasWorldFromEvent(evt);
    const existing = findNavTrackPointNear(world);
    if (existing) {
      showNavTrackPointInfo(existing);
      return;
    }
    addNavTrackPointAt(world);
  }

  function handleNavCanvasPointerUp(evt) {
    if (Date.now() - (state.lastNavCanvasDragAt || 0) < 250) return;
    if (Date.now() - (state.lastNavCanvasTapAt || 0) < 350) return;
    state.lastNavCanvasTapAt = Date.now();
    const world = navCanvasWorldFromEvent(evt);
    const existing = findNavTrackPointNear(world);
    if (existing) {
      showNavTrackPointInfo(existing);
      return;
    }
    addNavTrackPointAt(world);
  }

  function renderCorrections() {
    const box = $("correctionList");
    if (!state.corrections.length) {
      box.innerHTML = `<div class="item">尚未進行校正。建議先在入口設定起點，追蹤後到窗邊做位置校正，再做方向校正。</div>`;
      return;
    }
    box.innerHTML = state.corrections.map((c) => {
      const top = `<div class="item-top"><span class="badge">${c.type}</span><span style="color:#64748b;">${new Date(c.ts).toLocaleTimeString()}</span></div>`;
      if (c.type === "position") {
        return `<div class="item">${top}
          <div>before: (${fmt(c.beforeX)}, ${fmt(c.beforeY)})</div>
          <div>after: (${fmt(c.afterX)}, ${fmt(c.afterY)})</div>
          <div>accuracy: ${fmt(c.accuracy, 1)} m</div>
          <div>samples: ${c.sampleCount ?? "-"}</div>
          <div>offset: dx ${fmt(c.dx)} / dy ${fmt(c.dy)}</div>
        </div>`;
      }
      if (c.type === "heading") {
        return `<div class="item">${top}
          <div>before: ${fmt(c.beforeHeading, 1)}°</div>
          <div>after: ${fmt(c.afterHeading, 1)}°</div>
          <div>delta: ${fmt(c.delta, 1)}°</div>
          <div>samples: ${c.sampleCount ?? "-"}</div>
        </div>`;
      }
      return `<div class="item">${top}
        <div>before: (${fmt(c.beforeX)}, ${fmt(c.beforeY)})</div>
        <div>after: (${fmt(c.afterX)}, ${fmt(c.afterY)})</div>
        ${c.afterHeading != null ? `<div>heading: ${fmt(c.afterHeading, 1)}°</div>` : ``}
      </div>`;
    }).join("");
  }


  function drawGrid(ctx, wrapEl, viewport) {
    const rect = getWrapRect(wrapEl);
    const step = DEFAULT_WORLD_SCALE * (viewport?.scale || 1);
    if (step < 6) return;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const centerX = rect.width / 2 + (viewport?.panX || 0);
    const centerY = rect.height / 2 + (viewport?.panY || 0);
    for (let x = centerX % step; x <= rect.width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
    }
    for (let y = centerY % step; y <= rect.height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
    }
    ctx.stroke();
  }

  function drawCrosshair(ctx, wrapEl, viewport) {
    const rect = getWrapRect(wrapEl);
    const cx = rect.width / 2 + (viewport?.panX || 0);
    const cy = rect.height / 2 + (viewport?.panY || 0);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, rect.height);
    ctx.moveTo(0, cy);
    ctx.lineTo(rect.width, cy);
    ctx.stroke();
  }

  function lineWidthForWorld(px, viewport) {
    return Math.max(1, px * Math.sqrt(viewport?.scale || 1));
  }

  function fixedRadius(px) {
    return px;
  }

  function labelBox(ctx, x, y, label, fg = "#334155") {
    const metrics = ctx.measureText(label);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(x - 4, y - 12, metrics.width + 8, 18);
    ctx.fillStyle = fg;
    ctx.fillText(label, x, y);
  }

  function drawMapElementsOnCanvas(ctx, withLabels = true, viewport = state.navViewport, wrapEl = $("trackCanvasWrap")) {
    if (!state.showMapOverlay || !state.mapElements.length) return;

    state.mapElements.slice().reverse().forEach((el) => {
      const isSelected = el.id === state.selectedMapElementId;
      const semantic = el.semantic || "walkable";
      if (el.type === "point") {
        const pt = viewportWorldToScreen({ x: Number(el.x || 0), y: Number(el.y || 0) }, viewport, wrapEl);
        ctx.fillStyle = isSelected ? "#ef4444" : (semantic === "landmark" ? "#0ea5e9" : semantic === "restricted" ? "#f59e0b" : "#059669");
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, fixedRadius(5), 0, Math.PI * 2);
        ctx.fill();
        if (withLabels) {
          ctx.fillStyle = "#065f46";
          ctx.font = "12px system-ui, sans-serif";
          labelBox(ctx, pt.x + 8, pt.y - 8, el.name || "point", "#065f46");
        }
      } else if (el.type === "line" && Array.isArray(el.points) && el.points.length >= 2) {
        ctx.strokeStyle = isSelected ? "#ef4444" : (semantic === "wall" ? "#111827" : semantic === "restricted" ? "#f59e0b" : "#7c3aed");
        ctx.lineWidth = semantic === "wall" ? lineWidthForWorld(5, viewport) : lineWidthForWorld(isSelected ? 4 : 3, viewport);
        ctx.beginPath();
        el.points.forEach((p, i) => {
          const pt = viewportWorldToScreen({ x: Number(p.x || 0), y: Number(p.y || 0) }, viewport, wrapEl);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
        if (withLabels) {
          const midIdx = Math.floor(el.points.length / 2);
          const mid = el.points[midIdx] || el.points[0];
          const pt = viewportWorldToScreen({ x: Number(mid.x || 0), y: Number(mid.y || 0) }, viewport, wrapEl);
          ctx.font = "12px system-ui, sans-serif";
          labelBox(ctx, pt.x + 8, pt.y - 8, el.name || "line", "#5b21b6");
        }
      } else if (el.type === "area" && Array.isArray(el.points) && el.points.length >= 3) {
        ctx.fillStyle = isSelected ? "rgba(239,68,68,0.14)" : (semantic === "restricted" ? "rgba(239,68,68,0.12)" : "rgba(234,179,8,0.14)");
        ctx.strokeStyle = isSelected ? "#ef4444" : (semantic === "restricted" ? "#dc2626" : "#ca8a04");
        ctx.lineWidth = lineWidthForWorld(isSelected ? 3 : 2, viewport);
        ctx.beginPath();
        el.points.forEach((p, i) => {
          const pt = viewportWorldToScreen({ x: Number(p.x || 0), y: Number(p.y || 0) }, viewport, wrapEl);
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (withLabels) {
          const p0 = el.points[0];
          const pt = viewportWorldToScreen({ x: Number(p0.x || 0), y: Number(p0.y || 0) }, viewport, wrapEl);
          ctx.font = "12px system-ui, sans-serif";
          labelBox(ctx, pt.x + 8, pt.y - 8, el.name || "area", "#92400e");
        }
      }
    });
  }



  function currentStartToPoseDistance() {
    if (!state.trail.length) return 0;
    return distanceBetween(state.trail[0], latestPose());
  }

  function formatScaleMeters(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return "0 m";
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    if (meters >= 100) return `${Math.round(meters)} m`;
    if (meters >= 10) return `${meters.toFixed(1)} m`;
    return `${meters.toFixed(2)} m`;
  }

  function drawScaleRuler(ctx, wrapEl, viewport, corner = "bottom-left") {
    const base = getBasePixelsPerWorld(wrapEl);
    const pxPerMeterX = Math.max(base.x * (viewport?.scale || 1), 0.001);
    const targetPx = 120;
    const rawMeters = targetPx / pxPerMeterX;
    const choices = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let meters = choices[choices.length - 1];
    for (const c of choices) {
      if (rawMeters <= c) { meters = c; break; }
    }
    const rulerPx = meters * pxPerMeterX;
    const rect = getWrapRect(wrapEl);
    const margin = 18;
    const x = corner === "bottom-right" ? rect.width - margin - rulerPx : margin;
    const y = rect.height - margin;

    ctx.save();
    ctx.strokeStyle = "#0f172a";
    ctx.fillStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rulerPx, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.moveTo(x + rulerPx, y - 8);
    ctx.lineTo(x + rulerPx, y + 8);
    ctx.stroke();
    labelBox(ctx, x, y - 14, `尺規 ${formatScaleMeters(meters)}`, "#0f172a");
    ctx.restore();
  }

  function drawStartToCurrentDistanceBadge(ctx, wrapEl, viewport, title = "起點→目前位置") {
    if (!state.trail.length) return;
    const dist = currentStartToPoseDistance();
    const rect = getWrapRect(wrapEl);
    labelBox(ctx, rect.width - 220, 22, `${title}：${formatScaleMeters(dist)}`, "#7c2d12");
  }


  function totalTrailDistance() {
    if (!state.trail.length || state.trail.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < state.trail.length; i++) {
      total += distanceBetween(state.trail[i - 1], state.trail[i]);
    }
    return total;
  }

  function currentSegmentSpeedMps() {
    if (!state.trail.length || state.trail.length < 2) return 0;
    const last = state.trail[state.trail.length - 1];
    const prev = state.trail[state.trail.length - 2];
    const dt = Math.max(((Number(last.t || 0) - Number(prev.t || 0)) / 1000), 0.001);
    return distanceBetween(prev, last) / dt;
  }

  function averageTrailSpeedMps() {
    if (!state.trail.length || state.trail.length < 2) return 0;
    const first = state.trail[0];
    const last = state.trail[state.trail.length - 1];
    const dt = Math.max(((Number(last.t || 0) - Number(first.t || 0)) / 1000), 0.001);
    return totalTrailDistance() / dt;
  }

  function movementHeadingDegrees() {
    if (!state.trail.length || state.trail.length < 2) return latestPose().heading || 0;
    const last = state.trail[state.trail.length - 1];
    const prev = state.trail[state.trail.length - 2];
    const dx = Number(last.x || 0) - Number(prev.x || 0);
    const dy = Number(last.y || 0) - Number(prev.y || 0);
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return latestPose().heading || 0;
    return normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
  }

  function headingToText(deg) {
    const a = normalizeAngle(deg || 0);
    if (a >= 337.5 || a < 22.5) return "北";
    if (a < 67.5) return "東北";
    if (a < 112.5) return "東";
    if (a < 157.5) return "東南";
    if (a < 202.5) return "南";
    if (a < 247.5) return "西南";
    if (a < 292.5) return "西";
    return "西北";
  }

  function formatSpeed(mps) {
    const v = Number(mps || 0);
    if (!Number.isFinite(v) || v <= 0) return "0.00 m/s";
    return `${v.toFixed(2)} m/s`;
  }

  function drawNavTelemetryPanel(ctx, wrapEl, viewport) {
    return;
  }



  function updateNavTelemetryDom() {
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    if (!state.trail.length) {
      setText("navStatStartDistance", "0 m");
      setText("navStatSpeed", "0.00 m/s");
      setText("navStatHeading", "北 (0°)");
      setText("navStatAvgSpeed", "0.00 m/s");
      setText("navStatTotalDistance", "0 m");
      setText("navStatCoords", "(0 m, 0 m)");
      setText("navCoordChip", "(0 m, 0 m)");
      return;
    }
    const pose = latestPose();
    const totalDist = totalTrailDistance();
    const startDist = currentStartToPoseDistance();
    const heading = movementHeadingDegrees();
    const speed = currentSegmentSpeedMps();
    const avgSpeed = averageTrailSpeedMps();
    const coordText = `(${fmtMetersInt(pose.x)} m, ${fmtMetersInt(pose.y)} m)`;
    setText("navStatStartDistance", formatScaleMeters(startDist));
    setText("navStatSpeed", formatSpeed(speed));
    setText("navStatHeading", `${headingToText(heading)} (${heading.toFixed(0)}°)`);
    setText("navStatAvgSpeed", formatSpeed(avgSpeed));
    setText("navStatTotalDistance", formatScaleMeters(totalDist));
    setText("navStatCoords", coordText);
    setText("navCoordChip", coordText);
  }


  function getSmoothedTrail(points, windowSize = 2) {
    if (!Array.isArray(points) || points.length <= 2) return points || [];
    const out = points.map((p) => ({ ...p }));
    for (let i = 1; i < points.length - 1; i++) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(points.length - 1, i + windowSize); j++) {
        sumX += Number(points[j].x || 0);
        sumY += Number(points[j].y || 0);
        count += 1;
      }
      out[i].x = sumX / Math.max(count, 1);
      out[i].y = sumY / Math.max(count, 1);
    }
    out[0].x = Number(points[0].x || 0);
    out[0].y = Number(points[0].y || 0);
    out[out.length - 1].x = Number(points[points.length - 1].x || 0);
    out[out.length - 1].y = Number(points[points.length - 1].y || 0);
    return out;
  }

  function getDisplayTrail() {
    return getSmoothedTrail(state.trail, 2);
  }


  function smoothingLabel(alpha) {
    const a = Number(alpha || 0);
    if (a >= 0.30) return "靈敏";
    if (a <= 0.15) return "穩定";
    return "標準";
  }

  function loadPoseSmoothingPreference() {
    try {
      const rawAlpha = localStorage.getItem("indoor_pose_smoothing_alpha");
      const alpha = Number(rawAlpha);
      if (Number.isFinite(alpha) && alpha >= 0.05 && alpha <= 0.50) {
        state.poseSmoothingAlpha = alpha;
      }
    } catch (e) {}
    refreshSmoothingUi();
  }

  function persistPoseSmoothingPreference() {
    try {
      localStorage.setItem("indoor_pose_smoothing_alpha", String(state.poseSmoothingAlpha));
    } catch (e) {}
  }

  function refreshSmoothingUi() {
    const slider = $("smoothStrengthSlider");
    const value = $("smoothStrengthValue");
    if (slider) slider.value = String(Number(state.poseSmoothingAlpha || 0.22).toFixed(2));
    if (value) value.textContent = `${smoothingLabel(state.poseSmoothingAlpha)} (${Number(state.poseSmoothingAlpha || 0.22).toFixed(2)})`;
  }

  function setPoseSmoothingAlpha(alpha) {
    const next = Math.max(0.05, Math.min(0.50, Number(alpha || 0.22)));
    state.poseSmoothingAlpha = next;
    state.poseSmoothingPreset = smoothingLabel(next);
    persistPoseSmoothingPreference();
    refreshSmoothingUi();
    setMessage(`已調整平滑強度：${smoothingLabel(next)} (${next.toFixed(2)})。`);
    render();
  }

  function drawTrack() {
    const wrapEl = $("trackCanvasWrap");
    if (!wrapEl) return;
    ensureCanvasSize(canvas, wrapEl);
    if (!state.navAutoFit && state.navFollowCurrent) syncNavViewportToCurrentPose();
    updateFilteredPose();
    updateNavTelemetryDom();
    const rect = getWrapRect(wrapEl);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, wrapEl, state.navViewport);
    drawCrosshair(ctx, wrapEl, state.navViewport);
    drawNavTelemetryPanel(ctx, wrapEl, state.navViewport);

    drawMapElementsOnCanvas(ctx, true, state.navViewport, wrapEl);

    const currentPoseAnchors = [];
    if (state.showAnchorOverlay && state.savedAnchors.length) {
      ctx.font = "12px system-ui, sans-serif";
      state.savedAnchors.forEach((a, idx) => {
        if (a?.source === "current-pose") {
          currentPoseAnchors.push({ anchor: a, idx });
          return;
        }
        const pt = viewportWorldToScreen({ x: Number(a.x || 0), y: Number(a.y || 0) }, state.navViewport, wrapEl);
        const anchorColor = anchorDisplayColor(a);

        ctx.fillStyle = anchorColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, fixedRadius(6), 0, Math.PI * 2);
        ctx.fill();

        if (state.highlightAnchorId === a.id) {
          ctx.strokeStyle = anchorColor;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, fixedRadius(14), 0, Math.PI * 2);
          ctx.stroke();
        }

        if (a.heading != null && Number.isFinite(Number(a.heading))) {
          const rad = (Number(a.heading) * Math.PI) / 180;
          ctx.strokeStyle = anchorColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(pt.x + Math.sin(rad) * 18, pt.y - Math.cos(rad) * 18);
          ctx.stroke();
        }
        labelBox(ctx, pt.x + 10, pt.y - 10, a.name || "anchor", anchorLabelColor(a));
      });
    }

    if (!state.trail.length) return;

    const displayTrail = getDisplayTrail();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = lineWidthForWorld(3, state.navViewport);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    displayTrail.forEach((p, i) => {
      const pt = viewportWorldToScreen(p, state.navViewport, wrapEl);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();


    if (state.navTrackPoints.length) {
      state.navTrackPoints.forEach((p) => {
        const pt = viewportWorldToScreen(p, state.navViewport, wrapEl);
        const isSelected = p.id === state.selectedNavTrackPointId;
        ctx.fillStyle = isSelected ? "#f97316" : "#fb923c";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, fixedRadius(isSelected ? 8 : 6), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#9a3412" : "#c2410c";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, fixedRadius(isSelected ? 13 : 10), 0, Math.PI * 2);
        ctx.stroke();
        labelBox(ctx, pt.x + 10, pt.y - 10, p.name || "軌跡點", isSelected ? "#9a3412" : "#c2410c");
      });
    }

    const start = state.trail[0];
    const last = latestPose();

    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (target) {
      const points = state.routeMode === "multi" || state.routeMode === "network"
        ? getSelectedRoutePoints()
        : [{ id: "__current__", x: Number(last.x||0), y: Number(last.y||0) }, { ...target, x: Number(target.x||0), y: Number(target.y||0) }];

      points.forEach((p, i) => {
        if (i === 0) return;
        const prev = points[i - 1];
        const p1 = viewportWorldToScreen(prev, state.navViewport, wrapEl);
        const p2 = viewportWorldToScreen(p, state.navViewport, wrapEl);
        const activeLeg = i - 1 === state.activeLegIndex;

        ctx.strokeStyle = activeLeg ? "#dc2626" : "#ea580c";
        ctx.lineWidth = lineWidthForWorld(activeLeg ? 4 : 3, state.navViewport);
        ctx.setLineDash(activeLeg ? [10, 6] : [8, 8]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        if (activeLeg) {
          const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          const arrowLen = 14;
          ctx.fillStyle = "#dc2626";
          ctx.beginPath();
          ctx.moveTo(p2.x, p2.y);
          ctx.lineTo(p2.x - arrowLen * Math.cos(ang - Math.PI / 6), p2.y - arrowLen * Math.sin(ang - Math.PI / 6));
          ctx.lineTo(p2.x - arrowLen * Math.cos(ang + Math.PI / 6), p2.y - arrowLen * Math.sin(ang + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
      });
      ctx.setLineDash([]);

      points.slice(1).forEach((p, idx) => {
        const pt = viewportWorldToScreen(p, state.navViewport, wrapEl);
        ctx.fillStyle = idx === points.length - 2 ? "#ea580c" : "#f59e0b";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, idx === points.length - 2 ? fixedRadius(9) : fixedRadius(7), 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "12px system-ui, sans-serif";
        const isFinal = idx === points.length - 2;
        const isActiveNext = idx === state.activeLegIndex;
        const label = isFinal
          ? `${p.name || "目標"} / ${fmt(routeDistance(points), 1)}m`
          : `${isActiveNext ? "下一點" : "中繼"}：${p.name || "waypoint"}`;
        labelBox(ctx, pt.x + 12, pt.y + 18, label, idx === points.length - 2 ? "#9a3412" : "#92400e");
      });
    }

    const startPt = viewportWorldToScreen(start, state.navViewport, wrapEl);
    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.arc(startPt.x, startPt.y, fixedRadius(8), 0, Math.PI * 2);
    ctx.fill();

    const lastPt = viewportWorldToScreen(last, state.navViewport, wrapEl);
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(lastPt.x, lastPt.y, fixedRadius(8), 0, Math.PI * 2);
    ctx.fill();

    drawScaleRuler(ctx, wrapEl, state.navViewport, "bottom-left");

    if (currentPoseAnchors.length) {
      currentPoseAnchors.forEach(({ anchor: a, idx }) => {
        const pt = viewportWorldToScreen({ x: Number(a.x || 0), y: Number(a.y || 0) }, state.navViewport, wrapEl);
        const color = anchorDisplayColor(a);
        const angle = (-45 + idx * 18) * Math.PI / 180;
        const badgeOffset = fixedRadius(28 + Math.min(idx, 2) * 8);
        const badgeX = pt.x + Math.cos(angle) * badgeOffset;
        const badgeY = pt.y + Math.sin(angle) * badgeOffset;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = state.highlightAnchorId === a.id ? 5 : 3;

        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(badgeX, badgeY);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(badgeX, badgeY, fixedRadius(14), 0, Math.PI * 2);
        ctx.stroke();

        if (state.highlightAnchorId === a.id) {
          ctx.beginPath();
          ctx.arc(badgeX, badgeY, fixedRadius(22), 0, Math.PI * 2);
          ctx.stroke();
        }

        const diamondR = fixedRadius(9);
        ctx.beginPath();
        ctx.moveTo(badgeX, badgeY - diamondR);
        ctx.lineTo(badgeX + diamondR, badgeY);
        ctx.lineTo(badgeX, badgeY + diamondR);
        ctx.lineTo(badgeX - diamondR, badgeY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, fixedRadius(4), 0, Math.PI * 2);
        ctx.fill();

        if (a.heading != null && Number.isFinite(Number(a.heading))) {
          const rad = (Number(a.heading) * Math.PI) / 180;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(badgeX, badgeY);
          ctx.lineTo(badgeX + Math.sin(rad) * 18, badgeY - Math.cos(rad) * 18);
          ctx.stroke();
        }

        labelBox(ctx, badgeX + 18, badgeY - 18, a.name || "目前位置標定點", anchorLabelColor(a));
        ctx.restore();
      });
    }

  }


  function setNavTarget() {

    ctx.clearRect(0, 0, TRACK_SIZE, TRACK_SIZE);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CENTER, 0);
    ctx.lineTo(CENTER, TRACK_SIZE);
    ctx.moveTo(0, CENTER);
    ctx.lineTo(TRACK_SIZE, CENTER);
    ctx.stroke();

    drawMapElementsOnCanvas(ctx, true);

    if (state.showAnchorOverlay && state.savedAnchors.length) {
      ctx.font = "12px system-ui, sans-serif";
      state.savedAnchors.forEach((a) => {
        const x = CENTER + Number(a.x || 0) * DEFAULT_WORLD_SCALE;
        const y = CENTER + Number(a.y || 0) * DEFAULT_WORLD_SCALE;

        ctx.fillStyle = anchorDisplayColor(a);
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();

        if (a.heading != null && Number.isFinite(Number(a.heading))) {
          const rad = (Number(a.heading) * Math.PI) / 180;
          ctx.strokeStyle = anchorDisplayColor(a);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.sin(rad) * 18, y - Math.cos(rad) * 18);
          ctx.stroke();
        }

        const label = a.name || "anchor";
        const textX = x + 10;
        const textY = y - 10;
        const metrics = ctx.measureText(label);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(textX - 4, textY - 12, metrics.width + 8, 18);
        ctx.fillStyle = anchorLabelColor(a);
        ctx.fillText(label, textX, textY);
      });
    }

    if (!state.trail.length) return;

    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    state.trail.forEach((p, i) => {
      const x = CENTER + p.x * DEFAULT_WORLD_SCALE;
      const y = CENTER + p.y * DEFAULT_WORLD_SCALE;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const start = state.trail[0];
    const last = latestPose();

    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (target) {
      const points = state.routeMode === "multi" ? getSelectedRoutePoints() : [{ id: "__current__", x: Number(last.x||0), y: Number(last.y||0) }, { ...target, x: Number(target.x||0), y: Number(target.y||0) }];

      points.forEach((p, i) => {
        if (i === 0) return;
        const prev = points[i - 1];
        const x1 = CENTER + Number(prev.x || 0) * DEFAULT_WORLD_SCALE;
        const y1 = CENTER + Number(prev.y || 0) * DEFAULT_WORLD_SCALE;
        const x2 = CENTER + Number(p.x || 0) * DEFAULT_WORLD_SCALE;
        const y2 = CENTER + Number(p.y || 0) * DEFAULT_WORLD_SCALE;
        const activeLeg = i - 1 === state.activeLegIndex;

        ctx.strokeStyle = activeLeg ? "#dc2626" : "#ea580c";
        ctx.lineWidth = activeLeg ? 4 : 3;
        ctx.setLineDash(activeLeg ? [10, 6] : [8, 8]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (activeLeg) {
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const arrowLen = 14;
          ctx.fillStyle = "#dc2626";
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - arrowLen * Math.cos(ang - Math.PI / 6), y2 - arrowLen * Math.sin(ang - Math.PI / 6));
          ctx.lineTo(x2 - arrowLen * Math.cos(ang + Math.PI / 6), y2 - arrowLen * Math.sin(ang + Math.PI / 6));
          ctx.closePath();
          ctx.fill();
        }
      });
      ctx.setLineDash([]);

      points.slice(1).forEach((p, idx) => {
        const px = CENTER + Number(p.x || 0) * DEFAULT_WORLD_SCALE;
        const py = CENTER + Number(p.y || 0) * DEFAULT_WORLD_SCALE;
        ctx.fillStyle = idx === points.length - 2 ? "#ea580c" : "#f59e0b";
        ctx.beginPath();
        ctx.arc(px, py, idx === points.length - 2 ? 9 : 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "12px system-ui, sans-serif";
        const isFinal = idx === points.length - 2;
        const isActiveNext = idx === state.activeLegIndex;
        const label = isFinal
          ? `${p.name || "目標"} / ${fmt(routeDistance(points), 1)}m`
          : `${isActiveNext ? "下一點" : "中繼"}：${p.name || "waypoint"}`;
        const lx = px + 12;
        const ly = py + 18;
        const metrics = ctx.measureText(label);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(lx - 4, ly - 12, metrics.width + 8, 18);
        ctx.fillStyle = idx === points.length - 2 ? "#9a3412" : "#92400e";
        ctx.fillText(label, lx, ly);
      });
    }

    ctx.fillStyle = "#16a34a";
    ctx.beginPath();
    ctx.arc(CENTER + start.x * DEFAULT_WORLD_SCALE, CENTER + start.y * DEFAULT_WORLD_SCALE, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(CENTER + last.x * DEFAULT_WORLD_SCALE, CENTER + last.y * DEFAULT_WORLD_SCALE, 8, 0, Math.PI * 2);
    ctx.fill();
  }


  function setNavTarget() {
    const id = $("navTargetSelect").value;
    state.navTargetId = id;
    state.waypointIds = state.waypointIds.filter(wid => wid !== id);
    const target = state.savedAnchors.find(a => a.id === id);
    state.activeLegIndex = 0;
    state.arrivedTarget = false;
    state.lastArrivalNoticeKey = "";
    resetRouteProgressBaseline();
    if (target) {
      setMessage(`已設 ${target.name} 為導航目標。`);
    } else {
      setMessage("已清除導航目標。");
    }
    render();
    updateGuidanceBanner(Boolean(target));
  }

  function clearNavTarget() {
    state.navTargetId = "";
    state.activeLegIndex = 0;
    state.arrivedTarget = false;
    state.lastArrivalNoticeKey = "";
    setMessage("已清除導航目標。");
    render();
  }



  function getSelectedRoutePoints() {
    if (state.routeMode === "network") {
      return computeNetworkRoute();
    }

    const points = [];
    const current = latestPose();
    points.push({ id: "__current__", name: "目前位置", x: Number(current.x || 0), y: Number(current.y || 0), heading: Number(current.heading || 0) });
    state.waypointIds.forEach((id) => {
      const a = state.savedAnchors.find(x => x.id === id);
      if (a) points.push({ ...a, x: Number(a.x || 0), y: Number(a.y || 0) });
    });
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (target) points.push({ ...target, x: Number(target.x || 0), y: Number(target.y || 0) });
    return points;
  }

  function routeDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = Number(points[i].x || 0) - Number(points[i - 1].x || 0);
      const dy = Number(points[i].y || 0) - Number(points[i - 1].y || 0);
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }

  function renderRouteControls() {
    const targetSel = $("navTargetSelect");
    const wpSel = $("routeWaypointsSelect");
    if (!targetSel || !wpSel) return;

    const currentTarget = state.navTargetId || "";
    targetSel.innerHTML = ['<option value="">請先選擇目標</option>']
      .concat(state.savedAnchors.map(a => `<option value="${a.id}">${a.name} (x:${a.x}, y:${a.y}${a.heading == null ? "" : ", h:" + a.heading})</option>`))
      .join("");
    targetSel.value = currentTarget;

    wpSel.innerHTML = state.savedAnchors.map(a => `<option value="${a.id}">${a.name} (x:${a.x}, y:${a.y}${a.heading == null ? "" : ", h:" + a.heading})</option>`).join("");
    Array.from(wpSel.options).forEach(opt => {
      opt.selected = state.waypointIds.includes(opt.value);
    });

    $("routeModeSelect").value = state.routeMode;
    wpSel.disabled = state.routeMode === "network";
    $("btnApplyRoute").disabled = state.routeMode === "network";
    $("btnClearRoute").disabled = state.routeMode === "network";
  }

  function updateTargetSummary() {
    const summary = $("targetSummary");
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (!target) {
      summary.textContent = "尚未設定導航目標。";
      return;
    }

    const current = latestPose();
    const legs = computeRouteLegs();
    const active = currentActiveLeg();
    if (!active) {
      summary.textContent = "尚未設定可用路徑。";
      return;
    }

    const totalDist = state.routeMode === "multi"
      ? routeDistance(getSelectedRoutePoints())
      : state.routeMode === "network"
      ? routeDistance(getSelectedRoutePoints())
      : distanceBetween(current, target);

    const nextDist = distanceBetween(current, active.to);
    const dx1 = Number(active.to.x || 0) - Number(current.x || 0);
    const dy1 = Number(active.to.y || 0) - Number(current.y || 0);
    const bearing = normalizeAngle((Math.atan2(dx1, -dy1) * 180) / Math.PI);
    const turn = angleDelta(bearing, current.heading || 0);
    const turnText = turn > 15 ? `右轉 ${fmt(turn, 0)}°` : turn < -15 ? `左轉 ${fmt(Math.abs(turn), 0)}°` : "直行";
    const via = state.routeMode === "multi" && state.waypointIds.length ? `，共 ${legs.length} 段，目前第 ${state.activeLegIndex + 1} 段` : state.routeMode === "network" ? `，沿線段自動規劃，共 ${legs.length} 段，目前第 ${state.activeLegIndex + 1} 段` : "";

    if (state.arrivedTarget) {
      summary.textContent = `已到達目標：${target.name}。總路徑約 ${fmt(totalDist, 1)} m。`;
      return;
    }

    summary.textContent = `目標：${target.name}；總距離約 ${fmt(totalDist, 1)} m${via}；下一點 ${active.to.name || "目標"}，距離約 ${fmt(nextDist, 1)} m；建議 ${turnText}。`;
  }

  function setRouteMode() {
    state.routeMode = $("routeModeSelect").value || "direct";
    render();
  }

  function applyWaypointSelection() {
    const sel = $("routeWaypointsSelect");
    state.waypointIds = Array.from(sel.selectedOptions).map(o => o.value).filter(id => id !== state.navTargetId);
    state.activeLegIndex = 0;
    state.arrivedTarget = false;
    state.lastArrivalNoticeKey = "";
    resetRouteProgressBaseline();
    render();
  }

  function clearRouteWaypoints() {
    state.waypointIds = [];
    state.activeLegIndex = 0;
    state.arrivedTarget = false;
    state.lastArrivalNoticeKey = "";
    resetRouteProgressBaseline();
    render();
  }

  function addWaypointFromList(id) {
    if (!id || id === state.navTargetId) return;
    if (!state.waypointIds.includes(id)) state.waypointIds.push(id);
    state.routeMode = "multi";
    state.activeLegIndex = 0;
    state.arrivedTarget = false;
    state.lastArrivalNoticeKey = "";
    resetRouteProgressBaseline();
    switchPage("navPage");
    setMessage("已加入中繼校正點。");
    render();
  }



  function computeRouteLegs() {
    const points = getSelectedRoutePoints();
    if (points.length < 2) return [];
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      legs.push({
        from: points[i - 1],
        to: points[i],
        index: i - 1,
        isFinal: i === points.length - 1
      });
    }
    return legs;
  }

  function currentActiveLeg() {
    const legs = computeRouteLegs();
    if (!legs.length) return null;
    const idx = Math.max(0, Math.min(state.activeLegIndex, legs.length - 1));
    return legs[idx];
  }

  function distanceBetween(a, b) {
    const dx = Number(b.x || 0) - Number(a.x || 0);
    const dy = Number(b.y || 0) - Number(a.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function updateArrivalProgress() {
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (!target) return;

    const current = latestPose();
    const legs = computeRouteLegs();
    if (!legs.length) return;

    const active = currentActiveLeg();
    if (!active) return;

    const dist = distanceBetween(current, active.to);
    const legKey = `${active.index}:${active.to.id || active.to.name || "target"}`;

    if (dist <= state.arrivalThreshold && state.lastArrivalNoticeKey !== legKey) {
      state.lastArrivalNoticeKey = legKey;

      if (active.isFinal) {
        state.arrivedTarget = true;
        setMessage(`已接近最終目標：${active.to.name || "目標"}。`);
        speakText(`已到達目標，${active.to.name || "目標"}`);
        if (state.navSessionState !== "idle") finishNavSession("arrived");
      } else {
        const nextIndex = Math.min(state.activeLegIndex + 1, legs.length - 1);
        const nextLeg = legs[nextIndex];
        state.activeLegIndex = nextIndex;
        setMessage(`已到達中繼點：${active.to.name || "中繼點"}，自動切換下一段：前往 ${nextLeg.to.name || "下一點"}。`);
        speakText(`已到達 ${active.to.name || "中繼點"}，接下來前往 ${nextLeg.to.name || "下一點"}`);
      }
      render();
    }
  }



  function speakText(text) {
    if (!state.voiceGuideEnabled) return;
    if (!("speechSynthesis" in window)) return;
    if (!text || text === state.lastSpokenText) return;
    state.lastSpokenText = text;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-TW";
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      // ignore
    }
  }

  function buildGuidanceText() {
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (!target) {
      return "尚未設定導航目標。";
    }
    if (state.arrivedTarget) {
      return `已到達目標 ${target.name}。`;
    }

    const active = currentActiveLeg();
    if (!active) {
      return "尚未設定可用路徑。";
    }

    const current = latestPose();
    const dx = Number(active.to.x || 0) - Number(current.x || 0);
    const dy = Number(active.to.y || 0) - Number(current.y || 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const bearing = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
    const turn = angleDelta(bearing, current.heading || 0);

    let turnText = "直行";
    if (turn > 45) turnText = `右轉 ${fmt(turn, 0)} 度`;
    else if (turn > 15) turnText = `稍微右轉 ${fmt(turn, 0)} 度`;
    else if (turn < -45) turnText = `左轉 ${fmt(Math.abs(turn), 0)} 度`;
    else if (turn < -15) turnText = `稍微左轉 ${fmt(Math.abs(turn), 0)} 度`;

    const nextName = active.to.name || (active.isFinal ? "目標" : "下一點");
    return `前往 ${nextName}，距離約 ${fmt(dist, 1)} 公尺，建議 ${turnText}。`;
  }

  function updateGuidanceBanner(forceSpeak = false) {
    const text = buildGuidanceText();
    state.currentGuidanceText = text;
    const el = $("guidanceBanner");
    if (el) el.textContent = text;

    if (forceSpeak) {
      speakText(text);
      return;
    }

    const active = currentActiveLeg();
    if (!active || state.arrivedTarget) return;

    const current = latestPose();
    const dx = Number(active.to.x || 0) - Number(current.x || 0);
    const dy = Number(active.to.y || 0) - Number(current.y || 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const bearing = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
    const turn = angleDelta(bearing, current.heading || 0);
    const turnBucket = turn > 45 ? "right-hard" : turn > 15 ? "right-soft" : turn < -45 ? "left-hard" : turn < -15 ? "left-soft" : "straight";
    const distBucket = dist < 3 ? "near" : dist < 8 ? "mid" : "far";
    const cueKey = `${state.activeLegIndex}:${turnBucket}:${distBucket}`;
    if (cueKey !== state.lastTurnCueKey && dist < 8) {
      state.lastTurnCueKey = cueKey;
      speakText(text);
    }
  }



  function getTurnGuidance() {
    const active = currentActiveLeg();
    if (!active) {
      return {
        text: "尚未設定",
        distanceText: "-",
        angleText: "-",
        targetText: "-",
        arrowDeg: 0
      };
    }

    const current = latestPose();
    const dx = Number(active.to.x || 0) - Number(current.x || 0);
    const dy = Number(active.to.y || 0) - Number(current.y || 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const bearing = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
    const turn = angleDelta(bearing, current.heading || 0);

    let text = "直行";
    if (turn > 120) text = "大幅右轉";
    else if (turn > 45) text = "右轉";
    else if (turn > 15) text = "微右轉";
    else if (turn < -120) text = "大幅左轉";
    else if (turn < -45) text = "左轉";
    else if (turn < -15) text = "微左轉";

    return {
      text,
      distanceText: `${fmt(dist, 1)} m`,
      angleText: `${turn >= 0 ? "+" : ""}${fmt(turn, 0)}°`,
      targetText: active.to.name || (active.isFinal ? "目標" : "下一點"),
      arrowDeg: turn
    };
  }

  function renderArrowGuidance() {
    const data = getTurnGuidance();
    const needle = $("arrowNeedle");
    if (needle) {
      const clamped = Math.max(-160, Math.min(160, Number(data.arrowDeg || 0)));
      needle.style.transform = `translate(-50%,-70px) rotate(${clamped}deg)`;
      needle.style.background = data.text.includes("左") ? "#2563eb" : data.text.includes("右") ? "#dc2626" : "#16a34a";
    }
    $("turnArrowText").textContent = data.text;
    $("turnDistanceText").textContent = data.distanceText;
    $("turnAngleText").textContent = data.angleText;
    $("turnTargetText").textContent = data.targetText;
  }



  function getCurrentRouteTotalDistance() {
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (!target) return 0;
    if (state.routeMode === "multi") {
      return routeDistance(getSelectedRoutePoints());
    }
    return distanceBetween(latestPose(), target);
  }

  function getRemainingRouteDistance() {
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    if (!target) return 0;

    if (state.routeMode !== "multi") {
      return distanceBetween(latestPose(), target);
    }

    const active = currentActiveLeg();
    const legs = computeRouteLegs();
    if (!active || !legs.length) return 0;

    let remaining = distanceBetween(latestPose(), active.to);
    for (let i = state.activeLegIndex + 1; i < legs.length; i++) {
      remaining += distanceBetween(legs[i].from, legs[i].to);
    }
    return remaining;
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "-";
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))} 秒`;
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} 分`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs} 小時 ${rem} 分` : `${hrs} 小時`;
  }

  function renderRouteProgress() {
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    const label = $("routeProgressLabel");
    const percent = $("routeProgressPercent");
    const bar = $("routeProgressBar");

    if (!target) {
      label.textContent = "尚未設定目標";
      percent.textContent = "0%";
      bar.style.width = "0%";
      $("routeTraveledText").textContent = "-";
      $("routeRemainingText").textContent = "-";
      $("routeTotalText").textContent = "-";
      $("routeEtaText").textContent = "-";
      return;
    }

    const total = Math.max(state.startedRouteDistance || getCurrentRouteTotalDistance(), 0.01);
    const remaining = Math.max(getRemainingRouteDistance(), 0);
    const traveled = Math.max(total - remaining, 0);
    const p = state.arrivedTarget ? 100 : Math.max(0, Math.min(100, (traveled / total) * 100));
    const legs = computeRouteLegs();
    const etaSeconds = remaining / Math.max(state.averageWalkingSpeed || 1.15, 0.2);

    const sessionPrefix = state.navSessionState === "active" ? "導航中 / " : state.navSessionState === "paused" ? "已暫停 / " : "";
    label.textContent = state.arrivedTarget
      ? `已到達 ${target.name}`
      : state.routeMode === "multi"
      ? `${sessionPrefix}第 ${Math.min(state.activeLegIndex + 1, Math.max(legs.length, 1))} / ${Math.max(legs.length, 1)} 段`
      : state.routeMode === "network"
      ? `${sessionPrefix}路網導航 ${Math.min(state.activeLegIndex + 1, Math.max(legs.length, 1))} / ${Math.max(legs.length, 1)} 段`
      : `${sessionPrefix}單段導航中`;
    percent.textContent = `${Math.round(p)}%`;
    bar.style.width = `${p}%`;

    $("routeTraveledText").textContent = `${traveled.toFixed(1)} m`;
    $("routeRemainingText").textContent = `${remaining.toFixed(1)} m`;
    $("routeTotalText").textContent = `${total.toFixed(1)} m`;
    $("routeEtaText").textContent = state.arrivedTarget ? "已到達" : formatEta(etaSeconds);
  }

  function resetRouteProgressBaseline() {
    const total = getCurrentRouteTotalDistance();
    state.startedRouteDistance = total > 0 ? total : 0;
  }



  function loadNavHistory() {
    try {
      const raw = localStorage.getItem("indoor_nav_history");
      state.navHistory = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.navHistory)) state.navHistory = [];
    } catch (e) {
      state.navHistory = [];
    }
    renderNavHistory();
  }

  function persistNavHistory() {
    localStorage.setItem("indoor_nav_history", JSON.stringify(state.navHistory));
    renderNavHistory();
  }

  function renderNavHistory() {
    const el = $("navHistoryList");
    if (!el) return;
    if (!state.navHistory.length) {
      el.innerHTML = '<div class="item">尚無導航歷史。</div>';
      return;
    }
    el.innerHTML = state.navHistory.map((h) => `
      <div class="item">
        <div class="item-top">
          <strong>${h.targetName || "未命名目標"}</strong>
          <span class="badge">${h.status || "done"}</span>
        </div>
        <div>開始：${h.startedAt ? new Date(h.startedAt).toLocaleString() : "-"}</div>
        <div>結束：${h.endedAt ? new Date(h.endedAt).toLocaleString() : "-"}</div>
        <div>耗時：${h.durationText || "-"}</div>
        <div>總距離：${h.totalDistanceText || "-"}</div>
        <div>路徑模式：${h.routeMode === "multi" ? "多段路徑" : "直接連線"}</div>
      </div>
    `).join("");
  }

  function sessionDurationMs(nowTs = Date.now()) {
    if (!state.navSessionStartedAt) return 0;
    const end = state.navSessionState === "paused" && state.navSessionPausedAt ? state.navSessionPausedAt : nowTs;
    return Math.max(0, end - state.navSessionStartedAt - state.navPauseAccumulatedMs);
  }

  function durationTextFromMs(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec} 秒`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    if (min < 60) return rem ? `${min} 分 ${rem} 秒` : `${min} 分`;
    const hr = Math.floor(min / 60);
    const minRem = min % 60;
    return minRem ? `${hr} 小時 ${minRem} 分` : `${hr} 小時`;
  }

  function startNavSession() {
    if (!state.navTargetId) {
      setMessage("請先設定導航目標再開始導航。");
      return;
    }
    state.navSessionState = "active";
    state.navSessionStartedAt = Date.now();
    state.navSessionPausedAt = null;
    state.navPauseAccumulatedMs = 0;
    state.arrivedTarget = false;
    state.lastArrivalNoticeKey = "";
    state.activeLegIndex = 0;
    resetRouteProgressBaseline();
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    setMessage(`開始導航：${target ? target.name : "目標"}`);
    speakText(`開始導航，前往 ${target ? target.name : "目標"}`);
    render();
  }

  function pauseNavSession() {
    if (state.navSessionState !== "active") return;
    state.navSessionState = "paused";
    state.navSessionPausedAt = Date.now();
    setMessage("導航已暫停。");
    speakText("導航已暫停");
    render();
  }

  function resumeNavSession() {
    if (state.navSessionState !== "paused" || !state.navSessionPausedAt) return;
    state.navPauseAccumulatedMs += Date.now() - state.navSessionPausedAt;
    state.navSessionPausedAt = null;
    state.navSessionState = "active";
    setMessage("導航已繼續。");
    speakText("導航已繼續");
    render();
  }

  function finishNavSession(finalStatus = "completed") {
    if (state.navSessionState === "idle" || !state.navSessionStartedAt) return;
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    const total = Math.max(state.startedRouteDistance || getCurrentRouteTotalDistance(), 0);
    const record = {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      targetId: state.navTargetId,
      targetName: target ? target.name : "未命名目標",
      startedAt: state.navSessionStartedAt,
      endedAt: Date.now(),
      durationMs: sessionDurationMs(Date.now()),
      durationText: durationTextFromMs(sessionDurationMs(Date.now())),
      totalDistance: total,
      totalDistanceText: `${total.toFixed(1)} m`,
      routeMode: state.routeMode,
      waypointCount: state.waypointIds.length,
      status: finalStatus
    };
    state.navHistory.unshift(record);
    persistNavHistory();
    state.navSessionState = "idle";
    state.navSessionStartedAt = null;
    state.navSessionPausedAt = null;
    state.navPauseAccumulatedMs = 0;
    setMessage(finalStatus === "arrived" ? "本次導航完成並已記錄。" : "本次導航已結束並記錄。");
    render();
  }

  function exportNavHistory() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      history: state.navHistory
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `indoor-nav-history-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("已匯出導航歷史。");
  }



  function loadMapElements() {
    try {
      const raw = localStorage.getItem("indoor_map_elements");
      state.mapElements = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.mapElements)) state.mapElements = [];
    } catch (e) {
      state.mapElements = [];
    }
    renderMapElements();
  }

  function persistMapElements() {
    localStorage.setItem("indoor_map_elements", JSON.stringify(state.mapElements));
    renderMapElements();
    drawEditorCanvas();
  }

  function setEditorMessage(text) {
    state.editorMessage = text;
    const el = $("editorMessageBox");
    if (el) el.textContent = text;
  }

  function setEditorMode(mode) {
    state.editorMode = mode;
    state.editorDraftPoints = [];
    const modeText = mode === "point" ? "point" : mode === "line" ? "line" : mode === "area" ? "area" : "idle";
    setEditorMessage(
      mode === "point" ? "點位模式：點一下畫布建立點位。" :
      mode === "line" ? "線段模式：依序點兩個位置建立線段。" :
      mode === "area" ? "區域模式：依序點四個角點建立矩形/多邊形區域。" :
      "瀏覽模式：查看目前地圖元素。"
    );
    render();
  }

  function editorCanvasToWorld(evt) {
    const wrap = $("editorCanvasWrap");
    const canvas = $("editorCanvas");
    const rect = canvas.getBoundingClientRect();
    const local = {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
    return viewportScreenToWorld(local, state.editorViewport, wrap);
  }

  function currentEditorName() {
    return $("editorNameInput")?.value?.trim() || "未命名";
  }

  function addMapElement(el) {
    state.mapElements.unshift(el);
    persistMapElements();
  }

  function handleEditorCanvasClick(evt) {
    const world = editorCanvasToWorld(evt);
    const name = currentEditorName();
    const now = new Date().toISOString();

    if (state.editorMode === "idle") {
      const hitId = hitTestMapElement(world.x, world.y);
      if (hitId) {
        selectMapElement(hitId);
      } else {
        state.selectedMapElementId = "";
        render();
      }
      return;
    }

    if (state.editorMode === "point") {
      addMapElement({
        id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        type: "point",
        name,
        x: Number(world.x.toFixed(2)),
        y: Number(world.y.toFixed(2)),
        semantic: currentEditorSemantic(),
        createdAt: now
      });
      if (state.anchorCreationMode) {
        const heading = Math.round(normalizeAngle(state.orientation.heading || latestPose().heading || 0));
        const anchor = {
          id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + 1),
          name,
          x: Number(world.x.toFixed(2)),
          y: Number(world.y.toFixed(2)),
          heading,
          source: "map-point",
          payload: `INDOOR_ANCHOR:${Number(world.x.toFixed(2))},${Number(world.y.toFixed(2))},${heading}`,
          createdAt: now
        };
        state.savedAnchors.unshift(anchor);
        persistSavedAnchors();
        state.anchorCreationMode = false;
        setEditorMessage(`已在地圖上新增標定點：${name}`);
      } else {
        setEditorMessage(`已新增點位：${name} (${world.x.toFixed(1)}, ${world.y.toFixed(1)})`);
      }
      render();
      return;
    }

    if (state.editorMode === "line") {
      const snapped = snapPointToNearbyEndpoint(world);
      state.editorDraftPoints.push({ x: snapped.x, y: snapped.y });
      if (state.editorDraftPoints.length < 2) {
        setEditorMessage("線段模式：已記錄第 1 個點，請再點第 2 個點。");
        drawEditorCanvas();
        return;
      }
      const [a, b] = state.editorDraftPoints;
      addMapElement({
        id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        type: "line",
        name,
        points: [
          { x: Number(a.x.toFixed(2)), y: Number(a.y.toFixed(2)) },
          { x: Number(b.x.toFixed(2)), y: Number(b.y.toFixed(2)) }
        ],
        semantic: currentEditorSemantic(),
        createdAt: now
      });
      state.editorDraftPoints = [];
      normalizeLineNetwork();
      setEditorMessage(`已新增線段：${name}`);
      render();
      return;
    }

    if (state.editorMode === "area") {
      state.editorDraftPoints.push(world);
      if (state.editorDraftPoints.length < 4) {
        setEditorMessage(`區域模式：已記錄 ${state.editorDraftPoints.length} / 4 個點。`);
        drawEditorCanvas();
        return;
      }
      addMapElement({
        id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
        type: "area",
        name,
        points: state.editorDraftPoints.map(p => ({
          x: Number(p.x.toFixed(2)),
          y: Number(p.y.toFixed(2))
        })),
        semantic: currentEditorSemantic(),
        createdAt: now
      });
      state.editorDraftPoints = [];
      setEditorMessage(`已新增區域：${name}`);
      render();
    }
  }

  function drawEditorCanvas() {
    const canvas = $("editorCanvas");
    const wrapEl = $("editorCanvasWrap");
    if (!canvas || !wrapEl) return;
    ensureCanvasSize(canvas, wrapEl);
    updateFilteredPose();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, wrapEl, state.editorViewport);
    drawCrosshair(ctx, wrapEl, state.editorViewport);
    ctx.font = "12px system-ui, sans-serif";

    drawMapElementsOnCanvas(ctx, true, state.editorViewport, wrapEl);

    if (state.trail.length) {
      const displayTrail = getDisplayTrail();
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = lineWidthForWorld(3, state.editorViewport);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      displayTrail.forEach((p, i) => {
        const pt = viewportWorldToScreen({ x: Number(p.x || 0), y: Number(p.y || 0) }, state.editorViewport, wrapEl);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      const start = state.trail[0];
      const last = latestPose();

      const startPt = viewportWorldToScreen({ x: Number(start.x || 0), y: Number(start.y || 0) }, state.editorViewport, wrapEl);
      ctx.fillStyle = "#16a34a";
      ctx.beginPath();
      ctx.arc(startPt.x, startPt.y, fixedRadius(8), 0, Math.PI * 2);
      ctx.fill();
      labelBox(ctx, startPt.x + 10, startPt.y - 10, "起點", "#166534");

      const lastPt = viewportWorldToScreen({ x: Number(last.x || 0), y: Number(last.y || 0) }, state.editorViewport, wrapEl);
      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(lastPt.x, lastPt.y, fixedRadius(8), 0, Math.PI * 2);
      ctx.fill();
      labelBox(ctx, lastPt.x + 10, lastPt.y - 10, "目前位置", "#991b1b");
    }

    drawScaleRuler(ctx, wrapEl, state.editorViewport, "bottom-left");
    drawStartToCurrentDistanceBadge(ctx, wrapEl, state.editorViewport, "起點→目前位置");

    if (state.savedAnchors.length) {
      state.savedAnchors.forEach((a) => {
        const pt = viewportWorldToScreen({ x: Number(a.x || 0), y: Number(a.y || 0) }, state.editorViewport, wrapEl);
        ctx.fillStyle = "#2563eb";
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, fixedRadius(5), 0, Math.PI * 2);
        ctx.fill();
        labelBox(ctx, pt.x + 8, pt.y - 8, a.name || "anchor", "#1e3a8a");
      });
    }

    if (state.editorDraftPoints.length) {
      ctx.strokeStyle = "#ef4444";
      ctx.fillStyle = "#ef4444";
      ctx.lineWidth = lineWidthForWorld(2, state.editorViewport);
      ctx.beginPath();
      state.editorDraftPoints.forEach((p, i) => {
        const pt = viewportWorldToScreen({ x: Number(p.x || 0), y: Number(p.y || 0) }, state.editorViewport, wrapEl);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, fixedRadius(5), 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  function renderMapElements() {

    const el = $("mapElementList");
    if (!el) return;
    if (!state.mapElements.length) {
      el.innerHTML = '<div class="item">尚未建立任何地圖元素。</div>';
      return;
    }
    el.innerHTML = state.mapElements.map((m) => `
      <div class="item">
        <div class="item-top">
          <strong>${m.name || "未命名"}</strong>
          <span style="display:flex; gap:6px; align-items:center;"><span class="badge">${m.type}</span><span class="badge">${m.semantic || "walkable"}</span>${m.source === "anchor" ? '<span class="badge">anchor</span>' : ""}</span>
        </div>
        ${
          m.type === "point"
            ? `<div>x: ${m.x} / y: ${m.y}</div>`
            : `<div>points: ${(m.points || []).map(p => `(${p.x}, ${p.y})`).join(" -> ")}</div>`
        }
        <div class="btns" style="margin-top:10px; margin-bottom:0;">
          <button data-map-select="${m.id}">選取</button>
          <button data-map-load="${m.id}">載入名稱</button>
          <button data-map-anchor="${m.id}" class="secondary">轉 Anchor</button>
          <button data-map-del="${m.id}" class="danger">刪除</button>
        </div>
      </div>
    `).join("");

    el.querySelectorAll("[data-map-select]").forEach(btn => {
      btn.addEventListener("click", () => selectMapElement(btn.getAttribute("data-map-select")));
    });

    el.querySelectorAll("[data-map-load]").forEach(btn => {
      btn.addEventListener("click", () => {
        const m = state.mapElements.find(x => x.id === btn.getAttribute("data-map-load"));
        if (!m) return;
        $("editorNameInput").value = m.name || "";
        render();
      });
    });

    el.querySelectorAll("[data-map-del]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-map-del");
        state.mapElements = state.mapElements.filter(x => x.id !== id);
        persistMapElements();
      });
    });
    el.querySelectorAll("[data-map-anchor]").forEach(btn => {
      btn.addEventListener("click", () => convertMapElementToAnchorById(btn.getAttribute("data-map-anchor")));
    });
  }

  function undoMapElement() {
    if (state.editorDraftPoints.length) {
      state.editorDraftPoints.pop();
      drawEditorCanvas();
      return;
    }
    state.mapElements.shift();
    persistMapElements();
  }

  function exportMapData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      mapElements: state.mapElements
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `indoor-map-data-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setEditorMessage("已匯出地圖 JSON。");
  }

  async function importMapData(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const elements = Array.isArray(data) ? data : data.mapElements;
      if (!Array.isArray(elements)) throw new Error("JSON 裡找不到 mapElements 陣列");
      state.mapElements = elements;
      persistMapElements();
      setEditorMessage(`已匯入 ${elements.length} 個地圖元素。`);
    } catch (e) {
      alert("匯入失敗：" + e.message);
    }
  }



  function selectedMapElement() {
    return state.mapElements.find(x => x.id === state.selectedMapElementId) || null;
  }

  function selectMapElement(id) {
    state.selectedMapElementId = id || "";
    const el = selectedMapElement();
    if ($("selectedMapElementType")) $("selectedMapElementType").textContent = el ? el.type : "none";
    if ($("selectedMapElementName")) $("selectedMapElementName").value = el ? (el.name || "") : "";
    if ($("selectedMapElementSemantic")) $("selectedMapElementSemantic").value = el ? (el.semantic || "walkable") : "walkable";
    if (el) {
      setEditorMessage(`已選取元素：${el.name || "未命名"} (${el.type})`);
    }
    render();
  }

  function updateSelectedMapElementName() {
    const el = selectedMapElement();
    if (!el) {
      alert("請先選一個地圖元素");
      return;
    }
    const name = $("selectedMapElementName").value.trim() || "未命名";
    const semantic = $("selectedMapElementSemantic").value || "walkable";
    el.name = name;
    el.semantic = semantic;
    persistMapElements();
    setEditorMessage(`已更新元素名稱：${name}`);
    render();
  }

  function deleteSelectedMapElement() {
    const el = selectedMapElement();
    if (!el) {
      alert("請先選一個地圖元素");
      return;
    }
    if (!confirm(`確定要刪除「${el.name || "未命名"}」嗎？`)) return;
    state.mapElements = state.mapElements.filter(x => x.id !== el.id);
    state.selectedMapElementId = "";
    persistMapElements();
    setEditorMessage("已刪除所選地圖元素。");
    render();
  }

  function hitTestMapElement(worldX, worldY) {
    const threshold = 1.2;
    for (const el of state.mapElements) {
      const isSelected = el.id === state.selectedMapElementId;
      if (el.type === "point") {
        const dx = Number(el.x || 0) - worldX;
        const dy = Number(el.y || 0) - worldY;
        if (Math.sqrt(dx * dx + dy * dy) <= threshold) return el.id;
      } else if (el.type === "line" && Array.isArray(el.points) && el.points.length >= 2) {
        const [a, b] = el.points;
        const ax = Number(a.x || 0), ay = Number(a.y || 0), bx = Number(b.x || 0), by = Number(b.y || 0);
        const abx = bx - ax, aby = by - ay;
        const apx = worldX - ax, apy = worldY - ay;
        const ab2 = abx * abx + aby * aby || 1;
        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
        const cx = ax + t * abx, cy = ay + t * aby;
        const dx = cx - worldX, dy = cy - worldY;
        if (Math.sqrt(dx * dx + dy * dy) <= threshold) return el.id;
      } else if (el.type === "area" && Array.isArray(el.points) && el.points.length >= 3) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        el.points.forEach((p) => {
          minX = Math.min(minX, Number(p.x || 0));
          minY = Math.min(minY, Number(p.y || 0));
          maxX = Math.max(maxX, Number(p.x || 0));
          maxY = Math.max(maxY, Number(p.y || 0));
        });
        if (worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY) return el.id;
      }
    }
    return "";
  }



  function pointElementToAnchor(pointEl) {
    if (!pointEl || pointEl.type !== "point") return null;
    return {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      name: pointEl.name || "未命名校正點",
      x: Number(pointEl.x ?? 0),
      y: Number(pointEl.y ?? 0),
      heading: null,
      payload: `INDOOR_ANCHOR:${Number(pointEl.x ?? 0)},${Number(pointEl.y ?? 0)}`,
      createdAt: new Date().toISOString()
    };
  }

  function saveAnchorObject(anchor) {
    if (!anchor) return false;
    const exists = state.savedAnchors.findIndex(a => a.name === anchor.name);
    if (exists >= 0) {
      state.savedAnchors[exists] = anchor;
    } else {
      state.savedAnchors.unshift(anchor);
    }
    persistSavedAnchors();
    return true;
  }

  function convertSelectedMapElementToAnchor() {
    const el = selectedMapElement();
    if (!el) {
      alert("請先選一個地圖元素");
      return;
    }
    if (el.type !== "point") {
      alert("目前只有點位元素可以直接轉成 Anchor。");
      return;
    }
    const anchor = pointElementToAnchor(el);
    if (saveAnchorObject(anchor)) {
      setEditorMessage(`已將點位「${el.name || "未命名"}」轉成 Anchor。`);
      setMessage(`已新增 Anchor：${anchor.name}`);
      render();
    }
  }

  function convertMapElementToAnchorById(id) {
    const el = state.mapElements.find(x => x.id === id);
    if (!el) return;
    if (el.type !== "point") {
      alert("目前只有點位元素可以直接轉成 Anchor。");
      return;
    }
    const anchor = pointElementToAnchor(el);
    if (saveAnchorObject(anchor)) {
      setEditorMessage(`已將點位「${el.name || "未命名"}」轉成 Anchor。`);
      setMessage(`已新增 Anchor：${anchor.name}`);
      render();
    }
  }



  function anchorToPointMapElement(anchor) {
    if (!anchor) return null;
    return {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      type: "point",
      name: anchor.name || "未命名校正點",
      x: Number(anchor.x ?? 0),
      y: Number(anchor.y ?? 0),
      source: "anchor",
      anchorId: anchor.id || "",
      createdAt: new Date().toISOString()
    };
  }

  function syncAnchorToMapById(anchorId) {
    const anchor = state.savedAnchors.find(a => a.id === anchorId);
    if (!anchor) return;

    const existing = state.mapElements.find(
      (m) => m.type === "point" && (m.anchorId === anchor.id || (m.source === "anchor" && m.name === anchor.name))
    );

    if (existing) {
      existing.name = anchor.name || existing.name;
      existing.x = Number(anchor.x ?? existing.x ?? 0);
      existing.y = Number(anchor.y ?? existing.y ?? 0);
      existing.source = "anchor";
      existing.anchorId = anchor.id || existing.anchorId || "";
    } else {
      const point = anchorToPointMapElement(anchor);
      if (point) state.mapElements.unshift(point);
    }

    persistMapElements();
    setMessage(`已將 Anchor「${anchor.name || "未命名"}」同步到地圖。`);
    render();
  }

  function syncAllAnchorsToMap() {
    if (!state.savedAnchors.length) {
      alert("目前沒有可同步的 Anchor。");
      return;
    }
    state.savedAnchors.forEach((a) => {
      const existing = state.mapElements.find(
        (m) => m.type === "point" && (m.anchorId === a.id || (m.source === "anchor" && m.name === a.name))
      );
      if (existing) {
        existing.name = a.name || existing.name;
        existing.x = Number(a.x ?? existing.x ?? 0);
        existing.y = Number(a.y ?? existing.y ?? 0);
        existing.source = "anchor";
        existing.anchorId = a.id || existing.anchorId || "";
      } else {
        const point = anchorToPointMapElement(a);
        if (point) state.mapElements.unshift(point);
      }
    });
    persistMapElements();
    setMessage(`已同步 ${state.savedAnchors.length} 個 Anchor 到地圖。`);
    render();
  }



  function networkLineElements() {
    return state.mapElements.filter((m) => m.type === "line" && Array.isArray(m.points) && m.points.length >= 2 && (m.semantic || "walkable") !== "wall" && (m.semantic || "walkable") !== "restricted");
  }

  function pointKey(p) {
    return `${Number(p.x).toFixed(2)},${Number(p.y).toFixed(2)}`;
  }

  function nearestGraphNode(target, nodes) {
    if (!nodes.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const n of nodes) {
      const d = distanceBetween(target, n);
      if (d < bestDist) {
        bestDist = d
        best = n
      }
    }
    return best;
  }

  function buildLineGraph() {
    const nodesMap = new Map();
    const edges = new Map();

    const ensureNode = (p) => {
      let existing = null;
      for (const node of nodesMap.values()) {
        if (distanceBetween(node, p) <= state.snapThreshold) {
          existing = node;
          break;
        }
      }
      if (existing) {
        if (!edges.has(existing.key)) edges.set(existing.key, []);
        return existing;
      }

      const key = pointKey(p);
      if (!nodesMap.has(key)) {
        nodesMap.set(key, { x: Number(p.x), y: Number(p.y), key });
      }
      if (!edges.has(key)) edges.set(key, []);
      return nodesMap.get(key);
    };

    networkLineElements().forEach((line) => {
      for (let i = 1; i < line.points.length; i++) {
        const a = ensureNode(line.points[i - 1]);
        const b = ensureNode(line.points[i]);
        const w = distanceBetween(a, b);
        if (!segmentBlockedByWalls(a, b) && !pointInsideRestrictedArea(a) && !pointInsideRestrictedArea(b)) {
          edges.get(a.key).push({ to: b.key, weight: w });
          edges.get(b.key).push({ to: a.key, weight: w });
        }
      }
    });

    return { nodes: Array.from(nodesMap.values()), edges, nodesMap };
  }

  function shortestPathOnGraph(start, goal, graph) {
    if (!start || !goal) return [];
    const dist = new Map();
    const prev = new Map();
    const unvisited = new Set(graph.nodes.map((n) => n.key));

    graph.nodes.forEach((n) => dist.set(n.key, Infinity));
    dist.set(start.key, 0);

    while (unvisited.size) {
      let currentKey = null;
      let currentDist = Infinity;
      for (const key of unvisited) {
        const d = dist.get(key);
        if (d < currentDist) {
          currentDist = d;
          currentKey = key;
        }
      }
      if (!currentKey || currentDist === Infinity) break;
      if (currentKey === goal.key) break;

      unvisited.delete(currentKey);
      for (const edge of graph.edges.get(currentKey) || []) {
        if (!unvisited.has(edge.to)) continue;
        const alt = currentDist + edge.weight;
        if (alt < (dist.get(edge.to) || Infinity)) {
          dist.set(edge.to, alt);
          prev.set(edge.to, currentKey);
        }
      }
    }

    const path = [];
    let cursor = goal.key;
    while (cursor) {
      const node = graph.nodesMap.get(cursor);
      if (node) path.unshift({ x: node.x, y: node.y, key: node.key });
      cursor = prev.get(cursor);
      if (cursor === start.key) {
        const s = graph.nodesMap.get(start.key);
        if (s) path.unshift({ x: s.x, y: s.y, key: s.key });
        break;
      }
    }

    if (!path.length) return [];
    if (path[0].key !== start.key) {
      const s = graph.nodesMap.get(start.key);
      if (s) path.unshift({ x: s.x, y: s.y, key: s.key });
    }
    return path;
  }

  function routeDistanceFromPoints(points) {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += distanceBetween(points[i - 1], points[i]);
    }
    return total;
  }

  function computeNetworkRoute() {
    const target = state.savedAnchors.find(a => a.id === state.navTargetId);
    const current = latestPose();
    if (!target) {
      state.plannedRoutePoints = [];
      return [];
    }

    const graph = buildLineGraph();
    if (!graph.nodes.length) {
      state.plannedRoutePoints = [
        { x: Number(current.x || 0), y: Number(current.y || 0), name: "目前位置" },
        { x: Number(target.x || 0), y: Number(target.y || 0), name: target.name || "目標" }
      ];
      return state.plannedRoutePoints;
    }

    const startNode = nearestGraphNode({ x: Number(current.x || 0), y: Number(current.y || 0) }, graph.nodes);
    const goalNode = nearestGraphNode({ x: Number(target.x || 0), y: Number(target.y || 0) }, graph.nodes);
    const path = shortestPathOnGraph(startNode, goalNode, graph);

    const route = [];
    route.push({ x: Number(current.x || 0), y: Number(current.y || 0), name: "目前位置" });

    if (startNode && distanceBetween(current, startNode) > 0.1) {
      route.push({ x: startNode.x, y: startNode.y, name: "起始線段點" });
    }

    path.forEach((p, idx) => {
      if (idx === 0 && startNode && p.key === startNode.key) return;
      if (goalNode && idx === path.length - 1 && p.key === goalNode.key) {
        route.push({ x: p.x, y: p.y, name: "目標線段點" });
      } else {
        route.push({ x: p.x, y: p.y, name: `路網點 ${idx + 1}` });
      }
    });

    if (!goalNode || distanceBetween(target, goalNode) > 0.1) {
      route.push({ x: Number(target.x || 0), y: Number(target.y || 0), name: target.name || "目標" });
    } else {
      route.push({ x: Number(target.x || 0), y: Number(target.y || 0), name: target.name || "目標" });
    }

    // dedupe adjacent identical
    const deduped = [];
    for (const p of route) {
      const prev = deduped[deduped.length - 1];
      if (!prev || distanceBetween(prev, p) > 0.05) deduped.push(p);
    }

    state.plannedRoutePoints = deduped;
    return deduped;
  }



  function getAllLineEndpoints() {
    const pts = [];
    state.mapElements.forEach((el) => {
      if (el.type === "line" && Array.isArray(el.points)) {
        el.points.forEach((p) => pts.push({ x: Number(p.x || 0), y: Number(p.y || 0) }));
      }
    });
    return pts;
  }

  function snapPointToNearbyEndpoint(p) {
    if (!state.snapEnabled) return { x: p.x, y: p.y, snapped: false };
    let best = null;
    let bestDist = Infinity;
    getAllLineEndpoints().forEach((ep) => {
      const dx = ep.x - p.x;
      const dy = ep.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        best = ep;
      }
    });
    if (best && bestDist <= state.snapThreshold) {
      return { x: best.x, y: best.y, snapped: true };
    }
    return { x: p.x, y: p.y, snapped: false };
  }

  function segmentIntersection(a, b, c, d) {
    const denom = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    if (Math.abs(denom) < 1e-9) return null;
    const px = ((a.x * b.y - a.y * b.x) * (c.x - d.x) - (a.x - b.x) * (c.x * d.y - c.y * d.x)) / denom;
    const py = ((a.x * b.y - a.y * b.x) * (c.y - d.y) - (a.y - b.y) * (c.x * d.y - c.y * d.x)) / denom;

    function within(p1, p2, q) {
      return q >= Math.min(p1, p2) - 1e-6 && q <= Math.max(p1, p2) + 1e-6;
    }

    if (
      within(a.x, b.x, px) && within(a.y, b.y, py) &&
      within(c.x, d.x, px) && within(c.y, d.y, py)
    ) {
      return { x: Number(px.toFixed(2)), y: Number(py.toFixed(2)) };
    }
    return null;
  }

  function splitLineByIntersections(line, intersections) {
    if (!intersections.length) return [line];
    const pts = [
      { x: Number(line.points[0].x), y: Number(line.points[0].y) },
      ...intersections,
      { x: Number(line.points[1].x), y: Number(line.points[1].y) }
    ];

    const a = pts[0];
    pts.sort((p1, p2) => {
      const d1 = (p1.x - a.x) ** 2 + (p1.y - a.y) ** 2;
      const d2 = (p2.x - a.x) ** 2 + (p2.y - a.y) ** 2;
      return d1 - d2;
    });

    const dedup = [];
    pts.forEach((p) => {
      const prev = dedup[dedup.length - 1];
      if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 0.05) dedup.push(p);
    });

    const pieces = [];
    for (let i = 1; i < dedup.length; i++) {
      pieces.push({
        id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + i),
        type: "line",
        name: line.name,
        points: [
          { x: Number(dedup[i - 1].x.toFixed(2)), y: Number(dedup[i - 1].y.toFixed(2)) },
          { x: Number(dedup[i].x.toFixed(2)), y: Number(dedup[i].y.toFixed(2)) }
        ],
        createdAt: line.createdAt,
        source: line.source,
        anchorId: line.anchorId
      });
    }
    return pieces;
  }

  function normalizeLineNetwork() {
    if (!state.autoIntersectEnabled) return;
    const lines = state.mapElements.filter((m) => m.type === "line" && Array.isArray(m.points) && m.points.length >= 2);
    if (lines.length < 2) return;

    const lineIntersections = new Map();
    lines.forEach((l) => lineIntersections.set(l.id, []));

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a1 = { x: Number(lines[i].points[0].x), y: Number(lines[i].points[0].y) };
        const a2 = { x: Number(lines[i].points[1].x), y: Number(lines[i].points[1].y) };
        const b1 = { x: Number(lines[j].points[0].x), y: Number(lines[j].points[0].y) };
        const b2 = { x: Number(lines[j].points[1].x), y: Number(lines[j].points[1].y) };
        const hit = segmentIntersection(a1, a2, b1, b2);
        if (hit) {
          const isEndpointHit =
            (Math.hypot(hit.x - a1.x, hit.y - a1.y) < 0.05) ||
            (Math.hypot(hit.x - a2.x, hit.y - a2.y) < 0.05) ||
            (Math.hypot(hit.x - b1.x, hit.y - b1.y) < 0.05) ||
            (Math.hypot(hit.x - b2.x, hit.y - b2.y) < 0.05);
          if (!isEndpointHit) {
            lineIntersections.get(lines[i].id).push(hit);
            lineIntersections.get(lines[j].id).push(hit);
          }
        }
      }
    }

    let changed = false
    const nextElements = [];
    state.mapElements.forEach((el) => {
      if (el.type !== "line" || !lineIntersections.has(el.id)) {
        nextElements.push(el);
        return;
      }
      const hits = lineIntersections.get(el.id);
      if (!hits.length) {
        nextElements.push(el);
        return;
      }
      changed = true
      splitLineByIntersections(el, hits).forEach((piece) => nextElements.push(piece));
    });

    if (changed) {
      state.mapElements = nextElements;
      persistMapElements();
      setEditorMessage("已完成路網修正：交點已節點化。");
    }
  }



  function currentEditorSemantic() {
    return $("editorElementSemantic")?.value || "walkable";
  }

  function ccw(A, B, C) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }

  function segmentsCross(a, b, c, d) {
    // Exclude shared endpoints / near-touch as blocking crossings
    const shared =
      distanceBetween(a, c) < 0.05 || distanceBetween(a, d) < 0.05 ||
      distanceBetween(b, c) < 0.05 || distanceBetween(b, d) < 0.05;
    if (shared) return false;
    return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  }

  function segmentBlockedByWalls(a, b) {
    const walls = state.mapElements.filter(m => m.semantic === "wall" && m.type === "line" && Array.isArray(m.points) && m.points.length >= 2);
    return walls.some((w) => {
      const p1 = { x: Number(w.points[0].x || 0), y: Number(w.points[0].y || 0) };
      const p2 = { x: Number(w.points[1].x || 0), y: Number(w.points[1].y || 0) };
      return segmentsCross(a, b, p1, p2);
    });
  }

  function pointInsideRestrictedArea(p) {
    const areas = state.mapElements.filter(m => m.semantic === "restricted" && m.type === "area" && Array.isArray(m.points) && m.points.length >= 3);
    return areas.some((area) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      area.points.forEach(pt => {
        minX = Math.min(minX, Number(pt.x || 0));
        minY = Math.min(minY, Number(pt.y || 0));
        maxX = Math.max(maxX, Number(pt.x || 0));
        maxY = Math.max(maxY, Number(pt.y || 0));
      });
      return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    });
  }


  function render() {
    $("messageBox").textContent = state.message;
    $("guidanceBanner").textContent = state.currentGuidanceText;
    $("toggleVoiceGuide").checked = state.voiceGuideEnabled;
    $("btnNavSessionStart").disabled = !state.navTargetId || state.navSessionState === "active";
    $("btnNavSessionPause").disabled = state.navSessionState !== "active";
    $("btnNavSessionResume").disabled = state.navSessionState !== "paused";
    $("btnNavSessionEnd").disabled = state.navSessionState === "idle";
    const editorModeBadge = $("editorModeBadge");
    if (editorModeBadge) editorModeBadge.textContent = state.editorMode;
    const editorDraftInfo = $("editorDraftInfo");
    if (editorDraftInfo) editorDraftInfo.textContent = $("editorNameInput") ? ($("editorNameInput").value.trim() || "未命名") : "未命名";
    if ($("toggleSnapMode")) $("toggleSnapMode").checked = state.snapEnabled;
    if ($("editorElementSemantic")) $("editorElementSemantic").value = $("editorElementSemantic").value || "walkable";
    if ($("toggleAutoIntersect")) $("toggleAutoIntersect").checked = state.autoIntersectEnabled;
    const editorMessageBox = $("editorMessageBox");
    if (editorMessageBox) editorMessageBox.textContent = state.editorMessage;
    const selectedEl = selectedMapElement();
    if ($("selectedMapElementType")) $("selectedMapElementType").textContent = selectedEl ? selectedEl.type : "none";
    $("permissionBadge").textContent = state.permissionState;
    $("gpsBadge").textContent = gpsBadgeText();
    $("trackBadge").textContent = state.tracking ? "tracking" : "idle";

    const pose = latestPose();
    $("poseValue").textContent = `x ${fmt(pose.x)} m / y ${fmt(pose.y)} m`;
    $("headingValue").textContent = `${fmt(pose.heading, 1)}°`;
    $("gpsAccValue").textContent = state.geoReading ? `${fmt(state.geoReading.accuracy, 1)} m` : "-";
    $("stepCountValue").textContent = String(state.stepCount);
    $("accValue").textContent = `${fmt(state.motion.ax)}, ${fmt(state.motion.ay)}, ${fmt(state.motion.az)}`;
    $("motionValue").textContent = `raw ${fmt(state.motionMagnitude)} / smooth ${fmt(state.smoothedMagnitude)}`;
    $("lastStepValue").textContent = state.lastStepAt ? new Date(state.lastStepAt).toLocaleTimeString() : "-";
    $("geoValue").textContent = state.geoReading ? `${fmt(state.geoReading.lat, 6)}, ${fmt(state.geoReading.lng, 6)}` : "-";
    $("stepLengthValue").textContent = `${fmt(state.stepLength, 2)} m`;
    $("toggleAnchorOverlay").checked = state.showAnchorOverlay;
    $("toggleMapOverlay").checked = state.showMapOverlay;
    $("arrivalThresholdInput").value = String(state.arrivalThreshold);
    renderRouteControls();
    updateTargetSummary();


    $("btnStop").disabled = !state.tracking;
    $("btnStart").disabled = state.tracking;
    $("btnPosCorrection").disabled = state.positionSampleMode || !state.geoReading;
    $("btnHeadingCorrection").disabled = state.headingSampleMode;

    $("btnPosCorrection").textContent = state.positionSampleMode ? "位置收樣中..." : "按鈕 1：位置校正";
    $("btnHeadingCorrection").textContent = state.headingSampleMode ? "方向收樣中..." : "按鈕 2：方向校正";

    updateGuidanceBanner(false);
    renderArrowGuidance();
    renderRouteProgress();
    renderCorrections();
    updateAnchorCorrectionSelect();
    updateAutoStepStatus();
    ensureNavViewportVisible(false);
    drawTrack();
    drawEditorCanvas();
    renderMapElements();
    refreshViewportUI();
  }

  async function requestPermissions() {
    try {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        await DeviceMotionEvent.requestPermission();
      }
      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        await DeviceOrientationEvent.requestPermission();
      }
      if (!navigator.geolocation) throw new Error("此瀏覽器不支援 Geolocation。");

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            ts: Date.now()
          };
          state.geoReading = next;
          if (!state.anchor) state.anchor = { lat: next.lat, lng: next.lng };
          updateAutoStepCalibration(next);
          state.permissionState = "granted";
          setMessage("授權完成，可以開始追蹤。建議先在入口或窗邊設定起點。");
        },
        (err) => {
          state.permissionState = "denied";
          setMessage(`定位授權失敗：${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } catch (err) {
      state.permissionState = "denied";
      setMessage(`感測器授權失敗：${err.message}`);
    }
  }

  function handleOrientation(event) {
    const webkitHeading = event.webkitCompassHeading;
    const alphaHeading = typeof event.alpha === "number" ? 360 - event.alpha : 0;
    const heading = normalizeAngle(typeof webkitHeading === "number" ? webkitHeading : alphaHeading);
    state.orientation = { heading, supported: true };
    state.currentPose.heading = heading;
    render();
  }

  function maybeFinishStepCalibration() {
    if (!state.calibratingStepLength) return;
    const walked = state.stepCount - state.stepCalStart;
    if (walked >= 10) {
      const meters = Number(prompt("請輸入你剛剛 10 步實際走了幾公尺（例如 7.2）", "7.2"));
      if (Number.isFinite(meters) && meters > 0) {
        state.stepLength = meters / 10;
        $("stepLength").value = String(Math.min(1.0, Math.max(0.4, state.stepLength)));
        setMessage(`步長校正完成：新步長 ${fmt(state.stepLength, 2)} m/步。`);
      } else {
        setMessage("步長校正取消：輸入不是有效距離。");
      }
      state.calibratingStepLength = false;
      render();
    }
  }

  function handleMotion(event) {
    const acc = event.accelerationIncludingGravity || event.acceleration;
    const ax = acc?.x ?? 0;
    const ay = acc?.y ?? 0;
    const az = acc?.z ?? 0;
    const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
    const nextSmoothed = smoothedMagnitudeRef * (1 - STEP_SMOOTHING) + magnitude * STEP_SMOOTHING;
    const delta = magnitude - nextSmoothed;

    smoothedMagnitudeRef = nextSmoothed;
    state.motion = { ax, ay, az, supported: true };
    state.motionMagnitude = magnitude;
    state.smoothedMagnitude = nextSmoothed;

    if (!state.tracking) {
      render();
      return;
    }

    const now = Date.now();
    if (delta > STEP_THRESHOLD && now - lastStepAtRef > STEP_DEBOUNCE_MS) {
      lastStepAtRef = now;
      state.lastStepAt = now;
      state.stepCount += 1;
      const last = latestPose();
      const heading = state.orientation.heading;
      const rad = (heading * Math.PI) / 180;
      const next = {
        x: last.x + Math.sin(rad) * state.stepLength,
        y: last.y - Math.cos(rad) * state.stepLength,
        heading,
        t: now
      };
      state.currentPose = next;
      state.trail.push(next);
      maybeFinishStepCalibration();
      updateArrivalProgress();
    }
    render();
  }

  function startTracking() {
    if (state.permissionState !== "granted") {
      setMessage("請先授權。iPhone 通常需要按鈕觸發權限。");
      return;
    }
    state.tracking = true;
    if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        state.geoReading = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          ts: Date.now()
        };
        updateAutoStepCalibration(state.geoReading);
        render();
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
    setMessage("開始追蹤。現在可直接點導航地圖新增軌跡點；再點已存在的軌跡點可查看座標與距起點軌跡距離。若手機上單點沒反應，請放開手指後再輕點一次。");
    render();
  }

  function stopTracking() {
    state.tracking = false;
    if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
    setMessage("已停止追蹤。");
    render();
  }

  function resetAll() {
    stopTracking();
    state.trail = [{ x: 0, y: 0, heading: 0, t: Date.now() }];
    state.currentPose = { x: 0, y: 0, heading: 0 };
    state.filteredPose = { x: 0, y: 0, heading: 0 };
    state.corrections = [];
    state.positionSamples = [];
    state.headingSamples = [];
    state.stepCount = 0;
    state.lastStepAt = 0;
    lastStepAtRef = 0;
    smoothedMagnitudeRef = 0;
    state.motionMagnitude = 0;
    state.smoothedMagnitude = 0;
    state.calibratingStepLength = false;
    if (state.exportUrl) {
      URL.revokeObjectURL(state.exportUrl);
      state.exportUrl = "";
      $("downloadLink").style.display = "none";
    }
    setMessage("資料已清空。可重新設定起點後再開始。");
    render();
  }

  function setCurrentGpsAsAnchor() {
    if (!state.geoReading) {
      setMessage("目前沒有 GPS/Geolocation 讀值，不能設定起點。");
      return;
    }
    state.anchor = { lat: state.geoReading.lat, lng: state.geoReading.lng };
    setMessage("已把目前 GPS 位置設為地圖參考原點。後續可用 GPS 建標定點與做柔性位置校正。");
    render();
  }

  function beginPositionCorrection() {
    if (!state.geoReading) {
      setMessage("目前沒有可用定位訊號。請到窗邊或入口再試。");
      return;
    }
    if (Number.isFinite(state.geoReading.accuracy) && state.geoReading.accuracy > MIN_GPS_ACCURACY_METERS) {
      setMessage(`目前 GPS accuracy 約 ${fmt(state.geoReading.accuracy, 1)} m，超過門檻 ${MIN_GPS_ACCURACY_METERS} m，先不要校正。`);
      return;
    }
    state.positionSampleMode = true;
    state.positionSamples = [];
    render();
    setMessage(`開始位置收樣 ${POSITION_SAMPLE_SECONDS} 秒，請盡量站定。系統會只取較可信樣本再平均。`);

    const startedAt = Date.now();
    clearInterval(positionTimer);
    positionTimer = setInterval(() => {
      if (state.geoReading) {
        state.positionSamples.push({
          lat: state.geoReading.lat,
          lng: state.geoReading.lng,
          accuracy: state.geoReading.accuracy,
          ts: Date.now()
        });
      }
      if (Date.now() - startedAt >= POSITION_SAMPLE_SECONDS * 1000) {
        clearInterval(positionTimer);
        finalizePositionCorrection();
      }
    }, SAMPLE_MS);
  }

  function finalizePositionCorrection() {
    state.positionSampleMode = false;
    if (!state.positionSamples.length) {
      setMessage("位置校正失敗：缺少 GPS 樣本。");
      render();
      return;
    }

    ensureGeoAnchorReference();
    if (!state.anchor) {
      setMessage("位置校正失敗：尚未設定 GPS 參考原點。");
      render();
      return;
    }

    const filtered = state.positionSamples.filter(
      (s) => Number.isFinite(s.accuracy) && s.accuracy <= MIN_GPS_ACCURACY_METERS
    );
    const base = filtered.length >= 3 ? filtered : state.positionSamples;
    const weights = base.map((s) => 1 / Math.max(s.accuracy || MIN_GPS_ACCURACY_METERS, 1));
    const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
    const avgLat = base.reduce((sum, s, i) => sum + s.lat * weights[i], 0) / weightSum;
    const avgLng = base.reduce((sum, s, i) => sum + s.lng * weights[i], 0) / weightSum;
    const avgAcc = base.reduce((sum, s) => sum + (s.accuracy || 0), 0) / base.length;

    applySoftGpsCorrection({ lat: avgLat, lng: avgLng, accuracy: avgAcc }, "gps-sampled");
    setMessage(`GPS 柔性校正完成。採用 ${base.length} 筆樣本加權平均，平均誤差 ${fmt(avgAcc, 1)} m。`);
    updateArrivalProgress();
    render();
  }

  function beginHeadingCorrection() {
    state.headingSampleMode = true;
    state.headingSamples = [];
    render();
    setMessage(`開始方向收樣 ${HEADING_SAMPLE_SECONDS} 秒，請保持手機朝向固定。`);
    const startedAt = Date.now();
    clearInterval(headingTimer);
    headingTimer = setInterval(() => {
      state.headingSamples.push({ heading: state.orientation.heading, ts: Date.now() });
      if (Date.now() - startedAt >= HEADING_SAMPLE_SECONDS * 1000) {
        clearInterval(headingTimer);
        finalizeHeadingCorrection();
      }
    }, SAMPLE_MS);
  }

  function finalizeHeadingCorrection() {
    state.headingSampleMode = false;
    if (!state.headingSamples.length) {
      setMessage("方向校正失敗：沒有收集到方向樣本。");
      render();
      return;
    }

    const avgHeading = normalizeAngle(average(state.headingSamples.map((s) => s.heading)));
    const before = latestPose().heading ?? state.currentPose.heading;
    const delta = angleDelta(avgHeading, before);

    state.trail = state.trail.map((p) => {
      const rotated = rotatePoint(p, delta);
      return { ...p, x: rotated.x, y: rotated.y, heading: normalizeAngle((p.heading ?? 0) + delta) };
    });

    const rotated = rotatePoint(state.currentPose, delta);
    state.currentPose = { ...state.currentPose, x: rotated.x, y: rotated.y, heading: normalizeAngle((state.currentPose.heading ?? 0) + delta) };

    state.corrections.unshift({
      id: crypto.randomUUID(),
      type: "heading",
      beforeHeading: before,
      afterHeading: avgHeading,
      delta,
      sampleCount: state.headingSamples.length,
      ts: Date.now()
    });

    setMessage(`方向校正完成。已用 ${state.headingSamples.length} 筆樣本平均，修正 ${fmt(delta, 1)}°。`);
    render();
  }

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      anchor: state.anchor,
      latestPose: latestPose(),
      stepCount: state.stepCount,
      stepLength: state.stepLength,
      geoReading: state.geoReading,
      trail: state.trail,
      corrections: state.corrections,
      settings: {
        positionSampleSeconds: POSITION_SAMPLE_SECONDS,
        headingSampleSeconds: HEADING_SAMPLE_SECONDS,
        minGpsAccuracyMeters: MIN_GPS_ACCURACY_METERS
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = URL.createObjectURL(blob);
    const link = $("downloadLink");
    link.href = state.exportUrl;
    link.download = `indoor-track-${Date.now()}.json`;
    link.style.display = "inline-flex";
    setMessage("已產生 JSON 匯出檔，可下載目前軌跡與校正資料。");
  }

  function beginStepLengthCalibration() {
    if (state.calibratingStepLength) return;
    state.calibratingStepLength = true;
    state.stepCalStart = state.stepCount;
    setMessage("開始 10 步步長校正：請正常走 10 步，系統會自動計算步長。");
    render();
  }

  async function openQrCalibration() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMessage("此瀏覽器不支援相機掃描。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      state.qrStream = stream;
      const modal = $("qrModal");
      const video = $("qrVideo");
      video.srcObject = stream;
      await video.play();
      modal.style.display = "flex";
      state.qrScanMode = true;
      setMessage("請把 QR 對準鏡頭。");
      requestAnimationFrame(scanQrFrame);
    } catch (e) {
      setMessage("無法開啟相機：" + e.message);
    }
  }

  function closeQrCalibration() {
    state.qrScanMode = false;
    $("qrModal").style.display = "none";
    const video = $("qrVideo");
    if (state.qrStream) {
      state.qrStream.getTracks().forEach(t => t.stop());
      state.qrStream = null;
    }
    video.srcObject = null;
  }

  function applyQrAnchor(text) {
    if (!text.startsWith(QR_TARGET_PREFIX)) return false;
    const payload = text.slice(QR_TARGET_PREFIX.length).trim();
    const parts = payload.split(",").map(s => Number(s.trim()));
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return false;

    const target = {
      x: parts[0],
      y: parts[1],
      heading: Number.isFinite(parts[2]) ? normalizeAngle(parts[2]) : null
    };
    const before = latestPose();
    const dx = target.x - before.x;
    const dy = target.y - before.y;

    state.trail = state.trail.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
    state.currentPose = { ...state.currentPose, x: state.currentPose.x + dx, y: state.currentPose.y + dy };

    if (target.heading != null) {
      const delta = angleDelta(target.heading, before.heading ?? state.currentPose.heading);
      state.trail = state.trail.map((p) => {
        const rotated = rotatePoint(p, delta);
        return { ...p, x: rotated.x, y: rotated.y, heading: normalizeAngle((p.heading ?? 0) + delta) };
      });
      const rp = rotatePoint(state.currentPose, delta);
      state.currentPose = { ...state.currentPose, x: rp.x, y: rp.y, heading: normalizeAngle((state.currentPose.heading ?? 0) + delta) };
      state.corrections.unshift({
        id: crypto.randomUUID(),
        type: "qr",
        beforeX: before.x,
        beforeY: before.y,
        afterX: target.x,
        afterY: target.y,
        beforeHeading: before.heading,
        afterHeading: target.heading,
        ts: Date.now()
      });
    } else {
      state.corrections.unshift({
        id: crypto.randomUUID(),
        type: "qr",
        beforeX: before.x,
        beforeY: before.y,
        afterX: target.x,
        afterY: target.y,
        ts: Date.now()
      });
    }

    setMessage("已套用 QR 校正點。");
    updateArrivalProgress();
    render();
    return true;
  }

  function scanQrFrame() {
    if (!state.qrScanMode) return;
    const video = $("qrVideo");
    if (video.readyState >= 2 && typeof jsQR !== "undefined") {
      const c = document.createElement("canvas");
      c.width = video.videoWidth || 640;
      c.height = video.videoHeight || 480;
      const cctx = c.getContext("2d");
      cctx.drawImage(video, 0, 0, c.width, c.height);
      const img = cctx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code && code.data) {
        if (applyQrAnchor(code.data)) {
          closeQrCalibration();
          return;
        }
      }
    }
    requestAnimationFrame(scanQrFrame);
  }

  function normalizeHeadingValue(v) {
    if (v === "" || v == null) return null;
    let n = Number(v);
    if (!Number.isFinite(n)) return null;
    n = n % 360;
    if (n < 0) n += 360;
    return Math.round(n);
  }

  function buildQrPayload() {
    const x = Number($("xValue").value || 0);
    const y = Number($("yValue").value || 0);
    const heading = normalizeHeadingValue($("headingValueInput").value);
    if (heading === null) return `INDOOR_ANCHOR:${x},${y}`;
    return `INDOOR_ANCHOR:${x},${y},${heading}`;
  }

  function qrUrl(text) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=" + encodeURIComponent(text);
  }


  function prefillQrAnchorFromCurrentPose() {
    const pose = latestPose();
    const heading = normalizeAngle((state.orientation?.heading ?? pose?.heading ?? 0) || 0);
    const xInput = $("anchorX");
    const yInput = $("anchorY");
    const hInput = $("anchorHeading");
    if (xInput) xInput.value = fmt(pose?.x || 0, 2);
    if (yInput) yInput.value = fmt(pose?.y || 0, 2);
    if (hInput) hInput.value = fmt(heading, 1);
    generateQr();
  }

  function generateQr() {
    const payload = buildQrPayload();
    const name = $("anchorName").value.trim() || "未命名校正點";
    $("payloadText").value = payload;
    $("payloadPreview").textContent = payload;
    $("anchorTitle").textContent = name;
    $("qrImage").src = qrUrl(payload);
    $("btnDownloadQr").href = qrUrl(payload);
    $("btnDownloadQr").download = (name.replace(/[^\w\u4e00-\u9fff-]+/g, "_") || "indoor-anchor") + ".png";
  }


  function loadSavedAnchors() {
    try {
      const raw = localStorage.getItem("indoor_saved_anchors");
      const parsed = raw ? JSON.parse(raw) : [];
      state.savedAnchors = Array.isArray(parsed) ? parsed.map((a, idx) => normalizeSavedAnchorRecord(a, idx)).filter(Boolean) : [];
    } catch (e) {
      state.savedAnchors = [];
    }
    renderSavedAnchors();
  }

  function persistSavedAnchors() {
    localStorage.setItem("indoor_saved_anchors", JSON.stringify(state.savedAnchors));
    renderSavedAnchors();
  }


  function exportSavedAnchors() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      anchors: state.savedAnchors
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `indoor-anchors-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("已匯出校正點清單 JSON。");
  }

  async function importSavedAnchorsFromFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const anchors = Array.isArray(data) ? data : data.anchors;
      if (!Array.isArray(anchors)) {
        throw new Error("JSON 格式不正確，找不到 anchors 陣列。");
      }
      const normalized = anchors
        .map((a, idx) => normalizeSavedAnchorRecord(a, idx))
        .filter(Boolean);

      state.savedAnchors = normalized;
      persistSavedAnchors();
      setMessage(`已匯入 ${normalized.length} 個校正點。`);
    } catch (e) {
      alert("匯入失敗：" + e.message);
    }
  }


  function currentAnchorDraft() {
    const name = $("anchorName").value.trim() || "未命名校正點";
    const x = Number($("xValue").value || 0);
    const y = Number($("yValue").value || 0);
    const heading = normalizeHeadingValue($("headingValueInput").value);
    return {
      id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      name,
      x,
      y,
      heading,
      source: "manual",
      payload: buildQrPayload(),
      createdAt: new Date().toISOString()
    };
  }

  function saveCurrentAnchor() {
    const draft = currentAnchorDraft();
    const exists = state.savedAnchors.findIndex(a => a.name === draft.name);
    if (exists >= 0) {
      state.savedAnchors[exists] = draft;
    } else {
      state.savedAnchors.unshift(draft);
    }
    persistSavedAnchors();
    setMessage(`已儲存校正點：${draft.name}`);
  }

  function deleteSavedAnchor(id) {
    state.savedAnchors = state.savedAnchors.filter(a => a.id !== id);
    persistSavedAnchors();
  }

  function useSavedAnchor(id) {
    const a = state.savedAnchors.find(x => x.id === id);
    if (!a) return;
    $("anchorName").value = a.name || "";
    $("xValue").value = a.x;
    $("yValue").value = a.y;
    $("headingValueInput").value = a.heading == null ? "" : a.heading;
    generateQr();
    switchPage("qrPage");
  }

  function renderSavedAnchors() {
    const el = $("anchorList");
    if (!el) return;
    if (!state.savedAnchors.length) {
      el.innerHTML = '<div class="item">尚未儲存任何校正點。</div>';
      return;
    }
    el.innerHTML = state.savedAnchors.map((a) => `
      <div class="item">
        <div class="item-top">
          <strong>${a.name}</strong>
          <span class="badge">${a.heading == null ? "無方向" : a.heading + "°"}</span>
        </div>
        <div>x: ${a.x} / y: ${a.y}</div><div style="color:#64748b; font-size:12px;">來源：${a.source === "current-pose" ? "目前位置" : a.source === "gps-fixed" ? "GPS 固定點" : (a.source || "manual")}${a.gps?.accuracy ? " / GPS ±" + fmt(a.gps.accuracy,1) + "m" : ""}</div>
        <div style="margin-top:6px; font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; color:#475569; word-break:break-all;">${a.payload}</div>
        <div class="btns" style="margin-top:10px; margin-bottom:0;">
          <button data-anchor-use="${a.id}">載入</button>
          <button data-anchor-nav="${a.id}">在導航頁查看</button>
          <button data-anchor-waypoint="${a.id}">加入路徑</button>
          <button data-anchor-correct="${a.id}">校正目前位置</button>
          <button data-anchor-copy="${a.id}">複製內容</button>
          <button data-anchor-map="${a.id}">同步到地圖</button>
          <button data-anchor-del="${a.id}" class="danger">刪除</button>
        </div>
      </div>
    `).join("");

    el.querySelectorAll("[data-anchor-use]").forEach(btn => {
      btn.addEventListener("click", () => useSavedAnchor(btn.getAttribute("data-anchor-use")));
    });
    el.querySelectorAll("[data-anchor-copy]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const a = state.savedAnchors.find(x => x.id === btn.getAttribute("data-anchor-copy"));
        if (!a) return;
        try {
          await navigator.clipboard.writeText(a.payload);
          alert("已複製 QR 內容");
        } catch (e) {
          alert("複製失敗");
        }
      });
    });
    el.querySelectorAll("[data-anchor-nav]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.showAnchorOverlay = true;
        state.navTargetId = btn.getAttribute("data-anchor-nav");
        state.activeLegIndex = 0;
        state.arrivedTarget = false;
        state.lastArrivalNoticeKey = "";
        resetRouteProgressBaseline();
        switchPage("navPage");
        setMessage("已切到導航頁，並設為目前目標。");
        render();
      });
    });
    el.querySelectorAll("[data-anchor-del]").forEach(btn => {
      btn.addEventListener("click", () => deleteSavedAnchor(btn.getAttribute("data-anchor-del")));
    });
    el.querySelectorAll("[data-anchor-map]").forEach(btn => {
      btn.addEventListener("click", () => syncAnchorToMapById(btn.getAttribute("data-anchor-map")));
    });
    el.querySelectorAll("[data-anchor-waypoint]").forEach(btn => {
      btn.addEventListener("click", () => addWaypointFromList(btn.getAttribute("data-anchor-waypoint")));
    });
    el.querySelectorAll("[data-anchor-correct]").forEach(btn => {
      btn.addEventListener("click", () => applyAnchorCorrection(btn.getAttribute("data-anchor-correct")));
    });
  }


  function syncNavViewportToCurrentPose() {
    const wrapEl = $("trackCanvasWrap");
    if (!wrapEl) return;
    const pose = latestPose();
    const viewport = state.navViewport;
    const base = getBasePixelsPerWorld(wrapEl);
    viewport.panX = -(Number(pose.x || 0) * base.x * (viewport.scale || 1));
    viewport.panY = -(Number(pose.y || 0) * base.y * (viewport.scale || 1));
    clampViewport(viewport);
  }

  function centerNavOnCurrentPose() {
    const wrapEl = $("trackCanvasWrap");
    if (!wrapEl) return;
    const pose = latestPose();
    const viewport = state.navViewport;
    const base = getBasePixelsPerWorld(wrapEl);
    viewport.panX = -(Number(pose.x || 0) * base.x * (viewport.scale || 1));
    viewport.panY = -(Number(pose.y || 0) * base.y * (viewport.scale || 1));
    clampViewport(viewport);
    refreshViewportUI();
  }

  function switchPage(pageId) {
    document.querySelectorAll(".page").forEach(el => el.classList.toggle("active", el.id === pageId));
    document.querySelectorAll(".tabbtn").forEach(el => el.classList.toggle("active", el.dataset.page === pageId));
  }

  document.querySelectorAll(".tabbtn").forEach(btn => {
    btn.addEventListener("click", () => switchPage(btn.dataset.page));
  });

  $("btnPermission").addEventListener("click", requestPermissions);
  $("btnAnchor").addEventListener("click", setCurrentGpsAsAnchor);
  $("btnStart").addEventListener("click", startTracking);
  $("btnStop").addEventListener("click", stopTracking);
  $("btnReset").addEventListener("click", resetAll);
  $("btnPosCorrection").addEventListener("click", beginPositionCorrection);
  $("btnHeadingCorrection").addEventListener("click", beginHeadingCorrection);
  $("btnExport").addEventListener("click", exportData);
  $("btnStepCal").addEventListener("click", beginStepLengthCalibration);
  $("btnQrCal").addEventListener("click", openQrCalibration);
  $("btnQrClose").addEventListener("click", closeQrCalibration);
  $("stepLength").addEventListener("input", (e) => {
    state.stepLength = Number(e.target.value);
    render();
  });
  $("toggleAnchorOverlay").addEventListener("change", (e) => {
    state.showAnchorOverlay = e.target.checked;
    render();
  });
  $("toggleMapOverlay").addEventListener("change", (e) => {
    state.showMapOverlay = e.target.checked;
    render();
  });
  $("btnSetTarget").addEventListener("click", setNavTarget);
  $("btnClearTarget").addEventListener("click", clearNavTarget);
  $("navTargetSelect").addEventListener("change", setNavTarget);
  $("routeModeSelect").addEventListener("change", setRouteMode);
  $("routeWaypointsSelect").addEventListener("change", applyWaypointSelection);
  $("btnApplyRoute").addEventListener("click", applyWaypointSelection);
  $("btnClearRoute").addEventListener("click", clearRouteWaypoints);
  $("arrivalThresholdInput").addEventListener("change", (e) => {
    const v = Number(e.target.value);
    state.arrivalThreshold = Number.isFinite(v) && v > 0 ? v : 2.0;
    render();
  });
  $("toggleVoiceGuide").addEventListener("change", (e) => {
    state.voiceGuideEnabled = e.target.checked;
    if (!state.voiceGuideEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
    render();
  });
  $("btnNavSessionStart").addEventListener("click", startNavSession);
  $("btnNavSessionPause").addEventListener("click", pauseNavSession);
  $("btnNavSessionResume").addEventListener("click", resumeNavSession);
  $("btnNavSessionEnd").addEventListener("click", () => finishNavSession("ended"));
  $("btnExportNavHistory").addEventListener("click", exportNavHistory);

  $("btnEditorIdle").addEventListener("click", () => setEditorMode("idle"));
  $("btnEditorPoint").addEventListener("click", () => setEditorMode("point"));
  $("btnEditorLine").addEventListener("click", () => setEditorMode("line"));
  $("btnEditorArea").addEventListener("click", () => setEditorMode("area"));
  $("btnEditorUndo").addEventListener("click", undoMapElement);
  $("btnEditorNormalize").addEventListener("click", () => { normalizeLineNetwork(); render(); });
  $("btnEditorClear").addEventListener("click", () => {
    if (!confirm("確定要清空所有地圖元素嗎？")) return;
    state.mapElements = [];
    state.editorDraftPoints = [];
    persistMapElements();
    setEditorMessage("已清空所有地圖元素。");
    render();
  });
  $("editorNameInput").addEventListener("input", () => render());
  $("toggleSnapMode").addEventListener("change", (e) => { state.snapEnabled = e.target.checked; render(); });
  $("toggleAutoIntersect").addEventListener("change", (e) => { state.autoIntersectEnabled = e.target.checked; render(); });
  $("editorCanvas").addEventListener("click", handleEditorCanvasClick);
  $("btnUpdateSelectedMapElement").addEventListener("click", updateSelectedMapElementName);
  $("btnDeleteSelectedMapElement").addEventListener("click", deleteSelectedMapElement);
  $("btnConvertSelectedToAnchor").addEventListener("click", convertSelectedMapElementToAnchor);
  $("btnExportMapData").addEventListener("click", exportMapData);
  $("btnImportMapData").addEventListener("click", () => $("importMapDataFile").click());
  $("importMapDataFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    importMapData(file);
    e.target.value = "";
  });

  $("btnClearNavHistory").addEventListener("click", () => {
    if (!confirm("確定要清空所有導航歷史嗎？")) return;
    state.navHistory = [];
    persistNavHistory();
  });

  $("btnGenerate").addEventListener("click", generateQr);
  $("btnSaveAnchor").addEventListener("click", saveCurrentAnchor);
  $("btnExportAnchors").addEventListener("click", exportSavedAnchors);
  $("btnSyncAnchorsToMap").addEventListener("click", syncAllAnchorsToMap);
  $("btnImportAnchors").addEventListener("click", () => $("importAnchorsFile").click());
  $("importAnchorsFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    importSavedAnchorsFromFile(file);
    e.target.value = "";
  });
  $("btnClearAnchors").addEventListener("click", () => {
    if (!confirm("確定要清空所有已儲存校正點嗎？")) return;
    state.savedAnchors = [];
    persistSavedAnchors();
  });
  $("btnCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("payloadText").value);
      alert("已複製 QR 內容");
    } catch (e) {
      alert("複製失敗，請手動選取文字");
    }
  });
  ["anchorName", "xValue", "yValue", "headingValueInput"].forEach((id) => {
    $(id).addEventListener("input", generateQr);
  });

  window.addEventListener("deviceorientation", handleOrientation, true);
  window.addEventListener("devicemotion", handleMotion, true);

  injectEnhancementUI();
  attachViewportHandlers($("trackCanvasWrap"), $("trackCanvas"), state.navViewport, "nav");
  attachViewportHandlers($("editorCanvasWrap"), $("editorCanvas"), state.editorViewport, "editor");
  $("trackCanvas")?.addEventListener("click", handleNavCanvasClick);
  $("trackCanvas")?.addEventListener("pointerup", handleNavCanvasPointerUp);
  $("trackCanvas")?.addEventListener("touchend", (evt) => {
    const touch = evt.changedTouches && evt.changedTouches[0];
    if (!touch) return;
    handleNavCanvasPointerUp({ clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: true });
  $("btnTrackFullscreen")?.addEventListener("click", () => toggleWrapFullscreen("trackCanvasWrap"));
  $("btnNavAutoFit")?.addEventListener("click", () => {
    state.navAutoFit = !state.navAutoFit;
    if (state.navAutoFit) ensureNavViewportVisible(true);
    refreshViewportUI();
  });
  $("btnNavFollow")?.addEventListener("click", () => {
    state.navFollowCurrent = !state.navFollowCurrent;
    if (state.navFollowCurrent) centerNavOnCurrentPose();
    refreshViewportUI();
  });
  $("btnNavFitNow")?.addEventListener("click", () => {
    centerNavOnCurrentPose();
  });
  $("btnEditorFullscreen")?.addEventListener("click", () => toggleWrapFullscreen("editorCanvasWrap"));
  document.addEventListener("fullscreenchange", () => {
    ensureNavViewportVisible(state.navAutoFit);
    refreshViewportUI();
  });
  document.addEventListener("webkitfullscreenchange", () => {
    ensureNavViewportVisible(state.navAutoFit);
    refreshViewportUI();
  });
  window.addEventListener("resize", () => {
    ensureNavViewportVisible(state.navAutoFit);
    refreshViewportUI();
  });
    

  $("btnUseGpsForDraftAnchor")?.addEventListener("click", createAnchorFromGpsDraft);
  $("btnAnchorCorrection")?.addEventListener("click", () => applyAnchorCorrection($("anchorCorrectionSelect")?.value));
  $("btnGpsFusionCorrection")?.addEventListener("click", async () => {
    try {
      setMessage("以 GPS 柔性校正中，請站定 4 秒。");
      const sample = await sampleCurrentGps(4000);
      applySoftGpsCorrection(sample, "gps-manual");
      setMessage(`已完成 GPS 柔性校正，平均誤差 ${fmt(sample.accuracy, 1)} m。`);
      render();
    } catch (e) {
      setMessage("GPS 柔性校正失敗：" + e.message);
    }
  });
    $("smoothStrengthSlider")?.addEventListener("input", (e) => {
    const alpha = Number(e.target.value || 0.22);
    state.poseSmoothingAlpha = alpha;
    state.poseSmoothingPreset = smoothingLabel(alpha);
    refreshSmoothingUi();
    render();
  });
  $("smoothStrengthSlider")?.addEventListener("change", (e) => {
    setPoseSmoothingAlpha(Number(e.target.value || 0.22));
  });

$("btnEditorAnchor")?.addEventListener("click", () => {
    state.anchorCreationMode = true;
    setEditorMode("point");
    setEditorMessage("標定點模式：在地圖上點一下直接新增標定點。");
    render();
  });

  prefillQrAnchorFromCurrentPose();
  loadSavedAnchors();
  loadNavTrackPoints();
  loadNavHistory();
  loadMapElements();
  loadPoseSmoothingPreference();
  render();
})();
