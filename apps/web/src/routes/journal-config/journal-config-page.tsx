// Author: Brijesh Dave <https://github.com/brijeshdave>
// The three knobs that make the reports domain fit any organisation: the severity
// ladder, the status workflow, and the
// per-department categories. Small lookup tables, so they are edited inline on one
// tabbed page rather than through a page per row.
//
// Viewing needs reports:read (anyone who files a report reads these); changing
// needs report-config:manage — the add/edit/delete controls are simply absent
// without it.
import { PERMISSIONS } from "@reportly/shared";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Building2, Download, Upload } from "lucide-react";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { ImportDialog } from "@/components/import-dialog.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { Button, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { CategoriesTab } from "@/routes/journal-config/categories-tab.js";
import { DeviceTypesTab } from "@/routes/journal-config/device-types-tab.js";
import { SeveritiesTab } from "@/routes/journal-config/severities-tab.js";
import { StatusesTab } from "@/routes/journal-config/statuses-tab.js";
import { TagsTab } from "@/routes/journal-config/tags-tab.js";
import {
  downloadVocabularyTemplate,
  exportVocabulary,
  importVocabulary,
} from "@/services/journal-config.js";

const TABS = [
  { id: "severities", label: "Severities" },
  { id: "statuses", label: "Statuses" },
  { id: "categories", label: "Categories" },
  { id: "tags", label: "Tags" },
  { id: "device-types", label: "Device types" },
];

export function ReportConfigPage({ tab }: { tab: string }) {
  const navigate = useNavigate({ from: "/journal-config" });
  // One permission per catalogue rather than one for the page. They are separable
  // by design, so somebody may hold tags:manage and see every tab but only be able
  // to edit that one — the controls elsewhere are simply absent.
  const canManageConfig = usePermission(PERMISSIONS.JOURNAL_CONFIG_MANAGE);
  const canManageCategories = usePermission(PERMISSIONS.CATEGORIES_MANAGE);
  const canManageTags = usePermission(PERMISSIONS.TAGS_MANAGE);
  const canManageDeviceTypes = usePermission(PERMISSIONS.DEVICE_TYPES_MANAGE);
  const canImport = usePermission(PERMISSIONS.JOURNAL_CONFIG_IMPORT);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "severities";

  // Categories, tags and device types belong to a company's departments, so the
  // API cannot answer without knowing which company — it returns 400 with
  // "X-Company-Id header is required". Say that in words rather than letting a
  // reference id stand where an instruction belongs: with "All companies"
  // selected every tab here fails, and nothing on the page hints why.
  if (!session.companyId) {
    return (
      <>
        <PageHeader
          title="Journal setup"
          description="The severity ladder, the status workflow, and each department's own words."
        />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher. Categories, tags and device types belong to a company's departments, so there is nothing to show until one is chosen."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Journal setup"
        description="The severity ladder, the status workflow, and each department's own words — categories, tags and device types. A category is the one kind of problem a report is; tags are as many labels as you like. Retire an entry to stop it being offered without disturbing the records already using it."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void exportVocabulary()}>
              <Download className="h-4 w-4" /> Export
            </Button>
            {canImport ? (
              <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
            ) : null}
          </div>
        }
      />

      {importOpen ? (
        <ImportDialog
          title="Import journal vocabulary"
          description="One file, four kinds (the Kind column): company-wide severities and statuses, and per-department categories and tags. Terms are matched by name; existing ones are updated, new ones created. If any row is wrong, nothing is saved."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadVocabularyTemplate}
          runImport={importVocabulary}
          onImported={() =>
            queryClient.invalidateQueries({
              predicate: (q) => ["report-config", "vocabulary"].includes(String(q.queryKey[0])),
            })
          }
        />
      ) : null}

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="severities" active={activeTab}>
          <SeveritiesTab canManage={canManageConfig} />
        </TabPanel>
        <TabPanel id="statuses" active={activeTab}>
          <StatusesTab canManage={canManageConfig} />
        </TabPanel>
        <TabPanel id="categories" active={activeTab}>
          <CategoriesTab canManage={canManageCategories} />
        </TabPanel>
        <TabPanel id="tags" active={activeTab}>
          <TagsTab canManage={canManageTags} />
        </TabPanel>
        <TabPanel id="device-types" active={activeTab}>
          <DeviceTypesTab canManage={canManageDeviceTypes} />
        </TabPanel>
      </div>
    </>
  );
}
