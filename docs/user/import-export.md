# Importing and exporting

Every master list can be exported to a spreadsheet and loaded back from one.
Useful for the initial load, for bulk changes, and for handing a list to
somebody who wants to look at it in Excel.

Available for: **assets**, **asset types**, **devices**, **locations**,
**departments**, **journal vocabulary** (categories and tags), **groups**,
**roles** and **users**.

---

## The shape of it

**Export** gives you an `.xlsx` with a header row naming each column. That file
is also the import template — export first, edit, import back. You do not have
to guess the format, and you cannot get the column order wrong.

**Import** accepts `.xlsx` or `.csv`.

Export needs only `:read` on the resource. **Import is its own permission** per
resource, because one file can change a great many rows at once.

---

## How an import behaves

**All or nothing.** If any row has a problem, nothing is written. You get a list
of what is wrong, by line number, and the data is exactly as it was. There is no
half-loaded state to unpick.

**Matched by name.** A row whose name already exists updates that record; a new
name creates one. So a re-import of an edited export is an update, not a pile of
duplicates.

**References are by name, not id.** A device names its department; a group names
its roles. You write what a person would write, and the import resolves it. A
name that does not resolve is an error on that line rather than a silent null.

**Multiple values use `|`.** A group's roles are
`Journal editor | Assets & devices viewer`.

---

## Reading the errors

Problems come back per line:

```
line 4: No group called "Maintainance"
line 7: "not:a-permission" is not a permission
line 9: "not-an-email" is not a valid email
```

The line number is the row in your file counting the header, so line 4 is the
third row of data — the same number your spreadsheet shows.

Fix and re-import the whole file. Because nothing was written, you are not
tracking which rows succeeded.

---

## What imports refuse

Some things are deliberately not importable, and the refusal is the feature:

- **The Superadmin group.** A user import naming it is rejected. Granting
  somebody the run of the whole system is a deliberate act in the UI, not a cell
  in a spreadsheet that could be pasted in by accident.
- **System roles and system groups.** They are refreshed from the application's
  own definition; a file cannot rewrite them. Clone one and import your variant.
- **Passwords.** A user import never carries one. New people are invited and set
  their own — a password in a spreadsheet is a password in everyone's downloads
  folder.
- **Anything outside your scope.** A row naming a company or location you cannot
  reach is an error, not a quiet write.

---

## Users, specifically

The heaviest import, because it creates accounts and places people in groups —
and a group is what grants access.

Columns: email, name, username, employee ID, designation, mobile, groups,
companies, status.

Each new person is **invited**: they get a set-password link. Nobody is created
able to sign in without proving they hold the address.

An existing email updates that person rather than creating a second one.

---

## Suggested order for a first load

Later lists reference earlier ones by name, so load them in dependency order:

1. **Locations** — the sites
2. **Departments** — the org tree
3. **Designations** — job titles
4. **Asset types**, then **assets** — the tree
5. **Device types**, then **devices**
6. **Journal vocabulary** — categories and tags
7. **Roles**, then **groups** — access
8. **Users** — last, so their groups and departments already exist

Importing users first means every group and department reference fails.

---

## Common questions

**My export opened with a formula in a cell.** Report it. Exports are records,
and a cell that a spreadsheet evaluates is a bug worth knowing about.

**Can I delete rows by removing them from the file?** No. An import creates and
updates; it never deletes. Retire what you no longer want, in the app —
deletion by omission is too easy to do by accident with a filtered export.

**The import says a name is unknown but I can see it.** It is probably in
another company, or at a location outside your scope. Imports resolve names only
within what you can reach.

**Can I change somebody's email with an import?** No — the email is how a row is
matched to a person. Change it on their profile.
