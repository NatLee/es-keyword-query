(() => {
  const $ = (selector) => document.querySelector(selector);
  const data = window.ATLAS;
  let specimen = 0,
    mode = 0,
    stage = "structure",
    selected = 0;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svg = (tag, attrs, text) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  function result() {
    return data[specimen].modes[mode];
  }
  function output() {
    const filter = $("#filter").value;
    return filter === ""
      ? result().query_string
      : result().filtered[Number(filter)];
  }
  data.forEach((item, i) => {
    const button = el("button", "", item.title);
    button.prepend(el("span", "", String(i + 1).padStart(2, "0")));
    button.type = "button";
    button.setAttribute("aria-pressed", String(i === 0));
    button.onclick = () => {
      specimen = i;
      selected = 0;
      render();
    };
    $("#specimens").append(button);
    if (item.modes[0].valid) {
      const option = el("option", "", item.title);
      option.value = String(i);
      $("#filter").append(option);
    }
  });
  function notes() {
    const area = $("#clause-notes");
    area.replaceChildren();
    const r = result();
    if (!r.valid) {
      area.append(
        el(
          "p",
          "",
          "Compilation stopped. Select another specimen to inspect its clauses.",
        ),
      );
      return;
    }
    const c = r.clauses[selected];
    area.append(
      el("div", "clause-number", String(selected + 1).padStart(2, "0")),
      el("div", "clause-label", c.text ?? "Explicit group"),
    );
    const meta = el("dl", "clause-meta");
    for (const [label, value] of [
      ["KIND", c.kind],
      ["JOIN", c.joiner ?? "start / implicit"],
      ["EXCLUDED", c.negated ? "yes · direct !" : "no direct !"],
      ["PARENT", c.parent === null ? "query root" : `clause ${c.parent + 1}`],
    ]) {
      const cell = el("div");
      cell.append(el("dt", "", label), el("dd", "", value));
      meta.append(cell);
    }
    area.append(meta);
    if (c.output) area.append(el("pre", "clause-output", c.output));
    area.append(
      el(
        "p",
        "",
        c.kind === "group"
          ? "This boundary keeps its children together. An exclusion on this group applies to the whole group."
          : c.kind === "proximity"
            ? `Phrase slop resolves to ${c.slop}. Slop measures term movement, not characters.`
            : "The normalized term is emitted using the selected precise/raw mode.",
      ),
    );
  }
  function tree() {
    const r = result(),
      nodes = r.clauses;
    const children = (parent) =>
      nodes.map((c, i) => (c.parent === parent ? i : -1)).filter((i) => i >= 0);
    const positions = [];
    let slot = 0;
    let maxDepth = 0;
    function place(index, depth) {
      const list = children(index);
      maxDepth = Math.max(maxDepth, depth);
      const x = list.length
        ? list.map((i) => place(i, depth + 1)).reduce((a, b) => a + b, 0) /
          list.length
        : slot++ * 145 + 80;
      positions[index] = { x, y: 90 + depth * 90 };
      return x;
    }
    children(null).forEach((i) => place(i, 0));
    const width = Math.max(490, slot * 145 + 15),
      height = Math.max(300, 155 + maxDepth * 90);
    const drawing = svg("svg", {
      viewBox: `0 0 ${width} ${height}`,
      class: "tree",
      role: "group",
      "aria-label": "Parsed grouping diagram",
    });
    drawing.style.height = height + "px";
    const rootX = width / 2;
    const root = svg("g", { class: "root-node" });
    root.append(
      svg("circle", { cx: rootX, cy: 22, r: 3 }),
      svg("text", { x: rootX + 10, y: 25 }, "QUERY ROOT"),
    );
    drawing.append(root);
    const ancestors = new Set([selected]);
    let parent = nodes[selected]?.parent;
    while (parent !== null && parent !== undefined) {
      ancestors.add(parent);
      parent = nodes[parent].parent;
    }
    nodes.forEach((c, i) => {
      const p = c.parent === null ? { x: rootX, y: 22 } : positions[c.parent];
      const n = positions[i];
      drawing.append(
        svg("path", {
          class: `wire ${ancestors.has(i) ? "active" : ""}`,
          d: `M ${p.x} ${p.y + 20} V ${n.y - 42} H ${n.x} V ${n.y - 22}`,
        }),
      );
    });
    nodes.forEach((c, i) => {
      const p = positions[i];
      const node = svg("g", {
        class: `node ${c.negated ? "exclude" : ""} ${selected === i ? "selected" : ""}`,
        transform: `translate(${p.x},${p.y})`,
        role: "button",
        tabindex: 0,
        "aria-label": `Clause ${i + 1}: ${c.text ?? "group"}${c.negated ? " excluded" : ""}`,
        "aria-pressed": selected === i,
      });
      node.append(
        svg("rect", {
          x: -64,
          y: -23,
          width: 128,
          height: 49,
          rx: c.kind === "group" ? 2 : 8,
        }),
        svg(
          "text",
          { x: -54, y: -8, class: "node-kind" },
          `${String(i + 1).padStart(2, "0")} / ${c.kind.toUpperCase()}`,
        ),
        svg(
          "text",
          { x: -54, y: 12 },
          (c.text ?? "( group )").length > 17
            ? (c.text ?? "").slice(0, 16) + "…"
            : (c.text ?? "( group )"),
        ),
        svg(
          "text",
          { x: 0, y: -30, "text-anchor": "middle", class: "node-op" },
          [c.joiner, c.negated ? "NOT" : null].filter(Boolean).join(" ") || "",
        ),
      );
      const choose = () => {
        selected = i;
        renderStage();
        notes();
        document.querySelectorAll(".node")[i]?.focus({ preventScroll: true });
      };
      node.onclick = choose;
      node.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      };
      drawing.append(node);
    });
    return drawing;
  }
  function renderStage() {
    const area = $("#stage-panel"),
      r = result();
    area.replaceChildren();
    document
      .querySelectorAll("[data-stage]")
      .forEach((b) =>
        b.setAttribute("aria-selected", String(b.dataset.stage === stage)),
      );
    if (!r.valid && stage !== "normalize") {
      const panel = el("div", "error-pane");
      panel.append(
        el("h3", "", "A useful stop."),
        el("p", "", r.error.message),
        el("p", "", `Character ${r.error.position + 1} in normalized input`),
      );
      area.append(panel);
    } else if (stage === "structure") area.append(tree());
    else {
      const panel = el("div", "stage-explanation");
      panel.append(
        el(
          "span",
          "",
          stage === "normalize"
            ? "NFKC / NORMALIZED INPUT"
            : "EMITTED / QUERY_STRING",
        ),
        el("pre", "", stage === "normalize" ? r.normalized : r.query_string),
        el(
          "p",
          "",
          stage === "normalize"
            ? "Full-width forms are normalized before parsing. Operators retain their written order. The parser also trims outer whitespace and removes control characters U+0001–U+001A."
            : mode === 0
              ? "Every ordinary term is quoted. Proximity phrases carry their resolved slop."
              : "Ordinary terms pass through to Lucene. Proximity phrases are still quoted.",
        ),
      );
      area.append(panel);
    }
    $("#diagram-caption").textContent = r.valid
      ? `${r.clauses.length} CLAUSES / ${r.terms.length} TERMS · select a node`
      : "SYNTAX ERROR / NO OUTPUT";
  }
  function renderOutput() {
    $("#compiled").textContent =
      output() ?? "No compiled output — fix the source syntax first.";
    $("#copy").disabled = !result().valid;
    $("#filter").disabled = !result().valid;
    $("#copy-status").textContent = "";
  }
  function render() {
    const item = data[specimen];
    $("#specimen-title").textContent = item.title;
    $("#specimen-number").textContent =
      `SPECIMEN ${String(specimen + 1).padStart(2, "0")} / 08`;
    $("#source").textContent = item.input;
    $("#specimen-note").textContent = item.note;
    document
      .querySelectorAll("#specimens button")
      .forEach((b, i) =>
        b.setAttribute("aria-pressed", String(i === specimen)),
      );
    renderStage();
    notes();
    renderOutput();
  }
  document.querySelectorAll("[data-stage]").forEach(
    (b) =>
      (b.onclick = () => {
        stage = b.dataset.stage;
        renderStage();
      }),
  );
  $("#mode").onchange = (e) => {
    mode = Number(e.target.value);
    render();
  };
  $("#filter").onchange = renderOutput;
  $("#copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText(output());
      $("#copy-status").textContent = "Copied to clipboard.";
    } catch {
      $("#copy-status").textContent =
        "Select and copy the query above; clipboard access is unavailable.";
    }
  };
  $("#download").onclick = () => {
    const record = {
      specimen: data[specimen].id,
      input: data[specimen].input,
      precise: mode === 0,
      inspection: result(),
      filter:
        $("#filter").value === ""
          ? null
          : data[Number($("#filter").value)].input,
      query_string: output(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }),
    );
    const a = el("a");
    a.href = url;
    a.download = "query-inspection.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  try {
    document.documentElement.classList.toggle(
      "light",
      localStorage.getItem("atlas-theme") === "light",
    );
  } catch {}
  $("#theme").onclick = () => {
    const light = document.documentElement.classList.toggle("light");
    try {
      localStorage.setItem("atlas-theme", light ? "light" : "dark");
    } catch {}
  };
  render();
})();
