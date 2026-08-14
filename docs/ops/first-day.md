# Your first day

Reportly is installed and you can sign in as the superadmin. This page takes you
from there to a team filing real work — in the order that avoids doubling back.

Everything here is an IT department, because that is what Reportly was built for
first. A maintenance or facilities team does the same steps with different words.

::: tip The order matters
Access hangs off groups, groups hang off companies and locations, and the
reporting line hangs off departments. Build them in that order and nothing needs
redoing.
:::

## What the install already gave you

`cli seed` created:

- the four **system roles** — Superadmin, Admin, Manager, Member;
- a **Superadmin group**, and your superadmin account in it;
- a **demo company**, with an automatic `Remote` location;
- the severity ladder, the status workflow, and the asset types.

System roles cannot be edited, deliberately: a role defines what a set of
permissions _means_, so changing one would silently re-grant every group holding
it. Clone one to make your own.

## 1. The company, and its sites

**Organisation → Companies.**

Rename the demo company, or create your own and retire the demo. Then add its
locations — the physical sites people work at: `Head office`, `Plant 1`,
`Warehouse`.

Every company gets a `Remote` location automatically, and it cannot be deleted.
It is where people with no fixed site file from.

::: warning Locations are not just labels
A group's access can be narrowed to particular locations. Get the list roughly
right now; adding a site later is easy, but moving people between them is
fiddlier.
:::

## 2. The department tree

**Organisation → Departments.**

Departments nest. For an IT department, something like:

```
IT
├─ Service desk
├─ Infrastructure
│   ├─ Network
│   └─ Servers
└─ Applications
```

Departments describe the organisation. They grant **no access at all** — that is
groups' job, and keeping the two apart is what lets somebody sit in Infrastructure
without automatically being able to see Applications' work.

## 3. People

**People & access → Users → Invite.**

An invitation sends a link to set a password. It grants an **identity, not
permission**: until you put them in a group, their user page says "Not in any
group" and they can see nothing.

Give each person a username as well as an email — either signs them in.

## 4. Groups: who can do what, and where

**People & access → Groups.**

A group holds three things: **roles**, the **companies** they apply to, and the
**locations** within them. A workable IT starting point:

| Group             | Roles   | Scope                    | Who is in it                |
| ----------------- | ------- | ------------------------ | --------------------------- |
| IT administrators | Admin   | All companies            | You, your deputy            |
| IT managers       | Manager | Your company, all sites  | Team leads, the HOD         |
| IT staff          | Member  | Your company, their site | Engineers, the service desk |

Member is read-plus-file: enough to record work and see their own. Manager adds
creating and updating, plus the reliability figures. Admin is everything short of
superadmin.

Need something narrower — "keeps the device register current but deletes
nothing"? Clone a system role and remove what it should not have. There are area
roles for each of the ten areas, with an admin, an editor and a viewer apiece.

## 5. The reporting line

**Organisation → Organisation chart**, or each department's Members tab.

For every person, record their **rank**, who they **report to**, and optionally
the **sites** their membership covers.

This is the step people skip, and it is the one that matters most:

::: danger Without a reporting line, nobody's work can be reviewed
Visibility and scoring both walk this chain. A manager sees the entries of
everybody below them, at any depth. Rank is only a label — the chain is the
authority.
:::

"Reports to" may cross departments: the Head of IT reports up into Management, not
sideways into their own team. It only has to stay inside the company.

## 6. What you work on

**Assets** is the tree — site, building, line, station. **Devices** is the flat,
searchable register of machines, because there may be thousands of them and nobody
will file those into a hierarchy by hand.

For an IT department:

- **Assets:** `Head office → 2nd floor → Server room`
- **Devices:** the switches, servers, printers and laptops that stand in them,
  each with its **Asset ID** — your own inventory number, which is what people
  will search by.

A device records which asset it stands at, so an issue on a printer rolls up to
the floor and the building without anyone maintaining a second tree.

::: tip Decide what can stop production
Each asset and device **type** carries a "tracks downtime" switch. Turn it on for
the things whose failure actually halts work — a core switch, a line printer —
and leave it off for laptops. Downtime is production stopped, not time spent, and
Reportly will not ask for it where it would be meaningless.
:::

## 7. The vocabulary

**Journal setup.**

- **Categories**, per department — for a service desk: `Hardware`, `Network`,
  `Access`, `Software`, `Peripheral`.
- **Tags**, per department, multi-select — `vpn`, `printer`, `outlook`,
  `firmware`. Tags are a shared vocabulary, which is why nobody can invent one
  mid-form: allow that and you get "printer", "Printer" and "prntr" inside a week,
  and nothing groups.
- **Severities** and **statuses** ship sensible and are worth leaving alone until
  you have a reason.

## 8. File the first entry

**Journal → New entry.** File something real — the last thing that actually
broke. Point it at the device, set the category and a tag or two, record your work
time, and submit it.

Then, as their manager, open **Reviews** and score it. That round trip is the
whole product in miniature, and doing it once now tells you whether steps 2, 4 and
5 are right while they are still cheap to change.

## 9. Then, when you are ready

None of these are needed on day one:

| Next                                              | Where                                       |
| ------------------------------------------------- | ------------------------------------------- |
| Tell people what happened                         | [Notifications](../user/notifications.md)   |
| Put the team on a rota                            | [Shifts](../user/shifts.md)                 |
| The weekly check, the monthly clean               | [Routines](../user/routines.md)             |
| Load your existing device list from a spreadsheet | [Import & export](../user/import-export.md) |
| Printer cartridges, or anything else that cycles  | [Cartridges](../user/cartridges.md)         |
| Backups — **before** you need them                | [Operations](../operations.md)              |

::: warning Do the backups this week
A backup nobody has restored is a hypothesis. Schedule both halves — the database
and the attachment store — and then practise a restore while it does not matter.
:::
