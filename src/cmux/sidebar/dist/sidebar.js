/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac, and the work each one keeps.
 *
 *   Manager   every session, sorted by what needs you (cmux Manager)
 *   Work      a search over the agent's tasks, every task at a glance, and its projects by state
 *
 * The workspace you're in picks the agent; the menu on Work picks another.
 *
 * Open      cmux right-sidebar set custom agentlayer
 * Check     cmux sidebar validate agentlayer
 *
 * Built from src/cmux/sidebar/ in the agentlayer plugin, where the comments explaining the code live.
 */

// node_modules/cmux-custom-manager/src/model.ts
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
var needsInputThenNewest = (first, second) => Number(second.agent.status === "needs_input") - Number(first.agent.status === "needs_input") || (second.agent.lastActivityAt ?? 0) - (first.agent.lastActivityAt ?? 0);
var bySection = (cards) => Object.fromEntries(ORDER.map((section) => [section, cards.filter((card) => card.section === section).toSorted(needsInputThenNewest)]));
var jump = (workspaceId, focusId) => focusId ? cmux("surface.focus", { surface_id: focusId, workspace_id: workspaceId }) : cmux("workspace.select", { workspace_id: workspaceId });

// node_modules/cmux-custom-manager/src/components.ts
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
var searchField = (placeholder, onEdit) => HStack([
  HStack({ spacing: 6 }, [
    Image("magnifyingglass").font(12).color("secondary"),
    TextField("", { placeholder, autofocus: false, onEdit: (text) => onEdit(text ?? "") })
  ]).paddingHorizontal(9).paddingVertical(6).background("#7f7f7f24").cornerRadius(8)
]).paddingHorizontal(4);
var sectionHeader = (section, count, folded, onTap) => HStack({ spacing: 6 }, [
  Text(SECTIONS[section].label).font(10).weight("bold").color(SECTIONS[section].color),
  Text(() => String(count())).font(10).monospaced().color("tertiary"),
  Spacer(),
  Image(() => folded() ? "chevron.right" : "chevron.down").font(9).weight("semibold").color("tertiary")
]).paddingHorizontal(10).paddingTop(10).paddingBottom(2).frame({ maxWidth: "infinity" }).cursor("pointer").onTap(onTap);
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
var subagentRow = (row) => {
  const child = () => row().child;
  return HStack({ spacing: 6 }, [
    Text("└").font(10).monospaced().color("tertiary").fixedSize(),
    Circle({ size: 5 }).fill(SECTIONS.running.color),
    Text(() => child().label || "subagent").font(11).color("secondary").lineLimit(1).truncation("tail"),
    Spacer({ minLength: 0 }),
    Text(() => fmtSpan(epoch() - (child().startedEpoch ?? epoch()))).font(10).monospaced().color("tertiary").fixedSize()
  ]).paddingLeading(26).paddingTrailing(10).paddingVertical(2).cornerRadius(6).hoverBackground("#7f7f7f1c").frame({ maxWidth: "infinity" }).onTap(() => jump(row().workspaceId, row().focusId));
};
var tally = (section, count) => HStack({ spacing: 4 }, [
  Circle({ size: 7 }).fill(SECTIONS[section].color),
  Text(() => String(count())).font(11).weight("semibold").monospaced().color(() => count() ? "secondary" : "quaternary")
]).fixedSize();

// node_modules/cmux-custom-manager/src/manager.ts
var manager = ({ header, trailing } = {}) => {
  const [query, setQuery] = signal("");
  const [groupFilter, setGroupFilter] = signal("");
  const [collapsed, setCollapsed] = signal(["ended"]);
  const toggleSection = (section) => setCollapsed(collapsed().includes(section) ? collapsed().filter((name) => name !== section) : [...collapsed(), section]);
  const groupChips = computed(() => {
    const withAgents = new Set(agentCards().map((card) => card.groupId));
    return (data.groups() ?? []).filter((group) => withAgents.has(group.id));
  });
  const effectiveGroupFilter = computed(() => groupChips().some((group) => group.id === groupFilter()) ? groupFilter() : "");
  const cards = computed(() => {
    const tokens = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return agentCards().filter((card) => !effectiveGroupFilter() || card.groupId === effectiveGroupFilter()).filter((card) => {
      const haystack = [card.title, card.searchText, card.workspaceTitle, card.group, card.folder, card.branch].join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  });
  const sections = computed(() => bySection(cards()));
  const entries = computed(() => ORDER.flatMap((section) => {
    const list = sections()[section];
    if (list.length === 0) {
      return [];
    }
    const header = { key: `h:${section}`, kind: "header", section, count: list.length };
    if (collapsed().includes(section)) {
      return [header];
    }
    return [
      header,
      ...list.flatMap((card) => [
        { ...card, kind: "card" },
        ...card.subagents.map((child) => ({
          key: `c:${card.key}:${child.id}`,
          kind: "child",
          child,
          workspaceId: card.workspaceId,
          focusId: card.focusId
        }))
      ])
    ];
  }));
  const row = (entry) => {
    switch (entry().kind) {
      case "header": {
        const header = entry;
        const { section } = header();
        return sectionHeader(section, () => header().count, () => collapsed().includes(section), () => toggleSection(section));
      }
      case "card":
        return cardRow(entry);
      case "child":
        return subagentRow(entry);
    }
  };
  return VStack({ spacing: 8 }, [
    HStack({ spacing: 12 }, [
      header ?? HStack({ spacing: 6 }, [
        Image("square.grid.2x2").font(12).color("accent"),
        Text("Manager").font(13).weight("semibold")
      ]).fixedSize(),
      Spacer({ minLength: 0 }),
      ...ORDER.filter((section) => section !== "ended").map((section) => tally(section, () => sections()[section].length)),
      ...trailing ? [trailing] : []
    ]).paddingHorizontal(4),
    ForEach({ items: () => groupChips().length ? ["chips"] : [], key: (item) => item }, () => HStack({ spacing: 4 }, [
      chip("All", () => !effectiveGroupFilter(), () => setGroupFilter("")),
      ForEach({ items: groupChips, key: (group) => group.id }, (group) => chip(() => group().name, () => effectiveGroupFilter() === group().id, () => setGroupFilter(effectiveGroupFilter() === group().id ? "" : group().id))),
      Spacer()
    ]).paddingHorizontal(4)),
    searchField("Search sessions…", setQuery),
    Divider(),
    VStack({ spacing: 4 }, [ForEach({ items: entries, key: (entry) => entry.key }, row)]),
    Text(() => entries().length === 0 ? query().trim() || effectiveGroupFilter() ? "No matches." : "No agents running in cmux." : "").font(11).color("tertiary").paddingHorizontal(10),
    Spacer()
  ]).paddingHorizontal(6);
};

// src/cmux/sidebar/due.ts
var DAY_MS = 86400000;
var dayNumber = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / DAY_MS : Number.NaN;
};
var dueLabel = (due, today) => {
  const days = dayNumber(due) - dayNumber(today);
  if (!due || Number.isNaN(days)) {
    return null;
  }
  if (days < 0) {
    return { text: `overdue ${-days}d`, tone: "overdue" };
  }
  if (days <= 1) {
    return { text: days === 0 ? "due today" : "due tomorrow", tone: "soon" };
  }
  return { text: `due in ${days}d`, tone: days <= 7 ? "soon" : "later" };
};
var BUCKETS = ["overdue", "today", "week", "month", "later", "someday"];
var dueBucket = (due, today) => {
  const days = dayNumber(due) - dayNumber(today);
  if (!due || Number.isNaN(days)) {
    return "someday";
  }
  if (days < 0) {
    return "overdue";
  }
  if (days === 0) {
    return "today";
  }
  return days <= 7 ? "week" : days <= 30 ? "month" : "later";
};
var isoDay = (epochSeconds) => {
  const date = new Date(epochSeconds * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// src/cmux/sidebar/data.ts
var SCHEMA = 3;
var SIDEBAR_NAME = "agentlayer";

// src/cmux/sidebar/style.ts
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
var SEGMENTS = 40;
var progressBar = (fraction, color) => {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * SEGMENTS);
  return HStack({ spacing: 0 }, Array.from({ length: SEGMENTS }, (_, index) => Rectangle().fill(index < filled ? color : "#7f7f7f33").frame({ maxWidth: "infinity", height: 4 }))).cornerRadius(2);
};
var groupTitle = (title, count) => HStack({ spacing: 4 }, [
  Text(title.toUpperCase()).font(10).weight("semibold").color("tertiary"),
  Text(String(count)).font(10).monospaced().color("quaternary"),
  Spacer({ minLength: 0 })
]).paddingHorizontal(4);
var toolIcon = (symbol, help, onTap) => Image(symbol).font(11).color("secondary").padding(5).cornerRadius(6).hoverBackground("#7f7f7f3d").cursor("pointer").help(help).onTap(onTap);
var reloadButton = () => toolIcon("arrow.clockwise", "Reload the sidebar", () => cmux("sidebar.custom.reload", { name: SIDEBAR_NAME }));
var note = (text) => Text(text).font(11).color("tertiary").paddingHorizontal(10);
var tabIcon = (symbol, help, active, onTap) => Image(symbol).font(12).color(() => active() ? "accent" : "secondary").padding(5).background(() => active() ? "#7f7f7f3d" : null).cornerRadius(6).hoverBackground("#7f7f7f3d").cursor("pointer").help(help).onTap(onTap);

// src/cmux/sidebar/tasks.ts
var STATUS = {
  active: { symbol: "circle.fill", color: "#34C759" },
  blocked: { symbol: "exclamationmark.circle.fill", color: "#FF453A" },
  open: { symbol: "circle", color: "#8E8E93" }
};
var statusOf = (status) => STATUS[status] ?? { symbol: "circle", color: "#8E8E93" };
var TONE = { overdue: "#FF453A", soon: "#FF9F0A", later: "tertiary" };
var URGENT = new Set(["P0", "P1"]);
var today = computed(() => isoDay(data.clock()?.epoch ?? Date.now() / 1000));
var statusIcon = (status, size = 7) => Image(statusOf(status).symbol).font(size).color(statusOf(status).color);
var count = (amount, status) => amount ? [
  HStack({ spacing: 3 }, [
    statusIcon(status, 6),
    Text(String(amount)).font(10).weight("medium").monospaced().color("secondary")
  ]).fixedSize()
] : [];
var taskMeta = (task, projectColor) => HStack({ spacing: 6 }, [
  statusIcon(task.status),
  Text(task.id).font(10).monospaced().color(projectColor ?? "tertiary"),
  Text(task.priority).font(10).weight("semibold").monospaced().color(URGENT.has(task.priority) ? "#FF9F0A" : "tertiary"),
  Text(() => dueLabel(task.due, today())?.text ?? "").font(10).color(() => TONE[dueLabel(task.due, today())?.tone ?? "later"]),
  Spacer({ minLength: 0 }),
  ...task.comments ? [
    HStack({ spacing: 2 }, [
      Image("bubble.left").font(9).color("tertiary"),
      Text(String(task.comments)).font(10).monospaced().color("tertiary")
    ]).fixedSize()
  ] : []
]);
var taskRow = (task, projectColor) => VStack({ spacing: 2, alignment: "leading" }, [
  Text(task.title).font(12).lineLimit(3).truncation("tail"),
  taskMeta(task, projectColor)
]).paddingHorizontal(4).paddingVertical(5).cornerRadius(8).hoverBackground("#7f7f7f26").cursor("pointer").frame({ maxWidth: "infinity", alignment: "leading" }).onTap(() => cmux("file.open", { path: task.path }));

// src/cmux/sidebar/view.ts
var homeLabel = (home) => {
  const entry = DATA.homes[home];
  return entry ? `${entry.emoji} ${entry.name}`.trim() : home;
};
var scopedPage = (home, ready) => {
  const view = computed(() => {
    const path = home();
    const entry = path ? DATA.homes[path] : undefined;
    return path && entry ? { path, entry, current: entry.schema === SCHEMA } : null;
  });
  const showing = (current) => () => [view()].filter((item) => item?.current === current);
  return VStack({ spacing: 0 }, [
    ForEach({ items: showing(true), key: (item) => item.path }, (item) => ready(item().path, item().entry)),
    ForEach({ items: showing(false), key: (item) => item.path }, (item) => note(`${homeLabel(item().path)} needs its agent updated to show here.`)),
    ForEach({ items: () => view() ? [] : ["none"], key: (item) => item }, () => note("No agent has joined this sidebar yet. In an agent’s home, run its cmux sidebar install."))
  ]);
};

// src/cmux/sidebar/pages/work.ts
var ACCENT = "#0A84FF";
var CARD = "#7f7f7f12";
var open = (target) => target.kind === "page" ? cmux("browser.tab.new", { url: target.url }) : cmux("file.open", { path: target.path });
var linkRow = ({ icon, title, target }) => HStack({ spacing: 6 }, [
  Text(icon).font(11).frame({ width: 14 }),
  Text(title).font(11).color("secondary").lineLimit(1).truncation("tail"),
  Spacer({ minLength: 0 })
]).paddingHorizontal(4).paddingVertical(2).cornerRadius(6).hoverBackground("#7f7f7f26").cursor("pointer").onTap(() => open(target));
var roadmapLink = (url) => ({ title: "Roadmap", icon: "\uD83D\uDDFA️", target: { kind: "page", url } });
var chevron = (expanded) => Image(() => expanded() ? "chevron.down" : "chevron.right").font(9).weight("semibold").color("tertiary");
var card = (view) => view.paddingHorizontal(10).paddingVertical(8).background(CARD).cornerRadius(10);
var fraction = (done, live) => done + live ? done / (done + live) : 0;
var AGENDA = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  month: "This month",
  later: "Later"
};
var listedTasks = (entry) => entry.projects.flatMap((project) => project.tasks.map((task) => ({ task, color: hueColor(project.hue) })));
var agenda = (listed, day) => {
  const waiting = listed.filter(({ task }) => task.status !== "active");
  return [
    { title: "In flight", tasks: listed.filter(({ task }) => task.status === "active") },
    ...BUCKETS.flatMap((bucket) => {
      const title = AGENDA[bucket];
      return title ? [{ title, tasks: waiting.filter(({ task }) => dueBucket(task.due, day) === bucket) }] : [];
    })
  ].filter((group) => group.tasks.length);
};
var dueTally = (amount, label, color) => Text(() => amount() ? `${amount()} ${label}` : "").font(10).weight("semibold").color(color);
var tasksCard = (entry) => {
  const [expanded, setExpanded] = signal(false);
  const listed = listedTasks(entry);
  const total = (field) => entry.projects.reduce((sum, project) => sum + project[field], 0);
  const tone = (wanted) => () => listed.filter(({ task }) => dueLabel(task.due, today())?.tone === wanted).length;
  const groups = computed(() => agenda(listed, today()));
  return card(VStack({ spacing: 6 }, [
    VStack({ spacing: 6 }, [
      HStack({ spacing: 7 }, [
        Image("checklist").font(11).color(ACCENT),
        Text("Tasks").font(12).weight("semibold"),
        Spacer({ minLength: 4 }),
        ...count(total("active"), "active"),
        ...count(total("blocked"), "blocked"),
        ...count(total("open"), "open"),
        chevron(expanded)
      ]),
      progressBar(fraction(total("done"), total("active") + total("blocked") + total("open")), ACCENT),
      HStack({ spacing: 8 }, [
        dueTally(tone("overdue"), "overdue", "#FF453A"),
        dueTally(tone("soon"), "due this week", "#FF9F0A"),
        Spacer({ minLength: 0 })
      ])
    ]).cursor("pointer").onTap(() => setExpanded(!expanded())),
    ForEach({ items: () => expanded() ? groups() : [], key: (group) => group.title }, (group) => VStack({ spacing: 1 }, [
      groupTitle(group().title, group().tasks.length).paddingTop(4),
      ForEach({ items: () => group().tasks, key: (item) => item.task.id }, (item) => taskRow(item().task, item().color))
    ]))
  ]));
};
var projectCard = (item) => {
  const project = item();
  const [expanded, setExpanded] = signal(false);
  const color = hueColor(project.hue);
  const next = project.tasks[0];
  const links = [...project.roadmap ? [roadmapLink(project.roadmap)] : [], ...project.pins];
  return card(VStack({ spacing: 6 }, [
    VStack({ spacing: 6 }, [
      HStack({ spacing: 7 }, [
        Circle({ size: 8 }).fill(color),
        Text(project.slug).font(12).weight("semibold").lineLimit(1).truncation("tail"),
        Spacer({ minLength: 4 }),
        ...count(project.active, "active"),
        ...count(project.blocked, "blocked"),
        ...count(project.open, "open"),
        ...links.length ? [Image("pin.fill").font(8).color("tertiary").help(`${links.length} pinned`)] : [],
        chevron(expanded)
      ]),
      progressBar(fraction(project.done, project.active + project.blocked + project.open), color),
      ForEach({ items: () => next && !expanded() ? [next] : [], key: (task) => task.id }, (task) => HStack({ spacing: 6 }, [
        statusIcon(task().status),
        Text(task().title).font(11).color("secondary").lineLimit(1).truncation("tail"),
        Spacer({ minLength: 0 })
      ]))
    ]).cursor("pointer").onTap(() => setExpanded(!expanded())),
    VStack({ spacing: 0 }, [
      ForEach({ items: () => expanded() ? links : [], key: (link) => link.title }, (link) => linkRow(link()))
    ]),
    VStack({ spacing: 1 }, [
      ForEach({ items: () => expanded() ? project.tasks : [], key: (task) => task.id }, (task) => taskRow(task()))
    ])
  ])).frame({ maxWidth: "infinity" });
};
var STATES = [
  { title: "At work", holds: (project) => project.active > 0 },
  { title: "Blocked", holds: (project) => !project.active && project.blocked > 0 },
  { title: "Quiet", holds: (project) => !project.active && !project.blocked }
];
var stateGroup = (title, projects) => {
  const [expanded, setExpanded] = signal(true);
  return VStack({ spacing: 6 }, [
    HStack({ spacing: 4 }, [groupTitle(title, projects.length), chevron(expanded)]).paddingTrailing(4).cursor("pointer").onTap(() => setExpanded(!expanded())),
    ForEach({ items: () => expanded() ? projects : [], key: (project) => project.slug }, projectCard)
  ]);
};
var matches = (listed, query) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listed.filter(({ task }) => {
    const haystack = `${task.title} ${task.id}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
};
var workBody = (entry) => {
  const [query, setQuery] = signal("");
  const listed = listedTasks(entry);
  const found = computed(() => matches(listed, query()));
  const searching = () => query().trim() !== "";
  return VStack({ spacing: 10 }, [
    searchField("Search tasks…", setQuery),
    ForEach({ items: () => searching() ? ["results"] : [], key: (name) => name }, () => VStack({ spacing: 1 }, [
      ForEach({ items: found, key: (item) => item.task.id }, (item) => taskRow(item().task, item().color)),
      Text(() => found().length ? "" : "No matching tasks.").font(11).color("tertiary").paddingHorizontal(4)
    ])),
    ForEach({ items: () => searching() ? [] : ["browse"], key: (name) => name }, () => VStack({ spacing: 10 }, [
      tasksCard(entry),
      ...STATES.flatMap(({ title, holds }) => {
        const projects = entry.projects.filter(holds);
        return projects.length ? [stateGroup(title, projects)] : [];
      }),
      ...entry.projects.length ? [] : [note("No projects yet.")]
    ]))
  ]);
};
var workPage = ({ tabs, home, homes, pick }) => {
  const entry = () => {
    const path = home();
    return path ? DATA.homes[path] : undefined;
  };
  return VStack({ spacing: 8 }, [
    HStack({ spacing: 2 }, [
      tabs,
      Spacer({ minLength: 4 }),
      ForEach({ items: () => entry() ? [home() ?? ""] : [], key: (path) => path }, (path) => {
        const current = DATA.homes[path()];
        return HStack({ spacing: 2 }, [
          ...current ? [
            toolIcon("square.grid.3x3", "Dashboard", () => cmux("browser.tab.new", { url: `${current.dashboard}#today` }))
          ] : [],
          ...current?.roadmap ? [toolIcon("map", "Roadmap", () => cmux("browser.tab.new", { url: current.roadmap ?? "" }))] : []
        ]);
      }),
      ...homes.length > 1 ? [
        Menu(() => homeLabel(home() ?? ""), homes.map((path) => Button(homeLabel(path), () => pick(path))))
      ] : [],
      reloadButton()
    ]),
    scopedPage(home, (_path, current) => workBody(current))
  ]).paddingHorizontal(6);
};

// src/cmux/sidebar/scope.ts
var homeOf = (homes, path) => path ? homes.filter((home) => path === home || path.startsWith(`${home}/`)).toSorted((a, b) => b.length - a.length)[0] : undefined;
var newestHome = (homes, agents = []) => agents.toSorted((a, b) => b.lastActivityAt - a.lastActivityAt).map((agent) => homeOf(homes, agent.directory)).find((home) => home !== undefined);
var scopedHome = (homes, workspaces, pin) => {
  const selected = workspaces.find((workspace) => workspace.selected);
  const picked = pin && selected && pin.workspaceId === selected.id && homes.includes(pin.home) ? pin.home : undefined;
  return picked ?? homeOf(homes, selected?.directory) ?? newestHome(homes, selected?.agents) ?? newestHome(homes, workspaces.flatMap((workspace) => workspace.agents ?? [])) ?? homes[0];
};

// src/cmux/sidebar/main.ts
var app = () => {
  const homes = Object.keys(DATA.homes);
  const [tab, setTab] = signal("manager");
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
  const tabs = () => HStack({ spacing: 2 }, [
    tabIcon("square.grid.2x2", "Manager", () => tab() === "manager", () => setTab("manager")),
    tabIcon("square.stack.3d.up.fill", "Work", () => tab() === "work", () => setTab("work"))
  ]).padding(2).background("#7f7f7f1f").cornerRadius(8).fixedSize();
  return VStack({ spacing: 8 }, [
    ForEach({ items: () => [tab()], key: (name) => name }, (name) => name() === "manager" ? manager({ header: tabs(), trailing: reloadButton() }) : workPage({
      tabs: tabs(),
      home: current,
      homes,
      pick: (home) => setPin({ home, workspaceId: selectedId() })
    })),
    Spacer()
  ]);
};
sidebar(app);
