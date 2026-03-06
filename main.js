const API_BASE = "http://127.0.0.1:5055";

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function playBeep({ freq = 800, duration = 0.03, type = "square", gain = 0.05 }) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}
function sfxTick() { playBeep({ freq: 920, duration: 0.022, type: "square", gain: 0.05 }); }
function sfxTing() {
  playBeep({ freq: 880, duration: 0.07, type: "sine", gain: 0.07 });
  setTimeout(() => playBeep({ freq: 1320, duration: 0.06, type: "sine", gain: 0.06 }), 20);
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không load được ${url} (HTTP ${res.status})`);
  return res.json();
}

function ringPositions16() {
  const pos = [];
  for (let c = 1; c <= 5; c++) pos.push({ r: 1, c });
  for (let r = 2; r <= 5; r++) pos.push({ r, c: 5 });
  for (let c = 4; c >= 1; c--) pos.push({ r: 5, c });
  for (let r = 4; r >= 2; r--) pos.push({ r, c: 1 });
  return pos;
}

function pickWeightedIndex(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function makeFallbackText(prizeId) {
  const t = document.createElement("div");
  t.style.fontSize = "13px";
  t.style.fontWeight = "900";
  t.style.textAlign = "center";
  t.style.color = "#fff";
  t.textContent = `ID ${prizeId}`;
  return t;
}

function makeIconOrFallback(item, prizeId) {
  if (item && item.ImagePath) {
    const img = document.createElement("img");
    img.className = "icon";
    img.src = "./" + item.ImagePath;
    img.onerror = () => img.replaceWith(makeFallbackText(prizeId));
    return img;
  }
  const img = document.createElement("img");
  img.className = "icon";
  img.src = `./icons/${prizeId}.png`;
  img.onerror = () => {
    img.src = `./icons/${prizeId}.bmp`;
    img.onerror = () => img.replaceWith(makeFallbackText(prizeId));
  };
  return img;
}

function makeBigIcon(item, prizeId) {
  const img = document.createElement("img");
  img.className = "bigIcon";
  if (item && item.ImagePath) img.src = "./" + item.ImagePath;
  else img.src = `./icons/${prizeId}.png`;
  img.onerror = () => { img.src = `./icons/${prizeId}.bmp`; };
  return img;
}

function showWinPopup(prize, codeText = "") {
  const overlay = document.createElement("div");
  overlay.className = "overlay";

  const itemName = (prize.item && (prize.item["Tên"] || prize.item.Name)) || `(ID: ${prize.id})`;
  const codeBlock = codeText
    ? `<div style="margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1)">
         <div style="font-weight:900;margin-bottom:6px">🔑 Code thưởng</div>
         <div style="font-weight:800;word-break:break-all">${codeText}</div>
       </div>`
    : "";

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modalHead">
      <div class="modalTitle">🎉 Chúc mừng!</div>
      <button class="closeBtn" id="closePopup">Đóng</button>
    </div>
    <div class="winBox">
      <div class="bigIconWrap" id="bigIconWrap"></div>
      <div>
        <div class="winLine1">🎁 Trúng: ${itemName}</div>
        <div class="winLine2">📦 Số lượng: x${prize.qty}</div>
        ${codeBlock}
      </div>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modal.querySelector("#bigIconWrap").appendChild(makeBigIcon(prize.item, prize.id));

  function close() { overlay.remove(); }
  modal.querySelector("#closePopup").addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
}

async function flashWinner(cell, times = 3) {
  for (let i = 0; i < times; i++) {
    cell.classList.add("flash");
    await new Promise((r) => setTimeout(r, 220));
    cell.classList.remove("flash");
    await new Promise((r) => setTimeout(r, 110));
  }
}

function getTokenFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("token") || "";
}

async function checkSpinToken(token) {
  const res = await fetch(`${API_BASE}/api/spin/check?token=${encodeURIComponent(token)}`);
  return res.json();
}

async function claimSpinReward(token, prize) {
  const res = await fetch(`${API_BASE}/api/spin/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, item_id: prize.id, qty: prize.qty })
  });
  return res.json();
}

(async function () {
  const board = document.getElementById("board");
  const btn = document.getElementById("btnSpin");
  const result = document.getElementById("result");

  try {
    const items = await loadJson("./data/Item.json");
    const rewards = await loadJson("./data/rewards.json");

    const itemById = new Map();
    for (const it of items) itemById.set(Number(it.ID), it);

    const prizes = rewards.slice(0, 16).map((r) => ({
      id: Number(r.id),
      qty: Number(r.qty),
      weight: Number(r.weight),
      item: itemById.get(Number(r.id)) || null,
    }));

    if (prizes.length < 16) throw new Error("rewards.json phải có ít nhất 16 dòng.");

    const ringPos = ringPositions16();
    let activePos = 0;
    let spinning = false;

    const cells = prizes.map((p, i) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.style.gridRow = String(ringPos[i].r);
      cell.style.gridColumn = String(ringPos[i].c);
      cell.appendChild(makeIconOrFallback(p.item, p.id));
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = `x${p.qty}`;
      cell.appendChild(badge);
      board.appendChild(cell);
      return cell;
    });

    function setActive(i) {
      cells.forEach((c) => c.classList.remove("active"));
      cells[i].classList.add("active");
    }

    function showResult2Lines(prize, extra = "") {
      const itemName = (prize.item && (prize.item["Tên"] || prize.item.Name)) || `(ID: ${prize.id})`;
      result.textContent = `🎁 Trúng: ${itemName}\n📦 Số lượng: x${prize.qty}` + (extra ? `\n${extra}` : "");
    }

    setActive(activePos);

    btn.addEventListener("click", async () => {
      if (spinning) return;
      spinning = true;
      btn.disabled = true;
      ensureAudio();

      try {
        const token = getTokenFromUrl();
        if (!token) {
          result.textContent = "❌ Thiếu token quay trong link (?token=...)";
          spinning = false;
          btn.disabled = false;
          return;
        }

        const chk = await checkSpinToken(token);
        if (!chk.ok || !chk.valid) {
          result.textContent = "❌ Token không hợp lệ hoặc đã dùng.";
          spinning = false;
          btn.disabled = false;
          return;
        }

        const weights = prizes.map((p) => p.weight);
        const target = pickWeightedIndex(weights);
        const size = prizes.length;
        const rounds = 4 + Math.floor(Math.random() * 3);
        const delta = (target - activePos + size) % size;
        const totalSteps = rounds * size + delta;

        let step = 0;
        const baseDelay = 55;
        const maxDelay = 190;

        const tick = async () => {
          step++;
          activePos = (activePos + 1) % size;
          setActive(activePos);
          sfxTick();

          const t = step / totalSteps;
          const delay = baseDelay + (maxDelay - baseDelay) * Math.pow(t, 2.2);

          if (step >= totalSteps) {
            sfxTing();
            const prize = prizes[activePos];
            showResult2Lines(prize);
            await flashWinner(cells[activePos], 3);

            let claimText = "";
            let popupCode = "";

            try {
              const claimResp = await claimSpinReward(token, prize);
              if (claimResp.ok) {
                popupCode = claimResp.code || "";
                claimText = popupCode ? `🔑 Code: ${popupCode}` : "✅ Đã nhận thưởng.";
              } else {
                claimText = `⚠️ Claim lỗi: ${claimResp.error || "unknown"}`;
              }
            } catch (e) {
              claimText = "⚠️ Không gọi được API claim.";
            }

            showResult2Lines(prize, claimText);
            showWinPopup(prize, popupCode);
            spinning = false;
            btn.disabled = false;
            return;
          }

          setTimeout(tick, delay);
        };

        setTimeout(tick, baseDelay);
      } catch (err) {
        result.textContent = "❌ Lỗi: " + (err?.message || err);
        spinning = false;
        btn.disabled = false;
      }
    });
  } catch (err) {
    result.textContent = "❌ Lỗi: " + (err?.message || err);
  }
})();
