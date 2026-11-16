/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac: who needs you, and a tap to what each one keeps.
 * The workspace you're in picks the agent; the chips on top pick another.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

// node_modules/cmux-custom-dashboard/src/model.ts
var RECENT_SECS = 60 * 60;
var ENDED_SECS = 24 * 60 * 60;
var SECTIONS = {
  needs: { label: "NEEDS YOU", color: "#FF9F0A" },
  running: { label: "RUNNING", color: "#34C759" },
  recent: { label: "RECENT", color: "#0A84FF" },
  idle: { label: "IDLE", color: "#8E8E93" },
  ended: { label: "ENDED", color: "#8E8E9366" }
};
var ORDER = Object.keys(SECTIONS);
var epoch = () => data.clock()?.epoch ?? 0;
var minute = computed(() => Math.floor(epoch() / 60));
var fmtSpan = (secs) => {
  const total = Math.max(0, Math.floor(secs));
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${Math.floor(hours / 24)}d`;
};
var lastSegment = (path) => path.split("/").filter(Boolean).at(-1) ?? "";
var isProse = (text) => !!text && !text.trimStart().startsWith("<");
var sectionOf = (agent, subagents, unread, now) => {
  if (agent.status === "needs_input") {
    return "needs";
  }
  if (agent.status === "working" || subagents.length > 0) {
    return "running";
  }
  if (agent.status === "ended") {
    return now - (agent.lastActivityAt ?? 0) <= ENDED_SECS ? "ended" : null;
  }
  if (unread) {
    return "needs";
  }
  return now - (agent.lastActivityAt ?? 0) <= RECENT_SECS ? "recent" : "idle";
};
var agentCards = computed(() => {
  const now = minute() * 60;
  const groupNames = new Map((data.groups() ?? []).map((group) => [group.id, group.name]));
  return (data.workspaces() ?? []).flatMap((workspace) => (workspace.agents ?? []).flatMap((agent) => {
    const tab = (workspace.tabs ?? []).find((item) => item.id === agent.panelId);
    const subagents = (agent.children ?? []).filter((child) => child.running);
    const section = sectionOf(agent, subagents, Boolean(tab?.hasUnread), now);
    if (section === null) {
      return [];
    }
    const title = tab?.title || agent.title || agent.name;
    const prompts = [tab?.latestPrompt, agent.title].filter(isProse);
    const groupId = workspace.group ?? "";
    return [
      {
        key: `${workspace.id}:${agent.id}`,
        section,
        agent,
        subagents,
        workspaceId: workspace.id,
        workspaceTitle: workspace.title ?? "",
        workspaceColor: workspace.color ?? "",
        focusId: tab?.surfaceId ?? "",
        groupId,
        group: groupNames.get(groupId) ?? "",
        folder: lastSegment(agent.directory ?? tab?.directory ?? workspace.directory),
        branch: tab?.branch ?? workspace.branch ?? "",
        title,
        summary: prompts.find((text) => text !== title) ?? "",
        searchText: prompts.join(" ")
      }
    ];
  }));
});
var jump = (workspaceId, focusId) => focusId ? cmux("surface.focus", { surface_id: focusId, workspace_id: workspaceId }) : cmux("workspace.select", { workspace_id: workspaceId });

// node_modules/cmux-custom-dashboard/src/components.ts
var YOUR_MOVE = "#FFD60A";
var MAIN_BRANCH = /^(main|master)$/;
var dotColor = (card) => card.section === "needs" && card.agent.status !== "needs_input" ? YOUR_MOVE : SECTIONS[card.section].color;
var timeText = (agent) => {
  const live = agent.status === "working" || agent.status === "needs_input";
  const start = live && agent.sinceEpoch || agent.lastActivityAt;
  return start ? fmtSpan(epoch() - start) : "";
};
var badgesOf = (card) => [
  card.subagents.length > 0 && {
    key: "subagents",
    text: String(card.subagents.length),
    icon: "person.2.fill",
    fg: SECTIONS.running.color,
    bg: `${SECTIONS.running.color}26`,
    flexible: false
  },
  card.workspaceTitle && {
    key: "workspace",
    text: card.workspaceTitle,
    icon: "circle.fill",
    fg: card.workspaceColor || "secondary",
    bg: card.workspaceColor ? `${card.workspaceColor}2e` : "#7f7f7f26",
    flexible: false
  },
  card.branch && !MAIN_BRANCH.test(card.branch) && {
    key: "branch",
    text: card.branch,
    icon: "arrow.triangle.branch",
    fg: "green",
    bg: "#34C7591f",
    flexible: true
  },
  card.folder && card.folder !== card.workspaceTitle && {
    key: "folder",
    text: card.folder,
    icon: "folder",
    fg: "secondary",
    bg: "#7f7f7f1f",
    flexible: true
  }
].filter((item) => typeof item === "object");
var badge = (item) => HStack({ spacing: 3 }, [
  Image(() => item().icon).font(8).color(() => item().fg),
  Text(() => item().text).font(10).weight("medium").color(() => item().fg).lineLimit(1).truncation("tail")
]).paddingHorizontal(6).paddingVertical(2).background(() => item().bg).cornerRadius(5).fixedSize(() => item().flexible ? null : "horizontal");
var chip = (label, active, onTap) => Text(label).font(11).weight("semibold").paddingHorizontal(8).paddingVertical(3).cornerRadius(6).color(() => active() ? "primary" : "tertiary").background(() => active() ? "#7f7f7f3d" : null).hoverBackground("#7f7f7f3d").cursor("pointer").fixedSize("horizontal").onTap(onTap);
var cardRow = (card) => VStack({ spacing: 4 }, [
  HStack({ spacing: 7 }, [
    Circle({ size: 7 }).fill(() => dotColor(card())),
    Text(() => card().title).font(13).weight("semibold").color(() => card().section === "idle" || card().section === "ended" ? "secondary" : "primary").lineLimit(1).truncation("tail"),
    Spacer({ minLength: 4 }),
    Text(() => timeText(card().agent)).font(10).monospaced().color("tertiary").fixedSize()
  ]),
  HStack({ spacing: 4 }, [ForEach({ items: () => badgesOf(card()), key: (item) => item.key }, badge)]).paddingLeading(14).frame({ maxWidth: "infinity" }),
  ForEach({ items: () => card().summary ? [card().summary] : [], key: () => "summary" }, (summary) => Text(() => summary()).font(11).color("tertiary").lineLimit(2).truncation("tail").paddingLeading(14))
]).paddingHorizontal(10).paddingVertical(8).cornerRadius(10).background(() => card().agent.status === "needs_input" ? "#FF9F0A1f" : "#7f7f7f0d").hoverBackground("#7f7f7f26").cursor("pointer").frame({ maxWidth: "infinity" }).onTap(() => jump(card().workspaceId, card().focusId));

// src/cmux/sidebar/shell.ts
var shellQuote = (text) => `'${text.replaceAll("'", `'\\''`)}'`;
var oneLine = (text) => text.replace(/[\r\n]+/g, " ");
var startCommand = (home, launcher) => `cd ${shellQuote(home)} && ${launcher}`;

// src/cmux/sidebar/ask.ts
var STATUS = {
  idle: () => "",
  opening: (name) => `Opening a tab for ${name}…`,
  starting: (name) => `Starting ${name}…`,
  drafted: (name) => `Typed in for ${name}. Press Enter in that tab to send it.`
};
var workspaceById = (id) => (data.workspaces() ?? []).find((workspace) => workspace.id === id);
var selected = () => (data.workspaces() ?? []).find((workspace) => workspace.selected);
var send = (workspaceId, surfaceId, text) => cmux("surface.send_text", { surface_id: surfaceId, workspace_id: workspaceId, text });
var createAsk = () => {
  const [launch, setLaunch] = signal({ stage: "idle" });
  computed(() => {
    const state = launch();
    if (state.stage !== "opening") {
      return;
    }
    const tab = (workspaceById(state.workspaceId)?.tabs ?? []).find((item) => !state.before.includes(item.id) && item.surfaceId);
    if (tab?.surfaceId) {
      setLaunch({ ...state, stage: "starting", tabId: tab.id, surfaceId: tab.surfaceId });
      send(state.workspaceId, tab.surfaceId, `${state.command}
`);
    }
  });
  computed(() => {
    const state = launch();
    if (state.stage !== "starting") {
      return;
    }
    const agent = (workspaceById(state.workspaceId)?.agents ?? []).find((item) => item.panelId === state.tabId);
    if (agent?.status === "idle") {
      setLaunch({ stage: "drafted", name: state.name });
      send(state.workspaceId, state.surfaceId, state.prompt);
      cmux("surface.focus", { surface_id: state.surfaceId, workspace_id: state.workspaceId });
    }
  });
  const draftTarget = computed(() => {
    const workspace = selected();
    const tab = workspace?.tabs.find((item) => item.focused);
    const agent = workspace?.agents?.find((item) => item.panelId === tab?.id);
    return workspace && tab?.surfaceId && agent && agent.status !== "needs_input" && agent.status !== "ended" ? { workspaceId: workspace.id, surfaceId: tab.surfaceId } : null;
  });
  return {
    status: () => {
      const state = launch();
      return state.stage === "idle" ? "" : STATUS[state.stage](state.name);
    },
    canDraft: () => draftTarget() !== null,
    newChat: (home, entry, prompt) => {
      const workspace = selected();
      if (!workspace) {
        return;
      }
      setLaunch({
        stage: "opening",
        workspaceId: workspace.id,
        before: workspace.tabs.map((tab) => tab.id),
        command: startCommand(home, entry.launcher),
        prompt: oneLine(prompt),
        name: entry.name
      });
      cmux("surface.create", { type: "terminal", workspace_id: workspace.id });
    },
    draftHere: (prompt) => {
      const target = draftTarget();
      if (target && prompt.trim()) {
        send(target.workspaceId, target.surfaceId, oneLine(prompt));
        cmux("surface.focus", { surface_id: target.surfaceId, workspace_id: target.workspaceId });
      }
    }
  };
};

// src/cmux/sidebar/scope.ts
var homeOf = (homes, path) => path ? homes.filter((home) => path === home || path.startsWith(`${home}/`)).toSorted((a, b) => b.length - a.length)[0] : undefined;
var newestHome = (homes, agents = []) => agents.toSorted((a, b) => b.lastActivityAt - a.lastActivityAt).map((agent) => homeOf(homes, agent.directory)).find((home) => home !== undefined);
var scopedHome = (homes, workspaces, pin) => {
  const selected = workspaces.find((workspace) => workspace.selected);
  const picked = pin && selected && pin.workspaceId === selected.id && homes.includes(pin.home) ? pin.home : undefined;
  return picked ?? homeOf(homes, selected?.directory) ?? newestHome(homes, selected?.agents) ?? newestHome(homes, workspaces.flatMap((workspace) => workspace.agents ?? [])) ?? homes[0];
};

// src/cmux/sidebar/style.ts
var NEEDS_COLOR = "#FF9F0A";
var hueColor = (hue) => {
  const saturation = 0.55;
  const lightness = 0.62;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset) => {
    const sector = (offset + hue / 30) % 12;
    const level = lightness - chroma * Math.max(-1, Math.min(sector - 3, 9 - sector, 1));
    return Math.round(level * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};
var label = (text, count) => HStack({ spacing: 6 }, [
  Text(text).font(10).weight("bold").color("secondary"),
  Text(() => count ? String(count()) : "").font(10).monospaced().color("tertiary"),
  Spacer()
]).paddingHorizontal(10).paddingTop(8).frame({ maxWidth: "infinity" });
var note = (text) => Text(text).font(11).color("tertiary").paddingHorizontal(10);
var row = (icon, title, trailing, onTap) => HStack({ spacing: 8 }, [
  icon,
  Text(title).font(12).lineLimit(1).truncation("tail"),
  Spacer({ minLength: 4 }),
  Image(trailing).font(9).color("tertiary")
]).paddingHorizontal(10).paddingVertical(5).cornerRadius(8).hoverBackground("#7f7f7f26").cursor("pointer").frame({ maxWidth: "infinity" }).onTap(onTap);
var symbol = (name) => Image(name).font(11).color("secondary").frame({ width: 16 });
var open = (link) => link.kind === "md" ? cmux("markdown.open", { path: link.target }) : cmux("browser.open_split", { url: link.target });

// src/cmux/sidebar/pages/agents.ts
var byUrgency = (first, second) => ORDER.indexOf(first.section) - ORDER.indexOf(second.section) || (second.agent.lastActivityAt ?? 0) - (first.agent.lastActivityAt ?? 0);
var agentsPage = (homes) => {
  const groups = computed(() => {
    const cards = agentCards();
    const titled = homes.map((home) => ({
      key: home,
      title: `${DATA.homes[home]?.emoji ?? ""} ${DATA.homes[home]?.name ?? home}`.trim(),
      cards: cards.filter((card) => homeOf(homes, card.agent.directory) === home)
    }));
    const other = { key: "other", title: "Other", cards: cards.filter((card) => !homeOf(homes, card.agent.directory)) };
    return [...titled, other].filter((group) => group.cards.length).map((group) => ({ ...group, cards: group.cards.toSorted(byUrgency) }));
  });
  return VStack({ spacing: 4 }, [
    ForEach({ items: groups, key: (group) => group.key }, (group) => VStack({ spacing: 4 }, [
      label(group().title, () => group().cards.length),
      ForEach({ items: () => group().cards, key: (card) => card.key }, cardRow)
    ])),
    ForEach({ items: () => groups().length ? [] : ["empty"], key: (item) => item }, () => note("No agent sessions in cmux right now."))
  ]);
};

// src/cmux/sidebar/data.ts
var SCHEMA = 1;

// src/cmux/sidebar/pages/ask.ts
var PROMPTS = [
  { title: "Brief me", symbolName: "sun.max", prompt: "Brief me" },
  { title: "Plan my day", symbolName: "calendar", prompt: "Plan my day" },
  { title: "What’s stale?", symbolName: "clock.arrow.circlepath", prompt: "What has gone stale?" },
  { title: "Check support", symbolName: "lifepreserver", prompt: "Check the support queue" },
  { title: "Capture a note", symbolName: "square.and.pencil", prompt: "Capture this note: " },
  { title: "Wrap up the day", symbolName: "moon", prompt: "Wrap up the day" }
];
var button = (title, enabled, onTap) => Text(title).font(12).weight("medium").paddingHorizontal(10).paddingVertical(5).background("#7f7f7f24").hoverBackground("#7f7f7f3d").cornerRadius(6).opacity(() => enabled() ? 1 : 0.4).cursor("pointer").onTap(onTap);
var body = (path, entry, ask) => {
  const [text, setText] = signal("");
  const hasText = () => text().trim() !== "";
  return VStack({ spacing: 2 }, [
    note(`Each opens a new chat with ${entry.name} and types the request in. Press Enter there to send it.`),
    label("ASK"),
    ...PROMPTS.map((item) => row(symbol(item.symbolName), item.title, "plus.bubble", () => ask.newChat(path, entry, item.prompt))),
    label("YOUR OWN"),
    HStack([
      TextField("", { placeholder: `Ask ${entry.name}…`, autofocus: false, onEdit: (typed) => setText(typed ?? "") })
    ]).paddingHorizontal(9).paddingVertical(6).background("#7f7f7f24").cornerRadius(8).paddingHorizontal(4),
    HStack({ spacing: 6 }, [
      button("New chat", hasText, () => hasText() && ask.newChat(path, entry, text())),
      button("Draft here", () => hasText() && ask.canDraft(), () => ask.draftHere(text())),
      Spacer()
    ]).paddingHorizontal(4).paddingTop(4),
    Text(ask.status).font(11).color("secondary").paddingHorizontal(10).paddingTop(4)
  ]);
};
var askPage = (ask, home) => VStack({ spacing: 0 }, [
  ForEach({
    items: () => {
      const path = home();
      const entry = path ? DATA.homes[path] : undefined;
      return path && entry?.schema === SCHEMA ? [{ path, entry }] : [];
    },
    key: (item) => item.path
  }, (item) => body(item().path, item().entry, ask)),
  ForEach({ items: () => home() ? [] : ["empty"], key: (item) => item }, () => note("No agent has joined this sidebar yet."))
]);

// src/cmux/sidebar/pages/home.ts
var newestFirst = (first, second) => (second.agent.lastActivityAt ?? 0) - (first.agent.lastActivityAt ?? 0);
var body2 = ({ path, entry }, homes) => {
  const needs = computed(() => agentCards().filter((card) => card.section === "needs" && homeOf(homes, card.agent.directory) === path).toSorted(newestFirst));
  const roadmap = entry.roadmap ? [{ title: "Roadmap", kind: "html", target: entry.roadmap, symbolName: "map" }] : [];
  const pages = [
    { title: "Today", kind: "html", target: `${entry.dashboard}#today`, symbolName: "sun.max" },
    { title: "Tasks", kind: "html", target: `${entry.dashboard}#tasks`, symbolName: "checklist" },
    ...roadmap
  ];
  return VStack({ spacing: 2 }, [
    HStack({ spacing: 8 }, [Text(entry.emoji).font(18), Text(entry.name).font(15).weight("semibold"), Spacer()]).paddingHorizontal(10).paddingBottom(4),
    label("NEEDS YOU", () => needs().length),
    VStack({ spacing: 4 }, [ForEach({ items: needs, key: (card) => card.key }, cardRow)]),
    ForEach({ items: () => needs().length ? [] : ["calm"], key: (item) => item }, () => note("Nothing needs you.")),
    label("OPEN"),
    ...pages.map((link) => row(symbol(link.symbolName), link.title, "arrow.up.right", () => open(link))),
    ...entry.projects.length ? [
      label("PROJECTS"),
      ...entry.projects.map((project) => row(Circle({ size: 8 }).fill(hueColor(project.hue)).frame({ width: 16 }), project.slug, "chevron.right", () => open({ kind: "md", target: project.readme })))
    ] : [],
    ...entry.pinned.length ? [
      label("PINNED"),
      ...entry.pinned.map((link) => row(symbol(link.kind === "md" ? "doc.text" : "globe"), link.title, "arrow.up.right", () => open(link)))
    ] : []
  ]);
};
var homePage = (home, homes) => {
  const scoped = computed(() => {
    const path = home();
    const entry = path ? DATA.homes[path] : undefined;
    return path && entry ? { path, entry } : null;
  });
  return VStack({ spacing: 0 }, [
    ForEach({
      items: () => [scoped()].filter((item) => item?.entry.schema === SCHEMA),
      key: (item) => item.path
    }, (item) => body2(item(), homes)),
    ForEach({
      items: () => [scoped()].filter((item) => item !== null && item.entry.schema !== SCHEMA),
      key: (item) => `update:${item.path}`
    }, (item) => note(`${item().entry.emoji} ${item().entry.name} needs its agent updated to show here.`)),
    ForEach({ items: () => scoped() ? [] : ["empty"], key: (item) => item }, () => note("No agent has joined this sidebar yet. In an agent’s home, run its cmux sidebar install."))
  ]);
};

// src/cmux/sidebar/main.ts
var PAGES = ["Home", "Agents", "Ask"];
var app = () => {
  const homes = Object.keys(DATA.homes);
  const [page, setPage] = signal("Home");
  const [pin, setPin] = signal(null);
  const workspaces = () => data.workspaces() ?? [];
  const selectedId = computed(() => workspaces().find((workspace) => workspace.selected)?.id ?? "");
  computed(() => {
    const picked = pin();
    if (picked && picked.workspaceId !== selectedId()) {
      setPin(null);
    }
  });
  const current = computed(() => scopedHome(homes, workspaces(), pin()));
  const needsIn = (home) => agentCards().filter((card) => card.section === "needs" && homeOf(homes, card.agent.directory) === home).length;
  const ask = createAsk();
  const views = {
    Home: () => homePage(current, homes),
    Agents: () => agentsPage(homes),
    Ask: () => askPage(ask, current)
  };
  const agentChip = (home) => {
    const entry = DATA.homes[home()];
    const active = () => current() === home();
    return HStack({ spacing: 4 }, [
      Text(`${entry?.emoji ?? ""} ${entry?.name ?? ""}`.trim()).font(11).weight("semibold").color(() => active() ? "primary" : "secondary"),
      ForEach({ items: () => [needsIn(home())].filter(Boolean), key: () => "needs" }, (count) => Text(() => String(count())).font(9).weight("bold").monospaced().color(NEEDS_COLOR))
    ]).paddingHorizontal(8).paddingVertical(3).cornerRadius(6).background(() => active() ? "#7f7f7f3d" : null).hoverBackground("#7f7f7f3d").cursor("pointer").fixedSize("horizontal").onTap(() => setPin({ home: home(), workspaceId: selectedId() }));
  };
  return VStack({ spacing: 8 }, [
    HStack({ spacing: 6 }, [
      Image("square.stack.3d.up.fill").font(12).color("accent"),
      Text("AgentLayer").font(13).weight("semibold"),
      Spacer()
    ]).paddingHorizontal(10),
    HStack({ spacing: 4 }, [ForEach({ items: homes, key: (home) => home }, agentChip), Spacer()]).paddingHorizontal(6),
    HStack({ spacing: 4 }, [
      ...PAGES.map((name) => chip(name, () => page() === name, () => setPage(name))),
      Spacer()
    ]).paddingHorizontal(6),
    Divider(),
    ForEach({ items: () => [page()], key: (name) => name }, (name) => views[name()]()),
    Spacer()
  ]).paddingHorizontal(6);
};
sidebar(app);
