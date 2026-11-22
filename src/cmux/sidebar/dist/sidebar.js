/*
 * AgentLayer · cmux sidebar
 * Every agent on this Mac, and the work each one keeps.
 *
 *   Manager   what each agent proposes, then every session, sorted by what needs you (cmux Manager)
 *   Agents    a chip per agent, then the chosen agent's Projects (its tasks and projects by state), Reports (its pins
 *             and newest reports by day), Recent (the files changed lately, by day) and Goals (the year's theme, then
 *             today, this week, this month and this year), with its dashboard and roadmap beside the Projects search
 *
 * The workspace you're in picks the agent; a chip picks another.
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
  needs: { label: "NEEDS YOU", color: "#FF9F0A", icon: "hand.raised.fill" },
  running: { label: "RUNNING", color: "#34C759", icon: "play.fill" },
  recent: { label: "RECENT", color: "#0A84FF", icon: "clock.fill" },
  idle: { label: "IDLE", color: "#8E8E93", icon: "moon.zzz.fill" },
  ended: { label: "ENDED", color: "#8E8E9366", icon: "stop.fill" }
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
var MAIN_BRANCH = /^(main|master)$/;
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
    icon: "",
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
  ...item().icon ? [
    Image(() => item().icon).font(8).color(() => item().fg)
  ] : [],
  Text(() => item().text).font(10).weight("medium").color(() => item().fg).lineLimit(1).truncation("tail")
]).paddingHorizontal(6).paddingVertical(2).background(() => item().bg).cornerRadius(5).fixedSize(() => item().flexible ? null : "horizontal");
var chip = (label, active, onTap) => Text(label).font(11).weight("semibold").paddingHorizontal(8).paddingVertical(3).cornerRadius(6).color(() => active() ? "primary" : "tertiary").background(() => active() ? "#7f7f7f3d" : null).hoverBackground("#7f7f7f3d").cursor("pointer").fixedSize("horizontal").onTap(onTap);
var searchField = (placeholder, onEdit) => HStack([
  HStack({ spacing: 6 }, [
    Image("magnifyingglass").font(12).color("secondary"),
    TextField("", { placeholder, autofocus: false, onEdit: (text) => onEdit(text ?? "") })
  ]).paddingHorizontal(9).paddingVertical(6).background("#7f7f7f24").cornerRadius(8).frame({ maxWidth: "infinity" })
]);
var lookOf = (section) => typeof section === "string" ? SECTIONS[section] : section;
var sectionHeader = (section, count, folded, onTap) => {
  const { label, color, icon } = lookOf(section);
  return HStack({ spacing: 5 }, [
    Image(icon).font(9).color(color).frame({ width: 12 }),
    Text(label).font(10).weight("bold").color(color),
    Text(() => String(count())).font(10).monospaced().color("tertiary"),
    Spacer(),
    Image(() => folded() ? "chevron.right" : "chevron.down").font(9).weight("semibold").color("tertiary")
  ]).paddingLeading(7).paddingTrailing(10).paddingTop(10).paddingBottom(2).frame({ maxWidth: "infinity" }).cursor("pointer").onTap(onTap);
};
var cardRow = (card) => VStack({ spacing: 4 }, [
  HStack({ spacing: 8, alignment: "top" }, [
    Circle({ size: 6 }).fill(() => SECTIONS[card().section].color).paddingTop(5),
    Text(() => card().title).font(13).weight("semibold").color(() => card().section === "idle" || card().section === "ended" ? "secondary" : "primary").lineLimit(2).truncation("tail"),
    Spacer({ minLength: 4 }),
    Text(() => timeText(card().agent)).font(10).monospaced().color("tertiary").fixedSize().paddingTop(2)
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
var tally = (section, count) => HStack({ spacing: 3 }, [
  Circle({ size: 5 }).fill(lookOf(section).color),
  Text(() => String(count())).font(10).weight("semibold").monospaced().color(() => count() ? "secondary" : "quaternary")
]).fixedSize();

// node_modules/cmux-custom-manager/src/sections.ts
var when = (show, build) => ForEach({ items: () => show() ? ["shown"] : [], key: (name) => name }, build);
var tokensOf = (query) => query.trim().toLowerCase().split(/\s+/).filter(Boolean);
var matches = (card, tokens) => {
  const haystack = [card.title, card.searchText ?? "", ...(card.badges ?? []).map(({ text }) => text)].join(" ").toLowerCase();
  return tokens.every((token) => haystack.includes(token));
};
var sectionCard = (card, color, expanded, onToggle) => VStack({ spacing: 4, alignment: "leading" }, [
  VStack({ spacing: 4, alignment: "leading" }, [
    HStack({ spacing: 8, alignment: "top" }, [
      Circle({ size: 6 }).fill(color).paddingTop(5),
      Text(() => card().title).font(13).weight("semibold").lineLimit(2).truncation("tail"),
      Spacer({ minLength: 4 }),
      Text(() => card().span ?? "").font(10).monospaced().color("tertiary").fixedSize().paddingTop(2)
    ]),
    HStack({ spacing: 4 }, [
      ForEach({
        items: () => (card().badges ?? []).map(({ text, color: tint, icon }, index) => ({
          key: `${index}:${text}`,
          text,
          icon: icon ?? "",
          fg: tint,
          bg: `${tint}26`,
          flexible: false
        })),
        key: (entry) => entry.key
      }, badge)
    ]).paddingLeading(14).frame({ maxWidth: "infinity", alignment: "leading" }),
    when(() => !expanded() && Boolean(card().summary), () => Text(() => card().summary ?? "").font(11).color("tertiary").lineLimit(2).truncation("tail").paddingLeading(14))
  ]).frame({ maxWidth: "infinity", alignment: "leading" }).cursor("pointer").onTap(onToggle),
  when(() => expanded() && Boolean(card().body), () => (card().body?.() ?? VStack([])).paddingLeading(14).paddingTop(2))
]).paddingHorizontal(10).paddingVertical(8).cornerRadius(10).background(() => expanded() ? `${color}1f` : "#7f7f7f0d").frame({ maxWidth: "infinity", alignment: "leading" });
var CLOSED = "";
var cardList = (section, query) => {
  const shown = computed(() => {
    const tokens = tokensOf(query());
    return section.cards().filter((card) => matches(card, tokens));
  });
  const [picked, setPicked] = signal(null);
  const openKey = computed(() => {
    const list = shown();
    const choice = picked();
    if (choice !== null && list.some((card) => card.key === choice)) {
      return choice;
    }
    if (choice === CLOSED || section.expandFirst === false) {
      return CLOSED;
    }
    return list[0]?.key ?? CLOSED;
  });
  const view = () => VStack({ spacing: 4 }, [
    ForEach({ items: shown, key: (card) => card.key }, (card) => sectionCard(card, section.color, () => openKey() === card().key, () => setPicked(openKey() === card().key ? CLOSED : card().key)))
  ]);
  return { shown, count: section.count ?? (() => shown().length), view };
};
var hostSection = (section, query) => {
  const [tapped, setTapped] = signal(null);
  const given = section.folded;
  const folded = () => tapped() ?? (typeof given === "function" ? given() : given ?? false);
  const { shown, count, view: body } = "content" in section ? { shown: () => [], count: section.count, view: section.content } : cardList(section, query);
  const view = when(() => count() > 0, () => VStack({ spacing: 4 }, [
    sectionHeader(section, count, folded, () => setTapped(!folded())),
    when(() => !folded(), body)
  ]));
  return { look: section, count, cards: shown, view };
};

// node_modules/cmux-custom-manager/src/manager.ts
var manager = ({ header, trailing, sections: hosted = [], exclude } = {}) => {
  const [query, setQuery] = signal("");
  const [groupFilter, setGroupFilter] = signal("");
  const [collapsed, setCollapsed] = signal(["ended"]);
  const toggleSection = (section) => setCollapsed(collapsed().includes(section) ? collapsed().filter((name) => name !== section) : [...collapsed(), section]);
  const kept = computed(() => exclude ? agentCards().filter((card) => !exclude(card)) : agentCards());
  const groupChips = computed(() => {
    const withAgents = new Set(kept().map((card) => card.groupId));
    return (data.groups() ?? []).filter((group) => withAgents.has(group.id));
  });
  const effectiveGroupFilter = computed(() => groupChips().some((group) => group.id === groupFilter()) ? groupFilter() : "");
  const cards = computed(() => {
    const tokens = query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    return kept().filter((card) => !effectiveGroupFilter() || card.groupId === effectiveGroupFilter()).filter((card) => {
      const haystack = [card.title, card.searchText, card.workspaceTitle, card.group, card.folder, card.branch].join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  });
  const sections = computed(() => bySection(cards()));
  const added = hosted.map((section) => hostSection(section, query));
  const cardsShown = () => added.some(({ cards }) => cards().length > 0);
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
    HStack({ spacing: 8 }, [
      header ?? HStack({ spacing: 6 }, [
        Image("square.grid.2x2").font(12).color("accent"),
        Text("Manager").font(13).weight("semibold")
      ]).fixedSize(),
      Spacer({ minLength: 0 }),
      HStack({ spacing: 7 }, [
        ...added.map(({ look, count }) => tally(look, count)),
        ...ORDER.filter((section) => section !== "ended").map((section) => tally(section, () => sections()[section].length))
      ]).fixedSize(),
      ...trailing ? [trailing] : []
    ]),
    ForEach({ items: () => groupChips().length ? ["chips"] : [], key: (item) => item }, () => HStack({ spacing: 4 }, [
      chip("All", () => !effectiveGroupFilter(), () => setGroupFilter("")),
      ForEach({ items: groupChips, key: (group) => group.id }, (group) => chip(() => group().name, () => effectiveGroupFilter() === group().id, () => setGroupFilter(effectiveGroupFilter() === group().id ? "" : group().id))),
      Spacer()
    ])),
    searchField("Search sessions…", setQuery),
    ...added.map(({ view }) => view),
    VStack({ spacing: 4 }, [ForEach({ items: entries, key: (entry) => entry.key }, row)]),
    Text(() => {
      if (entries().length > 0) {
        return "";
      }
      if (query().trim() || effectiveGroupFilter()) {
        return cardsShown() ? "" : "No matches.";
      }
      return "No agents running in cmux.";
    }).font(11).color("tertiary").paddingHorizontal(10),
    Spacer()
  ]).paddingHorizontal(6);
};

// src/cmux/sidebar/lines.ts
var CHIP_PADDING = 7;
var CHAR_WIDTH = 7;
var CHIP_EXTRA = CHIP_PADDING * 2 + 4;
var GAP = 4;
var widthOf = (label) => [...label].length * CHAR_WIDTH + CHIP_EXTRA;
var packLines = (items, label, firstWidth, width) => items.reduce(({ lines, used }, item) => {
  const cost = widthOf(label(item));
  const budget = lines.length === 1 ? firstWidth : width;
  const current = lines.at(-1) ?? [];
  return current.length && used + GAP + cost > budget ? { lines: [...lines, [item]], used: cost } : { lines: [...lines.slice(0, -1), [...current, item]], used: used + (current.length ? GAP : 0) + cost };
}, { lines: [[]], used: 0 }).lines;

// src/cmux/sidebar/data.ts
var SCHEMA = 11;

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
var SEGMENTS = 20;
var progressBar = (fraction, color) => {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * SEGMENTS);
  return HStack({ spacing: 0 }, Array.from({ length: SEGMENTS }, (_, index) => Rectangle().fill(index < filled ? color : "#7f7f7f33").frame({ maxWidth: "infinity", height: 4 }))).cornerRadius(2);
};
var textOf = (text) => typeof text === "string" ? text : text();
var countOf = (count) => typeof count === "number" ? count : count();
var groupTitle = (title, count) => HStack({ spacing: 4 }, [
  Text(() => textOf(title).toUpperCase()).font(10).weight("semibold").color("tertiary"),
  Text(() => String(countOf(count))).font(10).monospaced().color("quaternary"),
  Spacer({ minLength: 0 })
]).paddingHorizontal(4);
var chevron = (expanded) => Image(() => expanded() ? "chevron.down" : "chevron.right").font(9).weight("semibold").color("tertiary");
var foldTitle = (title, count, expanded, setExpanded) => HStack({ spacing: 4 }, [groupTitle(title, count), chevron(expanded)]).paddingTrailing(4).cursor("pointer").onTap(() => setExpanded(!expanded()));
var TITLE_OPACITY = 0.85;
var nowMs = computed(() => {
  const clock = data.clock();
  return clock ? clock.epoch * 1000 : Date.now();
});
var listRow = (view) => view.paddingHorizontal(4).paddingVertical(5).cursor("pointer").frame({ maxWidth: "infinity", alignment: "leading" });
var dividedList = (items, key, row) => {
  const headKey = computed(() => {
    const head = items()[0];
    return head === undefined ? "" : key(head);
  });
  return VStack({ spacing: 0 }, [
    ForEach({ items, key }, (item, itemKey) => VStack({ spacing: 0 }, [
      Divider().opacity(() => headKey() === itemKey ? 0 : 0.5).paddingHorizontal(4),
      row(item())
    ]))
  ]);
};
var when2 = (show, build) => ForEach({ items: () => show() ? ["shown"] : [], key: (name) => name }, build);
var keepWidth = (view) => view.lineLimit(1).fixedSize("horizontal");
var pillText = (label, color) => Text(label).font(9).weight("semibold").color(color).paddingHorizontal(5).paddingVertical(1).background(`${color}26`).cornerRadius(4);
var pill = (label, color) => keepWidth(pillText(label, color));
var shrinkingPill = (label, color) => pillText(label, color).lineLimit(1).truncation("tail");
var folderButton = (url) => url ? [toolIcon("folder", "Open in Finder", () => openURL(url))] : [];
var toolIcon = (symbol, help, onTap) => Image(symbol).font(11).color("secondary").padding(5).cornerRadius(6).hoverBackground("#7f7f7f3d").cursor("pointer").help(help).onTap(onTap);
var CARD = "#7f7f7f12";
var foldingCard = (header, expanded, setExpanded, body) => VStack({ spacing: 0 }, [
  VStack({ spacing: 0 }, [
    header.paddingHorizontal(10).paddingTop(8).paddingBottom(() => expanded() ? 6 : 8)
  ]).frame({ maxWidth: "infinity", alignment: "leading" }).cursor("pointer").onTap(() => setExpanded(!expanded())),
  when2(expanded, () => body().paddingHorizontal(10).paddingBottom(8))
]).background(CARD).cornerRadius(10).frame({ maxWidth: "infinity" });
var foldCard = ({ title, count, icon, color, expanded, setExpanded }, content) => foldingCard(HStack({ spacing: 7 }, [
  Image(icon).font(11).color(color),
  Text(() => textOf(title)).font(12).weight("semibold").lineLimit(1).truncation("tail").frame({ maxWidth: "infinity", alignment: "leading" }),
  Text(() => String(countOf(count))).font(10).weight("medium").monospaced().color("secondary"),
  chevron(expanded)
]), expanded, setExpanded, content);
var ACCENT = "#0A84FF";
var GREEN = "#34C759";
var ORANGE = "#FF9F0A";
var RED = "#FF453A";
var GREY = "#8E8E93";
var PURPLE = "#BF5AF2";
var PINK = "#FF375F";
var YELLOW = "#FFD60A";
var note = (text) => Text(text).font(11).color("tertiary").paddingHorizontal(10);
var banner = (label, text) => HStack({ spacing: 10 }, [
  Image("sparkles").font(13).color(PURPLE),
  VStack({ spacing: 2, alignment: "leading" }, [
    Text(() => textOf(label).toUpperCase()).font(9).weight("semibold").color("tertiary"),
    Text(text).font(14).weight("semibold").italic().opacity(TITLE_OPACITY).lineLimit(3).truncation("tail")
  ]).frame({ maxWidth: "infinity", alignment: "leading" })
]).paddingHorizontal(12).paddingVertical(10).background(`${PURPLE}1f`).cornerRadius(10);
var tabIcon = (symbol, help, active, onTap) => Image(symbol).font(12).color(() => active() ? "accent" : "secondary").padding(5).background(() => active() ? "#7f7f7f3d" : null).cornerRadius(6).hoverBackground("#7f7f7f3d").cursor("pointer").help(help).onTap(onTap);

// src/cmux/sidebar/view.ts
var projectColors = (entry) => {
  const colors = new Map(entry.projects.map(({ slug, hue }) => [slug, hueColor(hue)]));
  return (slug) => colors.get(slug) ?? GREY;
};
var startsOpen = (card) => DATA.open?.expanded?.includes(card) ?? false;
var openTarget = (target) => target.kind === "page" ? cmux("browser.tab.new", { url: target.url }) : cmux("file.open", { path: target.path });
var targetKey = (target) => target.kind === "page" ? target.url : target.path;
var entryOf = (home) => home ? DATA.homes[home] : undefined;
var matchesQuery = (query, ...texts) => {
  const haystack = texts.join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
};
var homeLabel = (home) => {
  const entry = DATA.homes[home];
  return entry ? `${entry.emoji} ${entry.name}`.trim() : home;
};
var scopedPage = (home, ready) => {
  const view = computed(() => {
    const path = home();
    const entry = entryOf(path);
    return path && entry ? { path, entry, current: entry.schema === SCHEMA } : null;
  });
  const showing = (current) => () => [view()].filter((item) => item?.current === current);
  return VStack({ spacing: 0 }, [
    ForEach({ items: showing(true), key: (item) => item.path }, (item) => ready(item().entry)),
    ForEach({ items: showing(false), key: (item) => item.path }, (item) => note(`${homeLabel(item().path)} needs its agent updated to show here.`)),
    when2(() => view() === null, () => note("No agent has joined this sidebar yet. Ask an agent to set up its cmux pack."))
  ]);
};

// src/cmux/sidebar/agents.ts
var FIRST_LINE = 216;
var LINE = 276;
var agentButton = (label, tint, active, onTap) => {
  const lit = tint ? `${tint}3d` : "#7f7f7f3d";
  return Text(label).font(11).weight("semibold").paddingHorizontal(CHIP_PADDING).paddingVertical(6).cornerRadius(8).color(() => active() ? tint ?? "primary" : "secondary").background(() => active() ? lit : "#7f7f7f1f").hoverBackground(lit).cursor("pointer").fixedSize("horizontal").onTap(onTap);
};
var agentHeader = ({ pill, homes, home, pick }) => {
  const agentChip = (path) => agentButton(homeLabel(path), DATA.homes[path]?.colors?.primary, () => home() === path, () => pick(path));
  const [first = [], ...rest] = packLines(homes, homeLabel, FIRST_LINE, LINE);
  return VStack({ spacing: 4, alignment: "leading" }, [
    HStack({ spacing: 8 }, [pill, HStack({ spacing: 4 }, first.map(agentChip)), Spacer({ minLength: 0 })]),
    ...rest.map((line) => HStack({ spacing: 4 }, [...line.map(agentChip), Spacer({ minLength: 0 })]))
  ]);
};

// src/work/due.ts
var DAY_MS = 86400000;
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var utcOf = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return year && month && day ? new Date(Date.UTC(year, month - 1, day)) : null;
};
var dayNumber = (iso) => (utcOf(iso)?.getTime() ?? Number.NaN) / DAY_MS;
var mondayIndex = (iso) => {
  const date = utcOf(iso);
  return date ? (date.getUTCDay() + 6) % 7 : null;
};
var shortDate = (iso, { weekday = false } = {}) => {
  const date = utcOf(iso);
  if (!date) {
    return null;
  }
  const dayMonth = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ""}`;
  return weekday ? `${WEEKDAYS[date.getUTCDay()] ?? ""} ${dayMonth}` : dayMonth;
};
var daysUntil = (due, today) => {
  const days = dayNumber(due) - dayNumber(today);
  return due && !Number.isNaN(days) ? days : null;
};
var periodHolds = (horizon, date, today) => {
  const days = daysUntil(date, today);
  if (horizon === "day") {
    return days === 0;
  }
  return horizon !== "week" || days === null || days >= -(mondayIndex(today) ?? 0);
};
var goalShelf = (block, today) => {
  if (!block) {
    return { goals: [], current: false, weekOf: "" };
  }
  const current = periodHolds(block.horizon, block.date, today);
  return {
    goals: block.horizon === "day" && !current ? [] : block.goals,
    current,
    weekOf: block.horizon === "week" && block.date ? shortDate(block.date) ?? block.date : ""
  };
};
var BUCKETS = ["overdue", "today", "week", "month", "later", "someday"];
var bucketOf = (days) => {
  if (days === null) {
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
var dueBucket = (due, today) => bucketOf(daysUntil(due, today));
var TONE = {
  overdue: "overdue",
  today: "soon",
  week: "soon",
  month: "later",
  later: "later",
  someday: "later"
};
var toneOf = (days) => TONE[bucketOf(days)];

// src/cmux/sidebar/placement.ts
var PICKED = 100;
var IN_FOLDER = 90;
var SAME_NAME = 80;
var NAME_INSIDE = 70;
var WORDS = 60;
var ONE_WORD = 50;
var MIN_INSIDE = 4;
var STOP = new Set("a an and the or of to in on for with from by at as is it its my your our this that be do new".split(" "));
var GENERIC = new Set(["agent", "issu", "work", "task", "session", "run", "chat", "misc", "group"]);
var flat = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
var stem = (word) => {
  const base = word.length > 5 && word.endsWith("ing") ? word.slice(0, -3) : word;
  const single = base.length > 3 && base.endsWith("s") && !base.endsWith("ss") ? base.slice(0, -1) : base;
  return single.length > 4 && single.endsWith("e") ? single.slice(0, -1) : single;
};
var stems = (text) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !STOP.has(word)).map(stem));
var isInside = (directory, folder) => folder !== "" && (directory === folder || directory.startsWith(folder.endsWith("/") ? folder : `${folder}/`));
var directoriesOf = (workspace) => [workspace.directory, ...workspace.tabs.map((tab) => tab.directory ?? "")].filter(Boolean);
var holdsHeartbeat = (workspace, agent) => agent.heartbeatSurface !== undefined && workspace.tabs.some((tab) => tab.surfaceId === agent.heartbeatSurface);
var anchorOf = (workspaces, agent) => workspaces.find((workspace) => flat(workspace.title) === flat(`agent ${agent.name}`)) ?? workspaces.filter((workspace) => workspace.directory === agent.home).toSorted((a, b) => Number(holdsHeartbeat(a, agent)) - Number(holdsHeartbeat(b, agent)))[0];
var claimedBy = (workspace, anchor, rivals) => anchor !== undefined && (workspace.id === anchor.id || anchor.group !== undefined && workspace.group === anchor.group && !rivals.some((rival) => rival !== undefined && rival.id !== anchor.id && rival.group === anchor.group));
var worksIn = (workspace, agent) => directoriesOf(workspace).some((directory) => [agent.home, ...agent.folders].some((folder) => isInside(directory, folder)));
var scoreOf = (workspace, hint, home) => {
  const title = flat(workspace.title);
  const folders = (hint.folders ?? []).filter((folder) => folder !== "" && folder !== home);
  const names = (hint.names ?? []).map(flat).filter(Boolean);
  const own = stems(`${workspace.title} ${workspace.description ?? ""}`);
  const shared = [...stems(`${hint.words ?? ""} ${(hint.names ?? []).join(" ")} ${hint.workspace ?? ""}`)].filter((word) => own.has(word));
  const distinct = shared.filter((word) => !GENERIC.has(word) && word.length >= 3);
  const scores = [
    hint.workspace && flat(hint.workspace) === title ? PICKED : 0,
    folders.some((folder) => directoriesOf(workspace).some((directory) => isInside(directory, folder))) ? IN_FOLDER : 0,
    names.includes(title) ? SAME_NAME : 0,
    names.some((name) => Math.min(name.length, title.length) >= MIN_INSIDE && (name.includes(title) || title.includes(name))) ? NAME_INSIDE : 0,
    shared.length >= 2 && distinct.length >= 1 ? WORDS : 0,
    distinct.length >= 1 ? ONE_WORD : 0
  ];
  return Math.max(...scores);
};
var placeFor = (workspaces, agent, others, hint, fallback = "agent") => {
  const local = workspaces.filter((workspace) => !workspace.remote);
  const anchor = anchorOf(local, agent);
  const otherAnchors = others.map((other) => anchorOf(local, other));
  const allAnchors = [anchor, ...otherAnchors];
  const isTheirs = (workspace) => otherAnchors.some((other) => other?.id === workspace.id) || !claimedBy(workspace, anchor, allAnchors) && (otherAnchors.some((other) => claimedBy(workspace, other, allAnchors)) || others.some((other) => worksIn(workspace, other) && !worksIn(workspace, agent)));
  const mine = local.filter((workspace) => !isTheirs(workspace) && (claimedBy(workspace, anchor, allAnchors) || worksIn(workspace, agent)));
  const choices = mine.filter((workspace) => !holdsHeartbeat(workspace, agent) || mine.length === 1);
  const best = choices.map((workspace) => ({ workspace, score: scoreOf(workspace, hint, agent.home) })).filter(({ score }) => score >= ONE_WORD).toSorted((a, b) => b.score - a.score || (b.workspace.latestAt ?? 0) - (a.workspace.latestAt ?? 0))[0];
  const selected = local.find((workspace) => workspace.selected && !isTheirs(workspace));
  const target = best?.workspace ?? (fallback === "selected" ? selected ?? anchor : anchor ?? selected);
  return target ? { kind: "workspace", id: target.id } : { kind: "new" };
};

// src/cmux/sidebar/session.ts
var agentOf = (entry) => ({
  name: entry.name,
  home: entry.home,
  folders: entry.codeFolders ?? [],
  ...entry.heartbeat ? { heartbeatSurface: entry.heartbeat.surfaceId } : {}
});
var placeSession = (entry, hint, fallback = "agent") => placeFor(data.workspaces() ?? [], agentOf(entry), Object.values(DATA.homes).filter((other) => other.home !== entry.home).map(agentOf), hint, fallback);
var openSession = (entry, command, hint = {}) => {
  const input = `${entry.launcher} "${command}"\r`;
  const target = placeSession(entry, hint);
  if (target.kind === "workspace") {
    cmux("workspace.select", { workspace_id: target.id });
    cmux("surface.create", { workspace_id: target.id, working_directory: entry.home, initial_input: input, focus: true });
  } else {
    cmux("workspace.create", { cwd: entry.home, initial_input: input });
  }
};
var discussIcon = (entry, ref, hint = {}) => Image("sparkles").font(10).color(YELLOW).opacity(0.6).padding(3).help(`Discuss with ${entry.name}`).onTap(() => openSession(entry, `/${entry.plugin}:discuss ${ref}`, hint));

// src/cmux/sidebar/due.ts
var wordsFor = (days) => {
  if (days < 0) {
    return `overdue ${-days}d`;
  }
  if (days <= 1) {
    return days === 0 ? "due today" : "due tomorrow";
  }
  return `due in ${days}d`;
};
var dueLabel = (due, today) => {
  const days = daysUntil(due, today);
  return days === null ? null : { text: wordsFor(days), tone: toneOf(days) };
};
var isoDay = (epochSeconds) => {
  const date = new Date(epochSeconds * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// src/cmux/sidebar/tasks.ts
var OPEN = { symbol: "circle", color: GREY };
var STATUS = {
  active: { symbol: "circle.fill", color: GREEN },
  blocked: { symbol: "exclamationmark.circle.fill", color: RED },
  open: OPEN
};
var statusOf = (status) => STATUS[status] ?? OPEN;
var TONE2 = { overdue: RED, soon: ORANGE, later: "tertiary" };
var URGENT = new Set(["P0", "P1"]);
var today = computed(() => isoDay(nowMs() / 1000));
var statusIcon = (status, size = 7) => {
  const { symbol, color } = statusOf(status);
  return Image(symbol).font(size).color(color);
};
var count = (amount, status) => amount ? [
  HStack({ spacing: 3 }, [
    statusIcon(status, 6),
    Text(String(amount)).font(10).weight("medium").monospaced().color("secondary")
  ]).fixedSize()
] : [];
var taskMeta = (entry, task, projectColor) => HStack({ spacing: 6 }, [
  statusIcon(task.status),
  keepWidth(Text(task.id).font(10).monospaced().color("tertiary")),
  keepWidth(Text(task.priority).font(10).weight("semibold").monospaced().color(URGENT.has(task.priority) ? ORANGE : "tertiary")),
  keepWidth(Text(() => dueLabel(task.due, today())?.text ?? "").font(10).color(() => TONE2[dueLabel(task.due, today())?.tone ?? "later"])),
  Spacer({ minLength: 0 }),
  ...projectColor ? [shrinkingPill(task.project, projectColor)] : [],
  ...task.comments ? [
    HStack({ spacing: 2 }, [
      Image("bubble.left").font(9).color("tertiary"),
      Text(String(task.comments)).font(10).monospaced().color("tertiary")
    ]).fixedSize()
  ] : [],
  discussIcon(entry, `task:${task.id}`, { names: [task.project], words: task.title })
]);
var taskRow = (entry, task, projectColor) => listRow(VStack({ spacing: 2, alignment: "leading" }, [
  Text(task.title).font(12).opacity(TITLE_OPACITY).lineLimit(2).truncation("tail"),
  taskMeta(entry, task, projectColor)
])).onTap(() => cmux("file.open", { path: task.path }));

// src/cmux/sidebar/goals.ts
var SHELVES = [
  { horizon: "day", title: "Today", icon: "sun.max.fill", color: ORANGE, open: true },
  { horizon: "week", title: "This week", icon: "calendar", color: ACCENT, open: true },
  { horizon: "month", title: "This month", icon: "target", color: GREEN, open: true },
  { horizon: "year", title: "This year", icon: "flag.fill", color: PURPLE, open: false }
];
var goalRow = (colorOf, discuss) => (goal) => VStack({ spacing: 4, alignment: "leading" }, [
  HStack({ spacing: 6 }, [
    goal.label ? pill(goal.label, GREY) : Text(String(goal.number)).font(10).weight("semibold").monospaced().color("tertiary"),
    ...goal.mark ? [Text(goal.mark).font(10)] : [],
    ...goal.project ? [pill(goal.project, colorOf(goal.project))] : [],
    Spacer({ minLength: 0 }),
    discuss(goal)
  ]),
  Text(goal.title).font(12).weight("medium").opacity(TITLE_OPACITY),
  ...goal.check ? [
    VStack({ spacing: 1, alignment: "leading" }, [
      Text("DONE WHEN").font(9).weight("semibold").color("tertiary"),
      Text(goal.check).font(11).color("secondary")
    ])
  ] : [],
  ...goal.detail ? [Text(goal.detail).font(11).color("tertiary")] : []
]).paddingHorizontal(4).paddingVertical(7).frame({ maxWidth: "infinity", alignment: "leading" }).opacity(goal.mark ? 0.55 : 1);
var shelfCard = (shelf, block, entry, colorOf) => {
  const agent = entry.name;
  const [open, setOpen] = signal(shelf.open);
  const command = `goals ${shelf.horizon}`;
  const view = computed(() => goalShelf(block, today()));
  const live = () => view().current;
  const shown = () => view().goals;
  const caption = () => {
    const { weekOf, current } = view();
    if (!weekOf) {
      return block?.caption ?? "";
    }
    return current ? `Week of ${weekOf}` : `Set for the week of ${weekOf} · ask ${agent}: ${command}`;
  };
  return foldCard({
    title: shelf.title,
    count: () => shown().length,
    icon: shelf.icon,
    color: shelf.color,
    expanded: open,
    setExpanded: setOpen
  }, () => VStack({ spacing: 4 }, [
    when2(() => caption() !== "", () => Text(caption).font(10).color(() => live() ? "secondary" : ORANGE).paddingHorizontal(4).frame({ maxWidth: "infinity", alignment: "leading" })),
    when2(() => shown().length === 0, () => VStack({ spacing: 2, alignment: "leading" }, [
      Text(`No goals set for ${shelf.title.toLowerCase()}.`).font(11).color("secondary"),
      Text(`Ask ${agent}: ${command}`).font(10).color("tertiary")
    ]).paddingHorizontal(4).paddingVertical(4).frame({ maxWidth: "infinity", alignment: "leading" })),
    dividedList(shown, (goal) => String(goal.number), goalRow(colorOf, (goal) => discussIcon(entry, `goal:${shelf.horizon}:${goal.number}`, {
      names: goal.project ? [goal.project] : [],
      words: goal.title
    }))),
    when2(() => shown().length > 0 && (block?.notes.length ?? 0) > 0, () => VStack({ spacing: 4, alignment: "leading" }, (block?.notes ?? []).map((note) => Text(note).font(10).italic().color("tertiary").frame({ maxWidth: "infinity", alignment: "leading" }))).paddingHorizontal(4).paddingTop(4))
  ]));
};
var goalsBody = (entry) => {
  const { theme, blocks } = entry.goals;
  const colorOf = projectColors(entry);
  return VStack({ spacing: 6 }, [
    ...theme ? [banner(theme.label, theme.text)] : [],
    ...SHELVES.map((shelf) => shelfCard(shelf, blocks.find((block) => block.horizon === shelf.horizon), entry, colorOf))
  ]);
};

// src/cmux/sidebar/projects.ts
var HOUR_MS = 60 * 60 * 1000;
var ago = (writtenAt) => {
  const elapsed = nowMs() - Date.parse(writtenAt);
  if (!(elapsed >= 0)) {
    return "";
  }
  return elapsed < HOUR_MS ? `${Math.max(1, Math.round(elapsed / 60000))}m ago` : elapsed < 24 * HOUR_MS ? `${Math.round(elapsed / HOUR_MS)}h ago` : `${Math.round(elapsed / (24 * HOUR_MS))}d ago`;
};
var summaryLine = ({ text, writtenAt }) => HStack({ spacing: 5, alignment: "top" }, [
  Image("sparkles").font(9).color(PURPLE).opacity(0.7).paddingTop(2),
  Text(text).font(11).color("secondary").lineLimit(3).truncation("tail").frame({ maxWidth: "infinity", alignment: "leading" })
]).help(["Tasks at a glance", ago(writtenAt)].filter(Boolean).join(" · "));
var linkRow = ({ icon, title, target }) => HStack({ spacing: 6 }, [
  Text(icon).font(11).frame({ width: 14 }),
  Text(title).font(11).color("secondary").lineLimit(1).truncation("tail").frame({ maxWidth: "infinity", alignment: "leading" })
]).paddingHorizontal(4).paddingVertical(2).cornerRadius(6).hoverBackground("#7f7f7f26").cursor("pointer").onTap(() => openTarget(target));
var roadmapLink = (url) => ({ title: "Roadmap", icon: "\uD83D\uDDFA️", target: { kind: "page", url } });
var fraction = (done, live) => done + live ? done / (done + live) : 0;
var AGENDA = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  month: "This month",
  later: "Later"
};
var listedTasks = (entry) => {
  const colorOf = projectColors(entry);
  return entry.tasks.map((task) => ({ task, color: colorOf(task.project) }));
};
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
var dueTally = (amount, label, color) => keepWidth(Text(() => amount() ? `${amount()} ${label}` : "").font(10).weight("semibold").color(color));
var tasksCard = (entry, listed) => {
  const [expanded, setExpanded] = signal(startsOpen("tasks"));
  const total = (field) => entry.projects.reduce((sum, project) => sum + project[field], 0);
  const tone = (wanted) => () => listed.filter(({ task }) => dueLabel(task.due, today())?.tone === wanted).length;
  const groups = computed(() => agenda(listed, today()));
  const summary = entry.tasksSummary;
  return foldingCard(VStack({ spacing: 6 }, [
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
    ...summary ? [when2(() => !expanded(), () => summaryLine(summary))] : [],
    HStack({ spacing: 8 }, [
      dueTally(tone("overdue"), "overdue", RED),
      dueTally(tone("soon"), "due this week", ORANGE),
      Spacer({ minLength: 0 })
    ])
  ]), expanded, setExpanded, () => VStack({ spacing: 6 }, [
    ForEach({ items: groups, key: (group) => group.title }, (group) => VStack({ spacing: 1 }, [
      groupTitle(group().title, group().tasks.length).paddingTop(4),
      dividedList(() => group().tasks, (item) => item.task.id, (item) => taskRow(entry, item.task, item.color))
    ]))
  ]));
};
var projectCard = (entry, project, tasks) => {
  const [expanded, setExpanded] = signal(startsOpen(project.slug));
  const color = hueColor(project.hue);
  const next = tasks[0];
  const links = [...project.roadmap ? [roadmapLink(project.roadmap)] : [], ...project.pins];
  return foldingCard(VStack({ spacing: 6 }, [
    HStack({ spacing: 7 }, [
      Circle({ size: 8 }).fill(color),
      Text(project.slug).font(12).weight("semibold").lineLimit(1).truncation("tail").frame({ maxWidth: "infinity", alignment: "leading" }),
      ...count(project.active, "active"),
      ...count(project.blocked, "blocked"),
      ...count(project.open, "open"),
      ...links.length ? [Image("pin.fill").font(8).color("tertiary").help(`${links.length} pinned`)] : [],
      chevron(expanded)
    ]),
    progressBar(fraction(project.done, project.active + project.blocked + project.open), color),
    ForEach({ items: () => next && !expanded() ? [next] : [], key: (task) => task.id }, (task) => HStack({ spacing: 5 }, [
      Image("arrow.turn.down.right").font(8).color("quaternary"),
      Text(task().title).font(11).color("secondary").lineLimit(1).truncation("tail").frame({ maxWidth: "infinity", alignment: "leading" })
    ]))
  ]), expanded, setExpanded, () => VStack({ spacing: 6 }, [
    ...links.length ? [
      VStack({ spacing: 0 }, [
        ForEach({ items: links, key: (link) => targetKey(link.target) }, (link) => linkRow(link()))
      ])
    ] : [],
    dividedList(() => tasks, (task) => task.id, (task) => taskRow(entry, task))
  ]));
};
var STATES = [
  { title: "At work", holds: (project) => project.active > 0 },
  { title: "Blocked", holds: (project) => !project.active && project.blocked > 0 },
  { title: "Quiet", holds: (project) => !project.active && !project.blocked }
];
var stateGroup = (entry, title, projects, tasksOf) => {
  const [expanded, setExpanded] = signal(true);
  return VStack({ spacing: 6 }, [
    foldTitle(title, projects.length, expanded, setExpanded),
    ForEach({ items: () => expanded() ? projects : [], key: (project) => project.slug }, (item) => projectCard(entry, item(), tasksOf.get(item().slug) ?? []))
  ]);
};
var projectsBody = (entry) => {
  const { dashboard, roadmap } = entry;
  const [query, setQuery] = signal("");
  const listed = listedTasks(entry);
  const tasksOf = entry.tasks.reduce((byProject, task) => byProject.set(task.project, [...byProject.get(task.project) ?? [], task]), new Map);
  const found = computed(() => listed.filter(({ task }) => matchesQuery(query(), task.title, task.id)));
  const searching = () => query().trim() !== "";
  return VStack({ spacing: 10 }, [
    HStack({ spacing: 4 }, [
      searchField("Search tasks…", setQuery),
      toolIcon("square.grid.3x3", "Dashboard", () => cmux("browser.tab.new", { url: `${dashboard}#today` })),
      ...roadmap ? [toolIcon("map", "Roadmap", () => cmux("browser.tab.new", { url: roadmap }))] : [],
      ...folderButton(entry.folders?.projects)
    ]),
    when2(searching, () => VStack({ spacing: 1 }, [
      dividedList(found, (item) => item.task.id, (item) => taskRow(entry, item.task, item.color)),
      Text(() => found().length ? "" : "No matching tasks.").font(11).color("tertiary").paddingHorizontal(4)
    ])),
    when2(() => !searching(), () => VStack({ spacing: 10 }, [
      tasksCard(entry, listed),
      ...STATES.flatMap(({ title, holds }) => {
        const projects = entry.projects.filter(holds);
        return projects.length ? [stateGroup(entry, title, projects, tasksOf)] : [];
      }),
      ...entry.projects.length ? [] : [note("No projects yet.")]
    ]))
  ]);
};

// src/cmux/sidebar/days.ts
var clock = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    return time;
  }
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
};
var dayTitle = (date, day) => {
  const days = daysUntil(date, day);
  if (days === 0) {
    return "Today";
  }
  if (days === -1) {
    return "Yesterday";
  }
  return shortDate(date, { weekday: true }) ?? (date || "Undated");
};
var byDay = (items) => items.reduce((groups, item) => {
  const last = groups.at(-1);
  return last && last.date === item.date ? [...groups.slice(0, -1), { date: last.date, items: [...last.items, item] }] : [...groups, { date: item.date, items: [item] }];
}, []);
var datedRow = (item, extras = []) => listRow(VStack({ spacing: 3, alignment: "leading" }, [
  Text(item.title).font(12).opacity(TITLE_OPACITY).lineLimit(2).truncation("tail"),
  HStack({ spacing: 6 }, [
    HStack({ spacing: 4 }, [
      Circle({ size: 6 }).fill(hueColor(item.hue)),
      Text(item.kind).font(10).color("secondary").lineLimit(1).truncation("tail")
    ]).fixedSize("horizontal"),
    ...extras,
    Spacer({ minLength: 0 }),
    keepWidth(Text(clock(item.time)).font(10).monospaced().color("tertiary"))
  ])
])).onTap(() => openTarget(item.target));
var dayCards = (groups, searching, row) => ForEach({ items: groups, key: (group) => group.date }, (group) => {
  const age = daysUntil(group().date, today());
  const [open, setOpen] = signal(age !== null && age >= -1);
  return foldCard({
    title: () => dayTitle(group().date, today()),
    count: () => group().items.length,
    icon: "calendar",
    color: ACCENT,
    expanded: () => open() || searching(),
    setExpanded: setOpen
  }, () => dividedList(() => group().items, (item) => targetKey(item.target), row));
});

// src/cmux/sidebar/recent.ts
var recentBody = (entry) => {
  const { recent } = entry;
  if (!recent) {
    return note(`Update ${entry.name} to see its recent files.`);
  }
  const colorOf = projectColors(entry);
  const row = (item) => datedRow(item, item.project ? [pill(item.project, colorOf(item.project))] : []);
  const [query, setQuery] = signal("");
  const days = computed(() => byDay(recent.filter((item) => matchesQuery(query(), item.title, item.kind, item.project))));
  const searching = () => query().trim() !== "";
  return VStack({ spacing: 10 }, [
    HStack({ spacing: 4 }, [searchField("Search recent files…", setQuery), ...folderButton(entry.folders?.recent)]),
    VStack({ spacing: 6 }, [dayCards(days, searching, row)]),
    Text(() => days().length ? "" : searching() ? "No matching files." : "Nothing changed in the last 30 days.").font(11).color("tertiary").paddingHorizontal(4)
  ]);
};

// src/cmux/sidebar/reports.ts
var STATUS_COLOR = { clean: GREEN, findings: ORANGE, critical: RED, draft: GREY };
var statusBadge = (status) => pill(status, STATUS_COLOR[status] ?? GREY);
var reportRow = (item) => datedRow(item, item.status ? [statusBadge(item.status)] : []);
var pinRow = ({ pin, project }) => listRow(HStack({ spacing: 6 }, [
  Text(pin.icon).font(11).frame({ width: 14 }),
  Text(pin.title).font(12).opacity(TITLE_OPACITY).lineLimit(2).truncation("tail").frame({ maxWidth: "infinity", alignment: "leading" }),
  ...project ? [pill(project.slug, project.color)] : []
])).onTap(() => openTarget(pin.target));
var reportsBody = (entry) => {
  const [query, setQuery] = signal("");
  const pinned = [
    ...entry.pins.map((pin) => ({ pin })),
    ...entry.projects.flatMap((project) => project.pins.map((pin) => ({ pin, project: { slug: project.slug, color: hueColor(project.hue) } })))
  ];
  const shownPins = computed(() => pinned.filter(({ pin, project }) => matchesQuery(query(), pin.title, project?.slug ?? "")));
  const days = computed(() => byDay(entry.reports.filter((report) => matchesQuery(query(), report.title, report.kind))));
  const empty = computed(() => !shownPins().length && !days().length);
  const searching = () => query().trim() !== "";
  const [pinsOpen, setPinsOpen] = signal(true);
  return VStack({ spacing: 10 }, [
    HStack({ spacing: 4 }, [searchField("Search reports…", setQuery), ...folderButton(entry.folders?.reports)]),
    VStack({ spacing: 6 }, [
      when2(() => shownPins().length > 0, () => foldCard({
        title: "Pinned",
        count: () => shownPins().length,
        icon: "pin.fill",
        color: ORANGE,
        expanded: () => pinsOpen() || searching(),
        setExpanded: setPinsOpen
      }, () => dividedList(shownPins, (item) => targetKey(item.pin.target), pinRow))),
      dayCards(days, searching, reportRow)
    ]),
    Text(() => empty() ? searching() ? "No matching reports." : "No reports yet." : "").font(11).color("tertiary").paddingHorizontal(4),
    ...entry.olderReports ? [
      note(`${entry.olderReports} older reports are on the dashboard.`).cursor("pointer").onTap(() => cmux("browser.tab.new", { url: `${entry.dashboard}#reports` }))
    ] : []
  ]);
};

// src/cmux/sidebar/agent.ts
var PROJECTS = { id: "projects", label: "Projects", body: projectsBody };
var SECTIONS2 = [
  PROJECTS,
  { id: "reports", label: "Reports", body: reportsBody },
  { id: "recent", label: "Recent", body: recentBody },
  { id: "goals", label: "Goals", body: goalsBody }
];
var agentPage = (options) => {
  const [section, setSection] = signal(SECTIONS2.find((item) => item.id === DATA.open?.section) ?? PROJECTS);
  return VStack({ spacing: 8 }, [
    agentHeader(options),
    scopedPage(options.home, (entry) => VStack({ spacing: 8 }, [
      HStack({ spacing: 4 }, [
        ...SECTIONS2.map((item) => chip(item.label, () => section() === item, () => setSection(item))),
        Spacer({ minLength: 0 })
      ]),
      ForEach({ items: () => [section()], key: (item) => item.label }, (item) => item().body(entry))
    ]))
  ]).paddingHorizontal(6);
};

// src/cmux/sidebar/heartbeat.ts
var isRunningClaude = (agent) => agent.kind === "claude" && agent.status !== "ended";
var heartbeatWaiting = (place) => place !== null && (data.workspaces() ?? []).some((workspace) => workspace.tabs.some((tab) => tab.surfaceId === place.surfaceId && (workspace.agents ?? []).some((agent) => agent.panelId === tab.id && agent.status === "needs_input")));
var heartbeatRoute = (place) => {
  const found = place && (data.workspaces() ?? []).find((workspace) => workspace.tabs.some((tab) => tab.surfaceId === place.surfaceId && (workspace.agents ?? []).some((agent) => agent.panelId === tab.id && isRunningClaude(agent))));
  return place && found ? { surfaceId: place.surfaceId, workspaceId: found.id } : null;
};

// src/messages/choices.ts
var isShown = (laterUntil, nowMs) => laterUntil === "" || Date.parse(laterUntil) <= nowMs;

// src/cmux/sidebar/messages.ts
var PROPOSAL_BADGE = { text: "Proposal", color: PINK, icon: "sparkles" };
var NOTE_BADGE = { text: "Note", color: ACCENT, icon: "note.text" };
var choiceButton = (label, onTap, tint) => Text(label).font(11).weight("semibold").color(tint ? "#ffffff" : "secondary").paddingHorizontal(tint ? 14 : 9).paddingVertical(5).background(tint ?? null).cornerRadius(8).hoverBackground(tint ?? "#7f7f7f3d").cursor("pointer").fixedSize("horizontal").onTap(onTap);
var sentAt = (at) => {
  const sent = new Date(Date.parse(at));
  const day = isoDay(sent.getTime() / 1000);
  const time = `${String(sent.getHours()).padStart(2, "0")}:${String(sent.getMinutes()).padStart(2, "0")}`;
  return day === today() ? clock(time) : dayTitle(day, today());
};
var fact = (symbol, text, tone, look = {}) => {
  const plain = Text(text).font(11).color(tone);
  const styled = look.italic ? plain.italic() : plain;
  return HStack({ spacing: 5, alignment: "top" }, [
    Image(symbol).font(9).color(tone).frame({ width: 12 }).paddingTop(2),
    look.oneLine ? styled.lineLimit(1).truncation("middle") : styled
  ]);
};
var lookOf2 = (message) => {
  if (message.kind === "proposal") {
    const { item } = message;
    return {
      hint: {
        workspace: item.workspace ?? "",
        folders: item.folder ? [item.folder] : [],
        words: `${item.title} ${item.trigger}`
      },
      details: () => [
        Text(item.detail).font(11),
        fact("bolt.fill", item.trigger, "secondary"),
        ...item.quote ? [fact("quote.opening", item.quote, "secondary", { italic: true })] : [],
        fact("lock.fill", item.reach, "tertiary")
      ],
      face: {
        ...item.estimate ? { span: `~${item.estimate}` } : {},
        badges: [PROPOSAL_BADGE, ...item.due ? [{ text: item.due, color: ORANGE, icon: "calendar" }] : []],
        ...item.trigger ? { summary: item.trigger } : {},
        searchText: `${item.trigger} ${item.detail}`
      }
    };
  }
  const { item } = message;
  return {
    hint: {
      workspace: item.workspace,
      folders: item.folder ? [item.folder] : [],
      words: `${item.title} ${item.next}`
    },
    details: () => [
      Text(item.body).font(11),
      fact("arrow.turn.down.right", item.next, "secondary"),
      VStack({ spacing: 1, alignment: "leading" }, item.sources.map((source) => fact("paperclip", source, "tertiary", { oneLine: true })))
    ],
    face: { span: sentAt(item.at), badges: [NOTE_BADGE], summary: item.next, searchText: `${item.body} ${item.next}` }
  };
};
var actions = (entry, id, start) => {
  const route = computed(() => heartbeatRoute(entry.heartbeat));
  const waiting = computed(() => heartbeatWaiting(route()));
  const type = (command) => {
    const target = route();
    if (target && !waiting()) {
      cmux("surface.send_text", {
        surface_id: target.surfaceId,
        workspace_id: target.workspaceId,
        text: `${command}
`
      });
    }
  };
  return [
    when2(() => waiting(), () => Text(`${entry.name}’s heartbeat is waiting on you in its tab; answer it there first.`).font(10).color("tertiary").paddingTop(3)),
    when2(() => route() !== null && !waiting(), () => HStack({ spacing: 4 }, [
      choiceButton("Start", () => type(start()), entry.colors?.primary ?? PURPLE),
      choiceButton("Later", () => type(`/message later ${id}`)),
      choiceButton("Dismiss", () => type(`/message dismiss ${id}`)),
      Spacer({ minLength: 0 })
    ]).paddingTop(3)),
    when2(() => route() === null, () => Text(`Run /heartbeat in one of ${entry.name}’s sessions to act on these here.`).font(10).color("tertiary").paddingTop(3))
  ];
};
var card = ({ entry, message }) => {
  const { item } = message;
  const { hint, details, face } = lookOf2(message);
  const start = () => {
    const target = placeSession(entry, hint, "selected");
    return `/message start ${item.id}${target.kind === "workspace" ? ` --workspace=${target.id}` : ""}`;
  };
  return {
    key: `${entry.home}#${item.id}`,
    title: item.title,
    ...face,
    body: () => VStack({ spacing: 5, alignment: "leading" }, [...details(), ...actions(entry, item.id, start)])
  };
};
var heartbeatBody = (entry) => VStack({ spacing: 5, alignment: "leading" }, [
  Text(`Opens a session in ${entry.name}’s home that looks for proposals now, then every 55 minutes while the home’s other sessions are active, keeping the best five showing. Every 6 hours, when there’s something new, it refreshes the brain and scouts the web and the brain for up to three notes a day.`).font(11).color("secondary"),
  HStack({ spacing: 4 }, [
    choiceButton("Start heartbeat", () => openSession(entry, "/heartbeat"), entry.colors?.primary ?? PURPLE),
    Spacer({ minLength: 0 })
  ]).paddingTop(3)
]);
var heartbeatCard = (entry) => ({
  key: `${entry.home}#heartbeat`,
  title: `Start ${entry.name}’s heartbeat`,
  body: () => heartbeatBody(entry)
});
var newestFirst = (a, b) => Date.parse(b.message.item.at) - Date.parse(a.message.item.at);
var messagesSection = (scope) => {
  const entries = Object.values(DATA.homes).filter((entry) => entry.schema === SCHEMA);
  const minute = computed(() => Math.floor(nowMs() / 60000) * 60000);
  const inScope = computed(() => {
    const home = scope();
    return home ? entries.filter((entry) => entry.home === home) : entries;
  });
  const reachable = computed(() => entries.filter((entry) => heartbeatRoute(entry.heartbeat) !== null).map((entry) => entry.home).join(`
`));
  const waiting = (entry, now) => [
    ...entry.proposals.map((item) => ({ kind: "proposal", item })),
    ...(entry.notes ?? []).map((item) => ({ kind: "note", item }))
  ].filter(({ item }) => isShown(item.laterUntil, now)).map((message) => ({ entry, message }));
  const cards = computed(() => {
    const now = minute();
    const live = new Set(reachable().split(`
`));
    return [
      ...inScope().filter((entry) => live.has(entry.home)).flatMap((entry) => waiting(entry, now)).toSorted(newestFirst).map(card),
      ...inScope().filter((entry) => !live.has(entry.home)).flatMap((entry) => [heartbeatCard(entry), ...waiting(entry, now).toSorted(newestFirst).map(card)])
    ];
  });
  return {
    label: "INBOX",
    icon: "tray.full.fill",
    color: PURPLE,
    folded: true,
    expandFirst: false,
    cards
  };
};

// src/cmux/sidebar/scope.ts
var homeOf = (homes, path) => path ? homes.filter((home) => path === home || path.startsWith(`${home}/`)).toSorted((a, b) => b.length - a.length)[0] : undefined;
var newestHome = (homes, agents = []) => agents.toSorted((a, b) => b.lastActivityAt - a.lastActivityAt).map((agent) => homeOf(homes, agent.directory)).find((home) => home !== undefined);
var workspaceHome = (homes, workspaces) => {
  const selected = workspaces.find((workspace) => workspace.selected);
  return homeOf(homes, selected?.directory) ?? newestHome(homes, selected?.agents);
};
var scopedHome = (homes, workspaces, pin) => {
  const selected = workspaces.find((workspace) => workspace.selected);
  const picked = pin && selected && pin.workspaceId === selected.id && homes.includes(pin.home) ? pin.home : undefined;
  return picked ?? workspaceHome(homes, workspaces) ?? newestHome(homes, workspaces.flatMap((workspace) => workspace.agents ?? [])) ?? homes[0];
};

// src/cmux/sidebar/main.ts
var app = () => {
  const homes = Object.keys(DATA.homes);
  const [tab, setTab] = signal(DATA.open?.tab ?? "manager");
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
  const messages = messagesSection(computed(() => workspaceHome(homes, workspaces())));
  const heartbeats = computed(() => new Set(Object.values(DATA.homes).flatMap((entry) => entry.schema === SCHEMA ? heartbeatRoute(entry.heartbeat)?.surfaceId ?? [] : [])));
  const isQuietHeartbeat = (card) => card.focusId !== undefined && heartbeats().has(card.focusId) && isRunningClaude(card.agent) && card.agent.status !== "needs_input";
  const pill = () => HStack({ spacing: 2 }, [
    tabIcon("square.grid.2x2", "Manager", () => tab() === "manager", () => setTab("manager")),
    tabIcon("square.stack.3d.up.fill", "Agents", () => tab() === "agents", () => setTab("agents"))
  ]).padding(2).background("#7f7f7f1f").cornerRadius(8).fixedSize();
  return VStack({ spacing: 8 }, [
    ForEach({ items: () => [tab()], key: (name) => name }, (name) => name() === "manager" ? manager({
      header: HStack({ spacing: 8 }, [pill(), Text("Manager").font(13).weight("semibold")]).fixedSize(),
      sections: [messages],
      exclude: isQuietHeartbeat
    }) : agentPage({
      pill: pill(),
      home: current,
      homes,
      pick: (home) => setPin({ home, workspaceId: selectedId() })
    })),
    Spacer()
  ]);
};
sidebar(app);
