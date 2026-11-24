---
paths:
  - "**/*.pbxproj"
  - "**/*.xcconfig"
  - "**/*.entitlements"
  - "**/Info.plist"
  - "**/*.xctestplan"
  - "**/Package.swift"
  - "**/Package.resolved"
  - "**/*.swift"
  - "**/*.xcodeproj/**"
---

# Xcode Project Surgery

The project file is the most error-prone thing an agent touches. Prefer a tool call over a text
edit everywhere below.

## project.pbxproj

- **Never hand-edit a pbxproj.** A project full of explicit file references turns "add a file" into
  surgery on a several-hundred-KB file; one real app measured 544 explicit refs against 3
  synchronized groups.
- **Synchronized folders (Xcode 16+) make file adds zero-touch**: drop the file in the folder and it
  is in the target. Prefer converting a group to a folder (operator work in Xcode, cheapest on
  single-target folders first) over teaching an agent to edit refs.
- **New targets come from a template**, via `XcodeNewTarget`, not a pbxproj edit.
- **A hosted test target needs an explicit target dependency on the app** (Build Phases →
  Dependencies). `XcodeNewTarget` does not add it, and without it Xcode's dependency scan reports
  "missing a dependency on ..." for every module the app links.
- A test file that is not wired into the project **silently runs zero tests**. Confirm the count.

## Build settings

- **Settings live in `*.xcconfig`, never inside the pbxproj.** Use `UpdateTargetBuildSetting` /
  `GetTargetBuildSettings` to inspect and change them, and `AddEntitlement` / `AddInfoPlist` for
  those files.
- Single-source the version in one xcconfig (`MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`). A
  release bump edits both lines, always: the build number must increase monotonically.

## SPM dependencies

- **`Package.resolved` is the only thing making a branch-tracked dependency reproducible.** Never
  refresh package resolution as a side effect of something else; build with the committed file
  (`-disableAutomaticPackageResolution`) and resolve deliberately, in its own commit.
- **With a remote branch dependency, editing the local package checkout changes nothing** in the
  consuming build until re-resolution. An easy hour to lose.
- **A local package inside a `.xcworkspace` overrides the remote dependency of the same identity.**
  That is what lets app and package change together without branch switching, while a clean checkout
  or CI still resolves from the remote. Opening such a workspace also rewrites the *package's* own
  `Package.resolved` with the app's graph: that drift is never committed, restore it with
  `git checkout -- Package.resolved`.
- **Release order**: push the packages first, re-resolve so `Package.resolved` pins the new
  revisions (its own commit), then archive. An archive whose local packages have unpushed commits
  ships code no consumer can reproduce.

## Previews, older systems and the iPhone Duo

- **Render previews one at a time.** Parallel `RenderPreview` calls came back with the wrong
  `displayName` (only `sourceLineNumber` matched the request) and left DerivedData missing build task
  contexts, so later builds failed with "failed to deserialize Info.plist task context" until the
  affected scheme (or the other run destination) built again. A re-render inside an existing preview
  session can also crash in `swift_release` as a finished `.task`'s closure is torn down, or keep
  showing the loading placeholder, while the app itself runs clean; close and reopen the workspace
  for a fresh session before suspecting the code. A widget preview's `timelineIndex` didn't select
  its entry either: to look at one moment, add a throwaway `#Preview` with that single entry.
- **Pick the preview's device instead of moving the run destination.** Since Xcode 27.2,
  `RenderPreview` returns `supportedOverrides.renderDestinations` and takes
  `preferredRenderDestination` (any of `identifier`, `deviceModelName`, `platformName`,
  `systemVersion`), so one call renders on an iPad, an iPhone Duo or an older OS without
  `XcodeSwitchRunDestination`. A destination that matches nothing silently falls back to the
  automatic one and says so in `errors`, so read `errors` before trusting the snapshot. The first
  render on a simulator that isn't booted can outlast the default 120 s timeout; pass `timeout: 300`
  rather than retrying blind. The destinations include older-OS simulators, so a preview is also the
  quickest look at a screen on the deployment floor.
- **Copy preview snapshots by name prefix.** `RenderPreview` names its PNGs with the time, and macOS
  puts a narrow no-break space (U+202F) before AM/PM, so a typed path never matches. List the folder
  and match the start of the name (`next(n for n in os.listdir(dir) if n.startswith(prefix))`), and
  copy each snapshot as soon as it renders.
- **Test an iPhone Duo's inner display through a preview.** The device-interaction tools have no
  fold command and the Duo simulator boots on its closed outer display (466×678 pt), so a run never
  reaches regular width there. Render on the Duo with the `Display` variant (`Outer`, `Inner`)
  alongside `Orientation`, `{"Display": "Inner"}` for the open display and its size classes. The Duo
  has a simulator runtime of its own (on Xcode 27.2, a separate `iOS 27.2` runtime only the Duo uses),
  so check it in `xcrun simctl list runtimes` rather than assuming the iPhones' runtime covers it. A
  preview shows one screen without the app's sidebar, so check the running app too: unfold the
  simulator in Device Hub, run it, and screenshot the inner display, which `DeviceInteractionSynthesize`
  can't see (it captures the dark outer one). `xcrun simctl io <udid> enumerate` lists it as `LCD-1`;
  pass its Unique ID to `xcrun simctl io <udid> screenshot --display=<id> <path>`, as a bare command of
  its own.
- **Launch on the oldest supported OS before a release.** A framework older than the deployment
  floor links strongly, and Swift can still import a newer symbol from it strongly even inside an
  `#available` block (an iOS 18 enum case used behind `#available(iOS 26, *)`, with an iOS 17 floor),
  so the app dies in dyld at launch on the older OS while every build and test stays green. dyld binds
  every strong symbol at load, so one clean launch on a floor-OS simulator proves the imports; the fix
  is `-weak_framework <Name>` in that target's `OTHER_LDFLAGS`, then `nm -m` shows the symbol as
  `weak external`. The device-interaction tools only offer simulators on the current OS family (on
  Xcode 27.2, iOS 27 and later), so launch an older one with `RunProject` on that destination and take
  the screenshot with `xcrun simctl io <udid> screenshot <path>`.

## After an Xcode update

- Bump `.xcode-version` only as its own reviewed change, then build every scheme in each
  configuration and run every test plan on the new toolchain before anything else lands.
- If the headless service reports simulators as a mismatched platform, reconnect the MCP client
  (`/mcp`) and restart the service (`sudo xcrun mcp-server stop`) before suspecting the project.
- A build that finishes in seconds after the update may be the operator's GUI build sitting in the
  shared DerivedData, which compiles nothing and so reports none of the new compiler's warnings. For
  the warning census, build once into a scratch `-derivedDataPath` with `xcodebuild` (an excluded
  command) in the background.
- An SDK update can change locale data under a test: the riyal sign moved to U+20C1 on macOS 27.2.
  Print the new value's Unicode scalars (`RunCodeSnippet`) before rewriting the one assertion.
- Before deleting an older simulator runtime, read `xcrun simctl list runtimes --json` and check
  the new runtime's `supportedDeviceTypes` cover every device on the old one. A point release can
  split runtimes by device, and devices on a deleted runtime go with it. `xcrun simctl runtime
  delete` only sees runtimes stored as disk images (`xcrun simctl runtime list`); one installed as a
  macOS-managed asset (under `/System/Library/AssetsV2/com_apple_MobileAsset_*SimulatorRuntime/`)
  answers "No runtime disk images or bundles found" and is removed from Xcode Settings → Components,
  by the operator. Try `--dry-run` first.
- Old runtimes for the deployment floor (watchOS 10 on Xcode 27.2) aren't offered by
  `xcodebuild -downloadPlatform`; the operator adds them from Xcode Settings → Components.
- Apple's skills live in a folder per Xcode build, so a new build needs its own export (below).

## Apple's skills

Xcode ships agent skills written by Apple's framework teams. They state that they supersede
general training on their topics. Read them as files, not as a plugin: the plugin Xcode exports
(`xcode-integration`) registers a second `xcode` server beside the home's, and
`xcrun mcpbridge run-agent` launches Xcode's own copy of the agent with its own config, outside
this home.

- **Where:** `~/Library/Developer/Xcode/CodingAssistant/ExportedPlugins/<build>/claude/skills/<skill>/SKILL.md`,
  with `<build>` from the second line of `xcodebuild -version` (`Build version 27B52` → `27B52`).
  Read the `SKILL.md`, then only the `references/` files it points to for the task in hand. List the
  folder rather than trusting the names below: the what's-new skills are renamed every year.
- **A missing folder** means this Xcode build hasn't exported its skills yet. The operator runs
  `xcrun agent plugin path --plugin-format claude` once per build; it needs a running Xcode, so it
  can't run from the sandbox.
- **A tool description that says to activate `xcode-integration:<skill>`** (the String Catalog
  tools do) means: read that skill's file before the call.
- When the repo's manual lists its own skills for the same area, read both: Apple's for API
  correctness and what's new, the repo's for its conventions.

| Before… | Read |
|---|---|
| SwiftUI code, layout, animation, performance | `swiftui-specialist`, `swiftui-whats-new-<year>` |
| App Intents, Siri, Shortcuts | `app-intents-specialist`, `app-intents-whats-new-<year>` |
| iPad, multiple windows, Stage Manager, the iPhone Duo | `app-resizability` |
| Adding a language or translating String Catalogs | `translation-coordinator` (it hands strings to `translation`) |
| Checking UI on a simulator or device | `device-interaction` (gesture syntax incl. the Digital Crown, hitPoints, a subagent per session; `DeviceInteractionStartWorkspaceSession` names it in `skillToTrigger`) |
| Slow screens, hangs, memory or energy | `xctrace` |
| Migrating or modernizing tests | `modernize-tests` |
| Accessibility before a release | `accessibility-voiceover-specialist`, `accessibility-dynamic-type-specialist`, `accessibility-sufficient-contrast-specialist` |
| Hardening build settings | `audit-xcode-security-settings` |
| C or Objective-C buffer safety | `adopt-c-bounds-safety` |
| A document-based app | `building-document-based-swiftui-applications` |
