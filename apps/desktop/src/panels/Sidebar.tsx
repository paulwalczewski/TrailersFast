import { Tabs } from "@heroui/react";
import { useTrailerStore } from "@trailerfast/state";
import { AssetsTab } from "./AssetsTab";
import { SettingsTab } from "./SettingsTab";
import { TextsTab } from "./TextsTab";
import { ThumbnailTemplatesTab } from "./ThumbnailTemplatesTab";
import { ThumbnailTextsTab } from "./ThumbnailTextsTab";

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
      <Tabs.Panel id="assets" className="min-h-0 flex-1 overflow-auto p-3">
        <AssetsTab />
      </Tabs.Panel>
      <Tabs.Panel id="texts" className="min-h-0 flex-1 overflow-auto p-3">
        <TextsTab />
      </Tabs.Panel>
      <Tabs.Panel id="settings" className="min-h-0 flex-1 overflow-auto p-3">
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
      <Tabs.Panel id="assets" className="min-h-0 flex-1 overflow-auto p-3">
        <AssetsTab />
      </Tabs.Panel>
      <Tabs.Panel id="templates" className="min-h-0 flex-1 overflow-auto p-3">
        <ThumbnailTemplatesTab />
      </Tabs.Panel>
      <Tabs.Panel id="texts" className="min-h-0 flex-1 overflow-auto p-3">
        <ThumbnailTextsTab />
      </Tabs.Panel>
    </Tabs>
  );
}
