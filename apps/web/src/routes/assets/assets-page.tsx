// Author: Brijesh Dave <https://github.com/brijeshdave>
// The asset tree and the vocabulary it is built from, on one tabbed page.
//
// Viewing needs assets:read — anyone who files a report reads this, because it is
// where they pick what the report is about. Changing needs assets:create/update, so
// the controls are simply absent for everyone else.
import { PERMISSIONS } from "@reportly/shared";
import { useNavigate } from "@tanstack/react-router";

import { usePermission } from "@/components/can.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { PageHeader } from "@/components/ui/primitives.js";
import { AssetTreeTab } from "@/routes/assets/asset-tree-tab.js";
import { AssetTypesTab } from "@/routes/assets/asset-types-tab.js";

const TABS = [
  { id: "tree", label: "Tree" },
  { id: "types", label: "Types" },
];

export function AssetsPage({ tab }: { tab: string }) {
  const navigate = useNavigate({ from: "/assets" });
  const canManage = usePermission(PERMISSIONS.ASSETS_UPDATE);
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "tree";

  return (
    <>
      <PageHeader
        title="Assets"
        description="The structural things reports are filed against — your plant, its lines, the stations on them. Retire an asset to stop it being offered without disturbing the reports that name it."
      />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="tree" active={activeTab}>
          <AssetTreeTab canManage={canManage} />
        </TabPanel>
        <TabPanel id="types" active={activeTab}>
          <AssetTypesTab canManage={canManage} />
        </TabPanel>
      </div>
    </>
  );
}
