import { buildApp } from "@/core/app.js";
const app = await buildApp();
await app.ready();
const tree = app.printRoutes();
console.log(
  tree
    .split("\n")
    .filter((l) => l.includes("work") || l.includes("journal"))
    .join("\n")
    .slice(0, 2000),
);
await app.close();
process.exit(0);
