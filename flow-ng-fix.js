(() => {
  const KEY = "mindmap-app-v2";
  const OLD_KEY = "mindmap-app-v1";
  const FLOW_LAYOUTS = new Set(["flowchart", "swimlaneH", "swimlaneV"]);
  const textOf = (n) => String(n?.text || "");
  const includes = (n, label) => textOf(n).includes(label);

  function patchMapData(map) {
    const nodes = map?.nodes || {};
    if (!FLOW_LAYOUTS.has(map?.layout)) return false;
    const ids = Object.keys(nodes);
    const basic = ids.find((id) => includes(nodes[id], "基本作業の練習"));
    const check = ids.find((id) => includes(nodes[id], "理解度確認"));
    const stand = ids.find((id) => includes(nodes[id], "独り立ち判断"));
    const ng = ids.find((id) => includes(nodes[id], "NGの場合"));
    if (!basic || !check || !stand || !ng) return false;

    let changed = false;
    for (const id of ids) {
      const children = Array.isArray(nodes[id].children) ? nodes[id].children : [];
      if (!children.includes(ng)) continue;
      nodes[id].children = children.filter((child) => child !== ng);
      changed = true;
    }
    if (Array.isArray(nodes[ng].children) && nodes[ng].children.length) {
      nodes[ng].children = [];
      changed = true;
    }
    if (Array.isArray(nodes[basic].children)) {
      if (!nodes[basic].children.includes(check)) {
        nodes[basic].children.unshift(check);
        changed = true;
      }
    } else {
      nodes[basic].children = [check];
      changed = true;
    }

    const edges = Array.isArray(map.flowEdges) ? map.flowEdges : [];
    const filtered = edges.filter((ed) => !(ed.from === basic && ed.to === ng) && !(ed.from === ng && ed.to === check));
    const hasStandToNg = filtered.some((ed) => ed.from === stand && ed.to === ng);
    const hasNgReturn = filtered.some((ed) => ed.from === ng && ed.to === basic);
    if (!hasStandToNg) filtered.push({ id: `ng-route-${stand}-${ng}`, from: stand, to: ng, label: "NG" });
    if (!hasNgReturn) filtered.push({ id: `ng-return-${ng}-${basic}`, from: ng, to: basic, label: "", returnToTrunk: true, trunkTo: check });
    if (filtered.length !== edges.length || !hasStandToNg || !hasNgReturn) {
      map.flowEdges = filtered;
      changed = true;
    }
    return changed;
  }

  function patchStoredState(raw) {
    if (!raw) return raw;
    try {
      const state = JSON.parse(raw);
      let changed = false;
      for (const map of Object.values(state.maps || {})) changed = patchMapData(map) || changed;
      return changed ? JSON.stringify(state) : raw;
    } catch {
      return raw;
    }
  }

  const originalGetItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function patchedGetItem(key) {
    const raw = originalGetItem.call(this, key);
    return key === KEY || key === OLD_KEY ? patchStoredState(raw) : raw;
  };

  const num = (v) => Number(String(v || "").replace(/[^-0-9.]/g, "")) || 0;
  const getTranslate = (g) => {
    const m = String(g?.getAttribute("transform") || "").match(/translate\(([-0-9.]+)[ ,]([-0-9.]+)\)/);
    return m ? { x: +m[1], y: +m[2] } : null;
  };
  const setTranslate = (g, p) => g?.setAttribute("transform", `translate(${p.x},${p.y})`);
  const nodeFor = (label) => {
    const texts = [...document.querySelectorAll("svg g.node text")];
    const text = texts.find((t) => String(t.textContent || "").includes(label));
    return text ? text.closest("g.node") : null;
  };
  const box = (g) => {
    const p = getTranslate(g);
    if (!p) return null;
    const b = g.getBBox();
    return { ...p, w: b.width, h: b.height, left: p.x - b.width / 2, right: p.x + b.width / 2, top: p.y - b.height / 2, bottom: p.y + b.height / 2 };
  };
  const makePath = (d, color = "#334155", width = 2.2) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", String(width));
    p.setAttribute("opacity", "0.82");
    p.setAttribute("stroke-linecap", "butt");
    p.setAttribute("stroke-linejoin", "miter");
    p.setAttribute("shape-rendering", "crispEdges");
    p.setAttribute("marker-end", "url(#flow-arrow)");
    return p;
  };
  const makeLabel = (x, y, text) => {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", `translate(${x},${y})`);
    g.setAttribute("class", "edge-label");
    const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("x", "-26"); r.setAttribute("y", "-11"); r.setAttribute("width", "52"); r.setAttribute("height", "22"); r.setAttribute("rx", "6");
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "central"); t.setAttribute("font-size", "11");
    t.textContent = text;
    g.append(r, t);
    return g;
  };

  let scheduled = false;
  function applyVisualFix() {
    scheduled = false;
    const svg = document.querySelector("svg");
    if (!svg) return;
    const basicG = nodeFor("基本作業の練習");
    const checkG = nodeFor("理解度確認");
    const standG = nodeFor("独り立ち判断");
    const ngG = nodeFor("NGの場合");
    if (!basicG || !checkG || !standG || !ngG) return;
    const basic = box(basicG), check = box(checkG), stand = box(standG), oldNg = box(ngG);
    if (!basic || !check || !stand || !oldNg) return;
    const exec = box(nodeFor("実務へ移行"));
    const returnY = (basic.bottom + check.top) / 2;
    const ngX = Math.max((exec ? exec.right : basic.x + 180) + oldNg.w / 2 + 78, basic.x + 300);
    const ngY = (stand.y + returnY) / 2;
    const dx = ngX - oldNg.x;
    const dy = ngY - oldNg.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setTranslate(ngG, { x: ngX, y: ngY });
      for (const g of [...svg.querySelectorAll("g")]) {
        if (g === ngG || g.classList.contains("node")) continue;
        const p = getTranslate(g);
        if (!p) continue;
        if (Math.abs(p.x - oldNg.x) < oldNg.w / 2 + 42 && Math.abs(p.y - oldNg.y) < oldNg.h / 2 + 42) {
          setTranslate(g, { x: p.x + dx, y: p.y + dy });
        }
      }
    }

    svg.querySelector('[data-ng-route-fix="1"]')?.remove();
    for (const p of [...svg.querySelectorAll("path.edge-path, path[marker-end]")]) {
      if (p.closest('[data-ng-route-fix="1"]')) continue;
      let b;
      try { b = p.getBBox(); } catch { continue; }
      const nearOldNg = b.x < oldNg.right + 70 && b.x + b.width > oldNg.left - 70 && b.y < oldNg.bottom + 90 && b.y + b.height > oldNg.top - 90;
      const rightReturn = b.x > basic.x + 90 && b.y < stand.y + 100 && b.y + b.height > returnY - 90;
      if (nearOldNg || rightReturn) p.style.opacity = "0";
    }

    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("data-ng-route-fix", "1");
    const ngTop = ngY - oldNg.h / 2;
    const ngBottom = ngY + oldNg.h / 2;
    const standRight = stand.x + stand.w / 2;
    layer.append(makePath(`M ${basic.x} ${basic.bottom} L ${basic.x} ${check.top}`, "#334155", 2));
    layer.append(makePath(`M ${standRight} ${stand.y} L ${ngX} ${stand.y} L ${ngX} ${ngBottom}`, "#334155", 2.4));
    layer.append(makeLabel(standRight + 44, stand.y - 14, "NG"));
    layer.append(makePath(`M ${ngX} ${ngTop} L ${ngX} ${returnY} L ${basic.x} ${returnY}`, "#334155", 2.4));
    svg.insertBefore(layer, svg.querySelector("g.node") || null);
  }
  function scheduleFix() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyVisualFix);
  }
  addEventListener("load", () => {
    scheduleFix();
    setInterval(scheduleFix, 900);
    const root = document.getElementById("root");
    if (root) new MutationObserver(scheduleFix).observe(root, { childList: true, subtree: true, attributes: true });
  });
})();