import { Tabs } from "@heroui/react";
import { useTrailerStore } from "@trailerfast/state";
import { AssetsTab } from "./AssetsTab";
import { SettingsTab } from "./SettingsTab";
import { TextsTab } from "./TextsTab";
import { ThumbnailTemplatesTab } from "./ThumbnailTemplatesTab";
import { ThumbnailTextsTab } from "./ThumbnailTextsTab";

/* `relative` matters: React Aria hides each switch/slider's real <input> in an
   absolutely positioned 1px span with no offsets. Without a positioned scroll
   pane those spans resolve against the initial containing block, escape the
   pane's clip, and land at their static position hundreds of px down the
   document — so focusing a control near the bottom of a tab scrolls the whole
   page instead of the pane. See the #root note in index.css. */
const PANEL = "relative min-h-0 flex-1 overflow-auto p-3";

/** The sidebar follows the header's mode — only the Assets tab is shared. */
export function Sidebar() {
  const mode = useTrailerStore((s) => s.mode);
  return mode === "thumbnail" ? <ThumbnailSidebar /> : <TrailerSidebar />;
}

function TrailerSidebar() {
  return (
    <Tabs defaultSelectedKey="assets" className="flex h-full flex-col">
      <Tabs.ListContainer className="px-3 pt-3">
        <Tabs.List aria-label="Sidebar sections">
          <Tabs.Tab id="assets">
            Assets
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="texts">
            <Tabs.Separator />
            Texts
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="settings">
            <Tabs.Separator />
            Settings
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="assets" className={PANEL}>
        <AssetsTab />
      </Tabs.Panel>
      <Tabs.Panel id="texts" className={PANEL}>
        <TextsTab />
      </Tabs.Panel>
      <Tabs.Panel id="settings" className={PANEL}>
        <SettingsTab />
      </Tabs.Panel>
    </Tabs>
  );
}

function ThumbnailSidebar() {
  return (
    <Tabs defaultSelectedKey="assets" className="flex h-full flex-col">
      <Tabs.ListContainer className="px-3 pt-3">
        <Tabs.List aria-label="Thumbnail sections">
          <Tabs.Tab id="assets">
            Assets
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="templates">
            <Tabs.Separator />
            Templates
            <Tabs.Indicator />
          </Tabs.Tab>
          <Tabs.Tab id="texts">
            <Tabs.Separator />
            Texts
            <Tabs.Indicator />
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.ListContainer>
      <Tabs.Panel id="assets" className={PANEL}>
        <AssetsTab />
      </Tabs.Panel>
      <Tabs.Panel id="templates" className={PANEL}>
        <ThumbnailTemplatesTab />
      </Tabs.Panel>
      <Tabs.Panel id="texts" className={PANEL}>
        <ThumbnailTextsTab />
      </Tabs.Panel>
    </Tabs>
  );
}
