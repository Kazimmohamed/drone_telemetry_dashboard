// public/script.js
// Real-time drone dashboard: Three.js drone + battery/temperature UI
// Supports binary packets (32 bytes): seq(4) ts_ms(4) pitch(4) roll(4) yaw(4) temp(4) hum(4) batt(4)
// Falls back to JSON text if received.

(() => {
  // ---------- Config ----------
  // Set battery mapping to match your hardware (default: 5.0V -> 0% , 6.6V -> 100%)
  const BATTERY_MIN = 5.0;
  const BATTERY_MAX = 6.6;

  // ---------- WebSocket setup ----------
  const host = location.hostname;
  const port = location.port || 3000;
  const wsUrl = `ws://${host}:${port}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer'; // IMPORTANT: accept binary ArrayBuffer

  const wsStatus = document.getElementById("wsStatus");
  ws.addEventListener("open", () => { wsStatus.textContent = "connected"; wsStatus.style.color = "#22c55e"; });
  ws.addEventListener("close", () => { wsStatus.textContent = "disconnected"; wsStatus.style.color = "#ef4444"; });
  ws.addEventListener("error", () => { wsStatus.textContent = "error"; wsStatus.style.color = "#f59e0b"; });

  // ---------- DOM elements ----------
  const pitchVal = document.getElementById("pitchVal");
  const rollVal  = document.getElementById("rollVal");
  const yawVal   = document.getElementById("yawVal");
  const tempFill = document.getElementById("tempFill");
  const batteryFill = document.getElementById("batteryFill");
  const batteryPct  = document.getElementById("batteryPct");
  const batteryVolt = document.getElementById("batteryVolt");
  const humidityVal = document.getElementById("humidityVal");
  const threeContainer = document.getElementById("three-container");
  const batteryCard = document.querySelector(".battery");

  // ---------- state & smoothing ----------
  const state = {
    pitch: 0, roll: 0, yaw: 0,
    temperature: 0, humidity: 0, batteryVoltage: 0
  };
  let prevBatteryPct = 0;
  function lerp(a,b,t){ return a + (b - a) * t; }

  // ---------- THREE.JS scene (realistic-ish drone) ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, threeContainer.clientWidth / threeContainer.clientHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
  renderer.setClearColor(0x000000, 0); // transparent bg
  threeContainer.appendChild(renderer.domElement);

  // lights
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(5, 10, 7);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0x9fb4c9, 0.8));

  // stage halo overlay (CSS handles .stage-halo)
  const halo = document.createElement("div");
  halo.className = "stage-halo";
  threeContainer.appendChild(halo);

  // drone group
  const drone = new THREE.Group();

  // body
  const bodyGeom = new THREE.BoxGeometry(1.6, 0.24, 1.0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5ff, metalness: 0.55, roughness: 0.35, emissive: 0x072f3f, emissiveIntensity: 0.08
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  drone.add(body);

  // dome shell
  const domeGeom = new THREE.SphereGeometry(0.38, 24, 12);
  const domeMat = new THREE.MeshStandardMaterial({ color: 0x04293a, metalness: 0.6, roughness: 0.25 });
  const dome = new THREE.Mesh(domeGeom, domeMat);
  dome.position.set(0, 0.22, 0);
  dome.scale.set(1, 0.5, 1);
  drone.add(dome);

  // arms, motors, props
  const armLen = 1.2;
  const armRadius = 0.06;
  const armGeom = new THREE.CylinderGeometry(armRadius, armRadius, armLen, 12);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x13181c, metalness: 0.6, roughness: 0.4 });
  const props = [];
  const armOffsets = [
    [ 0.9, 0,  0.65],
    [-0.9, 0,  0.65],
    [ 0.9, 0, -0.65],
    [-0.9, 0, -0.65]
  ];
  armOffsets.forEach((p, i) => {
    const arm = new THREE.Mesh(armGeom, armMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(p[0], 0, p[2]);
    drone.add(arm);

    // motor
    const motorGeom = new THREE.CylinderGeometry(0.12,0.12,0.08,12);
    const motorMat = new THREE.MeshStandardMaterial({ color: 0x111419, metalness: 0.8, roughness: 0.25 });
    const motor = new THREE.Mesh(motorGeom, motorMat);
    motor.rotation.x = Math.PI/2;
    motor.position.set(p[0], 0.06, p[2]);
    drone.add(motor);

    // prop disc
    const propGeom = new THREE.CylinderGeometry(0.15,0.15,0.02,24);
    const propMat = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.2, roughness: 0.3 });
    const prop = new THREE.Mesh(propGeom, propMat);
    prop.rotation.x = Math.PI/2;
    prop.position.set(p[0], 0.12, p[2]);
    drone.add(prop);
    props.push(prop);

    // small LED
    const ledGeom = new THREE.SphereGeometry(0.03, 8, 6);
    const ledMat = new THREE.MeshStandardMaterial({
      color: i % 2 === 0 ? 0x34d399 : 0xf59e0b,
      emissive: i % 2 === 0 ? 0x1b8c5b : 0xa05e00,
      emissiveIntensity: 0.9
    });
    const led = new THREE.Mesh(ledGeom, ledMat);
    led.position.set(p[0] * 0.86, 0.06, p[2] * 0.86);
    drone.add(led);
  });

  scene.add(drone);

  camera.position.set(0, 3.6, 6);
  camera.lookAt(0, 0, 0.1);

  function resize() {
    renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
    camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  const ROT_LERP = 0.12;
  function animate() {
    requestAnimationFrame(animate);
    // map pitch->x, roll->z, yaw->y
    drone.rotation.x = lerp(drone.rotation.x, state.pitch * Math.PI / 180, ROT_LERP);
    drone.rotation.z = lerp(drone.rotation.z, state.roll  * Math.PI / 180, ROT_LERP);
    drone.rotation.y = lerp(drone.rotation.y, state.yaw   * Math.PI / 180, ROT_LERP);

    // props spin
    const motionMag = Math.min(5.0, Math.hypot(state.pitch, state.roll, state.yaw) / 45.0);
    props.forEach((p, i) => {
      p.rotation.y += 0.5 + (i + 1) * 0.15 + motionMag * 0.9;
    });

    renderer.render(scene, camera);
  }
  animate();

  // ---------- Helper: update temperature UI ----------
  function updateTemperature(t) {
    const pct = Math.max(0, Math.min(100, (t + 20) / 100 * 100)); // -20..80 -> 0..100
    tempFill.style.width = pct + "%";
    if (t < 25) tempFill.style.background = "#60a5fa";
    else if (t < 45) tempFill.style.background = "#34d399";
    else if (t < 60) tempFill.style.background = "#f59e0b";
    else tempFill.style.background = "#ef4444";
    tempFill.textContent = t.toFixed(1) + "°C";
  }

  // ---------- Helper: update battery UI ----------
  function updateBattery(voltage) {
    // compute pct from configured range
    let pct = 0;
    if (voltage >= BATTERY_MAX) pct = 100;
    else if (voltage <= BATTERY_MIN) pct = 0;
    else pct = ((voltage - BATTERY_MIN) / (BATTERY_MAX - BATTERY_MIN)) * 100;
    pct = Math.max(0, Math.min(100, pct));

    batteryFill.style.width = pct + "%";
    batteryPct.textContent = Math.round(pct) + "%";
    batteryVolt.textContent = "Voltage: " + voltage.toFixed(2) + " V";

    if (pct > 60) batteryFill.style.background = "linear-gradient(90deg,#34d399,#22c55e)";
    else if (pct > 30) batteryFill.style.background = "linear-gradient(90deg,#fbbf24,#f59e0b)";
    else batteryFill.style.background = "linear-gradient(90deg,#fb7185,#ef4444)";

    const isLow = pct <= 20;
    const isFullish = pct >= 98;
    if (isLow) batteryCard.classList.add("low"); else batteryCard.classList.remove("low");
    if (isFullish) batteryCard.classList.add("charge"); else batteryCard.classList.remove("charge");

    if (Math.abs(pct - prevBatteryPct) > 4) {
      batteryFill.classList.add("pulse-update");
      setTimeout(() => batteryFill.classList.remove("pulse-update"), 700);
    }
    prevBatteryPct = pct;
  }

  // ---------- Message handler: support binary (ArrayBuffer) & JSON text ----------
  ws.addEventListener("message", (ev) => {
    try {
      // Binary path: ArrayBuffer expected length 32
      if (ev.data instanceof ArrayBuffer) {
        const buf = ev.data;
        if (buf.byteLength === 32) {
          const dv = new DataView(buf);
          // little-endian values
          const seq = dv.getUint32(0, true);
          const ts_ms = dv.getUint32(4, true);
          const pitch = dv.getFloat32(8, true);
          const roll  = dv.getFloat32(12, true);
          const yaw   = dv.getFloat32(16, true);
          const temperature = dv.getFloat32(20, true);
          const humidity    = dv.getFloat32(24, true);
          const batteryV    = dv.getFloat32(28, true);

          // update state + UI
          state.pitch = pitch; state.roll = roll; state.yaw = yaw;
          pitchVal.textContent = pitch.toFixed(1) + "°";
          rollVal.textContent  = roll.toFixed(1) + "°";
          yawVal.textContent   = yaw.toFixed(1) + "°";

          updateTemperature(temperature);
          state.humidity = humidity;
          humidityVal.textContent = humidity.toFixed(1) + "%";

          state.batteryVoltage = batteryV;
          updateBattery(batteryV);

          // optional: tiny debug log (uncomment if needed)
          // console.log(`seq ${seq} ts ${ts_ms} lat~${Date.now()-ts_ms}ms`);
          return;
        }
        // if binary but unexpected size, try to ignore or fallback
      }

      // Text/JSON fallback
      const data = JSON.parse(ev.data);

      if ("pitch" in data && "roll" in data && "yaw" in data) {
        state.pitch = Number(data.pitch) || 0;
        state.roll  = Number(data.roll)  || 0;
        state.yaw   = Number(data.yaw)   || 0;
        pitchVal.textContent = state.pitch.toFixed(1) + "°";
        rollVal.textContent  = state.roll.toFixed(1) + "°";
        yawVal.textContent   = state.yaw.toFixed(1) + "°";
      }

      if ("temperature" in data) {
        state.temperature = Number(data.temperature) || 0;
        updateTemperature(state.temperature);
      }

      if ("battery" in data) {
        state.batteryVoltage = Number(data.battery) || 0;
        updateBattery(state.batteryVoltage);
      }

      if ("humidity" in data) {
        state.humidity = Number(data.humidity) || 0;
        humidityVal.textContent = state.humidity.toFixed(1) + "%";
      }

    } catch (err) {
      console.warn("Message parse error:", err);
    }
  });

  // small CSS hook for pulse animation
  const style = document.createElement("style");
  style.textContent = `
    .battery .battery-fill.pulse-update { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,0.35); transition: all 350ms ease; }
  `;
  document.head.appendChild(style);

})();
