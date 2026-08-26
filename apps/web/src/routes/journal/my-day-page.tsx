// Author: Brijesh Dave <https://github.com/brijeshdave>
// What is on one person's plate today.
//
// This was the journal's first tab, which meant every visit to the journal opened
// on a screenful of summary tiles — including a link meant for the table. The two
// answer different questions ("what should I do now" and "find me that entry"), so
// they are two pages rather than two tabs on one.
import { MyDay } from "@/components/my-day.js";
import { PageHeader } from "@/components/ui/primitives.js";

export function MyDayPage() {
  return (
    <>
      <PageHeader
        title="My day"
        description="Your points, what you filed today, what is still down, and what is waiting to be scored."
      />
      <div className="pt-4">
        <MyDay />
      </div>
    </>
  );
}
